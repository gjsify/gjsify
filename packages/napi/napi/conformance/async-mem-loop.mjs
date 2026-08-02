// SPDX-License-Identifier: MIT
// @gjsify/napi — async_work memory leg (valgrind memcheck target).
//
// Drives the async_work lifecycle — create → queue → (POOLED-WORKER execute) →
// complete (idle) → delete — in a GC-stressed loop, then exits so env teardown
// runs. This is the crash class async_work must never hit: the pending-GSource
// lifetime, the self-delete inside complete, the cross-thread worker→JS-thread
// dispatch, and the teardown JOIN of a pool with a worker still mid-execute.
// Output is silenced; only valgrind's ERROR SUMMARY matters. Both node-api
// addons #include <uv.h>, so the runner preloads the host libuv.
//
// Three complementary lifecycle shapes are exercised:
//   • test_async DoRepeatedWork  — Complete deletes the work + ref (the full
//     create→queue→worker-execute→complete→DELETE cycle, delete INSIDE complete);
//   • test_instance_data asyncWorkCallback — Complete never deletes the work,
//     so it is freed by the env destructor (destroy_env_async_works) instead.
//   • test_async TestCancel — saturates the worker pool with 1-second sleeping
//     works and cancels one (queue-then-cancel on a still-queued item), then
//     issued ONE more time UN-AWAITED at the very end so several workers are
//     still INSIDE execute (uv_sleep) when the module ends and env teardown
//     calls g_thread_pool_free(wait=TRUE). That join must wait the workers out
//     deterministically — the §5e crash-class boundary: no worker may touch a
//     torn-down env, and the pool must drain BEFORE any root is dropped.
// A final un-awaited DoRepeatedWork also leaves a completion pending at exit, so
// the teardown drain (drain_env_async_works) of an armed-but-unfired complete
// is exercised too.
//
// Run standalone (no valgrind):
//   GI_TYPELIB_PATH=../napi-linux-x64/prebuilds/linux-x64 \
//   LD_LIBRARY_PATH=../napi-linux-x64/prebuilds/linux-x64 \
//     LD_PRELOAD=/usr/lib64/libuv.so.1 gjs -m conformance/async-mem-loop.mjs
import GjsifyNapi from 'gi://GjsifyNapi?version=1.0';
import GLib from 'gi://GLib?version=2.0';
import system from 'system';

GjsifyNapi.init();
const load = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

const here = GLib.path_get_dirname(import.meta.url.replace(/^file:\/\//, ''));
const rel = (dir, target) => `${here}/dist/build-tree/node-api/${dir}/build/Release/${target}.node`;
const repeated = load(rel('test_async', 'test_async'));
const instance = load(rel('test_instance_data', 'test_instance_data'));

const ITER = Number(GLib.getenv('NAPI_MEM_ITER') || '200');
for (let i = 0; i < ITER; i++) {
    // create -> queue -> WORKER execute -> complete (idle) -> delete-in-complete
    await new Promise((resolve) => repeated.DoRepeatedWork(() => resolve()));
    // create -> queue -> complete (idle); the work is NEVER deleted by the
    // addon -> freed at env destruction.
    await new Promise((resolve) => instance.asyncWorkCallback(() => resolve()));
    if (i % 8 === 0) system.gc();
}
system.gc();

// Teardown-while-worker-mid-execute (the risky corner) + queue-then-cancel, in
// one shot: fire TestCancel ONCE and DO NOT await it. It saturates the pool with
// 1-second uv_sleep busy works and cancels a still-queued target, then the
// module ends IMMEDIATELY — so several workers are still inside execute when env
// teardown's g_thread_pool_free(pool, FALSE, TRUE) JOINS them before any root is
// dropped (the §5e boundary: no worker may touch a torn-down env). The cancel
// target's napi_cancelled completion + the busy works' completions + a pending
// DoRepeatedWork are then run by the teardown drain, JS still callable. Only ONE
// TestCancel: test_async's STATIC async_carrier[] must not be reused while a
// prior call's 1-second busy works are still in flight.
repeated.DoRepeatedWork(() => {});
repeated.TestCancel(() => {});
system.gc();
