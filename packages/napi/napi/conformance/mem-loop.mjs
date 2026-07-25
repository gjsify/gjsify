// SPDX-License-Identifier: MIT
// @gjsify/napi — conformance memory leg body (valgrind memcheck target).
//
// Loads several UNMODIFIED Node N-API test addons through the shim and runs
// their conformance programs in a GC-stressed load→run→exit loop, then exits.
// Driven under valgrind by scripts/conformance-mem.sh — focus is memory ERRORS
// (invalid read/write/UAF) across repeated addon exercise + forced GC, the
// crash class the shim must never hit. Output is silenced (write = no-op); only
// valgrind's ERROR SUMMARY matters.
//
// Run standalone (no valgrind):
//   GI_TYPELIB_PATH=prebuilds/linux-x86_64 LD_LIBRARY_PATH=prebuilds/linux-x86_64 \
//     gjs -m conformance/mem-loop.mjs
import GjsifyNapi from 'gi://GjsifyNapi?version=1.0';
import GLib from 'gi://GLib?version=2.0';
import system from 'system';
import { makeHarness } from './harness/harness.mjs';
import numberProg from './programs/test_number.mjs';
import arrayProg from './programs/test_array.mjs';
import ctorProg from './programs/test_constructor.mjs';
import convProg from './programs/test_conversions.mjs';
import errorProg from './programs/test_error.mjs';
import wrapProg from './programs/6_object_wrap.mjs';

GjsifyNapi.init();
const load = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

const here = GLib.path_get_dirname(import.meta.url.replace(/^file:\/\//, ''));
const rel = (dir, target) => `${here}/dist/build-tree/js-native-api/${dir}/build/Release/${target}.node`;
const PATHS = {
    test_number: rel('test_number', 'test_number'),
    test_array: rel('test_array', 'test_array'),
    test_constructor: rel('test_constructor', 'test_constructor'),
    test_conversions: rel('test_conversions', 'test_conversions'),
    test_error: rel('test_error', 'test_error'),
    myobject: rel('6_object_wrap', 'myobject'),
};

const h = makeHarness({
    loadAddon: (n) => load(PATHS[n]),
    write: () => {}, // silence — valgrind's ERROR SUMMARY is the signal
    gc: () => system.gc(),
    tick: () => {
        while (GLib.MainContext.default().iteration(false)) {}
        return Promise.resolve();
    },
});

const programs = [numberProg, arrayProg, ctorProg, convProg, errorProg, wrapProg];
const ITER = Number(GLib.getenv('NAPI_MEM_ITER') || '25');
for (let i = 0; i < ITER; i++) {
    for (const p of programs) await p(h);
    if (i % 3 === 0) system.gc();
}
system.gc();
