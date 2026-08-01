// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_symbol/test_symbol.c (no test.js
// in this suite revision — driven from the C surface).
// Original: Copyright (c) Node.js contributors. MIT.
export const meta = { dir: 'test_symbol', targets: ['test_symbol'] };

export default async function run(h) {
    const t = h.loadAddon('test_symbol');

    // napi_create_symbol with a description.
    const s = t.New('sym-desc');
    h.emit('typeof', typeof s);
    h.emit('description', h.fmt(s.description));
    h.emit('toString', s.toString());

    // Fresh symbols are always distinct (not the registry).
    h.emit('distinct', t.New('x') !== t.New('x'));

    // No description → undefined description.
    const s2 = t.New();
    h.emit('no-arg.typeof', typeof s2);
    h.emit('no-arg.description', h.fmt(s2.description));

    // Non-string description is a caught addon assertion.
    h.emit(
        'non-string!',
        h.caughtFull(() => t.New(42)),
    );
}
