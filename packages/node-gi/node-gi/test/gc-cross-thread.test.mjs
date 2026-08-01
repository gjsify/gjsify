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
//   * CROSS-ENV CACHE-HIT (DEFECT 1) — a worker env that obtains a process-shared
//     GObject singleton (Gio.Vfs.get_default()) the OWNER env already wrapped must
//     NOT deref the owner-isolate napi_ref from WrapGObject's cache-hit fast path.
//   * REENTRANT DRAIN (DEFECT 2) — a registerClass vfunc_dispose that re-enters the
//     engine (wraps GObjects) DURING the idle teardown drain, with other teardowns
//     pending in the SAME drain: a swap-snapshot would double-free a resurrected
//     sibling; popping the live queue one-at-a-time keeps it cancellable.
//   * DRAIN LOCK LIVENESS — the queue lock is NOT held across a teardown's dispose
//     vfunc: an off-thread churn keeps progressing while a dispose blocks the main
//     thread (a held-across-dispose lock would freeze it → priority inversion / ABBA).
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

import { newObject, callMethod, callStaticMethod, isGObjectHandle, requireNamespace } from '../index.js';
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
const giUrl = new URL('../gi.js', import.meta.url).href;

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
// processes the off-thread toggle queue concurrently with the churn, then GUARANTEE
// the churn thread is no longer touching the object before the caller proceeds.
//
// IMPORTANT: this does NOT assert the churn finished within a poll budget. On a
// loaded CI runner the background thread can be starved long enough that 80k
// off-thread toggles haven't all landed by `maxPolls` — that is a scheduling
// artifact, NOT a correctness failure, and asserting on it flaked CI twice (#658,
// #663: `expected false, actual true`). Instead, if the churn is still running past
// the budget we ask it to stop COOPERATIVELY and wait for it to actually finish, so
// the thread has provably released the object (tests that then drop/free it can't
// UAF). The churn path is still genuinely exercised either way.
async function awaitChurn({ withGc = true, maxPolls = 20000 } = {}) {
    let polls = 0;
    while (native.__stressRefUnrefRunning() && polls < maxPolls) {
        await new Promise((r) => setImmediate(r));
        if (withGc && (polls & 7) === 0) gc();
        polls++;
    }
    if (native.__stressRefUnrefRunning()) {
        native.__stressRefUnrefStop(); // cooperative halt — the thread breaks its loop
        while (native.__stressRefUnrefRunning()) {
            await new Promise((r) => setImmediate(r));
        }
    }
}

