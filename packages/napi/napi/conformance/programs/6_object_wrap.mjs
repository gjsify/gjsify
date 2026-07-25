// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/6_object_wrap/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises napi_wrap/napi_unwrap + a define_class instance. The `myobject`
// target opts into NAPI_EXPERIMENTAL — if the shim refuses the experimental
// Node-API version this program is ledgered.
export const meta = { dir: '6_object_wrap', targets: ['myobject'] };

export default async function run(h) {
    const addon = h.loadAddon('myobject');

    // Prototype property descriptors (accessor value/valueReadonly + method plusOne).
    const vd = Object.getOwnPropertyDescriptor(addon.MyObject.prototype, 'value');
    const vrd = Object.getOwnPropertyDescriptor(addon.MyObject.prototype, 'valueReadonly');
    const pod = Object.getOwnPropertyDescriptor(addon.MyObject.prototype, 'plusOne');
    h.emit('value.desc', typeof vd.get, typeof vd.set, vd.value === undefined, vd.enumerable, vd.configurable);
    h.emit('valueReadonly.desc', typeof vrd.get, vrd.set === undefined, vrd.enumerable, vrd.configurable);
    h.emit('plusOne.desc', pod.get === undefined, pod.set === undefined, typeof pod.value, pod.enumerable, pod.configurable);

    // Wrapped instance: constructor arg, accessor round-trip, getter-only throw.
    const obj = new addon.MyObject(9);
    h.emit('ctor', obj.value);
    obj.value = 10;
    h.emit('set', obj.value, obj.valueReadonly);
    h.emit('valueReadonly-write!', h.caughtName(() => { obj.valueReadonly = 14; }));

    // Method mutating wrapped native state.
    h.emit('plusOne', obj.plusOne(), obj.plusOne(), obj.plusOne());

    // Method returning a new wrapped instance.
    h.emit('multiply()', obj.multiply().value);
    h.emit('multiply(10)', obj.multiply(10).value);
    const newobj = obj.multiply(-1);
    h.emit('multiply(-1)', newobj.value, newobj.valueReadonly, obj !== newobj);
}
