#!/usr/bin/env -S gjs
// SPDX-License-Identifier: MIT
//
// Which GSK renderer does GTK4 actually pick on macOS, and does a GL context
// realise? Companion to docs/adr/0022-webkit-on-darwin.md.
//
//   DYLD_FALLBACK_LIBRARY_PATH=/usr/local/lib:/usr/lib \
//       gjs docs/poc/gsk-renderer-darwin.gjs.js
//
// The variable is NOT optional and is not a workaround for this script: a
// typelib names its library by bare leaf (`libgtk-4.1.dylib`) and Homebrew's
// gjs carries one rpath, into GLIB's keg only. Without it the run dies at
// `Failed to load shared library 'libgtk-4.1.dylib'`. `@gjsify/cli` performs
// exactly this repair on every gjs child it launches (`buildNativeEnv()` ->
// systemGiLibraryDirs()); running the probe by hand means doing it by hand.
//
// Expected on macOS 15.7.8 / x86_64, a VM with no GPU:
//
//   display        : GdkMacosDisplay
//   GSK_RENDERER   : <unset — GTK chooses>
//     GskNglRenderer     available
//     GskVulkanRenderer  available
//     GskCairoRenderer   available
//     GskGLRenderer      available
//   chosen renderer: GskGLRenderer
//   GL context     : GL — version 4.1
//
// The load-bearing readings: GTK picks GL and does NOT fall back to cairo on
// its own, and macOS caps OpenGL at 4.1 (deprecated since 10.14). Both are why
// the ADR forbids hardcoding GSK_RENDERER and routes output through GdkTexture.

imports.gi.versions.Gtk = '4.0';
const { GLib, Gtk, Gdk, Gsk } = imports.gi;
Gtk.init();
const display = Gdk.Display.get_default();
print(`display        : ${display ? display.constructor.$gtype.name : 'none'}`);
print(`GSK_RENDERER   : ${GLib.getenv('GSK_RENDERER') ?? '<unset — GTK chooses>'}`);
for (const name of ['GskNglRenderer', 'GskVulkanRenderer', 'GskCairoRenderer', 'GskGLRenderer']) {
    print(`  ${name.padEnd(18)} ${Gsk[name.replace('Gsk', '')] !== undefined ? 'available' : '—'}`);
}
// What a window actually gets — the honest answer, not the enum list.
const win = new Gtk.Window({ defaultWidth: 64, defaultHeight: 64 });
win.present();
const ctx = GLib.MainContext.default();
for (let i = 0; i < 50 && !win.get_native()?.get_renderer(); i++) ctx.iteration(false);
const renderer = win.get_native()?.get_renderer();
print(`chosen renderer: ${renderer ? renderer.constructor.$gtype.name : 'not realised'}`);
// And whether a GL context can be created at all — the hardware question.
// Gdk.GLAPI is a FLAGS type, so print the names rather than the bare integer:
// desktop GL vs GLES is the load-bearing distinction, and `1` does not say it.
const glApiNames = (api) =>
    [
        [Gdk.GLAPI.GL, 'GL'],
        [Gdk.GLAPI.GLES, 'GLES'],
    ]
        .filter(([bit]) => (api & bit) !== 0)
        .map(([, name]) => name)
        .join('+') || String(api);
try {
    const surface = win.get_native().get_surface();
    const gl = surface.create_gl_context();
    gl.realize();
    print(`GL context     : ${glApiNames(gl.get_api())} — version ${gl.get_version().join('.')}`);
} catch (e) {
    print(`GL context     : unavailable — ${e.message}`);
}
win.destroy();
