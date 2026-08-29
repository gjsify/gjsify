// The model, the factory and the row bookkeeping behind a `Gtk.ListView` — the half of
// a list that no UI framework can make different.
//
// A `Gtk.ListView` is not an element and cannot be one: it installs no child-adding
// method at all, and the carrier its factory hands back is not a `Gtk.Widget`. Both are
// measured, both are pinned as vectors in `host.spec.ts`, and ADR 0028 § Amendment is
// where the table's answer to them lives — this file does not restate them. What
// follows from them is that every dialect wanting lists needs the same three things: a
// `Gio.ListStore` of carriers, a `Gtk.SignalListItemFactory`, and a key diff deciding
// whether GTK has to hear about a change at all. Until this module existed, React
// Native had all of that and Vue and Solid had none of it.
//
// WHAT IS NOT HERE IS RENDERING. A row's subtree belongs to the dialect and is reached
// through three callbacks (`ListRowSink`): mount, show, dispose. This module imports no
// React, no Solid and no Vue, and must not — that constraint is the whole point, and it
// is what lets the measurements below be stated ONCE for every renderer that binds to
// them. It is CHECKED, by `scripts/check-adapter-import-direction.mjs`, which scans this
// directory for a framework import and fails on one: a constraint whose only enforcement
// is the sentence asserting it is the shape this milestone has already paid for twice.
//
// The toolkit imports below are Gtk, GObject and Gio — three, not the two an earlier
// draft of this paragraph claimed. `Gio` is not incidental: the model IS a
// `Gio.ListStore`, which is the first measurement in this header.
//
// Three of those measurements are the reason this file has the shape it has, all on
// gtk 4.22.4 / gjs 1.88.1.
//
// **The carrier is a one-line `GObject` subclass with a plain JS field.** MEASURED:
// `Gio.ListStore.get_item(0)` hands back the SAME JS wrapper that was appended
// (`back === a`), and the field survived a forced GC while only the store held the
// object. The alternative — a `Gtk.StringList` of indices — works too and costs a parse
// plus an integer that means nothing on its own; this costs one `registerClass`.
//
// **A data change SPLICES the whole model.** MEASURED: `items_changed(0, 1, 1)` over
// the same carrier object produced no rebind at all, while `splice(0, 1, [fresh])`
// produced `setup, bind 0, unbind 0, teardown`. GTK re-binds a row when its model
// object changes, not when the object's contents do — so replacing the carriers is what
// makes a content change visible.
//
// **`dispose()` is the authority on teardown, not GTK's `teardown` signal.** MEASURED:
// destroying a window whose `Gtk.SignalListItemFactory` still had JS handlers connected
// produced six `Gjs-CRITICAL` lines — "Attempting to call back into JSAPI during the
// sweeping phase of GC … the JS callback not invoked. The offending signal was
// unbind/teardown" — and ran none of them. So a per-row handle released only from
// `teardown` would never be released, and every signal a dialect connected inside that
// row would stay connected for the life of the process. Disconnecting the four handlers
// and nulling `factory`/`model` before the widget becomes garbage silenced it
// completely (measured: a forced `imports.system.gc()` afterwards printed nothing).
//
// Values through `gi://`, types through `@girs/*`.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';

/**
 * A row's identity, and the only thing this layer reads off a row.
 *
 * `key` decides whether the model has to be rebuilt at all. Everything else a dialect
 * wants to carry — a render function, a component, a plain record — rides along in the
 * type parameter and is handed straight back to `showRow`.
 */
export interface ListRowKey {
    readonly key: string;
}

/**
 * The carrier a `Gio.ListStore` holds, because a `Gio.ListStore` holds `GObject`s.
 *
 * One property, and it is a plain JS field rather than a `GObject` property: a
 * registered property would need a GType for whatever a dialect puts in a row, and the
 * `get_item` measurement in the header says the JS field is safe — the store keeps the
 * GObject alive and GJS keeps the wrapper with it.
 */
const ListRowCarrier = GObject.registerClass(
    { GTypeName: 'GjsifyGtkHostListRow' },
    class ListRowCarrier extends GObject.Object {
        row: ListRowKey | null = null;
    },
);

type ListRowCarrierInstance = InstanceType<typeof ListRowCarrier>;

/**
 * The dialect's half of a list — three callbacks, one per factory phase that needs one.
 *
 * `Handle` is whatever the dialect needs to keep per ROW WIDGET: a React root, a Solid
 * disposer plus a setter, a Vue app instance. The controller stores it, hands it back,
 * and never looks inside it.
 */
