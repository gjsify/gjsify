// The `Gtk.ListView` a list component OWNS, driven imperatively from `data`.
//
// WHY THIS IS NOT AN ELEMENT, and the whole design follows from three measurements on
// gtk 4.22.4 / gjs 1.88.1:
//
// 1. **A `Gtk.ListView` takes no children.** It installs no `append`, no `add`, no
//    `insert`, no `prepend`, no `remove` and no `set_child` — measured, against its
//    prototype. What it has is `set_model` and `set_factory`. The host's placement
//    policies are DATA naming a method for the host to call, so for this widget there
//    is no method to name; the generated table therefore lists it `uncurated` and an
//    attempted child insertion is refused by name. That refusal is correct, and it is
//    the end of the road for "the list is an element whose children are the rows".
//
// 2. **A `Gtk.ListItem` is not a `Gtk.Widget`.** `GObject.type_is_a(Gtk.ListItem,
//    Gtk.Widget)` is FALSE (measured); it is a GObject with a writable `child`. So a
//    React root cannot be created over a list item — it is created over the widget the
//    factory puts INTO the item, which is what `setup` does here.
//
// 3. **Rows bind the moment the view is ROOTED IN A WINDOW.** With a 3-row model and
//    all four factory signals connected: a bare view produced nothing, a view inside a
//    `Gtk.ScrolledWindow` produced nothing, `measure()` produced nothing,
//    `allocate(400, 400)` produced nothing and 50 main-loop iterations produced
//    nothing — and putting the scroller into a `Gtk.Window` produced
//    `setup, bind 0, setup, bind 1, setup, bind 2` immediately, with no `present()`,
//    no map and no main loop. PRECONDITION: a `Gtk.Window` that is constructed and
//    never presented; that is also what `lists.spec.ts` uses, and it is why the item
//    factory is testable at all.
//
// FOUR CONSEQUENCES, each of which is a line of code below.
//
// **The row's React tree is rendered on a MICROTASK, never inline.** Measurement 3
// says GTK binds rows from inside whatever call rooted or spliced the view — and in
// React that call is a commit or an effect. `@gjsify/gtk-host/react`'s `render()`
// refuses a re-entrant flush BY NAME ("React is already rendering or committing"),
// which is the right refusal and would fire on every row. Deferring is uniform, needs
// no `catch`, and costs nothing visible: GJS drains the microtask queue when the JS
// stack empties, which is before GTK's next frame, so a row is never PAINTED empty.
//
// **`dispose()` is the authority on teardown, not GTK's `teardown` signal.** MEASURED:
// destroying a window whose `Gtk.SignalListItemFactory` still had JS handlers
// connected produced six `Gjs-CRITICAL` lines — "Attempting to call back into JSAPI
// during the sweeping phase of GC … the JS callback not invoked. The offending signal
// was unbind/teardown" — and ran none of them. So a per-item React root unmounted only
// from `teardown` would never be unmounted, and every signal the host connected inside
// that row would stay connected for the life of the process. Disconnecting the four
// handlers and nulling `factory`/`model` before the widget becomes garbage silenced it
// completely (measured: a forced `imports.system.gc()` afterwards printed nothing).
//
// **A data change SPLICES the whole model.** MEASURED: `items_changed(0, 1, 1)` over
// the same carrier object produced no rebind at all, while `splice(0, 1, [fresh])`
// produced `setup, bind 0, unbind 0, teardown`. GTK re-binds a row when its model
// object changes, not when the object's contents do — so replacing the carriers is
// what makes a content change visible.
//
// **The carrier is a one-line `GObject` subclass with a plain JS field.** MEASURED:
// `Gio.ListStore.get_item(0)` hands back the SAME JS wrapper that was appended
// (`back === a`), and the field survived a forced GC while only the store held the
// object. The alternative — a `Gtk.StringList` of indices — works too and costs a
// parse plus an integer that means nothing on its own; this costs one
// `registerClass`.
//
// Values through `gi://`, types through `@girs/*`.

import Gio from 'gi://Gio';
import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import { createRoot, type ReactRoot } from '@gjsify/gtk-host/react';
import { createElement, type ReactNode } from 'react';

import { ParentProvider } from '../parent-context.js';
import type { ChildContext } from '../primitives/resolve.js';

