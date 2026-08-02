#!/usr/bin/env node
// Bootstraps the JS facades of the GI-bridge bundler engines on a
// truly-zero-cache workspace (fresh clone + install, CI after cache
// eviction, or after `gjsify run clear`):
//
//   - @gjsify/rolldown-native    (packages/infra/rolldown-native/lib/)
//   - @gjsify/lightningcss-native (packages/infra/lightningcss-native/lib/)
//
// Why this script exists (and why it runs under NODE):
//
//   Under GJS, `gjsify build --library` needs the native bundler engine —
//   whose JS facade (`lib/esm/`) is itself a build artifact. Building the
//   facade needs a bundler → circular under GJS. The Node CLI
//   (`packages/infra/cli/lib/index.js`) uses npm `rolldown` instead, so it
//   can build the facades without the facades existing. Spawning
//   `node <cli>/lib/index.js` directly (NOT `gjsify workspace … build`)
//   matters: the inner script chain would resolve `gjsify` from PATH = the
//   GJS-first bin shim, recreating the circularity. Same pattern + rationale
//   as `packages/infra/tsc/scripts/build-bundle.mjs` (commit 857e34742).
//
//   This makes `node` a documented requirement of root `build:infra` — the
//   accepted, established exception (same as @gjsify/tsc's bundle build and
//   @gjsify/cli's build:gjs-bundle, both of which already spawn node).
//
//   BUT that Node CLI is the `lib/**` half of a DUAL-ENTRY package (see
//   AGENTS.md "Bundled-artifact dependency classification"): unlike the
//   committed `dist/cli.gjs.mjs` bundle it is NOT self-contained — it
//   `import`s its runtime deps from node_modules at ESM LINK time. Four of
//   them (`@gjsify/{workspace,semver,npm-registry,tar}`) are built by
//   `build:infra` with `build:types` only, which is `emitDeclarationOnly`
//   and therefore emits `lib/types` but NOT `lib/esm`. On a warm tree
//   `lib/esm` came from the build cache, so this stayed invisible; on a
//   COLD one `node <cli> build --library` died at link time with a raw
//   `ERR_MODULE_NOT_FOUND: …/@gjsify/workspace/lib/esm/index.js` — and
//   because the build then failed, CI never saved a cache, so the next run
//   was cold again. Self-sustaining.
//
//   Both escapes from that cycle presuppose their own output: those four
//   packages' `build:gjsify` is `gjsify build --library`, which under GJS
//   needs the very facade this script produces, and the Node CLI that could
//   build the facade cannot link without those four. So the cycle is broken
//   with the ONE emitter that needs neither: plain `tsc`. That is not a new
//   tool here — it is what `build:infra` ALREADY uses for every other
//   link-time dep of the Node CLI entry (`@gjsify/create-app`,
//   `@gjsify/rolldown-plugin-{gjsify,pnp}`, whose `build` script is literally
//   `tsc`) and for the CLI itself. The four are simply the outliers that were
//   wired to `build:types` instead of a full emit; `buildCliRuntimeDeps()`
//   below restores the symmetry.
//
//   The tsc-emitted `lib/esm` is a BOOTSTRAP artifact, not the shipped one:
//   root `build` runs `gjsify foreach build` after `build:infra`, and these
//   four are not excluded there, so their `build:gjsify` re-emits `lib/esm`
//   with Rolldown. The only behavioural delta in between is the compile-time
//   `__PACKAGE_VERSION__` define Rolldown applies to `@gjsify/npm-registry`,
//   which its source already reads defensively
//   (`typeof __PACKAGE_VERSION__ === 'string' ? … : '0.0.0-dev'`), so the
//   bootstrap output runs — it just reports the dev user-agent until the
//   real build re-emits.
//
// Wired into root package.json `build:infra` right after
// `gjsify workspace @gjsify/cli build` (which produces the Node CLI entry
// via plain tsc) and before the first `gjsify build --library` consumer
// (`@gjsify/utils`).
//
// Skips a facade (and a CLI runtime dep) when its lib/ output already exists
// AND is newer than everything under its src/ — a full rebuild is only
// ~10-20 s, but skipping keeps warm-cache `build:infra` runs fast.
//
// SELF-SUFFICIENT ON A COLD TREE. The Node CLI entry it spawns is itself a
// build output, so on a fresh clone / a CI job that only installed, this script
// first runs `gjsify run build:infra` to produce it rather than telling the
// caller to (see `ensureNodeCliEntry`). That is not a convenience: a script
// whose whole purpose is bootstrapping a cold tree must not have a
// precondition that only a cold tree can fail.

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGjsifySpawn } from './resolve-gjsify.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const cliEntry = join(root, 'packages', 'infra', 'cli', 'lib', 'index.js');
const nodeRequire = createRequire(import.meta.url);

