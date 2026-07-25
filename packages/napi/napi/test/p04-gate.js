// SPDX-License-Identifier: MIT
// @gjsify/napi — P0.4 GATE (buffers / typed arrays / dataviews / promises /
// dates / bigint uint64).
//
// Runs as a legacy GJS script:
//
//   cd packages/napi/napi
//   GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build timeout 30 gjs test/p04-gate.js
//
// The headline item is the §5f moving-GC pointer-stability proof: because
// buffers we create get malloc'd, OUT-OF-LINE contents (and foreign views are
// pinned out-of-line by napi_get_buffer_info via
// JS::EnsureNonInlineArrayBufferOrView), a raw data pointer stays valid — and
// the bytes stay intact — across a forced full GC. A naive impl that hands out
// a pointer into SM's INLINE small-buffer storage would silently corrupt here.
// Promise settles are drained on a GLib main loop (a settle is not observable
// synchronously in the same native call).

'use strict';

const GjsifyNapi = imports.gi.GjsifyNapi;
const GLib = imports.gi.GLib;
if (!GjsifyNapi.init()) throw new Error('GjsifyNapi.init() failed');
const loadAddon = globalThis.__gjsifyNapiLoadAddon;
delete globalThis.__gjsifyNapiLoadAddon;

let failures = 0;
function check(name, actual, expected) {
    if (!Object.is(actual, expected)) {
        failures++;
        printerr(`FAIL ${name}: got ${String(actual)}, expected ${String(expected)}`);
    }
}
function checkArr(name, actual, expected) {
    const a = JSON.stringify(actual);
    const e = JSON.stringify(expected);
    if (a !== e) {
        failures++;
        printerr(`FAIL ${name}: got ${a}, expected ${e}`);
    }
}
function gc() {
    imports.system.gc();
}
function pat(i) {
    return (i * 7 + 3) & 0xff;
}
function pump() {
    // Drain pending idle sources (the §5c finalizer drain).
    const ctx = GLib.MainContext.default();
    while (ctx.iteration(false)) { /* drain */ }
}

const t = loadAddon('test/buffer-addon/build/Release/buffer.node');

// ---- §5f: buffer create + fill + GC + read-back (native AND JS) ----
// A small buffer (48 bytes) — well inside SM's inline-storage range, so a
// naive pointer would go stale after GC.
const LEN = 48;
let buf = t.createPattern(LEN);
check('is_buffer(created)', t.isBuf(buf), true);
check('Buffer.isBuffer(created)', globalThis.Buffer ? Buffer.isBuffer(buf) : true, true);
check('get_buffer_info length', t.bufLen(buf), LEN);
check('js sees pattern byte 0 (pre-GC)', buf[0], pat(0));
check('js sees pattern byte 47 (pre-GC)', buf[47], pat(47));

// Force full GC repeatedly: weak sweep + any relocation happen at major GC.
gc();
gc();

check('§5f data pointer stable across GC', t.createdPtrStable(buf), true);
check('§5f pattern intact native after GC', t.patternIntact(buf), true);
check('§5f native byte 10 after GC', t.nativeByteAt(buf, 10), pat(10));
check('§5f js byte 10 after GC', buf[10], pat(10));
check('§5f js byte 47 after GC', buf[47], pat(47));

// Native write is visible from JS (same backing store, stable pointer).
t.nativeSetByte(buf, 5, 200);
check('native write visible to JS', buf[5], 200);

// ---- create_buffer_copy: an INDEPENDENT copy ----
const copy = t.copyOf(buf);
check('copy is_buffer', t.isBuf(copy), true);
check('copy length', t.bufLen(copy), LEN);
check('copy byte 5 equals source', copy[5], 200);
// Mutate the copy native-side; the source must be unchanged (independence).
t.nativeSetByte(copy, 5, 111);
check('copy mutated independently', copy[5], 111);
check('source unchanged after copy mutate', buf[5], 200);

// ---- §5f for a FOREIGN (JS-created) view ----
const foreign = new Uint8Array(24);
for (let i = 0; i < 24; i++) foreign[i] = (i * 3 + 1) & 0xff;
check('is_buffer(foreign Uint8Array)', t.isBuf(foreign), true);
check('capture foreign length', t.captureInfoPtr(foreign), 24);
gc();
gc();
check('§5f foreign pointer stable across GC', t.infoPtrStable(foreign), true);
check('§5f foreign byte 7 intact after GC', t.nativeByteAt(foreign, 7), (7 * 3 + 1) & 0xff);

