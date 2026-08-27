#!/usr/bin/env node
// A `src/test.browser.mts` entry registers every spec its package can only run there.
//
// THE INCIDENT
//
// `packages/web/adwaita-web` has no `test` script: every one of its spec files reaches a runner
// through exactly one path, the `run({…})` call in `src/test.browser.mts`, bundled by
// `build:test:browser` and driven by the `tests/browser/` Playwright suite. Nothing
// read that call. `src/test.browser.mts` is not even in the package's tsconfig program
// (`include` is `src/**/*.ts`, which does not match `.mts`), so an import dropped from
// it costs nothing anywhere: the spec file stays on disk, stays type-checked, and stops
// running. The Playwright side could not see it either — it asserted `failed === 0`,
// and `@gjsify/unit` signals done unconditionally, so a bundle registering NOTHING
// reported 0/0/0 and passed. That half is now `results.total > 0` in
// `tests/browser/specs/unit.spec.ts`; this is the half that catches a PARTIAL shrink,
// which a floor cannot.
//
// SCOPE — browser-ONLY packages, and why the per-spec rule is not repo-wide
//
// "every spec is registered in the browser entry" is TRUE only where the browser entry is
// the ONLY entry — a package with `src/test.browser.mts` and no `src/test.{mts,ts}`. A
// package with both legitimately registers a browser-APPROPRIATE SUBSET there while its
// remaining specs reach a runner through `src/test.mts`, so an unregistered spec is not
// orphaned. (`tests/AGENTS.md` § Browser tests answers a different question — it forbids
// importing "`@gjsify/<pkg>` impls or spec files that do" — and the entries that re-export
// the shared spec set wholesale are inspected and passed here.) When this landed the
// browser-only set was adwaita-web, adwaita-storybook and xmlhttprequest; it is DERIVED on
// every run rather than listed, so a new one is covered the day it lands.
//
// Two rules ARE repo-wide, both weaker and lexical: an entry must register at least one
// namespace, and `build:test:browser` must pair with the entry file. Neither costs
// anything to hold and both hold on every PR, which the runtime floor does not —
// `main.yml` skips the whole browser job when no bundle was staged.
//
// Spec files are found by WALKING `src/`, not by a `src/*.spec.ts` glob: a glob is
// blind to the first spec that lands in a subdirectory, and going blind is the failure
// mode this file exists to remove.
//
// Usage: node scripts/check-browser-test-registration.mjs [--root <dir>]

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { registeredSymbols, resolveToSource, stripComments } from './suite-registration.mjs';

const args = process.argv.slice(2);
const rootIndex = args.indexOf('--root');
const ROOT = rootIndex === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootIndex + 1];

const PACKAGES = join(ROOT, 'packages');
const ENTRY_NAMES = ['test.browser.mts', 'test.browser.ts'];
const SHARED_ENTRY_NAMES = ['test.mts', 'test.ts'];

function fail(lines) {
    console.error(`check-browser-test-registration: ${lines.join('\n  ')}`);
    process.exit(1);
}

/**
 * Every `<pillar>/<pkg>` with a browser test entry, plus the ones whose entry and
 * `build:test:browser` script do not pair up.
 *
 * The pairing is the discovery's own blind spot: `tests/browser/scripts/build-bundles.mjs`
 * requires BOTH, and so does this file, so dropping either drops the package out of both
 * without failing anything — a one-file deletion orphaned every adwaita-web spec and the
 * whole battery stayed green. Nothing in the tree violates it, so it is free to hold.
 */
