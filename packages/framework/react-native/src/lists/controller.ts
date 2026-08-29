// React's half of a `Gtk.ListView` — a root per row, and the scroll edge behind
// `onEndReached`.
//
// The model, the factory, the key diff and the teardown authority are NOT here: they
// are GTK and GObject facts with no framework in them, and they live once, in
// `@gjsify/gtk-host/list`, where Vue and Solid reach the same measurements. What is
// left here is the part only React can supply — the three callbacks
// `ListController` asks a dialect for, and what a row's tree is made of.
//
// **The row's React tree is rendered on a MICROTASK, never inline.** GTK binds rows
// from inside whatever call rooted or spliced the view — and in React that call is a
// commit or an effect. `@gjsify/gtk-host/react`'s `render()` refuses a re-entrant flush
// BY NAME ("React is already rendering or committing"), which is the right refusal and
// would fire on every row. Deferring is uniform, needs no `catch`, and costs nothing
// visible: GJS drains the microtask queue when the JS stack empties, which is before
// GTK's next frame, so a row is never PAINTED empty.
//
// Nothing here imports the toolkit as a VALUE any more. A row's container is created
// and placed through the host, which is what curating GTK4's list carriers bought
// (ADR 0028 § Amendment) — the `Gtk` below is a type and nothing else.

import { adopt, createElement as hostCreateElement, insert as hostInsert, widgetOf } from '@gjsify/gtk-host';
import { ListController, onScrollNearEnd, type ListRowSink } from '@gjsify/gtk-host/list';
import { createRoot, type ReactRoot } from '@gjsify/gtk-host/react';
import type Gtk from '@girs/gtk-4.0';
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

/** The controller a list component owns: the shared core, wearing React's row sink. */
export type ReactListController = ListController<ListRow, ReactRoot>;

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

/** What a list component may tell its controller, beyond the rows themselves. */
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

/**
 * React's `ListRowSink`: a root per row widget, every React call deferred to one drain.
 *
 * The state is per SINK rather than per row because the drain is: binds, unbinds and
 * teardowns are one question — "what should each row hold now" — and a row that was
 * bound and then unbound within the same turn must not render twice.
 */
function reactRows(options: ListControllerOptions): ListRowSink<ListRow, ReactRoot> {
    /** root → the tree it should hold, drained on a microtask. `null` means "unbound". */
    const pending = new Map<ReactRoot, ReactNode>();
    /** Roots whose row is gone, waiting for the same drain to unmount them. */
    const dead: ReactRoot[] = [];
    let drainQueued = false;

    /** Do every React call this turn produced, once, after the stack unwinds. */
    const schedule = (): void => {
        if (drainQueued) return;
        drainQueued = true;
        queueMicrotask(() => {
            drainQueued = false;
            const queued = [...pending];
            pending.clear();
            for (const [root, tree] of queued) root.render(tree);
            // Renders first, unmounts second: a splice replaces a row before it removes
            // the old one (measured: `setup, bind 0, unbind 0, teardown`), so this
            // order is the one where the replacement exists before its predecessor is
            // torn down. A root that died between its bind and this drain never gets
            // here at all — `disposeRow` takes it out of `pending`.
            const gone = dead.splice(0, dead.length);
            for (const root of gone) root.unmount();
        });
    };

    return {
        mountRow(item: Gtk.ListItem): ReactRoot {
            // A vertical `Gtk.Box`, so a row behaves like the `<View>` a `renderItem`
            // usually returns one of — and so `ROW_CONTEXT` is telling the truth about
            // the axis a row's `flex-1` expands along.
            //
            // The carrier is taken ONCE, here, and this is the phase for it: `adopt`
            // snapshots what a container already held and cannot tell our own previous
            // child from application chrome, so taking it a second time refuses with
            // `occupied-slot` (pinned in the host's own `host.spec.ts`). GTK recycling
            // a carrier is the route people expect; the one that fires first is
            // `setRows` over unchanged keys, which re-shows a live row with no GTK
            // involvement at all.
            const container = hostCreateElement('GtkBox', { orientation: 'vertical' });
            hostInsert(container, adopt(item));
            const onRowError = options.onRowError;
            return createRoot(widgetOf(container), onRowError === undefined ? {} : { onUncaughtError: onRowError });
        },

        showRow(root: ReactRoot, row: ListRow | null): void {
            pending.set(
                root,
                row === null
                    ? null
                    : createElement(ParentProvider, { value: ROW_CONTEXT }, createElement(RowBody, { row })),
            );
            schedule();
        },

        disposeRow(root: ReactRoot): void {
            pending.delete(root);
            // QUEUED, not unmounted here — and this is the one that was measured the
            // hard way. GTK tears a row down from inside `Gio.ListStore.splice`, which
            // the core calls from a React effect, and `root.unmount()` is a render: the
            // host refused it by name ("render() could not flush, because React is
            // already rendering or committing") the first time a vector changed a
            // list's keys. `ListController.dispose()` reaches this too, from a
            // component's cleanup, which is inside React's own commit.
            dead.push(root);
            schedule();
        },
    };
}

/** The list controller a React component owns. */
export function createListController(options: ListControllerOptions = {}): ReactListController {
    return new ListController(reactRows(options));
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
 * The scroll edge behind `onEndReached`, re-exported rather than reimplemented.
 *
 * It lived here, and it was never React's: `Gtk.Adjustment` arithmetic with no React in
 * it and no toolkit value import. `@gjsify/gtk-host/list` owns it now, so a Vue or Solid
 * list gets the same measured behaviour instead of re-deriving it — which is the failure
 * this whole extraction exists to prevent. `components.ts` imports it from here, so the
 * move costs no consumer a rewrite.
 */
export { onScrollNearEnd };
