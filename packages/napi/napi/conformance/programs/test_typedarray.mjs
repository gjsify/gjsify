// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_typedarray/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// NOTE: External() exercises napi_create_external_arraybuffer (Phase-0 loud
// stub) — this program is ledgered until external ArrayBuffers land.
export const meta = { dir: 'test_typedarray', targets: ['test_typedarray'] };

export default async function run(h) {
    const t = h.loadAddon('test_typedarray');

    // napi_get_typedarray_info + napi_create_typedarray (Multiply).
    const bytes = new Uint8Array([0, 1, 2]);
    const br = t.Multiply(bytes, 3);
    h.emit('Multiply.u8', br instanceof Uint8Array, br.length, br[0], br[1], br[2]);
    const dbl = new Float64Array([0.0, 1.1, 2.2]);
    const dr = t.Multiply(dbl, -3);
    h.emit(
        'Multiply.f64',
        dr instanceof Float64Array,
        dr.length,
        h.fmt(dr[0]),
        Math.round(10 * dr[1]) / 10,
        Math.round(10 * dr[2]) / 10,
    );

    // napi_create_external_arraybuffer (STUB).
    const ext = t.External();
    h.emit('External', ext instanceof Int8Array, ext.length, ext[0], ext[1], ext[2]);

    // napi_create_typedarray of every kind onto a shared ArrayBuffer.
    const buffer = new ArrayBuffer(128);
    const arrayTypes = [
        Int8Array,
        Uint8Array,
        Uint8ClampedArray,
        Int16Array,
        Uint16Array,
        Int32Array,
        Uint32Array,
        Float16Array,
        Float32Array,
        Float64Array,
        BigInt64Array,
        BigUint64Array,
    ];
    for (const Ctor of arrayTypes) {
        const template = Reflect.construct(Ctor, [buffer]);
        const arr = t.CreateTypedArray(template, buffer);
        h.emit('Create', Ctor.name, arr instanceof Ctor, arr !== template, arr.buffer === buffer);
    }
    // Out-of-range length → RangeError.
    for (const Ctor of arrayTypes) {
        const template = Reflect.construct(Ctor, [buffer]);
        h.emit(
            'Create-oob',
            Ctor.name,
            h.caughtName(() => t.CreateTypedArray(template, buffer, 0, 136)),
        );
    }

    // napi_detach_arraybuffer + napi_is_detached_arraybuffer.
    for (const Ctor of arrayTypes) {
        const a = Reflect.construct(Ctor, [8]);
        const before = t.IsDetached(a.buffer);
        t.Detach(a);
        h.emit('Detach', Ctor.name, before, t.IsDetached(a.buffer), a.length);
    }
}
