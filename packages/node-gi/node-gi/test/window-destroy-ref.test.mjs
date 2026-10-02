// SPDX-License-Identifier: MIT
// @gjsify/node-gi — a destroyed Gtk.Window stays a live object while JS holds it (#1999).
//
// `GtkWindow` is a `GInitiallyUnowned` that sinks its OWN floating ref in its
// instance init and keeps that ref for GTK's toplevel list, so `g_object_new`
// hands the caller nothing. Construction used to adopt that ref as node-gi's,
// so `destroy()` — GTK releasing ITS ref — finalized the window under a live JS
// handle. The next call read freed memory: `invalid GObject handle` when the
// allocator had not reused the block, anything at all when it had. Measured in
// `@gjsify/react-native`'s suite on macOS: the window-chrome idle queued on `map`
// ran after the vector destroyed its window and threw from `get_mapped()`.
//
// gjs takes an extra ref for exactly this shape (refs/gjs/gi/object.cpp, "GtkWindow
// does not return a ref to caller of g_object_new"), so there a destroyed window
// answers `get_mapped() === false`. That is the contract asserted here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';
import { haveDisplay } from './display-gate.mjs';

let Gtk;
let loadError = null;
if (haveDisplay) {
    try {
        Gtk = requireGi('Gtk', '4.0');
    } catch (err) {
        loadError = err;
    }
}

const skip = !haveDisplay
    ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
    : loadError
      ? `Gtk-4.0 typelib unavailable: ${loadError.message}`
      : false;

test('a destroyed Gtk.Window answers calls instead of being freed under its handle', { skip }, () => {
    Gtk.init();
    const window = new Gtk.Window({ title: 'destroyed' });
    window.destroy();
    assert.equal(window.get_mapped(), false);
    assert.equal(window.get_title(), 'destroyed');
});

test('a presented then destroyed Gtk.Window is still a live object', { skip }, () => {
    Gtk.init();
    const window = new Gtk.Window();
    window.present();
    window.destroy();
    assert.equal(window.get_mapped(), false);
    assert.equal(window.get_visible(), false);
});

test('a self-sinking subclass gets the same extra ref', { skip }, () => {
    Gtk.init();
    const window = new Gtk.ApplicationWindow();
    window.destroy();
    assert.equal(window.get_mapped(), false);
});

// The other half of the contract: the extra ref is node-gi's, so dropping the
// wrapper must release it. A `GBinding` holds its source WEAKLY, which makes
// `dup_source()` a finalization witness that pins nothing.
const gcSkip = skip || (typeof globalThis.gc === 'function' ? false : 'run with --expose-gc');
test('a destroyed window JS has let go of is finalized, not leaked', { skip: gcSkip }, async () => {
    Gtk.init();
    const GObject = requireGi('GObject', '2.0');
    const target = new Gtk.Label();
    let binding;
    (() => {
        const window = new Gtk.Window({ title: 'released' });
        binding = window.bind_property('title', target, 'label', GObject.BindingFlags.DEFAULT);
        window.destroy();
    })();
    for (let i = 0; i < 6; i++) {
        globalThis.gc();
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setTimeout(resolve, 0));
    }
    assert.equal(binding.dup_source(), null);
});
