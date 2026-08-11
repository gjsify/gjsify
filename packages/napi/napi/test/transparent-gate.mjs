// SPDX-License-Identifier: MIT
// @gjsify/napi — TRANSPARENT ADDON GATE. End-to-end proof that
// `napiNodeAddonPlugin` (packages/infra/rolldown-plugin-gjsify) auto-resolves a
// real npm native addon's compiled `.node` WITHOUT a hand-pinned addonPath.
//
//   node test/transparent-gate.mjs <addon-name>
//
// Difference from the pinned baseline (addon-gate.mjs): no `.gjsifyrc.mjs`
// writing `nodeAddonResolver({ addonPath })`. The plugin is ALWAYS-ON for
// `--app gjs`; it intercepts the addon's OWN acquisition helper
// (`node-gyp-build` / `bindings` / a napi-rs platform sibling) and routes the
// `.node` it would load through `loadAddon()`. The gate still aliases the
// addon's bare specifier to its NATIVE entry and hides `prebuilds/` so BOTH
// runtimes load the same source-built `.node`; then the SAME workout runs on
// Node (golden) and on GJS-under-shim and the two stdouts are byte-diffed.
// Exit 0 only on byte-identical.
//
// `@gjsify/napi` is made resolvable by BARE specifier (a symlink into the
// addons prefix — the `gjsify install @gjsify/napi` stand-in), so the shim's
// `require('@gjsify/napi')` resolves + bundles exactly as in a real consumer.

import { execFileSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    lstatSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    realpathSync,
    renameSync,
    rmSync,
    symlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDONS } from './addon-matrix.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../test
const PKG = resolve(HERE, '..'); // .../packages/napi/napi
const ROOT = resolve(PKG, '..', '..', '..'); // gjsify repo root

