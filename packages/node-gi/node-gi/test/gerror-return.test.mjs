// SPDX-License-Identifier: MIT
// @gjsify/node-gi — GError-typed RETURNS + literal-first method-name resolution.
//
// Both were engine gaps the webgl-glarea spike hit before any GL call.
//
// GI_TYPE_TAG_ERROR returns (e.g. `Gtk.GLArea.get_error()`) threw "Unsupported
// return type tag 20"; GJS surfaces them as a GLib.Error boxed. Exercised
// headlessly through `Gio.dbus_error_new_for_dbus_error` (same ERROR type-tag,
// transfer-full return) because L1 shadows `GLib.Error` with its JS Error
// subclass: `GLib.Error.new_literal` exists (gerror-new-literal.test.mjs) but
// answers that JS subclass, not a BOXED GError, so it cannot stand in for a
// marshalled ERROR return; the null-GError return is left to the display-gated
// webgl-glarea e2e.
//
// Method resolution converted every accessor camelCase→snake_case before the GI
// lookup, destroying literal camelCase GIR names (Vala typelibs: Gwebgl's
// `getString` became a nonexistent `get_string`). GJS exposes GIR names VERBATIM,
// so the literal name resolves first and the snake_case alias is the fallback;
// the literal-camelCase direction needs a Vala GIR and stays in webgl-glarea.
//
// Reference: refs/gjs gi/arg.cpp (gjs_value_from_gi_argument ERROR branch).
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const Gio = requireGi('Gio', '2.0');

test('GError-typed return marshals as a field-readable GLib.Error boxed', () => {
    const err = Gio.dbus_error_new_for_dbus_error('org.freedesktop.DBus.Error.Failed', 'boom');
    assert.ok(err !== null && err !== undefined, 'a GError return must not be null');
    assert.match(String(err.message), /boom/, 'the message FIELD must read back');
    const domain = Gio.dbus_error_quark();
    assert.equal(err.domain, domain, 'the domain FIELD must read back (g-dbus-error-quark)');
    assert.equal(err.code, Gio.DBusError.FAILED, 'the code FIELD must read back (registered name → FAILED)');
    assert.equal(err.matches(domain, Gio.DBusError.FAILED), true);
    assert.equal(err.matches(domain, Gio.DBusError.NO_MEMORY), false);
    const copy = err.copy();
    assert.match(String(copy.message), /boom/, 'copy() returns another usable GLib.Error');
});

test('instance methods resolve the literal name first, snake alias second', () => {
    const action = new Gio.SimpleAction({ name: 'greet' });
    // Literal introspected name — resolved verbatim, no conversion.
    assert.equal(action.get_name(), 'greet');
    // camelCase alias — misses the literal lookup, resolved via the snake fallback.
    assert.equal(action.getName(), 'greet');
    // Unknown names stay `undefined` so feature detection (`typeof x === 'function'`)
    // cannot lie; calling one throws gjs's TypeError, not a node-gi method-miss.
    assert.equal(action.noSuchMethodAtAll, undefined);
    assert.throws(() => action.noSuchMethodAtAll(), /is not a function/);
});
