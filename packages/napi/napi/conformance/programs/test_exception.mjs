// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_exception/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// This addon THROWS during Init (by design) and attaches its exports to the
// error's `.binding` — a strong test of Init-exception propagation through the
// loader. The loadAddon path is expected to throw on BOTH runtimes.
export const meta = { dir: 'test_exception', targets: ['test_exception'] };

export default async function run(h) {
    // Init throws "Error during Init"; recover the bindings from `.binding`.
    let binding;
    let initMsg;
    try {
        h.loadAddon('test_exception');
        initMsg = 'NO-THROW(bug)';
    } catch (e) {
        initMsg = e.message;
        binding = e.binding;
    }
    h.emit('init-throw', initMsg);
    h.emit('binding-recovered', !!binding);

    const theError = new Error('Some error');
    const throwTheError = () => {
        throw theError;
    };

    // napi_get_and_clear_last_exception captures the pending exception.
    h.emit('returnException===theError', binding.returnException(throwTheError) === theError);
    // The exception passes through when allowed.
    h.emit(
        'allowException-passes',
        (() => {
            try {
                binding.allowException(throwTheError);
                return 'no-throw';
            } catch (e) {
                return e === theError;
            }
        })(),
    );
    // napi_is_exception_pending was true during the capture above.
    h.emit('wasPending(after-throw)', binding.wasPending());
    // No exception → returns undefined.
    h.emit(
        'returnException(no-throw)',
        binding.returnException(() => {}),
    );

    // Same, but the throwing site is a constructor (napi_new_instance).
    const throwCtor = class {
        constructor() {
            throw theError;
        }
    };
    h.emit('constructReturnException===theError', binding.constructReturnException(throwCtor) === theError);
    h.emit(
        'constructAllowException-passes',
        (() => {
            try {
                binding.constructAllowException(throwCtor);
                return 'no-throw';
            } catch (e) {
                return e === theError;
            }
        })(),
    );
    h.emit('wasPending(after-ctor-throw)', binding.wasPending());
    // NULL callback → a constructable no-op (arrow fns aren't constructable).
    h.emit(
        'constructReturnException(no-throw)',
        binding.constructReturnException(function () {}),
    );

    // No native exception → clean state (regular, constructable no-op fns).
    h.emit(
        'allowException(no-throw)',
        (() => {
            try {
                binding.allowException(function () {});
                return 'ok';
            } catch (e) {
                return 'threw:' + e.name;
            }
        })(),
    );
    h.emit('wasPending(clean)', binding.wasPending());
    h.emit(
        'constructAllowException(no-throw)',
        (() => {
            try {
                binding.constructAllowException(function () {});
                return 'ok';
            } catch (e) {
                return 'threw:' + e.name;
            }
        })(),
    );
    h.emit('wasPending(clean2)', binding.wasPending());
}
