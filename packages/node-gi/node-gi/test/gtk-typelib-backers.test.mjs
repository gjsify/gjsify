// SPDX-License-Identifier: MIT
// @gjsify/node-gi — can the LOADER find the libraries a typelib names by leaf?
//
// THE QUESTION THIS ASKS, and why it is not the one anything else asked. Every
// existing check verifies that a dependency is INSTALLED: `gjsify system-check`
// reported Node 24.18.1, GJS 1.88.1, GTK4 4.22.4, libadwaita, GObject
// Introspection 1.86.0 — all present — on the exact host where
// `showcase canvas2d-fireworks --runtime node` died with
//
//     GLib-GIRepository-WARNING: Failed to load shared library 'libgtk-4.1.dylib'
//     TypeError: Gtk.DrawingArea is not a subclassable GObject type
//
// "Is it installed" is measurably the wrong question. The right one is "can the
// dynamic loader find it FROM THE RUNTIME WE ARE ABOUT TO SPAWN", and it has a
// different answer per runtime on the same machine: Homebrew's `gjs` binary
// carries an rpath into `<prefix>/lib`, a plain `node` does not, so `--runtime
// gjs` passed while `--runtime node` failed with an identical installation.
//
// DELIBERATELY DISPLAY-FREE, and that is what makes it a usable gate. Every other
// GTK test here self-skips on `DISPLAY`/`WAYLAND_DISPLAY`, which are never set on
// macOS even though GTK's quartz backend works — so the whole GTK suite silently
// skips on darwin and could not have caught this. The failure happens in
// `GObject.registerClass` while resolving the parent's `get_type()`, strictly
// BEFORE any window, display or main loop exists: `gi_repository_require` finds
// the typelib, `g_module_open(<leaf>)` fails, no GType is registered. So a bare
// subclass declaration is a complete assertion.
//
// TWO namespaces on purpose, from two different packages. On Homebrew each formula
// installs into its OWN Cellar libdir and is symlinked into the shared
// `<prefix>/lib`; a repair aimed at one library (`pkg-config --variable=libdir
// gtk4` → `/usr/local/Cellar/gtk4/4.22.4/lib`) resolves Gtk and still leaves
// `libgdk_pixbuf-2.0.0.dylib` unresolvable. Measured: with only the gtk4 Cellar
// libdir on the loader path, part 1 passes and part 2 fails with
// "GdkPixbuf.Pixbuf is not a subclassable GObject type". Testing one namespace
// would have ratified the incomplete fix.
//
// Run it with the loader variables UNSET to prove the env-free path — that is what
// the macOS CI step does (`env -u DYLD_FALLBACK_LIBRARY_PATH -u DYLD_LIBRARY_PATH`),
// because the job otherwise exports `DYLD_FALLBACK_LIBRARY_PATH=$BREW_PREFIX/lib`
// itself and that hand-written compensation is precisely what hid this bug from CI.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

// No display gate: only the typelibs have to be present. A headless box without
// gtk4/gdk-pixbuf introspection data SKIPS; a box that has them must PASS.
let GObject;
let Gtk;
let GdkPixbuf;
let loadError = null;
try {
    GObject = requireGi('GObject', '2.0');
    Gtk = requireGi('Gtk', '4.0');
    GdkPixbuf = requireGi('GdkPixbuf', '2.0');
} catch (err) {
    // A missing typelib is "not installed" and genuinely out of scope here; the
    // loader question only exists once the typelib resolves.
    loadError = err;
}

const skip = loadError ? `Gtk-4.0 / GdkPixbuf-2.0 typelib unavailable: ${loadError.message}` : false;

test('a typelib-backed GType resolves through the loader (Gtk)', { skip }, () => {
    // registerClass must resolve gtk_drawing_area_get_type() out of libgtk-4 —
    // the exact call that reported "not a subclassable GObject type" when the
    // loader could not find the dylib the Gtk-4.0 typelib names.
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
    // Guards against a per-formula repair: GdkPixbuf ships in a different
    // Homebrew keg than GTK, so this fails whenever the loader path names one
    // library's directory instead of the directory holding the whole GI stack.
    const Subclass = GObject.registerClass(
        { GTypeName: 'NodeGiLoaderProbePixbuf' },
        class NodeGiLoaderProbePixbuf extends GdkPixbuf.Pixbuf {},
    );
    assert.ok(Subclass, 'GdkPixbuf.Pixbuf must be subclassable');
    assert.ok(GObject.type_from_name('NodeGiLoaderProbePixbuf'), 'the new GType must be registered');
});