// ---- 1: off-thread toggle churn on a held object — identity + no crash ----
test('off-thread: a held object survives heavy cross-thread ref/unref churn', async () => {
    // `held` is a STRONG, function-scoped JS ref to the wrapper — it pins the object
    // for the entire churn + assert window, so the wrapper cannot be GC-collected
    // mid-test regardless of GC timing. Combined with the toggle ref, the object
    // stays alive at refcount 1 between churn pairs, so every off-thread 1<->2
    // crossing is a real toggle, never a use-after-free.
    const held = newObject('Gio', 'SimpleAction', { name: 'held', enabled: true });
    native.__stressRefUnrefOffThread(held, 40000); // 40k ref + 40k unref = 80k off-thread toggles
    await awaitChurn(); // genuinely exercises the off-thread toggle path (no timing assert)
    await settle(2);
    // Identity/usability hold after the churn — no wrong-flip collection, no UAF. These
    // are state assertions on a pinned object, not GC-timing assertions, so they are
    // deterministic.
    assert.equal(isGObjectHandle(held), true, 'the churned handle is intact');
    assert.equal(callMethod(held, 'get_name', []), 'held', 'the object is still usable after churn');
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

// ---- 4b: ENV-CLEANUP drain — teardowns pending at loop exit never abort ----
// The (formerly ~1%) CI abort "FATAL ERROR: Error::ThrowAsJavaScriptException
// napi_throw", made deterministic. Choreography: wrappers of a registered class
// with a JS vfunc_dispose are GC'd in the process's FINAL event-loop turn, so
// their idle teardowns are queued and the (deliberately unref'd) drain-TSFN wake
// is still PENDING when the loop exits. node::FreeEnvironment then sets
// can_call_into_js=false and Environment::RunCleanup() runs CleanupHandles()
// (uv_run) BEFORE draining the env-cleanup hooks — i.e. the pending wake
// dispatches the drain BEFORE OnEnvShutdown can flip g_toggle_shutdown. Pre-fix,
// RunTeardown dropped the last toggle ref → dispose → vfunc_dispose re-entered
// N-API on the no-longer-JS-capable env → node-addon-api's noexcept throw path →
// napi_fatal_error abort. The fix gates the drain + every C→JS trampoline on a
// JS-availability probe (napi_strict_equals, NAPI_PREAMBLE-gated upstream).
// NODE_GI_TOGGLE_TEARDOWN_DELAY_MS (test-only latency seam) holds queued
// teardowns back so the pending-at-exit state is reached even if GC/loop phasing
// shifts across Node versions — both seam-on and seam-off legs must be clean.
test('shutdown: teardown drain during env cleanup never aborts (vfunc_dispose at exit)', () => {
    const script = `
import { requireGi } from ${JSON.stringify(giUrl)};
const GObject = requireGi('GObject', '2.0');
const Gio = requireGi('Gio', '2.0');
class Disposer extends GObject.Object {
  vfunc_dispose() {
    // Re-enter the engine from dispose — the exact JS re-entry of the crash stack
    // (WrapGObject/MakeGObjectHandle + method invokes on a fresh GObject).
    const g = new Gio.SimpleActionGroup();
    g.add_action(new Gio.SimpleAction({ name: 'x', enabled: true }));
  }
}
const Klass = GObject.registerClass({ GTypeName: 'NodeGiExitDrainDisposer' }, Disposer);
(() => { for (let i = 0; i < 8; i++) new Klass(); })();
// Collect in the LAST turn: the wrappers' napi finalizers queue idle teardowns +
// send the unref'd TSFN wake, then the loop exits with the wake still pending →
// RunCleanup's CleanupHandles() dispatches it against the dying env.
globalThis.gc();
`;
    const file = join(tmpdir(), `node-gi-exit-drain-${process.pid}-${Date.now()}.mjs`);
    writeFileSync(file, script);
    try {
        for (let i = 0; i < 8; i++) {
            const seamOn = i % 2 === 0;
            // The seam-off leg clears the var explicitly — an outer seam-enabled stress
            // run must not leak it into this leg ('' parses to 0 = seam disabled).
            const r = spawnSync(process.execPath, ['--expose-gc', file], {
                timeout: 15000,
                env: { ...process.env, NODE_GI_TOGGLE_TEARDOWN_DELAY_MS: seamOn ? '50' : '' },
            });
            const tag = `iter ${i} (seam ${seamOn ? 'on' : 'off'})`;
            assert.equal(r.signal, null, `${tag}: exited without a fatal signal (got ${r.signal})`);
            assert.equal(r.status, 0, `${tag}: clean exit status (got ${r.status}): ${r.stderr}`);
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

// ---- 8: DEFECT 1 — cross-env cache-hit on a process-shared singleton ----
// The OWNER env wraps a process-global singleton S (Gio.Vfs.get_default()), setting
// qdata(S)=ownerInst. A worker env independently obtains the SAME S via the SAME
// static getter and wraps it. Pre-fix, WrapGObject's cache-hit fast path derefed
// ownerInst->handle_ref (a napi_ref rooted in the OWNER isolate) from the WORKER
// isolate → cross-env UAF / V8 abort. Post-fix the worker sees inst->env != its env
// and takes the plain strong-ref path. Asserts every worker completes (no crash) and
// can USE the singleton it fetched.
test('cross-env: a worker wrapping a singleton the owner cached does not UAF (DEFECT 1)', async () => {
    // Owner wraps S first and HOLDS it, so qdata(S)=ownerInst stays set for the workers.
    const ownerVfs = callStaticMethod('Gio', 'Vfs', 'get_default', []);
    assert.equal(isGObjectHandle(ownerVfs), true);
    assert.strictEqual(
        callStaticMethod('Gio', 'Vfs', 'get_default', []),
        ownerVfs,
        'owner-env identity holds for the singleton',
    );
    const workerCode = `
    const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { callStaticMethod, callMethod, isGObjectHandle, requireNamespace } =
        await import(workerData.index);
      requireNamespace('Gio', '2.0');
      let used = 0;
      for (let i = 0; i < 1500; i++) {
        // Fetch the SAME process-global singleton the OWNER already wrapped+cached.
        const vfs = callStaticMethod('Gio', 'Vfs', 'get_default', []);
        if (!isGObjectHandle(vfs)) throw new Error('not a GObject handle');
        // Use it (a real method call on a cross-env-shared singleton).
        const schemes = callMethod(vfs, 'get_supported_uri_schemes', []);
        if (Array.isArray(schemes)) used++;
      }
      parentPort.postMessage({ used });
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
    const results = await Promise.all([spawnWorker(), spawnWorker(), spawnWorker(), spawnWorker()]);
    for (const r of results) {
        assert.equal(r.error, undefined, `worker ran without a cross-env crash: ${r.error}`);
        assert.equal(r.used, 1500, 'the worker used the cross-env-shared singleton every time');
    }
    // The owner's wrapper is still valid + identical after the workers churned the singleton.
    assert.strictEqual(callStaticMethod('Gio', 'Vfs', 'get_default', []), ownerVfs);
});

// ---- 9: DEFECT 2 — reentrant wrap during the teardown drain ----
// A registerClass vfunc_dispose runs DURING the idle teardown drain (its instance
// reached refcount 0 when RunTeardown dropped the toggle ref). Inside it we re-enter
// the engine — create + round-trip GObjects AND resurrect a sibling. With many such
// instances dropped together, their teardowns batch into ONE drain, so each dispose
// re-enters while OTHER teardowns are still pending. This validates the DEFECT-2 fix:
//   * recursive lock — the reentrant WrapGObject re-acquires g_queue_mutex on the
//     drain thread; a non-recursive lock-across-drain would SELF-DEADLOCK (this test
//     would hang → the runner times out);
//   * pop-the-LIVE-queue — a reentrant SettleCollectedInstance can still see + cancel
//     a pending sibling teardown (a swap-snapshot would double-free it).
test('reentrant-drain: vfunc_dispose re-entering the engine mid-drain is safe (DEFECT 2)', gcOpts, async () => {
    const GObject = requireGi('GObject', '2.0');
    const Gio = requireGi('Gio', '2.0');
    let disposed = 0;
    let reentrantOk = 0;
    let resurrectOk = 0;
    // A shared group whose action is dropped+re-created each dispose, so a dispose can
    // resurrect a just-collected sibling action (exercising SettleCollectedInstance
    // reentrancy from inside the drain).
    // A shared group holding a 'shared' action whose wrapper goes weak between disposes,
    // so a dispose's re-fetch re-enters WrapGObject for a GObject mid-lifecycle.
    const group = new Gio.SimpleActionGroup();
    class Disposer extends GObject.Object {
        vfunc_dispose() {
            disposed++;
            // (a) plain reentrant create + round-trip identity from inside a teardown dispose.
            const g = new Gio.SimpleActionGroup();
            const a = new Gio.SimpleAction({ name: 'r', enabled: true });
            g.add_action(a);
            if (g.lookup_action('r') === a) reentrantOk++;
            // (b) re-fetch + churn a sibling from the shared group: re-enters WrapGObject
            // (resurrection path) from inside the drain. Must not crash.
            const prev = group.lookup_action('shared');
            if (prev !== undefined) resurrectOk++;
            group.remove_action('shared');
            group.add_action(new Gio.SimpleAction({ name: 'shared', enabled: true }));
        }
    }
    const Klass = GObject.registerClass({ GTypeName: 'NodeGiReentrantDrainDisposer' }, Disposer);
    group.add_action(new Gio.SimpleAction({ name: 'shared', enabled: true }));
    for (let round = 0; round < 30; round++) {
        // Batch: create many, drop them all, then GC so their teardowns drain together.
        (() => {
            for (let i = 0; i < 25; i++) new Klass();
        })();
        await settle(2);
    }
    // Teardown dispatch timing is deliberately unguaranteed (idle-deferred, and the
    // NODE_GI_TOGGLE_TEARDOWN_DELAY_MS seam defers it further) — wait boundedly for
    // the queued disposals to land before asserting; the assertions are unchanged.
    {
        const deadline = Date.now() + 5000;
        let last = -1;
        while (disposed < 30 * 25 && Date.now() < deadline) {
            if (disposed === last) gc();
            last = disposed;
            await settle(1);
        }
    }
    assert.ok(disposed >= 30 * 25 * 0.8, `most disposers ran their vfunc_dispose, got ${disposed}`);
    assert.equal(reentrantOk, disposed, 'reentrant create+round-trip identity held in every dispose');
    assert.equal(resurrectOk, disposed, 'reentrant sibling resurrection was safe in every dispose');
    // The engine is still fully functional after all the reentrant drains.
    const g = new Gio.SimpleActionGroup();
    const a = new Gio.SimpleAction({ name: 'after', enabled: true });
    g.add_action(a);
    assert.strictEqual(g.lookup_action('after'), a, 'identity + toggle accounting intact after reentrant drains');
    const mb = process.memoryUsage().rss / (1024 * 1024);
    assert.ok(mb < 1024, `RSS bounded after reentrant-drain stress, was ${mb.toFixed(0)} MiB`);
});

// ---- 10: LIVENESS — the drain lock is NOT held across a dispose vfunc ----
// A teardown's dispose must not stall off-thread toggles. We start an off-thread
// ref/unref churn (each iteration acquires g_queue_mutex from another thread), then
// trigger a registerClass teardown whose vfunc_dispose BLOCKS the main thread inside
// the dispose and watches the off-thread progress counter. If the drain held the lock
// across dispose (the round-2 over-broad scope), the off-thread NodeGiToggleNotify
// would block on the lock and progress would freeze for the whole dispose. With the
// lock released before RunTeardown, the off-thread churn keeps advancing → proves the
// no-lock-across-dispose invariant (kills the priority-inversion + ABBA-deadlock risk).
test('liveness: off-thread toggles progress while a dispose vfunc runs', gcOpts, async () => {
    const GObject = requireGi('GObject', '2.0');
    // Long off-thread churn on a HELD object (kept reachable → never collected/freed).
    const churned = newObject('Gio', 'SimpleAction', { name: 'churn', enabled: true });
    native.__stressRefUnrefOffThread(churned, 50_000_000);
    // Wait until the churn thread is actually advancing before we test.
    {
        const p0 = native.__stressRefUnrefProgress();
        let tries = 0;
        while (native.__stressRefUnrefProgress() <= p0 && tries++ < 2000) {
            await new Promise((r) => setImmediate(r));
        }
        assert.ok(native.__stressRefUnrefProgress() > p0, 'off-thread churn started');
    }

    let disposeRan = false;
    let advancedDuringDispose = false;
    class Blocker extends GObject.Object {
        vfunc_dispose() {
            disposeRan = true;
            const p0 = native.__stressRefUnrefProgress();
            const start = Date.now();
            // Stay INSIDE the dispose (block the main thread) up to 1s, exiting as soon as
            // the off-thread churn advances. Lock-released → advances within ms; lock-held
            // (regression) → never advances → spins the full second → stays false.
            while (Date.now() - start < 1000) {
                if (native.__stressRefUnrefProgress() > p0 + 5) {
                    advancedDuringDispose = true;
                    break;
                }
            }
        }
    }
    const Klass = GObject.registerClass({ GTypeName: 'NodeGiDisposeLiveness' }, Blocker);
    (() => {
        new Klass();
    })();
    await settle(3); // GC → teardown drain → Blocker.vfunc_dispose runs the liveness probe
    // Teardown dispatch timing is unguaranteed (idle-deferred; the
    // NODE_GI_TOGGLE_TEARDOWN_DELAY_MS seam defers it further) — wait boundedly for
    // the dispose to actually run before stopping the churn + asserting.
    {
        const deadline = Date.now() + 5000;
        while (!disposeRan && Date.now() < deadline) {
            gc();
            await settle(1);
        }
    }
    native.__stressRefUnrefStop(); // halt the long churn now that we're done
    assert.equal(disposeRan, true, 'the Blocker teardown disposed within the wait budget');
    assert.equal(
        advancedDuringDispose,
        true,
        'off-thread churn progressed during the dispose → the drain lock is not held across dispose',
    );
});
