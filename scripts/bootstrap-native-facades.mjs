#!/usr/bin/env node
// Bootstraps the JS facades of the GI-bridge bundler engines on a
// truly-zero-cache workspace (fresh clone + install, CI after cache
// eviction, or after `gjsify run clear`):
//
//   - @gjsify/rolldown-native    (packages/infra/rolldown-native/lib/)
//   - @gjsify/lightningcss-native (packages/infra/lightningcss-native/lib/)
//
// The route differs per host:
//
//   Under NODE, `gjsify build --library` in the WORKSPACE would need the native
//   bundler engine, whose JS facade is itself a build artifact → circular. The
//   Node CLI (`packages/infra/cli/lib/index.js`) uses npm `rolldown` instead, so
//   it builds the facades without them existing. It is spawned as
//   `node <cli>/lib/index.js` and NOT as `gjsify workspace … build` because the
//   inner script chain would resolve `gjsify` from PATH = the GJS-first bin
//   shim, recreating the circularity. Same pattern as
//   `packages/infra/tsc/scripts/build-bundle.mjs`.
//
//   Under GJS there is no npm crate, no Node entry and no circularity: the
//   `gjsify` on PATH was installed by `gjs -m install.mjs` into its OWN prefix,
//   where `installGjsEnginePackages()` put a built `@gjsify/rolldown-native`
//   beside it. This is why `node` is not a requirement of root `build:infra`.
//
//   That Node CLI entry is the non-self-contained half of a dual-entry package
//   (docs/bundled-toolchains.md § Bundled-artifact dependency classification):
//   it `import`s its runtime deps from node_modules at ESM LINK time, and four
//   of them (`@gjsify/{workspace,semver,npm-registry,tar}`) are built by
//   `build:infra` with `build:types`, i.e. `emitDeclarationOnly` — `lib/types`
//   but no `lib/esm`. A warm tree hid this behind the build cache; a COLD one
//   died at link time with `ERR_MODULE_NOT_FOUND:
//   …/@gjsify/workspace/lib/esm/index.js`, and since the build failed CI never
//   saved a cache, so the next run was cold again. Self-sustaining.
//
//   Both obvious escapes presuppose their own output — those four build with
//   `gjsify build --library`, which under GJS needs the facade this script
//   produces, and the Node CLI that could build the facade cannot link without
//   the four. `buildCliRuntimeDeps()` breaks the cycle with the one emitter that
//   needs neither: plain `tsc`, already used for every other link-time dep.
//   Its `lib/esm` is a BOOTSTRAP artifact — root `build` re-emits it with
//   Rolldown afterwards, the only delta being the compile-time
//   `__PACKAGE_VERSION__` define that `@gjsify/npm-registry` reads defensively,
//   so bootstrap output runs and just reports the dev user-agent.
//
// Ordering inside root `build:infra` — after `gjsify workspace @gjsify/cli
// build`, before the first `gjsify build --library` consumer — is MACHINE-CHECKED
// by `scripts/check-build-infra-order.mjs`, because prose did not hold it:
// promoting the four from `build:types` to `build` silently moved the first
// bundler consumer five clauses ahead of this script, invisible under Node and on
// a warm cache, and surfaced as v0.31.0 failing to publish `@gjsify/napi`.
//
// SELF-SUFFICIENT ON A COLD TREE: the Node CLI entry it spawns is itself a build
// output, so this script runs `gjsify run build:infra` to produce it rather than
// telling the caller to (`ensureNodeCliEntry`) — a script for bootstrapping a
// cold tree must not have a precondition only a cold tree can fail.

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

/**
 * Which host is executing this script — the two routes are described in the
 * header.
 *
 * The GJS branch depends on `@gjsify/module`'s `resolveModulePath` refusing a
 * package DIRECTORY: the workspace's own unbuilt `node_modules/@gjsify/
 * rolldown-native` symlink otherwise SHADOWS the built copy in the global prefix.
 *
 * The probe is INLINE rather than imported from
 * `@gjsify/rolldown-plugin-gjsify/runtime` on purpose: that package's `lib/` is a
 * build output and an ESM import of one fails at LINK time, before a single
 * statement of this script runs — on precisely the cold tree this script exists
 * to serve.
 */
const HOST_IS_GJS = typeof globalThis.imports?.gi !== 'undefined';

