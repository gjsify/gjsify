// SPDX-License-Identifier: MIT
// @gjsify/node-gi — `GLib.Error.new_literal`, the constructor spelling `@girs/*` types.
//
// L1 shadows `GLib.Error` with a JS `Error` subclass, and that subclass had only the
// three-argument CONSTRUCTOR. `@girs/glib-2.0` types `GLib.Error`'s constructor as
// `constructor(properties?)` and exposes the positional form solely as the introspected static
// `new_literal(domain, code, message)` — so a cross-runtime TypeScript source that has to build a
// GError can only spell it that way, and every such source compiled, passed under gjs, and died
// here with `Error.new_literal is not a function`.
//
// Found from `@gjsify/gtk-host`'s `fonts.spec.ts`, which builds a
// `G_IO_ERROR_NOT_SUPPORTED` to exercise the branch a CoreText font map takes on macOS — an error
// no leg in this repository can provoke for real, and therefore one that has to be constructed.
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

test('GLib.Error.new_literal builds the same error the constructor does', () => {
    const viaStatic = GLib.Error.new_literal(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_SUPPORTED, 'nope');
    assert.ok(viaStatic instanceof GLib.Error, 'must be a GLib.Error, as under gjs');
    assert.equal(viaStatic.message, 'nope');
    assert.equal(viaStatic.code, Gio.IOErrorEnum.NOT_SUPPORTED);
});

test('the result answers matches() on a numeric quark and on the error enum', () => {
    // Both spellings, because a caller that constructs with a quark usually compares with the
    // enum — and a domain that only matched the way it was built would be useless for that.
    const err = GLib.Error.new_literal(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_SUPPORTED, 'nope');
    assert.equal(err.matches(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_SUPPORTED), true);
    assert.equal(err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_SUPPORTED), true);
});

test('it does not match a different code or a different domain', () => {
    // The discriminator: a `matches` that answered true for everything would pass the two tests
    // above while telling a caller nothing.
    const err = GLib.Error.new_literal(Gio.io_error_quark(), Gio.IOErrorEnum.NOT_SUPPORTED, 'nope');
    assert.equal(err.matches(Gio.io_error_quark(), Gio.IOErrorEnum.FAILED), false);
    assert.equal(err.matches(GLib.file_error_quark(), Gio.IOErrorEnum.NOT_SUPPORTED), false);
});
