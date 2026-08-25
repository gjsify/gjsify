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

import { For as SolidFor, Index as SolidIndex, Show as SolidShow, onCleanup, splitProps, untrack } from 'solid-js';
import { createRenderer } from 'solid-js/universal';
import type Gtk from '@girs/gtk-4.0';

import {
    adopt,
    createElement as hostCreateElement,
    createText,
    describeValue,
    destroyChildren,
    disconnectHandlers,
    firstChild,
    insert as hostInsert,
    isText,
    nextSibling,
    parentNode,
    remove,
    setProp as setHostProp,
    setText,
    widgetOf,
} from '../host.js';
import type { HostElement, HostNode, HostText } from '../types.js';

const HOST_KINDS = new Set(['element', 'text', 'anchor']);

/**
 * Refuse a value that only LOOKS like a node.
 *
 * `insertExpression`'s last branch is `insertNode(parent, value)` for any object
 * that is not an array — it has no idea what a node of this renderer is — and the
 * host then wrote `parent`/`prev`/`next` onto it and returned without doing
 * anything, because the kind was neither `element` nor `text`: a phantom in the
 * shadow tree that never reaches GTK.
 *
 * Measured with `<Dynamic component="GtkLabel">` imported from `solid-js/web`:
 * container `["GtkBox"]`, the box's children just the static sibling, no throw,
 * no GTK diagnostic, exit 0. `solid-js/web` is the DOM renderer — its `Dynamic`
 * builds the element with `document.createElement` and spreads onto it with the
 * DOM's own `spread`, so none of it comes through this renderer's ops. That is
 * why the refusal names the universal replacements rather than a spelling.
 */
function assertHostNode(node: HostNode): void {
    const kind = (node as { kind?: unknown } | null)?.kind;
    if (typeof kind === 'string' && HOST_KINDS.has(kind)) return;
    throw new Error(
        `@gjsify/gtk-host/solid: insertNode got ${describeValue(node)}, which is not a node of this renderer. ` +
            `Almost always this is a component from solid-js/web — the DOM renderer — reaching a universal ` +
            `one: its <Dynamic>, <Portal> and template() build DOM elements with document.createElement and ` +
            `spread onto them with the DOM's own spread, so nothing arrives through these host ops and the ` +
            `subtree renders NOTHING, silently. Import Dynamic, For, Index and Show from ` +
            `@gjsify/gtk-host/solid instead; solid-js's own control flow (For/Index/Show) is ` +
            `renderer-agnostic, everything under solid-js/web is not.`,
    );
}

