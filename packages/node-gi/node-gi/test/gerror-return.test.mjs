// SPDX-License-Identifier: MIT
// @gjsify/node-gi — GError-typed RETURNS + literal-first method-name resolution.
//
// Two engine gaps the webgl-glarea spike exposed (both hit before any GL call):
//
//  1. A **GError-typed value** (GI_TYPE_TAG_ERROR — a `GLib.Error` RETURN like
//     `Gtk.GLArea.get_error()`) threw `Unsupported return type tag 20`. GJS
//     surfaces it as a GLib.Error boxed with `.domain`/`.code`/`.message`
//     fields + `.matches()`/`.copy()` methods; the engine now wraps it through
//     the GLib.Error struct info (marshal.cc GI_TYPE_TAG_ERROR → WrapBoxed).
//     Headless coverage via `Gio.dbus_error_new_for_dbus_error` (a namespace
//     function with the same ERROR type-tag, transfer-full return — no display
//     needed; `GLib.Error.new_literal` is not usable here because the L1
//     deliberately shadows `GLib.Error` with its JS Error subclass); the
//     null-GError path (`realize: error none`) is covered by the display-gated
//     webgl-glarea e2e.
//
//  2. Instance-method resolution converted EVERY accessor camelCase→snake_case
//     before the GI lookup, destroying literal camelCase GIR names (Vala-
//     generated typelibs — Gwebgl's `getString` became the nonexistent
//     `get_string`). GJS exposes GIR names VERBATIM; the engine now resolves
//     the literal name first and falls back to the snake_case alias
//     (calls.cc CallMethod). Covered here from both directions on an
//     introspected instance: the literal snake name AND the camelCase alias
//     (which now exercises the C++ fallback path). The literal-camelCase
//     direction is covered by the webgl-glarea e2e (Gwebgl's Vala GIR).
//
// Reference: refs/gjs gi/arg.cpp (gjs_value_from_gi_argument ERROR branch),
// gjs object instance method resolution (verbatim GIR names).
import test from 'node:test';
import assert from 'node:assert/strict';

import { requireGi } from '../gi.js';

const Gio = requireGi('Gio', '2.0');

test('GError-typed return marshals as a field-readable GLib.Error boxed', () => {
    // Returns a GError (transfer full) — the SAME GI_TYPE_TAG_ERROR return path a
    // `Gtk.GLArea.get_error()` non-null result takes, but headless.
    const err = Gio.dbus_error_new_for_dbus_error('org.freedesktop.DBus.Error.Failed', 'boom');
    assert.ok(err !== null && err !== undefined, 'a GError return must not be null');
    assert.match(String(err.message), /boom/, 'the message FIELD must read back');
    const domain = Gio.dbus_error_quark();
    assert.equal(err.domain, domain, 'the domain FIELD must read back (g-dbus-error-quark)');
    assert.equal(err.code, Gio.DBusError.FAILED, 'the code FIELD must read back (registered name → FAILED)');
    // Boxed METHODS resolve too.
    assert.equal(err.matches(domain, Gio.DBusError.FAILED), true);
    assert.equal(err.matches(domain, Gio.DBusError.NO_MEMORY), false);
    const copy = err.copy();
    assert.match(String(copy.message), /boom/, 'copy() returns another usable GLib.Error');
});

test('instance methods resolve the literal name first, snake alias second', () => {
    const action = new Gio.SimpleAction({ name: 'greet' });
    // Literal introspected (snake_case) name — resolved verbatim, no conversion.
    assert.equal(action.get_name(), 'greet');
    // camelCase ALIAS — misses the literal lookup, resolved via the engine's
    // snake_case fallback (the path that must keep working after literal-first).
    assert.equal(action.getName(), 'greet');
    // A genuinely unknown name is `undefined` (GJS parity — feature detection
    // like `typeof gl.clearBufferfv === 'function'` must not lie), so calling
    // it throws the same TypeError gjs produces, not a node-gi method-miss.
    assert.equal(action.noSuchMethodAtAll, undefined);
    assert.throws(() => action.noSuchMethodAtAll(), /is not a function/);
});