function browserPackages() {
    const found = [];
    const unpaired = [];
    for (const pillar of readdirSync(PACKAGES, { withFileTypes: true })) {
        if (!pillar.isDirectory()) continue;
        const pillarDir = join(PACKAGES, pillar.name);
        for (const pkg of readdirSync(pillarDir, { withFileTypes: true })) {
            if (!pkg.isDirectory()) continue;
            const name = `${pillar.name}/${pkg.name}`;
            const dir = join(pillarDir, pkg.name);
            const src = join(dir, 'src');
            const manifest = join(dir, 'package.json');
            const entry = ENTRY_NAMES.map((n) => join(src, n)).find((path) => existsSync(path));
            const declared =
                existsSync(manifest) &&
                Boolean(JSON.parse(readFileSync(manifest, 'utf8')).scripts?.['build:test:browser']);

            if (entry === undefined) {
                if (declared)
                    unpaired.push(
                        `${name}: declares \`build:test:browser\` but ships no \`src/test.browser.mts\` —`,
                        '  nothing builds, and the bundle set silently gets smaller. Restore it, or drop the script.',
                    );
                continue;
            }
            if (!declared)
                unpaired.push(
                    `${name}: ships \`src/test.browser.mts\` but declares no \`build:test:browser\` —`,
                    '  the entry is never bundled, so every suite in it runs NOWHERE. Add the script.',
                );
            const shared = SHARED_ENTRY_NAMES.map((n) => join(src, n)).filter((path) => existsSync(path));
            found.push({ name, src, entry, browserOnly: shared.length === 0 });
        }
    }
    return { found, unpaired };
}

/** Every `*.spec.ts` below `dir`, at any depth. */
function specFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...specFiles(path));
        else if (entry.name.endsWith('.spec.ts')) found.push(path);
    }
    return found;
}

/** `export const|function|async function <Name>Test` — one of the two suite-export shapes. */
const SUITE_EXPORT = /^export\s+(?:const|let|var|async\s+function|function)\s+([A-Za-z_$][\w$]*Test)\b/gm;

/** The other, and the tree's dominant one: `export default async () => {…}`. */
const DEFAULT_EXPORT = /^export\s+default\b/m;

/** `import Suite from './foo.spec.js'` — the local name a default export is registered under. */
const DEFAULT_IMPORT = /^import\s+([A-Za-z_$][\w$]*)\s*(?:,\s*\{[^}]*\})?\s+from\s+['"](\.[^'"]+)['"]/gm;

/** Any relative import, in any binding form — used only to ask "does anything reach this file". */
const RELATIVE_IMPORT = /(?:from|import)\s+['"](\.[^'"]+)['"]/g;

/** The emitted specifier a TypeScript source imports by, back to the source file it names. */
const resolveSpecifier = (fromFile, specifier) => join(dirname(fromFile), resolveToSource(specifier));

/**
 * The suites the FIRST `run({…})` in `source` registers, or `null` when there is none.
 *
 * The parse is `scripts/suite-registration.mjs`, shared with the driver gate and the node
 * registration gate: three readers of one `run({…})` is three chances to disagree about
 * what runs. `registered` and not `called` — this file's own arm fails an entry whose
 * object registers NOTHING, and `run` is itself a called identifier.
 */
function registeredKeys(source) {
    const { registered, registers, properties } = registeredSymbols(source);
    // `count` and not `named.size`: 23 entries register an INLINE suite by method shorthand
    // (`run({ async DomExceptionTest() {…} })`), which registers a namespace while naming no
    // module. The emptiness arm below asks the first question, the two arms after it the second.
    return registers ? { named: registered, count: properties } : null;
}

/**
 * A re-export entry (`export * from './test.mjs'`) delegates to the shared entry, which
 * owns the `run({…})`. Resolve the emitted specifier back to its TypeScript source.
 */
