#!/usr/bin/env node
/**
 * Guard: every COMMITTED generated artifact must be reproducible from the
 * sources in the SAME commit.
 *
 * TWO JOBS SINCE ADR 0002, and the second is why this script survived the
 * untracking rather than going with it:
 *
 *   1. It still HOLDS `packages/infra/cli/dist/affected.gjs.mjs` and
 *      `@gjsify/tsc`'s shipped `lib/lib*.d.ts`, the two generated things still
 *      committed. `affected.gjs.mjs` is the one that needs holding: the CI
 *      `changes` job boots it before any install and it gates every other job,
 *      so a stale copy does not fail — it silently gates today's PR with an
 *      older commit's tables. Fail-open staleness is the kind a rebuild check
 *      is for.
 *   2. It is the guard that the UNTRACKING STAYS. The artifact set is
 *      discovered from git, and a committed bundle with no rebuild recipe is a
 *      hard error — so re-committing `cli.gjs.mjs` reds CI instead of quietly
 *      reinstating the class ADR 0002 removed.
 *
 * It also still BUILDS `cli.gjs.mjs` and `tsc.gjs.mjs`, which are no longer
 * committed: `main.yml` uploads them as the `bootstrap-bundles-fedora<v>`
 * artifact every downstream job restores. See the `groups` comments — being
 * built-but-ungrouped is what leaves them on disk for that upload.
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
 * It runs on a COLD tree (fresh clone + `gjsify install`, nothing built) as
 * well as a warm one — see `ensureBuildableWorkspace()` below. That is a
 * requirement, not a convenience: `--rebuild` is the release path, and moving
 * releases into CI means running it on a tree that by definition has no build
 * output.
 *
 * Usage:
 *   node scripts/verify-committed-bundles.mjs            # rebuild + compare
 *   node scripts/verify-committed-bundles.mjs --list     # print the plan only
 *   node scripts/verify-committed-bundles.mjs --keep     # leave the rebuild in place
 *   node scripts/verify-committed-bundles.mjs --rebuild  # PRODUCE the artifacts, no compare
 *
 * `--rebuild` is what `.release-it.json`'s `after:bump` hook runs. A release
 * bumps the version, so the artifacts MUST differ from HEAD — comparing would
 * fail by definition. Sharing this file rather than re-spelling the commands in
 * the hook is the point: the release then produces exactly the artifacts CI
 * verifies, using the same workspace CLI and the same `--with-dependencies`
 * input pinning, and a newly-committed bundle is picked up by both at once.
 * (The alternative — a second copy of the recipe in JSON — is what let the
 * v0.24.0 release ship three bundles built by a THREE-RELEASE-OLD global
 * `gjsify` with no dependency closure and only one of them `git add`ed.)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { resolveGjsifySpawn } from './resolve-gjsify.mjs';

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
        // `cli.gjs.mjs` is NOT a group any more (ADR 0002 untracked it), but
        // `build:gjs-bundle` stays in `steps` — the step is what PRODUCES the
        // file for `main.yml`'s `bootstrap-bundles-fedora<v>` artifact, and
        // `build:affected-bundle` needs the same rebuilt closure anyway.
        //
        // That a file is built but ungrouped is load-bearing rather than
        // sloppy: only grouped files are snapshotted and restored, so the two
        // untracked bundles are deliberately LEFT rebuilt on disk for the
        // upload step that follows. Adding them back to `groups` would restore
        // the pre-run bytes and hand downstream jobs a stale bundle.
        groups: [{ kind: 'file', path: 'packages/infra/cli/dist/affected.gjs.mjs' }],
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
            // `tsc.gjs.mjs` left the group set with ADR 0002 — same reasoning as
            // the CLI recipe above; the step still builds it for the artifact.
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

/**
 * Where a mismatching rebuild is kept so it can leave the machine that made it.
 * Mirrors the repo-relative path, so the whole tree can be copied over a
 * checkout verbatim (`cp -r tmp/rebuilt-bundles/. .`).
 */
const REBUILT_DIR = join(repoRoot, 'tmp', 'rebuilt-bundles');
const rebuiltSaved = [];