function resolveRealpath(p) {
    try {
        return realpathSync(p);
    } catch {
        return p;
    }
}
function resolveCli() {
    if (process.env.GJSIFY_CLI_ENTRY) return process.env.GJSIFY_CLI_ENTRY;
    const inTree = join(ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
    if (existsSync(inTree)) return inTree;
    const nm = join(ROOT, 'node_modules');
    if (existsSync(nm)) {
        const viaSymlink = join(resolveRealpath(nm), '..', 'packages', 'infra', 'cli', 'lib', 'index.js');
        if (existsSync(viaSymlink)) return viaSymlink;
    }
    return inTree;
}
const CLI = resolveCli();
const runGjsify = (args, opts) => execFileSync(process.execPath, [CLI, ...args], opts);

/**
 * How the gate DRIVES `gjsify build`. Default is the Node CLI entry (npm
 * `rolldown`); `GJSIFY_GATE_ENGINE=gjs` drives the in-repo
 * `packages/infra/cli/dist/cli.gjs.mjs` instead, i.e.
 * `@gjsify/rolldown-native`.
 *
 * The engine is not an implementation detail for this gate, it is a distinct
 * risk surface, and the interception had NO coverage on it. Two of the six
 * defects fixed in #840 were engine-specific and invisible to a Node-driven
 * build:
 *
 *   - the native engine hands hook payloads across a JSON boundary, so "no
 *     importer" arrives as `null` rather than `undefined` — every guard was
 *     `=== undefined`, and `dirname(null)` failed the whole build as an
 *     UNHANDLEABLE_ERROR;
 *   - the plugin's `filter` is handed to the Rust core as an `idFilter` STRING,
 *     and Rust's `regex` supports neither lookaround nor `\0` — it rejects the
 *     WHOLE pattern rather than one branch, silently disabling every
 *     interception under GJS while npm `rolldown` keeps working.
 *
 * Driving the IN-REPO bundle is deliberate: it carries the plugin code of the
 * commit under test, which the published CLI cannot — that one ships the LAST
 * RELEASE's `napiNodeAddonPlugin`, so a PR changing it would measure nothing.
 *
 * ADR 0002 untracked this file (it used to be committed, kept fresh by the
 * pre-commit hook and proved reproducible by `verify-committed-bundles`), so
 * producing it is now the CALLER's job — see napi.yml's "Build
 * @gjsify/create-app, then the CLI's GJS bundle" step in the better-sqlite3
 * consumer job. This gate does NOT build it, and deliberately does not fall
 * back to the Node driver when it is absent: that would retire the GJS path
 * while reporting green — the false green the six #840 defects rode in on.
 *
 * The prebuild env must be exported BEFORE the process starts: the typelib
 * lookup happens inside the GJS runtime, so the CLI cannot repair it from the
 * inside (see `bundler-pick.ts`'s diagnostic for the same trap).
 */
function resolveBuildDriver() {
    if ((process.env.GJSIFY_GATE_ENGINE ?? 'node') !== 'gjs') {
        return { cmd: process.execPath, pre: [CLI], env: {}, label: 'node/npm-rolldown' };
    }
    const bundle = join(ROOT, 'packages', 'infra', 'cli', 'dist', 'cli.gjs.mjs');
    if (!existsSync(bundle))
        die(
            `GJSIFY_GATE_ENGINE=gjs but the CLI's GJS bundle is missing: ${bundle} — untracked since ` +
                `ADR 0002, so the CALLER must build it (napi.yml, better-sqlite3 consumer job, ` +
                `"Build @gjsify/create-app, then the CLI's GJS bundle"). Not falling back to the Node ` +
                `driver on purpose: that would report green without exercising @gjsify/rolldown-native.`,
        );
    const prebuilds = [
        join(ROOT, 'packages', 'infra', 'rolldown-native-linux-x64', 'prebuilds', 'linux-x64'),
        join(ROOT, 'node_modules', '@gjsify', 'rolldown-native', 'prebuilds', 'linux-x64'),
        PREBUILD_DIR, // @gjsify/napi's own typelib — the shims resolve it too
    ].filter((d) => existsSync(d));
    const prepend = (name) => [...prebuilds, ...(process.env[name] ? [process.env[name]] : [])].join(':');
    return {
        cmd: 'gjs',
        pre: ['-m', bundle],
        env: { GI_TYPELIB_PATH: prepend('GI_TYPELIB_PATH'), LD_LIBRARY_PATH: prepend('LD_LIBRARY_PATH') },
        label: 'gjs/rolldown-native',
    };
}
const ADDONS_DIR = join(HERE, 'addons');
const NAPI_LIB = join(PKG, 'lib', 'esm', 'index.js');
const PREBUILD_DIR = join(PKG, '..', 'napi-linux-x64', 'prebuilds', 'linux-x64');

const name = process.argv[2];
const cfg = ADDONS[name];
const stage = (m) => console.error(`[transparent:${name}] ${m}`);
const die = (m, code = 1) => {
    console.error(`TRANSPARENT GATE ${name}: FAIL — ${m}`);
    process.exit(code);
};
if (!cfg) die(`unknown addon '${name}'. Known: ${Object.keys(ADDONS).join(', ')}`);

const abs = (p) => (p ? resolve(ADDONS_DIR, p) : null);

// --- resolve the .node (only to validate the source build exists; the PLUGIN
//     auto-locates it — we never pass it as an addonPath) ---
let addonPath = abs(cfg.addon);
if (!addonPath && cfg.binding === 'napi-rs') {
    const pkgDir = resolve(ADDONS_DIR, dirname(cfg.index));
    const hit = existsSync(pkgDir) && readdirSync(pkgDir).find((f) => f.endsWith('.node'));
    if (hit) addonPath = join(pkgDir, hit);
}
const indexJs = abs(cfg.index);
const workout = join(ADDONS_DIR, cfg.workout);

// --- prereqs ---
if (!existsSync(indexJs)) die(`addon entry not installed: ${indexJs} (run test/addons/setup.sh first)`);
if (!addonPath || !existsSync(addonPath)) die(`compiled .node not found: ${addonPath} (build from source first)`);
if (!existsSync(NAPI_LIB)) {
    stage('building @gjsify/napi L1 lib …');
    runGjsify(['build', '--library', 'src/ts/**/*.{ts,js}'], { cwd: PKG, stdio: 'inherit' });
}
// Not committed (`gjsify.platformsUncommitted` on `@gjsify/napi-linux-x64`), so
// on a fresh clone this is the normal state — name the command rather than the
// path alone.
if (!existsSync(PREBUILD_DIR))
    die(
        `shim prebuild dir missing: ${PREBUILD_DIR} — not committed; build it: (cd ${PKG} && gjsify run build:prebuilds)`,
    );

// --- make @gjsify/napi resolvable by BARE specifier from the build graph (the
//     `gjsify install @gjsify/napi` stand-in). The shim emits require('@gjsify/napi');
//     Rolldown must resolve it to PKG's built L1. ---
const napiLinkDir = join(ADDONS_DIR, 'node_modules', '@gjsify');
const napiLink = join(napiLinkDir, 'napi');
function ensureNapiLink() {
    mkdirSync(napiLinkDir, { recursive: true });
    try {
        const st = lstatSync(napiLink);
        if (st.isSymbolicLink() || st.isDirectory()) return;
    } catch {
        /* not present */
    }
    symlinkSync(PKG, napiLink, 'dir');
}
ensureNapiLink();

const tmp = mkdtempSync(join(tmpdir(), `gjsify-napi-transparent-${name}-`));
const bundle = join(tmp, 'workout.gjs.mjs');
const disabled = [];

function cleanup() {
    for (const d of disabled) {
        try {
            renameSync(`${d}.disabled`, d);
        } catch {
            /* ignore */
        }
    }
    try {
        rmSync(tmp, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
}
process.on('exit', cleanup);

function runCapture(cmd, args, opts) {
    try {
        const stdout = execFileSync(cmd, args, { ...opts, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
        return { ok: true, stdout, stderr: '' };
    } catch (e) {
        const timedOut = e.killed && (e.signal === 'SIGKILL' || e.code === 'ETIMEDOUT');
        const stderr = e.stderr ? String(e.stderr) : String(e);
        return {
            ok: false,
            stdout: e.stdout ? String(e.stdout) : '',
            stderr: timedOut ? `${stderr}\n[gate] process TIMED OUT and was killed` : stderr,
            status: e.status,
        };
    }
}

// Every addon here ships a `browser`/`main` field that the `--app gjs` resolver
// (browser-first mainFields) would route to a NON-native entry — bufferutil et al.
// to a pure-JS `fallback.js`, napi-rs to a `.wasm` loader. Pin the NATIVE entry so
// the transparent interception actually exercises the compiled `.node` path. The
// plugin then auto-locates the `.node`: node-gyp-build/bindings via the helper,
// napi-rs via its current-platform sibling (`@scope/pkg-<triple>`).

try {
    // Force both runtimes onto the same source-built .node by hiding prebuilds.
    for (const p of cfg.prebuilds ?? []) {
        const d = abs(p);
        if (existsSync(d)) {
            renameSync(d, `${d}.disabled`);
            disabled.push(d);
        }
    }

    // --- build the GJS bundle (NO .gjsifyrc plugin — napiNodeAddonPlugin is
    //     always-on for --app gjs) ---
    stage('bundling workout for --app gjs (transparent auto-resolution) …');
    const aliases = [`${cfg.pkg}=${indexJs}`, ...(cfg.aliases ?? [])];
    const aliasArgs = aliases.flatMap((a) => ['--alias', a]);
    const driver = resolveBuildDriver();
    stage(`build driver: ${driver.label}`);
    const build = runCapture(
        driver.cmd,
        [...driver.pre, 'build', workout, '--app', 'gjs', '--outfile', bundle, ...aliasArgs],
        {
            cwd: ADDONS_DIR,
            env: { ...process.env, ...driver.env },
        },
    );
    if (!build.ok || !existsSync(bundle)) {
        console.error(build.stderr || build.stdout);
        die('gjsify build failed / produced no bundle');
    }
    // Prove the transparency claim: the bundle routes through loadAddon and imports
    // @gjsify/napi — no residual node-gyp-build/bindings dynamic require survived.
    const src = readFileSync(bundle, 'utf8');
    if (!/loadAddon/.test(src)) die('bundle does not reference loadAddon — interception did not fire');

    // --- golden: Node ---
    stage('running Node golden …');
    const goldenWorkout = join(tmp, 'workout.mjs');
    copyFileSync(workout, goldenWorkout);
    symlinkSync(join(ADDONS_DIR, 'node_modules'), join(tmp, 'node_modules'), 'dir');
    const nodeRes = runCapture(process.execPath, [goldenWorkout], {});
    if (!nodeRes.ok) {
        console.error(nodeRes.stderr);
        die('Node golden failed to run — workout or vendored addon broken');
    }

    // --- GJS under the shim ---
    stage('running GJS-under-shim …');
    const gjsRes = runCapture('gjs', ['-m', bundle], {
        env: { ...process.env, GI_TYPELIB_PATH: PREBUILD_DIR, LD_LIBRARY_PATH: PREBUILD_DIR },
        timeout: 30000,
        killSignal: 'SIGKILL',
    });

    console.error('\n----- Node golden stdout -----');
    console.error(nodeRes.stdout.trimEnd());
    console.error('----- GJS-under-shim stdout -----');
    console.error(gjsRes.stdout.trimEnd());
    if (!gjsRes.ok) {
        console.error('----- GJS-under-shim stderr (captured) -----');
        console.error(gjsRes.stderr.trimEnd());
    }
    console.error('---------------------------------\n');

    const identical = gjsRes.ok && Buffer.from(nodeRes.stdout).equals(Buffer.from(gjsRes.stdout));
    if (identical) {
        console.error(`[transparent:${name}] byte-identical (${Buffer.byteLength(nodeRes.stdout)} bytes)`);
        console.log(`TRANSPARENT GATE ${name}: PASS`);
        process.exit(0);
    }

    const a = nodeRes.stdout.split('\n');
    const b = gjsRes.stdout.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            console.error(`[transparent:${name}] first diff at line ${i + 1}:`);
            console.error(`  node: ${JSON.stringify(a[i])}`);
            console.error(`  gjs : ${JSON.stringify(b[i])}`);
            break;
        }
    }
    die('Node vs GJS stdout mismatch (transparent auto-resolution regression)');
} catch (err) {
    die(err && err.stack ? err.stack : String(err));
}
