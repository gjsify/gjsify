// SPDX-License-Identifier: MIT
// @gjsify/napi — P0.3 memory leg 1: load → exercise → exit loop.
// Hammers the crash-class surface (refs incl. primitives, strong/weak
// flips, wrap+finalize death, externals, foreign-tier tags, instance-data
// overwrite) across repeated forced GCs + drains, deletes its refs, then
// exits through full env teardown — the node-gi SIGSEGV location. Run under
// valgrind via test/p03-mem.sh.

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
const GLib = imports.gi.GLib;
if (!GjsifyNapi.init()) throw new Error('init failed');
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

const t = loadAddon('test/lifetime-addon/build/Release/lifetime.node');

function gc() {
    imports.system.gc();
}
function pump() {
    const ctx = GLib.MainContext.default();
    while (ctx.iteration(false)) { /* drain */ }
}

const ROUNDS = 40;
for (let round = 0; round < ROUNDS; round++) {
    // refs: object strong→weak→dead, primitive release, resurrection
    let obj = { round };
    const a = t.makeRef(obj, 1);
    const b = t.makeRef('str-' + round, 1);
    const c = t.makeRef(obj, 0);
    t.refUnref(a);  // a: 1→0 weak
    t.refUnref(b);  // b: primitive released immediately at 0
    t.refRef(c);    // c: 0→1 strong — keeps the object alive
    obj = null;
    gc();
    if (t.refIsEmpty(a)) throw new Error('a should be alive (c holds strong)');
    if (!t.refIsEmpty(b)) throw new Error('b primitive should be released');
    if (t.refGet(c) === undefined) throw new Error('c should be alive');
    t.refUnref(c);  // 1→0 weak — now nothing holds the object
    gc();
    if (!t.refIsEmpty(a)) throw new Error('a should be dead now');
    if (!t.refIsEmpty(c)) throw new Error('c should be dead now');
    t.refDelete(a);
    t.refDelete(b);
    t.refDelete(c);
    t.deleteAllRefs();

    // wrap + finalizer death, external death, add_finalizer death
    let w = t.wrapFinalize({}, 1000 + round);
    let e = t.makeExternal(2000 + round);
    let f = t.addFinalizer({ f: 1 }, 3000 + round);
    let foreign = { foreign: 1 };
    t.wrapFinalize(foreign, 4000 + round);
    t.tagObject(foreign, round % 16);
    if (!t.checkTag(foreign, round % 16)) throw new Error('tag lost');
    w = null;
    e = null;
    f = null;
    foreign = null;
    gc();
    pump();

    // instance data churn (overwrite deletes un-finalized)
    t.setInstanceData(5000 + round);

    t.resetLog();
}

gc();
pump();
print('P0.3 MEM LOOP: DONE');
