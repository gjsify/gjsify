// React on GTK4 — the whole adapter.
//
// The third contract over one host, and the one that answers the question the
// other two could not: React does not publish a renderer *interface*, it
// publishes a FACTORY. `react-reconciler` is `module.exports = function
// $$$reconciler($$$hostConfig) { … }`, and the body opens by destructuring the
// whole config into module-scope variables. So the contract is not a documented
// list — it is whatever that factory reads, and it is readable at runtime.
// `react.spec.ts` reads it through a recording Proxy and pins the count, which is
// why nothing here is a hand-copied method list.
//
// What React asks for that the other two do not, and what each one cost:
//
//   - `clearContainer(container)`. React CLEARS the root before its first commit
//     (`updateHostRoot` sets the `Snapshot` flag whenever `current.child` is null,
//     with the comment "This handles the case of React rendering into a container
//     with previous children"). On GTK that container is the application's own
//     widget, and the app's chrome is in it. So this maps to the SHADOW children
//     only and never to `el.foreign` — a vector holds it.
//   - `prepareUpdate` / `commitUpdate` are a two-phase diff: React expects the
//     payload to be computed in the render phase and applied in the commit phase.
//     Returning a constant "yes, changed" works and throws the diff away; the diff
//     is computed where React asks for it.
//   - `getPublicInstance` IS `ref`. It returns the author's own widget, never the
//     `GtkListBoxRow` the host wrapped it in — a `ref` that hands back a wrapper
//     the author never wrote is a silent lie about which widget they hold.
//   - `hideInstance`/`hideTextInstance` are `<Suspense>`/`<Offscreen>`. A text run
//     owns no widget, so hiding one means emptying its contribution to the parent's
//     text sink — and `unhideTextInstance` is handed the text back, so nothing has
//     to be remembered.
//
// BUILD RECIPE, and it is not optional. `--define 'process.env.NODE_ENV="production"'`,
// exactly as the Vue adapter requires: `react-reconciler/index.js` is
// `process.env.NODE_ENV === 'production' ? require('./cjs/…production.min.js') :
// require('./cjs/…development.js')`, and the development bundle reaches for
// `document`, `HTMLCanvasElement` and `Path2D`, which makes `--globals auto` inject
// the GTK-backed DOM registers and pull gi://Gdk, GdkPixbuf, Pango and PangoCairo
// into a bundle that needs none of them. Add `--exclude-globals navigator`: even the
// production `scheduler` carries `typeof navigator !== 'undefined' &&
// navigator.scheduling`, which is dead code under GJS but still a free `navigator`
// the detector answers with the same GTK-backed register.

import Reconciler from 'react-reconciler';
// `constants.js`, with the extension: `react-reconciler` ships no `exports` map,
// and TypeScript's NodeNext resolver is faithful to Node ESM there — an
// extensionless subpath of such a package does not resolve, and the error names
// the module rather than the reason (`TS2307`). The `.js` spelling reaches both
// `@types/react-reconciler/constants.d.ts` and the real file.
import { ConcurrentRoot, DefaultEventPriority } from 'react-reconciler/constants.js';
import type { ReactNode } from 'react';
import type Gtk from '@girs/gtk-4.0';

import {
    adopt,
    createElement as hostCreateElement,
    createText,
    destroy,
    destroyChildren,
    insert as hostInsert,
    materialize,
    setElementText,
    setProp,
    setText,
    widgetOf,
} from '../host.js';
import { withoutKeys } from '../props.js';
import type { HostElement, HostNode, HostText } from '../types.js';

/** What React hands `createInstance`: the vnode props, `children` included. */
export type ReactProps = Record<string, unknown>;

/**
 * `children` is React's own prop and not a GObject property.
 *
 * It arrives in `props` for every element — `React.createElement('gtk-box', null,
 * child)` produces `props.children` — while `key` and `ref` do not (React 18 lifts
 * both off the element before props exist). Forwarding it produced
 * `<GtkBox> has no property "children"` on the very first nested element.
 */
const RESERVED = new Set(['children']);

/** One authored property that changed: name, next value, previous value. */
type PropChange = readonly [key: string, next: unknown, prev: unknown];

/** The SET above is React's; the loop is `withoutKeys`, shared with the Vue adapter. */
const ownProps = (props: ReactProps | null | undefined): ReactProps | undefined => withoutKeys(props, RESERVED);

/**
 * The render-phase diff, in the phase React asks for it.
 *
 * `null` means "no update", and React then never schedules a commit for this
 * fiber — which is the only reason to diff here rather than in `commitUpdate`.
 * A key that DISAPPEARED becomes `undefined`, the host's spelling for "back to
 * what construction leaves behind". An AUTHORED `label={null}` is not translated
 * here and never was: the host reads `null` as removed too, which is what makes
 * that the same fact rather than a per-adapter courtesy.
 */
