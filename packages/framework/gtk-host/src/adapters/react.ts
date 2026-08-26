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
//   - `commitUpdate` is the whole diff. React 18 split it in two — `prepareUpdate`
//     in the render phase, `commitUpdate` in the commit phase — and 19 deleted the
//     render half outright, so the payload is computed and applied in one place.
//     `diffProps` did not change; only the phase it runs in did.
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
// `process.env.NODE_ENV === 'production' ? require('./cjs/react-reconciler.production.js') :
// require('./cjs/react-reconciler.development.js')`, and the development bundle reaches
// for `document`, `HTMLCanvasElement` and `Path2D`, which makes `--globals auto` inject
// the GTK-backed DOM registers and pull gi://Gdk, GdkPixbuf, Pango and PangoCairo
// into a bundle that needs none of them. Add `--exclude-globals navigator`: even the
// production `scheduler` carries `typeof navigator !== 'undefined' &&
// navigator.scheduling`, which is dead code under GJS but still a free `navigator`
// the detector answers with the same GTK-backed register.
//
// HOW THAT RECIPE IS HELD, and why the guard had to change shape. Until 0.29 the
// member COUNT told the two bundles apart — production read 76, development 94 — so
// `react.spec.ts` pinning 76 also caught a lost define. Measured on 0.33.0, both
// bundles read 160, and the count can no longer distinguish them at all. The guard is
// therefore on the BUNDLE CONTENT instead: the development bundle is the only one
// carrying `document` / `HTMLCanvasElement` / `Path2D`, so their absence in the built
// artifact is the fact we actually care about rather than a proxy for it.

import Reconciler from 'react-reconciler';
// `constants.js`, with the extension: `react-reconciler` ships no `exports` map,
// and TypeScript's NodeNext resolver is faithful to Node ESM there — an
// extensionless subpath of such a package does not resolve, and the error names
// the module rather than the reason (`TS2307`). The `.js` spelling reaches both
// `@types/react-reconciler/constants.d.ts` and the real file.
import { ConcurrentRoot, DefaultEventPriority, NoEventPriority } from 'react-reconciler/constants.js';
// A VALUE import, for exactly one member. React 19 asks the host for a
// `HostTransitionContext` and reads it at construction, and the only way to
// produce a context is React's own factory. It costs nothing measurable: the
// production `react` bundle is already in the graph through the peer.
import { createContext } from 'react';
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
 * React's own props, which are not GObject properties.
 *
 * `children` arrives in `props` for every element — `React.createElement('gtk-box',
 * null, child)` produces `props.children` — and forwarding it produced
 * `<GtkBox> has no property "children"` on the very first nested element.
 *
 * `ref` IS THE REACT 19 ADDITION, and it is measured rather than defensive. React 18
 * lifted both `key` and `ref` off the element before props existed, so this set held
 * `children` alone. React 19 made `ref` an ordinary prop — the change that removed
 * `forwardRef` — and it now reaches `createInstance` for host elements too: the first
 * run against 0.33.0 failed with `<GtkButton> has no property "ref". … or bind it as
 * a signal with onRef`, which is the host correctly refusing a prop React had
 * previously never handed it. `key` still never appears.
 */
const RESERVED = new Set(['children', 'ref']);

/** One authored property that changed: name, next value, previous value. */
type PropChange = readonly [key: string, next: unknown, prev: unknown];

/** The SET above is React's; the loop is `withoutKeys`, shared with the Vue adapter. */
const ownProps = (props: ReactProps | null | undefined): ReactProps | undefined => withoutKeys(props, RESERVED);

/**
 * The prop diff.
 *
 * It ran in the RENDER phase until React 18, where returning `null` from
 * `prepareUpdate` also told React not to schedule a commit for the fiber at all.
 * React 19 deleted that hook, so this runs inside `commitUpdate` and `null` now
 * means only "nothing to write" — the bailout it used to buy is gone, and no
 * amount of adapter code brings it back.
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
 * The one host context, shared by every element in the tree.
 *
 * GTK has no namespace switch (the DOM's HTML/SVG/MathML boundary), so there is
 * nothing to carry and a single frozen object serves the whole tree. Two reasons
 * it is an object and not `null`. React compares the result by IDENTITY to decide
 * whether to push a new context, so one shared instance is what makes that bailout
 * work. And React 19 reads `null` as "no context was provided at all" and logs
 * `Expected host context to exist` once per element — measured, non-fatal, and the
 * tree still renders, which is precisely the kind of noise that gets normalised.
 */
const HOST_CONTEXT: object = Object.freeze({});

