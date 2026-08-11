// SPDX-License-Identifier: MIT
// worker.terminate() mid-JS→GI-call regression for @gjsify/node-gi.
//
// The env-teardown fix (#730) closed the process-exit toggle-ref crash, but a narrower
// residual remained: terminating a worker_thread WHILE it is inside a native GI call
// aborted with SIGABRT. Mechanism: once the env can no longer run JS a fallible
// node-addon-api call fails, the throw is swallowed
// (NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS) and the call returns a DEFAULT-CONSTRUCTED
// value (`_env == nullptr`); the NEXT fallible call chained onto that empty value funnels
// into node-addon-api's Error::New(napi_get_last_error_info) NAPI_FATAL_IF_FAILED sites —
// OUTSIDE the swallow valve — and aborts. The fix checks each fallible wrapper result
// (IsEmpty()) on the invoke/wrap/marshalling/construction paths and returns cleanly.
//
// The fix guarantees "no SIGABRT" only. It cannot remove a separate PRE-EXISTING hazard:
// a SIGSEGV when the terminate lands while the worker OS thread is inside a blocking GLib
// C call (repro'd stack: g_str_hash ← g_hash_table_lookup ← ffi ← gi_function_info_invoke,
// no napi frame) — teardown racing an OS thread stuck in C, with no node-gi hook once ffi
// has dispatched, identical on the pre-fix build and possible on either loop shape. The
// test is built to survive it:
//   1. ISOLATION — every terminate loop runs in a spawned CHILD (spawnSync), so a
//      worker/child SIGSEGV can never crash the `node --test` runner.
//   2. TOLERANCE — pass condition is "the child did NOT die of SIGABRT". A SIGSEGV or a
//      timeout kill is the documented residual; asserting a clean exit flaked CI.
// Children run with core dumps disabled (ulimit -c 0) so a tolerated SIGSEGV dies instantly
// instead of blocking on a core-dump handler and timing the child out. Each child does
// enough terminates that an OPEN funnel is near-certain to abort (pre-fix, the construction
// funnel SIGABRT'd on 188 of 200 terminates).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const indexUrl = new URL('../index.js', import.meta.url).href;

// `method` = fresh GObjects via callStaticMethod + string marshalling (the
// MakeGObjectHandle funnel); `construct` = newObject with props (ConstructGObject/JsToGValue).
const LOOP_BODY = {
    method: `
      const f = callStaticMethod('Gio', 'File', 'new_for_path', ['/tmp/node-gi-stress']);
      callMethod(f, 'get_path', []);
      callMethod(f, 'get_basename', []);
      const g = callMethod(f, 'get_parent', []);
      if (g) callMethod(g, 'get_path', []);`,
    construct: `
      const g = newObject('Gio', 'SimpleActionGroup', {});
      const a = newObject('Gio', 'SimpleAction', { name: 'x', enabled: true });
      callMethod(g, 'add_action', [a]);`,
};

// One child = `terminates` spawn-worker → hot-loop → random-dwell → terminate cycles.
// `mainClaims` decides which env owns the toggle machinery: false → the WORKER owns it
// (the named repro, MakeGObjectHandle's owner path); true → the main thread claims first
// and the worker takes the plain strong-ref wrap path.
function runChild(terminates, mainClaims, shape) {
    const claim =
        shape === 'construct'
            ? `newObject('Gio', 'SimpleActionGroup', {});`
            : `callStaticMethod('Gio', 'File', 'new_for_path', ['/tmp']);`;
    const script = `
import { Worker } from 'node:worker_threads';
${
    mainClaims
        ? `
// Non-owner-worker leg: main claims the toggle machinery first.
{
  const { newObject, callStaticMethod, requireNamespace } = await import(${JSON.stringify(indexUrl)});
  requireNamespace('Gio', '2.0');
  ${claim}
}
`
        : ''
}
const code = \`
  const { workerData, parentPort } = require('node:worker_threads');
  (async () => {
    const { newObject, callStaticMethod, callMethod, requireNamespace } = await import(workerData.index);
    requireNamespace('Gio', '2.0');
    parentPort.postMessage('ready');
    for (;;) {${LOOP_BODY[shape]}
    }
  })().catch(() => {});
\`;
for (let i = 0; i < ${terminates}; i++) {
  const w = new Worker(code, { eval: true, workerData: { index: ${JSON.stringify(indexUrl)} } });
  await new Promise((resolve, reject) => { w.on('message', resolve); w.on('error', reject); });
  // Random dwell: the terminate must land at a RANDOM point in the hot loop
  // (inside the native call, mid-marshal, or in JS).
  await new Promise((r) => setTimeout(r, Math.random() * 12));
  await w.terminate();
}
process.exit(0);
`;
    const file = join(
        tmpdir(),
        `node-gi-worker-terminate-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.mjs`,
    );
    writeFileSync(file, script);
    try {
        // Core dumps off (see header); Windows has no POSIX shell, so spawn directly there.
        if (process.platform === 'win32') {
            return spawnSync(process.execPath, [file], { timeout: 60000, encoding: 'utf8' });
        }
        return spawnSync('/bin/sh', ['-c', 'ulimit -c 0; exec "$0" "$1"', process.execPath, file], {
            timeout: 60000,
            encoding: 'utf8',
        });
    } finally {
        rmSync(file, { force: true });
    }
}

// The only deterministic pass condition: no SIGABRT (signal 6, or its exit-status form
// 134). SIGSEGV, a timeout kill, or a clean exit are all tolerated — see the header.
function assertNoSigabrt(r, tag) {
    assert.notEqual(
        r.signal,
        'SIGABRT',
        `${tag}: the Error::New(napi_get_last_error_info) funnel must stay closed (got SIGABRT). stderr: ${r.stderr}`,
    );
    assert.notEqual(
        r.status,
        134,
        `${tag}: the Error::New funnel must stay closed (got exit 134 = SIGABRT). stderr: ${r.stderr}`,
    );
}

// MakeGObjectHandle + string-marshalling funnels, owner-env worker and non-owner.
test('terminate: worker.terminate() mid method/static GI-call never SIGABRTs', () => {
    for (let i = 0; i < 3; i++) {
        assertNoSigabrt(runChild(8, false, 'method'), `method owner-worker child ${i}`);
    }
    for (let i = 0; i < 2; i++) {
        assertNoSigabrt(runChild(8, true, 'method'), `method non-owner-worker child ${i}`);
    }
});

// ConstructGObject/JsToGValue funnels, owner and non-owner env.
test('terminate: worker.terminate() mid-newObject never SIGABRTs (object.cc funnel closed)', () => {
    for (let i = 0; i < 3; i++) {
        assertNoSigabrt(runChild(8, i === 1, 'construct'), `construct child ${i}`);
    }
});
