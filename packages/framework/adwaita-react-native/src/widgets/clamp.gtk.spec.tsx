/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK half, against the libadwaita that is installed — tree first, picture second.
//
// A TREE ASSERT AND A PHOTOGRAPH ANSWER DIFFERENT QUESTIONS. `get_child()` returning
// the label proves `set_child` was called; it says nothing about whether the label was
// ever allocated. GTK's failure mode is exit 0 with an empty window, so the second
// question needs `shotEvidence` — the strict descendant count, the allocation, and the
// PNG byte count of a real GSK render. That distinction is not hypothetical here: four
// `className`-bearing documentation snippets in this repository were measured to
// produce an empty window at exit 0 with zero GTK diagnostics, because the styling
// layer refused the tree before the first render.
//
// The picture is taken WITHOUT `@gjsify/devtools`. `shotEvidence` takes its `capture`
// as a parameter — gtk-host depends on no `@gjsify/*` package and an edge up to a
// devtool would invert the direction — so this file passes `Gtk.WidgetPaintable` →
// `render_texture` → `save_to_png_bytes` in directly. It is `captureWidgetPng`'s own
// sequence with one difference: a `null` viewport instead of a `Graphene.Rect`
// initialised to `(0, 0, width, height)`. A null viewport renders the node's own
// bounds, and the node is a paintable snapshot of exactly that size, so the two produce
// the same image — and this file avoids a dependency for a rectangle.
//
// THE NUMBERS ARE SHARED WITH `clamp.native.spec.tsx`. A 1000-point frame with
// `maximum-size` 400 puts the child at x=300, width=400 on both renderers, because
// `adw_clamp_layout_allocate` and `@gjsify/adwaita-core`'s port of it are the same
// curve. Asserting the number rather than "it looks clamped" is what makes the two
// halves one widget.

import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { registerBuiltinWidgets, shotEvidence, blankReason, type CaptureWidget } from '@gjsify/gtk-host';
import { dumpTree, gtkChildren, installDiagnosticsGate } from '@gjsify/gtk-host/conformance';
import { createRoot } from '@gjsify/gtk-host/react';

import { AdwBin } from './bin.gtk.js';
import { AdwClamp } from './clamp.gtk.js';

/** Named identities, not a capability probe: a suite that ran zero tests reports success. */
const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

/** The frame `clamp.native.spec.tsx` asks the same question in. */
const FRAME_WIDTH = 1000;
const FRAME_HEIGHT = 200;

/**
 * The three calls `@gjsify/devtools`' `captureWidgetPng` makes, inlined.
 *
 * `null` means "no renderer or no size yet" and is what `blankReason` reads as
 * "measured before it was ever on screen" — never "the image is empty".
 */
const capture: CaptureWidget = (widget) => {
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

const typeOf = (widget: Gtk.Widget): string =>
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

/**
 * Mount into a REALISED, sized window and let GTK lay out, then run the body.
 *
 * A `Gtk.Box` that is not in a window is never allocated, so every size read off it is
 * 0 — which is the difference between this helper and the one in
 * `@gjsify/react-native`'s suite, and the reason a photograph needs its own. The
 * window is `present()`ed and the main context pumped until the clamp has a width;
 * without the pump the first `get_width()` is 0 and the assertion would be measuring
 * the scheduler.
 */
function laidOut(element: React.ReactNode, body: (container: Gtk.Widget) => void): void {
    const window = new Gtk.Window({ defaultWidth: FRAME_WIDTH, defaultHeight: FRAME_HEIGHT });
    const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, hexpand: true, vexpand: true });
    window.set_child(container);
    const root = createRoot(container);
    try {
        root.render(element);
        window.present();
        const context = GLib.MainContext.default();
        for (let i = 0; i < 200 && container.get_width() <= 0; i += 1) {
            while (context.pending()) context.iteration(false);
        }
        while (context.pending()) context.iteration(false);
        body(container);
    } finally {
        root.unmount();
        window.destroy();
    }
}

/** First strict descendant of a GType, breadth-first over the REAL tree. */
function find(root: Gtk.Widget, gtype: string): Gtk.Widget {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === gtype) return widget;
        queue.push(...gtkChildren(widget));
    }
    throw new Error(`no ${gtype} under:\n${dumpTree(root)}`);
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        Adw.init();
        registerBuiltinWidgets();
        const display = Gdk.Display.get_default();
        const diagnostics = installDiagnosticsGate();
        const gated = (name: string, run: () => Promise<void>): Promise<void> =>
            describe(name, async () => {
                beforeEach(() => diagnostics.reset());
                afterEach(() => diagnostics.assertQuiet());
                await run();
            }) as Promise<void>;

        await gated('the widgets are the real libadwaita ones', async () => {
            await it('renders AdwBin as an Adw.Bin holding its child', async () => {
                laidOut(
                    <AdwBin>
                        <gtk-label label="inside" />
                    </AdwBin>,
                    (container) => {
                        const bin = find(container, 'AdwBin') as Adw.Bin;
                        expect(typeOf(bin.get_child() as Gtk.Widget)).toBe('GtkLabel');
                    },
                );
            });

            await it('renders AdwClamp as an Adw.Clamp carrying the property', async () => {
                laidOut(
                    <AdwClamp maximumSize={400}>
                        <gtk-label label="inside" />
                    </AdwClamp>,
                    (container) => {
                        const clamp = find(container, 'AdwClamp') as Adw.Clamp;
                        expect(clamp.maximumSize).toBe(400);
                        expect(typeOf(clamp.get_child() as Gtk.Widget)).toBe('GtkLabel');
                    },
                );
            });
        });

        if (display !== null) {
            await gated('the picture, not only the setter', async () => {
                await it('clamps and centres the child at the shared numbers', async () => {
                    laidOut(
                        <AdwClamp maximumSize={400}>
                            <gtk-label label="inside" hexpand={true} />
                        </AdwClamp>,
                        (container) => {
                            const clamp = find(container, 'AdwClamp');
                            const evidence = shotEvidence(clamp, capture);
                            expect(blankReason(evidence)).toBe(null);
                            expect(clamp.get_width()).toBe(FRAME_WIDTH);

                            const child = find(clamp, 'GtkLabel');
                            const bounds = child.compute_bounds(clamp);
                            expect(bounds[0]).toBe(true);
                            // The same pair `clamp.native.spec.tsx` asserts as a style.
                            expect(Math.round(bounds[1].get_width())).toBe(400);
                            expect(Math.round(bounds[1].get_x())).toBe(300);
                        },
                    );
                });
            });
        }
    });
};
