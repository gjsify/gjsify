#!/usr/bin/env node
// The source paths `affected.gjs.mjs` is actually built from — computed, not listed.
//
// WHY (#1149). The pre-commit hook decided whether to rebuild that bundle from four
// hand-maintained paths, over a `--app gjs` build that inlines the WHOLE workspace-dep
// closure. Its own header was honest that this is best-effort, and CI's
// `verify-committed-bundles.mjs` is the invariant — but the gap was not free: a commit
// touching a closure package the list did not name committed a stale bundle, and the
// cost landed as a CI round-trip.
//
// MEASURED before widening it, because "the bundle inlines half the tree" sounds like a
// trigger that would fire on everything:
//
//   closure of @gjsify/cli:            111 of 201 workspace packages (55%)
//   over the last 60 commits — fired:   21 (four-path list)
//                              would:   26 (real closure)
//                    silently stale:     5
//
// So correctness costs +5 firings per 60 commits, not "most commits". The 55% is an
// upper bound on packages, not on how often they are touched. Five wasted CI rounds
// bought back for five local rebuilds is the trade this makes.
//
// Prints one path per line, for `git diff --cached -- $(…)`. Pure package.json reads:
// no build, no install, no resolver.
//
// Usage: node scripts/affected-bundle-closure.mjs [--root <dir>]

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
const ROOT = rootFlag === -1 ? join(dirname(fileURLToPath(import.meta.url)), '..') : args[rootFlag + 1];

/** The package whose `--app gjs` bundle is committed. */
const ENTRY = '@gjsify/cli';

/**
 * Paths inlined from a BUILT directory rather than from `src/`, so a `src/` rule would
 * miss them. `resolve-npm` is bundled from its `lib/`, which is why the old list named
 * that path specifically — the reasoning was right, it was just not applied to the rest.
 */
const BUILT_INPUTS = ['packages/infra/resolve-npm/lib'];

const manifests = execFileSync('git', ['ls-files', '--', 'packages/*/*/package.json'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
})
    .trim()
    .split('\n')
    .filter(Boolean);

/** name → directory, and name → its workspace dependencies. */
const dirOf = new Map();
const depsOf = new Map();
for (const rel of manifests) {
    let pkg;
    try {
        pkg = JSON.parse(readFileSync(join(ROOT, rel), 'utf8'));
    } catch {
        continue;
    }
    if (!pkg.name) continue;
    dirOf.set(pkg.name, rel.replace(/\/package\.json$/, ''));
    // Optional deps count: the bundle inlines whatever resolves, and a platform package
    // that is present locally is present in the build.
    depsOf.set(
        pkg.name,
        Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).filter((n) =>
            n.startsWith('@gjsify/'),
        ),
    );
}

if (!depsOf.has(ENTRY)) {
    process.stderr.write(`affected-bundle-closure: ${ENTRY} not found among ${manifests.length} manifests.\n`);
    process.exit(1);
}

const closure = new Set();
const stack = [ENTRY];
while (stack.length > 0) {
    const name = stack.pop();
    if (closure.has(name) || !depsOf.has(name)) continue;
    closure.add(name);
    for (const dep of depsOf.get(name)) stack.push(dep);
}

const paths = [];
for (const name of closure) {
    const dir = dirOf.get(name);
    if (!dir) continue;
    paths.push(`${dir}/src`);
    paths.push(`${dir}/package.json`);
}
paths.push(...BUILT_INPUTS);

process.stdout.write(`${paths.sort().join('\n')}\n`);