export interface ListRowSink<Row extends ListRowKey, Handle> {
    /**
     * GTK made a row widget's carrier; put something in it and keep what you need.
     *
     * Called from `setup`, ONCE per row widget, and that is not a convenience: `adopt`'s
     * `foreign` snapshot cannot tell the host's own previous child from application
     * chrome, so taking the carrier a SECOND time reads our own row as someone else's
     * and refuses with `occupied-slot`. `host.spec.ts` pins that refusal.
     *
     * TWO routes reach it, and the nearer one is not the obvious one. GTK reusing a
     * carrier across `bind`/`unbind` is the route people expect, and it needs scrolling
     * or recycling to happen at all. The route that fires FIRST is `setRows` over
     * unchanged keys: it shows every live row again through the same handle, with no
     * GTK involvement, so a dialect that adopts per show meets the refusal on its first
     * content change — measured, and it is what `list.spec.ts`'s in-place vector
     * exercises. Adopt here, keep the element in the handle.
     */
    mountRow(item: Gtk.ListItem): Handle;
    /**
     * Show `row` in the widget behind `handle`, or empty it when `row` is `null`.
     *
     * Called from `bind`, from `unbind` with `null`, and again for every live row when
     * `setRows` sees unchanged keys over changed content — which GTK does not re-bind
     * for us (the splice measurement in the header says why).
     */
    showRow(handle: Handle, row: Row | null, index: number): void;
    /** GTK is done with this row widget, or the controller is. Let go of everything. */
    disposeRow(handle: Handle): void;
}

/**
 * WHERE A SINK'S OWN THROW GOES, because there are TWO paths and they differ.
 *
 * `setRows` over unchanged keys calls `showRow` DIRECTLY — no GTK in between — so a
 * throw there propagates out of `setRows` to whoever called it, and a dialect can catch
 * it. Every other call (`setup`, `bind`, `unbind`, `teardown`) runs inside a GObject
 * signal callback, where GJS does not let an exception cross the C frame: it is swallowed
 * and logged as `Gjs-CRITICAL … JS ERROR`, the emission continues, and the controller
 * carries on with a row that never rendered. A diagnostics gate sees that; nothing else
 * does.
 *
 * The asymmetry is not fixable from here — it is GJS's signal boundary — so it is
 * DECLARED instead, and it decides where a sink should put its own error handling. It
 * bites unevenly: React Native's sink only fills a Map on this path and cannot really
 * throw, while Solid's `show()` runs the row's reactive updates synchronously inside
 * `batch()`, so an error in application code lands here.
 *
 * Note what is NOT the answer: `@gjsify/react-native`'s `onRowError` is React's own root
 * error channel, not this seam's. A sink that needs one owns it, because only the
 * dialect knows what a row's error means — a controller-level hook would have to decide
 * whether to keep binding, and neither answer is right for every renderer.
 */

/**
 * A `Gtk.ListView`'s model, factory and per-row handles.
 *
 * Constructed by a dialect with its `ListRowSink`, attached to a view someone else
 * created, disposed from that someone's own cleanup. Nothing here is reactive:
 * `setRows` is called with the current rows and works out whether GTK has to hear
 * about it.
 */
export class ListController<Row extends ListRowKey, Handle> {
    readonly #store = Gio.ListStore.new(ListRowCarrier.$gtype);
    readonly #factory = new Gtk.SignalListItemFactory();
    readonly #handlers: number[] = [];
    /** Every row widget GTK has set up, and what the dialect kept for it. */
    readonly #handles = new Map<Gtk.ListItem, Handle>();
    readonly #sink: ListRowSink<Row, Handle>;
    #view: Gtk.ListView | null = null;
    #keys: readonly string[] = [];
    #disposed = false;

