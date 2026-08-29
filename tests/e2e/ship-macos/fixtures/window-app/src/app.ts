// SPDX-License-Identifier: MIT
//
// The application a self-contained `<App>.app` carries — #1354 M2b's subject.
//
// It opens a REAL window the way `packages/node-gi/node-gi/test/windowing.test.mjs`
// does, and the capture path is that file's, line for line: Gtk.WidgetPaintable →
// Gtk.Snapshot → Gsk.Renderer.render_texture → Gdk.Texture.save_to_png_bytes. A
// non-empty PNG proves a GdkSurface was allocated and a GSK render tree
// rasterised, which no headless program can reach — and on macOS the quartz
// backend supplies the display, so it needs no `DISPLAY` and no compositor.
//
// WHY IT PRINTS WHAT IT PRINTS. Every line is one claim the milestone makes, in a
// form the CI leg can read back:
//
//   interpreter: …  `process.execPath`. It must be INSIDE the bundle — the whole
//                   point of `Contents/MacOS/node`, and the one thing a leg run
//                   on a runner that also has a Node cannot otherwise tell apart.
//   gtk-runtime: …  `GJSIFY_GTK_RUNTIME` as the LAUNCHER exported it, which is
//                   candidate 1 of `resolveGtkRuntimeBundle()`'s four and the only
//                   one a shipped `.app` can satisfy.
//   chrome: …       the DumpTree proof — the Adwaita widget tree constructed and
//                   wired through the engine, valid even where a surface does not
//                   realize.
//   render: …       the strong proof, or `none` with the reason.
//
// DETERMINISTIC, and quits from a GLib timeout running INSIDE the loop so
// `run()` returns cleanly (the node-gtk #442 nested-microtask caveat).

import GLib from 'gi://GLib?version=2.0';
import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Graphene from 'gi://Graphene?version=1.0';

/**
 * The slice of `Gtk.Widget` this file touches.
 *
 * Written out rather than imported: `@girs/*` is a devDependency this fixture
 * deliberately does not have — it must build from a bare checkout with the
 * workspace's own `node_modules` and nothing else — and `any` would turn the two
 * functions below into unchecked prose.
 */
interface WidgetLike {
    get_name(): string;
    get_first_child(): WidgetLike | null;
    get_next_sibling(): WidgetLike | null;
    get_width(): number;
    get_height(): number;
    get_native(): { get_renderer(): RendererLike | null } | null;
}

/** The GSK renderer's one method this file calls, and what it hands back. */
interface RendererLike {
    render_texture(node: unknown, viewport: unknown): { save_to_png_bytes(): { get_data(): Uint8Array | null } | null };
}

/** Every widget type in the tree — structural, so it holds before the surface realizes. */
function collectTypes(widget: WidgetLike, out: string[]): void {
    out.push(widget.get_name());
    let child = widget.get_first_child();
    while (child) {
        collectTypes(child, out);
        child = child.get_next_sibling();
    }
}

/**
 * Rasterise a widget through the GSK renderer, or `null` while it is not yet
 * renderable (zero size / no renderer / no render node) — the transient states a
 * just-presented window passes through before its first frame.
 */
function captureWidgetPng(widget: WidgetLike): Uint8Array | null {
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

console.log('ship-window-demo: start');
console.log(`interpreter: ${process.execPath}`);
console.log(`gtk-runtime: ${process.env.GJSIFY_GTK_RUNTIME ?? '(unset)'}`);

const app = new Adw.Application({
    application_id: 'eu.jumplink.ShipWindowDemo',
    // No session-bus uniqueness round-trip: a downloaded `.app` on a fresh runner
    // has no reason to have one, and waiting for it is a hang, not a failure.
    flags: Gio.ApplicationFlags.NON_UNIQUE,
});

const chrome = new Set<string>();
let rendered = '';

app.connect('activate', () => {
    try {
        const win = new Adw.ApplicationWindow({ application: app });
        win.set_default_size(480, 320);

        const header = new Adw.HeaderBar();
        header.set_title_widget(new Adw.WindowTitle({ title: 'Ship Window Demo', subtitle: 'self-contained' }));
        const status = new Adw.StatusPage({
            title: 'Ship Window Demo',
            description: 'A real Adw.ApplicationWindow, from a bundle that carries its own GTK',
        });
        const toolbar = new Adw.ToolbarView();
        toolbar.add_top_bar(header);
        toolbar.set_content(status);
        win.set_content(toolbar);

        win.present();

        const record = () => {
            const types: string[] = [];
            collectTypes(win, types);
            for (const type of types) chrome.add(type);
        };
        record();

        let waitedMs = 0;
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            waitedMs += 50;
            const png = captureWidgetPng(win);
            if (png) {
                record();
                rendered = `${win.get_width()}x${win.get_height()} ${png.length}`;
                app.quit();
                return GLib.SOURCE_REMOVE;
            }
            if (waitedMs >= 5000) {
                rendered = `none ${win.get_width()}x${win.get_height()}`;
                app.quit();
                return GLib.SOURCE_REMOVE;
            }
            return GLib.SOURCE_CONTINUE;
        });
    } catch (error) {
        // A deterministic line rather than a hang: a golden mismatch that names the
        // cause is worth more than a five-minute timeout that names the job.
        console.log(`activate-error: ${error instanceof Error ? error.message : String(error)}`);
        app.quit();
    }
});

// Top-level, not inside an async scope — the node-gtk #442 nested-microtask-
// checkpoint caveat, the same reason `windowing.test.mjs` calls it where it does.
const exitStatus = app.run([]);

const wanted = ['AdwToolbarView', 'AdwHeaderBar', 'AdwWindowTitle', 'AdwStatusPage'];
const missing = wanted.filter((type) => !chrome.has(type));
console.log(`chrome: ${missing.length === 0 ? 'ok' : `missing ${missing.join(',')}`}`);
console.log(`render: ${rendered || 'none (never activated)'}`);
console.log(`done: ${exitStatus}`);
process.exitCode = exitStatus;
