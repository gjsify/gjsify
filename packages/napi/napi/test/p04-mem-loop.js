// SPDX-License-Identifier: MIT
// @gjsify/napi — P0.4 memory leg: buffer create → GC → free loop.
// Hammers the P0.4 allocation paths that touch native memory: stable-contents
// buffers (malloc'd, freed by SM at collection), the external-buffer
// free-callback path (SM no-op deleter + the user finalizer that frees the
// data on the §5c drain — the new free path P0.4 adds), buffer_copy, typed
// array / dataview info (§5f EnsureNonInline out-of-line pinning), plus
// promises/dates/bigint, across repeated forced GCs + drains, then exits
// through full env teardown. Run under valgrind via test/p04-mem.sh.

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
const GLib = imports.gi.GLib;
if (!GjsifyNapi.init()) throw new Error('init failed');
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

const t = loadAddon('test/buffer-addon/build/Release/buffer.node');

function gc() {
    imports.system.gc();
}
function pump() {
    const ctx = GLib.MainContext.default();
    while (ctx.iteration(false)) {
        /* drain */
    }
}

const ROUNDS = 40;
for (let round = 0; round < ROUNDS; round++) {
    // stable-contents buffer create + fill + read-back across GC
    let buf = t.createPattern(16 + (round % 48));
    if (!t.createdPtrStable(buf)) throw new Error('created ptr moved');
    gc();
    if (!t.patternIntact(buf)) throw new Error('pattern corrupted after GC');
    let copy = t.copyOf(buf);
    t.nativeSetByte(copy, 0, 0xab);
    buf = null;
    copy = null;

    // external (zero-copy) buffer: dies + user finalizer frees the data
    let ext = t.makeExternal(24 + (round % 32));
    if (t.nativeByteAt(ext, 3) !== ((3 * 7 + 3) & 0xff)) {
        throw new Error('external byte wrong');
    }
    ext = null;

    // foreign view §5f pin + typed array / dataview info
    const foreign = new Uint8Array(20);
    for (let i = 0; i < 20; i++) foreign[i] = i;
    t.captureInfoPtr(foreign);
    gc();
    if (!t.infoPtrStable(foreign)) throw new Error('foreign ptr moved');
    const ta = t.createTA();
    t.taInfo(ta);
    const dv = t.createDV();
    t.dvInfo(dv);

    // dates + bigint
    t.dateVal(t.makeDate(1000000 + round));
    t.bigRoundTrip(12345678901234567890n + BigInt(round));

    gc();
    pump(); // run the external-buffer + any queued finalizers
}

gc();
pump();
if (t.externalFreedCount() < 1) throw new Error('no external buffers freed');
print('P0.4 MEM LOOP: DONE (external buffers freed: ' + t.externalFreedCount() + ')');
