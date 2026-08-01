// SPDX-License-Identifier: MIT
// Ported from refs/node/test/node-api/test_reference_by_node_api_version/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Compares napi reference behavior between Node-API version 8 (references only
// for object/function/symbol) and >= 9 (any value type), and the WEAK regime:
// after the ref count drops to 0, object-like values survive as weak pointers
// until GC, other value types are released immediately, and a global (registered)
// symbol stays strong forever. This is the in-GC weak-reference regime the shim
// defers in Phase 0 (see the test_reference ledger entry) — ported faithfully so
// the Node golden pins the exact semantics; the GJS-under-shim leg is ledgered.
export const meta = {
    dir: 'test_reference_by_node_api_version',
    targets: ['test_reference_all_types', 'test_reference_obj_only'],
    suite: 'node-api',
};

async function runTests(h, addon, label, isVersion8, isLocalSymbol) {
    let allEntries = [];
    (() => {
        const symbolValue = isLocalSymbol ? Symbol('test_symbol_local') : Symbol.for('test_symbol_global');
        allEntries = [
            { name: 'undefined', value: undefined, canBeWeak: false, canBeRefV8: false },
            { name: 'null', value: null, canBeWeak: false, canBeRefV8: false },
            { name: 'boolean', value: false, canBeWeak: false, canBeRefV8: false },
            { name: 'number', value: 42, canBeWeak: false, canBeRefV8: false },
            { name: 'string', value: 'test_string', canBeWeak: false, canBeRefV8: false },
            {
                name: 'symbol',
                value: symbolValue,
                canBeWeak: isLocalSymbol,
                canBeRefV8: true,
                isAlwaysStrong: !isLocalSymbol,
            },
            { name: 'object', value: { x: 1, y: 2 }, canBeWeak: true, canBeRefV8: true },
            { name: 'function', value: (x, y) => x + y, canBeWeak: true, canBeRefV8: true },
            { name: 'external', value: addon.createExternal(), canBeWeak: true, canBeRefV8: true },
            { name: 'bigint', value: 9007199254740991n, canBeWeak: false, canBeRefV8: false },
        ];

        for (const entry of allEntries) {
            if (!isVersion8 || entry.canBeRefV8) {
                const index = addon.createRef(entry.value);
                h.emit(
                    label,
                    entry.name,
                    'value-eq',
                    addon.getRefValue(index) === entry.value,
                    'ref',
                    addon.ref(index),
                    'unref',
                    addon.unref(index),
                    'unref',
                    addon.unref(index),
                );
            } else {
                h.emit(
                    label,
                    entry.name,
                    'createRef!',
                    h.caughtFull(() => addon.createRef(entry.value)),
                );
            }
        }

        // ref count 0: object-like stay weak (still reachable via allEntries),
        // others released.
        allEntries.forEach((entry, index) => {
            if (!isVersion8 || entry.canBeRefV8) {
                const expectPresent = entry.canBeWeak || entry.isAlwaysStrong;
                const v = addon.getRefValue(index);
                h.emit(label, entry.name, 'at-zero', expectPresent ? v === entry.value : v === undefined);
            }
            entry.value = undefined;
        });

        addon.addFinalizer({});
    })();

    addon.initFinalizeCount();
    h.emit(label, 'finalizeCount.start', addon.getFinalizeCount());
    await h.gcUntil(() => addon.getFinalizeCount() === 1, 'finalizer 1');
    (() => {
        addon.addFinalizer({});
    })();
    await h.gcUntil(() => addon.getFinalizeCount() === 2, 'finalizer 2');

    // After GC: everything weak is gone; only the always-strong global symbol
    // remains.
    allEntries.forEach((entry, index) => {
        if (!isVersion8 || entry.canBeRefV8) {
            const v = addon.getRefValue(index);
            h.emit(label, entry.name, 'post-gc', entry.isAlwaysStrong ? v !== undefined : v === undefined);
            addon.deleteRef(index);
        }
    });
}

export default async function run(h) {
    const addonV8 = h.loadAddon('test_reference_obj_only');
    const addonNew = h.loadAddon('test_reference_all_types');
    await runTests(h, addonV8, 'v8.local', true, true);
    await runTests(h, addonV8, 'v8.global', true, false);
    await runTests(h, addonNew, 'new.local', false, true);
    await runTests(h, addonNew, 'new.global', false, false);
}
