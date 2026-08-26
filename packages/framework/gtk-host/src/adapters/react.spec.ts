// The React adapter, through the real `react-reconciler`.
//
// React is the third contract over one host, and the first one whose surface can
// be READ rather than restated: `react-reconciler` is a factory that destructures
// the whole HostConfig at construction, so a recording Proxy over the config
// reports exactly which members the INSTALLED version asks for. The first
// describe below is that measurement, and it is the reason no method list in
// `react.ts` is hand-copied from documentation.
//
// Two discriminators every vector here depends on, both measured:
//
//  1. The BUILD RECIPE. `react-reconciler/index.js` picks its bundle from
//     `process.env.NODE_ENV`, and without the production define the development
//     bundle arrives and reaches for `document`, `HTMLCanvasElement` and `Path2D`
//     — which makes `--globals auto` inject the GTK-backed DOM registers. The
//     "runs without a DOM at all" vector is what notices.
//  2. The SYNCHRONOUS render path. A ConcurrentRoot's updates are DEFAULT-lane, so
//     they are handed to `scheduler` and land on a later main-loop iteration.
//     `updateContainerSync` puts the work on the sync lane and `flushSyncWork`
//     drains it — that is why `render()` is synchronous. Under React 18 this was
//     `flushSync(() => updateContainer(…))`; under 19 that same combination mounts
//     NOTHING on a ConcurrentRoot, silently, which is why the two calls are spelled
//     separately here and in `react.ts`. The scheduled path is not left unmeasured:
//     one vector pumps the GLib main context and proves it works.

import { expect, it, on } from '@gjsify/unit';

import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';
import Reconciler from 'react-reconciler';
import { ConcurrentRoot } from 'react-reconciler/constants.js';
import { createElement, useState, type ReactNode } from 'react';

import { gtkChildTypes, gtkChildren, installDiagnosticsGate } from '../conformance/index.js';
import { runAdapterVectors, type VectorHarness, type VectorNode } from '../conformance/vectors.mjs';
import { GTK_HOSTS, gated } from '../testing/gate.mjs';
import { registerBuiltinWidgets } from '../descriptors/index.js';
import { firstChild } from '../host.js';
import type { HostElement, HostNode, HostText } from '../types.js';
import { jsx as reactJsx } from '../react-jsx-runtime.js';
import { jsx as refusedJsx } from '../jsx-runtime.js';
import { adopt, createRoot, flushSync, gtkHostConfig, mount, widgetOf } from './react.js';

/** The reconciler entry points this suite drives directly. */
interface DirectReconciler {
    createContainer(...args: unknown[]): unknown;
    updateContainer(...args: unknown[]): unknown;
    updateContainerSync(...args: unknown[]): unknown;
    flushSyncWork(): void;
}

const labelsOf = (w: Gtk.Widget) => gtkChildren(w).map((c) => (c as Gtk.Label).label);

/** The shared vector table as React elements. Children spread, so no key is implied. */
const toReactTree = (node: VectorNode): ReactNode =>
    typeof node === 'string'
        ? node
        : createElement(node.tag, node.props ?? null, ...(node.children ?? []).map(toReactTree));

const reactVectors: VectorHarness = {
    framework: 'react-reconciler',
    async mount(container, tree) {
        const root = createRoot(container);
        // `render` flushes synchronously (see `createRoot`), so nothing here pumps.
        root.render(toReactTree(tree));
        return {
            patch: async (next) => root.render(toReactTree(next)),
            unmount: () => root.unmount(),
        };
    },
};

/** Titles of every `AdwActionRow`-shaped descendant, in tree order. */
function titlesOf(root: Gtk.Widget): string[] {
    const out: string[] = [];
    const walk = (w: Gtk.Widget) => {
        const title = (w as unknown as { title?: string }).title;
        if (typeof title === 'string' && /^R\d$/.test(title)) out.push(title);
        for (const child of gtkChildren(w)) walk(child);
    };
    walk(root);
    return out;
}

/**
 * Run the default main loop until `done()` or the budget is spent.
 *
 * `scheduler`'s host callback is a timer source on the default main context
 * (`setImmediate`, which gjsify backs with GLib), so nothing runs it in a test —
 * an application has `Gtk.Application.run`, a spec has this. Bounded, because a
 * scheduler that never runs must fail a test rather than hang one.
 */
