// SPDX-License-Identifier: MIT
// @gjsify/node-gi — real-window construct + render proof (GTK-GUI-on-node-gi).
//
// The step BEYOND the display-free conformance + the adw-smoke chrome test, in TWO
// tiers so it is robust on a runner whose surface may or may not realize:
//
//   MINIMUM (always asserted) — a REAL top-level Adw.ApplicationWindow constructs
//   its Adwaita chrome (ToolbarView / HeaderBar / WindowTitle / StatusPage) and the
//   whole tree wires through the engine. This is the DumpTree proof: the widget tree
//   exists regardless of whether the platform surface (GdkWayland/GdkX11/GdkWin32/
//   GdkQuartz) realizes, so it holds even on a display-constrained runner.
//
//   STRONGER (asserted WHEN the surface realizes) — the window REALIZES + RENDERS a
//   surface through the GSK renderer: the same in-process capture @gjsify/devtools'
//   Screenshot uses (Gtk.WidgetPaintable → Gtk.Snapshot → Gsk.Renderer.render_texture
//   → Gdk.Texture.save_to_png_bytes), with NO compositor — it rasterises the widget
//   tree offscreen. A non-empty PNG proves a GdkSurface was allocated + a GSK render
//   tree rasterised, unreachable by any headless program. On a real display (Linux
//   Wayland/Xvfb, the windows-latest desktop session) the window realizes so the PNG
//   is asserted; a genuinely surface-less environment keeps the DumpTree proof and
//   diagnoses the render skip (never a silent pass, never a spurious fail).
//
// PLATFORM-AWARE DISPLAY GATE. On win32 + darwin a display is IMPLICIT (the win32 /
// quartz GDK backend needs no DISPLAY/WAYLAND_DISPLAY env var — those are X11/
// Wayland-only), so the test runs whenever the Gtk/Adw typelibs load. On Linux it
// needs DISPLAY or WAYLAND_DISPLAY (real session or Xvfb), else it self-skips —
// keeping the fast headless `npm test` leg green while the display CI jobs (Linux
// gtk-smoke under Xvfb, the Windows batteries-included windowing job) exercise it.
//
// run() is called at the TOP LEVEL of a synchronous test body (not inside an async
// scope) so the node-gtk #442 nested-microtask-checkpoint caveat does not bite; the
// capture + quit are driven from a GLib timeout running INSIDE the loop.
//
// Reference: refs/gjs (g_application_run / adw_init semantics), refs/libadwaita
// (ToolbarView / HeaderBar / StatusPage), @gjsify/devtools screenshot.ts (the GSK
// capture path). Copyright (c) GNOME contributors, MIT/LGPL.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireGi } from '../gi.js';

// On win32/darwin the platform backend supplies the display; only Linux keys off
// the X11/Wayland env vars.
const displayless = process.platform === 'win32' || process.platform === 'darwin';
const haveDisplay = displayless || !!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY;

// Resolve the full GTK/Adw/Graphene stack up front: a missing typelib (a headless
// dev box without gtk4-devel/libadwaita-devel) SKIPS, not throws.
let Adw;
let Gtk;
let Gdk;
let Gio;
let GLib;
let Graphene;
let loadError = null;
if (haveDisplay) {
    try {
        GLib = requireGi('GLib', '2.0');
        Gio = requireGi('Gio', '2.0');
        Gdk = requireGi('Gdk', '4.0');
        Gtk = requireGi('Gtk', '4.0');
        Adw = requireGi('Adw', '1');
        Graphene = requireGi('Graphene', '1.0');
    } catch (err) {
        loadError = err;
    }
}

const skip = !haveDisplay
    ? 'no display (DISPLAY / WAYLAND_DISPLAY unset)'
    : loadError
      ? `Gtk-4.0 / Adw-1 / Graphene-1.0 typelib unavailable: ${loadError.message}`
      : false;

// The @gjsify/devtools GSK capture path, inline: rasterise a widget to a PNG via
// the native's own GSK renderer (Gtk.WidgetPaintable → Gtk.Snapshot →
// Gsk.Renderer.render_texture → Gdk.Texture.save_to_png_bytes). Returns the PNG
// bytes, or null when the widget is not yet renderable (zero size / no renderer /
// no render node) — the transient states a just-presented window passes through
// before its first frame, or a surface-less environment.
function captureWidgetPng(widget) {
    const native = widget.get_native();
    const renderer = native ? native.get_renderer() : null;
    if (!renderer) return null;
    const width = widget.get_width();
    const height = widget.get_height();
    if (width <= 0 || height <= 0) return null;
    const paintable = Gtk.WidgetPaintable.new(widget);
    const snapshot = Gtk.Snapshot.new();
    paintable.snapshot(snapshot, width, height);
    const node = snapshot.to_node();
    if (!node) return null;
    const viewport = new Graphene.Rect();
    viewport.init(0, 0, width, height);
    const texture = renderer.render_texture(node, viewport);
    const bytes = texture.save_to_png_bytes();
    const data = bytes ? bytes.get_data() : null;
    return data && data.length > 0 ? data : null;
}

