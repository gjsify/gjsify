/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK spec harness — what every `*.gtk.spec.tsx` in this package needs before it can
// assert anything, in one place.
//
// IT IS NAMED `*.spec.tsx` AND EXPORTS NO SUITE, deliberately. The suffix is what keeps
// it out of the shipped library (`build:gjsify` excludes `src/**/*.spec.*`), and
// `check-node-test-registration.mjs` closes its reachability set over spec-to-spec
// imports for exactly this shape — `packages/node/fs/src/capabilities.spec.ts` is the
// same thing for six siblings. A helper under a non-spec name would ship a GTK-only
// module inside a package a phone installs.
//
// WHY A HARNESS AT ALL. Six widgets need the same four things, and the first version of
// each was a copy in `clamp.gtk.spec.tsx`: a REALISED, sized, pumped window (a widget
// that is not in one is never allocated, so every size read off it is 0), a
// breadth-first search of the REAL GTK tree, a GType name, and a diagnostics gate on
// every test. The gate is the load-bearing one — GTK's failure mode is exit 0, and
// without `installDiagnosticsGate` the whole mis-parenting class is invisible.
//
// The picture is taken WITHOUT `@gjsify/devtools`. `shotEvidence` takes its `capture` as
// a parameter — gtk-host depends on no `@gjsify/*` package and an edge up to a devtool
// would invert the direction — so this file passes `Gtk.WidgetPaintable` →
// `render_texture` → `save_to_png_bytes` in directly. It is `captureWidgetPng`'s own
// sequence with one difference: a `null` viewport instead of a `Graphene.Rect`
// initialised to `(0, 0, width, height)`. A null viewport renders the node's own bounds,
// and the node is a paintable snapshot of exactly that size, so the two produce the same
// image — and this avoids a dependency for a rectangle.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { afterEach, beforeEach, describe, on, type Runtime } from '@gjsify/unit';
import { registerBuiltinWidgets, type CaptureWidget } from '@gjsify/gtk-host';
import { dumpTree, gtkChildren, installDiagnosticsGate } from '@gjsify/gtk-host/conformance';
import { createRoot } from '@gjsify/gtk-host/react';

/** Named identities, not a capability probe: a suite that ran zero tests reports success. */
export const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

/** The frame every suite that does not care about width is laid out in. */
export const FRAME_WIDTH = 1000;

/** …and its height. */
export const FRAME_HEIGHT = 200;

/**
 * The three calls `@gjsify/devtools`' `captureWidgetPng` makes, inlined.
 *
 * `null` means "no renderer or no size yet" and is what `blankReason` reads as "measured
 * before it was ever on screen" — never "the image is empty".
 */
export const capture: CaptureWidget = (widget) => {
    const native = widget.get_native();
    const renderer = native?.get_renderer();
    if (!renderer) return null;
    const paintable = Gtk.WidgetPaintable.new(widget);
    const width = widget.get_width();
    const height = widget.get_height();
    if (width <= 0 || height <= 0) return null;
    const snapshot = Gtk.Snapshot.new();
    paintable.snapshot(snapshot, width, height);
    const node = snapshot.to_node();
    if (!node) return null;
    const texture = renderer.render_texture(node, null);
    return texture.save_to_png_bytes().get_data();
};

/** The GType name a widget actually has, for an assertion that names the class. */
export const typeOf = (widget: Gtk.Widget): string =>
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

/**
 * Mount into a REALISED, sized window and let GTK lay out, then run the body.
 *
 * A `Gtk.Box` that is not in a window is never allocated, so every size read off it is 0.
 * The window is `present()`ed and the main context pumped until the container has a
 * width; without the pump the first `get_width()` is 0 and the assertion would be
 * measuring the scheduler.
 *
 * `title` is on the window because `Adw.HeaderBar` RESOLVES its derived title from the
 * root window (`update_title`, adw-header-bar.c:475) — the one thing a header-bar suite
 * cannot set up any other way.
 *
 * `rerender` is the THIRD argument because an update is a different claim from a mount,
 * and the same root has to serve both: a second `createRoot` over the same container
 * builds a second tree beside the first, so the suite would read a widget nothing
 * updated. It pumps too — an assertion straight after a render measures the scheduler.
 */
