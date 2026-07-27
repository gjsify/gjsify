// SPDX-License-Identifier: MIT
// @gjsify/napi — PHASE 1 NODE-GI GATE: @gjsify/node-gi (a real native N-API
// addon) runs UNDER the shim on GJS, proving the threadsafe-function +
// make_callback surface end to end.
//
// Pipeline: bundles test/nodegi-workout.mjs for `--app gjs` (node-gi's
// node:* imports routed to the @gjsify/* polyfills; the addon binary pinned
// via NODE_GI_NATIVE and loaded through the shim by node-gi's gjs host
// mode), runs it under `gjs -m`, and asserts the workout's markers PLUS the
// toggle-debug proof that a tsfn dispatch executed a GObject teardown on the
// JS thread. `--valgrind` reruns the same bundle under memcheck (reduced
// churn) and requires 0 errors.
//
// Run (from the package root):
//   node test/nodegi-gate.mjs [--valgrind]
// Prereqs:
//   - the shim prebuild staged (gjsify run build:prebuilds)
//   - packages/node-gi/node-gi built:
//       (cd ../../node-gi/node-gi && npm install && npm exec -- node-gyp rebuild)
//   - the workspace polyfills built + resolvable from the repo root
//     node_modules (gjsify install / gjsify foreach build:gjsify)

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url)); // .../test
const PKG = resolve(HERE, '..'); // .../packages/napi/napi
const ROOT = resolve(PKG, '..', '..', '..'); // gjsify repo root
// The Node CLI entry (see consumer-gate.mjs for why not node_modules/.bin).
const CLI = process.env.GJSIFY_CLI_ENTRY || join(ROOT, 'packages', 'infra', 'cli', 'lib', 'index.js');
const WORKOUT = join(HERE, 'nodegi-workout.mjs');
const PREBUILD_DIR = join(PKG, 'prebuilds', 'linux-x64');
const NODE_GI = join(ROOT, 'packages', 'node-gi', 'node-gi');
const NODE_GI_ADDON = join(NODE_GI, 'build', 'Release', 'node_gi.node');
const VALGRIND = process.argv.includes('--valgrind');

const die = (msg) => {
    console.error(`PHASE1 NODE-GI GATE: FAIL — ${msg}`);
    process.exit(1);
};
const stage = (msg) => console.error(`[gate] ${msg}`);

if (!existsSync(CLI)) die(`gjsify Node CLI not built at ${CLI} (or set GJSIFY_CLI_ENTRY)`);
if (!existsSync(PREBUILD_DIR)) die(`shim prebuild dir missing: ${PREBUILD_DIR}`);
if (!existsSync(NODE_GI_ADDON)) {
    die(`node-gi addon not built at ${NODE_GI_ADDON} — run: (cd ${NODE_GI} && npm install && npm exec -- node-gyp rebuild)`);
}

const tmp = mkdtempSync(join(tmpdir(), 'gjsify-napi-nodegi-'));
const bundle = join(tmp, 'nodegi-workout.gjs.mjs');
process.on('exit', () => {
    try {
        rmSync(tmp, { recursive: true, force: true });
    } catch {
        /* ignore */
    }
});

try {
    stage('bundling workout for --app gjs …');
    execFileSync(process.execPath, [CLI, 'build', WORKOUT, '--app', 'gjs', '--outfile', bundle], {
        cwd: PKG,
        stdio: ['ignore', 'inherit', 'inherit'],
    });
    if (!existsSync(bundle)) die('gjsify build produced no bundle');

    const runEnv = {
        ...process.env,
        GI_TYPELIB_PATH: PREBUILD_DIR,
        LD_LIBRARY_PATH: PREBUILD_DIR,
        NODE_GI_NATIVE: NODE_GI_ADDON,
        NODE_GI_TOGGLE_DEBUG: '1',
    };

    stage('running GJS-under-shim …');
    const run = spawnSync('gjs', ['-m', bundle], { env: runEnv, encoding: 'utf8', timeout: 180000 });
    console.error('\n----- workout stdout -----');
    console.error((run.stdout ?? '').trimEnd());
    console.error('--------------------------\n');
    if (run.status !== 0) {
        console.error(run.stderr ?? '');
        die(`gjs exited status=${run.status} signal=${run.signal}`);
    }

    const expectStdout = [
        'runtime=gjs',
        'ns=ok glib=object gio=object',
        'name=probe',
        'enabled-after-set=false',
        'notify=1 activate=2',
        'keyfile=value',
        'churn-survivor=true name=churn',
        'teardown-pumped=1',
        'PHASE1 NODE-GI WORKOUT COMPLETE',
    ];
    for (const marker of expectStdout) {
        if (!run.stdout.includes(marker)) die(`missing stdout marker: ${JSON.stringify(marker)}`);
    }

    // Drain proof from the toggle-debug stream: the napi finalizer queued a
    // teardown and the tsfn dispatch executed it on the JS thread.
    const stderr = run.stderr ?? '';
    if (!stderr.includes('finalizer: teardown queued')) {
        die('toggle-debug missing "finalizer: teardown queued" (napi finalizer never queued a teardown)');
    }
    if (!stderr.includes('drain: run teardown inst')) {
        die('toggle-debug missing "drain: run teardown inst" (tsfn dispatch never ran a teardown)');
    }

    if (VALGRIND) {
        stage('valgrind leg (reduced churn) …');
        const vgLog = join(tmp, 'nodegi.vg.log');
        const vg = spawnSync(
            'valgrind',
            ['--tool=memcheck', '--leak-check=no', '--error-exitcode=42', `--log-file=${vgLog}`, 'gjs', '-m', bundle],
            {
                env: { ...runEnv, GJS_DISABLE_JIT: '1', NODEGI_GATE_CHURN: '2000' },
                encoding: 'utf8',
                timeout: 1200000,
            },
        );
        if (vg.status !== 0) {
            console.error(vg.stderr ?? '');
            die(`valgrind run failed status=${vg.status} signal=${vg.signal}`);
        }
        const summary = readFileSync(vgLog, 'utf8')
            .split('\n')
            .filter((l) => l.includes('ERROR SUMMARY'))
            .join('\n');
        console.error(summary);
        if (!/ERROR SUMMARY: 0 errors/.test(summary)) die('valgrind reported memory errors (see log)');
    }

    console.log('PHASE1 NODE-GI GATE: PASS');
    process.exit(0);
} catch (err) {
    die(err && err.stack ? err.stack : String(err));
}
