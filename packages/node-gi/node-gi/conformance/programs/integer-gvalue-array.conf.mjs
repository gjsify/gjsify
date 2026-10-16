// SPDX-License-Identifier: MIT
// Out-of-range integers on the three paths integer-in-range does not cover. GJS's rule
// differs per path, so each is pinned on its own; GLib only, STDOUT byte-identical to
// the gjs golden on all four runtimes.
//   • constructor properties (`new Cls({ prop })`) and signal arguments both go through
//     gjs_value_to_g_value (refs/gjs/gi/value.cpp:602-690): char/uchar run ToInt32 and are
//     then REFUSED outside the tag range, int64/uint64 refuse a Number or BigInt that
//     misses the range ("Wrong type <typeof>; <what> expected. But it's out of range: <v>"),
//     int and uint WRAP (ToInt32 / ToUint32), a BigInt on a 32-bit tag is a TypeError.
//     Only the constructor refuses `undefined` (object.cpp:2090); a signal argument is 0.
//   • IN array elements (arg.cpp gjs_array_to_auto_array → js_value_to_c_strict) WRAP on
//     every tag, never refuse: the 8/16/32-bit tags by ToInt32/ToUint32, a BigInt on them
//     is a TypeError.
// Engine-specific TypeError text is printed as the error NAME only.
import GObject from 'gi://GObject?version=2.0';
import GLib from 'gi://GLib?version=2.0';

const bounds = {
    char: [-128, 127],
    uchar: [0, 255],
    int: [-(2 ** 31), 2 ** 31 - 1],
    uint: [0, 2 ** 32 - 1],
    int64: [-(2n ** 63n), 2n ** 63n - 1n],
    uint64: [0n, 2n ** 64n - 1n],
};
// node-gi has no ParamSpec.char/uchar factory (open todo), so a char/uchar value is only
// reachable through a signal argument — the same gjs_value_to_g_value path.
const propertyTags = ['int', 'uint', 'int64', 'uint64'];
const Properties = {};
for (const tag of propertyTags) {
    const [lo, hi] = bounds[tag];
    Properties[tag] = GObject.ParamSpec[tag](tag, tag, tag, GObject.ParamFlags.READWRITE, lo, hi, 0);
}
const Signals = {
    char: { param_types: [GObject.TYPE_CHAR] },
    uchar: { param_types: [GObject.TYPE_UCHAR] },
    int: { param_types: [GObject.TYPE_INT] },
    uint: { param_types: [GObject.TYPE_UINT] },
    int64: { param_types: [GObject.TYPE_INT64] },
    uint64: { param_types: [GObject.TYPE_UINT64] },
};
const Probe = GObject.registerClass({ Properties, Signals }, class Probe extends GObject.Object {});

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
    32768,
    65536,
    2 ** 31 - 1,
    2 ** 31,
    2 ** 32 - 1,
    2 ** 32,
    2 ** 32 + 97,
    2 ** 53,
    2 ** 63,
    2 ** 64,
    1.5,
    -0,
    NaN,
    Infinity,
    -Infinity,
    undefined,
    null,
    true,
    '5',
    'abc',
    {},
    5n,
    2n ** 63n - 1n,
    2n ** 63n,
    -(2n ** 63n) - 1n,
    2n ** 64n - 1n,
    2n ** 64n,
];

const show = (v) =>
    typeof v === 'bigint'
        ? `${v}n`
        : Object.is(v, -0)
          ? '-0'
          : typeof v === 'string'
            ? JSON.stringify(v)
            : typeof v === 'object' && v !== null
              ? '{}'
              : String(v);

const outcome = (call) => {
    try {
        return `ok ${show(call())}`;
    } catch (e) {
        if (e instanceof GLib.Error) return 'throws GLib.Error';
        return /out of range|Invalid value/.test(e.message) ? `throws ${e.message}` : `throws ${e.name}`;
    }
};

for (const tag of propertyTags) {
    for (const value of values) {
        print(`new ${tag} ${show(value)} -> ${outcome(() => new Probe({ [tag]: value })[tag])}`);
    }
}
for (const tag of Object.keys(bounds)) {
    for (const value of values) {
        print(
            `emit ${tag} ${show(value)} -> ${outcome(() => {
                const probe = new Probe();
                let got = 'unseen';
                probe.connect(tag, (_probe, arg) => {
                    got = arg;
                });
                probe.emit(tag, value);
                return got;
            })}`,
        );
    }
}

const arrays = {
    uint8: (v) => GLib.Bytes.new([97, v]).get_data().join(','),
    uint16: (v) => [...GLib.utf16_to_utf8([97, v])[0]].map((c) => c.codePointAt(0)).join(','),
    int32: (v) => {
        const keyFile = new GLib.KeyFile();
        keyFile.set_integer_list('g', 'k', [7, v]);
        return keyFile.get_integer_list('g', 'k').join(',');
    },
};
for (const [tag, call] of Object.entries(arrays)) {
    for (const value of values.filter((v) => typeof v !== 'bigint' || v === 5n)) {
        print(`array ${tag} ${show(value)} -> ${outcome(() => call(value))}`);
    }
}
