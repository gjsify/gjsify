// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_object/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// NOTE: binding.gyp opts into NAPI_EXPERIMENTAL and references
// node_api_create_object_with_properties — outside the Phase-0 non-experimental
// ABI, so the shim cannot dlopen it. Ledgered; Node produces the reference.
export const meta = { dir: 'test_object', targets: ['test_object'] };

export default async function run(h) {
    const t = h.loadAddon('test_object');

    const obj = { hello: 'world', array: [1, 94, 'str', 12.321, {}], newObject: { test: 'baz' } };

    // napi_get_property / napi_get_named_property.
    h.emit('Get(hello)', t.Get(obj, 'hello'));
    h.emit('GetNamed(hello)', t.GetNamed(obj, 'hello'));

    // napi_has_property / napi_has_own_property.
    h.emit('Has(hello)', t.Has(obj, 'hello'));
    h.emit('Has(missing)', t.Has(obj, 'missing'));
    h.emit('HasOwn(hello)', t.HasOwn(obj, 'hello'));

    // napi_set_property.
    const target = {};
    t.Set(target, 'k', 42);
    h.emit('Set', target.k);

    // napi_delete_property.
    const del = { a: 1, b: 2 };
    h.emit('Delete', t.Delete(del, 'a'), 'a' in del);

    // napi_get_property_names.
    const keys = t.GetPropertyNames({ x: 1, y: 2 });
    h.emit('GetPropertyNames', JSON.stringify(keys.sort()));

    // napi_object_freeze / napi_object_seal.
    const fr = { p: 1 };
    t.TestFreeze(fr);
    h.emit('Freeze', Object.isFrozen(fr));
    const se = { p: 1 };
    t.TestSeal(se);
    h.emit('Seal', Object.isSealed(se));
}
