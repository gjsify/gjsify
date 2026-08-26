// SPDX-License-Identifier: MIT
// Golden-diff conformance oracle for @gjsify/napi — the exactness gate.
//
//   node scripts/conformance.mjs [--filter=<substr>] [--update-golden] [--rebuild] [--list]
//
// Each program (conformance/programs/<name>.mjs) exercises a COMPILED N-API
// test addon built UNMODIFIED with node-gyp from the canonical Node suite
// (refs/node/test/js-native-api/*). The program is runtime-agnostic — it prints
// a deterministic transcript through the shared harness (conformance/harness/
// harness.mjs). The orchestrator runs each program twice:
//   • Node  (`node --expose-gc <twin>`) — the addon loaded via `require`; this
//     is the golden REFERENCE (Node's exact N-API behavior).
//   • GJS   (`gjs -m <twin>`) — the SAME built .node routed through the shim's
//     `loadAddon()` (imports.gi.GjsifyNapi bootstrap); this is the subject.
// stdout must be byte-identical. Node is also checked against the committed
// golden (conformance/golden/<name>.txt) so a Node drift / stale golden fails
// loudly.
//
// Strict ledger (conformance/ledger.json — the whole point):
//   • a GJS failure WITH a ledger entry  → LEDGERED (documented exclusion);
//   • a GJS failure WITHOUT a ledger entry → failure;
//   • a GJS PASS that still has a ledger entry → failure ("stale — remove it").
// Node must ALWAYS pass (it is the reference): a Node failure or Node≠golden is
// a hard error regardless of the ledger. Exit 0 only with zero unexpected
// results. Each ledger entry = { addon, reason }.
//
// The verdict "Node≠golden" is only usable while a Node run that STOPPED cannot
// look like one that ANSWERED DIFFERENTLY — a truncated transcript reported as
// drift invites `--update-golden`, which retires every stage after the one that
// stopped. So the Node twin fails a run whose program never settled; see
// `writeNodeTwin`.
//
// NB: filename deliberately avoids Node's default test glob so `node --test`
// does not pick this orchestrator up.

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PKG = resolve(HERE, '..'); // packages/napi/napi
const ROOT = resolve(PKG, '..', '..', '..'); // gjsify repo root
const CONF = join(PKG, 'conformance');
const PROGRAMS_DIR = join(CONF, 'programs');
const GOLDEN_DIR = join(CONF, 'golden');
const DIST_DIR = join(CONF, 'dist');
const BUILD_TREE = join(DIST_DIR, 'build-tree');
const HARNESS = join(CONF, 'harness', 'harness.mjs');
const LEDGER_PATH = join(CONF, 'ledger.json');
// Canonical Node suites mirrored into the oracle. `js-native-api` = the
// js_native_api.h surface; `node-api` = the node_api.h surface (tsfn +
// make_callback + callback scope). node-api addons #include the sibling
// js-native-api/common.h, so BOTH are copied under a shared build root.
const REFS_SUITES = {
    'js-native-api': join(ROOT, 'refs', 'node', 'test', 'js-native-api'),
    'node-api': join(ROOT, 'refs', 'node', 'test', 'node-api'),
};
// A SIBLING of the package, not a child of it: since ADR 0017 each `<os>-<arch>`
// prebuild lives in its own npm package (`@gjsify/napi-linux-x64`) so a consumer
// downloads only the binary their machine can load. `packages/napi/napi` ships no
// `prebuilds/` and no longer lists it in `files`; the directory name is
// `platformPackageDirName()`'s `<bridge-dir>-<target>`.
const PREBUILD_DIR = join(PKG, '..', 'napi-linux-x64', 'prebuilds', 'linux-x64');

// A node-api addon that #includes <uv.h> links against libuv threading
// symbols (uv_thread_create / uv_hrtime), which Node provides from its own
// binary. Under GJS we preload the system libuv so those references resolve at
// dlopen — the host's job, exactly as Node embeds libuv; it is NOT a napi
// weakening. Resolved once; programs opt in via meta.libuv.
const LIBUV_PATH =
    [
        '/lib64/libuv.so.1',
        '/usr/lib64/libuv.so.1',
        '/usr/lib/x86_64-linux-gnu/libuv.so.1',
        '/lib/x86_64-linux-gnu/libuv.so.1',
    ].find((p) => existsSync(p)) ?? '';

