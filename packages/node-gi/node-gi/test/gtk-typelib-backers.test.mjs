// SPDX-License-Identifier: MIT
// @gjsify/node-gi — can the LOADER find the libraries a typelib names by leaf?
//
// Not "is the dependency installed": `gjsify system-check` reported GTK4,
// libadwaita and GObject Introspection all present on the exact host where
// `showcase canvas2d-fireworks --runtime node` died with "Failed to load shared
// library 'libgtk-4.1.dylib'" → "Gtk.DrawingArea is not a subclassable GObject
// type". The answer differs per runtime on one machine: Homebrew's `gjs` binary
// carries an rpath into `<prefix>/lib`, a plain `node` does not, so `--runtime
// gjs` passed while `--runtime node` failed on an identical installation.
//
// Display-free on purpose: `DISPLAY`/`WAYLAND_DISPLAY` are never set on macOS
// even though GTK's quartz backend works, so a display-gated GTK suite skips
// entirely on darwin and could not have caught this. The failure lands in
// `GObject.registerClass` while resolving the parent's `get_type()`, before any
// window, display or main loop exists (`gi_repository_require` finds the typelib,
// `g_module_open(<leaf>)` fails, no GType is registered) — so a bare subclass
// declaration is a complete assertion.
//
// TWO namespaces from two Homebrew formulas, each in its own Cellar libdir: a
// repair aimed at one library (`pkg-config --variable=libdir gtk4`) resolves Gtk
// and still leaves `libgdk_pixbuf-2.0.0.dylib` unresolvable — measured, part 1
// passes and part 2 fails. One namespace would have ratified that fix.
//
// Run with the loader variables UNSET — macOS CI uses `env -u
// DYLD_FALLBACK_LIBRARY_PATH -u DYLD_LIBRARY_PATH`, because the job's own
// `DYLD_FALLBACK_LIBRARY_PATH=$BREW_PREFIX/lib` export is what hid this from CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

// A box without the gtk4/gdk-pixbuf introspection data SKIPS; a box with them PASSES.
let GObject;
let Gtk;
let GdkPixbuf;
let loadError = null;
try {
    GObject = requireGi('GObject', '2.0');
    Gtk = requireGi('Gtk', '4.0');
    GdkPixbuf = requireGi('GdkPixbuf', '2.0');
} catch (err) {
    // A missing typelib is out of scope: the loader question only exists once it resolves.
    loadError = err;
}

const skip = loadError ? `Gtk-4.0 / GdkPixbuf-2.0 typelib unavailable: ${loadError.message}` : false;

test('a typelib-backed GType resolves through the loader (Gtk)', { skip }, () => {
    // registerClass must resolve gtk_drawing_area_get_type() out of libgtk-4.
    const Subclass = GObject.registerClass(
        { GTypeName: 'NodeGiLoaderProbeArea' },
        class NodeGiLoaderProbeArea extends Gtk.DrawingArea {},
    );
    assert.ok(Subclass, 'Gtk.DrawingArea must be subclassable');
    assert.ok(
        GObject.type_from_name('NodeGiLoaderProbeArea'),
        'the new GType must be registered, which requires the parent GType to exist',
    );
});

test("a SECOND package's typelib backer resolves too (GdkPixbuf)", { skip }, () => {
    const Subclass = GObject.registerClass(
        { GTypeName: 'NodeGiLoaderProbePixbuf' },
        class NodeGiLoaderProbePixbuf extends GdkPixbuf.Pixbuf {},
    );
    assert.ok(Subclass, 'GdkPixbuf.Pixbuf must be subclassable');
    assert.ok(GObject.type_from_name('NodeGiLoaderProbePixbuf'), 'the new GType must be registered');
});