check('is_buffer(plain object) false', t.isBuf({}), false);
check('is_buffer(number) false', t.isBuf(42), false);

buf = null;
gc();

// ---- external (zero-copy) buffer: user finalizer frees the data ----
check('external freed count starts 0', t.externalFreedCount(), 0);
let ext = t.makeExternal(32);
check('is_buffer(external)', t.isBuf(ext), true);
check('external length', t.bufLen(ext), 32);
check('external js byte 9', ext[9], pat(9));
check('external native byte 9', t.nativeByteAt(ext, 9), pat(9));
gc();
gc();
check('external byte 9 stable after GC', t.nativeByteAt(ext, 9), pat(9));
check('external not freed while held', t.externalFreedCount(), 0);
ext = null;
gc();
pump(); // the user finalizer (frees the data) runs on the §5c drain
check('external finalizer freed once', t.externalFreedCount(), 1);

// ---- typed array round-trip ----
const ta = t.createTA();
check('createTA -> Uint8Array', ta instanceof Uint8Array, true);
check('is_typedarray(ta)', t.isTA(ta), true);
check('ta length', ta.length, 8);
check('ta byteOffset', ta.byteOffset, 4);
check('ta[0] == byte 4 (== 8)', ta[0], 8);
check('ta[7] == byte 11 (== 22)', ta[7], 22);
// napi_uint8_array == 1 in napi_typedarray_type.
checkArr('get_typedarray_info', t.taInfo(ta), [1, 8, 4, 8, true]);
check('is_typedarray(plain array) false', t.isTA([1, 2, 3]), false);

// ---- dataview round-trip ----
const dv = t.createDV();
check('createDV -> DataView', dv instanceof DataView, true);
check('is_dataview(dv)', t.isDV(dv), true);
check('dv byteLength', dv.byteLength, 6);
check('dv byteOffset', dv.byteOffset, 2);
check('dv.getUint8(0) == byte 2', dv.getUint8(0), 2);
checkArr('get_dataview_info', t.dvInfo(dv), [6, 2, 2, true]);
check('is_dataview(ta) false', t.isDV(ta), false);
check('is_typedarray(dv) false', t.isTA(dv), false);

// ---- dates ----
const MS = 1721862000000; // 2024-07-24T23:00:00.000Z
const d = t.makeDate(MS);
check('makeDate -> Date', d instanceof Date, true);
check('is_date(d)', t.isDate(d), true);
check('date getTime round-trip', d.getTime(), MS);
check('get_date_value native', t.dateVal(d), MS);
check('is_date(plain object) false', t.isDate({}), false);
check('is_date(number) false', t.isDate(MS), false);

// ---- bigint uint64 round-trip ----
const BIG = 12345678901234567890n; // > 2^53, < 2^64 — proves 64-bit fidelity
check('bigint uint64 round-trip', t.bigRoundTrip(BIG), BIG);
check('bigint uint64 lossless', t.bigLossless(BIG), true);
const MAXU64 = 18446744073709551615n; // 2^64 - 1
check('bigint uint64 max round-trip', t.bigRoundTrip(MAXU64), MAXU64);
check('bigint uint64 max lossless', t.bigLossless(MAXU64), true);
// A value that overflows uint64 truncates two's-complement, lossless=false.
check('bigint uint64 overflow not lossless', t.bigLossless(MAXU64 + 1n), false);

// ---- promises: resolve AND reject (drained on the main loop) ----
const promRes = t.makeResolved(42);
const promRej = t.makeRejected('boom');
check('is_promise(resolved)', t.isProm(promRes), true);
check('is_promise(rejected)', t.isProm(promRej), true);
check('is_promise(plain object) false', t.isProm({}), false);

let resolvedVal;
let rejectedReason;
let pending = 2;
const loop = GLib.MainLoop.new(null, false);
function settle() {
    if (--pending === 0) loop.quit();
}
promRes.then((v) => { resolvedVal = v; settle(); });
promRej.catch((e) => { rejectedReason = e; settle(); });
// Backstop: never let a broken promise hang the gate.
const guard = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
    loop.quit();
    return false;
});
loop.run();
GLib.source_remove(guard);

check('promise resolved value', resolvedVal, 42);
check('promise rejected reason', rejectedReason, 'boom');

if (failures > 0) throw new Error(`${failures} check(s) failed`);
print('P0.4 GATE: PASS');