    constructor(sink: ListRowSink<Row, Handle>) {
        this.#sink = sink;
        this.#handlers.push(
            this.#factory.connect('setup', (_factory, item) => this.#setup(item as Gtk.ListItem)),
            this.#factory.connect('bind', (_factory, item) => this.#bind(item as Gtk.ListItem)),
            this.#factory.connect('unbind', (_factory, item) => this.#unbind(item as Gtk.ListItem)),
            this.#factory.connect('teardown', (_factory, item) => this.#teardown(item as Gtk.ListItem)),
        );
    }

    /**
     * Give the view its model and factory.
     *
     * `Gtk.NoSelection` and not the store directly: `Gtk.ListView:model` is a
     * `Gtk.SelectionModel`, and a plain `Gio.ListModel` is not one. `NoSelection` is the
     * wrapper that says "no selection", and it is what this controller installs because
     * a `Gtk.SingleSelection` would give rows a selected state nothing here would ever
     * clear. Selection is a dialect-level feature nobody has asked for yet; adding it
     * means widening `attach`, not reaching around it.
     */
    attach(view: Gtk.ListView): void {
        this.#view = view;
        view.set_factory(this.#factory);
        view.set_model(Gtk.NoSelection.new(this.#store));
    }

    /**
     * The rows GTK should be showing.
     *
     * The model is only touched when the KEYS changed. When they did not, every row's
     * subtree is shown again instead — a row whose key is the same but whose data
     * changed has to repaint, and the splice measurement says GTK will not re-bind it
     * for us. That is strictly cheaper than a splice, which tears down every row.
     */
    setRows(rows: readonly Row[]): void {
        if (this.#disposed) return;
        const keys = rows.map((row) => row.key);
        const sameKeys = keys.length === this.#keys.length && keys.every((key, index) => key === this.#keys[index]);
        this.#keys = keys;
        if (sameKeys) {
            // The CARRIERS are updated in place, and then every live row is shown
            // again. Both halves are needed: `bind` reads the row off the carrier, so
            // leaving the old row there re-renders the old data — which is what the
            // in-place vector caught when only the second half was here.
            for (let index = 0; index < rows.length; index++) {
                const carrier = this.#store.get_item(index) as ListRowCarrierInstance | null;
                if (carrier !== null) carrier.row = rows[index] as Row;
            }
            for (const item of this.#handles.keys()) this.#bind(item);
            return;
        }
        const carriers = rows.map((row) => {
            const carrier = new ListRowCarrier();
            carrier.row = row;
            return carrier;
        });
        // ONE splice, not a per-row diff. `Gio.ListStore.splice` takes the whole
        // replacement and emits one `items-changed`; a per-row diff would emit one per
        // row, and each emission is a bind/unbind round trip through the dialect.
        this.#store.splice(0, this.#store.get_n_items(), carriers);
    }

    /** How many rows GTK is currently holding a widget for. A spec seam and a leak detector. */
    get liveRows(): number {
        return this.#handles.size;
    }

    /**
     * Release every row, disconnect every handler, and let go of the view.
     *
     * Called from the owner's cleanup, which runs while JS callbacks still work —
     * unlike GTK's own `teardown`, which fires during GC sweeping when the view is
     * collected and is BLOCKED there (measured, see the header). Idempotent, because an
     * owner's cleanup and an explicit dispose both reach it.
     */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        // The GTK half FIRST, and disconnecting first inside it. That is the half the
        // header's six criticals are about — it has to happen before the widgets
        // become garbage — and doing it before `set_model(null)` also means GTK cannot
        // re-enter the sink through `teardown` while the controller is dismantling
        // itself, so the release loop below sees exactly the handles that were live
        // rather than a set something else is emptying underneath it.
        for (const handler of this.#handlers) this.#factory.disconnect(handler);
        this.#handlers.length = 0;
        if (this.#view !== null) {
            this.#view.set_factory(null);
            this.#view.set_model(null);
            this.#view = null;
        }
        this.#store.remove_all();
        const handles = [...this.#handles.values()];
        this.#handles.clear();
        for (const handle of handles) this.#sink.disposeRow(handle);
    }

    #setup(item: Gtk.ListItem): void {
        this.#handles.set(item, this.#sink.mountRow(item));
    }

    #bind(item: Gtk.ListItem): void {
        const handle = this.#handles.get(item);
        if (handle === undefined) return;
        const carrier = item.get_item() as ListRowCarrierInstance | null;
        this.#sink.showRow(handle, (carrier?.row ?? null) as Row | null, item.get_position());
    }

    #unbind(item: Gtk.ListItem): void {
        const handle = this.#handles.get(item);
        if (handle === undefined) return;
        // `null` rather than reading the carrier back, and MEASURED rather than
        // assumed (gtk 4.22.4 / gjs 1.88.1): at `unbind` the item still answers
        // `get_item()` with its carrier and `get_position()` with the REAL position —
        // it is `setup` and `teardown` that see GTK's invalid-position sentinel
        // (4294967295), and `teardown` that sees a null item. So reading the carrier
        // here would show the row being taken away, while the position is honest and
        // goes along, which is what a dialect animating a departure needs.
        this.#sink.showRow(handle, null, item.get_position());
    }

    #teardown(item: Gtk.ListItem): void {
        const handle = this.#handles.get(item);
        if (handle === undefined) return;
        this.#handles.delete(item);
        this.#sink.disposeRow(handle);
    }
}
