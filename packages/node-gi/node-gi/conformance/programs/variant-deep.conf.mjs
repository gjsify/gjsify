// SPDX-License-Identifier: MIT
// GLib.Variant pack/unpack — the GJS unpack-flavour contract:
//   unpack()          one level, children stay Variants
//   deepUnpack()      containers unpacked, nested `v` values STAY Variants
//   recursiveUnpack() fully plain JS (discards `v` type info)
import GLib from 'gi://GLib?version=2.0';

// Local stable stringify (sorted object keys) so dict iteration order can
// never flavor the output — the program owns its determinism.
function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

const dict = new GLib.Variant('a{sv}', {
    name: new GLib.Variant('s', 'Ada'),
    age: new GLib.Variant('i', 36),
});
print('dict type:', dict.get_type_string());

const deep = dict.deepUnpack();
print('deep keys:', JSON.stringify(Object.keys(deep).sort()));
// deepUnpack: `v` values stay Variants — unwrap each explicitly.
print(
    'deep values are Variants:',
    typeof deep.name.deepUnpack === 'function',
    typeof deep.age.deepUnpack === 'function',
);
print('deep name:', deep.name.deepUnpack(), deep.name.get_type_string());
print('deep age:', deep.age.deepUnpack(), deep.age.get_type_string());

// recursiveUnpack: fully plain.
print('recursive:', stableStringify(dict.recursiveUnpack()));

// unpack(): children stay Variants even for non-`v` containers.
const un = dict.unpack();
print('unpack values are Variants:', typeof un.name.unpack === 'function');

// Nested tuple: deepUnpack unpacks through containers (only `v` stops it).
const tup = new GLib.Variant('(si(bb))', ['x', 1, [true, false]]);
print('tuple type:', tup.get_type_string());
print('tuple deep:', stableStringify(tup.deepUnpack()));
print('tuple recursive:', stableStringify(tup.recursiveUnpack()));

// Flat array flavours.
print('as deep:', stableStringify(new GLib.Variant('as', ['a', 'b', 'c']).deepUnpack()));
print('ai deep:', stableStringify(new GLib.Variant('ai', [1, 2, 3]).deepUnpack()));
const bytes = new GLib.Variant('ay', [1, 2, 250, 255]).deepUnpack();
print('ay is Uint8Array:', bytes instanceof Uint8Array, JSON.stringify(Array.from(bytes)));
// null packs as the EMPTY byte array (GLib.Bytes(null) → g_bytes_new(NULL, 0)) —
// the WebGL allocate-without-data path (texImage2D(..., null)) relies on it.
print('ay null:', new GLib.Variant('ay', null).print(true));