const renderer = createRenderer<HostNode>({
    createElement: (tag: string) => {
        const el = hostCreateElement(tag);
        // THE unmount signal for HANDLERS, and nothing more. `removeNode` cannot be
        // it — Solid uses one op for a move and for an unmount, and `<For>` moves
        // the same nodes (measured). Solid's per-node scope makes that distinction:
        // it survives a reorder and disposes when the node is genuinely gone, so a
        // node dropped by reconciliation — unreachable from the root afterwards —
        // still gets its handlers disconnected. GJS blocks JS callbacks during GC,
        // so nothing else would.
        //
        // It must NOT unlink. Solid disposes these scopes BEFORE `insertExpression`
        // runs, and `reconcileArrays` opens with `getNextSibling(a[aEnd - 1])` — on
        // an already-unlinked node that reads null, and every trailing insertion
        // then appends at the end of the parent instead of before the marker. Found
        // by review with the real reconciler: `['a','b'] -> ['c']` in a box with a
        // trailing sibling rendered `head | foot | c`.
        onCleanup(() => disconnectHandlers(el));
        return el;
    },

    createTextNode: (value: string) => createText(value),

    replaceText: (node: HostNode, value: string) => {
        setText(node as HostText, value);
    },

    isTextNode: (node: HostNode) => isText(node),

    setProperty: (node: HostNode, name: string, value: unknown, prev?: unknown) => {
        setHostProp(node as HostElement, name, value, prev);
    },

    insertNode: (parent: HostNode, node: HostNode, anchor?: HostNode) => {
        assertHostNode(node);
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
    // NOT renamed, and the compiler is why: `babel-plugin-jsx-dom-expressions` in
    // `generate: "universal"` mode emits `import { setProp } from "<moduleName>"`
    // literally. Every other member of `Renderer<NodeType>` was already exported
    // under its contract name; this one was `setSolidProp`, so a real Solid `.tsx`
    // build against this module failed with MISSING_EXPORT on that single name.
    // The HOST's `setProp` is the one that carries a local alias now.
    setProp,
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
        destroyChildren(root);
    };
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

/**
 * `<Show when={cond}>` — a conditional branch.
 *
 * The child function receives an ACCESSOR, not the value: Solid's runtime passes
 * `keyed ? c : () => …`, so without `keyed` a `(item) => item.name` reads `.name`
 * off a function and renders the function's own name — no type error, no runtime
 * error, wrong string on screen. `keyed: true` opts into the value.
 */
export const Show = SolidShow as unknown as {
    <T>(props: {
        when: T | undefined | null | false;
        keyed: true;
        fallback?: HostNode;
        children: HostNode | ((item: NonNullable<T>) => HostNode);
    }): HostNode;
    <T>(props: {
        when: T | undefined | null | false;
        keyed?: false;
        fallback?: HostNode;
        children: HostNode | ((item: () => NonNullable<T>) => HostNode);
    }): HostNode;
};

/**
 * `<Dynamic component={…}>` — the one control-flow component Solid does NOT ship
 * renderer-agnostically.
 *
 * `For`, `Index` and `Show` live in `solid-js` and reconcile whatever their
 * children return, so this adapter only re-types them. `Dynamic` lives in
 * `solid-js/web`, and that package IS the DOM renderer: its string branch is
 * `document.createElement(component)` followed by the DOM's `spread`. Under a
 * universal renderer it therefore produces a DOM element nobody here can place —
 * measured as `container: ["GtkBox"]`, box children `[]`, no throw, no
 * diagnostic, exit 0. Re-implementing it over the host ops is four lines and it
 * is the only honest alternative to that silence.
 *
 * A `component` that is neither a tag nor a function is REFUSED, where Solid's
 * own `switch` falls through and returns undefined: `component={registry[key]}`
 * with a key that missed is the single most common way to render nothing by
 * accident, and rendering nothing on purpose is `<Show>`'s job.
 */
export function Dynamic<P extends Record<string, unknown>>(
    props: P & { component: string | ((props: P) => HostNode) },
): HostNode {
    const [, rest] = splitProps(props, ['component']);
    // `memo(fn, equal)`: the universal renderer's TYPES demand the second
    // argument, its runtime is `fn => createMemo(() => fn())` and drops it.
    return memo(() => {
        const component = props.component;
        if (typeof component === 'function') return untrack(() => component(rest as unknown as P));
        if (typeof component === 'string') {
            const el = createElement(component);
            // `false`: the children ARE ours to place — `spread` routes them
            // through `insert`, which is how a <Dynamic> with a subtree works.
            spread(el, rest, false);
            return el;
        }
        throw new Error(
            `@gjsify/gtk-host/solid: <Dynamic component={…}> needs a registered tag name or a component ` +
                `function, and got ${describeValue(component)}. Solid's own DOM version returns undefined here and ` +
                `renders nothing at all — a lookup that missed is indistinguishable from an empty branch. ` +
                `Use <Show when={…}> to render nothing on purpose.`,
        );
    }, false) as unknown as HostNode;
}

/**
 * Re-exported, not re-implemented: this and the React adapter carried the SAME
 * function, and Vue carried none — so a Vue app had no supported way to reach a
 * widget at all. It is a host op now (`../host.js`), and its two refusals are
 * coded errors rather than the bare `new Error` they used to be.
 */
export { widgetOf };