const FACADES = ['rolldown-native', 'lightningcss-native'];

// `packages/infra/<name>` packages the Node CLI entry imports STATICALLY (so they
// must exist as `lib/esm/**` before `node <cli> …` can link) and that `build:infra`
// only declaration-builds beforehand. Every other link-time dep of the CLI entry
// is already fully tsc-built earlier; drift is caught by `ensureCliEntryLinks()`.
const CLI_RUNTIME_DEPS = ['workspace', 'semver', 'npm-registry', 'tar'];

// `--print-plan` reports the cold/warm decision and exits WITHOUT spawning
// anything: the cold branch runs a multi-minute `build:infra`, so this is how the
// e2e suite pins the decision and the recursion guard down cheaply. It points the
// script at a fixture root by copying it to `<fixture>/scripts/`, since `root` is
// derived from the script's own location.
const printPlanOnly = process.argv.includes('--print-plan');

// Set on the `build:infra` child this script may spawn below, so the nested
// `node scripts/bootstrap-native-facades.mjs` that `build:infra` itself ends
// with cannot recurse back into spawning another one.
const NO_RECURSE_ENV = 'GJSIFY_BOOTSTRAP_NO_BUILD_INFRA';

/**
 * Resolve the `gjsify` bin for a spawn — rungs and their Windows handling live in
 * `scripts/resolve-gjsify.mjs`, shared with `verify-committed-bundles.mjs`.
 *
 * Under GJS, PATH beats the workspace shim (`preferPath`): the CLI this tree pins
 * resolves its bundler engine FROM this tree, and on a cold tree that engine is
 * the artifact we are here to build. The global one brought its own.
 */
function resolveGjsifyCommand(argv) {
    return resolveGjsifySpawn(root, argv, { preferPath: HOST_IS_GJS }) ?? { cmd: 'gjsify', args: [...argv] };
}

/**
 * Make sure the Node CLI entry this script SPAWNS actually exists, building it
 * here rather than telling the caller to.
 *
 * Exiting with "run `gjsify workspace @gjsify/cli build` first" was correct and
 * still a defect: every caller reaching a cold tree had to know that. The release
 * workflow's `publish-napi` job did not, which is why `@gjsify/napi` was the one
 * package the v0.24.1 release failed to publish after a clean checkout + install.
 *
 * `build:infra` ends by running this very script, so the recursion is cut two
 * ways: the child is marked (a nested run refuses to spawn again), and by the time
 * it reaches its own bootstrap step the CLI build has already produced the entry.
 */