function pumpMainLoop(done: () => boolean, budget = 200): number {
    const context = GLib.MainContext.default();
    for (let i = 0; i < budget; i++) {
        if (done()) return i;
        context.iteration(false);
    }
    return done() ? budget : -1;
}

/**
 * A reconciler over the SAME config, with every function call recorded.
 *
 * Two claims in `react.ts` can only be held by watching which ops React reaches
 * for: that React CLEARS the container before its first commit, and that it moves
 * a node with `insertBefore` alone and never with `removeChild`. Neither is
 * visible in the resulting widget tree — a `removeChild`-then-append reorder
 * produces the same ORDER, which is exactly why the vectors assert identity too.
 */
function recordingRoot(container: Gtk.Widget, onRecoverableError: (error: Error) => void) {
    const calls: string[] = [];
    const target = gtkHostConfig as unknown as Record<string, unknown>;
    const recorder = Reconciler(
        new Proxy(target, {
            get(_t, key) {
                const value = target[key as string];
                if (typeof value !== 'function') return value;
                return (...args: unknown[]) => {
                    calls.push(String(key));
                    return (value as (...a: unknown[]) => unknown)(...args);
                };
            },
        }) as never,
    ) as unknown as DirectReconciler;
    // The adopt/createContainer/render sequence of `createRoot`, restated here
    // because the point is to drive it through the INSTRUMENTED reconciler. It
    // must stay argument-for-argument identical to the real one: React 19 inserted
    // `onUncaughtError`/`onCaughtError` BEFORE `onRecoverableError`, so a copy that
    // kept React 18's eight-argument list would silently instrument a differently
    // wired root than the one under test.
    const host = adopt(container);
    const root = recorder.createContainer(
        host,
        ConcurrentRoot,
        null,
        false,
        null,
        '',
        onRecoverableError,
        onRecoverableError,
        onRecoverableError,
        () => {},
    );
    return {
        calls,
        container: host,
        render(element: ReactNode) {
            // `flushSync(() => updateContainer(…))` mounts NOTHING on a
            // ConcurrentRoot under React 19 — see `createRoot` in `react.ts`.
            recorder.updateContainerSync(element, root, null, null);
            recorder.flushSyncWork();
        },
    };
}

// --- the contract, as the installed react-reconciler states it ----------------
//
// Measured on react-reconciler 0.33.0, PRODUCTION bundle (the one the build recipe
// mandates). It was 76 on 0.29.2 — the jump is React 19 adding the resource,
// singleton, view-transition, gesture, form-state and suspend-commit families.
//
// WHAT THIS NUMBER NO LONGER DOES. On 0.29.2 the development bundle read 94, so
// pinning 76 also caught a lost `NODE_ENV=production` define. On 0.33.0 BOTH
// bundles read 160 and the count cannot tell them apart at all. That job now
// belongs entirely to the "runs without a DOM at all" vector below, which tests
// the fact itself (`document` / `HTMLCanvasElement` / `Path2D` are absent) rather
// than a proxy for it. Said here because a count that silently stopped
// discriminating is worth more as a recorded loss than as a deleted line.
const READS = 160;

/**
 * What React asks for and this adapter deliberately does not answer, by family.
 *
 * Each family is switched off by a flag the config DOES declare, so none of these
 * is ever called. Spelled out rather than counted: the union must equal the
 * measured complement exactly, so a react-reconciler that starts asking for a new
 * member fails here instead of reading `undefined` inside a commit.
 */
