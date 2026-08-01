// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_properties/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Init defines symbol-keyed properties via node_api_symbol_for — a
// non-experimental (NAPI_VERSION 8) ABI implemented at the shim core.
export const meta = { dir: 'test_properties', targets: ['test_properties'] };

export default async function run(h) {
    const o = h.loadAddon('test_properties');

    h.emit('echo', o.echo('hello'));
    o.readwriteValue = 1;
    h.emit('readwrite=1', o.readwriteValue);
    o.readwriteValue = 2;
    h.emit('readwrite=2', o.readwriteValue);
    h.emit(
        'readonly-write!',
        h.caughtName(() => {
            o.readonlyValue = 3;
        }),
    );
    h.emit('hiddenValue.truthy', !!o.hiddenValue);

    // napi_enumerable reflected in for-in (incl. a string-name-keyed value).
    const names = [];
    for (const n in o) names.push(n);
    for (const k of [
        'echo',
        'readwriteValue',
        'readonlyValue',
        'hiddenValue',
        'NameKeyValue',
        'readwriteAccessor1',
        'readwriteAccessor2',
        'readonlyAccessor1',
        'readonlyAccessor2',
    ])
        h.emit('enum', k, names.includes(k));

    // Symbol-keyed properties: plain symbol, descriptionless symbol, and a
    // registered (Symbol.for) symbol from node_api_symbol_for.
    const syms = Object.getOwnPropertySymbols(o);
    h.emit('sym0', syms[0].toString());
    h.emit('sym1', syms[1].toString());
    h.emit('sym2-is-registered', syms[2] === Symbol.for('NameKeySymbolFor'));

    // Accessor descriptors.
    const rw = Object.getOwnPropertyDescriptor(o, 'readwriteAccessor1');
    const ro = Object.getOwnPropertyDescriptor(o, 'readonlyAccessor1');
    h.emit('rwDesc', typeof rw.get, typeof rw.set, rw.value === undefined);
    h.emit('roDesc', typeof ro.get, ro.set === undefined, ro.value === undefined);

    o.readwriteAccessor1 = 1;
    h.emit('rwAccessor1', o.readwriteAccessor1, o.readonlyAccessor1);
    h.emit(
        'roAccessor1-write!',
        h.caughtName(() => {
            o.readonlyAccessor1 = 3;
        }),
    );
    o.readwriteAccessor2 = 2;
    h.emit('rwAccessor2', o.readwriteAccessor2, o.readonlyAccessor2);
    h.emit(
        'roAccessor2-write!',
        h.caughtName(() => {
            o.readonlyAccessor2 = 3;
        }),
    );

    // napi_has_named_property.
    h.emit('has.echo', o.hasNamedProperty(o, 'echo'));
    h.emit('has.hiddenValue', o.hasNamedProperty(o, 'hiddenValue'));
    h.emit('has.doesnotexist', o.hasNamedProperty(o, 'doesnotexist'));
}