const FACADES = ['rolldown-native', 'lightningcss-native'];

// `packages/infra/<name>` packages that the Node CLI entry imports STATICALLY
// (so they must exist as `lib/esm/**` before `node <cli> …` can even link) and
// that `build:infra` builds with `build:types` (declarations only) beforehand.
// Every OTHER link-time dep of the CLI entry is already fully tsc-built by an
// earlier `build:infra` step. Drift is caught by `ensureCliEntryLinks()`.
const CLI_RUNTIME_DEPS = ['workspace', 'semver', 'npm-registry', 'tar'];

// `--print-plan` reports the cold/warm decision and exits WITHOUT spawning
// anything. The cold branch runs a multi-minute `build:infra`, so this is how
// the e2e suite pins the decision (and the recursion guard) down cheaply —
// pointing the script at a fixture root by copying it to `<fixture>/scripts/`,
// since `root` is derived from the script's own location.
const printPlanOnly = process.argv.includes('--print-plan');

// Set on the `build:infra` child this script may spawn below, so the nested
// `node scripts/bootstrap-native-facades.mjs` that `build:infra` itself ends
// with cannot recurse back into spawning another one.
const NO_RECURSE_ENV = 'GJSIFY_BOOTSTRAP_NO_BUILD_INFRA';

/**
 * Resolve the `gjsify` bin for a spawn: the workspace-local shim first (it is
 * the version this tree pins), PATH second (a fresh clone whose install has not
 * written `.bin` yet), the committed GJS bundle last (works with nothing
 * installed at all, which is the case this whole script exists for).
 *
 * Shared with `verify-committed-bundles.mjs` — see
 * `scripts/resolve-gjsify.mjs`. This site is the one that hurt on Windows:
 * `existsSync` says yes to `node_modules/.bin/gjsify`, which is the sh member of
 * npm's shim trio and the one Windows cannot execute, so `spawnSync` returned
 * ENOENT with a NULL status and the guard below reported "`gjsify run
 * build:infra` failed (exit null)" — naming a build that never started, on the
 * documented recovery path for a cold tree.
 */
function resolveGjsifyCommand(argv) {
    return resolveGjsifySpawn(root, argv) ?? { cmd: 'gjsify', args: [...argv] };
}

/**
 * Make sure the Node CLI entry this script SPAWNS actually exists.
 *
 * `packages/infra/cli/lib/index.js` is a build output, so on a COLD tree —
 * fresh clone, or a CI job that only ran `gjsify install --immutable` — it is
 * absent and this script used to exit 1 with "run `gjsify workspace @gjsify/cli
 * build` first". That instruction is correct and was still a defect: the script
 * documents itself as the fresh-clone bootstrap, and every caller that reached
 * it on a cold tree had to know to run something else first. One did not — the
 * release workflow's `publish-napi` job — so `@gjsify/napi` was the single
 * package the v0.24.1 release failed to publish, on a job that had just done a
 * clean checkout + install by design.
 *
 * `verify-committed-bundles.mjs` already carried exactly this fallback in its
 * own preflight. Having it HERE is the difference between one caller being
 * correct and every caller being correct.
 *
 * `build:infra` is the documented cold-tree chain and ends by running this very
 * script, so the recursion is cut two ways: the child is marked (a nested run
 * refuses to spawn again) and by the time the child reaches its own bootstrap
 * step, `gjsify workspace @gjsify/cli build` has already produced the entry.
 */