/** One row: an identity, and the React tree it renders to. */
export interface ListRow {
    /** `keyExtractor`'s answer. It decides whether the model has to be rebuilt at all. */
    readonly key: string;
    /** Called on every bind, so it always reads the latest `data`. */
    render(): ReactNode;
}

/**
 * The carrier a `Gio.ListStore` holds, because a `Gio.ListStore` holds `GObject`s.
 *
 * One property and it is a plain JS field rather than a `GObject` property: a
 * registered property would need a GType for a JS closure, and the measurement above
 * says the JS field is safe — the store keeps the GObject alive and GJS keeps the
 * wrapper with it.
 */
const ListRowCarrier = GObject.registerClass(
    { GTypeName: 'GjsifyReactNativeListRow' },
    class ListRowCarrier extends GObject.Object {
        row: ListRow | null = null;
    },
);

/**
 * What a row's own React tree resolves its layout against.
 *
 * A row is the root of a fresh React root, so without this a `flex-1` inside
 * `renderItem` would be refused by name ("this element is the root of its tree") —
 * correct for a real root and wrong here, because the row DOES have a parent: the
 * vertical box the factory puts in the list item. Publishing it is the same carrier
 * job `components.ts` does for every other parent.
 */
const ROW_CONTEXT: ChildContext = { orientation: 'vertical', props: {}, overlay: false };

/**
 * A row's tree, rendered by REACT rather than built by the bind handler.
 *
 * The bind handler could call `row.render()` itself and queue the element — that was the
 * first version, and it put `renderItem` (application code) on the wrong side of
 * React's boundary in two ways. A `useState` inside a `renderItem` would have run
 * outside any component, and a `renderItem` that THREW did so from inside a React
 * effect, where it escaped as a bare "JS ERROR" attributed to `setRows` instead of
 * reaching the row root's own error channel. One component fixes both: `renderItem`
 * runs during a render, with a fiber under it.
 */
const RowBody = ({ row }: { readonly row: ListRow }): ReactNode => row.render();

/**
 * A `Gtk.ListView`'s model, factory and per-row React roots.
 *
 * Constructed by a component, attached to a view the host created, disposed from the
 * component's own cleanup. Nothing here is reactive: `setRows` is called with the
 * current rows and works out whether GTK has to hear about it.
 */
export interface ListControllerOptions {
    /**
     * Where a row's own render error goes.
     *
     * Absent means the host adapter's default: log it AND rethrow it from the
     * `render()` call — which here is inside the microtask drain, so the rethrow leaves
     * JS as an uncaught exception. That is loud and correct in an application; a caller
     * with its own error surface (or a spec asserting a named refusal) passes a recorder
     * instead, which is exactly what the adapter documents the option for.
     */
    readonly onRowError?: (error: Error) => void;
}

export class ListController {
    readonly #store = Gio.ListStore.new(ListRowCarrier.$gtype);
    readonly #factory = new Gtk.SignalListItemFactory();
    readonly #handlers: number[] = [];
    readonly #roots = new Map<Gtk.ListItem, ReactRoot>();
    /** item → the tree it should hold, drained on a microtask. `null` means "unbound". */
    readonly #pending = new Map<Gtk.ListItem, ReactNode>();
    /** Roots whose row is gone, waiting for the same drain to unmount them. */
    readonly #dead: ReactRoot[] = [];
    #drainQueued = false;
    #view: Gtk.ListView | null = null;
    #keys: readonly string[] = [];
    #disposed = false;
    readonly #options: ListControllerOptions;

