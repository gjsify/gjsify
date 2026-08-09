// SPDX-License-Identifier: MIT
// @gjsify/node-gi — G_TYPE_STRV construct-property marshalling + loop-dispatched
// handler-exception surfacing.
//
// FIX 1 — JsToGValue had no G_TYPE_STRV case. Because
// G_TYPE_FUNDAMENTAL(G_TYPE_STRV) == G_TYPE_BOXED, a GStrv-typed construct
// property (e.g. Gtk.Widget:css-classes, Gtk.StringList:strings) fell into the
// boxed-HANDLE case and threw "expected a boxed handle for a GStrv property" on a
// plain JS array. The new branch marshals a JS string[] → a freshly-allocated
// GStrv (g_value_take_boxed; g_object_new copies it; g_value_unset frees the
// copy). null/undefined clears it; a non-array throws a clean TypeError.
//
// FIX 2 — a JS exception thrown inside a C-invoked GClosure (a signal handler /
// notify:: / idle / timeout) was left pending, which WEDGED the GLib/libuv main
// loop (DrainMicrotasks stops draining while an exception is pending — that is why
// the FIX-1 throw became a multi-second hang instead of a clean error). The
// trampolines now surface + clear an uncaught LOOP-DISPATCHED handler exception
// (logged to stderr, GJS-style) so the loop keeps running; a SYNCHRONOUS emit()
// still propagates it to the JS caller (covered by test/signals.test.mjs).
//
// The GStrv-via-Gtk cases need the Gtk-4.0 typelib (only the dedicated gtk-smoke
// CI job installs it), so they self-skip on the fast headless leg. The css_classes
// widget case additionally needs a display. The FIX-2 cases are fully headless
// (GLib + Gio) and run on every leg.
//
// Reference: refs/gjs/gi/value.cpp:704-725 (the gtype == G_TYPE_STRV special-case)
// + refs/gjs closure marshalling (gjs_log_exception reports, never crashes the loop).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

const GLib = requireGi('GLib', '2.0');
const Gio = requireGi('Gio', '2.0');

// Gtk only if its typelib is present (gtk-smoke job); else the GStrv-via-Gtk cases
// self-skip rather than throw on the headless leg.
let Gtk = null;
let gtkLoadError = null;
try {
    Gtk = requireGi('Gtk', '4.0');
} catch (err) {
    gtkLoadError = err;
}
const gtkSkip = gtkLoadError ? `Gtk-4.0 typelib unavailable: ${gtkLoadError.message}` : false;
const widgetSkip = gtkSkip || (!haveDisplay ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)' : false);

// ---- FIX 1: G_TYPE_STRV construct property ---------------------------------

// Headless GStrv construct property: Gtk.StringList:strings is construct-only,
// type G_TYPE_STRV, and GtkStringList is a plain GObject (GListModel) — no display
// or gtk_init needed.
test('GStrv construct prop: a JS string[] round-trips (Gtk.StringList:strings)', { skip: gtkSkip }, () => {
    const list = new Gtk.StringList({ strings: ['alpha', 'beta', 'gamma'] });
    assert.equal(list.get_n_items(), 3, 'all three strings were marshalled into the GStrv');
    assert.equal(list.get_string(0), 'alpha');
    assert.equal(list.get_string(1), 'beta');
    assert.equal(list.get_string(2), 'gamma');
});

test('GStrv construct prop: an empty array yields an empty GStrv', { skip: gtkSkip }, () => {
    const list = new Gtk.StringList({ strings: [] });
    assert.equal(list.get_n_items(), 0);
});

test('GStrv construct prop: null/undefined clears it (empty list, no throw)', { skip: gtkSkip }, () => {
    const fromNull = new Gtk.StringList({ strings: null });
    assert.equal(fromNull.get_n_items(), 0);
    const fromUndefined = new Gtk.StringList({ strings: undefined });
    assert.equal(fromUndefined.get_n_items(), 0);
});

test('GStrv construct prop: a non-array value throws a clean TypeError', { skip: gtkSkip }, () => {
    assert.throws(() => new Gtk.StringList({ strings: 'not-an-array' }), /expected a string\[\] for a GStrv property/);
});

// The reported repro: a Gtk widget css_classes construct property. Needs a display
// (gtk_init) so it is gated to the gtk-smoke leg, but it is the exact failing case
// from the bug report (new Gtk.ScrolledWindow({ css_classes: ['foo'] })).
test('GStrv construct prop: Gtk widget css_classes round-trips', { skip: widgetSkip }, () => {
    if (typeof Gtk.init === 'function') Gtk.init();
    const sw = new Gtk.ScrolledWindow({ css_classes: ['foo', 'bar'] });
    assert.deepEqual(sw.get_css_classes(), ['foo', 'bar'], 'css_classes read back via get_css_classes()');
});

// ---- FIX 2: a loop-dispatched handler exception must not wedge the loop -------

test('FIX2: a throwing notify handler dispatched in the loop does not wedge it', () => {
    // Gio.SimpleAction is a headless GObject; toggling :enabled emits notify::enabled
    // and the handler is dispatched at g_syncEmitDepth == 0 (no JS emit() wrapping it)
    // — exactly the signal-closure path that used to leave a pending exception.
    const action = new Gio.SimpleAction({ name: 'strv-fix2' });
    let handlerRan = false;
    let secondFired = false;
    action.connect('notify::enabled', () => {
        handlerRan = true;
        throw new Error('boom from a loop-dispatched notify handler');
    });

    const loop = GLib.MainLoop.new(null, false);
    // T1: flips the property → notify::enabled fires → the handler throws.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        action.set_enabled(false);
        return GLib.SOURCE_REMOVE;
    });
    // T2: must STILL fire after T1's handler threw → proves the loop kept running.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
        secondFired = true;
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    // Backstop: a regression that wedges the loop hits this cap instead of hanging.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });

    loop.run();

    assert.equal(handlerRan, true, 'the throwing notify handler ran');
    assert.equal(secondFired, true, 'the loop survived the throwing handler and dispatched the next source');
});

test('FIX2: a throwing timeout callback does not wedge the main loop', () => {
    const loop = GLib.MainLoop.new(null, false);
    let firstRan = false;
    let secondFired = false;
    // T1 throws from inside the loop dispatch (a NOTIFIED-scope GSourceFunc).
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10, () => {
        firstRan = true;
        throw new Error('boom from a loop-dispatched timeout');
    });
    // T2 must still fire AFTER T1 threw.
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 40, () => {
        secondFired = true;
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });

    loop.run();

    assert.equal(firstRan, true, 'the throwing timeout callback ran');
    assert.equal(secondFired, true, 'the loop survived the throwing callback');
});