function ensureNodeCliEntry() {
    if (existsSync(cliEntry)) {
        if (printPlanOnly) {
            console.log('[bootstrap-native-facades] plan: warm — Node CLI entry present, building facades directly');
            process.exit(0);
        }
        return;
    }

    if (printPlanOnly && process.env[NO_RECURSE_ENV] !== '1') {
        console.log('[bootstrap-native-facades] plan: cold — no Node CLI entry, would run `gjsify run build:infra`');
        process.exit(0);
    }

    if (process.env[NO_RECURSE_ENV] === '1') {
        console.error(
            `[bootstrap-native-facades] Node CLI entry still not found after \`gjsify run build:infra\`: ${cliEntry}\n` +
                'That chain builds it with `gjsify workspace @gjsify/cli build` — check that step for the real error.',
        );
        process.exit(1);
    }

    const { cmd, args, windowsVerbatimArguments } = resolveGjsifyCommand(['run', 'build:infra']);
    console.log(
        `[bootstrap-native-facades] cold tree — no ${cliEntry}\n` +
            '[bootstrap-native-facades] running `gjsify run build:infra` to produce it…',
    );
    const r = spawnSync(cmd, args, {
        cwd: root,
        stdio: 'inherit',
        env: { ...process.env, [NO_RECURSE_ENV]: '1' },
        windowsVerbatimArguments,
    });
    if (r.status !== 0) {
        console.error(
            `[bootstrap-native-facades] \`gjsify run build:infra\` failed (exit ${r.status}${r.signal ? `, signal ${r.signal}` : ''}).\n` +
                'Without it the Node CLI entry does not exist and no facade can be built.',
        );
        process.exit(r.status ?? 1);
    }
    if (!existsSync(cliEntry)) {
        console.error(
            `[bootstrap-native-facades] \`gjsify run build:infra\` succeeded but ${cliEntry} is still missing.`,
        );
        process.exit(1);
    }
    // `build:infra` ends by running this script, so the facades are built too —
    // the loop below then no-ops on mtime.
}

ensureNodeCliEntry();

/** Newest mtime (ms) of any file under dir, recursively. 0 when dir is missing/empty. */
function newestMtime(dir) {
    if (!existsSync(dir)) return 0;
    let newest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        const t = entry.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs;
        if (t > newest) newest = t;
    }
    return newest;
}

/** True when `out` exists and is at least as new as everything under `srcDir`. */
function isFresh(out, srcDir) {
    return existsSync(out) && statSync(out).mtimeMs >= newestMtime(srcDir);
}

/**
 * Emit `lib/esm` (+ `lib/types`) for the CLI's link-time runtime deps with
 * plain `tsc`, so the Node CLI entry spawned below can actually link.
 *
 * `tsconfig.build.json` is `emitDeclarationOnly` on purpose — `lib/esm` is the
 * bundler's to own in a normal build — so the flag is overridden here rather
 * than in the config: this is the bootstrap emit, and the real `build:gjsify`
 * overwrites it later in root `build`.
 */