    constructor(options: ListControllerOptions = {}) {
        this.#options = options;
        this.#handlers.push(
            this.#factory.connect('setup', (_factory, item) => this.#setup(item as Gtk.ListItem)),
            this.#factory.connect('bind', (_factory, item) => this.#bind(item as Gtk.ListItem)),
            this.#factory.connect('unbind', (_factory, item) => this.#queue(item as Gtk.ListItem, null)),
            this.#factory.connect('teardown', (_factory, item) => this.#teardown(item as Gtk.ListItem)),
        );
    }

    /**
     * Give the view its model and factory.
     *
     * `Gtk.NoSelection` and not the store directly: `Gtk.ListView:model` is a
     * `Gtk.SelectionModel`, and a plain `Gio.ListModel` is not one. `NoSelection` is
     * the wrapper that says "no selection" — React Native's lists have no selection
     * concept, and `Gtk.SingleSelection` would give rows a selected state nothing
     * would ever clear.
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
     * tree is re-rendered instead — a row whose key is the same but whose data changed
     * has to repaint, and measurement 4 says GTK will not re-bind it for us. That is
     * strictly cheaper than a splice, which tears down every row's React root.
     */
    setRows(rows: readonly ListRow[]): void {
        if (this.#disposed) return;
        const keys = rows.map((row) => row.key);
        const sameKeys = keys.length === this.#keys.length && keys.every((key, index) => key === this.#keys[index]);
        this.#keys = keys;
        if (sameKeys) {
            // The CARRIERS are updated in place, and then every live row is re-bound.
            // Both halves are needed: `bind` reads the row off the carrier, so leaving
            // the old row there re-renders the old data — which is what the in-place
            // vector caught when only the second half was here.
            for (let index = 0; index < rows.length; index++) {
                const carrier = this.#store.get_item(index) as InstanceType<typeof ListRowCarrier> | null;
                if (carrier !== null) carrier.row = rows[index] as ListRow;
            }
            for (const item of this.#roots.keys()) this.#bind(item);
            return;
        }
        const carriers = rows.map((row) => {
            const carrier = new ListRowCarrier();
            carrier.row = row;
            return carrier;
        });
        // ONE splice, not a per-row diff. `Gio.ListStore.splice` takes the whole
        // replacement and emits one `items-changed`; a per-row diff would emit one per
        // row, and each emission is a bind/unbind round trip through React.
        this.#store.splice(0, this.#store.get_n_items(), carriers);
    }

    /** How many rows GTK is currently holding a widget for. A spec seam and a leak detector. */
    get liveRows(): number {
        return this.#roots.size;
    }

    /**
     * Unmount every row, disconnect every handler, and let go of the view.
     *
     * Called from the component's cleanup, which runs while JS callbacks still work —
     * unlike GTK's own `teardown`, which fires during GC sweeping when the view is
     * collected and is BLOCKED there (measured, see the header). Idempotent, because a
     * component's cleanup and an explicit dispose both reach it.
     */
    dispose(): void {
        if (this.#disposed) return;
        this.#disposed = true;
        this.#pending.clear();
        // The GTK half happens NOW — disconnecting the factory's handlers and letting
        // go of the model is what keeps GC from reaching for a JS callback it will
        // block. The REACT half is queued, for the same reason every other React call
        // in this file is: `dispose()` runs from a component's cleanup, which is inside
        // React's own commit, and `root.unmount()` is a render.
        for (const root of this.#roots.values()) this.#dead.push(root);
        this.#roots.clear();
        for (const handler of this.#handlers) this.#factory.disconnect(handler);
        this.#handlers.length = 0;
        if (this.#view !== null) {
            this.#view.set_factory(null);
            this.#view.set_model(null);
            this.#view = null;
        }
        this.#store.remove_all();
        this.#schedule();
    }

    #setup(item: Gtk.ListItem): void {
        // A vertical `Gtk.Box`, so a row behaves like the `<View>` a `renderItem`
        // usually returns one of — and so `ROW_CONTEXT` is telling the truth about the
        // axis a row's `flex-1` expands along.
        const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
        item.set_child(container);
        const onRowError = this.#options.onRowError;
        this.#roots.set(item, createRoot(container, onRowError === undefined ? {} : { onUncaughtError: onRowError }));
    }

    #bind(item: Gtk.ListItem): void {
        const carrier = item.get_item() as InstanceType<typeof ListRowCarrier> | null;
        const row = carrier?.row ?? null;
        this.#queue(
            item,
            row === null
                ? null
                : createElement(ParentProvider, { value: ROW_CONTEXT }, createElement(RowBody, { row })),
        );
    }

    #teardown(item: Gtk.ListItem): void {
        this.#pending.delete(item);
        const root = this.#roots.get(item);
        if (root === undefined) return;
        this.#roots.delete(item);
        // QUEUED, not unmounted here — and this is the one that was measured the hard
        // way. GTK tears a row down from inside `Gio.ListStore.splice`, which this layer
        // calls from a React effect, and `root.unmount()` is a render: the host refused
        // it by name ("render() could not flush, because React is already rendering or
        // committing") the first time a vector changed a list's keys.
        this.#dead.push(root);
        this.#schedule();
    }

    /** Remember what a row should hold; render it once the JS stack has unwound. */
    #queue(item: Gtk.ListItem, tree: ReactNode): void {
        if (this.#disposed) return;
        this.#pending.set(item, tree);
        this.#schedule();
    }

    /**
     * Do every React call this turn produced, once, after the stack unwinds.
     *
     * ONE drain for binds, unbinds and teardowns together, because they are one
     * question — "what should each row hold now" — and a row that was bound and then
     * unbound within the same turn must not render twice. Binds first, then the dead
     * roots: a splice replaces a row before it removes the old one (measured: `setup,
     * bind 0, unbind 0, teardown`), and unmounting first would drop a root the new bind
     * had already been queued against.
     */
    #schedule(): void {
        if (this.#drainQueued) return;
        this.#drainQueued = true;
        queueMicrotask(() => {
            this.#drainQueued = false;
            const pending = [...this.#pending];
            this.#pending.clear();
            for (const [target, tree] of pending) {
                // The root may have been torn down between the bind and this drain — a
                // scroll that binds and unbinds a row within one turn is ordinary.
                this.#roots.get(target)?.render(tree);
            }
            const dead = this.#dead.splice(0, this.#dead.length);
            for (const root of dead) root.unmount();
        });
    }
}

/**
 * `keyExtractor`, with React Native's own default.
 *
 * `item.key`, then `item.id`, then the index — the order React Native uses, and the
 * index last because a key that is the position makes every row after an insertion
 * change identity, which here means every row after it is re-bound.
 */
export function rowKey(item: unknown, index: number, keyExtractor?: (item: unknown, index: number) => string): string {
    if (keyExtractor !== undefined) return keyExtractor(item, index);
    if (item !== null && typeof item === 'object') {
        const record = item as Record<string, unknown>;
        if (typeof record.key === 'string') return record.key;
        if (typeof record.id === 'string' || typeof record.id === 'number') return String(record.id);
    }
    return String(index);
}

/**
 * Call `listener` when the scroller gets within `threshold` page-lengths of the end.
 *
 * `Gtk.Adjustment`, because that is where GTK keeps a scroll position: the scrolled
 * window has no scroll signal of its own, and `notify::value` on the adjustment behind
 * `hadjustment`/`vadjustment` is what `ScrollView`'s own `onScroll` refusal points at.
 * MEASURED: a `Gtk.ScrolledWindow` hands out its adjustments with no window anywhere,
 * and `set_value` on one raised `notify::value` — so this is drivable, and asserted, in
 * a spec that presents nothing.
 *
 * `upper` and `page-size` are subscribed too, and not for completeness: `upper` grows
 * when rows are added, which is the event that ARMS the next call — React Native fires
 * `onEndReached` once per arrival at the end, and a list that grew has a new end.
 *
 * A list with nothing to scroll (`upper <= page-size`) never fires. That is the state
 * every list is in before it has been allocated, and firing there would call
 * `onEndReached` on mount for every list in the application.
 */
export function onScrollNearEnd(
    scroller: Gtk.ScrolledWindow,
    axis: 'horizontal' | 'vertical',
    threshold: number,
    listener: (distanceFromEnd: number) => void,
): () => void {
    const adjustment = axis === 'horizontal' ? scroller.get_hadjustment() : scroller.get_vadjustment();
    let armed = true;
    const check = (): void => {
        const page = adjustment.get_page_size();
        const upper = adjustment.get_upper();
        if (upper <= page) {
            armed = true;
            return;
        }
        const distance = upper - page - adjustment.get_value();
        if (distance > threshold * page) {
            armed = true;
            return;
        }
        if (!armed) return;
        armed = false;
        listener(distance);
    };
    const handlers = [
        adjustment.connect('notify::value', check),
        adjustment.connect('notify::upper', check),
        adjustment.connect('notify::page-size', check),
    ];
    check();
    return () => {
        for (const handler of handlers) adjustment.disconnect(handler);
    };
}
