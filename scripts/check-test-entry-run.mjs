#!/usr/bin/env node
// Every test entry reaches `@gjsify/unit`'s `run()`, or its suite cannot fail.
//
// THE INCIDENT
//
// `run()` is where a verdict becomes an exit code: `exitCodeFor(countTestsFailed,
// suiteBodyThrew)` and the `process.exit`/`imports.system.exit` that consume it live inside
// it and nowhere else (`packages/gjs/unit/src/index.ts`). An entry that awaits its spec
// defaults itself — `const _results = { a: await aSpec(), … }` — executes every test, prints
// every red mark, then falls off the end of the module. Node and GJS both exit 0 and the
// package reports green. `scripts/node-gi-consumer-harness.mjs` parses the summary line
// `run()` prints, so such a package can additionally only ever score `ran-no-summary` on
// node/bun/deno.
//
// `@gjsify/webaudio` shipped that shape and #872 fixed it — verified by breaking an assertion
// on purpose, which still exited 0. `@gjsify/gamepad` was found identical and fixed by hand in
// the same sweep. Both entries were then given a comment telling the next author not to do it,
// and a comment is the mechanism this file replaces. `@gjsify/webrtc` had the same shape with
// 17 red tests under it; the sweep missed it, a later branch fixed it, and that branch never
// merged — so the defect outlived two separate corrections. A hand sweep that fixed two of
// three, and a fix that did not stay fixed, are the argument for a check rather than a fourth
// pair of eyes.
//
// WHY A `run(` GREP IS THE WRONG TEST, IN BOTH DIRECTIONS
//
// Too permissive: `loop.run()` and `mainloop.run()` are how this repo starts a GLib main loop,
// and a bare `run(` accepts an entry that only does that. So the name is bound at its IMPORT —
// the local name a `@gjsify/unit` clause introduces for the `run` export — and only a call of
// THAT name, not reached through a member access, counts.
//
// Too strict: a browser entry may own no `run({…})` and delegate wholesale to the sibling that
// does (`export * from './test.mjs'`), which runs the suite and sets the exit code exactly
// once. Every `test.browser.mts` in `packages/node/*` that re-exports its shared entry has this
// shape; a gate reporting them would be accusing correct code, and a gate that fires on correct
// code is one people learn to route around. So a relative import landing on another entry of
// the same package is followed and the question asked there. Whether that re-export shape is
// DESIRABLE for a browser entry is a different question, owned by `tests/AGENTS.md` § Browser
// tests; this file only asks whether the exit code gets set.
//
// Resolution is path arithmetic plus `existsSync` (`resolveToSource`), never the module graph:
// `audit-runtimes.yml` does no install and no build, so anything needing `node_modules` could
// not run there at all.
//
// WHICH FILES ARE ENTRIES — the package's own scripts, not a filename walk
//
// The subject is the set CI BUILDS AND RUNS, so it is read from where that is decided: a
// `gjsify build … --app <target>` in one of the package's own scripts, narrowed to the
// test-entry naming convention so the app builds (`src/index.ts --app gjs`) drop out. Walking
// `src/` for the same names instead finds one extra file — `packages/infra/cli`'s own
// `src/commands/test.ts`, the CLI command, which is not a test entry and would be a permanent
// false accusation. Measured the other way round, the script-derived set misses nothing the
// walk finds: it covers all five entries kept in `src/ts/`, which a flat read of `src/` does
// not. An entry no script builds is deliberately out of scope — nothing runs it, so it cannot
// report a false green.
//
// WHAT THIS DOES NOT ASK
//
// Only whether an entry reaches the runner. Whether every SPEC reaches an entry is
// `check-node-test-registration.mjs`; whether a browser-only package registers all of them is
// `check-browser-test-registration.mjs`. The three compose: specs reach entries, entries reach
// `run()`, and `run()` reaches the exit code.
//
// Usage: node scripts/check-test-entry-run.mjs [--root <dir>]

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isTestEntry, packageDirs, relativeImports, stripComments } from './suite-registration.mjs';

const args = process.argv.slice(2);
const rootFlag = args.indexOf('--root');
if (rootFlag !== -1 && args[rootFlag + 1] === undefined) {
    console.error('check-test-entry-run: --root needs a directory.');
    process.exit(2);
}
const ROOT =
    rootFlag === -1
        ? resolve(dirname(fileURLToPath(import.meta.url)), '..')
        : resolve(process.cwd(), args[rootFlag + 1]);

/**
 * Trees whose packages ship suites CI builds. `showcases/` holds none today and is listed so
 * that the first one to grow an entry is covered on the day it lands, not the day someone
 * remembers this list.
 */
const TREES = ['packages', 'tests', 'examples', 'showcases'];

const RUNNER = '@gjsify/unit';