const GATED_OFF = {
    // `supportsPersistence: false` — a GObject does not clone, so there is no
    // second tree to build.
    persistence: [
        'appendChildToContainerChildSet',
        'cloneHiddenInstance',
        'cloneHiddenTextInstance',
        'cloneInstance',
        'createContainerChildSet',
        'finalizeContainerChildren',
        'replaceContainerChildren',
    ],
    // `supportsHydration: false` — hydration means adopting markup a server
    // produced, and there is none. React 19 widened this family considerably:
    // Activity boundaries, the form-state marker and the dev-warning differs are
    // all new, while 18's two `didNotMatchHydrated*TextInstance` warners are gone.
    hydration: [
        'canHydrateActivityInstance',
        'canHydrateFormStateMarker',
        'canHydrateInstance',
        'canHydrateSuspenseInstance',
        'canHydrateTextInstance',
        'clearActivityBoundary',
        'clearActivityBoundaryFromContainer',
        'clearSuspenseBoundary',
        'clearSuspenseBoundaryFromContainer',
        'commitHydratedActivityInstance',
        'commitHydratedContainer',
        'commitHydratedInstance',
        'commitHydratedSuspenseInstance',
        'describeHydratableInstanceForDevWarnings',
        'diffHydratedPropsForDevWarnings',
        'diffHydratedTextForDevWarnings',
        'finalizeHydratedChildren',
        'flushHydrationEvents',
        'getFirstHydratableChild',
        'getFirstHydratableChildWithinActivityInstance',
        'getFirstHydratableChildWithinContainer',
        'getFirstHydratableChildWithinSingleton',
        'getFirstHydratableChildWithinSuspenseInstance',
        'getNextHydratableInstanceAfterActivityInstance',
        'getNextHydratableInstanceAfterSuspenseInstance',
        'getNextHydratableSibling',
        'getNextHydratableSiblingAfterSingleton',
        'getSuspenseInstanceFallbackErrorDetails',
        'hideDehydratedBoundary',
        'hydrateActivityInstance',
        'hydrateInstance',
        'hydrateSuspenseInstance',
        'hydrateTextInstance',
        'isFormStateMarkerMatching',
        'isSuspenseInstanceFallback',
        'isSuspenseInstancePending',
        'registerSuspenseInstanceRetry',
        'shouldDeleteUnhydratedTailInstances',
        'unhideDehydratedBoundary',
        'validateHydratableInstance',
        'validateHydratableTextInstance',
    ],
    // `supportsResources: false` — the DOM's `<link>`/`<script>` hoisting. There is
    // no document head to hoist into and no GTK analogue of a shared, deduplicated
    // external asset.
    resources: [
        'acquireResource',
        'createHoistableInstance',
        'getHoistableRoot',
        'getResource',
        'hydrateHoistable',
        'isHostHoistableType',
        'mayResourceSuspendCommit',
        'mountHoistable',
        'preloadResource',
        'prepareToCommitHoistables',
        'releaseResource',
        'suspendResource',
        'unmountHoistable',
    ],
    // `supportsSingletons: false` — `<html>`, `<head>`, `<body>`: the elements React
    // adopts rather than creates because the document already owns them. Declaring
    // a singleton here would mean deciding that some widget is the document.
    singletons: [
        'acquireSingletonInstance',
        'isHostSingletonType',
        'isSingletonScope',
        'releaseSingletonInstance',
        'resolveSingletonInstance',
    ],
    // View transitions and the gesture timeline: React 19 animating BETWEEN two
    // committed states by cloning the old one and cross-fading. It rests on the
    // browser's own View Transition API, which has no GTK counterpart — and the
    // animation story here is `Adw.TimedAnimation`/`Adw.SpringAnimation`, driven by
    // the app rather than by the reconciler.
    viewTransitions: [
        'cancelRootViewTransitionName',
        'cancelViewTransitionName',
        'cloneMutableInstance',
        'cloneMutableTextInstance',
        'cloneRootViewTransitionContainer',
        'createViewTransitionInstance',
        'getCurrentGestureOffset',
        'hasInstanceAffectedParent',
        'hasInstanceChanged',
        'measureClonedInstance',
        'removeRootViewTransitionClone',
        'restoreRootViewTransitionName',
        'startGestureTransition',
        'startViewTransition',
        'stopViewTransition',
        'suspendOnActiveViewTransition',
    ],
    // `<Fragment ref={…}>` — a handle onto a fragment's host children, for event
    // listeners and observers across nodes that share no parent element. It is a
    // DOM-event-system affordance; GTK has no event target above the widget.
    fragmentInstances: [
        'commitNewChildToFragmentInstance',
        'createFragmentInstance',
        'deleteChildFromFragmentInstance',
        'updateFragmentInstanceFiber',
    ],
    // `supportsTestSelectors` absent — `findAllNodes`/`focusWithin` are React's
    // own test API; this package's equivalent is `./conformance`, which reads the
    // real GTK tree. `warnsIfNotActing` belongs with them: it is `act()`'s warning
    // switch, and `act()` is React's own test harness.
    testSelectors: [
        'findFiberRoot',
        'getBoundingRect',
        'getTextContent',
        'isHiddenSubtree',
        'matchAccessibilityRole',
        'setFocusIfFocusable',
        'setupIntersectionObserver',
        'supportsTestSelectors',
        'warnsIfNotActing',
    ],
    // `supportsMicrotasks` absent — see the note in `react.ts`: it would add a
    // second scheduling path without removing the first.
    microtasks: ['scheduleMicrotask', 'supportsMicrotasks'],
    // Metadata React reads only to hand to the DevTools hook, which this adapter
    // never installs (`injectIntoDevTools` is not called). Deliberately NOT
    // answered: `rendererVersion` would have to be this package's version as a
    // literal, and a literal version in a source file is a second truth that drifts
    // from `package.json` the first time it is bumped.
    devtools: ['bindToConsole', 'extraDevToolsConfig', 'rendererPackageName', 'rendererVersion'],
    // Read only to name a suspended commit in a DevTools timeline; the commit path
    // itself is answered (`waitForCommitToBeReady` returns `null`, i.e. never).
    suspendedCommitReason: ['getSuspendedCommitReason'],
};