function diffProps(oldProps: ReactProps, newProps: ReactProps): PropChange[] | null {
    let out: PropChange[] | null = null;
    for (const key of Object.keys(newProps)) {
        if (RESERVED.has(key)) continue;
        if (newProps[key] === oldProps[key]) continue;
        (out ??= []).push([key, newProps[key], oldProps[key]]);
    }
    for (const key of Object.keys(oldProps)) {
        if (RESERVED.has(key) || key in newProps) continue;
        (out ??= []).push([key, undefined, oldProps[key]]);
    }
    return out;
}

/**
 * The object GTK holds for this node — the wrapper row when the parent demanded one.
 *
 * `Gtk.ListBox` addresses a `GtkListBoxRow` the host created, and hiding the child
 * INSIDE it leaves an empty row on screen. Read off the node's own `wrapper`
 * rather than through `addressOf`: the placement engine is the host's internal
 * (ADR 0027 § 7, and `scripts/check-adapter-import-direction.mjs` enforces it),
 * while `wrapper` is part of the node every adapter already holds.
 */
const visibilityTargetOf = (el: HostElement): { set_visible(visible: boolean): void } => {
    const widget = materialize(el);
    return (el.wrapper ?? widget) as unknown as { set_visible(visible: boolean): void };
};

/**
 * The HostConfig, exported because it IS the contract.
 *
 * `react.spec.ts` builds a second reconciler over a Proxy of this object to read
 * the member set the INSTALLED `react-reconciler` asks for, so a version that
 * starts asking for something new fails a test instead of returning `undefined`
 * in a commit. It is also the seam for a consumer who needs a differently
 * configured reconciler (a `LegacyRoot`, a different event priority) without
 * restating the mapping.
 */
