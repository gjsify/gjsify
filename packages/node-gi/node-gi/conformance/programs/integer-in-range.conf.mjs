// SPDX-License-Identifier: MIT
// Integer IN arguments: the range rule of GJS's NumericIn marshaller.
//
// GLib only (no GIMarshallingTests typelib), so it runs UNCHANGED on all four
// runtimes and its STDOUT must be byte-identical to the gjs golden. One stock GLib
// function per integer tag, fed the values that tell the conversions apart:
//   • int8/uint8/int16/uint16 run JS::ToInt32 FIRST, then compare against the
//     tag's own range — so 2^32+1 wraps to 1 and is accepted, 256 is refused;
//   • int32 is NOT range-checked at all (ToInt32 wraps: 2^31 → -2^31);
//   • uint32 goes through ToNumber and is refused outside [0, 2^32-1], NaN
//     included, while undefined and ±Infinity are 0 silently;
//   • int64/uint64 truncate a Number and refuse one that misses the range; a
//     BigInt is range-checked too (2^63 is no int64), and a BigInt on a 32-bit
//     tag is a TypeError, not a range error.
// The thrown text names the ARGUMENT, so a wrapping marshaller is caught by the
// missing throw and a renamed one by the changed line. Engine-specific error text
// (the BigInt TypeError) is printed as the error NAME only.
import GLib from 'gi://GLib?version=2.0';

const tags = {
    int8: (v) => GLib.ascii_toupper(v),
    uint8: (v) => GLib.Variant.new_byte(v).get_byte(),
    int16: (v) => GLib.Variant.new_int16(v).get_int16(),
    uint16: (v) => GLib.Variant.new_uint16(v).get_uint16(),
    int32: (v) => GLib.Variant.new_int32(v).get_int32(),
    uint32: (v) => GLib.Variant.new_uint32(v).get_uint32(),
    int64: (v) => GLib.Variant.new_int64(v).get_int64(),
    uint64: (v) => GLib.Variant.new_uint64(v).get_uint64(),
};

const values = [
    0,
    97,
    127,
    128,
    255,
    256,
    -1,
    -128,
    -129,
    32767,
    32768,
    65535,
    65536,
    2 ** 31 - 1,
    2 ** 31,
    2 ** 32 - 1,
    2 ** 32,
    2 ** 32 + 97,
    -(2 ** 31),
    -(2 ** 31) - 1,
    2 ** 53,
    2 ** 63,
    2 ** 64,
    -(2 ** 63),
    1.5,
    -0,
    NaN,
    Infinity,
    -Infinity,
    undefined,
    null,
    true,
    false,
    '5',
    'abc',
    '',
    {},
    [],
    5n,
    9223372036854775807n,
    9223372036854775808n,
    -9223372036854775809n,
    18446744073709551615n,
    18446744073709551616n,
];

const show = (v) =>
    typeof v === 'bigint'
        ? `${v}n`
        : Object.is(v, -0)
          ? '-0'
          : typeof v === 'string'
            ? JSON.stringify(v)
            : Array.isArray(v)
              ? '[]'
              : typeof v === 'object' && v !== null
                ? '{}'
                : String(v);

for (const [tag, call] of Object.entries(tags)) {
    for (const value of values) {
        let line;
        try {
            line = `ok ${show(call(value))}`;
        } catch (e) {
            line = /out of range/.test(e.message) ? `throws ${e.message}` : `throws ${e.name}`;
        }
        print(`${tag} ${show(value)} -> ${line}`);
    }
}
