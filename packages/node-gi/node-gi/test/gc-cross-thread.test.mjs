// SPDX-License-Identifier: MIT
// CROSS-THREAD GC + toggle-ref stress for @gjsify/node-gi.
//
// The single-threaded gc-identity suite cannot reach the load-bearing concurrency
// paths the toggle-ref bridge exists for. This suite drives GENUINE off-thread
// GObject refcount churn and multi-env (worker_threads) pressure to exercise:
//
//   * NodeGiToggleNotify's OFF-THREAD branch — a background GThread does
//     g_object_ref/g_object_unref on a wrapped GObject, crossing the toggle 1<->2
//     boundary from a non-main thread (MAJOR A: the wrong-flip / lost-toggle bug).
//     Validated to fire tens of thousands of off-thread toggles per run.
//   * The opposite-direction enqueue CANCEL + WakeDrain + the JS-thread drain.
//   * The SHUTDOWN race — a process that exits while a background thread is still
//     firing off-thread toggles, racing OnEnvShutdown's flag-flip + uv_close
//     against an off-thread WakeDrain (MAJOR B: the TOCTOU / data-race abort).
//   * MULTI-ENV safety (worker_threads) — node-gi loaded on several OS threads at
//     once: concurrent owner-claim (compare_exchange) + per-env env-cleanup, no
//     cross-env napi UAF (residual minor: multi-env).
//
// The off-thread vehicle is a TEST-ONLY native helper (__stressRefUnrefOffThread)
// — there is no headless pure-JS way to make another OS thread ref/unref a wrapped
// GObject (GIO local-file async keeps its refcount ops on the main thread). It is
// the "GLib thread doing g_object_ref/unref on a shared object" vehicle the task
// names; it is NOT part of the public API (prefixed __, loaded straight off the
// native addon here, never re-exported from index.js).
//
// Run with `node --test --expose-gc` for the leak/collection assertions; without
// --expose-gc the off-thread churn still runs (GC-gated assertions self-skip).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newObject, callMethod, isGObjectHandle, requireNamespace } from '../index.js';
import { requireGi } from '../gi.js';

const require = createRequire(import.meta.url);
// Resolve the SAME addon index.js loads (require caches native modules by path, so
// this is the identical instance — same env, same toggle machinery). Try Release
// then Debug, mirroring index.js's loader.
const addonPath = ['../build/Release/node_gi.node', '../build/Debug/node_gi.node']
  .map((p) => fileURLToPath(new URL(p, import.meta.url)))
  .find((p) => existsSync(p));
const native = require(addonPath);
const indexUrl = new URL('../index.js', import.meta.url).href;

requireNamespace('Gio', '2.0');
requireNamespace('GObject', '2.0');

const hasGc = typeof globalThis.gc === 'function';
const gcOpts = hasGc ? {} : { skip: 'run with --expose-gc for the GC cases' };
const gc = hasGc ? globalThis.gc : () => {};

async function settle(passes = 4) {
  for (let i = 0; i < passes; i++) {
    gc();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setTimeout(r, 0));
  }
}

// Pump libuv + GC while the background churn thread runs, so the drain (uv_async)
// processes the off-thread toggle queue concurrently with the churn.
async function awaitChurn({ withGc = true, maxPolls = 20000 } = {}) {
  let polls = 0;
  while (native.__stressRefUnrefRunning() && polls < maxPolls) {
    await new Promise((r) => setImmediate(r));
    if (withGc && (polls & 7) === 0) gc();
    polls++;
  }
  assert.equal(native.__stressRefUnrefRunning(), false, 'the off-thread churn finished in time');
}

// ---- 1: off-thread toggle churn on a held object — identity + no crash ----
test('off-thread: a held object survives heavy cross-thread ref/unref churn', async () => {
  const a = newObject('Gio', 'SimpleAction', { name: 'held', enabled: true });
  native.__stressRefUnrefOffThread(a, 40000); // 40k ref + 40k unref = 80k off-thread toggles
  await awaitChurn();
  await settle(2);
  // The toggle ref + the JS-reachable wrapper keep the object alive through every
  // 1<->2 crossing — no wrong-flip collection, no use-after-free.
  assert.equal(isGObjectHandle(a), true, 'the churned handle is intact');
  assert.equal(callMethod(a, 'get_name', []), 'held', 'the object is still usable after churn');
});

