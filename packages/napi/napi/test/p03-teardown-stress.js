// SPDX-License-Identifier: MIT
// @gjsify/napi — P0.3 memory leg 2: teardown-while-instances-alive stress.
// Creates MANY live wrapped/tagged/ref'd objects and instance data, keeps
// them reachable until process end, and exits WITHOUT any cleanup — the
// full §5e teardown (cleanup hooks → drain → FinalizeAll(finalizing, plain)
// → root release) must finalize everything exactly once before
// JS_DestroyContext, with no UAF at process exit (the node-gi SIGSEGV
// location). Run under valgrind via test/p03-mem.sh.

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
if (!GjsifyNapi.init()) throw new Error('init failed');
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

const t = loadAddon('test/lifetime-addon/build/Release/lifetime.node');

const N = 64;
const alive = [];
for (let i = 0; i < N; i++) {
    // live wrapped fast-path objects can't exist without define_class here,
    // so use foreign objects (WeakMap tier) + externals (fast tier).
    const obj = { i };
    t.wrapFinalize(obj, 100000 + i);
    t.tagObject(obj, i % 16);
    alive.push(obj);
    alive.push(t.makeExternal(200000 + i));
    t.makeRef(obj, 1); // strong kUserland ref, never deleted
    t.makeRef('pin-' + i, 1); // strong primitive ref, never deleted
}
t.setInstanceData(999999);
t.registerCleanupHooks();
globalThis.__p03KeepAlive = alive; // reachable until context dispose

// A couple of dead-before-teardown objects too (queued + drained mid-life).
for (let i = 0; i < N; i++) {
    t.wrapFinalize({ dead: i }, 300000 + i);
}
imports.system.gc();

print('P0.3 TEARDOWN STRESS: exiting with ' + alive.length + ' live instances');
