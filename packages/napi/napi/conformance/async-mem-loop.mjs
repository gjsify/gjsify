// SPDX-License-Identifier: MIT
// @gjsify/napi — async_work memory leg (valgrind memcheck target).
//
// Drives the async_work lifecycle — create → queue → (inline execute) →
// complete (idle) → delete — in a GC-stressed loop, then exits so env teardown
// runs. This is the crash class async_work must never hit: the pending-GSource
// lifetime, the self-delete inside complete, and the teardown drain of a work
// whose completion never got a loop turn. Output is silenced; only valgrind's
// ERROR SUMMARY matters. Both node-api addons #include <uv.h>, so the runner
// preloads the host libuv.
//
// Two complementary lifecycle shapes are exercised:
//   • test_async DoRepeatedWork  — Complete deletes the work + ref (the full
//     create→queue→complete→DELETE cycle, delete happening INSIDE complete);
//   • test_instance_data asyncWorkCallback — Complete never deletes the work,
//     so it is freed by the env destructor (destroy_env_async_works) instead.
// A final un-awaited DoRepeatedWork leaves a completion pending at exit, so the
// teardown drain (drain_env_async_works) is exercised too.
//
// Run standalone (no valgrind):
//   GI_TYPELIB_PATH=prebuilds/linux-x86_64 LD_LIBRARY_PATH=prebuilds/linux-x86_64 \
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
    // create -> queue -> inline execute -> complete (idle) -> delete-in-complete
    await new Promise((resolve) => repeated.DoRepeatedWork(() => resolve()));
    // create -> queue -> complete (idle); the work is NEVER deleted by the
    // addon -> freed at env destruction.
    await new Promise((resolve) => instance.asyncWorkCallback(() => resolve()));
    if (i % 8 === 0) system.gc();
}
system.gc();

// Leave one completion pending at exit -> the teardown drain must run it (and
// its delete-in-complete) while JS is still callable.
repeated.DoRepeatedWork(() => {});
system.gc();
