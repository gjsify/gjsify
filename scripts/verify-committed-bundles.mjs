#!/usr/bin/env node
/**
 * Guard: every COMMITTED generated artifact must be reproducible from the
 * sources in the SAME commit.
 *
 * The repo tracks a handful of build outputs as version-locked artifacts —
 * `packages/infra/cli/dist/{cli,affected}.gjs.mjs`, `packages/infra/tsc/dist/
 * tsc.gjs.mjs` and `@gjsify/tsc`'s shipped `lib/lib*.d.ts` — because CI and
 * downstream consumers bootstrap off them without a build step.
 *
 * Until now CI only checked that a bundle RUNS and REPORTS the expected
 * version string (`.github/actions/gjsify-setup/action.yml`). That is a weak
 * check with a proven failure mode: a bundle built from OLD source still
 * reports the right version, so it passes. It happened — #821 changed the
 * curated browser aliases in `packages/infra/resolve-npm/lib/index.mjs`, data
 * the bundles INLINE, and merged fully green with both `dist/*.gjs.mjs` still
 * carrying the old table; #825 had to rebuild them after the fact.
 *
 * `.githooks/pre-commit` is the local mitigation, and it is best-effort by
 * construction — it cannot be the invariant:
 *   - it triggers on FOUR source paths, while `cli.gjs.mjs` inlines the whole
 *     workspace-dep closure (`@gjsify/{tar,semver,buffer,workspace,…}`);
 *   - it SKIPS ITSELF with a warning when no gjsify CLI is reachable — which is
 *     exactly what happened in #821, authored in a worktree with no
 *     `node_modules`;
 *   - `--no-verify` / `SKIP_GJSIFY_HOOKS=1` bypass it, as they should.
 *
 * This check closes that hole the only way that is exhaustive by
 * construction: REBUILD each artifact from source and compare it byte-for-byte
 * against the copy committed at HEAD.
 *
 * Two properties make it trustworthy rather than merely noisy:
 *
 *   - The expected bytes come from `git show HEAD:<path>`, NOT from the
 *     working tree. Earlier steps in the same CI job (`gjsify run build` ends
 *     in `build:gjs-bundle`) rewrite those files in place, so a working-tree
 *     comparison would compare a fresh build against itself and pass without
 *     checking anything.
 *   - The artifact set is DISCOVERED from git (every file committed at HEAD
 *     ending in `.gjs.mjs` under a `dist/` dir, plus the declared directory
 *     groups), not hard-coded. A committed bundle with no rebuild recipe is a
 *     hard error, so a new one cannot silently escape — the same "exhaustive by
 *     construction" reasoning as gjsify-setup's "Re-assert committed sources
 *     over the build cache" step.
 *
 * The rebuild is side-effect-free where it matters: whatever the COMMITTED
 * artifacts contained on entry is restored on exit, pass or fail, so later
 * steps and the build-output cache see exactly the tree they would have seen
 * without this check. Untracked build output the recipes touch on the way
 * (`packages/infra/cli/lib/`) is left rebuilt — it is regenerated from the same
 * sources the job already built, so it is byte-equivalent either way.
 *
 * Run it AFTER a workspace build: the bundle build resolves its workspace deps
 * from their `lib/`.
 *
 * Usage:
 *   node scripts/verify-committed-bundles.mjs            # rebuild + compare
 *   node scripts/verify-committed-bundles.mjs --list     # print the plan only
 *   node scripts/verify-committed-bundles.mjs --keep     # leave the rebuild in place
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const inActions = Boolean(process.env.GITHUB_ACTIONS);

/**
 * How each committed artifact is regenerated, and what it covers.
 *
 * `steps` are `gjsify workspace <name> <script> [flags…]` invocations run in
 * order.
 * `groups` are what gets compared: a `file` group is one exact path; a `dir`
 * group compares the whole matching file SET (so an added/removed file counts
 * as drift, not just changed content).
 * `hint` is what a contributor must run — it is printed verbatim on failure.
 */