const usage = 'usage: node scripts/conformance.mjs [--filter=<substr>] [--update-golden] [--rebuild] [--list]';

// ---- flags ------------------------------------------------------------------
let filter = '';
let updateGolden = false;
let rebuild = false;
let listOnly = false;
let buildOnly = false;
for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--filter=')) filter = arg.slice('--filter='.length);
    else if (arg === '--update-golden') updateGolden = true;
    else if (arg === '--rebuild') rebuild = true;
    else if (arg === '--list') listOnly = true;
    else if (arg === '--build-only') buildOnly = true;
    else {
        console.error(`conformance: unknown argument '${arg}'\n${usage}`);
        process.exit(2);
    }
}

// ---- discovery --------------------------------------------------------------
const programFiles = readdirSync(PROGRAMS_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .sort()
    .map((f) => f.slice(0, -'.mjs'.length))
    .filter((n) => n.includes(filter));
if (programFiles.length === 0) {
    console.error(`conformance: no programs match (dir ${PROGRAMS_DIR}, filter '${filter}')`);
    process.exit(2);
}

// Each program module exports `meta = { dir, targets }` + a default run().
const programs = [];
for (const name of programFiles) {
    const mod = await import(pathToFileURL(join(PROGRAMS_DIR, `${name}.mjs`)).href);
    if (!mod.meta || typeof mod.meta.dir !== 'string' || !Array.isArray(mod.meta.targets)) {
        console.error(`conformance: ${name}.mjs must export meta = { dir, targets:[...] }`);
        process.exit(2);
    }
    const suite = mod.meta.suite ?? 'js-native-api';
    if (!REFS_SUITES[suite]) {
        console.error(
            `conformance: ${name}.mjs has unknown meta.suite '${suite}' (want ${Object.keys(REFS_SUITES).join('/')})`,
        );
        process.exit(2);
    }
    programs.push({ name, meta: { ...mod.meta, suite } });
}

if (listOnly) {
    for (const p of programs) console.log(`${p.name}  (dir=${p.meta.dir}, targets=${p.meta.targets.join(',')})`);
    process.exit(0);
}

// The shim's prebuild is NOT committed (`gjsify.platformsUncommitted` on
// `@gjsify/napi-linux-x64`), so on a fresh clone this directory does not exist —
// that is the normal state, not an anomaly. Without this check every program
// still RUNS, each one failing inside GJS with "Requiring GjsifyNapi, version
// none: Typelib file for namespace 'GjsifyNapi' not found", and the run reports
// 21 conformance failures. A missing toolchain output reading as a mass
// implementation regression is the wrong diagnosis in the most expensive
// direction, so say which one it is. Placed AFTER `--list` so listing the
// programs needs no build. The gates check the same thing (test/*-gate.mjs).
if (!existsSync(PREBUILD_DIR)) {
    console.error(
        `conformance: shim prebuild dir missing: ${PREBUILD_DIR}\n` +
            'This directory is not committed — build it first:\n' +
            '  cd packages/napi/napi && gjsify run build:prebuilds',
    );
    process.exit(2);
}

// ---- ledger -----------------------------------------------------------------
const ledger = JSON.parse(readFileSync(LEDGER_PATH, 'utf8'));
if (!Array.isArray(ledger.entries)) {
    console.error(`conformance: ${LEDGER_PATH} must have an "entries" array`);
    process.exit(2);
}
const allProgramNames = readdirSync(PROGRAMS_DIR)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => f.slice(0, -'.mjs'.length));
for (const e of ledger.entries) {
    if (!allProgramNames.includes(e.addon)) {
        console.error(`conformance: ledger entry for unknown program '${e.addon}' — remove it`);
        process.exit(1);
    }
    if (typeof e.reason !== 'string' || e.reason.trim() === '') {
        console.error(`conformance: ledger entry '${e.addon}' needs a non-empty reason`);
        process.exit(1);
    }
}
const ledgered = (name) => ledger.entries.find((e) => e.addon === name);

