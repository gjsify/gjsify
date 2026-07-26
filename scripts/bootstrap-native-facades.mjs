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

import { spawnSync } from 'node:child_process';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

if (!existsSync(cliEntry)) {
    console.error(
        `[bootstrap-native-facades] Node CLI entry not found: ${cliEntry}\n` +
            'Run `gjsify workspace @gjsify/cli build` first (build:infra does this).',
    );
    process.exit(1);
}

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
        console.log(`[bootstrap-native-facades] @gjsify/${name} done in ${((Date.now() - t0) / 1000).toFixed(2)}s`);
    }
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