const RECIPES = [
    {
        id: '@gjsify/cli',
        steps: [
            // `--with-dependencies` is what makes the comparison mean anything.
            // The bundle INLINES the `lib/esm` of every workspace dep in its
            // production closure, and in CI those come from the build-output
            // cache, whose `restore-keys` fallback can hand back a tree built
            // from a DIFFERENT source revision. Rebuilding the closure first
            // pins the inputs to the sources at HEAD, so a mismatch means the
            // committed bundle is stale — never that the cache was warm in an
            // unlucky way. It also makes `build:gjs-bundle`'s `node
            // lib/index.js` entry exist, the same two-step the pre-commit hook
            // does.
            ['@gjsify/cli', 'build', '--with-dependencies'],
            ['@gjsify/cli', 'build:gjs-bundle'],
            ['@gjsify/cli', 'build:affected-bundle'],
        ],
        groups: [
            { kind: 'file', path: 'packages/infra/cli/dist/cli.gjs.mjs' },
            { kind: 'file', path: 'packages/infra/cli/dist/affected.gjs.mjs' },
        ],
        hint:
            'gjsify workspace @gjsify/cli build --with-dependencies && ' +
            'gjsify workspace @gjsify/cli build:gjs-bundle && ' +
            'gjsify workspace @gjsify/cli build:affected-bundle',
    },
    {
        id: '@gjsify/tsc',
        steps: [['@gjsify/tsc', 'build']],
        // `pickLibSource()` normally KEEPS the committed `lib*.d.ts` (a refresh
        // would race concurrent `gjsify tsc` readers during a parallel build),
        // which would make comparing them a check that cannot fail. Force the
        // regeneration here — this step runs alone, so the race it guards
        // against does not exist, and it turns the version-locked lib set into
        // real coverage: a `TYPESCRIPT_VERSION` bump without regenerated libs
        // is exactly the v0.7.2 `TS6053` cascade.
        env: { GJSIFY_TSC_REFRESH_LIBS: '1' },
        groups: [
            { kind: 'file', path: 'packages/infra/tsc/dist/tsc.gjs.mjs' },
            // Mirrors `isLibFile` in packages/infra/tsc/scripts/build-bundle.mjs
            // — note the bare `lib.d.ts`, which `^lib\..*\.d\.ts$` alone misses.
            { kind: 'dir', path: 'packages/infra/tsc/lib', match: /^lib\.(.*\.)?d\.ts$/ },
        ],
        hint: 'GJSIFY_TSC_REFRESH_LIBS=1 gjsify workspace @gjsify/tsc build',
    },
];

/** @param {string[]} args */
function git(args) {
    return execFileSync('git', ['-c', 'safe.directory=*', ...args], {
        cwd: repoRoot,
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
    });
}

/** Tracked-file bytes at HEAD, or `null` when the path is not tracked there. */
function headBytes(relPath) {
    const r = spawnSync('git', ['-c', 'safe.directory=*', 'show', `HEAD:${relPath}`], {
        cwd: repoRoot,
        maxBuffer: 256 * 1024 * 1024,
    });
    return r.status === 0 ? r.stdout : null;
}

/**
 * Repo-relative paths COMMITTED AT HEAD matching a pathspec — `ls-tree`, not
 * `ls-files`: the whole check is "does HEAD's artifact match HEAD's source",
 * so the file SET must come from the same revision as the bytes.
 * `refs/` (read-only upstream submodules) never contributes.
 */
function headFiles(pathspec) {
    // `ls-tree` takes path PREFIXES, not wildcards (unlike `ls-files`), so the
    // pathspec is only ever a directory here and any pattern match happens in JS.
    return git(['ls-tree', '-r', '-z', '--name-only', 'HEAD', ...(pathspec ? ['--', pathspec] : [])])
        .split('\0')
        .filter(Boolean)
        .filter((p) => !p.startsWith('refs/'));
}

/** Every committed GJS bundle in the tree — the set the recipes must cover. */
function discoverCommittedBundles() {
    return headFiles('')
        .filter((p) => p.endsWith('.gjs.mjs') && p.split('/').includes('dist'))
        .sort();
}

