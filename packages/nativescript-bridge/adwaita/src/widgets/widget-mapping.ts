// `Gtk.Widget`'s `map` / `unmap` signals and `gtk_widget_get_mapped` on a NativeScript view.
//
// A widget is mapped while it is on screen: it is visible and so is every ancestor. Here that is
// a LOADED view (in the visual tree) whose own `visibility` and every ancestor's is `'visible'`;
// `'collapse'` is what `visible = false` writes, and `'hidden'` draws nothing either.
//
// NativeScript already orders the lifecycle as GTK does: `ViewBase.onLoaded` loads the children
// BEFORE it emits `loaded` on itself, `onUnloaded` unloads them before `unloaded`, and a child
// added to a loaded parent is loaded (`_addViewCore`) as one removed is unloaded. So a watched
// view re-checks itself on its own `loaded` / `unloaded`, which arrives deepest first, as `map`
// and `unmap` do (RUN_FIRST, the class handler maps or unmaps the children first).
//
// Visibility has no such event on the view: the `visibility` CSS property notifies
// `visibilityChange` on the view's `Style`, an `Observable`, when that has listeners. A watched,
// loaded view listens on its own style and every ancestor's; a change re-checks every watched view,
// unmaps before maps, deepest first. Connecting a handler emits nothing, as in GTK.
//
// Reference: GTK gtk/gtkwidget.c (gtk_widget_map, gtk_widget_unmap, gtk_widget_real_map,
// gtk_widget_get_mapped); NativeScript ui/core/view-base/index.ts (onLoaded, onUnloaded,
// _addViewCore, _removeView), ui/core/properties/index.ts (CssProperty's change notification)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+. Copyright (c) NativeScript contributors. Apache-2.0.

import type { EventData, Observable } from '@nativescript/core';

/** The slice of a view the watch reads. */
interface MappedView {
    readonly isLoaded?: boolean;
    readonly visibility?: string;
    readonly parent?: MappedView | null;
    readonly style?: Partial<Pick<Observable, 'addEventListener' | 'removeEventListener'>>;
    addEventListener(name: string, listener: (data: EventData) => void): void;
    removeEventListener(name: string, listener: (data: EventData) => void): void;
    notify(data: EventData & Record<string, unknown>): void;
}

interface Watch {
    readonly ref: WeakRef<MappedView>;
    mapped: boolean;
    listeners: number;
    /** The styles this view listens on while it is loaded. */
    styles: Array<NonNullable<MappedView['style']>>;
    readonly onLifecycle: () => void;
}

// Weak both ways, so a view whose handler is never disconnected is still collected.
const WATCHES = new WeakMap<MappedView, Watch>();
const WATCHED = new Set<WeakRef<MappedView>>();

/** `gtk_widget_get_mapped`: loaded, and visible all the way up. */
export function isMapped(view: object): boolean {
    const at = view as MappedView;
    if (at.isLoaded !== true) return false;
    for (let each: MappedView | null | undefined = at; each; each = each.parent) {
        if (each.visibility !== undefined && each.visibility !== 'visible') return false;
    }
    return true;
}

function depthOf(view: MappedView): number {
    let depth = 0;
    for (let at = view.parent; at; at = at.parent) depth++;
    return depth;
}

function emitFor(view: MappedView, watch: Watch): void {
    watch.mapped = !watch.mapped;
    view.notify({ eventName: watch.mapped ? 'map' : 'unmap', object: view as unknown as Observable });
}

function recheckAll(): void {
    const changed: Array<[MappedView, Watch]> = [];
    for (const ref of WATCHED) {
        const view = ref.deref();
        if (view === undefined) {
            WATCHED.delete(ref);
            continue;
        }
        const watch = WATCHES.get(view)!;
        if (isMapped(view) !== watch.mapped) changed.push([view, watch]);
    }
    const deepestFirst = (list: typeof changed) =>
        list.map((entry) => [entry, depthOf(entry[0])] as const).sort((a, b) => b[1] - a[1]);
    const unmapped = deepestFirst(changed.filter(([, watch]) => watch.mapped));
    const mapped = deepestFirst(changed.filter(([, watch]) => !watch.mapped));
    for (const [[view, watch]] of [...unmapped, ...mapped]) emitFor(view, watch);
}

function listenStyles(view: MappedView, watch: Watch): void {
    unlistenStyles(watch);
    if (view.isLoaded !== true) return;
    for (let at: MappedView | null | undefined = view; at; at = at.parent) {
        const style = at.style;
        if (typeof style?.addEventListener !== 'function') continue;
        style.addEventListener('visibilityChange', recheckAll);
        watch.styles.push(style);
    }
}

function unlistenStyles(watch: Watch): void {
    for (const style of watch.styles.splice(0)) style.removeEventListener?.('visibilityChange', recheckAll);
}

/**
 * Watches `view` for `map` / `unmap` until the returned function is called. Its present state is
 * recorded and not emitted.
 */
export function watchMapping(target: object): () => void {
    const view = target as MappedView;
    let watch = WATCHES.get(view);
    if (watch === undefined) {
        const created: Watch = {
            ref: new WeakRef(view),
            mapped: isMapped(view),
            listeners: 0,
            styles: [],
            onLifecycle: () => {
                listenStyles(view, created);
                if (isMapped(view) !== created.mapped) emitFor(view, created);
            },
        };
        watch = created;
        WATCHES.set(view, watch);
        WATCHED.add(watch.ref);
        view.addEventListener('loaded', watch.onLifecycle);
        view.addEventListener('unloaded', watch.onLifecycle);
        listenStyles(view, watch);
    }
    watch.listeners++;
    let watching = true;
    return () => {
        if (!watching) return;
        watching = false;
        const current = WATCHES.get(view);
        if (current === undefined || --current.listeners > 0) return;
        view.removeEventListener('loaded', current.onLifecycle);
        view.removeEventListener('unloaded', current.onLifecycle);
        unlistenStyles(current);
        WATCHED.delete(current.ref);
        WATCHES.delete(view);
    };
}

/** The two signals every widget emits through {@link watchMapping}. */
export const WIDGET_SIGNALS: readonly string[] = ['map', 'unmap'];
