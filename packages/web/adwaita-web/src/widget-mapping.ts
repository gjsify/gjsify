// `Gtk.Widget`'s `map` / `unmap` signals and `gtk_widget_get_mapped` on an element.
//
// A widget is mapped while it is on screen: it is visible and so is every ancestor. Here that is
// an element in the document that renders (`isConnected && checkVisibility()`), which covers a
// `hidden` ancestor, a closed `<dialog>`, an inactive stack page and a popover that is not open.
// `map` fires on the transition into that state and `unmap` on the way out, never on connect.
//
// The DOM has no event for either transition, so an element is only WATCHED while something
// listens to one of the two: one `MutationObserver` on the document (children and attributes,
// the whole subtree) and a capturing `toggle` listener (a popover opening changes no attribute)
// re-check every watched element after each batch. A batch is delivered after the change, not
// inside it as `gtk_widget_show` delivers it; a hide undone within the same turn emits nothing.
//
// Order is GTK's post-order (`map` and `unmap` are RUN_FIRST, and the class handler maps or
// unmaps the children first): the deepest element of a batch emits first, unmaps before maps.
//
// Reference: GTK gtk/gtkwidget.c (gtk_widget_map, gtk_widget_unmap, gtk_widget_real_map,
// gtk_widget_real_unmap, gtk_widget_get_mapped)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/** Watched elements and the state each last emitted for. */
const STATE = new WeakMap<HTMLElement, { mapped: boolean; listeners: number }>();
const WATCHED = new Set<WeakRef<HTMLElement>>();
const REFS = new WeakMap<HTMLElement, WeakRef<HTMLElement>>();
let observer: MutationObserver | null = null;

/** `gtk_widget_get_mapped`: in the document, and rendered. */
export function isMapped(el: Element): boolean {
    return el.isConnected && el.checkVisibility();
}

function depthOf(el: Element): number {
    let depth = 0;
    for (let at = el.parentElement; at !== null; at = at.parentElement) depth++;
    return depth;
}

function recheck(): void {
    const changed: HTMLElement[] = [];
    for (const ref of WATCHED) {
        const el = ref.deref();
        if (el === undefined) {
            WATCHED.delete(ref);
            continue;
        }
        const state = STATE.get(el)!;
        if (isMapped(el) !== state.mapped) changed.push(el);
    }
    if (changed.length === 0) return;
    const deepestFirst = (list: HTMLElement[]) =>
        list.map((el) => [el, depthOf(el)] as const).sort((a, b) => b[1] - a[1]);
    const unmapped = deepestFirst(changed.filter((el) => STATE.get(el)!.mapped));
    const mapped = deepestFirst(changed.filter((el) => !STATE.get(el)!.mapped));
    for (const [el] of [...unmapped, ...mapped]) {
        const state = STATE.get(el)!;
        state.mapped = !state.mapped;
        el.dispatchEvent(new CustomEvent(state.mapped ? 'map' : 'unmap'));
    }
}

function observe(): void {
    if (observer !== null) return;
    observer = new MutationObserver(recheck);
    observer.observe(document, { childList: true, subtree: true, attributes: true });
    document.addEventListener('toggle', recheck, true);
}

function unobserve(): void {
    if (observer === null || WATCHED.size > 0) return;
    observer.disconnect();
    observer = null;
    document.removeEventListener('toggle', recheck, true);
}

/**
 * Watches `el` for `map` / `unmap` while the returned function has not been called. Its present
 * state is recorded and not emitted, as connecting a handler in GTK emits nothing.
 */
export function watchMapping(el: HTMLElement): () => void {
    let state = STATE.get(el);
    if (state === undefined || state.listeners === 0) {
        state = { mapped: isMapped(el), listeners: 0 };
        STATE.set(el, state);
        const ref = new WeakRef(el);
        REFS.set(el, ref);
        WATCHED.add(ref);
        observe();
    }
    state.listeners++;
    let watching = true;
    return () => {
        if (!watching) return;
        watching = false;
        const current = STATE.get(el)!;
        if (--current.listeners > 0) return;
        WATCHED.delete(REFS.get(el)!);
        REFS.delete(el);
        unobserve();
    };
}