/** One `gjsify build …` clause per match, cut at the shell operator that ends the command. */
const BUILD_CLAUSE = /\bbuild\b([^&|;]*)/g;
/** A TypeScript source named inside such a clause, quoted or bare. */
const CLAUSE_SOURCE = /(?:^|\s)['"]?([^\s'"]+\.(?:mts|ts|tsx))['"]?/g;

/**
 * The entry files a package's scripts hand to `gjsify build … --app <target>`.
 *
 * `--app` is what separates a runnable bundle from `build:gjsify`'s `--library` pass over the
 * whole of `src/`, which emits modules and runs nothing.
 */
function scriptedEntries(pkgDir) {
    const manifest = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
    const found = new Set();
    for (const command of Object.values(manifest.scripts ?? {})) {
        if (typeof command !== 'string') continue;
        for (const [, clause] of command.matchAll(BUILD_CLAUSE)) {
            if (!/--app\s+\S/.test(clause)) continue;
            for (const [, file] of clause.matchAll(CLAUSE_SOURCE)) {
                if (isTestEntry(basename(file))) found.add(join(pkgDir, file));
            }
        }
    }
    return [...found].filter((file) => existsSync(file));
}

/**
 * The local name(s) `source` binds to the runner's `run` export.
 *
 * The clause is read rather than the string `run` searched for, because `import { run as
 * runSuite }` is legal and would otherwise read as an entry that never calls the runner.
 */
function runnerBindings(source) {
    const names = [];
    const pattern = new RegExp(String.raw`import\s*\{([^}]*)\}\s*from\s*['"]${RUNNER}['"]`, 'g');
    for (const [, clause] of source.matchAll(pattern)) {
        for (const member of clause.split(',')) {
            const alias = /^\s*run\s+as\s+([A-Za-z_$][\w$]*)\s*$/.exec(member);
            if (alias) names.push(alias[1]);
            else if (member.trim() === 'run') names.push('run');
        }
    }
    return names;
}

/** Whether `source` calls one of `names` as a free identifier — `x.run()` does not count. */
const callsAny = (source, names) => names.some((name) => new RegExp(String.raw`(^|[^.\w$])${name}\s*\(`).test(source));

const violations = [];
let entriesChecked = 0;
let packagesChecked = 0;

for (const tree of TREES) {
    const treeDir = join(ROOT, tree);
    if (!existsSync(treeDir)) continue;

    for (const pkg of packageDirs(treeDir)) {
        const entries = scriptedEntries(pkg);
        if (entries.length === 0) continue;
        packagesChecked++;
        entriesChecked += entries.length;

        const isEntry = new Set(entries);
        const sources = new Map(entries.map((entry) => [entry, stripComments(readFileSync(entry, 'utf8'))]));
        const callsRun = new Map(
            entries.map((entry) => [entry, callsAny(sources.get(entry), runnerBindings(sources.get(entry)))]),
        );
        // A re-export entry names its target twice (`export * from './test.mjs'` beside
        // `import './test.mjs'`), so the set is what keeps a violation report from listing
        // the same sibling twice.
        const delegates = new Map(
            entries.map((entry) => [
                entry,
                [
                    ...new Set(
                        relativeImports(entry, sources.get(entry))
                            .map(({ target }) => target)
                            .filter((target) => isEntry.has(target) && target !== entry),
                    ),
                ],
            ]),
        );

        /** Whether `entry` calls the runner, or delegates to a sibling entry that does. */
        const reachesRunner = (entry, seen = new Set()) => {
            if (callsRun.get(entry)) return true;
            if (seen.has(entry)) return false;
            seen.add(entry);
            return delegates.get(entry).some((target) => reachesRunner(target, seen));
        };

        for (const entry of entries.sort()) {
            if (reachesRunner(entry)) continue;
            violations.push({
                entry: relative(ROOT, entry),
                delegates: delegates.get(entry).map((target) => relative(pkg, target)),
            });
        }
    }
}

if (violations.length > 0) {
    console.error('check-test-entry-run: test entries that never reach the runner.\n');
    for (const { entry, delegates } of violations) {
        console.error(`  ${entry}`);
        console.error(
            delegates.length === 0
                ? `      calls no \`run(…)\` from '${RUNNER}', and delegates to no sibling entry`
                : `      calls no \`run(…)\` from '${RUNNER}', and neither does: ${delegates.join(', ')}`,
        );
    }
    console.error(
        '\nA suite that does not reach `run()` executes its tests, prints their results and then\n' +
            'exits 0 — a red assertion reports green, and the per-runtime summary line the node-gi\n' +
            `harness reads is never printed. Import \`run\` from '${RUNNER}' and hand it the suites:\n` +
            '`run({ mySuite, … })`.\n',
    );
    process.exit(1);
}

console.log(
    `check-test-entry-run: ${entriesChecked} test entr(ies) across ${packagesChecked} package(s) ` +
        'all reach the runner.',
);
