// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_reference/test.js
// Original: Copyright (c) Node.js contributors. MIT.
// Deterministic subset (no GC-collection-timing assertions — those are
// nondeterministic to reproduce byte-exact even on the reference): the symbol
// reference identity + external + refcount surface. NOTE: napi_create_reference
// with refcount 0 (WEAK references) is part of the in-GC weak-reference regime
// deferred in Phase 0, so this program is ledgered on GJS.
export const meta = { dir: 'test_reference', targets: ['test_reference'] };

export default async function run(h) {
    const t = h.loadAddon('test_reference');
    h.emit('finalizeCount.init', t.finalizeCount);

    // Weak reference (refcount 0) to a LIVE symbol preserves identity.
    (() => {
        const symbol = t.createSymbol('testSym');
        t.createReference(symbol, 0);
        h.emit('sym.weak.same', t.referenceValue === symbol);
    })();
    t.deleteReference();

    // Registered-symbol reference (node_api_symbol_for).
    (() => {
        const symbol = t.createSymbolFor('testSymFor');
        t.createReference(symbol, 1);
        h.emit('symFor.strong.same', t.referenceValue === symbol);
        h.emit('symFor.strong.registered', t.referenceValue === Symbol.for('testSymFor'));
    })();
    t.deleteReference();

    (() => {
        const symbol = t.createSymbolForEmptyString();
        t.createReference(symbol, 1);
        h.emit('symForEmpty.registered', t.referenceValue === Symbol.for(''));
    })();
    t.deleteReference();

    h.emit('symForIncorrectLength!', h.caughtFull(() => t.createSymbolForIncorrectLength()));

    // External without finalizer: type + no finalize.
    (() => {
        const value = t.createExternal();
        h.emit('external.typeof', typeof value);
        h.emit('external.count', t.finalizeCount);
        t.checkExternal(value);
        h.emit('external.checked', 'ok');
    })();

    // Strong reference holds the value's identity; refcount inc/dec return values.
    const value = t.createExternalWithFinalize();
    t.createReference(value, 1);
    h.emit('strong.same', t.referenceValue === value);
    h.emit('inc', t.incrementRefcount());
    h.emit('dec1', t.decrementRefcount());
    h.emit('dec0', t.decrementRefcount());
    t.deleteReference();
}
