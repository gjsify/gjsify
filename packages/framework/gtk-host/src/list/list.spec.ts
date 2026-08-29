// A list with a SECOND dialect on it — Solid rows over the shared controller.
//
// The point of this file is not that Solid can render a label. It is that the model,
// the factory, the key diff and the teardown authority in `controller.ts` are reached
// here through the same three callbacks React Native reaches them through, so a
// measurement stated once in that file is a measurement two renderers obey. An
// extraction nothing else uses is a refactor; this is what makes it a capability.
//
// THE VIEW IS ROOTED IN A `Gtk.Window`, and that is a precondition rather than a
// convenience: a `Gtk.ListView` binds NOTHING while detached, and binds every row the
// moment it is rooted. That is measured in `host.spec.ts` ("takes the item a REAL
// Gtk.ListView factory hands out"), which is also where the window's own shape comes
// from — CONSTRUCTED and never presented, so nothing here needs a compositor beyond
// the `Gtk.init()` this gate already requires.
//
// ROWS ARE DRAINED WITH AN `await`, never a synchronous flush seam. Solid happens to
// need no deferral at all — `@gjsify/gtk-host/react` refuses a re-entrant flush BY NAME
// and React Native's sink therefore renders a row on a microtask, and that refusal is
// React's, not GTK's. The `await` is here anyway because it observes the REAL path
// whichever of the two a dialect takes; a spec that reached for a flush seam would be
// testing a shortcut and would go green against either.

import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import { expect, it, on } from '@gjsify/unit';

import { createElement, effect, listRows, setProp, type ListRowHandle } from '../adapters/solid.js';
import { gtkChildren, installDiagnosticsGate } from '../conformance/index.js';
import { registerBuiltinWidgets } from '../descriptors/index.js';
import { GTK_HOSTS, gated } from '../testing/gate.mjs';
import { ListController, onScrollNearEnd, type ListRowSink } from './index.js';
import type { HostNode } from '../types.js';

/** The row shape every vector below uses. */
interface Row {
    readonly key: string;
    readonly title: string;
}

const typeOf = (widget: Gtk.Widget): string =>
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

/** Every `Gtk.Label`'s text under `root`, breadth-first — which is what a row renders to. */
function labels(root: Gtk.Widget): string[] {
    const out: string[] = [];
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === 'GtkLabel') out.push((widget as Gtk.Label).label);
        queue.push(...gtkChildren(widget));
    }
    return out;
}

/** The first `Gtk.Label` under `root`, as an OBJECT — identity is what vector 2 asserts. */
function firstLabel(root: Gtk.Widget): Gtk.Widget | null {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === 'GtkLabel') return widget;
        queue.push(...gtkChildren(widget));
    }
    return null;
}

/**
 * A row, built the way COMPILED JSX builds one: an element, and an effect per property.
 *
 * The `effect` is the whole reason the accessor form of the seam matters — it re-runs
 * on a content change and writes the ONE property that moved, which is how vector 2 can
 * assert the widget survived.
 */
const rowBody = (row: () => Row, index: () => number): HostNode => {
    const label = createElement('GtkLabel');
    effect(() => setProp(label, 'label', `${index()}:${row().title}`));
    return label;
};

/** Let every queued microtask run — where a dialect that defers would have done its work. */
const drain = (): Promise<void> => new Promise<void>((resolve) => queueMicrotask(resolve));

/**
 * How many row widgets the dialect was asked to mount, and how many to release.
 *
 * `liveRows` cannot answer the second question — it says the controller FORGOT a
 * handle, not that the dialect was TOLD to let go of it, and a controller that forgets
 * without telling leaks a reactive root and every handler inside that row for the life
 * of the process. That is the header's third measurement seen from the seam, and
 * nothing but the seam can see it: after GTK has dropped a row's widgets there is no
 * tree left to ask. Measured as a gap — removing `disposeRow` from `#teardown` left
 * every other vector in this file green.
 */
interface Census {
    mounted: number;
    released: number;
    /**
     * `showRow(handle, null, …)` — how a dialect is told to EMPTY a departing row.
     *
     * Counted separately because nothing else can see it. It is one of the three rows of
     * the published seam contract, and replacing `#unbind`'s call with a no-op left every
     * other vector in this file green: GTK emits `unbind` and then `teardown`, so a row
     * that was never emptied is torn down a moment later and the widget tree ends up in
     * the same state either way. Measured as a gap, exactly like `released`.
     */
    emptied: number;
}

interface Mounted {
    readonly view: Gtk.ListView;
    readonly controller: ListController<Row, ListRowHandle<Row>>;
    readonly census: Census;
    setRows(rows: readonly Row[]): Promise<void>;
}