/**
 * The update priority React is currently working at.
 *
 * React 19 replaced the single `getCurrentEventPriority` read with a three-member
 * protocol the host has to STORE for: React writes the lane it is entering with
 * `setCurrentUpdatePriority` and reads it back. Module scope is correct here
 * because a process has one reconciler; `react-dom` keeps it the same way.
 */
let currentUpdatePriority: number = NoEventPriority;

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

    // React 19's two new capability gates, declared for the same reason the three
    // above are: answering `false` is what keeps their whole member families
    // (fourteen for resources, eight for singletons) from being called at all,
    // rather than leaving them `undefined` in a commit path. Resources are the
    // DOM's `<link>`/`<script>` hoisting and singletons are `<html>`/`<head>`/
    // `<body>` — neither has a GTK counterpart, and inventing one would mean
    // deciding that some widget is the document.
    supportsResources: false,
    supportsSingletons: false,

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
    // One object for the whole tree — see `HOST_CONTEXT` for why it is an object
    // and not `null`, and why returning the parent's own is load-bearing.
    getRootHostContext: (): object => HOST_CONTEXT,
    getChildHostContext: (parentHostContext: object): object => parentHostContext,

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

    // --- update priority -----------------------------------------------------
    //
    // React 18 asked ONE question here (`getCurrentEventPriority`, deleted in 19)
    // and 19 asks three, because the host now OWNS the current-lane variable
    // instead of deriving it per read. The stored value lives in
    // `currentUpdatePriority` above.

    getCurrentUpdatePriority: (): number => currentUpdatePriority,
    setCurrentUpdatePriority: (priority: number): void => {
        currentUpdatePriority = priority;
    },

    /**
     * The priority an update gets when React is not already inside a lane.
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
    resolveUpdatePriority: (): number =>
        currentUpdatePriority !== NoEventPriority ? currentUpdatePriority : DefaultEventPriority,

    // React asks whether it may render a transition EAGERLY, before yielding, on
    // the guess that the result is cheap. That guess is only ever right when the
    // host can tell an idle moment from a busy one; GTK's main loop is not ours to
    // ask. `false` is the answer every non-DOM renderer gives.
    shouldAttemptEagerTransition: (): boolean => false,

    // --- scheduler tracing ---------------------------------------------------
    //
    // The performance-track instrumentation React 19 emits for its own DevTools
    // profiler. There is no event object to name and no DOM timeline to align
    // against, so these answer honestly rather than fabricating a trace.
    // `-1.1` is React's own sentinel for "this renderer has no timestamps" — a
    // plain `-1` reads as a real, very early time.
    trackSchedulerEvent: (): void => {},
    resolveEventType: (): null => null,
    resolveEventTimeStamp: (): number => -1.1,

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

    /**
     * Diff AND apply — one phase, because React 19 deleted the other one.
     *
     * The argument list is the change with teeth: React 18 passed
     * `(instance, updatePayload, type, prevProps, nextProps, handle)` and 19 passes
     * `(instance, type, prevProps, nextProps, handle)`. The payload slot was
     * removed from the FRONT, so an adapter that kept the old signature would read
     * the type string as its payload and iterate a string — which is why this is
     * spelled out rather than left to positional luck.
     */
    commitUpdate: (instance: HostElement, _type: string, prevProps: ReactProps, nextProps: ReactProps): void => {
        const changes = diffProps(prevProps, nextProps);
        if (changes === null) return;
        for (const [key, next, prev] of changes) setProp(instance, key, next, prev);
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

    // --- suspending a commit (React 19) --------------------------------------
    //
    // React 19 lets a host DELAY a commit until an asynchronous resource it owns
    // has arrived — the DOM uses it to hold a commit until a stylesheet or an
    // image has loaded, so the frame that appears is never half-styled. A GTK
    // widget tree has no such resource: every widget this host creates exists the
    // moment `createInstance` returns.
    //
    // `waitForCommitToBeReady` returning `null` is the load-bearing one — it is
    // React's "commit now", and any function returned instead would be awaited.
    // The three `maySuspendCommit*` predicates are what keep the rest of the
    // family unreached, and `preloadInstance` answering `true` means "already
    // loaded", not "loading started".
    maySuspendCommit: (): boolean => false,
    maySuspendCommitOnUpdate: (): boolean => false,
    maySuspendCommitInSyncRender: (): boolean => false,
    preloadInstance: (): boolean => true,
    startSuspendingCommit: (): void => {},
    suspendInstance: (): void => {},
    waitForCommitToBeReady: (): null => null,

    // Paired with the above: React DOM schedules work for after the browser has
    // painted. GJS has no paint callback that means the same thing, and calling
    // back immediately would be a lie about when the frame reached the screen,
    // so nothing is scheduled and nothing pretends to be.
    requestPostPaintCallback: (): void => {},

    // --- form state (React 19) -----------------------------------------------
    //
    // `useFormStatus` and `<form action={…}>` are DOM form semantics: React needs
    // a context to publish the pending transition through and a way to reset a
    // form element after an action. GTK has no form element — a `Gtk.Entry` is not
    // part of a submittable group — so the context carries the "not pending"
    // sentinel forever and the reset has nothing to reset.
    NotPendingTransition: null,
    HostTransitionContext: createContext(null),
    resetFormInstance: (): void => {},

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
 * The default lane is concurrent (see `resolveUpdatePriority`), so a `setState`
 * from a GTK signal handler lands on a later main-loop iteration. In an
 * application that is right — GTK is running a main loop. Outside one, and in a
 * test, this is how a change becomes visible without pumping.
 *
 * `reconciler.flushSync` was RENAMED to `flushSyncFromReconciler` in React 19.
 * The rename is the harmless half; see `createRoot` for the half that is not.
 */
export const flushSync = <T>(fn: () => T): T => reconciler.flushSyncFromReconciler(fn) as T;

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

    /**
     * An error NO error boundary caught. React 19 split this out of the single
     * callback React 18 had, and it is the one that means the tree is broken.
     */
    onUncaughtError?(error: Error): void;

    /** An error an error boundary DID catch — reported, then handled by the boundary. */
    onCaughtError?(error: Error): void;
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
    const report =
        (what: string, override?: (error: Error) => void) =>
        (error: Error): void => {
            if (override) return override(error);
            console.error(`@gjsify/gtk-host/react: ${what}`, error);
        };

    /**
     * The error the host refused this render with — held so `render` can rethrow it.
     *
     * THE REGRESSION THIS EXISTS TO UNDO. Under React 18 an error thrown by the host
     * during render propagated out of `render()`, so `createElement('GtkBox', null,
     * 'stray')` threw `<GtkBox> has no text sink` at the call site. React 19 routes
     * it to `onUncaughtError` instead and returns normally — measured: four
     * conformance vectors that assert a named refusal all saw an empty message and a
     * successful call, while the diagnostic went to the console.
     *
     * A refusal that only reaches a log is the failure mode ADR 0027 § 3 exists
     * against: GTK's own wrong answer is already exit 0, and a host that refuses
     * loudly only to have the refusal swallowed one layer up has bought nothing. So
     * the DEFAULT is to hold the first uncaught error and rethrow it from `render`,
     * where the caller is. Passing `onUncaughtError` opts out — an application with
     * its own error surface should not also get a throw.
     */
    let refusal: Error | null = null;
    const onUncaught = options.onUncaughtError
        ? report('React hit an error no boundary caught', options.onUncaughtError)
        : (error: Error): void => {
              refusal ??= error;
          };

    // TEN arguments, and the two new ones were inserted in the MIDDLE. React 18
    // took `(…, identifierPrefix, onRecoverableError, transitionCallbacks)`; 19
    // takes `(…, identifierPrefix, onUncaughtError, onCaughtError,
    // onRecoverableError, onDefaultTransitionIndicator)`. Passing the 18 list
    // still runs: the recoverable-error handler simply becomes the UNCAUGHT one
    // and the real recoverable slot stays undefined. No type error, no warning,
    // and the symptom is a handler firing for the wrong class of error — so this
    // call is written out one argument per line rather than kept compact.
    const root = reconciler.createContainer(
        host,
        ConcurrentRoot,
        null,
        false,
        null,
        '',
        onUncaught,
        report('an error boundary caught an error', options.onCaughtError),
        report('React recovered from an error', options.onRecoverableError),
        () => {},
    );

    /**
     * Render synchronously — and NOT through `flushSync`.
     *
     * React 18's `flushSync(() => updateContainer(…))` was the whole recipe. Under
     * 19 that combination on a ConcurrentRoot MOUNTS NOTHING: the call returns
     * cleanly, no error is raised, and the container is empty. Measured on
     * react-reconciler 0.33.0 — the exact silent-empty-window failure this package
     * exists to refuse, reintroduced by a rename that looked mechanical.
     *
     * `updateContainerSync` schedules the work on the sync lane and
     * `flushSyncWork` drains it. Both are needed: the first alone leaves the work
     * queued.
     */
    const renderSync = (element: ReactNode): void => {
        refusal = null;
        reconciler.updateContainerSync(element, root, null, null);
        reconciler.flushSyncWork();
        if (refusal !== null) {
            const error = refusal;
            refusal = null;
            throw error;
        }
    };

    return {
        container: host,
        render: renderSync,
        unmount() {
            renderSync(null);
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
