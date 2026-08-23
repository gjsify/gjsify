#!/usr/bin/env node
// Every `*.spec.ts` in a package reaches a runner, or it is not a test.
//
// THE INCIDENT
//
// `packages/infra/cli/src/utils/ship/discover-license.spec.ts` was written with seven
// cases, run, and reported green — while `src/test.mts` did not import it. A package's
// specs reach `@gjsify/unit` through exactly one path: the hand-written `run({…})` call
// in its test entry. A spec that is not in that call stays on disk, stays type-checked
// by `include: src/**/*.ts`, and stops being a test. Nothing said so. It was caught by
// counting — 2497 completed where +8 was due — which works only if someone knows the
// number they expected.
//
// The sibling rule for the BROWSER entry already exists
// (`check-browser-test-registration.mjs`, written after a spec set shrank unnoticed in
// `packages/web/adwaita-web`). This is the same rule for every other entry, and the
// reason it is a separate script rather than a flag on that one is scope: the browser
// rule is "every spec, in browser-ONLY packages"; this one is "every spec, in every
// package, through ANY of its entries".
//
// WHAT REACHABILITY MEANS, and why it is not "is imported by the entry"
//
// A spec may be imported by another SPEC — `packages/node/fs/src/capabilities.spec.ts`
// is a shared helper for six of them, `packages/node/child_process/src/commands.spec.ts`
// for two. Those are registered, transitively, and a rule that only looked at entries
// would report seven false violations on the day it landed. So the set is closed over
// spec-to-spec imports, starting from every `src/test*.mts` the package has: the node
// entry, the browser entry, the node-gi entry, whatever else appears. One reachable
// path is enough — a spec belonging to the browser leg is not orphaned by being absent
// from the node leg.
//
// Import specifiers are resolved the way the bundler resolves them, which means BOTH
// spellings have to work: `'./x.spec.js'` (TS's ESM form, most of the repo) and
// `'./x.spec'` (extensionless, `packages/web/dom-events`). Matching on the string
// `.spec.js'` alone reports dom-events' four specs as orphans; that was the first
// version of this script and it was wrong in exactly the direction that trains people
// to ignore it.
//
// Files are found by WALKING `src/`, never by a glob: a glob is blind to the first spec
// that lands in a subdirectory, and going blind is the failure this file removes.
//
// Usage: node scripts/check-node-test-registration.mjs [--root <dir>]

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
if (rootFlag !== -1 && args[rootFlag + 1] === undefined) {
    console.error('check-node-test-registration: --root needs a directory.');
    process.exit(2);
}
const ROOT =
    rootFlag === -1
        ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
        : resolve(process.cwd(), args[rootFlag + 1]);

/** Directories that never hold first-party sources. */
const SKIP = new Set(['node_modules', 'dist', 'lib', '.git', 'refs', 'tmp']);

function walk(dir, match, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, match, out);
        else if (match(entry.name)) out.push(full);
    }
    return out;
}

/** Every directory holding a `package.json`, without descending into one. */
function packages(dir, out = []) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (SKIP.has(entry.name) || !entry.isDirectory()) continue;
        const full = join(dir, entry.name);
        if (existsSync(join(full, 'package.json'))) out.push(full);
        else packages(full, out);
    }
    return out;
}

/**
 * The spec files one module imports, as absolute paths.
 *
 * Only relative specifiers are followed: a spec reached through a PACKAGE name is a
 * published entry point, not this package's own test file, and resolving those would
 * need the module graph rather than a regex.
 */
function importedSpecs(file) {
    const text = readFileSync(file, 'utf-8');
    const out = [];
    for (const match of text.matchAll(/from\s+'(\.[^']+)'|import\s*\(\s*'(\.[^']+)'/g)) {
        const specifier = match[1] ?? match[2];
        const candidate = resolveToSource(specifier);
        if (!candidate.endsWith('.spec.ts')) continue;
        const target = resolve(dirname(file), candidate);
        if (existsSync(target)) out.push(target);
    }
    return out;
}

/**
 * A relative specifier as the file on disk.
 *
 * THREE spellings are in use and all three appear in test entries: `'./x.spec.js'`
 * (TS's ESM form, most of the repo), `'./x.spec'` (extensionless,
 * `packages/web/dom-events`) and `'./x.spec.ts'` (verbatim,
 * `packages/infra/tsc`). Handling only the first two reported that last package's one
 * spec as an orphan while it ran on every PR — a false violation is how a checker
 * teaches people to ignore it.
 */
function resolveToSource(specifier) {
    if (specifier.endsWith('.ts')) return specifier;
    if (specifier.endsWith('.js')) return `${specifier.slice(0, -3)}.ts`;
    return `${specifier}.ts`;
}

/**
 * `src/test.mts`, `src/test.browser.mts`, `src/test.node-gi.mts` — and `src/test.ts`,
 * which `packages/node/url` and `packages/node/util` use for the same job. Both
 * extensions, or those two packages' node specs are reported as orphans while they run
 * on every PR.
 */
function isTestEntry(name) {
    if (!name.startsWith('test') || name.endsWith('.spec.ts')) return false;
    return name.endsWith('.mts') || name.endsWith('.ts');
}

const violations = [];
let packagesChecked = 0;
let specsChecked = 0;

for (const pkg of packages(join(ROOT, 'packages'))) {
    const src = join(pkg, 'src');
    if (!existsSync(src) || !statSync(src).isDirectory()) continue;
    const entries = readdirSync(src).filter(isTestEntry);
    if (entries.length === 0) continue;

    const specs = walk(src, (name) => name.endsWith('.spec.ts'));
    if (specs.length === 0) continue;
    packagesChecked++;
    specsChecked += specs.length;

    // Closed over spec-to-spec imports: a helper spec is registered by whoever uses it.
    const reachable = new Set();
    const queue = entries.map((name) => join(src, name));
    while (queue.length > 0) {
        for (const target of importedSpecs(queue.pop())) {
            if (reachable.has(target)) continue;
            reachable.add(target);
            queue.push(target);
        }
    }

    for (const spec of specs.sort()) {
        if (!reachable.has(spec)) violations.push({ spec: relative(ROOT, spec), entries });
    }
}

if (violations.length > 0) {
    console.error('check-node-test-registration: spec files no test entry reaches.\n');
    for (const { spec, entries } of violations) {
        console.error(`  ${spec}`);
        console.error(`      not imported by, or through, any of: ${entries.join(', ')}`);
    }
    console.error(
        '\nA spec that no entry imports never runs, and nothing else in the repository will\n' +
            'say so — it stays on disk and stays type-checked. Add it to the `run({…})` call in\n' +
            'the entry it belongs to, or delete it if what it asserts is covered elsewhere.\n',
    );
    process.exit(1);
}

console.log(
    `check-node-test-registration: ${specsChecked} spec file(s) across ${packagesChecked} package(s) ` +
        'all reach a test entry.',
);