/** The real Solid sink, counted on both sides. Nothing about a row is simulated. */
function counted(census: Census): ListRowSink<Row, ListRowHandle<Row>> {
    const rows = listRows<Row>(rowBody);
    return {
        mountRow(item) {
            census.mounted += 1;
            return rows.mountRow(item);
        },
        showRow(handle, row, index) {
            if (row === null) census.emptied += 1;
            rows.showRow(handle, row, index);
        },
        disposeRow(handle) {
            census.released += 1;
            rows.disposeRow(handle);
        },
    };
}

/**
 * A controller on a real view in a real window, torn down in the one safe order.
 *
 * `dispose()` BEFORE `window.destroy()`, always: the controller is the authority on
 * teardown precisely because GTK's own `teardown` signal fires during GC sweeping,
 * where GJS blocks the callback (`controller.ts` carries the measurement). The other
 * order is the one that leaves handlers on a factory whose view is about to be
 * collected.
 */
async function mounted(body: (mount: Mounted) => Promise<void>): Promise<void> {
    const window = new Gtk.Window();
    const view = new Gtk.ListView();
    const census: Census = { mounted: 0, released: 0, emptied: 0 };
    const controller = new ListController<Row, ListRowHandle<Row>>(counted(census));
    controller.attach(view);
    window.set_child(view);
    try {
        await body({
            view,
            controller,
            census,
            setRows: async (rows) => {
                controller.setRows(rows);
                await drain();
            },
        });
    } finally {
        controller.dispose();
        window.destroy();
    }
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'a Solid list over the shared controller', async () => {
            await it('renders one row per model entry, with its position', async () => {
                await mounted(async (mount) => {
                    await mount.setRows([
                        { key: 'a', title: 'alpha' },
                        { key: 'b', title: 'beta' },
                        { key: 'c', title: 'gamma' },
                    ]);
                    expect(labels(mount.view)).toStrictEqual(['0:alpha', '1:beta', '2:gamma']);
                    // The controller's own count, not a widget walk: a row GTK holds a
                    // widget for is a handle the dialect was asked to mount.
                    expect(mount.controller.liveRows).toBe(3);
                });
            });

            await it('updates a row IN PLACE when its key did not change, keeping the widget', async () => {
                // The vector the extraction exists for, and it asserts two things at
                // once. That the controller pushes a content change through to a row
                // whose model object GTK will not re-bind — and that the CARRIER was
                // taken once, at setup: a dialect adopting per bind would refuse this
                // second show with `occupied-slot`, which `host.spec.ts` pins.
                //
                // Widget IDENTITY is the assertion React Native's equivalent cannot
                // make: its row rebuilds a React tree, Solid writes one property.
                await mounted(async (mount) => {
                    await mount.setRows([{ key: 'a', title: 'first' }]);
                    const before = firstLabel(mount.view);
                    expect(before !== null).toBe(true);
                    expect(labels(mount.view)).toStrictEqual(['0:first']);
                    await mount.setRows([{ key: 'a', title: 'second' }]);
                    expect(labels(mount.view)).toStrictEqual(['0:second']);
                    expect(firstLabel(mount.view)).toBe(before);
                });
            });

            await it('splices the model when the keys DO change', async () => {
                await mounted(async (mount) => {
                    await mount.setRows([
                        { key: 'a', title: 'a' },
                        { key: 'b', title: 'b' },
                    ]);
                    expect(labels(mount.view)).toStrictEqual(['0:a', '1:b']);
                    await mount.setRows([{ key: 'c', title: 'c' }]);
                    expect(labels(mount.view)).toStrictEqual(['0:c']);
                });
            });

            await it('empties the view when the rows go away, and lets go of every row', async () => {
                await mounted(async (mount) => {
                    await mount.setRows([
                        { key: 'a', title: 'a' },
                        { key: 'b', title: 'b' },
                    ]);
                    expect(mount.controller.liveRows).toBe(2);
                    await mount.setRows([]);
                    expect(labels(mount.view)).toStrictEqual([]);
                    // GTK tears the row widgets down on the splice, and the controller
                    // hands each handle back to the dialect as it goes.
                    expect(mount.controller.liveRows).toBe(0);
                    // BOTH sides of the seam, not just the controller's own count.
                    expect(mount.census.mounted > 0).toBe(true);
                    expect(mount.census.released).toBe(mount.census.mounted);
                    // And each one was EMPTIED on its way out. MEASURED on gtk 4.22.4:
                    // a splice emits `unbind` before `teardown` and the item still
                    // answers `get_item()` at `unbind`, so this is the moment a dialect
                    // is told to let a departing row go — the third row of the contract,
                    // and the one nothing observed until this counter existed.
                    expect(mount.census.emptied).toBe(mount.census.mounted);
                });
            });

            await it('gives the view back on dispose, so nothing is left for GC to block', async () => {
                // The hazard the header's third measurement is about: a factory whose
                // handlers are still connected when its view is collected produced six
                // Gjs criticals and ran none of them. The gate around this describe is
                // what would report them; these three reads are what the gate cannot
                // see — that the view really was let go, rather than merely quiet.
                await mounted(async (mount) => {
                    await mount.setRows([{ key: 'a', title: 'a' }]);
                    expect(mount.controller.liveRows).toBe(1);
                    mount.controller.dispose();
                    expect(mount.controller.liveRows).toBe(0);
                    expect(mount.view.get_factory()).toBe(null);
                    expect(mount.view.get_model()).toBe(null);
                    // And every row the dialect mounted was handed back — `dispose()`
                    // reaches the sink for the rows GTK never tore down itself.
                    expect(mount.census.released).toBe(mount.census.mounted);
                    // Idempotent: the owner's cleanup and an explicit dispose both
                    // reach it, and `mounted` is about to call it a third time.
                    mount.controller.dispose();
                });
            });

            await it('leaves the MODEL alone on a late setRows, not just the view', async () => {
                await mounted(async (mount) => {
                    await mount.setRows([{ key: 'a', title: 'a' }]);
                    // The model is captured BEFORE dispose, and that is the whole
                    // vector. Asserting an empty VIEW here proves nothing about the
                    // disposed guard: `dispose()` has already run `set_model(null)`, so
                    // a late splice cannot reach the view whether the guard exists or
                    // not — which is why removing `if (this.#disposed) return;` left an
                    // earlier version of this case green. The model outlives that
                    // detachment and is the thing the guard actually protects.
                    const model = mount.view.get_model() as Gtk.SelectionModel;
                    expect(model !== null).toBe(true);
                    mount.controller.dispose();
                    expect(model.get_n_items()).toBe(0);

                    // A late `setRows` is a no-op rather than a throw: an owner's
                    // cleanup order is not this layer's to police, and a rebuilt view
                    // gets a fresh controller. Without the guard this splices a carrier
                    // into a model the owner believes it has finished with.
                    await mount.setRows([{ key: 'b', title: 'b' }]);
                    expect(model.get_n_items()).toBe(0);
                    expect(labels(mount.view)).toStrictEqual([]);
                    expect(mount.census.mounted).toBe(1);
                });
            });
        });

        await gated(diagnostics, 'the scroll edge behind an end-reached callback', async () => {
            await it('fires once per arrival, and not on a list with nothing to scroll', () => {
                // `onScrollNearEnd` moved into this subpath with the controller, and its
                // only test moved the other way: `@gjsify/react-native`'s `onEndReached`
                // vector reaches it through a re-export, so this package could publish a
                // broken scroll edge with its own suite green. Its docstring already
                // claims it is "asserted, in a spec that presents nothing" — this is
                // that spec, in the package that owns the code.
                const scroller = new Gtk.ScrolledWindow();
                const adjustment = scroller.get_vadjustment();
                const seen: number[] = [];
                const stop = onScrollNearEnd(scroller, 'vertical', 0.5, (distance) => seen.push(distance));

                // Nothing to scroll (`upper <= page-size`) is the state every list is in
                // before it has been allocated, and firing there would call the listener
                // on mount for every list in the application.
                expect(seen).toStrictEqual([]);
                adjustment.set_upper(1000);
                adjustment.set_page_size(100);
                adjustment.set_value(100);
                expect(seen).toStrictEqual([]);

                // 1000 - 100 - 880 = 20, inside 0.5 page-lengths of the end.
                adjustment.set_value(880);
                expect(seen).toStrictEqual([20]);
                // ONCE PER ARRIVAL: resting further into the threshold issues no second
                // call, which is what keeps a "load more" caller from paging per frame.
                adjustment.set_value(890);
                expect(seen).toStrictEqual([20]);

                // And the disposer really disconnects — the half nothing watched. GJS
                // blocks a JS callback during GC sweeping, so a handler left on an
                // adjustment outlives the list it belonged to for the life of the
                // process, and the caller has no other way to let go.
                stop();
                adjustment.set_value(100);
                adjustment.set_value(890);
                expect(seen).toStrictEqual([20]);
            });
        });
    });
};