/** Repo-relative paths a group currently resolves to ON DISK. */
function groupFilesOnDisk(group) {
    if (group.kind === 'file') return existsSync(join(repoRoot, group.path)) ? [group.path] : [];
    const abs = join(repoRoot, group.path);
    if (!existsSync(abs)) return [];
    return readdirSync(abs)
        .filter((name) => group.match.test(name))
        .map((name) => `${group.path}/${name}`)
        .sort();
}

/** Repo-relative paths a group resolves to at HEAD. */
function groupFilesAtHead(group) {
    if (group.kind === 'file') return headBytes(group.path) === null ? [] : [group.path];
    return headFiles(group.path)
        .filter((p) => group.match.test(p.slice(group.path.length + 1)))
        .sort();
}

/** @returns {Map<string, Buffer>} */
function snapshotDisk(paths) {
    const snap = new Map();
    for (const p of paths) snap.set(p, readFileSync(join(repoRoot, p)));
    return snap;
}

/** Put the tree back exactly as `snapshot` found it, dropping anything new. */
function restoreDisk(snapshot, groups) {
    for (const p of groups.flatMap(groupFilesOnDisk)) {
        if (!snapshot.has(p)) rmSync(join(repoRoot, p), { force: true });
    }
    for (const [p, bytes] of snapshot) {
        const abs = join(repoRoot, p);
        mkdirSync(dirname(abs), { recursive: true });
        if (!existsSync(abs) || !readFileSync(abs).equals(bytes)) writeFileSync(abs, bytes);
    }
}

/** Byte offset of the first difference, or -1 when equal. */
function firstDiffOffset(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return i;
    return a.length === b.length ? -1 : n;
}

/** A short, readable window around a byte offset. */
function excerpt(buf, offset) {
    const from = Math.max(0, offset - 40);
    return JSON.stringify(buf.subarray(from, Math.min(buf.length, offset + 40)).toString('utf8'));
}

/**
 * The gjsify CLI to drive the rebuild with. Mirrors `.githooks/pre-commit`:
 * workspace-local shim first (matches the version the workspace declares),
 * then PATH, then the committed GJS bundle (a freshly-cloned tree).
 */
