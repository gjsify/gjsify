// SPDX-License-Identifier: MIT
// @gjsify/node-gi — reading a G_TYPE_STRV property must yield a JS string[].
//
// The READ half of the pair `test/strv-construct.test.mjs` opened. That file
// fixed JsToGValue (a JS `string[]` → a GStrv construct property); GValueToJs
// still had no G_TYPE_STRV case, so the OPPOSITE direction fell through to the
// generic boxed branch and handed JS an opaque boxed HANDLE instead of an array.
//
// Why it mattered more than a wrong type: the handle is a truthy object whose
// `.length` is `undefined`, so every idiomatic consumer degrades SILENTLY —
// `const a = obj.strvProp ?? []` keeps the handle, `for (let i = 0; i < a.length; i++)`
// runs zero times, `a.map(…)` throws only if reached. That is exactly how
// `@gjsify/http` lost EVERY request header on the node-gi bridge: its Vala bridge
// exposes `Request:header-pairs` (a Vala `public string[] { get; }` → valac emits
// `g_param_spec_boxed(…, G_TYPE_STRV, …)`), the server read it as a handle, the
// `[name, value, …]` pair loop ran zero times, and `req.headers` came out `{}` with
// no error anywhere. Same class of bug for any GStrv property (Gtk.Widget:css-classes,
// Gio.ThemedIcon:names, …).
//
// Reference: refs/gjs/gi/value.cpp:1082 (`gtype == G_TYPE_STRV` → gjs_array_from_strv)
// and refs/gjs/gi/arg.cpp:2267 (a NULL strv is an EMPTY ARRAY, never null — gjs
// deliberately excludes G_TYPE_STRV from its pointer-NULL→null pre-check at
// value.cpp:1023 so clients never have to check for both shapes).
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

// Headless: Gio.ThemedIcon:names is a plain readable G_TYPE_STRV property on a
// GObject that needs neither a display nor gtk_init. The value read back is the
// property's own GValue (the names the icon was constructed with).
test('GStrv property read: yields a real JS Array of strings', () => {
    const icon = new Gio.ThemedIcon({ names: ['alpha', 'beta', 'gamma'] });
    const names = icon.names;

    // The regression was an opaque boxed handle here — truthy, but not an Array and
    // with `length === undefined`. Assert the SHAPE first: that is what silently
    // broke every consumer, not the contents.
    assert.ok(Array.isArray(names), 'a GStrv property reads back as an Array, not a boxed handle');
    assert.equal(names.length, 3, 'the array carries its length (a boxed handle had length === undefined)');
    assert.deepEqual(names, ['alpha', 'beta', 'gamma']);
    for (const n of names) assert.equal(typeof n, 'string', 'each element is a JS string');
});

// A pair-flattened GStrv is the exact shape @gjsify/http's Vala bridge uses for
// request headers ([name, value, name, value, …]); the consumer walks it with an
// index loop, which is the access pattern that degraded to zero iterations.
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

// GJS parity: an unset / empty GStrv is an EMPTY ARRAY, never null. A fresh
// Gtk.Label carries no style classes, so :css-classes is the natural empty case
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