// ---- 2: off-thread churn interleaved with collecting many unowned wrappers ----
test('off-thread: churn + concurrent collection stays crash-free + bounded', gcOpts, async () => {
  const a = newObject('Gio', 'SimpleAction', { name: 'anchor', enabled: true });
  native.__stressRefUnrefOffThread(a, 60000);
  let collected = 0;
  const reg = new FinalizationRegistry(() => {
    collected++;
  });
  const N = 400;
  // Create + drop unowned wrappers while the background thread churns `a`: the drain
  // is processing off-thread toggles for `a` at the same time GC is finalizing these.
  (() => {
    for (let i = 0; i < N; i++) {
      const t = newObject('Gio', 'SimpleAction', { name: 'tmp' + i, enabled: (i & 1) === 0 });
      reg.register(t, i);
    }
  })();
  await awaitChurn();
  await settle();
  assert.equal(isGObjectHandle(a), true, 'the anchor survived churn under GC pressure');
  assert.ok(collected >= N * 0.8, `most unowned wrappers collected during churn, got ${collected}`);
  const start = process.memoryUsage().rss / (1024 * 1024);
  assert.ok(start < 1024, `RSS bounded after churn+collection, was ${start.toFixed(0)} MiB`);
});

// ---- 3: a churned object is collectable once dropped (post-churn teardown) ----
test('off-thread: a churned object is collected after its wrapper is dropped', gcOpts, async () => {
  let collected = 0;
  const reg = new FinalizationRegistry(() => {
    collected++;
  });
  await (async () => {
    const a = newObject('Gio', 'SimpleAction', { name: 'drop', enabled: true });
    reg.register(a, 'drop');
    native.__stressRefUnrefOffThread(a, 20000);
    await awaitChurn(); // churn MUST finish before `a` can be freed (else the thread UAFs)
  })();
  await settle();
  assert.equal(collected, 1, 'after churn ends + the wrapper is dropped, the object is collected');
});

// ---- 4: SHUTDOWN race — exit while an off-thread churn is in flight ----
// A child process starts a very long off-thread churn then exits almost immediately,
// so OnEnvShutdown (flag-flip + uv_close, under the lock) races a still-running
// off-thread WakeDrain (uv_async_send, gated on the same lock+flag). A regression
// (the MAJOR B TOCTOU) aborts libuv → non-zero status / a fatal signal. Run several
// times to make the race land.
test('shutdown: exiting mid-churn never aborts (MAJOR B TOCTOU)', () => {
  const script = `
import { newObject, requireNamespace } from ${JSON.stringify(indexUrl)};
import { createRequire } from 'node:module';
const require = createRequire(${JSON.stringify(import.meta.url)});
const native = require(${JSON.stringify(addonPath)});
requireNamespace('Gio','2.0');
// Several background churn threads → many concurrent off-thread WakeDrain calls,
// maximising the chance one lands right as OnEnvShutdown closes the async.
const held = [];
for (let i = 0; i < 8; i++) {
  const a = newObject('Gio','SimpleAction',{ name:'x'+i, enabled:true });
  held.push(a);
  native.__stressRefUnrefOffThread(a, 50000000); // long — still churning at exit
}
// Let JS go idle immediately; the uv_async is unref'd so node exits while the
// background threads are mid-churn → OnEnvShutdown races the off-thread WakeDrain.
`;
  const file = join(tmpdir(), `node-gi-shutdown-race-${process.pid}-${Date.now()}.mjs`);
  writeFileSync(file, script);
  try {
    for (let i = 0; i < 12; i++) {
      const r = spawnSync(process.execPath, [file], { timeout: 15000 });
      assert.equal(r.signal, null, `iter ${i}: exited without a fatal signal (got ${r.signal})`);
      assert.equal(r.status, 0, `iter ${i}: clean exit status (got ${r.status})`);
    }
  } finally {
    rmSync(file, { force: true });
  }
});