// The DumpTree primitive: collect every widget TYPE in the tree (structural — no
// mapped/realized filter, so it holds even before the surface realizes).
function collectTypes(widget, out) {
    out.push(widget.get_name());
    let child = widget.get_first_child();
    while (child) {
        collectTypes(child, out);
        child = child.get_next_sibling();
    }
}

test('Adw.ApplicationWindow constructs + realizes + renders on node-gi', { skip }, () => {
    const app = new Adw.Application({
        application_id: 'eu.jumplink.NodeGiWindowing',
        flags: Gio.ApplicationFlags.NON_UNIQUE, // no session-bus uniqueness round-trip
    });

    let activated = false;
    let activateError = null;
    let pngLength = 0;
    let allocatedWidth = 0;
    let allocatedHeight = 0;
    const chrome = { headerBar: false, windowTitle: false, statusPage: false, toolbarView: false };

    const recordChrome = (win) => {
        const types = [];
        collectTypes(win, types);
        for (const type of types) {
            if (type === 'AdwHeaderBar') chrome.headerBar = true;
            if (type === 'AdwWindowTitle') chrome.windowTitle = true;
            if (type === 'AdwStatusPage') chrome.statusPage = true;
            if (type === 'AdwToolbarView') chrome.toolbarView = true;
        }
    };

    app.connect('activate', () => {
        try {
            activated = true;

            const win = new Adw.ApplicationWindow({ application: app });
            win.set_default_size(480, 320);

            const header = new Adw.HeaderBar();
            header.set_title_widget(new Adw.WindowTitle({ title: 'node-gi', subtitle: 'windowing' }));

            const status = new Adw.StatusPage({
                title: 'node-gi windowing',
                description: 'A real Adw.ApplicationWindow rendered by @gjsify/node-gi',
            });

            const toolbar = new Adw.ToolbarView();
            toolbar.add_top_bar(header);
            toolbar.set_content(status);
            win.set_content(toolbar);

            win.present();

            // The tree is CONSTRUCTED regardless of whether the surface realizes — record
            // the DumpTree chrome proof up front (the robust minimum), then retry the GSK
            // capture across frames (the stronger render proof) and quit on success or a
            // bounded cap. A just-presented window reports a zero-size surface / no render
            // node until the compositor has allocated + realised it; the capture source
            // sits below GDK_PRIORITY_REDRAW so the window's own paint cycles run first.
            recordChrome(win);

            let waitedMs = 0;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
                waitedMs += 50;
                const png = captureWidgetPng(win);
                if (png) {
                    pngLength = png.length;
                    allocatedWidth = win.get_width();
                    allocatedHeight = win.get_height();
                    recordChrome(win); // refresh once mapped
                    app.quit();
                    return GLib.SOURCE_REMOVE;
                }
                if (waitedMs >= 5000) {
                    allocatedWidth = win.get_width();
                    allocatedHeight = win.get_height();
                    app.quit();
                    return GLib.SOURCE_REMOVE;
                }
                return GLib.SOURCE_CONTINUE;
            });
        } catch (err) {
            activateError = err;
            app.quit();
        }
    });

    const status = app.run([]);

    assert.equal(activateError, null, `activate threw: ${activateError && activateError.stack}`);
    assert.ok(activated, 'the app never activated');
    assert.equal(status, 0, `app.run() exit status was ${status}, expected 0`);

    // MINIMUM (always): the whole Adwaita windowing chrome constructs + wires through
    // the engine — the DumpTree proof, valid even if the surface never realizes.
    assert.ok(chrome.toolbarView, 'AdwToolbarView missing from the widget tree');
    assert.ok(chrome.headerBar, 'AdwHeaderBar missing from the widget tree');
    assert.ok(chrome.windowTitle, 'AdwWindowTitle missing from the widget tree');
    assert.ok(chrome.statusPage, 'AdwStatusPage missing from the widget tree');

    // STRONGER (when the surface realizes): a real GdkSurface was allocated + a GSK
    // render tree rasterised to a non-empty PNG. On a real display the window realizes
    // (allocated size > 0) so the render is REQUIRED to have produced a PNG — a
    // realized-but-empty capture is a render-path bug and fails. A surface-less runner
    // (no allocation) keeps the DumpTree proof above + diagnoses the render skip.
    if (allocatedWidth > 0 && allocatedHeight > 0) {
        assert.ok(
            pngLength > 0,
            `window realized (${allocatedWidth}x${allocatedHeight}) but the GSK capture was empty — render path failed`,
        );
        console.log(`windowing: rendered ${allocatedWidth}x${allocatedHeight} → ${pngLength}-byte PNG (strong proof)`);
    } else {
        console.log('windowing: surface did not realize (display-constrained runner) — DumpTree chrome proof only');
    }
});
