// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_constructor/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Read-only / getter-only assignment errors carry an ENGINE-specific message
// (V8 vs SpiderMonkey), so their TYPE (TypeError) is asserted, not the text.
export const meta = { dir: 'test_constructor', targets: ['test_constructor'] };

export default async function run(h) {
    const TestConstructor = h.loadAddon('test_constructor');
    const o = new TestConstructor();

    // napi_define_class + method.
    h.emit('echo', o.echo('hello'));

    // napi_writable data property.
    o.readwriteValue = 1;
    h.emit('readwrite=1', o.readwriteValue);
    o.readwriteValue = 2;
    h.emit('readwrite=2', o.readwriteValue);

    // read-only data property → TypeError on write (engine message differs).
    h.emit(
        'readonly-write!',
        h.caughtName(() => {
            o.readonlyValue = 3;
        }),
    );
    h.emit('hiddenValue.truthy', !!o.hiddenValue);

    // napi_enumerable attribute reflected in for-in.
    const names = [];
    for (const n in o) names.push(n);
    for (const k of [
        'echo',
        'readwriteValue',
        'readonlyValue',
        'hiddenValue',
        'readwriteAccessor1',
        'readwriteAccessor2',
        'readonlyAccessor1',
        'readonlyAccessor2',
    ])
        h.emit('enum', k, names.includes(k));

    // Accessors ignore napi_writable; getter-only throws on write.
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

    // Static property lives on the class, not the instance.
    h.emit('static', TestConstructor.staticReadonlyAccessor1, o.staticReadonlyAccessor1);

    // NULL-argument matrix for napi_define_class.
    const m = TestConstructor.TestDefineClass();
    h.emit(
        'TestDefineClass',
        Object.keys(m)
            .sort()
            .map((k) => `${k}=${m[k]}`)
            .join('|'),
    );
}