function ensureNodeCliEntry() {
    // Under GJS the Node entry is not the tool being used — `run()` and
    // `runTsc()` go through the `gjsify` command instead — so demanding it here
    // would fail the one host that has no way to produce it.
    if (HOST_IS_GJS) {
        if (printPlanOnly) {
            console.log('[bootstrap-native-facades] plan: gjs host — building facades through the `gjsify` command');
            process.exit(0);
        }
        return;
    }

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
 * Emit `lib/esm` (+ `lib/types`) for the CLI's link-time runtime deps with plain
 * `tsc`, so the Node CLI entry spawned below can link.
 *
 * `tsconfig.build.json` stays `emitDeclarationOnly` — `lib/esm` is the bundler's
 * to own in a normal build — so the flag is overridden on the command line here,
 * for this bootstrap emit only.
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

        // Under GJS the compiler is `gjsify tsc` (see runTsc), which needs no
        // resolved bin — and `typescript/bin/tsc` is a Node CJS entry that cannot
        // be spawned there even when installed, so probing for it would turn a
        // working host into a hard exit.
        if (tscBin === null && !HOST_IS_GJS) {
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

        // An exit code of 0 does not mean tsc WROTE anything: with
        // `composite`/`incremental`, a `.tsbuildinfo` that outlived its emit tree
        // makes tsc consider the project up to date — it prints nothing, emits
        // nothing, exits 0, and the caller dies much later with a bare
        // `ERR_MODULE_NOT_FOUND`. Same class `verify-package-outputs.mjs` catches,
        // checked here because this runs long before that post-build sweep.
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
    // `--emitDeclarationOnly false` overrides tsconfig.build.json so JS is emitted
    // too; declarations are re-emitted identically (harmless).
    //
    // The compiler differs per host but the EMIT does not: under GJS this goes
    // through `gjsify tsc`, the bundled TypeScript whose output is verified
    // byte-identical to the npm `tsc` per package — and the only one available
    // there, since `typescript/bin/tsc` is a Node CJS entry.
    const tscArgs = ['-p', 'tsconfig.build.json', '--emitDeclarationOnly', 'false'];
    const { cmd, args, windowsVerbatimArguments } = HOST_IS_GJS
        ? resolveGjsifyCommand(['tsc', ...tscArgs])
        : { cmd: process.execPath, args: [tscBin, ...tscArgs], windowsVerbatimArguments: undefined };
    const r = spawnSync(cmd, args, {
        stdio: 'inherit',
        cwd: pkgDir,
        windowsVerbatimArguments,
    });
    if (r.status !== 0) {
        console.error(
            `[bootstrap-native-facades] @gjsify/${name}: \`${HOST_IS_GJS ? 'gjsify tsc' : 'tsc'} ` +
                `-p tsconfig.build.json\` failed in ${pkgDir} ` +
                `(exit ${r.status}${r.signal ? `, signal ${r.signal}` : ''})`,
        );
        process.exit(r.status ?? 1);
    }
}

/**
 * Every `.tsbuildinfo` a package's bootstrap emit could be skipping on. Three
 * layouts are in use across the workspaces — `lib/`, `tmp/`, and TypeScript's
 * default derivation into the package root — so all three are swept.
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
 * Without this, a runtime dep `CLI_RUNTIME_DEPS` doesn't cover surfaces as a raw
 * `ERR_MODULE_NOT_FOUND` from inside Node's ESM resolver, attributed to whatever
 * `gjsify build` ran first. Runs once, only on the path about to spawn the CLI
 * anyway (~0.3 s), so a fully-warm `build:infra` never pays for it.
 */
let cliEntryChecked = false;
function ensureCliEntryLinks() {
    if (cliEntryChecked) return;
    cliEntryChecked = true;

    // Nothing to probe under GJS: the builds go through the `gjsify` command,
    // not through the Node entry whose link-time deps this checks.
    if (HOST_IS_GJS) return;

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

/**
 * Run one CLI invocation. Returns `true` on success; on failure it reports,
 * schedules the exit, and returns `false` so the CALLER stops.
 *
 * The boolean WAS load-bearing, and the incident is why it stays. Under GJS
 * `process.exit()` used to SCHEDULE the syscall on a GLib idle source and RETURN
 * (`@gjsify/process`'s `exitProcess`), so a bare exit here stopped nothing — a
 * failed facade build still printed "done in 3.09s" and attempted the second
 * facade. Right exit code, every following line a lie.
 *
 * `exitProcess` no longer returns: it drives the default main context until the
 * scheduled exit fires (`tests/e2e/process-exit-terminates`). So this is now
 * belt-and-braces rather than the repair. Kept because it is also the right
 * shape under Node and costs one boolean — but it is no longer the thing
 * standing between a failed build and a log that lies about it.
 */
function run(args, cwd) {
    ensureCliEntryLinks();
    const spec = HOST_IS_GJS
        ? resolveGjsifyCommand(args)
        : { cmd: process.execPath, args: [cliEntry, ...args], windowsVerbatimArguments: undefined };
    const r = spawnSync(spec.cmd, spec.args, {
        stdio: 'inherit',
        cwd,
        windowsVerbatimArguments: spec.windowsVerbatimArguments,
    });
    if (r.status !== 0) {
        console.error(
            `[bootstrap-native-facades] \`${HOST_IS_GJS ? 'gjsify' : 'node cli'} ${args.join(' ')}\` failed in ${cwd} ` +
                `(exit ${r.status}${r.signal ? `, signal ${r.signal}` : ''})`,
        );
        process.exit(r.status ?? 1);
        return false;
    }
    return true;
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
    console.log(
        `[bootstrap-native-facades] building @gjsify/${name} facade via ${HOST_IS_GJS ? '`gjsify`' : 'node CLI'}…`,
    );
    // `break`, not `continue`: `run()` has already scheduled a non-zero exit, and
    // under GJS that exit does not stop us — see its docblock.
    if (!run(['build', '--library', 'src/ts/**/*.{ts,js}'], pkgDir)) break;
    if (!run(['tsc'], pkgDir)) break;
    console.log(`[bootstrap-native-facades] @gjsify/${name} done in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
}
