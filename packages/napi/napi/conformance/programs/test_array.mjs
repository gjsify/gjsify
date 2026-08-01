// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_array/test.js
// Original: Copyright (c) Node.js contributors. MIT.
export const meta = { dir: 'test_array', targets: ['test_array'] };

export default async function run(h) {
    const t = h.loadAddon('test_array');
    const array = [1, 9, 48, 13493, 9459324, { name: 'hello' }, ['world', 'node', 'abi']];

    // napi_get_element bounds checks throw the addon's exact assertion message.
    h.emit(
        'oob-high',
        h.caught(() => t.TestGetElement(array, array.length + 1)),
    );
    h.emit(
        'oob-neg',
        h.caught(() => t.TestGetElement(array, -2)),
    );

    // Each element round-trips by identity/value.
    array.forEach((el, i) => {
        const got = t.TestGetElement(array, i);
        h.emit('get', i, got === el ? 'same-ref' : h.fmt(got));
    });

    // napi_create_array + set → deep-equal reconstruction.
    const rebuilt = t.New(array);
    h.emit('New.length', rebuilt.length);
    h.emit('New.deep-equal', JSON.stringify(rebuilt) === JSON.stringify(array));
    h.emit('New[5].name', rebuilt[5].name);
    h.emit('New[6]', h.fmt(rebuilt[6]));

    // napi_has_element.
    h.emit('has[0]', t.TestHasElement(array, 0));
    h.emit('has[oob]', t.TestHasElement(array, array.length + 1));

    // napi_create_array_with_length.
    h.emit('NewWithLength(0).isArray', Array.isArray(t.NewWithLength(0)));
    h.emit('NewWithLength(1).isArray', Array.isArray(t.NewWithLength(1)));
    h.emit('NewWithLength(2^32-1).isArray', Array.isArray(t.NewWithLength(4294967295)));

    // napi_delete_element leaves a hole (length unchanged, index absent).
    const arr = ['a', 'b', 'c', 'd'];
    h.emit('del.before', arr.length, 2 in arr);
    h.emit('del.result', t.TestDeleteElement(arr, 2));
    h.emit('del.after', arr.length, 2 in arr);
}
