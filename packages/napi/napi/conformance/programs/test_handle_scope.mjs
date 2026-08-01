// SPDX-License-Identifier: MIT
// Ported from refs/node/test/js-native-api/test_handle_scope/test.js
// Original: Copyright (c) Node.js contributors. MIT.
export const meta = { dir: 'test_handle_scope', targets: ['test_handle_scope'] };

export default async function run(h) {
    const t = h.loadAddon('test_handle_scope');

    // napi_open/close_handle_scope: allocate 1000 handles, no crash.
    t.NewScope();
    h.emit('NewScope', 'ok');

    // napi_escape_handle: escaped value survives its scope as an Object.
    h.emit('NewScopeEscape.isObject', t.NewScopeEscape() instanceof Object);

    // Escaping twice from one scope is a caught addon error (not a crash).
    t.NewScopeEscapeTwice();
    h.emit('NewScopeEscapeTwice', 'ok');

    // An exception thrown inside the scoped callback propagates out.
    h.emit(
        'NewScopeWithException',
        h.caught(() =>
            t.NewScopeWithException(() => {
                throw new RangeError('boom');
            }),
        ),
    );
}