function resolveGjsify() {
    const local = join(repoRoot, 'node_modules', '.bin', 'gjsify');
    if (existsSync(local)) return { cmd: local, args: [] };
    const onPath = spawnSync('sh', ['-c', 'command -v gjsify'], { encoding: 'utf8' });
    if (onPath.status === 0 && onPath.stdout.trim()) return { cmd: onPath.stdout.trim(), args: [] };
    const bundle = join(repoRoot, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
    if (existsSync(bundle)) return { cmd: 'gjs', args: ['-m', bundle] };
    fail('no gjsify CLI found (node_modules/.bin/gjsify, PATH, or the committed bundle) — run `gjsify install`.');
    return process.exit(1);
}

function fail(msg) {
    console.error(inActions ? `::error::${msg}` : `ERROR: ${msg}`);
}

// ── plan ────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const listOnly = args.has('--list');
const keep = args.has('--keep');

const claimed = new Set(RECIPES.flatMap((r) => r.groups.filter((g) => g.kind === 'file').map((g) => g.path)));
const discovered = discoverCommittedBundles();
const unclaimed = discovered.filter((p) => !claimed.has(p));
if (unclaimed.length > 0) {
    fail(
        `committed GJS bundle(s) with no rebuild recipe: ${unclaimed.join(', ')}. ` +
            'Add them to RECIPES in scripts/verify-committed-bundles.mjs so CI can prove they match their source.',
    );
    process.exit(1);
}

console.log(`Committed bundles discovered: ${discovered.length}`);
for (const r of RECIPES) {
    const files = r.groups.flatMap(groupFilesAtHead);
    console.log(`  ${r.id}: ${files.length} artifact(s) via ${r.steps.map((s) => s[1]).join(' → ')}`);
}
if (listOnly) process.exit(0);

// ── rebuild + compare ───────────────────────────────────────────────────

const gjsify = resolveGjsify();
console.log(`Driving rebuilds with: ${gjsify.cmd} ${gjsify.args.join(' ')}`.trim());

let failures = 0;
// Never `process.exit()` while a rebuild is in flight — that skips the
// `finally` that puts the artifacts back, leaving a half-rebuilt tree for the
// rest of the job. Record the intent, unwind, exit at the end.
let aborted = null;

// ONE snapshot of EVERY artifact, taken before ANY build runs — not one per
// recipe. Recipes are not isolated from each other: `@gjsify/cli build
// --with-dependencies` walks the CLI's workspace-dep closure, which contains
// `@gjsify/tsc`, so it rewrites `dist/tsc.gjs.mjs` before the tsc recipe ever
// snapshots it. A per-recipe snapshot then "restores" that rebuild and leaves a
// tracked file modified for the rest of the CI job. The verdicts are unaffected
// (they compare against `git show HEAD:…`, not the snapshot) — only the
// put-it-back step is, and it has to see the pre-run tree.
const allGroups = RECIPES.flatMap((r) => r.groups);
const pristine = snapshotDisk(allGroups.flatMap(groupFilesOnDisk));

try {
    for (const recipe of RECIPES) {
        if (aborted) break;
        const t0 = Date.now();
        for (const [workspace, script, ...flags] of recipe.steps) {
            const label = ['workspace', workspace, script, ...flags].join(' ');
            console.log(`\n[verify-bundles] ${recipe.id}: gjsify ${label}`);
            const r = spawnSync(gjsify.cmd, [...gjsify.args, 'workspace', workspace, script, ...flags], {
                cwd: repoRoot,
                stdio: 'inherit',
                // No `?? {}` — spreading `undefined` into an object literal is
                // already a no-op (oxlint unicorn/no-useless-fallback-in-spread).
                env: { ...process.env, ...recipe.env },
            });
            if (r.status !== 0) {
                aborted = `${recipe.id}: \`gjsify ${label}\` failed (exit ${r.status}).`;
                break;
            }
        }
        if (aborted) continue;

        for (const group of recipe.groups) {
            const expectedPaths = groupFilesAtHead(group);
            const actualPaths = groupFilesOnDisk(group);
            const missing = expectedPaths.filter((p) => !actualPaths.includes(p));
            const extra = actualPaths.filter((p) => !expectedPaths.includes(p));

            for (const p of missing) {
                failures++;
                fail(`${p} is committed but the rebuild did not produce it.`);
            }
            for (const p of extra) {
                failures++;
                fail(`${p} is produced by the build but is NOT committed.`);
            }

            let matched = 0;
            for (const p of expectedPaths.filter((x) => actualPaths.includes(x))) {
                const expected = headBytes(p);
                const actual = readFileSync(join(repoRoot, p));
                if (expected.equals(actual)) {
                    matched++;
                    if (group.kind === 'file') console.log(`  ✓ ${p} (${actual.length} B) reproduces from source`);
                    continue;
                }
                failures++;
                const off = firstDiffOffset(expected, actual);
                fail(
                    `${p} is STALE — rebuilding it from the source at HEAD does not reproduce the committed file.`,
                );
                fail(`  committed: ${expected.length} B · rebuilt: ${actual.length} B · first difference at byte ${off}`);
                console.error(`  committed …${excerpt(expected, off)}…`);
                console.error(`  rebuilt   …${excerpt(actual, off)}…`);
                fail(`  Refresh locally: ${recipe.hint}, then commit it.`);
            }
            if (group.kind === 'dir') {
                console.log(`  ✓ ${group.path}/: ${matched}/${expectedPaths.length} reproduce from source`);
            }
        }
        console.log(`[verify-bundles] ${recipe.id} verified in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    }
} finally {
    // ONE restore, after every recipe — a per-recipe one would undo a rebuild a
    // later recipe still depends on, and `--keep` is the escape hatch for
    // inspecting what was actually produced.
    if (!keep) restoreDisk(pristine, allGroups);
}

if (aborted) {
    fail(aborted);
    process.exit(1);
}

if (failures > 0) {
    fail(
        `${failures} committed artifact(s) do not match their source. A stale bundle still runs and still reports ` +
            'the right version, which is why the version check cannot see this.',
    );
    process.exit(1);
}

console.log('\nAll committed bundles reproduce byte-identically from the source at HEAD.');
