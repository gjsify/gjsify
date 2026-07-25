// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_new_target/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Exercises napi_get_new_target: subclassing a native BaseClass via super(),
// an ordinary (non-new) call returning NULL new.target, and a native
// Constructor that asserts new.target === itself when passed as arg 0.
export const meta = { dir: 'test_new_target', targets: ['test_new_target'] };

export default async function run(h) {
    const binding = h.loadAddon('test_new_target');

    class Class extends binding.BaseClass {
        constructor() {
            super();
            this.method();
        }
        method() {
            this.ok = true;
        }
    }

    h.emit('instanceof', new Class() instanceof binding.BaseClass);
    h.emit('method-ran', new Class().ok);
    h.emit('ordinary', binding.OrdinaryFunction());
    h.emit('ctor-new.target',
        new binding.Constructor(binding.Constructor) instanceof binding.Constructor);
}