function saveRebuilt(relPath, bytes) {
    const dest = join(REBUILT_DIR, relPath);
    mkdirSync(dirname(dest), { recursive: true });
    writeFileSync(dest, bytes);
    rebuiltSaved.push(relPath);
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
 * The gjsify CLI to drive one rebuild step with. Mirrors `.githooks/pre-commit`:
 * workspace-local shim first (matches the version the workspace declares), then
 * PATH, then the committed GJS bundle (a freshly-cloned tree).
 *
 * Resolved PER CALL, because on Windows the invocation embeds the arguments:
 * `node_modules/.bin/gjsify` is a shell script Windows cannot execute, its
 * `.cmd` sibling is a batch file `spawn` refuses (CVE-2024-27980), and the only
 * working form is `%COMSPEC% /d /s /c "<shim> <escaped args…>"`. See
 * `scripts/resolve-gjsify.mjs` for the measurements. Before this, `existsSync`
 * said yes to the unexecutable shim and every step here died with `exit null` —
 * `spawnSync` leaves `status` NULL on ENOENT — reporting a rebuild failure for a
 * command that never started. That matters more here than anywhere: this is the
 * check `.githooks/pre-commit` names when it degrades on Windows.
 */
function gjsifyStep(argv) {
    const resolved = resolveGjsifySpawn(repoRoot, argv);
    if (!resolved) {
        fail('no gjsify CLI found (node_modules/.bin/gjsify, PATH, or the committed bundle) — run `gjsify install`.');
        return process.exit(1);
    }
    return resolved;
}

function fail(msg) {
    console.error(inActions ? `::error::${msg}` : `ERROR: ${msg}`);
}

/**
 * Bring the workspace to the point where `gjsify build` can run AT ALL, so
 * this check works on a cold tree.
 *
 * On a fresh clone every recipe here dies at its first step with
 *
 *     gjsify build: no usable bundler engine under GJS —
 *     `@gjsify/rolldown-native` is not loadable …
 *
 * because under GJS the only bundler engine is `@gjsify/rolldown-native`, and
 * that engine's JS facade (`packages/infra/{rolldown,lightningcss}-native/lib/`)
 * is a BUILD OUTPUT `gjsify install` does not produce.
 * `scripts/bootstrap-native-facades.mjs` is what produces it. Nothing used to
 * call it from here — in CI the failure is invisible because `gjsify run build`
 * → `build:infra` runs the bootstrap long before this step.
 *
 * We call it rather than documenting it as a precondition: a script whose
 * documented precondition is "run this other thing first" gets that
 * precondition forgotten, which is exactly how the release path (`--rebuild`
 * from `.release-it.json`'s `after:bump`) ends up unable to run on the cold
 * tree a CI release always has.
 *
 * ONE entry point. The bootstrap has a precondition of its own — it drives the
 * CLI's NODE entry (`packages/infra/cli/lib/index.js`, the one emitter that
 * needs no bundler), which is itself a build output — but it now satisfies that
 * precondition ITSELF on a cold tree by running root `build:infra` (the
 * documented tsc chain that produces the entry AND ends in the very same
 * bootstrap). This file used to carry that cold/warm branch; the branch belongs
 * in the bootstrap, where EVERY caller inherits it rather than only this one.
 * The release workflow's `publish-napi` job is the caller that did not, and it
 * is why `@gjsify/napi` missed the v0.24.1 train.
 *
 * Warm is the CI ordering and stays cheap: the bootstrap is mtime-idempotent,
 * so already-built facades are skipped in milliseconds.
 *
 * @returns {string|null} an abort reason, or null on success.
 */
function ensureBuildableWorkspace() {
    const bootstrap = join(repoRoot, 'scripts', 'bootstrap-native-facades.mjs');
    const label = 'node scripts/bootstrap-native-facades.mjs';

    console.log(`\n[verify-bundles] preflight: ${label}`);
    const r = spawnSync(process.execPath, [bootstrap], { cwd: repoRoot, stdio: 'inherit', env: process.env });
    if (r.status === 0) return null;
    return (
        `preflight: \`${label}\` failed (exit ${r.status}). Without it the GJS bundler engine ` +
        '(`@gjsify/rolldown-native`) has no built JS facade and every rebuild below fails with ' +
        '"no usable bundler engine under GJS". Fix that build first, then re-run this check.'
    );
}

// ── plan ────────────────────────────────────────────────────────────────

const args = new Set(process.argv.slice(2));
const listOnly = args.has('--list');
// `--rebuild` PRODUCES the artifacts (release hook); it implies `--keep`, since
// restoring the pre-run bytes would undo exactly what it was asked to do.
const rebuildOnly = args.has('--rebuild');
const keep = args.has('--keep') || rebuildOnly;

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

// Probe once for the banner. The real invocations are built per step, since on
// Windows the arguments live inside the `cmd.exe /c "…"` line.
{
    const probe = gjsifyStep([]);
    console.log(`Driving rebuilds with: gjsify (via ${probe.via})`);
}

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
    // Cold-tree preflight. Inside the `try` so a failure still unwinds through
    // the restore below, and BEFORE the loop so no recipe ever runs against a
    // workspace that cannot bundle.
    aborted = ensureBuildableWorkspace();

    for (const recipe of RECIPES) {
        if (aborted) break;
        const t0 = Date.now();
        for (const [workspace, script, ...flags] of recipe.steps) {
            const label = ['workspace', workspace, script, ...flags].join(' ');
            console.log(`\n[verify-bundles] ${recipe.id}: gjsify ${label}`);
            const step = gjsifyStep(['workspace', workspace, script, ...flags]);
            const r = spawnSync(step.cmd, step.args, {
                cwd: repoRoot,
                stdio: 'inherit',
                // No `?? {}` — spreading `undefined` into an object literal is
                // already a no-op (oxlint unicorn/no-useless-fallback-in-spread).
                env: { ...process.env, ...recipe.env },
                windowsVerbatimArguments: step.windowsVerbatimArguments,
            });
            if (r.status !== 0) {
                aborted = `${recipe.id}: \`gjsify ${label}\` failed (exit ${r.status}).`;
                break;
            }
        }
        if (aborted) continue;
        if (rebuildOnly) {
            for (const p of recipe.groups.flatMap(groupFilesOnDisk)) {
                if (recipe.groups.some((g) => g.kind === 'file' && g.path === p)) {
                    console.log(`  → wrote ${p} (${readFileSync(join(repoRoot, p)).length} B)`);
                }
            }
            console.log(`[verify-bundles] ${recipe.id} rebuilt in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
            continue;
        }

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
                fail(`${p} is STALE — rebuilding it from the source at HEAD does not reproduce the committed file.`);
                fail(
                    `  committed: ${expected.length} B · rebuilt: ${actual.length} B · first difference at byte ${off}`,
                );
                console.error(`  committed …${excerpt(expected, off)}…`);
                console.error(`  rebuilt   …${excerpt(actual, off)}…`);
                fail(`  Refresh locally: ${recipe.hint}, then commit it.`);
                // …and keep the bytes THIS run produced, because "refresh
                // locally" is not always advice a contributor can take. The
                // historical way that happened — fast-glob's raced entry order
                // leaking into `--library` outputs (`mapSysname` where the
                // committed file had `makeCallable`; see release-cut.yml) — is
                // fixed at the core (`utils/entry-points.ts` sorts each
                // pattern's expansion), but a STALE `lib/esm` built before the
                // fix, or restored from a build cache that predates it, still
                // reproduces the old bytes until the closure is rebuilt. On
                // such a tree the instruction above loops, and the only bytes
                // that satisfy this check are the ones CI builds. Saving them
                // turns a dead end into a download.
                saveRebuilt(p, actual);
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
    if (rebuiltSaved.length > 0) {
        console.error(
            `\nThe ${rebuiltSaved.length} rebuilt artifact(s) THIS run produced were kept under tmp/rebuilt-bundles/:\n` +
                rebuiltSaved.map((p) => `  ${p}`).join('\n') +
                (inActions
                    ? '\n\nCI uploads them as the `rebuilt-bundles` artifact. If your machine cannot reproduce ' +
                      'these bytes (usually a stale pre-entry-order-fix `lib/esm` or build cache — see release-cut.yml), ' +
                      'download it and copy it over your checkout:\n' +
                      '  gh run download <run-id> -n rebuilt-bundles -D tmp/rebuilt-bundles\n' +
                      '  cp -r tmp/rebuilt-bundles/. . && git add -A\n'
                    : '\n\nCompare them against the committed files to see what your machine builds differently.\n'),
        );
    }
    process.exit(1);
}

if (rebuildOnly) {
    console.log('\nAll committed bundles rebuilt from source. Commit them.');
} else {
    console.log('\nAll committed bundles reproduce byte-identically from the source at HEAD.');
}