export const gtkHostConfig = {
    // --- modes ---------------------------------------------------------------
    //
    // Mutation mode, like React DOM: GTK widgets are mutable and a GObject does
    // not clone, so persistence mode has nothing to build a new tree out of.
    // Hydration means adopting markup a server produced, which does not exist.
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    isPrimaryRenderer: true,

    // Not declared: `supportsMicrotasks`. It only moves SYNC-lane flushing into a
    // microtask; default-lane work goes through `scheduler` either way, so it
    // would add a second scheduling path without removing the first. `flushSync`
    // below is the one explicit flush, and the GLib main loop drives the rest.

    noTimeout: -1 as const,
    scheduleTimeout: setTimeout,
    cancelTimeout: clearTimeout,

    // --- creation ------------------------------------------------------------

    // React hands the props over, so construct-only values arrive at
    // `g_object_new` time and the first patch does not have to rebuild the
    // widget. Solid's `createElement(tag)` cannot do this; Vue's can.
    createInstance: (type: string, props: ReactProps): HostElement => hostCreateElement(type, ownProps(props)),

    createTextInstance: (text: string): HostText => createText(text),

    appendInitialChild: (parent: HostElement, child: HostNode): void => {
        hostInsert(child, parent, null);
    },

    // `false`: nothing to do after the initial children are in place, so
    // `commitMount` stays unreachable. Materialisation is the host's decision and
    // happens when a widget is actually needed, not on a renderer's schedule.
    finalizeInitialChildren: (): boolean => false,

    /**
     * `false`, always — one text path instead of two.
     *
     * `true` would tell React to skip text instances for this element and leave
     * the string in `props.children` for the adapter to write. The host already
     * owns that translation: a text NODE is concatenated into the descriptor's
     * `textSink`, and a widget without one refuses text BY TAG NAME. Answering
     * `true` would move that decision into the adapter, where it would be a
     * widget-knowledge test — the one thing ADR 0027 § 7 forbids an adapter.
     *
     * It also keeps `resetTextContent` unreachable: React sets the `ContentReset`
     * flag only when `shouldSetTextContent` was true for the PREVIOUS props.
     */
    shouldSetTextContent: (): boolean => false,

    // --- host context --------------------------------------------------------
    //
    // GTK has no namespace switch (the DOM's HTML/SVG/MathML boundary), so there
    // is nothing to carry. Returning the parent's own object rather than a fresh
    // one is load-bearing: React compares the result by IDENTITY to decide whether
    // to push a new context, and a new object per element defeats that bailout.
    getRootHostContext: (): null => null,
    getChildHostContext: (parentHostContext: null): null => parentHostContext,

    /**
     * What a `ref` receives — the author's widget, never the host's wrapper.
     *
     * `<GtkListBox><GtkButton ref={…}/>` puts the button inside a
     * `GtkListBoxRow` the host created. Handing that row back would give the
     * author a widget they never wrote and whose `label` write does nothing.
     */
    getPublicInstance: (instance: HostElement): Gtk.Widget => materialize(instance) as unknown as Gtk.Widget,

    // --- commit fences -------------------------------------------------------
    //
    // The DOM uses these to save and restore selection across a commit. GTK's
    // focus and selection survive a widget move on their own — which is exactly
    // what the identity-across-reorder vectors assert — so there is nothing to
    // save. `null` is React's "no focused instance".
    prepareForCommit: (): null => null,
    resetAfterCommit: (): void => {},
    preparePortalMount: (): void => {},

    /**
     * The priority every update outside React's own event system gets.
     *
     * React DOM derives this from the DOM event being handled (a click is
     * discrete, a scroll continuous). A GTK signal handler is not a DOM event and
     * there is no ambient event to read, so every update is a default-lane one —
     * the same answer `react-art` and `react-nil` give. Consequence, stated
     * because it is load-bearing: a `setState` from a GTK handler is CONCURRENT,
     * so it lands when `scheduler` next runs, i.e. on the next GLib main-loop
     * iteration. `flushSync` is the escape hatch, and the spec pumps the main
     * context to prove the scheduled path works at all under GJS.
     */
    getCurrentEventPriority: (): number => DefaultEventPriority,

    // --- mutation ------------------------------------------------------------

    appendChild: (parent: HostElement, child: HostNode): void => {
        hostInsert(child, parent, null);
    },
    appendChildToContainer: (container: HostElement, child: HostNode): void => {
        hostInsert(child, container, null);
    },
    insertBefore: (parent: HostElement, child: HostNode, before: HostNode): void => {
        hostInsert(child, parent, before);
    },
    insertInContainerBefore: (container: HostElement, child: HostNode, before: HostNode): void => {
        hostInsert(child, container, before);
    },

    // A TEARDOWN, like the Vue adapter and unlike the Solid one — and the
    // difference is in the framework, not in the host. React MOVES a node with
    // `insertBefore`/`appendChild` alone (`commitPlacement` never removes first),
    // so `removeChild` is only ever a real unmount. The reorder vectors are what
    // hold that claim: they assert the same widget objects survive.
    removeChild: (_parent: HostElement, child: HostNode): void => {
        destroy(child);
    },
    removeChildFromContainer: (_container: HostElement, child: HostNode): void => {
        destroy(child);
    },

    /**
     * React clears the root before its FIRST commit — and the application's own
     * chrome must survive it.
     *
     * `updateHostRoot` sets the `Snapshot` flag whenever the previous render
     * produced no child, and `commitBeforeMutationEffects` then calls this on the
     * container. In the DOM that discards leftover markup. Here the container is a
     * widget the application built and filled, so this clears what the HOST put
     * there (the shadow children) and never `el.foreign`, which `adopt` recorded
     * precisely so placement can offset past it.
     *
     * `destroy` rather than `remove`, for the same reason `removeChild` uses it:
     * GJS blocks JS callbacks during GC, so a detached node keeps its handlers
     * for the life of the process.
     */
    clearContainer: (container: HostElement): void => {
        destroyChildren(container);
    },

    prepareUpdate: (
        _instance: HostElement,
        _type: string,
        oldProps: ReactProps,
        newProps: ReactProps,
    ): PropChange[] | null => diffProps(oldProps, newProps),

    commitUpdate: (instance: HostElement, updatePayload: PropChange[]): void => {
        for (const [key, next, prev] of updatePayload) setProp(instance, key, next, prev);
    },

    commitTextUpdate: (textInstance: HostText, _oldText: string, newText: string): void => {
        setText(textInstance, newText);
    },

    // Unreachable while `finalizeInitialChildren` answers false, and kept as the
    // guard for the day it does not — not simplified into a silent return, which
    // is the one shape no test here could catch.
    commitMount: (): void => {
        throw new Error(
            '@gjsify/gtk-host/react: commitMount was called, which means finalizeInitialChildren ' +
                'returned true. Nothing in this adapter asks for a post-mount callback yet.',
        );
    },

    // Same: React sets `ContentReset` only when the PREVIOUS props were a direct
    // text child, which `shouldSetTextContent: () => false` never reports. The
    // implementation is the honest one for the day that changes.
    resetTextContent: (instance: HostElement): void => {
        setElementText(instance, '');
    },

    // --- Suspense / Offscreen visibility -------------------------------------
    //
    // `set_visible` is `Gtk.Widget`'s own, not per-widget knowledge, so this is
    // the same class of call as the Vue adapter's `add_css_class` for a scope id.
    hideInstance: (instance: HostElement): void => {
        visibilityTargetOf(instance).set_visible(false);
    },
    unhideInstance: (instance: HostElement): void => {
        visibilityTargetOf(instance).set_visible(true);
    },

    /**
     * A text run owns no widget, so hiding it means emptying what it contributes.
     *
     * The parent's text sink is a concatenation of its text children, so writing
     * `''` removes exactly this run and leaves its siblings. Nothing has to be
     * remembered: React hands the text back to `unhideTextInstance` as the fiber's
     * own `memoizedProps`.
     */
    hideTextInstance: (textInstance: HostText): void => {
        setText(textInstance, '');
    },
    unhideTextInstance: (textInstance: HostText, text: string): void => {
        setText(textInstance, text);
    },

    // --- the rest of what the factory reads ----------------------------------
    //
    // React reads every member of the config at construction, so these exist to
    // be honest about the answer rather than to leave `undefined` in a commit
    // path. None of them has a GTK meaning: there is no DOM node to map back
    // (`getInstanceFromNode` backs React DOM's event system), no `<ReactScope>`
    // in a stable release, and no active-element blur to sequence around a
    // commit — GTK moves focus with the widget.
    getInstanceFromNode: (): null => null,
    getInstanceFromScope: (): null => null,
    prepareScopeUpdate: (): void => {},
    beforeActiveInstanceBlur: (): void => {},
    afterActiveInstanceBlur: (): void => {},

    // React nulls the fiber's `stateNode` right after this. `destroy` already ran
    // from `removeChild` for the whole subtree, so there is nothing left to
    // detach — and unlike the DOM there is no expando on the widget to clear.
    detachDeletedInstance: (): void => {},
};