// ---- addon build tree -------------------------------------------------------
// Copy each canonical suite once (UNMODIFIED sources + each addon's OWN
// binding.gyp) so node-gyp builds in-place — refs/ stays read-only. Both
// suites sit side by side under BUILD_TREE so a node-api addon's
// "../../js-native-api/common.h" include resolves.
function ensureBuildTree() {
    mkdirSync(DIST_DIR, { recursive: true });
    for (const [suite, src] of Object.entries(REFS_SUITES)) {
        const dest = join(BUILD_TREE, suite);
        if (!existsSync(join(dest, 'common.h'))) {
            mkdirSync(dest, { recursive: true });
            cpSync(src, dest, { recursive: true });
        }
    }
}

const builtDirs = new Set();
function buildAddonDir(suite, dir) {
    const key = `${suite}/${dir}`;
    if (builtDirs.has(key)) return true;
    const addonDir = join(BUILD_TREE, suite, dir);
    const relDir = join(addonDir, 'build', 'Release');
    if (!rebuild && existsSync(relDir) && readdirSync(relDir).some((f) => f.endsWith('.node'))) {
        builtDirs.add(key);
        return true;
    }
    const r = spawnSync('npm', ['exec', '--', 'node-gyp', 'rebuild'], {
        cwd: addonDir,
        encoding: 'utf8',
    });
    const ok = r.status === 0;
    if (ok) builtDirs.add(key);
    else
        process.stderr.write(
            `conformance: node-gyp failed for '${key}':\n${(r.stderr || r.stdout || '').slice(-800)}\n`,
        );
    return ok;
}

/** target name → absolute built .node path (only existing ones). */
function targetMap(suite, dir, targets) {
    const rel = join(BUILD_TREE, suite, dir, 'build', 'Release');
    const map = {};
    for (const t of targets) {
        const p = join(rel, `${t}.node`);
        if (existsSync(p)) map[t] = p;
    }
    return map;
}

// ---- twin generation --------------------------------------------------------
const harnessUrl = pathToFileURL(HARNESS).href;
function programUrl(name) {
    return pathToFileURL(join(PROGRAMS_DIR, `${name}.mjs`)).href;
}

function writeNodeTwin(name, map) {
    const body =
        `import { createRequire } from 'node:module';\n` +
        `import { makeHarness } from ${JSON.stringify(harnessUrl)};\n` +
        `import run from ${JSON.stringify(programUrl(name))};\n` +
        `import { setImmediate } from 'node:timers';\n` +
        `const require = createRequire(${JSON.stringify(pathToFileURL(join(DIST_DIR, '_')).href)});\n` +
        `const MAP = ${JSON.stringify(map)};\n` +
        `const h = makeHarness({\n` +
        `  loadAddon: (n) => { const p = MAP[n]; if (!p) throw new Error('no built target ' + n); return require(p); },\n` +
        `  write: (s) => process.stdout.write(s + '\\n'),\n` +
        `  gc: () => { if (global.gc) global.gc(); },\n` +
        `  tick: () => new Promise((r) => setImmediate(r)),\n` +
        `});\n` +
        // A program that AWAITS SOMETHING NOBODY RESOLVES exits 0. Node's loop
        // simply runs dry — a pending promise is not work — so the process ends
        // successfully having printed a prefix of its transcript. Then `nodeRun.ok`
        // is true, the golden comparison is the only thing that notices, and it
        // reports the truncation as DRIFT and advises `--update-golden`: following
        // that advice commits the short transcript and retires every stage after
        // the one that stopped, permanently green. Measured 2026-08-26 on
        // `na_test_instance_data` (run 32952785170 / job 98127767705, `got: ""`
        // against `want: "\\"finalizer\\""`) and reproduced exactly with
        // `await new Promise(() => {})` in place of the finalizer stage.
        //
        // So a run that did not finish must not report success. `process.exitCode`
        // assigned from an `exit` listener still takes effect, which is the only
        // hook left once the loop is already draining.
        `let _settled = false;\n` +
        `run(h).then(() => { _settled = true; }, (e) => { process.stderr.write('DRIVER-ERROR ' + (e && e.stack || e) + '\\n'); process.exit(1); });\n` +
        `process.on('exit', (code) => {\n` +
        `  if (_settled || code !== 0) return;\n` +
        `  process.stderr.write('DRIVER-ERROR the program never settled — an await here has no resolver, so Node ran out of work and the transcript stops early\\n');\n` +
        `  process.exitCode = 1;\n` +
        `});\n`;
    const out = join(DIST_DIR, `${name}.node.mjs`);
    writeFileSync(out, body);
    return out;
}

