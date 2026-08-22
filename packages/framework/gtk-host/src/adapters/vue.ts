// Vue 3 on GTK4 — the whole adapter.
//
// Vue's `RendererOptions` is ten required methods and four optional ones, and the
// ten are host ops. The interesting differences from the Solid adapter are all in
// what Vue asks for that Solid does not:
//
//   - `createComment` — Vue marks every `v-if` branch and every fragment boundary
//     with one. That is why the host has anchor nodes at all: they never enter the
//     GTK tree, so an empty branch cannot shift a sibling's index.
//   - `createElement(type, ns, isCustomizedBuiltIn, vnodeProps)` — Vue DOES hand
//     over the props, so construct-only properties can be set at construction
//     rather than triggering a rebuild. Solid's `createElement(tag)` cannot.
//   - `setElementText` — Vue's bulk path for a text-only element.
//
// The four optional ones are where a DOM renderer's assumptions surface, and two
// of them cannot be honoured on GTK. They throw rather than lie: a silently wrong
// window is the failure this package exists to prevent.

import { createRenderer } from '@vue/runtime-core';
import type Gtk from '@girs/gtk-4.0';

import {
    adopt,
    createAnchor,
    createElement as hostCreateElement,
    createText as hostCreateText,
    destroy as hostDestroy,
    insert as hostInsert,
    materialize,
    nextSibling as hostNextSibling,
    parentNode as hostParentNode,
    setElementText as hostSetElementText,
    setProp,
    setText as hostSetText,
} from '../host.js';
import type { HostElement, HostNode, HostText } from '../types.js';

/**
 * Vue's own vnode props, which are not GObject properties.
 *
 * The list is `@vue/shared`'s `isReservedProp` — kept literal rather than imported
 * so this adapter depends on `@vue/runtime-core` alone.
 */
const RESERVED = new Set([
    'key',
    'ref',
    'ref_for',
    'ref_key',
    'onVnodeBeforeMount',
    'onVnodeMounted',
    'onVnodeBeforeUpdate',
    'onVnodeUpdated',
    'onVnodeBeforeUnmount',
    'onVnodeUnmounted',
]);

function withoutReservedProps(props: Record<string, unknown> | null | undefined) {
    if (!props) return undefined;
    let filtered: Record<string, unknown> | undefined;
    for (const key of Object.keys(props)) {
        if (RESERVED.has(key)) continue;
        (filtered ??= {})[key] = props[key];
    }
    return filtered;
}

