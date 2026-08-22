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

import { createRenderer, type RendererOptions } from '@vue/runtime-core';
import Gtk from 'gi://Gtk?version=4.0';

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

/**
 * Adopted teleport targets, one host element per widget.
 *
 * `insert` is called repeatedly for the same target — once per teleported child,
 * plus the two text anchors `TeleportImpl` places around them — and each call
 * must see the SAME shadow tree, or every insertion computes its position
 * against a freshly snapshotted `foreign` list. Weak, because the map must not
 * be what keeps an application's widget alive.
 */
const adoptedParents = new WeakMap<object, HostElement>();

/**
 * A host element for whatever Vue calls a parent.
 *
 * `<Teleport :to="el">` with a non-string target is handed through VERBATIM —
 * `resolveTarget`'s non-string branch is `return targetSelector` — so the parent
 * arriving here is the application's raw widget, not a host node. That is also
 * the form this adapter's own error message and README prescribe, so coercing it
 * is what makes the prescription true; re-documenting it only moves the trap.
 * The host refuses a raw widget by name (`not-a-host-parent`), which stays the
 * backstop for every OTHER way one could arrive.
 *
 * The two facts are the same two the host checks: `kind` alone is a plain string
 * a GObject wrapper could carry, and the descriptor is what every op dereferences.
 */
function asHostParent(parent: HostElement): HostElement {
    const candidate = parent as unknown as { kind?: unknown; descriptor?: unknown } | null;
    if (candidate && candidate.kind === 'element' && typeof candidate.descriptor === 'object') return parent;
    // Not an object at all: no widget to adopt, and the host's refusal already
    // names what it got. Guessing here would replace a good diagnostic with a
    // TypeError from inside `adopt`.
    if (candidate === null || typeof candidate !== 'object') return parent;
    const cached = adoptedParents.get(candidate);
    if (cached) return cached;
    const adopted = adopt(parent as unknown as Gtk.Widget);
    adoptedParents.set(candidate, adopted);
    return adopted;
}

/**
 * `<KeepAlive>` and `<Suspense>` ask the host for an OFF-SCREEN container.
 *
 * `KeepAliveImpl.setup` opens with `const storageContainer = createElement("div")`
 * and `SuspenseImpl` does the same for its `hiddenContainer`. Forwarded as a tag,
 * "div" reached `lookupWidget` and threw `unknown-tag` — and KeepAlive's setup runs
 * inside `callWithErrorHandling`, whose PRODUCTION arm is `console.error(err)` with
 * no rethrow. Measured under exactly the defines this adapter's build recipe
 * mandates: `mount()` returned normally, the container had ZERO children, GTK
 * emitted no diagnostic, exit 0, and the only trace was one line of
 * `{"code":"unknown-tag","name":"GtkHostError"}` — a message-less object.
 *
 * A detached box is the faithful analogue of the DOM's detached `<div>`: the
 * deactivated subtree is really unparented from the visible tree and really held
 * alive, so reactivating it moves the SAME widgets back.
 */
const scratchContainer = (): HostElement => adopt(new Gtk.Box());

/**
 * ARITY separates a user element from an internal scratch request — MEASURED, not
 * assumed, and the obvious alternative does not work.
 *
 * `mountElement` calls `hostCreateElement(vnode.type, namespace, props && props.is,
 * props)` — always four arguments. `KeepAlive`/`Suspense` call `createElement("div")`
 * with one. Instrumenting this function printed `arity=4` for every user element
 * (`["GtkBox",…]`, `["GtkLabel",…]`, `["AdwActionRow",…]`) and `arity=1` for
 * `["div"]`, with nothing else at either arity.
 *
 * Testing the LATER PARAMETERS for undefined cannot do it: `namespace` is
 * `ElementNamespace = 'svg' | 'mathml' | undefined`, so a plain GTK element gets
 * `undefined` there too — the same value the missing argument produces. (A probe
 * that printed the arguments through `JSON.stringify` showed `null` and looked
 * like a discriminator; `JSON.stringify([undefined])` is `"[null]"`.) Arity is the
 * only fact that differs, which is why a rest parameter is worth the cast.
 *
 * A user's `<div>` therefore still arrives with four arguments and is still
 * refused by name — handing IT a scratch container would trade one silent
 * acceptance for another.
 */
type VueCreateElement = RendererOptions<HostNode, HostElement>['createElement'];

const createElementOp = ((...args: unknown[]) =>
    args.length === 1
        ? scratchContainer()
        : // Vue hands the props over, so construct-only values arrive in time and the
          // host does not have to rebuild on the first patch. They are the RAW vnode
          // props though, reserved keys included — `key`, `ref` and the `onVnode*`
          // lifecycle hooks are Vue's own and are not GObject properties. Passing
          // them through produced `<GtkLabel> has no property "key"` on the first
          // keyed list.
          hostCreateElement(
              args[0] as string,
              withoutReservedProps(args[3] as Record<string, unknown> | null),
          )) as unknown as VueCreateElement;

const renderer = createRenderer<HostNode, HostElement>({
    createElement: createElementOp,

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

    insert: (el, parent, anchor) => hostInsert(el, asHostParent(parent), anchor ?? null),

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
    //
    // The advice has to be a form that WORKS. It used to say "pass the target
    // widget itself", and doing literally that rendered nothing, threw nothing
    // and emitted no diagnostic, because Vue hands a non-string target through
    // verbatim and the host was then asked to treat a raw widget as a parent.
    // `insert` adopts it now, so the sentence below is measured, not aspirational.
    querySelector: (selector) => {
        throw new Error(
            `@gjsify/gtk-host/vue: <Teleport to="${selector}"> needs a string target resolved against a ` +
                `widget tree, which this adapter does not implement yet. Pass the target WIDGET instead ` +
                `(<Teleport :to="el">, el being a Gtk.Widget the application owns — this adapter adopts it ` +
                `for you), or pass adopt(el) if you want the host element yourself. A string target would ` +
                `render nothing at all under the production defines this adapter requires.`,
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
 * Re-exported because a Vue app needs it and importing the host separately is a
 * second module for one function: `<Teleport :to="adopt(el)">` is the explicit
 * spelling of what `insert` now does implicitly, and it is the one to reach for
 * when the same target is also addressed by hand.
 */
export { adopt };

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