function writeGjsTwin(name, map) {
    const body =
        `import GjsifyNapi from 'gi://GjsifyNapi?version=1.0';\n` +
        `import GLib from 'gi://GLib?version=2.0';\n` +
        `import system from 'system';\n` +
        `import { makeHarness } from ${JSON.stringify(harnessUrl)};\n` +
        `import run from ${JSON.stringify(programUrl(name))};\n` +
        `GjsifyNapi.init();\n` +
        `const _load = globalThis.__gjsifyNapiLoadAddon;\n` +
        `delete globalThis.__gjsifyNapiLoadAddon;\n` +
        `const MAP = ${JSON.stringify(map)};\n` +
        `const h = makeHarness({\n` +
        `  loadAddon: (n) => { const p = MAP[n]; if (!p) throw new Error('no built target ' + n); return _load(p); },\n` +
        `  write: (s) => print(s),\n` +
        `  gc: () => system.gc(),\n` +
        // Pump one non-blocking main-context iteration — the GJS analogue of a
        // Node macrotask turn, so a main-loop-scheduled finalizer can run.
        `  tick: () => { while (GLib.MainContext.default().iteration(false)) {} return Promise.resolve(); },\n` +
        `});\n` +
        `try { await run(h); } catch (e) { printerr('DRIVER-ERROR ' + (e && e.stack || e)); system.exit(1); }\n`;
    const out = join(DIST_DIR, `${name}.gjs.mjs`);
    writeFileSync(out, body);
    return out;
}

// ---- runners ----------------------------------------------------------------
function runNode(twin) {
    const r = spawnSync(process.execPath, ['--expose-gc', twin], { encoding: 'utf8', timeout: 60_000 });
    return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}
function runGjs(twin, { libuv = false } = {}) {
    const env = { ...process.env, GI_TYPELIB_PATH: PREBUILD_DIR, LD_LIBRARY_PATH: PREBUILD_DIR };
    if (libuv && LIBUV_PATH) {
        // Provide the host libuv (uv_thread_create / uv_hrtime) an addon that
        // #includes <uv.h> references — Node supplies it from its binary.
        env.LD_PRELOAD = process.env.LD_PRELOAD ? `${LIBUV_PATH}:${process.env.LD_PRELOAD}` : LIBUV_PATH;
    }
    const r = spawnSync('gjs', ['-m', twin], { encoding: 'utf8', timeout: 60_000, env });
    return { ok: r.status === 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status };
}

// --build-only: materialize the build tree + node-gyp every referenced addon,
// then stop (used by the valgrind mem leg to guarantee the .node files exist).
if (buildOnly) {
    ensureBuildTree();
    let ok = true;
    for (const { meta } of programs) if (!buildAddonDir(meta.suite, meta.dir)) ok = false;
    console.log(`conformance: build-only — ${builtDirs.size} addon dir(s) built`);
    process.exit(ok ? 0 : 1);
}

// ---- run matrix -------------------------------------------------------------
ensureBuildTree();
mkdirSync(GOLDEN_DIR, { recursive: true });

const results = new Map(); // name → { node, gjs, verdict }
const failures = [];

