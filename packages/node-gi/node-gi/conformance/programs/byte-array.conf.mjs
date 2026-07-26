// SPDX-License-Identifier: MIT
// The legacy `imports.byteArray` module (gjs modules/script/byteArray.js over
// imports._byteArrayNative): fromString/toString are ZERO-TERMINATED + fatal,
// fromGBytes/toGBytes round-trip through GLib.Bytes, fromArray wraps in the
// legacy ByteArray class, and returned arrays carry the legacy own
// `toString(encoding)`. This is the seam `@gjsify/utils`' cli()/
// gbytesToUint8Array — and through them `@gjsify/os` + `@gjsify/child_process`
// — read GLib subprocess output with, so it pins the consumer-survey P3 fix.
// Error CLASSES are pinned (messages carry pointers/host wording); the golden
// is the gjs output.
import GLib from 'gi://GLib?version=2.0';

const ba = imports.byteArray;

// fromString: encode, ZERO-TERMINATED, plain Uint8Array out.
const u8 = ba.fromString('héllo');
print('fromString:', u8.length, u8 instanceof Uint8Array, u8.constructor.name);
print('toString:', ba.toString(u8));
print('instance toString:', u8.toString());
print('zero-terminated:', ba.toString(Uint8Array.from([104, 105, 0, 120])));
print('latin1 round-trip:', ba.toString(ba.fromString('äöü', 'LATIN1'), 'LATIN1'));

// toGBytes/fromGBytes: GLib.Bytes round-trip (copy semantics).
const bytes = ba.toGBytes(Uint8Array.from([1, 2, 3]));
print('toGBytes size:', bytes.get_size());
const back = ba.fromGBytes(bytes);
print('fromGBytes:', back.length, back instanceof Uint8Array, Array.from(back).join(','));

// GLib.Bytes.prototype.toArray — the GLib-override companion surface
// (gjs overrides/GLib.js routes it through the same fromGBytes).
print('Bytes.toArray:', Array.from(bytes.toArray()).join(','));

// fromArray: the legacy ByteArray wrapper (indexing + decode).
const arr = ba.fromArray([104, 105]);
print('fromArray:', arr.length, arr[0], arr[1], arr.toString());

// The consumer seam itself: subprocess stdout read via spawn_command_line_sync
// + byteArray.toString (the @gjsify/utils cli() shape @gjsify/os runs on).
const [ok, out] = GLib.spawn_command_line_sync('echo conf');
print('spawn:', ok, JSON.stringify(ba.toString(out)));

// Error classes (not messages — gjs's carry pointers/host wording).
try {
    ba.toGBytes('nope');
} catch (e) {
    print('toGBytes throws:', e.constructor.name, '|', e.message);
}
try {
    ba.fromGBytes({});
} catch (e) {
    print('fromGBytes throws:', e.constructor.name);
}
try {
    ba.toString(Uint8Array.from([0xff, 0xfe]));
} catch (e) {
    print('fatal decode throws:', e.constructor.name);
}
try {
    ba.fromString(123);
} catch (e) {
    print('fromString throws:', e.constructor.name);
}
