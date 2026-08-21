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
// SCOPE — browser-ONLY packages, and why it is not repo-wide
//
// `tests/AGENTS.md` § Browser tests forbids a browser entry from importing the gjs/node
// spec files: Web APIs are already global in a browser, and pulling our packages in
// drags `@girs/*`/`gi://` through the bundle. So "every spec is registered in the
// browser entry" is TRUE only where the browser entry is the only entry — a package
// with `src/test.browser.mts` and no `src/test.{mts,ts}`. Demanding it of the others
// would demand exactly what AGENTS.md prohibits. When this landed the set was
// adwaita-web, adwaita-storybook and xmlhttprequest; it is DERIVED on every run rather
// than listed, so a new browser-only package is covered the day it lands.
//
// The one rule that IS repo-wide is weaker and lexical: an entry must register at
// least one namespace. It costs nothing to hold and it holds on every PR, which the
// runtime floor does not — `main.yml` skips the whole browser job when no bundle was
// staged.
//
// Spec files are found by WALKING `src/`, not by a `src/*.spec.ts` glob: a glob is
// blind to the first spec that lands in a subdirectory, and going blind is the failure
// mode this file exists to remove.
//
// Usage: node scripts/check-browser-test-registration.mjs [--root <dir>]

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

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

/** Every `<pillar>/<pkg>/src` directory that holds a browser test entry. */
function browserEntries() {
    const found = [];
    for (const pillar of readdirSync(PACKAGES, { withFileTypes: true })) {
        if (!pillar.isDirectory()) continue;
        const pillarDir = join(PACKAGES, pillar.name);
        for (const pkg of readdirSync(pillarDir, { withFileTypes: true })) {
            if (!pkg.isDirectory()) continue;
            const src = join(pillarDir, pkg.name, 'src');
            const entry = ENTRY_NAMES.map((name) => join(src, name)).find((path) => existsSync(path));
            if (entry === undefined) continue;
            const shared = SHARED_ENTRY_NAMES.map((name) => join(src, name)).filter((path) => existsSync(path));
            found.push({ name: `${pillar.name}/${pkg.name}`, src, entry, browserOnly: shared.length === 0 });
        }
    }
    return found;
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

/** `export const|function|async function <Name>Test` — the suite-export convention. */
const SUITE_EXPORT = /^export\s+(?:const|let|var|async\s+function|function)\s+([A-Za-z_$][\w$]*Test)\b/gm;

/** An identifier in KEY position: preceded by `{` or `,`, never by `:`. */
const KEY = /([A-Za-z_$][\w$]*)/g;

/**
 * The namespace keys of the FIRST `run({…})` in `source`, or `null` when there is none.
 *
 * Keys at every depth count: `runTests` recurses into a nested object, so a suite
 * grouped inside one is registered just as much as a top-level entry.
 */
function registeredKeys(source) {
    const call = /\brun\s*\(\s*\{/.exec(source);
    if (call === null) return null;
    const open = source.indexOf('{', call.index);
    let depth = 0;
    let close = -1;
    for (let i = open; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) {
            close = i;
            break;
        }
    }
    if (close === -1) return null;

    const body = source.slice(open + 1, close).replace(/\/\/[^\n]*/g, '');
    const keys = new Set();
    for (const match of body.matchAll(KEY)) {
        const before = body.slice(0, match.index).trimEnd();
        if (before === '' || before.endsWith('{') || before.endsWith(',')) keys.add(match[1]);
    }
    return keys;
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

const entries = browserEntries();
if (entries.length === 0) {
    fail([
        `no src/test.browser.mts under ${relative(ROOT, PACKAGES)}.`,
        'Every pillar ships them, so this is the discovery breaking rather than the tree —',
        'and a check that finds nothing passes vacuously.',
    ]);
}

const problems = [];

for (const { name, src, entry, browserOnly } of entries) {
    const source = readFileSync(entry, 'utf8');
    const where = relative(ROOT, entry);
    let keys = registeredKeys(source);

    if (keys === null) {
        const delegate = delegatedEntry(src, source);
        if (delegate === undefined) {
            problems.push(
                `${where}: no \`run({…})\` and no \`./test.mjs\` re-export — the bundle registers nothing.`,
            );
            continue;
        }
        keys = registeredKeys(readFileSync(delegate, 'utf8'));
        if (keys === null || keys.size === 0) {
            problems.push(`${where}: delegates to ${relative(ROOT, delegate)}, which registers nothing.`);
            continue;
        }
    }

    if (keys.size === 0) {
        problems.push(`${where}: \`run({})\` registers no namespace — the bundle would report 0/0/0 and pass.`);
        continue;
    }

    if (!browserOnly) continue;

    for (const spec of specFiles(src)) {
        const exported = [...readFileSync(spec, 'utf8').matchAll(SUITE_EXPORT)].map((match) => match[1]);
        if (exported.length === 0) {
            problems.push(
                `${relative(ROOT, spec)}: exports no \`…Test\` suite, so nothing can register it, and`,
                `  ${name} has no other test entry to run it from. Export one, or delete the file.`,
            );
            continue;
        }
        const unregistered = exported.filter((symbol) => !keys.has(symbol));
        if (unregistered.length > 0) {
            problems.push(
                `${relative(ROOT, spec)}: ${unregistered.join(', ')} is not in the \`run({…})\` of ${where},`,
                `  and ${name} is browser-only — so that suite runs NOWHERE. Import it and register it.`,
            );
        }
    }
}

if (problems.length > 0) fail(problems);

const browserOnlyCount = entries.filter((entry) => entry.browserOnly).length;
console.log(
    `check-browser-test-registration: OK — ${entries.length} browser test entries register at least one ` +
        `namespace; ${browserOnlyCount} browser-only package(s) register every \`…Test\` their specs export.`,
);
