// SPDX-License-Identifier: MIT
// @gjsify/napi — async_work memory leg (valgrind memcheck target).
//
// Drives the async_work lifecycle — create → queue → (pooled-worker execute) →
// complete (idle) → delete — in a GC-stressed loop, then exits so env teardown
// runs. The crash classes covered: pending-GSource lifetime, self-delete inside
// complete, cross-thread worker→JS-thread dispatch, and the teardown join of a
// pool with a worker still mid-execute. Prints nothing; only valgrind's ERROR
// SUMMARY matters. Both node-api addons #include <uv.h>, so the runner preloads
// the host libuv.
//
// Three lifecycle shapes:
//   • test_async DoRepeatedWork — Complete deletes the work + ref (delete INSIDE
//     complete);
//   • test_instance_data asyncWorkCallback — Complete never deletes the work, so
//     the env destructor (destroy_env_async_works) frees it;
//   • test_async TestCancel — saturates the worker pool with 1-second sleeping
//     works and cancels a still-queued one, issued UN-AWAITED at the very end so
//     several workers are still inside execute (uv_sleep) when env teardown
//     calls g_thread_pool_free(wait=TRUE). That join must drain the pool BEFORE
//     any root is dropped: no worker may touch a torn-down env.
// A final un-awaited DoRepeatedWork leaves an armed-but-unfired complete at exit,
// exercising the teardown drain (drain_env_async_works).
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
    // delete-in-complete
    await new Promise((resolve) => repeated.DoRepeatedWork(() => resolve()));
    // never deleted by the addon -> freed at env destruction
    await new Promise((resolve) => instance.asyncWorkCallback(() => resolve()));
    if (i % 8 === 0) system.gc();
}
system.gc();

// Teardown-while-worker-mid-execute + queue-then-cancel in one shot: TestCancel
// is fired UN-awaited, so the module ends while several workers are still inside
// uv_sleep and teardown's g_thread_pool_free(pool, FALSE, TRUE) must join them
// before any root is dropped. The cancelled completion, the busy works' and the
// pending DoRepeatedWork are then run by the teardown drain, JS still callable.
// Only ONE TestCancel: test_async's STATIC async_carrier[] must not be reused
// while a prior call's 1-second busy works are still in flight.
repeated.DoRepeatedWork(() => {});
repeated.TestCancel(() => {});
system.gc();
