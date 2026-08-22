// SolidJS on GTK4 — the whole adapter.
//
// This file is the thesis of ADR 0027 made checkable: Solid publishes a
// ten-method renderer contract, every one of them is a host op, and the adapter
// is the mapping and nothing else. It carries no widget name, no insertion rule
// and no GTK knowledge — that all lives in the descriptor table, where the Vue
// and React adapters will read it too.
//
// The one shape worth pointing at: `createElement(tag)` receives **no props**.
// Solid sets every property afterwards, including construct-only ones, which is
// exactly why the host defers materialisation until a widget is actually needed
// (ADR 0027 § Decision 5). An adapter cannot paper that over; the host has to.

import { For as SolidFor, Index as SolidIndex, Show as SolidShow } from 'solid-js';
import { createRenderer } from 'solid-js/universal';
import type Gtk from '@girs/gtk-4.0';

import {
    adopt,
    createElement as hostCreateElement,
    createText,
    destroy,
    firstChild,
    insert as hostInsert,
    isText,
    materialize,
    nextSibling,
    parentNode,
    remove,
    setProp,
    setText,
} from '../host.js';
import type { HostElement, HostNode, HostText } from '../types.js';

const renderer = createRenderer<HostNode>({
    createElement: (tag: string) => hostCreateElement(tag),

    createTextNode: (value: string) => createText(value),

    replaceText: (node: HostNode, value: string) => {
        setText(node as HostText, value);
    },

    isTextNode: (node: HostNode) => isText(node),

    setProperty: (node: HostNode, name: string, value: unknown, prev?: unknown) => {
        setProp(node as HostElement, name, value, prev);
    },

    insertNode: (parent: HostNode, node: HostNode, anchor?: HostNode) => {
        hostInsert(node, parent as HostElement, anchor ?? null);
    },

    // A DETACH, never a teardown — measured, and the measurement decided it.
    // `<For>` moves the same nodes across a reorder (3 of 3 widget objects reused,
    // `solid.spec.ts`), so destroying here would recreate every row on every
    // reorder and take focus, scroll position and widget state with it. Handler
    // disconnection therefore cannot live here; it lives in `mount`'s disposer.
    //
    // The parent argument is ignored on purpose: the host knows where a node is,
    // and trusting the caller's idea of it is how a move removes from the wrong
    // container.
    removeNode: (_parent: HostNode, node: HostNode) => {
        remove(node);
    },

    getParentNode: (node: HostNode) => parentNode(node) ?? undefined,

    getFirstChild: (node: HostNode) => (node.kind === 'element' ? (firstChild(node) ?? undefined) : undefined),

    getNextSibling: (node: HostNode) => nextSibling(node) ?? undefined,
});

export const {
    render,
    effect,
    memo,
    createComponent,
    createElement,
    createTextNode,
    insertNode,
    insert,
    spread,
    setProp: setSolidProp,
    mergeProps,
    use,
} = renderer;

/**
 * Render a Solid component into a widget the application owns.
 *
 * `render` wants a host node as its container; an application has a `Gtk.Widget`.
 * `adopt` bridges that through the same descriptor table every other parent uses,
 * so a `GObject.registerClass` subclass of a known container works unchanged.
 *
 * Returns Solid's disposer. Calling it unmounts the tree — and because the host's
 * `destroy` is eager (GJS blocks JS callbacks during GC), that is also what
 * disconnects the signal handlers.
 */
export function mount(code: () => HostNode, container: Gtk.Widget): () => void {
    const root = adopt(container);
    const dispose = render(code, root);
    return () => {
        dispose();
        // `solid-js/universal`'s own `render` returns the disposer and NOTHING
        // else — read from the installed source:
        //
        //   render(code, element) { let disposer;
        //     createRoot(dispose => { disposer = dispose; insert(element, code()); });
        //     return disposer; }
        //
        // The DOM renderer additionally clears the container (`element.textContent
        // = ""`); the universal one has no equivalent, so disposing tears down the
        // reactive scopes and leaves the widgets mounted. Measured: a button kept
        // firing after its root was disposed. Tearing the subtree down is the
        // adapter's job, and it must be `destroy` rather than `remove` because GJS
        // blocks JS callbacks during GC — an undisconnected handler outlives the
        // tree it belonged to.
        for (const node of childSnapshot(root)) destroy(node);
    };
}

/** The children of a node, snapshotted — `destroy` unlinks as it goes. */
function childSnapshot(el: HostElement): HostNode[] {
    const out: HostNode[] = [];
    for (let n = firstChild(el); n; n = nextSibling(n)) out.push(n);
    return out;
}

// --- control flow, re-typed for host nodes ------------------------------------
//
// Solid's control-flow components are typed against `JSX.Element`, which its own
// JSX namespace pins to the DOM's `Element`. The RUNTIME is renderer-agnostic —
// `For` reconciles whatever its children return — but the types are not, so an
// app using a universal renderer gets "Type 'HostElement' is not assignable to
// type 'Element'" on the first `<For>`. Re-typing them here is the adapter's job:
// one place, no `as any` in application code, and no global JSX augmentation that
// would fight a second renderer in the same process.

/** `<For each={items}>` — keyed by item identity, so a reorder MOVES nodes. */
export const For = SolidFor as unknown as <T>(props: {
    each: readonly T[] | undefined | null | false;
    fallback?: HostNode;
    children: (item: T, index: () => number) => HostNode;
}) => HostNode;

/** `<Index each={items}>` — keyed by position; the item is an accessor. */
export const Index = SolidIndex as unknown as <T>(props: {
    each: readonly T[] | undefined | null | false;
    fallback?: HostNode;
    children: (item: () => T, index: number) => HostNode;
}) => HostNode;

/** `<Show when={cond}>` — a conditional branch. */
export const Show = SolidShow as unknown as <T>(props: {
    when: T | undefined | null | false;
    fallback?: HostNode;
    children: HostNode | ((item: T) => HostNode);
}) => HostNode;

/** The materialised widget of a host node — for a test, or a `ref`. */
export function widgetOf(node: HostNode): Gtk.Widget {
    if (node.kind !== 'element') throw new Error('only an element node has a widget');
    return materialize(node) as unknown as Gtk.Widget;
}
