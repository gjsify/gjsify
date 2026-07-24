// SPDX-License-Identifier: MIT
// @gjsify/napi — P0.0 LOAD GATE (plan §9 P0.0 / §11 milestone 1).
//
// Runs as a legacy GJS script (imports.gi + ARGV + print available):
//
//   cd packages/napi/napi
//   GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build \
//     timeout 30 gjs test/load-gate.js test/hello-addon/build/Release/hello.node
//
// Success criterion: the node-gyp-built hello.node loads through the shim,
// exports.hello() === 'hi', printed as `P0.0 LOAD GATE: PASS`. The §3d
// teardown probe then fires at GjsContext dispose (after this script ends) —
// look for the `[gjsify-napi] P0.0 TEARDOWN PROBE` lines on stderr.

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;

// Bootstrap (§3a): ONE introspectable call installs the loader native.
if (!GjsifyNapi.is_available()) throw new Error('GjsifyNapi typelib not loaded');
if (!GjsifyNapi.init()) throw new Error('GjsifyNapi.init() failed — no JSContext?');
if (GjsifyNapi.init() !== true) throw new Error('init() must be idempotent');

// Capture + delete the bootstrap global (the L1 does the same).
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
if (typeof loadAddon !== 'function') throw new Error('__gjsifyNapiLoadAddon not installed');
delete globalThis.__gjsifyNapiLoadAddon;
if (typeof globalThis.__gjsifyNapiLoadAddon !== 'undefined') {
    throw new Error('__gjsifyNapiLoadAddon must be configurable (deletable)');
}

const addonPath = ARGV[0] ?? 'test/hello-addon/build/Release/hello.node';

// Load failure = a real JS exception with a real message (§3a).
let threw = false;
try {
    loadAddon('/nonexistent/no-such-addon.node');
} catch (err) {
    threw = true;
    if (!String(err.message).includes('cannot resolve addon path')) {
        throw new Error(`unexpected load-error message: ${err.message}`);
    }
}
if (!threw) throw new Error('loading a nonexistent addon must throw');

// The gate proper.
const exports1 = loadAddon(addonPath);
if (typeof exports1 !== 'object' || exports1 === null) {
    throw new Error('loadAddon must return the exports object');
}
if (typeof exports1.hello !== 'function') {
    throw new Error('exports.hello must be a function');
}
const got = exports1.hello();
if (got !== 'hi') throw new Error(`exports.hello() returned ${JSON.stringify(got)}, expected 'hi'`);

// Repeat calls keep working (fresh handle scope per trampoline invocation).
for (let i = 0; i < 1000; i++) {
    if (exports1.hello() !== 'hi') throw new Error(`call ${i} diverged`);
}

// Forced full GC between calls: arena slots are traced (and relocated) by the
// per-env extra-roots tracer, so the addon's exports + calls survive GC.
imports.system.gc();
if (exports1.hello() !== 'hi') throw new Error('hello() diverged after GC');

// Cache: a second loadAddon of the same realpath replays the SAME exports.
const exports2 = loadAddon(addonPath);
if (exports2 !== exports1) throw new Error('second loadAddon must return cached exports');

print('P0.0 LOAD GATE: PASS');