export type GtkHostConfig = typeof gtkHostConfig;

const reconciler = Reconciler(gtkHostConfig as never);

/**
 * Run `fn` and flush every update it schedules before returning.
 *
 * The default lane is concurrent (see `getCurrentEventPriority`), so a `setState`
 * from a GTK signal handler lands on a later main-loop iteration. In an
 * application that is right — GTK is running a main loop. Outside one, and in a
 * test, this is how a change becomes visible without pumping.
 */
export const flushSync = <T>(fn: () => T): T => reconciler.flushSync(fn) as T;

export interface ReactRoot {
    /** Render (or re-render) this tree. Synchronous — the widgets exist on return. */
    render(element: ReactNode): void;
    /** Unmount the tree, tearing every widget and handler down. */
    unmount(): void;
    /** The host element wrapping the application's container. */
    readonly container: HostElement;
}

export interface ReactRootOptions {
    /**
     * What to do with an error React RECOVERED from — a render an error boundary
     * caught and retried, or a commit that had to fall back.
     *
     * The default is `console.error`, which is what `react-dom` does
     * (`reportError`, absent under GJS). Rethrowing is deliberately NOT the
     * default: React calls this from inside the commit, so a throw would break
     * the error boundary that just did its job. A test passes its own recorder
     * and asserts nothing arrived.
     */
    onRecoverableError?(error: Error): void;
}

/**
 * A React root over a widget the application owns.
 *
 * `adopt` is the bridge every adapter needs: React's `createContainer` wants a
 * container of the renderer's own type and an application has a `Gtk.Widget`. It
 * also records what the container already held, so the tree renders AFTER the
 * application's own chrome instead of above it.
 *
 * `render` flushes synchronously. React's own `createRoot().render()` does not,
 * and the reason to differ is measured rather than stylistic: without a GLib main
 * loop nothing drives `scheduler`, so an unflushed first render leaves the
 * container empty with no error — the silent-empty-window failure this package
 * exists to refuse. An application that wants concurrent behaviour has
 * `reconciler`-level control through `gtkHostConfig`.
 */
export function createRoot(container: Gtk.Widget, options: ReactRootOptions = {}): ReactRoot {
    const host = adopt(container);
    const onRecoverableError =
        options.onRecoverableError ??
        ((error: Error) => {
            console.error('@gjsify/gtk-host/react: React recovered from an error', error);
        });
    const root = reconciler.createContainer(host, ConcurrentRoot, null, false, null, '', onRecoverableError, null);
    return {
        container: host,
        render(element: ReactNode) {
            reconciler.flushSync(() => {
                reconciler.updateContainer(element, root, null, null);
            });
        },
        unmount() {
            reconciler.flushSync(() => {
                reconciler.updateContainer(null, root, null, null);
            });
        },
    };
}

/** `createRoot(container).render(element)`, for the common case. */
export function mount(element: ReactNode, container: Gtk.Widget, options: ReactRootOptions = {}): ReactRoot {
    const root = createRoot(container, options);
    root.render(element);
    return root;
}

/**
 * Re-exported, not re-implemented: the Solid adapter carried the SAME function and
 * Vue carried none. It is a host op now, with coded errors instead of bare ones.
 */
export { widgetOf };

/**
 * Re-exported because a React app mounting into a second, hand-held container
 * needs it and importing the host separately is a second module for one function.
 */
export { adopt };