function delegatedEntry(src, source) {
    const target = /(?:^|\n)\s*(?:import|export\s+\*\s+from)\s+['"]\.\/(test\.m?js)['"]/.exec(source);
    if (target === null) return undefined;
    const candidate = join(src, target[1].replace(/\.mjs$/, '.mts').replace(/\.js$/, '.ts'));
    return existsSync(candidate) ? candidate : undefined;
}

const { found: entries, unpaired } = browserPackages();
if (entries.length === 0) {
    fail([
        `no src/test.browser.mts under ${relative(ROOT, PACKAGES)}.`,
        'Every pillar ships them, so this is the discovery breaking rather than the tree —',
        'and a check that finds nothing passes vacuously.',
    ]);
}

const problems = [...unpaired];

for (const { name, src, entry, browserOnly } of entries) {
    const source = stripComments(readFileSync(entry, 'utf8'));
    const where = relative(ROOT, entry);
    let keys = registeredKeys(source);

    if (keys === null) {
        const delegate = delegatedEntry(src, source);
        if (delegate === undefined) {
            problems.push(`${where}: no \`run({…})\` and no \`./test.mjs\` re-export — the bundle registers nothing.`);
            continue;
        }
        keys = registeredKeys(stripComments(readFileSync(delegate, 'utf8')));
        if (keys === null || keys.count === 0) {
            problems.push(`${where}: delegates to ${relative(ROOT, delegate)}, which registers nothing.`);
            continue;
        }
    }

    if (keys.count === 0) {
        problems.push(`${where}: \`run({})\` registers no namespace — the bundle would report 0/0/0 and pass.`);
        continue;
    }

    if (!browserOnly) continue;

    const specs = specFiles(src);
    const sources = new Map(specs.map((spec) => [spec, stripComments(readFileSync(spec, 'utf8'))]));

    // What the ENTRY binds a spec's default export to, and — separately — every file
    // anything in the package imports. A `*.spec.ts` can legitimately be a helper module
    // rather than a suite (`packages/node/fs/src/capabilities.spec.ts` measures host
    // capabilities for its siblings); it reaches the runner through its importer, so
    // "exports no suite" is only a fault when nothing imports it either.
    const bindings = new Map();
    for (const [binding, specifier] of [...source.matchAll(DEFAULT_IMPORT)].map((m) => [m[1], m[2]]))
        bindings.set(resolveSpecifier(entry, specifier), binding);
    const imported = new Set();
    for (const [file, text] of [[entry, source], ...sources])
        for (const match of text.matchAll(RELATIVE_IMPORT)) imported.add(resolveSpecifier(file, match[1]));

    for (const spec of specs) {
        const rel = relative(ROOT, spec);
        const suites = [...sources.get(spec).matchAll(SUITE_EXPORT)].map((match) => match[1]);
        const binding = bindings.get(spec);

        if (suites.length > 0) {
            const unregistered = suites.filter((symbol) => !keys.named.has(symbol));
            if (unregistered.length > 0)
                problems.push(
                    `${rel}: ${unregistered.join(', ')} is not in the \`run({…})\` of ${where},`,
                    `  and ${name} is browser-only — so that suite runs NOWHERE. Import it and register it.`,
                );
            continue;
        }

        if (DEFAULT_EXPORT.test(sources.get(spec))) {
            if (binding === undefined)
                problems.push(
                    `${rel}: default-exports a suite that ${where} does not import, and ${name} is`,
                    '  browser-only — so it runs NOWHERE. Import it there and register it.',
                );
            else if (!keys.named.has(binding))
                problems.push(
                    `${rel}: imported into ${where} as \`${binding}\`, but \`${binding}\` is not in its`,
                    `  \`run({…})\` — so that suite runs NOWHERE. Register it.`,
                );
            continue;
        }

        if (imported.has(spec)) continue;
        problems.push(
            `${rel}: exports no suite — neither a \`…Test\` nor a default — and nothing in ${name}`,
            '  imports it, so it runs NOWHERE. Export a suite and register it, or delete the file.',
        );
    }
}

if (problems.length > 0) fail(problems);

const browserOnlyCount = entries.filter((entry) => entry.browserOnly).length;
console.log(
    `check-browser-test-registration: OK — ${entries.length} browser test entries register at least one ` +
        `namespace; ${browserOnlyCount} browser-only package(s) register every suite their specs export.`,
);