export function laidOut(
    element: React.ReactNode,
    body: (container: Gtk.Widget, window: Gtk.Window, rerender: (next: React.ReactNode) => void) => void,
    options: { frameWidth?: number; frameHeight?: number; title?: string } = {},
): void {
    const window = new Gtk.Window({
        defaultWidth: options.frameWidth ?? FRAME_WIDTH,
        defaultHeight: options.frameHeight ?? FRAME_HEIGHT,
        ...(options.title === undefined ? {} : { title: options.title }),
    });
    const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true, vexpand: true });
    window.set_child(container);
    const root = createRoot(container);
    const settle = (): void => {
        const context = GLib.MainContext.default();
        for (let i = 0; i < 200 && container.get_width() <= 0; i += 1) {
            while (context.pending()) context.iteration(false);
        }
        while (context.pending()) context.iteration(false);
        // AND WAIT FOR A FRAME, which draining the main context does not do. `present()`
        // leaves the first allocation pending in the context, so a mount needs nothing
        // more; a later reorder or property write only QUEUES a resize, and the
        // allocation runs on the frame clock. Measured: after a reorder the real GTK
        // child list was already in its new order while every `compute_bounds` still
        // reported the OLD x — a stale number, at exit 0, in a suite whose whole subject
        // is where children end up. `begin_updating` makes the clock tick so the
        // blocking iteration below has something to return on, and the counter is what
        // says a frame HAPPENED rather than that some source did.
        const clock = window.get_frame_clock();
        if (clock === null) return;
        const before = clock.get_frame_counter();
        const deadline = GLib.get_monotonic_time() + 1_000_000;
        clock.begin_updating();
        try {
            while (clock.get_frame_counter() === before && GLib.get_monotonic_time() < deadline) {
                context.iteration(true);
            }
        } finally {
            clock.end_updating();
        }
    };
    try {
        root.render(element);
        window.present();
        settle();
        body(container, window, (next) => {
            root.render(next);
            settle();
        });
    } finally {
        root.unmount();
        window.destroy();
    }
}

/** First strict descendant of a GType, breadth-first over the REAL tree. */
export function find(root: Gtk.Widget, gtype: string): Gtk.Widget {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === gtype) return widget;
        queue.push(...gtkChildren(widget));
    }
    throw new Error(`no ${gtype} under:\n${dumpTree(root)}`);
}

/**
 * Is `child` inside a node carrying `cssClass`, up to `root`?
 *
 * THE ONLY WAY TO ASSERT A SLOT, for the slots whose adder is write-only. `add_top_bar`
 * has no getter and `Adw.HeaderBar`'s two ends have none either, so a presence-based
 * assertion passes with the child authored into the WRONG slot — measured in gtk-host's
 * own conformance vectors, where every such assertion passed with a top bar authored
 * into `bottom`. What separates them is the style class libadwaita puts on the internal
 * box it packs into: `top-bar`/`bottom-bar` on the toolbar view (`_toolbars.scss`),
 * `start`/`end` on the header bar's two `GtkBox`es (measured on libadwaita 1.9.3).
 */
export function insideClass(child: Gtk.Widget, root: Gtk.Widget, cssClass: string): boolean {
    for (let node: Gtk.Widget | null = child; node !== null && node !== root; node = node.get_parent()) {
        if (node.get_css_classes().includes(cssClass)) return true;
    }
    return false;
}

/** What {@link withGtk} hands a suite. */
export interface GtkHarness {
    /** `describe`, with the diagnostics gate reset before and asserted after every test. */
    gated: (name: string, run: () => Promise<void>) => Promise<void>;
    /** The default display, or `null` where there is none — a photograph needs one. */
    display: Gdk.Display | null;
}

/**
 * Initialise GTK once, register the widget table, install the diagnostics gate, and run
 * the suite inside it.
 *
 * `installDiagnosticsGate` is not optional decoration. Writing `css-classes` clobbers an
 * orientation class, a generic `insert_before` on a `Gtk.ListBox` emitted 1 230 783
 * `Gtk-WARNING` lines, and both are exit 0 — so every test in this package asserts zero
 * GTK diagnostics as well as its own numbers.
 */
export async function withGtk(suite: (harness: GtkHarness) => Promise<void>): Promise<void> {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        Adw.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();
        const gated = (name: string, run: () => Promise<void>): Promise<void> =>
            describe(name, async () => {
                beforeEach(() => diagnostics.reset());
                afterEach(() => diagnostics.assertQuiet());
                await run();
            }) as Promise<void>;
        await suite({ gated, display: Gdk.Display.get_default() });
    });
}