const renderer = createRenderer<HostNode, HostElement>({
    createElement: (type, _namespace, _isCustomizedBuiltIn, vnodeProps) =>
        // Vue hands the props over, so construct-only values arrive in time and the
        // host does not have to rebuild on the first patch. They are the RAW vnode
        // props though, reserved keys included — `key`, `ref` and the `onVnode*`
        // lifecycle hooks are Vue's own and are not GObject properties. Passing
        // them through produced `<GtkLabel> has no property "key"` on the first
        // keyed list.
        hostCreateElement(type, withoutReservedProps(vnodeProps)),

    createText: (text: string) => hostCreateText(text),

    // Every `v-if` and every fragment boundary. An anchor owns no widget and never
    // enters the GTK tree — `insert` resolves forward past it — which is what keeps
    // an empty branch from shifting the index of everything after it.
    createComment: (text: string) => createAnchor(text),

    setText: (node, text) => hostSetText(node as HostText, text),

    setElementText: (node, text) => hostSetElementText(node, text),

    patchProp: (el, key, prevValue, nextValue) => {
        if (RESERVED.has(key)) return;
        // Vue signals "this prop is gone" with `null`, not `undefined`: `patchProps`
        // calls `hostPatchProp(el, key, oldProps[key], null)` for every key that
        // disappeared. The host's contract is `undefined` → the ParamSpec default,
        // and `null` reached `set_property` verbatim — which for a `gint` property
        // throws, after `el.props` had already recorded the null for the next
        // rebuild to replay.
        setProp(el, key, nextValue === null ? undefined : nextValue, prevValue);
    },

    insert: (el, parent, anchor) => hostInsert(el, parent, anchor ?? null),

    // A TEARDOWN here, unlike the Solid adapter — and the difference is measured,
    // not assumed. Vue moves a node by calling `insert` alone (DOM `insertBefore`
    // moves implicitly), so `remove` is only ever reached for a real unmount:
    // with this mapped to `destroy`, a keyed reorder still reuses 3 of 3 widget
    // objects AND the handlers are gone after `app.unmount()`. Solid uses one op
    // for both, so its adapter must detach here and tear down in its disposer.
    //
    // This is the framework tax ADR 0027 predicts: the host op is the same, what
    // the framework MEANS by it is not.
    remove: (el) => hostDestroy(el),

    parentNode: (node) => hostParentNode(node),

    nextSibling: (node) => hostNextSibling(node),

    // --- optional, and honest about it ---------------------------------------

    // `<Teleport to="#id">` with a STRING target. Returning null here does NOT
    // produce a warning a user would see: `TeleportImpl.process` mounts nothing
    // when the target is falsy, and the warn is `__DEV__`-only — which the build
    // recipe this adapter mandates (`NODE_ENV="production"`) strips. So a string
    // target would render NOTHING, silently, in exactly the configuration the
    // README prescribes. Same rule as `cloneNode` two lines down: throw rather
    // than lie. Resolving a name would need a registry of mounted roots; when a
    // consumer needs it, that is the work.
    querySelector: (selector) => {
        throw new Error(
            `@gjsify/gtk-host/vue: <Teleport to="${selector}"> needs a string target resolved against a ` +
                `widget tree, which this adapter does not implement yet. Pass the target widget itself ` +
                `(<Teleport :to="el">), or the teleport would render nothing at all under the production ` +
                `defines this adapter requires.`,
        );
    },

    // `<style scoped>` compiles to an attribute selector, which GTK4 CSS does not
    // have. The scope id becomes a style class instead; the SFC pipeline has to
    // rewrite `[data-v-x]` to `.data-v-x` for that to mean anything, and until it
    // does this is a no-op that at least does not corrupt anything.
    setScopeId: (el, id) => {
        const widget = materialize(el) as unknown as { add_css_class?: (c: string) => void };
        widget.add_css_class?.(id);
    },

    // NOT implemented, deliberately. `cloneNode` backs Vue's static hoisting and
    // `insertStaticContent` takes an HTML STRING — GObjects do not clone and GTK
    // parses no HTML. The SFC/JSX pipeline must disable static hoisting
    // (`hoistStatic: false`, `transformHoist: null`); if it ever does not, these
    // throw at the first static subtree instead of rendering something wrong.
    cloneNode: (node) => {
        throw new Error(
            `@gjsify/gtk-host/vue: cloneNode is not available on GTK — a GObject does not clone. ` +
                `This is Vue's static-hoisting path: compile with hoistStatic: false and transformHoist: null. ` +
                `(node kind: ${(node as HostNode).kind})`,
        );
    },

    insertStaticContent: () => {
        throw new Error(
            `@gjsify/gtk-host/vue: insertStaticContent takes an HTML string and GTK parses no HTML. ` +
                `This is Vue's stringifyStatic transform: compile with hoistStatic: false and transformHoist: null.`,
        );
    },
});

// No `hydrate`: that belongs to `createHydrationRenderer` and hydration means
// taking over server-rendered markup, which does not exist here.
export const { render, createApp } = renderer;

/**
 * Mount a Vue app into a widget the application owns.
 *
 * `createApp(...).mount(container)` wants a host element; an application has a
 * `Gtk.Widget`. `adopt` bridges that and records what the container already held,
 * so the app renders AFTER the application's own chrome rather than above it.
 */
export function mount(rootComponent: Parameters<typeof createApp>[0], container: Gtk.Widget) {
    const app = createApp(rootComponent);
    app.mount(adopt(container));
    return app;
}