/**
 * Declared here, read only by the DEVELOPMENT bundle — and on 0.33.0 there are none.
 *
 * On 0.29.2 this held four members: `afterActiveInstanceBlur` (deleted in React 19)
 * plus `beforeActiveInstanceBlur`, `getInstanceFromScope` and `prepareScopeUpdate`,
 * which the production bundle did not read. All three are now read in production
 * too, so the list is empty rather than removed: an EMPTY expectation still fails
 * the day a declared member stops being read, which is the direction that catches a
 * misspelling — a wrong name would sit in the config, never be called, and React
 * would read `undefined` for the correct spelling with nothing to show for it.
 */
const DEV_BUNDLE_ONLY: string[] = [];

/** Every member the installed reconciler reads out of a HostConfig. */
function readHostConfigMembers(): string[] {
    const seen = new Set<string>();
    const target = gtkHostConfig as unknown as Record<string, unknown>;
    Reconciler(
        new Proxy(target, {
            get(_t, key) {
                seen.add(String(key));
                return target[key as string];
            },
        }) as never,
    );
    return [...seen].sort();
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();

        // Every root in this suite reports recoverable errors here. React's own
        // default is `reportError`, i.e. a log — so without this a render that
        // React silently retried would leave every assertion passing.
        const recovered: Error[] = [];
        const onRecoverableError = (error: Error) => {
            recovered.push(error);
        };
        const noRecovery = () => {
            const seen = recovered.splice(0, recovered.length).map((e) => e.message);
            if (seen.length > 0) throw new Error(`React reported recoverable error(s): ${seen.join('; ')}`);
        };

        await gated(diagnostics, 'react-reconciler over the GTK host', async () => {
            await it('the installed react-reconciler reads the HostConfig this adapter declares', async () => {
                const read = readHostConfigMembers();
                const declared = Object.keys(gtkHostConfig).sort();

                // The count IS the contract's size, and pinning it is what makes a
                // version bump visible. 94 means the development bundle got in.
                expect(read.length).toBe(READS);

                const unanswered = read.filter((name) => !declared.includes(name));
                // Every family, by iteration rather than by a hand-kept spread list:
                // the spread version silently dropped a family the moment one was
                // added, which turns a widening surface into a passing test.
                const gatedOff = Object.values(GATED_OFF).flat().sort();
                // Both directions: a member React starts asking for that no family
                // claims, and a family entry React stopped asking for.
                expect(unanswered).toStrictEqual(gatedOff);

                // Nothing declared is ignored — a misspelled member name would sit
                // here and never be called, while React read `undefined` for the
                // correct spelling.
                const ignored = declared.filter((name) => !read.includes(name));
                expect(ignored).toStrictEqual(DEV_BUNDLE_ONLY);
                noRecovery();
            });

            await it('runs without a DOM at all', async () => {
                // The build-recipe discriminator, and React is the reason it can
                // break: the DEVELOPMENT react-reconciler reaches for `document`,
                // `HTMLCanvasElement` and `Path2D`, and even the production
                // `scheduler` carries `typeof navigator !== 'undefined' &&
                // navigator.scheduling` — each of which makes `--globals auto`
                // inject a GTK-backed DOM register and pull gi://Gdk, GdkPixbuf,
                // Pango and PangoCairo into this bundle. If either exists here, the
                // production define or `--exclude-globals navigator` was lost.
                const g = globalThis as unknown as Record<string, unknown>;
                expect(typeof g.document).toBe('undefined');
                expect(typeof g.HTMLCanvasElement).toBe('undefined');
                expect(typeof g.Path2D).toBe('undefined');
                // `navigator` cannot be asserted ABSENT: Node ≥21 ships a native
                // one, so on the gjs-on-node leg "defined" is the runtime, not the
                // recipe. What the register would install is a bare `{}` (see
                // @gjsify/dom-elements/register/navigator) — so the honest claim on
                // every runtime is "absent, or the runtime's own", and the runtime's
                // own always carries `userAgent`, which the injected `{}` never does.
                expect(g.navigator === undefined || 'userAgent' in (g.navigator as object)).toBe(true);
            });

            await it('renders a tree into a widget the application owns', async () => {
                const container = new Gtk.Box();
                const root = mount(
                    createElement('GtkBox', null, createElement('GtkLabel', { label: 'hello' })),
                    container,
                    { onRecoverableError },
                );
                expect(gtkChildTypes(container)).toStrictEqual(['GtkBox']);
                expect(labelsOf(gtkChildren(container)[0])).toStrictEqual(['hello']);
                root.unmount();
                noRecovery();
            });

            await it('a state update reaches GTK after the first render', async () => {
                // The reactivity discriminator. A render smoke test passes against
                // a renderer whose commit path works exactly once.
                const container = new Gtk.Box();
                let setText: ((value: string) => void) | null = null;
                const Counter = () => {
                    const [text, set] = useState('first');
                    setText = set;
                    return createElement('GtkLabel', { label: text });
                };
                const root = mount(createElement(Counter), container, { onRecoverableError });
                expect(labelsOf(container)).toStrictEqual(['first']);
                flushSync(() => setText?.('second'));
                expect(labelsOf(container)).toStrictEqual(['second']);
                root.unmount();
                noRecovery();
            });

            await it('an unflushed update lands when the main loop runs — the scheduler works', async () => {
                // The other half of the concurrency story, and the reason
                // `resolveUpdatePriority` returns the DEFAULT lane rather than a
                // discrete one: a `setState` outside `flushSync` is handed to
                // `scheduler`, which under GJS means a GLib timer source. If that
                // path did not work, an app updating state from a signal handler
                // would freeze with no error at all.
                const container = new Gtk.Box();
                let setText: ((value: string) => void) | null = null;
                const Counter = () => {
                    const [text, set] = useState('before');
                    setText = set;
                    return createElement('GtkLabel', { label: text });
                };
                const root = mount(createElement(Counter), container, { onRecoverableError });
                expect(labelsOf(container)).toStrictEqual(['before']);

                setText?.('after'); // no flushSync: default lane, scheduled
                // Not applied yet. This assertion is what makes the pump below a
                // measurement rather than a formality.
                expect(labelsOf(container)).toStrictEqual(['before']);

                const iterations = pumpMainLoop(() => labelsOf(container)[0] === 'after');
                expect(iterations >= 0).toBe(true);
                expect(labelsOf(container)).toStrictEqual(['after']);
                root.unmount();
                noRecovery();
            });

            await it("React clears the container first, and the application's chrome survives", async () => {
                // `updateHostRoot` sets the `Snapshot` flag whenever the previous
                // render produced no child, and `commitBeforeMutationEffects` then
                // calls `clearContainer` on the container — in the DOM to discard
                // leftover markup. Here the container is a widget the application
                // filled, so the naive mapping (clear the GTK container) deletes
                // the app's own chrome. Recorded, because the surviving chrome
                // alone would also be explained by React never calling it.
                const container = new Gtk.Box();
                container.append(new Gtk.Label({ label: 'app-owned' }));
                const root = recordingRoot(container, onRecoverableError);
                root.render(createElement('GtkLabel', { label: 'rendered' }));
                expect(root.calls.includes('clearContainer')).toBe(true);
                expect(labelsOf(container)).toStrictEqual(['app-owned', 'rendered']);
                noRecovery();
            });

            await it('a keyed reorder MOVES the same widgets — no removeChild', async () => {
                // Order alone is satisfied by remove-all-and-re-append, which
                // destroys focus, scroll position and every widget state. Both
                // halves are asserted: the widget objects are the same ones, and
                // React never reached for `removeChild` to get there — which is
                // what licenses `removeChild` mapping to `destroy`.
                const container = new Gtk.Box();
                const root = recordingRoot(container, onRecoverableError);
                const list = (items: readonly string[]) =>
                    createElement(
                        'GtkBox',
                        null,
                        items.map((t) => createElement('GtkLabel', { key: t, label: t })),
                    );
                root.render(list(['a', 'b', 'c']));
                const box = gtkChildren(container)[0];
                expect(labelsOf(box)).toStrictEqual(['a', 'b', 'c']);

                const before = gtkChildren(box);
                root.calls.length = 0;
                root.render(list(['c', 'b', 'a']));
                const after = gtkChildren(box);
                expect(labelsOf(box)).toStrictEqual(['c', 'b', 'a']);
                expect(after.filter((w) => before.includes(w)).length).toBe(before.length);
                expect(root.calls.includes('removeChild')).toBe(false);
                noRecovery();
            });

            await it('a row dropped from the list is torn down, not just detached', async () => {
                const container = new Gtk.Box();
                let setItems: ((items: readonly string[]) => void) | null = null;
                let fired = 0;
                const List = () => {
                    const [items, set] = useState<readonly string[]>(['a', 'b']);
                    setItems = set;
                    return createElement(
                        'GtkBox',
                        null,
                        items.map((t) =>
                            createElement('GtkButton', {
                                key: t,
                                label: t,
                                onClicked: () => {
                                    fired += 1;
                                },
                            }),
                        ),
                    );
                };
                const root = mount(createElement(List), container, { onRecoverableError });
                const box = gtkChildren(container)[0];
                const buttons = gtkChildren(box) as Gtk.Button[];
                expect(buttons.length).toBe(2);
                buttons[0].emit('clicked');
                expect(fired).toBe(1);

                flushSync(() => setItems?.(['b']));
                expect(labelsOf(box)).toStrictEqual(['b']);
                // GJS blocks JS callbacks during GC, so a handler that is not
                // disconnected outlives the tree it belonged to.
                buttons[0].emit('clicked');
                expect(fired).toBe(1);
                root.unmount();
                noRecovery();
            });

            await it('reconciles into a container that can only append', async () => {
                // `Adw.PreferencesGroup` has no `insert()`, so the host rotates its
                // tail. A renderer must not have to know that.
                const container = new Gtk.Box();
                let setRows: ((rows: readonly string[]) => void) | null = null;
                const Group = () => {
                    const [rows, set] = useState<readonly string[]>(['R0', 'R1']);
                    setRows = set;
                    return createElement(
                        'AdwPreferencesGroup',
                        null,
                        rows.map((t) => createElement('AdwActionRow', { key: t, title: t })),
                    );
                };
                const root = mount(createElement(Group), container, { onRecoverableError });
                expect(titlesOf(container)).toStrictEqual(['R0', 'R1']);
                flushSync(() => setRows?.(['R1', 'R0']));
                expect(titlesOf(container)).toStrictEqual(['R1', 'R0']);
                root.unmount();
                noRecovery();
            });

            await it('a branch that renders nothing does not shift its siblings', async () => {
                // React needs no comment anchor — `{cond && …}` produces no host
                // node at all — so this is the case where a renderer that tracked
                // positions in the GTK tree instead of its own would still be
                // right. It is here because the NEXT reconciliation is not: the
                // middle child comes back and has to land between the two.
                const container = new Gtk.Box();
                let setShow: ((show: boolean) => void) | null = null;
                const Toggle = () => {
                    const [show, set] = useState(false);
                    setShow = set;
                    return createElement(
                        'GtkBox',
                        null,
                        createElement('GtkLabel', { key: 'head', label: 'head' }),
                        show ? createElement('GtkLabel', { key: 'mid', label: 'mid' }) : null,
                        createElement('GtkLabel', { key: 'foot', label: 'foot' }),
                    );
                };
                const root = mount(createElement(Toggle), container, { onRecoverableError });
                const box = gtkChildren(container)[0];
                expect(labelsOf(box)).toStrictEqual(['head', 'foot']);
                flushSync(() => setShow?.(true));
                expect(labelsOf(box)).toStrictEqual(['head', 'mid', 'foot']);
                flushSync(() => setShow?.(false));
                expect(labelsOf(box)).toStrictEqual(['head', 'foot']);
                root.unmount();
                noRecovery();
            });

            await it('a prop that disappears is reset, not set to null', async () => {
                // React's `prepareUpdate` diff has to spell a removed key
                // `undefined`: the host reads that as "back to what construction
                // leaves behind", while `null` reaches `set_property` verbatim.
                const container = new Gtk.Box();
                let setLabelled: ((on: boolean) => void) | null = null;
                const Maybe = () => {
                    const [labelled, set] = useState(true);
                    setLabelled = set;
                    return createElement('GtkLabel', labelled ? { label: 'here' } : {});
                };
                const root = mount(createElement(Maybe), container, { onRecoverableError });
                expect(labelsOf(container)).toStrictEqual(['here']);
                flushSync(() => setLabelled?.(false));
                expect(labelsOf(container)).toStrictEqual(['']);
                root.unmount();
                noRecovery();
            });

            await it('a text child reaches the parent text sink, and an update follows', async () => {
                const container = new Gtk.Box();
                let setText: ((value: string) => void) | null = null;
                const Titled = () => {
                    const [text, set] = useState('one');
                    setText = set;
                    return createElement('GtkLabel', null, text);
                };
                const root = mount(createElement(Titled), container, { onRecoverableError });
                expect(labelsOf(container)).toStrictEqual(['one']);
                flushSync(() => setText?.('two'));
                expect(labelsOf(container)).toStrictEqual(['two']);
                root.unmount();
                noRecovery();
            });

            await it('a signal bound through the adapter fires, and unmount stops it', async () => {
                const container = new Gtk.Box();
                let clicks = 0;
                const root = mount(
                    createElement('GtkButton', {
                        label: 'go',
                        onClicked: () => {
                            clicks += 1;
                        },
                    }),
                    container,
                    { onRecoverableError },
                );
                const button = gtkChildren(container)[0] as Gtk.Button;
                button.emit('clicked');
                expect(clicks).toBe(1);
                root.unmount();
                button.emit('clicked');
                expect(clicks).toBe(1);
                noRecovery();
            });

            await it("a ref receives the author's widget, never the host's wrapper row", async () => {
                // `Gtk.ListBox` addresses a `GtkListBoxRow`, which the host creates.
                // Handing that row to a `ref` would give the author a widget they
                // never wrote and whose `label` write does nothing.
                const container = new Gtk.Box();
                const held: Gtk.Widget[] = [];
                const root = mount(
                    createElement(
                        'GtkListBox',
                        null,
                        createElement('GtkButton', {
                            label: 'inside',
                            ref: (widget: Gtk.Widget) => {
                                if (widget) held.push(widget);
                            },
                        }),
                    ),
                    container,
                    { onRecoverableError },
                );
                expect(held.length).toBe(1);
                expect(held[0] instanceof Gtk.Button).toBe(true);
                // …and the row really is in between, so the ref skipped it.
                expect(held[0].get_parent() instanceof Gtk.ListBoxRow).toBe(true);
                root.unmount();
                noRecovery();
            });

            await it('hideInstance and hideTextInstance are exercised directly', async () => {
                // `<Suspense>`'s ops. Driving a real suspense boundary needs a
                // thrown promise and a scheduler round trip, which the vector above
                // already proves works; what is NOT proved anywhere else is that
                // these two do the right thing to a GTK widget and to a text run.
                // A text run owns no widget, so hiding one means emptying its
                // contribution to the parent's sink.
                const container = new Gtk.Box();
                const root = mount(createElement('GtkLabel', null, 'visible'), container, { onRecoverableError });
                const element = firstChild(root.container) as HostElement;
                const widget = widgetOf(element);
                expect(widget.visible).toBe(true);

                gtkHostConfig.hideInstance(element);
                expect(widget.visible).toBe(false);
                gtkHostConfig.unhideInstance(element);
                expect(widget.visible).toBe(true);

                const text = firstChild(element) as HostText;
                expect((widget as Gtk.Label).label).toBe('visible');
                gtkHostConfig.hideTextInstance(text);
                expect((widget as Gtk.Label).label).toBe('');
                gtkHostConfig.unhideTextInstance(text, 'visible');
                expect((widget as Gtk.Label).label).toBe('visible');
                root.unmount();
                noRecovery();
            });

            await it("React's own automatic JSX runtime renders through this adapter", async () => {
                // `./react/jsx-runtime` re-exports React's `jsx()`, which builds a
                // plain React element — renderer-agnostic by construction, which is
                // exactly why the automatic runtime is right for React and wrong for
                // Solid. The type surface it also carries is what keeps `<div/>` from
                // type-checking; this is the RUNTIME half.
                const container = new Gtk.Box();
                // KEBAB, and that is the surface's own rule rather than a taste:
                // `WidgetPropsByTag` is kebab-keyed because a capitalised
                // `JSX.IntrinsicElements` key is never consulted (ADR 0028 § 7).
                // The registry accepts both spellings, so this also exercises the
                // alias path.
                const root = mount(reactJsx('gtk-label', { label: 'from jsx()' }) as ReactNode, container, {
                    onRecoverableError,
                });
                expect(labelsOf(container)).toStrictEqual(['from jsx()']);
                root.unmount();
                noRecovery();
            });

            await it('the OTHER jsx-runtime still refuses, on purpose', async () => {
                // `./jsx-runtime` is a TYPE surface for Solid and Vue and its
                // `jsx()` throws by design — adding React's runtime as a sibling
                // must not soften that, or a misconfigured Solid pipeline renders
                // an empty window instead of failing.
                let error: Error | undefined;
                try {
                    refusedJsx();
                } catch (e) {
                    error = e as Error;
                }
                expect(error === undefined).toBe(false);
                expect(String(error?.message)).toContain('is a TYPE surface, not an automatic JSX runtime');
            });

            await it('a second root mounts into its own container', async () => {
                // `createRoot` adopts per call, so two roots over two containers do
                // not share a shadow tree — and the reconciler is one module-level
                // instance both go through.
                const left = new Gtk.Box();
                const right = new Gtk.Box();
                const a = createRoot(left, { onRecoverableError });
                const b = createRoot(right, { onRecoverableError });
                a.render(createElement('GtkLabel', { label: 'left' }));
                b.render(createElement('GtkLabel', { label: 'right' }));
                expect(labelsOf(left)).toStrictEqual(['left']);
                expect(labelsOf(right)).toStrictEqual(['right']);
                a.unmount();
                expect(labelsOf(left)).toStrictEqual([]);
                expect(labelsOf(right)).toStrictEqual(['right']);
                b.unmount();
                noRecovery();
            });

            await it('widgetOf refuses a text node and a destroyed element', async () => {
                const container = new Gtk.Box();
                const root = mount(createElement('GtkLabel', null, 'gone'), container, { onRecoverableError });
                const element = firstChild(root.container) as HostElement;
                const text = firstChild(element) as HostNode;
                let textError: Error | undefined;
                try {
                    widgetOf(text);
                } catch (e) {
                    textError = e as Error;
                }
                expect(String(textError?.message)).toContain('Only an element node owns a widget');

                root.unmount();
                let deadError: Error | undefined;
                try {
                    widgetOf(element);
                } catch (e) {
                    deadError = e as Error;
                }
                expect(String(deadError?.message)).toContain('destroyed');
                noRecovery();
            });
        });

        await runAdapterVectors(reactVectors, diagnostics);
    });
};