// ---- 5: MULTI-ENV — node-gi on several worker_threads concurrently ----
// Each Worker is a separate N-API env on its own OS thread. Concurrent owner-claim
// (compare_exchange) + per-env env-cleanup must not crash or UAF; a non-owner env
// uses the plain strong-ref path (no identity), proven by `ok === 0` below.
test('multi-env: concurrent worker_threads churn is crash-free; per-env shutdown is clean', async () => {
  // Main thread claims toggle-machinery ownership first.
  newObject('Gio', 'SimpleActionGroup', {});
  const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { newObject, callMethod, requireNamespace } = await import(workerData.index);
      requireNamespace('Gio', '2.0');
      let ok = 0;
      for (let i = 0; i < 4000; i++) {
        const g = newObject('Gio', 'SimpleActionGroup', {});
        const a = newObject('Gio', 'SimpleAction', { name: 'w', enabled: (i & 1) === 0 });
        callMethod(g, 'add_action', [a]);
        const back = callMethod(g, 'lookup_action', ['w']);
        if (back === a) ok++;
      }
      parentPort.postMessage({ ok });
    })().catch((e) => { parentPort.postMessage({ error: String(e && e.message || e) }); });
  `;
  const spawnWorker = () =>
    new Promise((resolve, reject) => {
      const w = new Worker(workerCode, { eval: true, workerData: { index: indexUrl } });
      w.on('message', resolve);
      w.on('error', reject);
      w.on('exit', (code) => {
        if (code !== 0) reject(new Error('worker exit ' + code));
      });
    });
  const workers = [spawnWorker(), spawnWorker(), spawnWorker(), spawnWorker()];
  // Main thread churns concurrently with the workers.
  for (let i = 0; i < 4000; i++) {
    const g = newObject('Gio', 'SimpleActionGroup', {});
    const a = newObject('Gio', 'SimpleAction', { name: 'm', enabled: true });
    callMethod(g, 'add_action', [a]);
    assert.strictEqual(callMethod(g, 'lookup_action', ['m']), a, 'owner-env identity holds');
    if ((i & 0x3ff) === 0) gc();
  }
  const results = await Promise.all(workers);
  for (const r of results) {
    assert.equal(r.error, undefined, `worker ran without error: ${r.error}`);
    // A non-owner env takes the plain strong-ref path → no wrapper identity.
    assert.equal(r.ok, 0, 'a non-owner (worker) env does not get wrapper identity (plain-ref path)');
  }
  await settle(2);
  const mb = process.memoryUsage().rss / (1024 * 1024);
  assert.ok(mb < 1024, `RSS bounded after multi-env soak, was ${mb.toFixed(0)} MiB`);
});

// ---- 6: MULTI-ENV — terminate a busy worker; the owner env keeps working ----
// A worker exiting (its env cleanup runs) must not disable the OWNER env's drain
// async or set the global shutdown flag (per-env OnEnvShutdown gate).
test('multi-env: terminating busy workers leaves the owner env fully working', async () => {
  const busyCode = `
    const { workerData } = require('node:worker_threads');
    (async () => {
      const { newObject, callMethod, requireNamespace } = await import(workerData.index);
      requireNamespace('Gio', '2.0');
      for (;;) {
        const g = newObject('Gio', 'SimpleActionGroup', {});
        const a = newObject('Gio', 'SimpleAction', { name: 'b', enabled: true });
        callMethod(g, 'add_action', [a]);
      }
    })();
  `;
  for (let i = 0; i < 6; i++) {
    const w = new Worker(busyCode, { eval: true, workerData: { index: indexUrl } });
    await new Promise((r) => setTimeout(r, 25)); // let it get busy
    await w.terminate();
  }
  // The owner env must still wrap with identity + toggle correctly after the churn.
  const Gio = requireGi('Gio', '2.0');
  const group = new Gio.SimpleActionGroup();
  const action = new Gio.SimpleAction({ name: 'after', enabled: true });
  group.add_action(action);
  assert.strictEqual(group.lookup_action('after'), action, 'owner env intact after worker teardown');
  await settle(2);
});

// ---- 7: randomized concurrency soak (the non-deterministic safety net) ----
test('soak: randomized off-thread churn + main churn + GC stays crash-free', gcOpts, async () => {
  for (let round = 0; round < 6; round++) {
    const a = newObject('Gio', 'SimpleAction', { name: 'r' + round, enabled: true });
    const iters = 5000 + Math.floor(Math.random() * 25000);
    native.__stressRefUnrefOffThread(a, iters);
    // Main churn + round-trips while the background thread fires off-thread toggles.
    while (native.__stressRefUnrefRunning()) {
      const g = newObject('Gio', 'SimpleActionGroup', {});
      const b = newObject('Gio', 'SimpleAction', { name: 'soak', enabled: (round & 1) === 0 });
      callMethod(g, 'add_action', [b]);
      assert.strictEqual(callMethod(g, 'lookup_action', ['soak']), b, 'identity holds during churn');
      if (Math.random() < 0.2) gc();
      await new Promise((r) => setImmediate(r));
    }
    assert.equal(callMethod(a, 'get_name', []), 'r' + round, 'churned object usable after the round');
  }
  await settle();
  const mb = process.memoryUsage().rss / (1024 * 1024);
  assert.ok(mb < 1024, `RSS bounded after randomized soak, was ${mb.toFixed(0)} MiB`);
});