function buildCliRuntimeDeps() {
    let tscBin = null;
    for (const name of CLI_RUNTIME_DEPS) {
        const pkgDir = join(root, 'packages', 'infra', name);
        const srcDir = join(pkgDir, 'src');
        const libEntry = join(pkgDir, 'lib', 'esm', 'index.js');
        if (isFresh(libEntry, srcDir)) {
            console.log(`[bootstrap-native-facades] @gjsify/${name}: lib/esm up to date — skipping`);
            continue;
        }

        if (tscBin === null) {
            try {
                tscBin = nodeRequire.resolve('typescript/bin/tsc');
            } catch {
                console.error(
                    '[bootstrap-native-facades] `typescript` is not installed, but the Node CLI entry ' +
                        `needs @gjsify/${name}'s lib/esm to link.\n` +
                        'Run `gjsify install` (typescript is a root devDependency — the same one ' +
                        '`gjsify workspace @gjsify/cli build` uses).',
                );
                process.exit(1);
            }
        }

        const t0 = Date.now();
        console.log(`[bootstrap-native-facades] building @gjsify/${name} lib/esm via tsc…`);
        runTsc(tscBin, pkgDir, name);

        // POST-CONDITION, not decoration. An exit code of 0 does not mean tsc
        // WROTE anything: with `composite`/`incremental`, a `.tsbuildinfo` that
        // outlived its emit tree makes tsc consider the project up to date, so
        // it prints nothing, emits nothing and exits 0. This script's whole job
        // is to make the Node CLI entry linkable, and that failure mode reports
        // "done" while leaving it unlinkable — the caller then dies much later
        // with a bare `ERR_MODULE_NOT_FOUND` naming a path nothing explains.
        // Same class `verify-package-outputs.mjs` exists to catch, checked here
        // because this runs long before that post-build sweep.
        if (!existsSync(libEntry)) {
            const stale = buildInfoFiles(pkgDir);
            if (stale.length === 0) {
                console.error(
                    `[bootstrap-native-facades] tsc exited 0 but produced no ${libEntry}, and there is no ` +
                        "build info to explain it. Check `tsconfig.build.json`'s outDir.",
                );
                process.exit(1);
            }
            console.warn(
                `[bootstrap-native-facades] @gjsify/${name}: tsc exited 0 without emitting — stale build info ` +
                    `(${stale.map((f) => f.slice(pkgDir.length + 1)).join(', ')}); clearing and retrying once.`,
            );
            for (const f of stale) rmSync(f, { force: true });
            runTsc(tscBin, pkgDir, name);
            if (!existsSync(libEntry)) {
                console.error(
                    `[bootstrap-native-facades] @gjsify/${name}: still no ${libEntry} after clearing the build ` +
                        'info. The Node CLI entry cannot link without it.',
                );
                process.exit(1);
            }
        }
        console.log(`[bootstrap-native-facades] @gjsify/${name} done in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    }
}

/** Run the bootstrap `tsc` emit for one package, exiting on a non-zero status. */
function runTsc(tscBin, pkgDir, name) {
    // `--emitDeclarationOnly false` overrides tsconfig.build.json so JS is
    // emitted too; declarations are re-emitted identically (harmless).
    const r = spawnSync(process.execPath, [tscBin, '-p', 'tsconfig.build.json', '--emitDeclarationOnly', 'false'], {
        stdio: 'inherit',
        cwd: pkgDir,
    });
    if (r.status !== 0) {
        console.error(
            `[bootstrap-native-facades] \`tsc -p tsconfig.build.json\` failed in ${pkgDir} ` +
                `(exit ${r.status}${r.signal ? `, signal ${r.signal}` : ''})`,
        );
        process.exit(r.status ?? 1);
    }
}

/**
 * Every `.tsbuildinfo` a package's bootstrap emit could be skipping on.
 *
 * The four CLI runtime deps put theirs in `lib/`, but TypeScript's default
 * derivation (`outDir` + `rootDir`) lands it in the package root and 18 other
 * workspaces point it at `tmp/`, so all three are swept rather than assuming
 * one layout.
 */
function buildInfoFiles(pkgDir) {
    const found = [];
    for (const dir of ['lib', 'tmp', '.']) {
        const abs = join(pkgDir, dir);
        let entries;
        try {
            entries = readdirSync(abs);
        } catch {
            continue;
        }
        for (const entry of entries) {
            if (entry.endsWith('.tsbuildinfo')) found.push(join(abs, entry));
        }
    }
    return found;
}