for (const { name, meta } of programs) {
    const goldenPath = join(GOLDEN_DIR, `${name}.txt`);
    const built = buildAddonDir(meta.suite, meta.dir);
    const excuse = ledgered(name);

    if (!built) {
        // Build failure is only excusable via the ledger.
        if (excuse) {
            results.set(name, { verdict: 'LEDGERED' });
        } else {
            results.set(name, { verdict: '✗' });
            failures.push(`${name}: addon '${meta.dir}' failed to build (unledgered)`);
        }
        continue;
    }

    const map = targetMap(meta.suite, meta.dir, meta.targets);
    const nodeTwin = writeNodeTwin(name, map);
    const gjsTwin = writeGjsTwin(name, map);

    // Node = reference. Must succeed for an included program (build ok ⇒ node
    // loads via require). A node failure is a hard error even under a ledger.
    const nodeRun = runNode(nodeTwin);
    if (!nodeRun.ok) {
        results.set(name, { verdict: '✗' });
        failures.push(
            `${name}: NODE reference failed (exit ${nodeRun.status}) — the golden cannot be trusted.\n--- node stderr ---\n${nodeRun.stderr.trim()}`,
        );
        continue;
    }

    if (updateGolden) {
        writeFileSync(goldenPath, nodeRun.stdout);
        console.log(`conformance: golden updated: conformance/golden/${name}.txt`);
    }
    if (!existsSync(goldenPath)) {
        results.set(name, { verdict: '✗' });
        failures.push(`${name}: missing golden — run with --update-golden and commit conformance/golden/${name}.txt`);
        continue;
    }
    const golden = readFileSync(goldenPath, 'utf8');
    if (nodeRun.stdout !== golden) {
        results.set(name, { verdict: '✗' });
        failures.push(
            `${name}: NODE output drifted from the committed golden — regenerate (--update-golden) and review.\n${firstDiff(nodeRun.stdout, golden)}`,
        );
        continue;
    }

    const gjsRun = runGjs(gjsTwin, { libuv: !!meta.libuv });
    const gjsPass = gjsRun.ok && gjsRun.stdout === golden;

    if (gjsPass && !excuse) {
        results.set(name, { verdict: '✓' });
    } else if (gjsPass && excuse) {
        results.set(name, { verdict: '✗' });
        failures.push(
            `${name}: GJS PASSES but has a ledger entry — stale ledger entry, remove it (reason was: ${excuse.reason})`,
        );
    } else if (!gjsPass && excuse) {
        results.set(name, { verdict: 'LEDGERED' });
    } else {
        results.set(name, { verdict: '✗' });
        const detail = gjsRun.ok
            ? `stdout != golden\n${firstDiff(gjsRun.stdout, golden)}`
            : `gjs exit ${gjsRun.status}\n--- gjs stdout ---\n${gjsRun.stdout.trim()}\n--- gjs stderr ---\n${gjsRun.stderr
                  .trim()
                  .split('\n')
                  .filter((l) => !l.includes('TEARDOWN PROBE'))
                  .join('\n')}`;
        failures.push(`${name}: ${detail}`);
    }
}

function firstDiff(got, want) {
    const a = got.split('\n');
    const b = want.split('\n');
    const n = Math.max(a.length, b.length);
    for (let i = 0; i < n; i++) {
        if (a[i] !== b[i]) {
            return `  first diff at line ${i + 1}:\n    got : ${JSON.stringify(a[i])}\n    want: ${JSON.stringify(b[i])}`;
        }
    }
    return '  (no line diff — trailing-byte mismatch)';
}

// ---- report -----------------------------------------------------------------
const nameWidth = Math.max(...programs.map((p) => p.name.length), 'program'.length);
const pad = (s, w) => String(s).padEnd(w);
let pass = 0;
let led = 0;
let fail = 0;
console.log(`\nconformance matrix (reference = Node, ${programs.length} program(s)):\n`);
console.log(`${pad('program', nameWidth + 2)}verdict`);
for (const { name } of programs) {
    const v = results.get(name)?.verdict ?? '-';
    if (v === '✓') pass++;
    else if (v === 'LEDGERED') led++;
    else if (v === '✗') fail++;
    console.log(`${pad(name, nameWidth + 2)}${v}`);
}
console.log(`\n  pass: ${pass}   ledgered: ${led}   fail: ${fail}`);

if (failures.length > 0) {
    console.error(`\n${failures.length} unexpected result(s):\n`);
    for (const f of failures) console.error(`✗ ${f}\n`);
    process.exit(1);
}
console.log('\nconformance: all green (no unexpected results)');
process.exit(0);
