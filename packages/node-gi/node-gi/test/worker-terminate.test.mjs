// SPDX-License-Identifier: MIT
// worker.terminate() mid-JS→GI-call regression for @gjsify/node-gi.
//
// The env-teardown fix (#730) closed the process-exit toggle-ref crash and gated
// every C→JS re-entry trampoline, but a NARROWER residual remained: terminating a
// worker_thread WHILE it is inside a native GI call (a hot loop) aborted the
// process with SIGABRT. Mechanism: once the env can no longer run JS, a fallible
// node-addon-api wrapper call fails, the throw is swallowed
// (NODE_API_SWALLOW_UNTHROWABLE_EXCEPTIONS), and the call returns a
// DEFAULT-CONSTRUCTED value (`_env == nullptr`); the NEXT fallible wrapper call
// chained onto that empty value funnels into node-addon-api's
// Error::New(napi_get_last_error_info) NAPI_FATAL_IF_FAILED sites — OUTSIDE the
// swallow valve — and aborts ("FATAL ERROR: Error::New napi_get_last_error_info").
// The fix checks each fallible wrapper result (IsEmpty()) on the invoke/wrap/
// marshalling/construction paths and returns cleanly instead (MakeGObjectHandle's
// External::New → TypeTag chain in toggle.cc; the JsToGIArgument/JsToGValue/element
// coercion chains + boxed/GType/paramspec handle wrapping via the common.h
// NodeGiTo* helpers; ConstructGObject's GetPropertyNames→Length + name loop).
//
// WHAT THIS TEST GUARANTEES — and the CI-safety design:
//
// The deterministic thing the fix guarantees is "no SIGABRT" (the Error::New
// funnel). It does NOT — and cannot — eliminate a SEPARATE, PRE-EXISTING hazard:
// a SIGSEGV when the terminate lands while the worker OS thread is INSIDE a
// blocking GLib C call (repro'd stack: g_str_hash ← g_hash_table_lookup ← ffi ←
// gi_function_info_invoke — NO napi frame). That is the terminating isolate/
// process teardown racing an OS thread stuck in native C code; node-gi has no
// hook once ffi has dispatched into GLib, and it is IDENTICAL on the pre-fix
// build. It can strike EITHER loop shape (both do GI C calls), at a few percent.
//
// So this test must be immune to that SIGSEGV. Two layers:
//   1. ISOLATION — every terminate loop runs ENTIRELY in a spawned CHILD process
//      (spawnSync). The `node --test` runner NEVER terminates a worker itself, so
//      a worker/child SIGSEGV can never crash the runner; it is observed only as
//      the child's exit signal.
//   2. TOLERANCE — the pass condition is "the child did NOT die of SIGABRT
//      (signal 6 / exit 134)". A SIGSEGV (signal 11) or a timeout kill is
//      TOLERATED — those are the documented residual, not the funnel this fix
//      closed. (An earlier version asserted a fully clean method-leg exit; the
//      environmental SIGSEGV can hit the method loop too, so that assertion
//      flaked CI — this is the fix for that.)
// Children run with core dumps disabled (ulimit -c 0) so a SIGSEGV child dies
// instantly instead of blocking on a core-dump handler (which could time the
// child out on CI). Coverage stays strong: each child performs enough terminates
// that if the funnel were OPEN, SIGABRT would be near-certain (pre-fix the
// construction funnel was ~94% per terminate).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const indexUrl = new URL('../index.js', import.meta.url).href;

// The worker hot-loop body per shape. `method` = fresh GObjects via
// callStaticMethod + string marshalling (the MakeGObjectHandle funnel); `construct`
// = newObject with props (the object.cc ConstructGObject/JsToGValue funnels).
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

// One child = `terminates` full spawn-worker → hot-loop → random-dwell →
// terminate cycles, all in this ISOLATED child process. `mainClaims` decides which
// env owns the toggle machinery: false → the WORKER is the owner env (the named
// repro — MakeGObjectHandle's owner path); true → the main thread claims first and
// the worker takes the plain strong-ref wrap path.
function runChild(terminates, mainClaims, shape) {
  const claim = shape === 'construct'
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
    // Disable core dumps in the child (POSIX) so a tolerated SIGSEGV dies instantly
    // rather than blocking on a core-dump handler and risking a spawn timeout on CI.
    // Fall back to a direct spawn where a POSIX shell isn't available (e.g. Windows).
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

// The ONLY deterministic pass condition: the isolated child must not die of the
// Error::New funnel — SIGABRT (signal 6) or its exit-status form 134 (128+6). A
// SIGSEGV (signal 11), a timeout kill (SIGTERM), or a clean exit are all TOLERATED
// (the pre-existing terminate-mid-GLib-C-call residual — see the header). A SIGABRT
// means the funnel this fix closed has regressed.
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

// METHOD/STATIC-CALL loop — the MakeGObjectHandle (toggle.cc) + string-marshalling
// funnels. Owner-env worker (the named repro path) + non-owner (plain strong-ref).
test('terminate: worker.terminate() mid method/static GI-call never SIGABRTs', () => {
  for (let i = 0; i < 3; i++) {
    assertNoSigabrt(runChild(8, false, 'method'), `method owner-worker child ${i}`);
  }
  for (let i = 0; i < 2; i++) {
    assertNoSigabrt(runChild(8, true, 'method'), `method non-owner-worker child ${i}`);
  }
});

// CONSTRUCTION loop — the object.cc ConstructGObject/JsToGValue funnels (pre-fix
// 188/200 SIGABRT). Owner + non-owner env.
test('terminate: worker.terminate() mid-newObject never SIGABRTs (object.cc funnel closed)', () => {
  for (let i = 0; i < 3; i++) {
    assertNoSigabrt(runChild(8, i === 1, 'construct'), `construct child ${i}`);
  }
});
