// SPDX-License-Identifier: MIT
// @gjsify/napi — better-sqlite3 CONSUMER GATE (plan §11 milestone 3 = Phase 0 done).
//
// Proves a real npm native addon runs in GJS: builds test/consumer-workout.mjs
// for `--app gjs` (better-sqlite3's node: builtins routed to the @gjsify/*
// polyfills automatically, its native addon routed through the @gjsify/napi
// shim by test/consumer-node-resolver.mjs), runs the SAME workout on Node
// (golden) and GJS-under-shim, and byte-diffs the two stdouts. Prints
// `CONSUMER GATE: PASS` on an exact match.
//
// Run (from the package root):
//   node test/consumer-gate.mjs
// Prereqs: test/consumer/node_modules/better-sqlite3 built from source
//   (npm i --prefix test/consumer better-sqlite3 &&
//    cd test/consumer/node_modules/better-sqlite3 &&
//    npm exec -- node-gyp rebuild --force_build=1)
// and the @gjsify/napi L1 built (lib/esm/index.js) — the gate builds it if absent.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../test
const PKG = resolve(HERE, '..'); // .../packages/napi/napi
const ROOT = resolve(PKG, '..', '..', '..'); // gjsify repo root
// Use the Node CLI entry directly (NOT node_modules/.bin/gjsify — that shim
// prefers the committed GJS bundle when gjs is on PATH, which would run
// cosmiconfig + the resolver plugin UNDER GJS and change import.meta path math).
const CLI = process.env.GJSIFY_CLI_ENTRY || join(ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const runGjsify = (args, opts) => execFileSync(process.execPath, [CLI, ...args], opts);
const CONSUMER = join(HERE, 'consumer');
const BSQ = join(CONSUMER, 'node_modules', 'better-sqlite3');
const BSQ_INDEX = join(BSQ, 'lib', 'index.js');
const BSQ_ADDON = join(BSQ, 'build', 'Release', 'better_sqlite3.node');
const BSQ_PREBUILDS = join(BSQ, 'prebuilds');
const WORKOUT = join(HERE, 'consumer-workout.mjs');
const RESOLVER = join(HERE, 'consumer-node-resolver.mjs');
const NAPI_LIB = join(PKG, 'lib', 'esm', 'index.js');
const PREBUILD_DIR = join(PKG, 'prebuilds', 'linux-x64');

const die = (msg) => {
    console.error(`CONSUMER GATE: FAIL — ${msg}`);
    process.exit(1);
};
const stage = (msg) => console.error(`[gate] ${msg}`);

// --- prereqs ---
if (!existsSync(BSQ_INDEX)) die(`better-sqlite3 not installed at ${BSQ} (see header for fetch command)`);
if (!existsSync(BSQ_ADDON)) {
    die(`better-sqlite3 addon not built at ${BSQ_ADDON} — run: (cd ${BSQ} && npm exec -- node-gyp rebuild --force_build=1)`);
}
if (!existsSync(NAPI_LIB)) {
    stage('building @gjsify/napi L1 lib …');
    runGjsify(['build', '--library', 'src/ts/**/*.{ts,js}'], { cwd: PKG, stdio: 'inherit' });
}
if (!existsSync(PREBUILD_DIR)) die(`shim prebuild dir missing: ${PREBUILD_DIR}`);

const tmp = mkdtempSync(join(tmpdir(), 'gjsify-napi-consumer-'));
const bundle = join(tmp, 'workout.gjs.mjs');
const rc = join(CONSUMER, '.gjsifyrc.mjs'); // ephemeral (gitignored)
let prebuildsMoved = false;

function cleanup() {
    try { rmSync(rc, { force: true }); } catch { /* ignore */ }
    if (prebuildsMoved) {
        try { renameSync(`${BSQ_PREBUILDS}.disabled`, BSQ_PREBUILDS); } catch { /* ignore */ }
    }
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}
process.on('exit', cleanup);

try {
    // Ephemeral gjsify config injecting the node-addon resolver plugin.
    writeFileSync(
        rc,
        `import { nodeAddonResolver } from ${JSON.stringify(RESOLVER)};\n` +
            `export default { bundler: { plugins: [nodeAddonResolver({ addonPath: ${JSON.stringify(BSQ_ADDON)} })] } };\n`,
    );

    // Force BOTH runtimes to load the SAME source-built .node: disable the
    // shipped prebuild so Node's binding.js falls through to build/Release
    // (the GJS side is already pinned to build/Release via the resolver).
    if (existsSync(BSQ_PREBUILDS)) {
        renameSync(BSQ_PREBUILDS, `${BSQ_PREBUILDS}.disabled`);
        prebuildsMoved = true;
    }

    // --- build the GJS bundle ---
    stage('bundling workout for --app gjs …');
    runGjsify(
        ['build', WORKOUT, '--app', 'gjs', '--outfile', bundle, '--alias', `better-sqlite3=${BSQ_INDEX}`],
        { cwd: CONSUMER, stdio: ['ignore', 'inherit', 'inherit'] },
    );
    if (!existsSync(bundle)) die('gjsify build produced no bundle');

    // --- golden: Node ---
    // Node's ESM loader ignores NODE_PATH, so give the workout a node_modules
    // it can resolve `better-sqlite3` from: run a copy inside the tmp dir with
    // an ephemeral node_modules symlink to the vendored package.
    stage('running Node golden …');
    const goldenWorkout = join(tmp, 'consumer-workout.mjs');
    copyFileSync(WORKOUT, goldenWorkout);
    symlinkSync(join(CONSUMER, 'node_modules'), join(tmp, 'node_modules'), 'dir');
    const nodeOut = execFileSync(process.execPath, [goldenWorkout], { encoding: 'utf8' });

    // --- GJS under the shim ---
    stage('running GJS-under-shim …');
    const gjsOut = execFileSync('gjs', ['-m', bundle], {
        env: {
            ...process.env,
            GI_TYPELIB_PATH: PREBUILD_DIR,
            LD_LIBRARY_PATH: PREBUILD_DIR,
        },
        encoding: 'utf8',
    });

    // --- byte-diff ---
    writeFileSync(join(tmp, 'node.out'), nodeOut);
    writeFileSync(join(tmp, 'gjs.out'), gjsOut);
    console.error('\n----- Node golden stdout -----');
    console.error(nodeOut.trimEnd());
    console.error('----- GJS-under-shim stdout -----');
    console.error(gjsOut.trimEnd());
    console.error('---------------------------------\n');

    if (Buffer.from(nodeOut).equals(Buffer.from(gjsOut))) {
        console.error(`[gate] byte-identical (${Buffer.byteLength(nodeOut)} bytes)`);
        console.log('CONSUMER GATE: PASS');
        process.exit(0);
    }

    // Show the first differing line for diagnosis.
    const a = nodeOut.split('\n');
    const b = gjsOut.split('\n');
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) {
            console.error(`[gate] first diff at line ${i + 1}:`);
            console.error(`  node: ${JSON.stringify(a[i])}`);
            console.error(`  gjs : ${JSON.stringify(b[i])}`);
            break;
        }
    }
    die('Node vs GJS stdout mismatch');
} catch (err) {
    die(err && err.stack ? err.stack : String(err));
}
