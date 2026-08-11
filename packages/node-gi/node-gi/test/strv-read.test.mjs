// SPDX-License-Identifier: MIT
// @gjsify/node-gi — reading a G_TYPE_STRV property must yield a JS string[].
//
// Read half of the pair `test/strv-construct.test.mjs` opened: JsToGValue handled
// `string[]` → GStrv, but GValueToJs had no G_TYPE_STRV case, so the opposite direction
// fell through to the generic boxed branch and handed JS an opaque boxed HANDLE — truthy,
// with `.length === undefined`, so consumers degrade SILENTLY (`?? []` keeps the handle,
// the index loop runs zero times). That is how `@gjsify/http` lost EVERY request header:
// its Vala bridge exposes `Request:header-pairs` as `g_param_spec_boxed(…, G_TYPE_STRV, …)`,
// so `req.headers` came out `{}` with no error anywhere. Any GStrv property is affected
// (Gtk.Widget:css-classes, Gio.ThemedIcon:names, …).
//
// Reference: refs/gjs gi/value.cpp (`G_TYPE_STRV` → gjs_array_from_strv) and gi/arg.cpp —
// a NULL strv is an EMPTY ARRAY, never null: gjs excludes G_TYPE_STRV from its
// pointer-NULL→null pre-check so clients never have to check for both shapes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

const Gio = requireGi('Gio', '2.0');

// Gtk only if its typelib is present (gtk-smoke job); the widget case additionally
// needs a display. Same gating as strv-construct.test.mjs.
let Gtk = null;
let gtkLoadError = null;
try {
    Gtk = requireGi('Gtk', '4.0');
} catch (err) {
    gtkLoadError = err;
}
const gtkSkip = gtkLoadError ? `Gtk-4.0 typelib unavailable: ${gtkLoadError.message}` : false;
const widgetSkip = gtkSkip || (!haveDisplay ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)' : false);

// Gio.ThemedIcon:names is a readable G_TYPE_STRV property needing neither display nor gtk_init.
test('GStrv property read: yields a real JS Array of strings', () => {
    const icon = new Gio.ThemedIcon({ names: ['alpha', 'beta', 'gamma'] });
    const names = icon.names;

    // Assert the SHAPE first: the handle, not the contents, is what broke consumers.
    assert.ok(Array.isArray(names), 'a GStrv property reads back as an Array, not a boxed handle');
    assert.equal(names.length, 3, 'the array carries its length (a boxed handle had length === undefined)');
    assert.deepEqual(names, ['alpha', 'beta', 'gamma']);
    for (const n of names) assert.equal(typeof n, 'string', 'each element is a JS string');
});

// A pair-flattened GStrv is @gjsify/http's header shape; the index loop that walks it is
// the access pattern that degraded to zero iterations.
test('GStrv property read: an index loop over the array sees every element', () => {
    const icon = new Gio.ThemedIcon({ names: ['x-test', 'custom-value', 'host', '127.0.0.1'] });
    const pairs = icon.names ?? [];
    const seen = [];
    for (let i = 0; i + 1 < pairs.length; i += 2) seen.push([pairs[i], pairs[i + 1]]);
    assert.deepEqual(seen, [
        ['x-test', 'custom-value'],
        ['host', '127.0.0.1'],
    ]);
});

// A fresh Gtk.Label carries no style classes, so :css-classes is the natural empty case
// (Gtk.Box would report its orientation class).
test('GStrv property read: an empty GStrv is [] (not null)', { skip: widgetSkip }, () => {
    if (typeof Gtk.init === 'function') Gtk.init();
    const label = new Gtk.Label();
    const classes = label.css_classes;
    assert.ok(Array.isArray(classes), 'an empty GStrv still reads back as an Array');
    assert.equal(classes.length, 0);
});

test('GStrv property read: Gtk widget css_classes reads back via the property', { skip: widgetSkip }, () => {
    if (typeof Gtk.init === 'function') Gtk.init();
    const sw = new Gtk.ScrolledWindow({ css_classes: ['foo', 'bar'] });
    assert.deepEqual(sw.css_classes, ['foo', 'bar'], 'property read matches get_css_classes()');
    assert.deepEqual(sw.get_css_classes(), ['foo', 'bar']);
});