/**
 * Probe that the Node CLI entry can be LINKED before spawning it for real.
 *
 * Without this, a runtime dep that `CLI_RUNTIME_DEPS` doesn't cover surfaces as
 * a raw `ERR_MODULE_NOT_FOUND` stack from deep inside Node's ESM resolver,
 * attributed to whatever `gjsify build` invocation happened to run first — the
 * exact failure this script now exists to prevent. Runs once, and only on the
 * path that is about to spawn the CLI anyway (~0.3 s), so a fully-warm
 * `build:infra` never pays for it.
 */
let cliEntryChecked = false;
function ensureCliEntryLinks() {
    if (cliEntryChecked) return;
    cliEntryChecked = true;

    const r = spawnSync(process.execPath, [cliEntry, '--version'], { encoding: 'utf8' });
    if (r.status === 0) return;

    const output = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const missing = output.match(/Cannot find module '([^']+)'/)?.[1];
    const importer = output.match(/imported from (\S+)/)?.[1];
    const pkg = missing?.match(/@gjsify\/([a-z0-9-]+)/)?.[1];
    const lines = [`[bootstrap-native-facades] the Node CLI entry cannot be loaded: ${cliEntry}`];
    if (missing) lines.push(`Missing at ESM link time: ${missing}`);
    if (importer) lines.push(`Imported from: ${importer}`);
    if (pkg) {
        lines.push(
            `That is @gjsify/${pkg} — a runtime dependency of the CLI's Node entry whose lib/esm is not built.`,
            `Fix: add '${pkg}' to CLI_RUNTIME_DEPS in scripts/bootstrap-native-facades.mjs (if it lives under ` +
                'packages/infra and is tsc-buildable), or give it a full build step in root package.json ' +
                '`build:infra` BEFORE `gjsify workspace @gjsify/cli build`.',
        );
    } else {
        // Unrecognised failure — surface the probe output verbatim rather than
        // guessing, so the real cause is never swallowed.
        lines.push('Rebuild it with `gjsify workspace @gjsify/cli build`.', output.trim());
    }
    console.error(lines.join('\n'));
    process.exit(1);
}

function run(args, cwd) {
    ensureCliEntryLinks();
    const r = spawnSync(process.execPath, [cliEntry, ...args], { stdio: 'inherit', cwd });
    if (r.status !== 0) {
        console.error(
            `[bootstrap-native-facades] \`node cli ${args.join(' ')}\` failed in ${cwd} ` +
                `(exit ${r.status}${r.signal ? `, signal ${r.signal}` : ''})`,
        );
        process.exit(r.status ?? 1);
    }
}

buildCliRuntimeDeps();

for (const name of FACADES) {
    const pkgDir = join(root, 'packages', 'infra', name);
    const srcDir = join(pkgDir, 'src', 'ts');
    const libEntry = join(pkgDir, 'lib', 'esm', 'index.js');
    const typesEntry = join(pkgDir, 'lib', 'types', 'index.d.ts');

    const fresh =
        existsSync(libEntry) &&
        existsSync(typesEntry) &&
        Math.min(statSync(libEntry).mtimeMs, statSync(typesEntry).mtimeMs) >= newestMtime(srcDir);
    if (fresh) {
        console.log(`[bootstrap-native-facades] @gjsify/${name}: lib/ up to date — skipping`);
        continue;
    }

    const t0 = Date.now();
    console.log(`[bootstrap-native-facades] building @gjsify/${name} facade via node CLI…`);
    run(['build', '--library', 'src/ts/**/*.{ts,js}'], pkgDir);
    run(['tsc'], pkgDir);
    console.log(`[bootstrap-native-facades] @gjsify/${name} done in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
}
