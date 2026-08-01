// SPDX-License-Identifier: MIT
// @gjsify/napi — GENERIC ADDON GATE. Generalizes test/consumer-gate.mjs from
// the single better-sqlite3 case to the test/addon-matrix.mjs registry: for a
// named addon it bundles its workout `--app gjs` (native .node routed through
// the @gjsify/napi shim by test/addon-resolver.mjs), runs the SAME workout on
// Node (golden) and GJS-under-shim, and byte-diffs the two stdouts.
//
//   node test/addon-gate.mjs <addon-name>
//
// Unlike the consumer gate it does NOT hard-exit on a GJS crash: for addons
// flagged `async: true` (node-sqlite3) a hard failure at the async boundary is
// the whole point — it is captured and reported, not treated as a gate bug.
//
// Exit code: 0 on byte-identical PASS; 1 on a genuine mismatch/regression of a
// SYNC addon; 2 when an `async` addon fails as expected (a recorded FINDING).

import { execFileSync } from 'node:child_process';
import {
    copyFileSync,
    existsSync,
    mkdtempSync,
    readdirSync,
    realpathSync,
    renameSync,
    rmSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADDONS } from './addon-matrix.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../test
const PKG = resolve(HERE, '..'); // .../packages/napi/napi
const ROOT = resolve(PKG, '..', '..', '..'); // gjsify repo root
// Resolve the Node CLI entry (NOT node_modules/.bin/gjsify — that shim prefers
// the committed GJS bundle when gjs is on PATH, changing import.meta path math).
// In a normal checkout it sits under ROOT; in a git worktree with node_modules
// symlinked to the main checkout it lives beside that symlink target.
function resolveCli() {
    if (process.env.GJSIFY_CLI_ENTRY) return process.env.GJSIFY_CLI_ENTRY;
    const inTree = join(ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
    if (existsSync(inTree)) return inTree;
    const nm = join(ROOT, 'node_modules');
    if (existsSync(nm)) {
        const real = resolve(nm); // realpath via fs below
        const viaSymlink = join(resolveRealpath(real), '..', 'packages', 'infra', 'cli', 'lib', 'index.js');
        if (existsSync(viaSymlink)) return viaSymlink;
    }
    return inTree; // fall through (will fail loudly with a clear message)
}
function resolveRealpath(p) {
    try {
        return realpathSync(p);
    } catch {
        return p;
    }
}
const CLI = resolveCli();
const runGjsify = (args, opts) => execFileSync(process.execPath, [CLI, ...args], opts);
const ADDONS_DIR = join(HERE, 'addons');
const RESOLVER = join(HERE, 'addon-resolver.mjs');
const NAPI_LIB = join(PKG, 'lib', 'esm', 'index.js');
const PREBUILD_DIR = join(PKG, 'prebuilds', 'linux-x64');

const name = process.argv[2];
const cfg = ADDONS[name];
const stage = (m) => console.error(`[gate:${name}] ${m}`);
const die = (m, code = 1) => {
    console.error(`ADDON GATE ${name}: FAIL — ${m}`);
    process.exit(code);
};
if (!cfg) die(`unknown addon '${name}'. Known: ${Object.keys(ADDONS).join(', ')}`);

const abs = (p) => (p ? resolve(ADDONS_DIR, p) : null);

// --- resolve the .node (napi-rs: first argon2.*.node under the pkg) ---
let addonPath = abs(cfg.addon);
if (!addonPath && cfg.binding === 'napi-rs') {
    const pkgDir = resolve(ADDONS_DIR, dirname(cfg.index));
    const hit = existsSync(pkgDir) && readdirSync(pkgDir).find((f) => f.endsWith('.node'));
    if (hit) addonPath = join(pkgDir, hit);
}
const indexJs = abs(cfg.index);
const workout = join(ADDONS_DIR, cfg.workout);

// --- prereqs ---
if (!existsSync(indexJs)) die(`addon entry not installed: ${indexJs} (fetch into test/addons first)`);
if (!addonPath || !existsSync(addonPath)) die(`compiled .node not found: ${addonPath} (build from source first)`);
if (!existsSync(NAPI_LIB)) {
    stage('building @gjsify/napi L1 lib …');
    runGjsify(['build', '--library', 'src/ts/**/*.{ts,js}'], { cwd: PKG, stdio: 'inherit' });
}
if (!existsSync(PREBUILD_DIR)) die(`shim prebuild dir missing: ${PREBUILD_DIR}`);
stage(`addon .node: ${addonPath.replace(ADDONS_DIR + '/', '')}`);

// Extra binding-module descriptors for entries that self-require the addon via
// a caller-named module (better-sqlite3 `./binding`). node-sqlite3 needs none:
// its `lib/sqlite3-binding.js` does `require('bindings')('node_sqlite3.node')`,
// which the resolver's generic `bindings` interception already routes through
// loadAddon(). Reserved for future addons with a bespoke acquisition module.
function bindingModules() {
    return cfg.bindingModules ?? [];
}

const tmp = mkdtempSync(join(tmpdir(), `gjsify-napi-${name}-`));
const bundle = join(tmp, 'workout.gjs.mjs');
const rc = join(ADDONS_DIR, '.gjsifyrc.mjs');
const disabled = [];

function cleanup() {
    try {
        rmSync(rc, { force: true });
    } catch {
        /* ignore */
    }
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

// napi-rs entries are replaced wholesale (their platform loader references
// uninstalled packages a bundler can't resolve); everyone else keeps their
// real loader and only the helper/binding module is swapped.
const entryReplace = cfg.binding === 'napi-rs' ? [cfg.pkg] : [];

try {
    writeFileSync(
        rc,
        `import { nodeAddonResolver } from ${JSON.stringify(RESOLVER)};\n` +
            `export default { bundler: { plugins: [nodeAddonResolver({ addonPath: ${JSON.stringify(addonPath)}, bindingModules: ${JSON.stringify(bindingModules())}, entryReplace: ${JSON.stringify(entryReplace)} })] } };\n`,
    );

    // Force both runtimes onto the same source-built .node by hiding prebuilds.
    for (const p of cfg.prebuilds ?? []) {
        const d = abs(p);
        if (existsSync(d)) {
            renameSync(d, `${d}.disabled`);
            disabled.push(d);
        }
    }

    // --- build the GJS bundle ---
    stage('bundling workout for --app gjs …');
    // napi-rs: no alias — the resolver intercepts the bare specifier directly.
    const aliases = [...(entryReplace.length ? [] : [`${cfg.pkg}=${indexJs}`]), ...(cfg.aliases ?? [])];
    const aliasArgs = aliases.flatMap((a) => ['--alias', a]);
    const build = runCapture(
        process.execPath,
        [CLI, 'build', workout, '--app', 'gjs', '--outfile', bundle, ...aliasArgs],
        { cwd: ADDONS_DIR },
    );
    if (!build.ok || !existsSync(bundle)) {
        console.error(build.stderr || build.stdout);
        die('gjsify build failed / produced no bundle');
    }

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
        timeout: 30000, // guard: an async_work hang must not eat the CI budget
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
        console.error(`[gate:${name}] byte-identical (${Buffer.byteLength(nodeRes.stdout)} bytes)`);
        console.log(`ADDON GATE ${name}: PASS`);
        process.exit(0);
    }

    // Show first diff for diagnosis.
    const a = nodeRes.stdout.split('\n');
    const b = gjsRes.stdout.split('\n');
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        if (a[i] !== b[i]) {
            console.error(`[gate:${name}] first diff at line ${i + 1}:`);
            console.error(`  node: ${JSON.stringify(a[i])}`);
            console.error(`  gjs : ${JSON.stringify(b[i])}`);
            break;
        }
    }
    if (cfg.async) {
        console.log(`ADDON GATE ${name}: FINDING (async addon diverged/failed as flagged — see stderr)`);
        process.exit(2);
    }
    die('Node vs GJS stdout mismatch (sync addon regression)');
} catch (err) {
    die(err && err.stack ? err.stack : String(err));
}
