// The router against the GTK that is installed, and against a real reconciler.
//
// `routes.spec.ts` proves the conventions resolve the way they say they do. It cannot
// prove that `push_by_tag`, `pop_to_tag`, `replace_with_tags`, `popped` and
// `notify::visible-child-name` are real, that `Adw.NavigationPage` can hold a screen,
// or that the two stacks end up agreeing — a misspelled method resolves perfectly and
// fails in a consumer's window, and GTK's answer to a wrong call is nothing at all.
// So this file asks the typelib and then RENDERS, and every vector asserts ZERO GTK
// diagnostics, because GTK's failure mode is exit 0.
//
// THREE LEVELS, on purpose. The classification (behaviour 1), the closing-page
// bookkeeping (behaviour 3) and the coalescer (behaviour 2) are exercised DIRECTLY as
// the functions they are — that is where their edge cases live, and a mounted tree can
// only show one path through each. The mounted vectors then prove the wiring: that
// those functions are reached, from the right places, with the right inputs.
//
// `gated` is a local six-liner rather than an import, for the reason `widgets.spec.ts`
// records: `@gjsify/unit` keeps ONE `beforeEach`/`afterEach` slot per module and nulls
// both when a `describe` returns, so hooks registered before the first of several
// siblings leave every later one ungated — measured, a GTK critical injected into
// describe #15 printed to stderr, the case still reported a tick, and the blame
// surfaced twelve tests later on an innocent neighbour.
//
// CORRECTED 2026-09-04 (#1554): the runner no longer works that way. Hooks are
// SCOPED — one frame per `describe`, popped when it returns — so a nested block
// inherits its parents' hooks, a second registration in one scope composes with
// the first rather than replacing it, and a sibling cannot unhook a neighbour.
// The incident above is kept because it is why the helper exists; what the helper
// buys now is one DECLARATION of what a gated block means, not a workaround.

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { lookupWidget, registerBuiltinWidgets } from '@gjsify/gtk-host';
import {
    descriptorProblems,
    dumpTree,
    gtkChildren,
    installDiagnosticsGate,
    windowChromeCensus,
    windowChromeProblems,
} from '@gjsify/gtk-host/conformance';
import { createRoot } from '@gjsify/gtk-host/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import type { NavigationState } from '@react-navigation/core';
import type Adw from '@girs/adw-1';

import { RouterError } from './errors.js';
import { navigationRef, router, uninstallRouter, useLocalSearchParams, usePathname } from './navigation.js';
import { RouterRoot } from './root.js';
import type { RouteManifest } from './routes.js';
import { perRouteCacheEntries } from './per-route-cache.js';
import { Stack } from './stack.js';
import { advanceTracking, applyStack, coalesce, initialTracking, releaseFrom, type Tracking } from './stack.js';
import { showFocusedPage, Tabs } from './tabs.js';
import { buildWindowShell, provideWindowChrome } from '../window-chrome.js';

/** Named identities, not a capability: a probe that answers "no" stands the suite DOWN, and a suite that ran zero tests reports success. */
const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

// ---------------------------------------------------------------------------
// Readers over the REAL widget tree
// ---------------------------------------------------------------------------

const typeOf = (widget: Gtk.Widget): string =>
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

/** First strict descendant of a GType, breadth-first over the real tree. */
function find(root: Gtk.Widget, gtype: string): Gtk.Widget {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === gtype) return widget;
        queue.push(...gtkChildren(widget));
    }
    throw new Error(`no ${gtype} under:\n${dumpTree(root)}`);
}

const maybeFind = (root: Gtk.Widget, gtype: string): Gtk.Widget | null => {
    try {
        return find(root, gtype);
    } catch {
        return null;
    }
};

/** The navigation stack, as page TITLES — the readable half of the join key. */
function stackTitles(view: Adw.NavigationView): readonly string[] {
    const model = view.get_navigation_stack();
    const titles: string[] = [];
    for (let index = 0; index < model.get_n_items(); index++) {
        titles.push((model.get_item(index) as Adw.NavigationPage).get_title());
    }
    return titles;
}

const tagsOf = (view: Adw.NavigationView): readonly string[] => {
    const model = view.get_navigation_stack();
    const tags: string[] = [];
    for (let index = 0; index < model.get_n_items(); index++) {
        tags.push((model.get_item(index) as Adw.NavigationPage).get_tag() ?? '(untagged)');
    }
    return tags;
};

/**
 * Is a page with this tag still in the view — pooled or in the stack?
 *
 * `find_page` and NOT a child count: MEASURED, `gtkChildren` on an
 * `Adw.NavigationView` counts its internal widgets too (six of them for a two-page
 * view), so a count is both opaque and wrong. `find_page` answers about the tag, which
 * is the route key, which is the thing the bookkeeping holds — and MEASURED, it finds a
 * page that was `add`ed and never pushed, and answers null once it is `remove`d.
 */
const hasPage = (view: Adw.NavigationView, tag: string): boolean => view.find_page(tag) !== null;

/**
 * Pump the GLib main context until `done`, then say how many turns it took.
 *
 * `-1` for "never", so a scheduler that does not run FAILS a vector rather than
 * hanging one. `await` inside the loop as well as an iteration, because two different
 * queues have to drain: React's default-lane work reaches `scheduler`, which gjsify
 * backs with a GLib timer source, while this layer's `popped` coalescer is a promise
 * job. An application has `Gtk.Application.run` for both; a spec has this.
 *
 * A `setState` from a GTK signal handler is CONCURRENT under this host
 * (`resolveUpdatePriority` answers the default lane — there is no ambient DOM event to
 * read), which is exactly why these vectors drive the scheduled path rather than
 * reaching for `flushSync`: the scheduled path is the one an application takes.
 */
async function settle(done: () => boolean, budget = 200): Promise<number> {
    const context = GLib.MainContext.default();
    for (let turn = 0; turn < budget; turn++) {
        if (done()) return turn;
        context.iteration(false);
        await Promise.resolve();
    }
    return done() ? budget : -1;
}

// ---------------------------------------------------------------------------
// The fixture application
// ---------------------------------------------------------------------------

/** What the screens saw, so a hook's answer can be asserted from outside. */
const observed: { params: Partial<Record<string, string>>; pathname: string } = { params: {}, pathname: '' };

/**
 * The root navigation state, or a throw.
 *
 * `getRootState()` is typed as possibly undefined because a container that has not
 * mounted has none. Every caller here has mounted one, so the narrowing belongs in one
 * place — and if it ever IS undefined, a named throw beats seven `!`s hiding it.
 */
function rootState(): NavigationState {
    const state = navigationRef.getRootState() as NavigationState | undefined;
    if (state === undefined) throw new Error('the navigation container reported no root state');
    return state;
}

const label = (text: string): ReactElement => createElement('GtkLabel', { label: text });

function Home(): ReactElement {
    observed.pathname = usePathname();
    return label('home');
}
function Detail(): ReactElement {
    observed.params = useLocalSearchParams();
    observed.pathname = usePathname();
    return label('detail');
}
function Missing(): ReactElement {
    observed.pathname = usePathname();
    return label('missing');
}
function TabOne(): ReactElement {
    observed.pathname = usePathname();
    return label('one');
}
function TabTwo(): ReactElement {
    observed.pathname = usePathname();
    return label('two');
}

const TAB_NAMES = ['t0', 't1', 't2', 't3', 't4'] as const;

function PlainTab(): ReactElement {
    observed.pathname = usePathname();
    return label('tab');
}

/**
 * Every action the container is asked to perform, while `run` runs.
 *
 * `__unsafe_action__` is React Navigation's own devtools channel and the only seam
 * that sees a dispatch made from a GTK signal handler DURING a commit. A listener a
 * screen registers cannot: `tabPress` is emitted before the tree's passive effects
 * have run, so a counter inside a tab reports 0 for a press it was never subscribed
 * in time to hear — measured, and it is why this vector watches the container.
 */
async function actionsDuring(run: () => Promise<void>): Promise<string[]> {
    const seen: string[] = [];
    const stop = (
        navigationRef as unknown as {
            addListener(type: string, listener: (event: { data: { action: { type: string } } }) => void): () => void;
        }
    ).addListener('__unsafe_action__', (event) => seen.push(event.data.action.type));
    try {
        await run();
    } finally {
        stop();
    }
    return seen;
}

/** The root stack's screens, so the two root layouts below cannot drift apart. */
const rootScreens = (): ReactElement[] => [
    createElement(Stack.Screen, { key: 'i', name: 'index', options: { title: 'Home' } }),
    createElement(Stack.Screen, { key: 'd', name: 'detail/[id]', options: { title: 'Detail' } }),
    // NO `headerShown: false` on the group, which is what it took before #1460: the tab
    // level built its own header bar, so the page's had to be suppressed by hand or the
    // window drew two. The switcher now goes into THIS page's bar.
    createElement(Stack.Screen, { key: 't', name: '(tabs)', options: { title: 'Tabs' } }),
    createElement(Stack.Screen, { key: 'n', name: '+not-found', options: { title: 'Missing' } }),
];

function RootLayout(): ReactElement {
    return createElement(Stack, null, ...rootScreens());
}

/**
 * The same application with transitions OFF, for the chrome vectors.
 *
 * NOT for speed, and the reason is the invariant's own shape: `Adw.NavigationView`
 * deliberately keeps the DEPARTING page mapped while the arriving one slides in, so a
 * window mid-push legitimately draws two header bars — measured, 4 mapped bars and 4
 * close buttons at the moment a tab group is entered. The rule is about the RESTING
 * composition, and `settle()` iterates the main context without advancing the clock,
 * so it cannot wait an animation out.
 */
function StillRootLayout(): ReactElement {
    return createElement(Stack, { screenOptions: { animation: 'none' } }, ...rootScreens());
}
function TabsLayout(): ReactElement {
    return createElement(
        Tabs,
        null,
        createElement(Tabs.Screen, { key: '1', name: 'one', options: { title: 'One', iconName: 'go-home-symbolic' } }),
        createElement(Tabs.Screen, {
            key: '2',
            name: 'two',
            options: { title: 'Two', iconName: 'view-grid-symbolic' },
        }),
    );
}

const APP: RouteManifest = [
    { contextKey: '_layout.tsx', module: { default: RootLayout } },
    { contextKey: 'index.tsx', module: { default: Home } },
    { contextKey: 'detail/[id].tsx', module: { default: Detail } },
    { contextKey: '(tabs)/_layout.tsx', module: { default: TabsLayout } },
    { contextKey: '(tabs)/one.tsx', module: { default: TabOne } },
    { contextKey: '(tabs)/two.tsx', module: { default: TabTwo } },
    { contextKey: '+not-found.tsx', module: { default: Missing } },
];

/**
 * The one place a mount happens, so nothing forgets to tear its root down.
 *
 * `uninstallRouter()` in the `finally` as well as the unmount: `router` is a
 * module-level singleton that refuses a second binding BY NAME, so one vector that
 * left it bound would fail the next one for a defect it does not have. The unmount is
 * what releases it in an application, and the vector below asserts that it does — this
 * belt is for the vectors that throw on purpose.
 */
async function mounted(element: ReactNode, body: (container: Gtk.Box) => void | Promise<void>): Promise<void> {
    const container = new Gtk.Box();
    const root = createRoot(container);
    try {
        root.render(element);
        await body(container);
    } finally {
        try {
            root.unmount();
        } finally {
            uninstallRouter();
        }
    }
}

/** `APP` with `StillRootLayout` in place of the root layout. */
const STILL: RouteManifest = APP.map((entry) =>
    entry.contextKey === '_layout.tsx' ? { contextKey: '_layout.tsx', module: { default: StillRootLayout } } : entry,
);

const app = (manifest: RouteManifest = APP): ReactElement => createElement(RouterRoot, { manifest });

/** Root layout for an application whose TOP level is the tab navigator. */
function TabsRootLayout(): ReactElement {
    return createElement(
        Tabs,
        null,
        createElement(Tabs.Screen, { key: '1', name: 'one', options: { title: 'One' } }),
        createElement(Tabs.Screen, { key: '2', name: 'two', options: { title: 'Two' } }),
    );
}
/** A `_layout` inside a tab: the nesting where the inner level needs its own bars. */
function InnerStackLayout(): ReactElement {
    return createElement(
        Stack,
        null,
        createElement(Stack.Screen, { key: 'd', name: 'detail', options: { title: 'Inner' } }),
    );
}

const TABS_ROOT: RouteManifest = [
    { contextKey: '_layout.tsx', module: { default: TabsRootLayout } },
    { contextKey: 'one.tsx', module: { default: TabOne } },
    { contextKey: 'two.tsx', module: { default: TabTwo } },
];

/** Tabs at the top, a stack inside the second tab — the other nesting order. */
const STACK_IN_TABS: RouteManifest = [
    {
        contextKey: '_layout.tsx',
        module: {
            default: (): ReactElement =>
                createElement(
                    Tabs,
                    null,
                    createElement(Tabs.Screen, { key: '1', name: 'one', options: { title: 'One' } }),
                    createElement(Tabs.Screen, { key: 'd', name: '(deep)', options: { title: 'Deep' } }),
                ),
        },
    },
    { contextKey: 'one.tsx', module: { default: TabOne } },
    { contextKey: '(deep)/_layout.tsx', module: { default: InnerStackLayout } },
    { contextKey: '(deep)/detail.tsx', module: { default: Home } },
];

/**
 * Five tabs with real labels, because the narrow threshold is MEASURED off them.
 *
 * Two short tabs fit in any window an `Adw.Window` will even open — its own minimum
 * is wider than their switcher — so a manifest that small cannot be made narrow and
 * proves nothing about a layout that reacts to width.
 */
const WIDE_TABS: RouteManifest = [
    {
        contextKey: '_layout.tsx',
        module: {
            default: (): ReactElement =>
                createElement(
                    Tabs,
                    null,
                    createElement(Tabs.Screen, { key: '1', name: 'one', options: { title: 'Startseite' } }),
                    createElement(Tabs.Screen, { key: '2', name: 'two', options: { title: 'Entdecken' } }),
                    createElement(Tabs.Screen, { key: '3', name: 'three', options: { title: 'Mediathek' } }),
                    createElement(Tabs.Screen, { key: '4', name: 'four', options: { title: 'Mitmachen' } }),
                    createElement(Tabs.Screen, { key: '5', name: 'five', options: { title: 'Profil' } }),
                ),
        },
    },
    { contextKey: 'one.tsx', module: { default: TabOne } },
    { contextKey: 'two.tsx', module: { default: TabTwo } },
    { contextKey: 'three.tsx', module: { default: TabOne } },
    { contextKey: 'four.tsx', module: { default: TabTwo } },
    { contextKey: 'five.tsx', module: { default: TabOne } },
];

/** A root navigator that renders NO bar: the window must keep its own. */
const BARLESS_ROOT: RouteManifest = [
    {
        contextKey: '_layout.tsx',
        module: {
            default: (): ReactElement =>
                createElement(
                    Tabs,
                    { headerShown: false },
                    createElement(Tabs.Screen, { key: '1', name: 'one', options: { title: 'One' } }),
                    createElement(Tabs.Screen, { key: 'd', name: '(deep)', options: { title: 'Deep' } }),
                ),
        },
    },
    { contextKey: 'one.tsx', module: { default: TabOne } },
    { contextKey: '(deep)/_layout.tsx', module: { default: InnerStackLayout } },
    { contextKey: '(deep)/detail.tsx', module: { default: Home } },
];

/** The same, with nothing below that could accidentally supply the chrome. */
const BARLESS_PLAIN: RouteManifest = [
    {
        contextKey: '_layout.tsx',
        module: {
            default: (): ReactElement =>
                createElement(
                    Tabs,
                    { headerShown: false },
                    createElement(Tabs.Screen, { key: '1', name: 'one', options: { title: 'One' } }),
                    createElement(Tabs.Screen, { key: '2', name: 'two', options: { title: 'Two' } }),
                ),
        },
    },
    { contextKey: 'one.tsx', module: { default: TabOne } },
    { contextKey: 'two.tsx', module: { default: TabTwo } },
];

/** A `headerShown: false` screen pushed ON TOP of a bar-ful one — a full-bleed reader. */
const BARE_ON_TOP: RouteManifest = [
    {
        contextKey: '_layout.tsx',
        module: {
            default: (): ReactElement =>
                createElement(
                    Stack,
                    { screenOptions: { animation: 'none' } },
                    createElement(Stack.Screen, { key: 'i', name: 'index', options: { title: 'Home' } }),
                    createElement(Stack.Screen, {
                        key: 'b',
                        name: 'bare',
                        options: { title: 'Bare', headerShown: false },
                    }),
                ),
        },
    },
    { contextKey: 'index.tsx', module: { default: Home } },
    { contextKey: 'bare.tsx', module: { default: TabOne } },
];

/**
 * Five tabs in a `(tabs)` group under the root stack — the shape #1453 was reported on.
 *
 * FIVE and not two, because the count is what makes the entry route differ from the
 * page libadwaita picks by itself: with two tabs the lagging container state named the
 * tab the URL asked for anyway, and the spurious dispatch was invisible.
 */
const FIVE_TABS: RouteManifest = [
    {
        contextKey: '_layout.tsx',
        module: {
            default: (): ReactElement =>
                createElement(
                    Stack,
                    { screenOptions: { animation: 'none' } },
                    createElement(Stack.Screen, { key: 'i', name: 'index', options: { title: 'Home' } }),
                    createElement(Stack.Screen, { key: 't', name: '(tabs)', options: { title: 'Tabs' } }),
                ),
        },
    },
    { contextKey: 'index.tsx', module: { default: Home } },
    {
        contextKey: '(tabs)/_layout.tsx',
        module: {
            default: (): ReactElement =>
                createElement(
                    Tabs,
                    null,
                    ...TAB_NAMES.map((name) =>
                        createElement(Tabs.Screen, { key: name, name, options: { title: name.toUpperCase() } }),
                    ),
                ),
        },
    },
    ...TAB_NAMES.map((name) => ({ contextKey: `(tabs)/${name}.tsx`, module: { default: PlainTab } })),
];

/** The old workaround, kept as a supported shape: no page bar to contribute to. */
const HEADER_HIDDEN: RouteManifest = [
    {
        contextKey: '_layout.tsx',
        module: {
            default: (): ReactElement =>
                createElement(
                    Stack,
                    { screenOptions: { animation: 'none' } },
                    createElement(Stack.Screen, { key: 'i', name: 'index', options: { title: 'Home' } }),
                    createElement(Stack.Screen, {
                        key: 't',
                        name: '(tabs)',
                        options: { title: 'Tabs', headerShown: false },
                    }),
                ),
        },
    },
    { contextKey: 'index.tsx', module: { default: Home } },
    { contextKey: '(tabs)/_layout.tsx', module: { default: TabsLayout } },
    { contextKey: '(tabs)/one.tsx', module: { default: TabOne } },
    { contextKey: '(tabs)/two.tsx', module: { default: TabTwo } },
];

/**
 * Mount in a PRESENTED window built the way `AppRegistry` builds one.
 *
 * PRESENTED, because the only honest reading of "how many close buttons does the user
 * see" is over MAPPED widgets: an unmapped tree answers 0 to every count, and a pooled
 * `Adw.NavigationPage` is `visible` without being on screen. `windowChromeProblems`
 * refuses an unmapped root for exactly that reason.
 *
 * THE SHELL COMES FROM THE SHIPPING CODE (`buildWindowShell`), not from four lines
 * here: a vector that rebuilt the window by hand would stay green while the window an
 * application actually gets drifted away from it.
 *
 * The readiness predicate is React's OWN header bar under the content, never the
 * census: before the chrome rule existed the window's bar alone made every count
 * non-zero, so a census-based wait would have measured the shell and not the router.
 */
async function windowed(
    element: ReactNode,
    body: (window: Adw.Window, container: Gtk.Widget) => void | Promise<void>,
    manifestReady: (container: Gtk.Widget) => boolean = (container) => maybeFind(container, 'AdwHeaderBar') !== null,
    // Set BEFORE `present`, because that is the only size a window reliably takes: a
    // `set_default_size` on a window the compositor has already mapped is a request it
    // is free to ignore, and a test that resized after presenting measured nothing.
    size: readonly [number, number] = [900, 700],
): Promise<void> {
    const shell = buildWindowShell();
    const AdwWindow = lookupWidget('AdwWindow').ctor() as unknown as new () => Adw.Window;
    const window = new AdwWindow();
    window.set_default_size(size[0], size[1]);
    window.set_content(shell.root);
    const root = createRoot(shell.content);
    try {
        root.render(provideWindowChrome(shell.chrome, element));
        window.present();
        expect((await settle(() => manifestReady(shell.content))) >= 0).toBe(true);
        await body(window, shell.content);
    } finally {
        try {
            root.unmount();
        } finally {
            try {
                uninstallRouter();
            } finally {
                window.destroy();
            }
        }
    }
}

/** The code a call refuses with, or `null` when it did not refuse. */
function refusal(run: () => unknown): string | null {
    try {
        run();
        return null;
    } catch (error) {
        if (error instanceof RouterError) return error.code;
        // `createRoot` rethrows what React caught, so a refusal from inside a render
        // arrives wrapped in nothing but still as the same instance.
        throw error;
    }
}

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();
        const gated = (name: string, run: () => Promise<void>): Promise<void> =>
            describe(name, async () => {
                beforeEach(() => diagnostics.reset());
                afterEach(() => diagnostics.assertQuiet());
                await run();
            }) as Promise<void>;

        await gated('the widget table the router depends on', async () => {
            await it('has a CURATED placement rule for all four tags the router names', async () => {
                // Measured the hard way: before these rules existed, rendering a
                // screen into an `AdwNavigationPage` raised the host's own
                // uncurated-placement refusal — correct, and useless to a layer that
                // has to put a screen inside a page.
                for (const [gtype, kind] of [
                    ['AdwNavigationView', 'keyed'],
                    ['AdwNavigationPage', 'single'],
                    ['AdwViewStack', 'keyed'],
                    ['AdwToolbarView', 'slotted'],
                ] as const) {
                    expect(lookupWidget(gtype).children.kind).toBe(kind);
                }
            });

            await it('names only methods the installed GTK has', async () => {
                expect(descriptorProblems()).toStrictEqual([]);
            });

            await it('emits `popped` on the view and `hidden` on the page', async () => {
                const view = lookupWidget('AdwNavigationView').ctor() as unknown as { $gtype: GObject.GType };
                const page = lookupWidget('AdwNavigationPage').ctor() as unknown as { $gtype: GObject.GType };
                expect(GObject.signal_lookup('popped', view.$gtype) !== 0).toBe(true);
                expect(GObject.signal_lookup('hidden', page.$gtype) !== 0).toBe(true);
                // The tab side is a PROPERTY notification, not a signal of its own —
                // which is why `tabs.ts` binds `notify::visible-child-name` and why a
                // check that enumerated the class's own signal ids would find nothing.
                const stack = lookupWidget('AdwViewStack').ctor() as unknown as { $gtype: GObject.GType };
                expect(GObject.signal_lookup('notify', stack.$gtype) !== 0).toBe(true);
            });

            await it('really EMITS `hidden` when a page leaves the stack, detached and all', async () => {
                // Existence is not emission, and this is the signal behaviour 3's first
                // release path is built on. MEASURED here rather than assumed: GTK
                // drives shown/hidden off the NAVIGATION STACK, not off mapping, so the
                // signal fires on a view that is in no window — which is why the
                // `hidden` path is a real path and not a window-only one.
                const View = lookupWidget('AdwNavigationView').ctor() as unknown as new () => Adw.NavigationView;
                const Page = lookupWidget('AdwNavigationPage').ctor() as unknown as new () => Adw.NavigationPage;
                const view = new View();
                view.set_animate_transitions(false);
                const hidden: string[] = [];
                for (const tag of ['a', 'b']) {
                    const page = new Page();
                    page.set_tag(tag);
                    page.set_child(new Gtk.Label({ label: tag }));
                    page.connect('hidden', () => hidden.push(tag));
                    view.add(page);
                }
                view.replace_with_tags(['a', 'b']);
                view.pop();
                expect(hidden).toStrictEqual(['a', 'b']);
                // And the page it popped is still IN the view — pooled, not destroyed —
                // which is what makes "stays mounted until GTK is done" expressible at
                // all: React keeps rendering it and the widget keeps holding it.
                expect(view.find_page('b') !== null).toBe(true);
            });
        });

        // -------------------------------------------------------------------
        // Behaviour 1, directly: the classification against a real widget
        // -------------------------------------------------------------------

        await gated('behaviour 1 — the stack diff is classified', async () => {
            const build = (tags: readonly string[]): Adw.NavigationView => {
                const View = lookupWidget('AdwNavigationView').ctor() as unknown as new () => Adw.NavigationView;
                const Page = lookupWidget('AdwNavigationPage').ctor() as unknown as new () => Adw.NavigationPage;
                const view = new View();
                view.set_animate_transitions(false);
                for (const tag of tags) {
                    const page = new Page();
                    page.set_tag(tag);
                    page.set_title(tag);
                    page.set_child(new Gtk.Label({ label: tag }));
                    view.add(page);
                }
                view.replace_with_tags([...tags]);
                return view;
            };
            const always = () => true;

            await it('MEASURES the premise: `add` pools pages, only the first is the stack', async () => {
                // This is the fact the whole design rests on. If a future libadwaita
                // made `add` push, the classification would still be correct and the
                // header's justification for it would be wrong — so it is asserted.
                const View = lookupWidget('AdwNavigationView').ctor() as unknown as new () => Adw.NavigationView;
                const Page = lookupWidget('AdwNavigationPage').ctor() as unknown as new () => Adw.NavigationPage;
                const view = new View();
                for (const tag of ['a', 'b', 'c']) {
                    const page = new Page();
                    page.set_tag(tag);
                    page.set_child(new Gtk.Label({ label: tag }));
                    view.add(page);
                }
                expect(view.get_navigation_stack().get_n_items()).toBe(1);
            });

            await it('pops when the desired stack is a strict prefix of the current one', async () => {
                const view = build(['a', 'b', 'c']);
                expect(applyStack(view, ['a', 'b', 'c'], ['a'], always)).toBe('pop');
                expect(tagsOf(view)).toStrictEqual(['a']);
            });

            await it('pushes the last tag when the current stack is a strict prefix', async () => {
                const view = build(['a', 'b', 'c']);
                applyStack(view, ['a', 'b', 'c'], ['a'], always);
                expect(applyStack(view, ['a'], ['a', 'b'], always)).toBe('push');
                expect(tagsOf(view)).toStrictEqual(['a', 'b']);
            });

            await it('replaces wholesale when neither is a prefix of the other', async () => {
                const view = build(['a', 'b', 'c']);
                expect(applyStack(view, ['a', 'b', 'c'], ['c', 'a'], always)).toBe('replace');
                expect(tagsOf(view)).toStrictEqual(['c', 'a']);
            });

            await it('does NOTHING when the two agree, which is most renders', async () => {
                const view = build(['a', 'b']);
                expect(applyStack(view, ['a', 'b'], ['a', 'b'], always)).toBe('none');
                expect(tagsOf(view)).toStrictEqual(['a', 'b']);
            });

            await it('sets the base before pushing when the push is not from the current top', async () => {
                // The mixed case: the top changed AND grew. Classified as a push
                // because the current stack is still a prefix of the desired one, and
                // the base is set first so the transition starts from the right page.
                const view = build(['a', 'b', 'c']);
                applyStack(view, ['a', 'b', 'c'], ['a'], always);
                expect(applyStack(view, ['a'], ['a', 'c', 'b'], always)).toBe('push');
                expect(tagsOf(view)).toStrictEqual(['a', 'c', 'b']);
            });

            await it('asks about the MOVING page, departing for a pop and arriving for a push', async () => {
                const view = build(['a', 'b']);
                const asked: (string | undefined)[] = [];
                const record = (key: string | undefined) => {
                    asked.push(key);
                    return true;
                };
                applyStack(view, ['a', 'b'], ['a'], record);
                applyStack(view, ['a'], ['a', 'b'], record);
                expect(asked).toStrictEqual(['b', 'b']);
            });

            await it('MEASURES that a replace emits no `popped`, so the sync cannot echo', async () => {
                // The reason there is no echo guard anywhere in this layer. If
                // `replace_with_tags` ever started emitting, the bridge would re-enter
                // on every sync and this vector is what would say so.
                const view = build(['a', 'b', 'c']);
                let emissions = 0;
                view.connect('popped', () => {
                    emissions++;
                });
                applyStack(view, ['a', 'b', 'c'], ['c', 'a'], always);
                expect(emissions).toBe(0);
            });

            await it('MEASURES that pop_to_tag emits once PER PAGE with the stack already final', async () => {
                // Behaviour 2's whole justification, asserted rather than asserted-in-
                // a-comment: two emissions, and both of them see the FINAL stack — so
                // an undebounced handler computes the same delta twice.
                const view = build(['a', 'b', 'c', 'd']);
                const seen: string[][] = [];
                view.connect('popped', () => {
                    seen.push([...tagsOf(view)]);
                });
                applyStack(view, ['a', 'b', 'c', 'd'], ['a', 'b'], always);
                expect(seen.length).toBe(2);
                expect(seen[0]).toStrictEqual(['a', 'b']);
                expect(seen[1]).toStrictEqual(['a', 'b']);
            });
        });

        // -------------------------------------------------------------------
        // Behaviour 2, directly: the coalescer
        // -------------------------------------------------------------------

        await gated('behaviour 2 — the popped bridge is debounced', async () => {
            await it('runs the action ONCE for a burst of triggers', async () => {
                let runs = 0;
                const trigger = coalesce(() => {
                    runs++;
                });
                trigger();
                trigger();
                trigger();
                expect(runs).toBe(0); // deferred, so the whole burst is seen first
                await Promise.resolve();
                await Promise.resolve();
                expect(runs).toBe(1);
            });

            await it('is armed again for the NEXT burst', async () => {
                let runs = 0;
                const trigger = coalesce(() => {
                    runs++;
                });
                trigger();
                await Promise.resolve();
                await Promise.resolve();
                trigger();
                trigger();
                await Promise.resolve();
                await Promise.resolve();
                expect(runs).toBe(2);
            });
        });

        // -------------------------------------------------------------------
        // Behaviour 3, directly: the closing-page bookkeeping
        // -------------------------------------------------------------------

        // ONE PATH OF BEHAVIOUR 3 IS NOT COVERED HERE, and saying so is the point.
        // The page's own `hidden` signal is what releases a closing page in a WINDOW,
        // where the page is mapped for the length of the animation and the unmapped
        // sweep therefore skips it. A vector for that ordering needs a mapped widget,
        // a mapped widget needs a display, and no vector in this repository may assert
        // a fact about the host machine. Control-probed: disconnecting the `hidden`
        // handler leaves this suite GREEN, because headless the sweep gets there first.
        // What IS pinned instead — and what makes the wiring worth having — is that the
        // signal fires at all on a detached view (the vector above), that the sweep
        // covers the widget-driven case (the reverse-direction vector, which goes red
        // when the sweep is removed), and the bookkeeping below.
        await gated('behaviour 3 — a popped page stays until GTK is done', async () => {
            type D = { readonly id: string };
            const D = (id: string): D => ({ id });
            const start = (live: readonly string[]): Tracking<D> => initialTracking<D>(live, live[live.length - 1]);

            await it('holds the descriptor of the page that WAS focused and has left', async () => {
                const previous = { a: D('a'), b: D('b') };
                const before = start(['a', 'b']);
                const after = advanceTracking(before, ['a'], 'a', previous);
                expect(Object.keys(after.closing)).toStrictEqual(['b']);
                // It is still rendered, which is the point: React's state has one
                // route and the widget has two pages until the animation ends.
                expect(after.order).toStrictEqual(['a', 'b']);
            });

            await it('does NOT hold a route removed from the MIDDLE, which never animated', async () => {
                const previous = { a: D('a'), b: D('b'), c: D('c') };
                const before = start(['a', 'b', 'c']);
                const after = advanceTracking(before, ['a', 'c'], 'c', previous);
                expect(Object.keys(after.closing)).toStrictEqual([]);
                expect(after.order).toStrictEqual(['a', 'c']);
            });

            await it('releases on `hidden`, and is identity-stable for a key it never held', async () => {
                const previous = { a: D('a'), b: D('b') };
                const held = advanceTracking(start(['a', 'b']), ['a'], 'a', previous);
                const released = releaseFrom(held, 'b');
                expect(Object.keys(released.closing)).toStrictEqual([]);
                expect(released.order).toStrictEqual(['a']);
                // Identity, not just equality: a new object here would re-render every
                // page for a signal about a key that was not closing.
                expect(releaseFrom(released, 'b')).toBe(released);
            });

            await it('keeps the order APPEND-ONLY, which is what stops a GTK reorder', async () => {
                // `AdwNavigationView` has no `insert` (measured) so the host would pay
                // a remove-all rotation — and ITS `remove()` also takes a page out of
                // the navigation stack. A sort here would disturb navigation.
                const previous = { a: D('a'), b: D('b') };
                let tracking = start(['a', 'b']);
                tracking = advanceTracking(tracking, ['a'], 'a', previous);
                tracking = releaseFrom(tracking, 'b');
                tracking = advanceTracking(tracking, ['a', 'z'], 'z', { ...previous, z: D('z') });
                expect(tracking.order).toStrictEqual(['a', 'z']);
                tracking = advanceTracking(tracking, ['a', 'z', 'b'], 'b', { ...previous, z: D('z') });
                expect(tracking.order).toStrictEqual(['a', 'z', 'b']);
            });

            await it('needs no advance when nothing moved', async () => {
                const tracking = start(['a', 'b']);
                expect(advanceTracking(tracking, ['a', 'b'], 'b', {}).order).toStrictEqual(['a', 'b']);
            });

            await it('forgets a closing key that came back as a live route', async () => {
                // Route keys are unique per push so this should not happen — which is
                // exactly when it is cheap to be sure: a key in both maps would render
                // twice under one tag and the join key would stop being one.
                const previous = { a: D('a'), b: D('b') };
                const held = advanceTracking(start(['a', 'b']), ['a'], 'a', previous);
                const back = advanceTracking(held, ['a', 'b'], 'b', previous);
                expect(Object.keys(back.closing)).toStrictEqual([]);
                expect(back.order).toStrictEqual(['a', 'b']);
            });
        });

        // -------------------------------------------------------------------
        // The wiring: a real tree, a real reconciler, a real widget stack
        // -------------------------------------------------------------------

        await gated('a mounted router', async () => {
            await it('renders the root layout as an Adw.NavigationView holding one page', async () => {
                await mounted(app(), (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    expect(stackTitles(view)).toStrictEqual(['Home']);
                    // The screen really is inside the page, through the toolbar view
                    // that gives it a header bar and therefore a back button.
                    expect(maybeFind(view, 'AdwHeaderBar') !== null).toBe(true);
                    expect((find(view, 'GtkLabel') as Gtk.Label).label).toBe('home');
                });
            });

            await it('answers `/` from usePathname on the first screen', async () => {
                await mounted(app(), () => {
                    expect(observed.pathname).toBe('/');
                });
            });

            await it('pushes a page, and the [param] reaches useLocalSearchParams', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push('/detail/7');
                    const turns = await settle(() => stackTitles(view).length === 2);
                    expect(turns >= 0).toBe(true);
                    expect(stackTitles(view)).toStrictEqual(['Home', 'Detail']);
                    expect(observed.params).toStrictEqual({ id: '7' });
                    expect(observed.pathname).toBe('/detail/7');
                });
            });

            await it('pushes the OBJECT form, and the params reach the screen', async () => {
                // THE DEFECT, end to end. `router.push({ pathname, params })` used to
                // interpolate as "[object Object]", match no route and land on
                // +not-found — no build error, no throw, 10 measured call sites. This
                // is the round trip `href.spec.ts` asserts in the pure half, driven
                // through React Navigation and the widget instead.
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push({ pathname: '/detail/[id]', params: { id: '7' } });
                    const turns = await settle(() => stackTitles(view).length === 2);
                    expect(turns >= 0).toBe(true);
                    expect(stackTitles(view)).toStrictEqual(['Home', 'Detail']);
                    expect(observed.params).toStrictEqual({ id: '7' });
                    expect(observed.pathname).toBe('/detail/7');
                });
            });

            await it('carries a leftover param through the query string', async () => {
                // The half a segment cannot hold. `useLocalSearchParams` answers for
                // the query as well, so the round trip stays total: what the pattern
                // has no slot for still arrives.
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push({ pathname: '/detail/[id]', params: { id: '7', tab: 'reviews' } });
                    await settle(() => stackTitles(view).length === 2);
                    expect(observed.params).toStrictEqual({ id: '7', tab: 'reviews' });
                    // The PATH is the path — expo-router splits the query off, and so
                    // does `usePathname`.
                    expect(observed.pathname).toBe('/detail/7');
                });
            });

            await it('takes the object form on replace and navigate too', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push({ pathname: '/detail/[id]', params: { id: '7' } });
                    await settle(() => stackTitles(view).length === 2);
                    router.replace({ pathname: '/detail/[id]', params: { id: '8' } });
                    await settle(() => observed.params.id === '8');
                    expect(stackTitles(view)).toStrictEqual(['Home', 'Detail']);
                    router.navigate({ pathname: '/' });
                    await settle(() => observed.pathname === '/');
                    expect(observed.pathname).toBe('/');
                });
            });

            await it('answers canGoBack, which is how a back button decides to exist', async () => {
                // Absent until now, so a consumer's `goBack` helper carried a latent
                // `router.canGoBack is not a function` — reached the moment anything
                // asked before popping.
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    expect(router.canGoBack()).toBe(false);
                    router.push('/detail/7');
                    await settle(() => stackTitles(view).length === 2);
                    expect(router.canGoBack()).toBe(true);
                    router.back();
                    await settle(() => stackTitles(view).length === 1);
                    expect(router.canGoBack()).toBe(false);
                });
            });

            await it('refuses the dismiss family and setParams BY NAME, as the table says', async () => {
                // The table already called these "a named refusal rather than an
                // undefined property read" — and they were absent, so reaching for one
                // was `router.dismissTo is not a function`, which names nothing.
                await mounted(app(), () => {
                    for (const call of ['dismiss', 'dismissAll', 'dismissTo', 'setParams'] as const) {
                        const member = (router as unknown as Record<string, () => void>)[call];
                        expect(typeof member).toBe('function');
                        let message = '';
                        try {
                            member();
                        } catch (error) {
                            message = (error as Error).message;
                        }
                        expect(message).toContain(`router.${call}()`);
                    }
                });
            });

            await it('uses the ROUTE KEY as the widget tag, which is the join', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push('/detail/7');
                    await settle(() => stackTitles(view).length === 2);
                    expect(tagsOf(view)).toStrictEqual(rootState().routes.map((route) => route.key));
                });
            });

            await it('pops on router.back(), and the widget follows', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push('/detail/7');
                    await settle(() => stackTitles(view).length === 2);
                    router.back();
                    const turns = await settle(() => stackTitles(view).length === 1);
                    expect(turns >= 0).toBe(true);
                    expect(stackTitles(view)).toStrictEqual(['Home']);
                    expect(observed.pathname).toBe('/');
                });
            });

            await it('REFUSES router.back() at the bottom of the history', async () => {
                await mounted(app(), () => {
                    // React Navigation's own goBack returns quietly here. A back button
                    // that does nothing, with nothing anywhere saying why, is the
                    // silent drop this layer refuses everywhere else.
                    expect(refusal(() => router.back())).toBe('unresolved-href');
                });
            });

            await it('keeps the depth on router.replace()', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push('/detail/7');
                    await settle(() => stackTitles(view).length === 2);
                    router.replace('/detail/8');
                    const turns = await settle(() => observed.params.id === '8');
                    expect(turns >= 0).toBe(true);
                    expect(stackTitles(view)).toStrictEqual(['Home', 'Detail']);
                });
            });

            await it('adds an entry on router.push() even for the same screen', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push('/detail/7');
                    await settle(() => stackTitles(view).length === 2);
                    router.push('/detail/8');
                    const turns = await settle(() => stackTitles(view).length === 3);
                    expect(turns >= 0).toBe(true);
                    expect(stackTitles(view)).toStrictEqual(['Home', 'Detail', 'Detail']);
                });
            });

            await it('releases the closing page, so a pop leaves no extra child', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push('/detail/7');
                    await settle(() => stackTitles(view).length === 2);
                    const closing = tagsOf(view)[1] as string;
                    expect(hasPage(view, closing)).toBe(true);
                    router.back();
                    // THE `hidden` PATH is the one this takes: MEASURED,
                    // `Adw.NavigationPage` emits `hidden` even on a DETACHED view — GTK
                    // drives shown/hidden off the navigation stack, not off mapping — so
                    // a pop React initiated releases through the signal here exactly as
                    // it would in a window. The sweep's own case is the widget-driven
                    // pop, and its vector is in "the reverse direction" below.
                    const turns = await settle(() => !hasPage(view, closing));
                    expect(turns >= 0).toBe(true);
                });
            });

            await it('lets go of every per-route cache entry a page owned (#1547)', async () => {
                // THE COUNT IS THE ONLY INSTRUMENT. A navigator that prunes its per-route
                // caches and one that never does render the same widgets and answer the
                // same hooks; the difference is entries keyed on route keys, which React
                // Navigation mints fresh per PUSH — so the leak is proportional to the
                // navigation history and invisible on screen. Measured with the three
                // `retain` calls removed: 27 entries held after popping back to a
                // one-page stack, against 3 with them.
                await mounted(app(STILL), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    const rested = perRouteCacheEntries();

                    for (let index = 0; index < 8; index++) router.push(`/detail/${index}`);
                    expect((await settle(() => stackTitles(view).length === 9)) >= 0).toBe(true);
                    const pushed = perRouteCacheEntries();
                    // One slot, one binding pair and one options record per page — the
                    // three maps #1547 names, all keyed the same way.
                    expect(pushed - rested).toBe(24);

                    for (let index = 0; index < 8; index++) router.back();
                    expect((await settle(() => stackTitles(view).length === 1)) >= 0).toBe(true);
                    expect((await settle(() => perRouteCacheEntries() === rested)) >= 0).toBe(true);
                });
            });

            await it('holds NOTHING once the navigator itself is gone (#1547)', async () => {
                // The other end of the same lifecycle, and it is not the sweep's: a
                // navigator that unmounts renders no pages at all, so no commit is left
                // to sweep and the whole map has to go with the component.
                const before = perRouteCacheEntries();
                await mounted(app(STILL), async () => {
                    router.push('/detail/1');
                    expect((await settle(() => observed.pathname === '/detail/1')) >= 0).toBe(true);
                    expect(perRouteCacheEntries() > before).toBe(true);
                });
                expect((await settle(() => perRouteCacheEntries() === before)) >= 0).toBe(true);
            });

            await it('lands on +not-found for a URL nothing else matches', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.navigate('/nope/deeper');
                    const turns = await settle(() => stackTitles(view).includes('Missing'));
                    expect(turns >= 0).toBe(true);
                });
            });

            await it('REFUSES an href nothing matches when there is no +not-found', async () => {
                const withoutFallback = APP.filter((entry) => entry.contextKey !== '+not-found.tsx');
                await mounted(app(withoutFallback), () => {
                    expect(refusal(() => router.navigate('/nope'))).toBe('unresolved-href');
                    // And it says what WOULD have matched, which is the actionable half.
                    let said = '';
                    try {
                        router.navigate('/nope');
                    } catch (error) {
                        said = (error as Error).message;
                    }
                    expect(said).toContain('/detail/:id');
                });
            });

            await it('releases the singleton on unmount', async () => {
                const container = new Gtk.Box();
                const root = createRoot(container);
                root.render(app());
                root.unmount();
                expect(refusal(() => router.push('/'))).toBe('no-router-mounted');
            });

            await it('REFUSES a second RouterRoot rather than rebinding the singleton', async () => {
                await mounted(app(), () => {
                    const container = new Gtk.Box();
                    const second = createRoot(container);
                    // The alternative — newest wins — makes `router.push` navigate a
                    // tree the user is not looking at, which presents as "the button
                    // does nothing".
                    expect(refusal(() => second.render(app()))).toBe('no-router-mounted');
                    second.unmount();
                });
            });
        });

        // -------------------------------------------------------------------
        // The reverse direction, through the widget's own gesture
        // -------------------------------------------------------------------

        await gated('the reverse direction, driven from the widget', async () => {
            await it('turns the widget’s own pop into a StackActions.pop', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push('/detail/7');
                    await settle(() => stackTitles(view).length === 2);
                    expect(rootState().routes.length).toBe(2);
                    const closing = tagsOf(view)[1] as string;

                    // What Escape, Alt+Left, the mouse back button and a swipe all end
                    // up calling. React Navigation was never asked.
                    view.pop();
                    // The predicate is the OBSERVABLE consequence, not the container's
                    // state — and the difference is a real ordering fact rather than a
                    // test detail. `navigation.dispatch` updates the container's state
                    // EAGERLY, so `rootState()` reports one route while React has not
                    // re-rendered yet; a vector that waited on the state read a screen
                    // that had not been told. Waiting on what a screen SAW covers the
                    // whole chain: dispatch, notify, re-render, sync.
                    const turns = await settle(() => observed.pathname === '/');
                    expect(turns >= 0).toBe(true);
                    expect(rootState().routes.length).toBe(1);
                    expect(stackTitles(view)).toStrictEqual(['Home']);
                    // AND THE CLOSING PAGE IS RELEASED, which is the vector that holds
                    // behaviour 3's SECOND path. MEASURED: on a widget-driven pop
                    // `hidden` fires while the widget pops — BEFORE React has been told
                    // and therefore before that descriptor is `closing` at all — so the
                    // `hidden` handler releases a key nothing is holding and never fires
                    // again. Only the unmapped sweep can free it, and without that sweep
                    // this assertion is what goes red.
                    const settled = await settle(() => !hasPage(view, closing));
                    expect(settled >= 0).toBe(true);
                });
            });

            await it('pops MULTIPLE pages in one gesture without over-popping', async () => {
                await mounted(app(), async (container) => {
                    const view = find(container, 'AdwNavigationView') as Adw.NavigationView;
                    router.push('/detail/7');
                    await settle(() => stackTitles(view).length === 2);
                    router.push('/detail/8');
                    await settle(() => stackTitles(view).length === 3);
                    router.push('/detail/9');
                    await settle(() => stackTitles(view).length === 4);

                    const bottom = tagsOf(view)[1] as string;
                    view.pop_to_tag(bottom); // two `popped` emissions, one delta
                    const turns = await settle(() => rootState().routes.length === 2);
                    expect(turns >= 0).toBe(true);
                    // TWO, not one and not zero: an undebounced bridge dispatches the
                    // same delta once per emission.
                    expect(rootState().routes.length).toBe(2);
                    expect(stackTitles(view)).toStrictEqual(['Home', 'Detail']);
                });
            });
        });

        // -------------------------------------------------------------------
        // Tabs
        // -------------------------------------------------------------------

        await gated('tabs, on an Adw.ViewStack behind an Adw.ViewSwitcher', async () => {
            const enterTabs = async (container: Gtk.Box): Promise<Adw.ViewStack> => {
                router.navigate('/one');
                const turns = await settle(() => maybeFind(container, 'AdwViewStack') !== null);
                expect(turns >= 0).toBe(true);
                return find(container, 'AdwViewStack') as Adw.ViewStack;
            };

            await it('renders one page per route file and shows the focused one', async () => {
                await mounted(app(), async (container) => {
                    const stack = await enterTabs(container);
                    await settle(() => stack.get_visible_child_name() !== null);
                    const visible = stack.get_visible_child();
                    expect(visible !== null).toBe(true);
                    expect(stack.get_page(visible as Gtk.Widget).get_title()).toBe('One');
                    expect(gtkChildren(stack).length).toBe(2);
                });
            });

            await it('gives the switcher the stack it switches', async () => {
                await mounted(app(), async (container) => {
                    const stack = await enterTabs(container);
                    const switcher = find(container, 'AdwViewSwitcher') as Adw.ViewSwitcher;
                    expect(switcher.get_stack()).toBe(stack);
                    // WIDE, not the NARROW default: a desktop window starts wide, and a
                    // switcher in the phone layout on a 900 px window reads as a bug.
                    expect(switcher.get_policy()).toBe(1);
                });
            });

            await it('puts each tab’s iconName on its Adw.ViewStackPage', async () => {
                await mounted(app(), async (container) => {
                    const stack = await enterTabs(container);
                    await settle(() => stack.get_visible_child_name() !== null);
                    const icons = gtkChildren(stack).map((child) => stack.get_page(child).get_icon_name());
                    // NOT decoration: `Adw.ViewSwitcher` reserves the icon whether or
                    // not a page carries one (measured — the same tabs measure the same
                    // width either way), so a page without one draws the icon theme's
                    // missing-image glyph in the space it kept.
                    expect(icons).toStrictEqual(['go-home-symbolic', 'view-grid-symbolic']);
                });
            });

            await it('moves the switcher to a bottom bar when the window is too narrow for it', async () => {
                await windowed(
                    app(WIDE_TABS),
                    async (_window, container) => {
                        const bar = find(container, 'AdwViewSwitcherBar') as Adw.ViewSwitcherBar;
                        // The threshold is read off the header bar the switcher is
                        // actually in, so a wide window has to settle with the bar shut
                        // before the narrow one proves anything.
                        expect((await settle(() => !bar.get_reveal())) >= 0).toBe(true);
                        const header = find(container, 'AdwHeaderBar') as Adw.HeaderBar;
                        const title = header.get_title_widget();
                        expect(title === null ? 'none' : typeOf(title)).toBe('AdwViewSwitcher');
                    },
                    undefined,
                    [900, 700],
                );

                await windowed(
                    app(WIDE_TABS),
                    async (_window, container) => {
                        const bar = find(container, 'AdwViewSwitcherBar') as Adw.ViewSwitcherBar;
                        expect((await settle(() => bar.get_reveal())) >= 0).toBe(true);
                        // Asserted on the HEADER BAR's title widget and not on "is there
                        // an Adw.ViewSwitcher anywhere": `Adw.ViewSwitcherBar` builds one
                        // of its own, so the tree holds a switcher in both layouts and
                        // the question is only ever which bar it is in.
                        const header = find(container, 'AdwHeaderBar') as Adw.HeaderBar;
                        const title = header.get_title_widget();
                        expect(title === null ? 'none' : typeOf(title)).toBe('AdwWindowTitle');
                        // And it names the FOCUSED tab rather than nothing: an unset
                        // title widget falls back to the page's own title, which under a
                        // route group is the group's NAME. Navigated rather than read at
                        // rest, because the route files sort alphabetically and the tab
                        // that happens to open first is not what this is about.
                        router.navigate('/one');
                        const titleNow = (): string => {
                            const held = (find(container, 'AdwHeaderBar') as Adw.HeaderBar).get_title_widget();
                            return held === null ? 'none' : (held as Adw.WindowTitle).get_title();
                        };
                        expect((await settle(() => titleNow() === 'Startseite')) >= 0).toBe(true);
                    },
                    undefined,
                    [420, 700],
                );
            });

            await it('follows React when the route changes', async () => {
                await mounted(app(), async (container) => {
                    const stack = await enterTabs(container);
                    router.navigate('/two');
                    const turns = await settle(() => observed.pathname === '/two');
                    expect(turns >= 0).toBe(true);
                    expect(stack.get_page(stack.get_visible_child() as Gtk.Widget).get_title()).toBe('Two');
                });
            });

            await it('leaves the stack alone when the focused page is not there yet', async () => {
                // THE CONDITION DIRECTLY, not through a render race. A focused route whose
                // page React has not committed yet is an ordinary intermediate state, and
                // the effect that follows React has no dependency array precisely so that a
                // later commit gets another try. What must not happen is a call into Adw for
                // a name it does not hold: measured, `set_visible_child_name` then changes
                // nothing, emits no notify, and prints `Adwaita-WARNING: Child name '…' not
                // found in AdwViewStack` — so the naive guard never terminates and warns once
                // per render for a state that is not a fault.
                //
                // TWO INDEPENDENT NETS, each proven by breaking the fix on its own. Drop the
                // presence check in `showFocusedPage` and the return value below fails first
                // (false becomes true, exit 1). Loosen that assertion as well, so only the
                // gate can object, and `assertQuiet()` fails on its own with `Child name
                // 'page-not-committed-yet' not found in AdwViewStack`. The boolean is the
                // readable half; the gate catches the same defect reached by another route.
                //
                // The hidden-page leg at the end is a THIRD net for a THIRD condition, and
                // it has only the boolean: measured, that no-op prints nothing, so there is
                // no gate leg to have. Drop `!page.get_visible()` and it fails on its own.
                const Stack = lookupWidget('AdwViewStack').ctor() as unknown as new () => Adw.ViewStack;
                const stack = new Stack();
                stack.add_named(new Gtk.Label({ label: 'here' }), 'page-here');

                expect(showFocusedPage(stack, 'page-not-committed-yet')).toBe(false);
                expect(stack.get_visible_child_name()).toBe('page-here');

                // And the other direction, so the false above is not simply "it never sets".
                stack.add_named(new Gtk.Label({ label: 'later' }), 'page-later');
                expect(showFocusedPage(stack, 'page-later')).toBe(true);
                expect(stack.get_visible_child_name()).toBe('page-later');

                // Already there: no call, still true.
                expect(showFocusedPage(stack, 'page-later')).toBe(true);

                // THE OTHER SILENT NO-OP, which a presence check alone does not cover. A
                // page can be there and HIDDEN, and `adw_view_stack_set_visible_child_name`
                // then changes nothing, emits no notify AND prints nothing — measured, so
                // the suite's gate cannot see this one at all. Answering `true` would be the
                // same non-terminating state this function exists to end, by the road where
                // no log disagrees.
                const unmapped = new Gtk.Label({ label: 'hidden' });
                unmapped.set_visible(false);
                stack.add_named(unmapped, 'page-hidden');
                expect(showFocusedPage(stack, 'page-hidden')).toBe(false);
                expect(stack.get_visible_child_name()).toBe('page-later');
            });

            for (const entry of TAB_NAMES) {
                await it(`enters at /${entry} without inventing a navigation (#1453)`, async () => {
                    await mounted(createElement(RouterRoot, { manifest: FIVE_TABS }), async (container) => {
                        const actions = await actionsDuring(async () => {
                            router.navigate(`/${entry}`);
                            expect((await settle(() => observed.pathname === `/${entry}`)) >= 0).toBe(true);
                            // Let every scheduled lane and every notify land before
                            // counting: the defect dispatches DURING the entry, so a
                            // count taken at the first agreeing render would miss the
                            // dispatch that follows it.
                            await settle(() => false, 30);
                        });

                        const stack = find(container, 'AdwViewStack') as Adw.ViewStack;
                        expect(stack.get_page(stack.get_visible_child() as Gtk.Widget).get_title()).toBe(
                            entry.toUpperCase(),
                        );
                        expect(observed.pathname).toBe(`/${entry}`);
                        // MEASURED on this vector before the fix: one `JUMP_TO` for every
                        // non-index entry (`t1`…`t4`) and none for `t0`. The layer's own
                        // `set_visible_child_name` raised a notify whose echo the
                        // container-state guard could not see, so the bridge navigated for
                        // a tab nobody pressed — and would have named the FIRST page
                        // instead whenever the lag fell the other way, which is the deep
                        // link that does not survive.
                        expect(actions.filter((type) => type === 'JUMP_TO')).toStrictEqual([]);
                    });
                });
            }

            await it('still follows a REAL press, so the guard did not close the bridge', async () => {
                await mounted(createElement(RouterRoot, { manifest: FIVE_TABS }), async (container) => {
                    router.navigate('/t0');
                    expect((await settle(() => observed.pathname === '/t0')) >= 0).toBe(true);
                    await settle(() => false, 30);

                    const stack = find(container, 'AdwViewStack') as Adw.ViewStack;
                    const tabs = rootState().routes.find((route) => route.name === '(tabs)')?.state?.routes;
                    const other = tabs?.find((route) => route.name === 't3')?.key as string;
                    const actions = await actionsDuring(async () => {
                        // What a click on the switcher does — the one emitter of the three
                        // that IS a press.
                        stack.set_visible_child_name(other);
                        expect((await settle(() => observed.pathname === '/t3')) >= 0).toBe(true);
                    });
                    expect(actions.filter((type) => type === 'JUMP_TO')).toStrictEqual(['JUMP_TO']);
                });
            });

            await it('follows the USER when the switcher changes the visible child', async () => {
                await mounted(app(), async (container) => {
                    const stack = await enterTabs(container);
                    await settle(() => stack.get_visible_child_name() !== null);
                    const tabs = rootState().routes.find((route) => route.name === '(tabs)')?.state?.routes;
                    const other = tabs?.find((route) => route.name === 'two')?.key as string;

                    // What a click on the switcher does. Without the reverse direction
                    // the widget changes and every hook in the tab reads the old route.
                    stack.set_visible_child_name(other);
                    const turns = await settle(() => observed.pathname === '/two');
                    expect(turns >= 0).toBe(true);
                });
            });
        });

        await gated('the window’s chrome — one header bar, one close button (#1460)', async () => {
            /** Is `widget` inside a header bar? The switcher's contribution, checked. */
            const withinHeaderBar = (widget: Gtk.Widget): boolean => {
                for (let node = widget.get_parent(); node !== null; node = node.get_parent()) {
                    if (typeOf(node) === 'AdwHeaderBar') return true;
                }
                return false;
            };

            await it('enters at the index route with ONE header bar and ONE close button', async () => {
                // WHAT THIS MEASURES IS THE PIXEL, not the widget count: three
                // `Adw.HeaderBar`s in the tree is a different sentence from three close
                // buttons drawn, and only the second is what the user sees. Before the
                // chrome rule this window carried the window's own bar plus the page's
                // — two mapped, non-empty `GtkWindowControls`, two close buttons.
                await windowed(app(), (window) => {
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                    const census = windowChromeCensus(window);
                    expect(census.headerBars).toBe(1);
                    // Non-vacuous: a host drawing no buttons at all would answer 0 and
                    // make the empty problem list meaningless. WHICH side carries them
                    // is the host's `gtk-decoration-layout` and not this vector's
                    // business, so only the per-side maximum is asserted.
                    expect(Math.max(census.start, census.end)).toBe(1);
                    expect(census.start + census.end >= 1).toBe(true);
                });
            });

            await it('puts the tab switcher in the page’s OWN bar rather than a second one', async () => {
                // The nesting from the issue: a `(tabs)` group inside the root stack.
                // Its `_layout` renders `<Tabs>`, and a `_layout` inside a `_layout`
                // is what used to describe a header bar inside a header bar.
                //
                // THIS IS THE SHAPE THE PACKAGE DOCUMENTS, and the one bar is asserted
                // here rather than assumed: the `headerShown: false` vector below rests
                // at TWO, and what makes that trade acceptable is precisely that this
                // shape — the one written without the option — does not pay for it.
                // Settled to REST first, so it is the resting composition being counted
                // and not a moment of the transition into the group.
                await windowed(app(STILL), async (window, container) => {
                    router.navigate('/one');
                    expect((await settle(() => maybeFind(container, 'AdwViewSwitcher') !== null)) >= 0).toBe(true);
                    const switcher = find(container, 'AdwViewSwitcher') as Adw.ViewSwitcher;
                    expect((await settle(() => switcher.get_mapped())) >= 0).toBe(true);
                    await settle(() => windowChromeCensus(window).headerBars === 1);

                    expect(windowChromeProblems(window)).toStrictEqual([]);
                    expect(windowChromeCensus(window).headerBars).toBe(1);
                    // The contribution landed in a header bar, and it is WIRED: the
                    // element is rendered by the level above, so the commit that mounts
                    // it need not re-render `<Tabs>` at all — an unwired switcher would
                    // be an empty box in the title, which no census can see.
                    expect(withinHeaderBar(switcher)).toBe(true);
                    expect(switcher.get_stack()).toBe(find(container, 'AdwViewStack') as Adw.ViewStack);
                });
            });

            await it('keeps it at one when a screen is pushed on top', async () => {
                await windowed(app(STILL), async (window, container) => {
                    router.push('/detail/7');
                    expect((await settle(() => observed.pathname === '/detail/7')) >= 0).toBe(true);
                    expect((await settle(() => windowChromeCensus(window).headerBars === 1)) >= 0).toBe(true);
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                    expect(maybeFind(container, 'AdwNavigationView') !== null).toBe(true);
                });
            });

            await it('a Tabs at the TOP level owns the window’s chrome itself', async () => {
                await windowed(app(TABS_ROOT), (window, container) => {
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                    expect(windowChromeCensus(window).headerBars).toBe(1);
                    const switcher = find(container, 'AdwViewSwitcher') as Adw.ViewSwitcher;
                    expect(withinHeaderBar(switcher)).toBe(true);
                });
            });

            await it('an inner Stack keeps its bars and draws no SECOND close button', async () => {
                // The other nesting order, and the one the contribution cannot answer:
                // an inner stack's pages each need their own back button, so the bars
                // stay. `Adw.NavigationSplitView` shows two bars for the same reason —
                // which is why the invariant is one set of window controls per side and
                // not one header bar.
                await windowed(app(STACK_IN_TABS), async (window, container) => {
                    router.navigate('/detail');
                    expect((await settle(() => maybeFind(container, 'AdwNavigationView') !== null)) >= 0).toBe(true);
                    expect((await settle(() => windowChromeCensus(window).headerBars === 2)) >= 0).toBe(true);
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                    const census = windowChromeCensus(window);
                    expect(Math.max(census.start, census.end)).toBe(1);
                    expect(census.start + census.end >= 1).toBe(true);
                });
            });

            await it('falls back to its own bar when the page above has none', async () => {
                // `headerShown: false` on the group leaves no title slot to contribute
                // to, so the tab level builds a bar. The switcher stays reachable either
                // way, which is what makes the option survivable rather than a trap.
                //
                // TWO BARS AT REST, and it is a TRADE that was made deliberately, not a
                // number that happened. The owning stack's screen draws no bar, so the
                // stack holds no claim and the WINDOW's bar carries the controls; the tab
                // level's own bar sits under it without a second set.
                //
                // WHY IT WAS TRADED THAT WAY: the alternative is to claim the window's
                // bar whenever ANY page of the stack has one, which is what this package
                // did until the vector below. That buys one bar here and pays for it with
                // a window that draws NO window control at all as soon as the page on
                // screen has no header — measured, on a shape a manual reader reaches.
                // An unclosable, unmovable window is not a degraded state, it is a broken
                // one, and one bar too many is the correct price for never producing it.
                // The bill also falls on the right shape: `headerShown: false` on a route
                // GROUP is the pre-#1460 workaround, and the arrangement this package now
                // documents — the same tree WITHOUT the option — still rests at one bar,
                // asserted in the vector above.
                await windowed(app(HEADER_HIDDEN), async (window, container) => {
                    router.navigate('/one');
                    expect((await settle(() => maybeFind(container, 'AdwViewSwitcher') !== null)) >= 0).toBe(true);
                    // Settle on the census, assert on the PROBLEMS: a settle that times
                    // out reports a bare `false`, and the sentence the reader writes is
                    // the whole reason it exists.
                    await settle(() => windowChromeCensus(window).headerBars === 2);
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                    const census = windowChromeCensus(window);
                    expect(census.headerBars).toBe(2);
                    expect(Math.max(census.start, census.end)).toBe(1);
                    expect(census.start + census.end >= 1).toBe(true);
                });
            });

            await it('keeps the window closable while a headerShown:false screen is on top', async () => {
                // THE PAGES THAT COUNT ARE THE MAPPED ONES. `Adw.NavigationView` maps
                // the visible page and the one sliding out, nothing else — so a claim
                // held because SOME page in the stack has a header bar is a claim
                // against a bar that draws nothing. Measured before `stack.ts` asked
                // only the on-screen pages: 0 mapped header bars and no window control
                // anywhere, on a window that had chrome one push earlier.
                //
                // `headerShown: false` on a pushed screen is a documented option and a
                // full-bleed reader is what it is for, so this is a shape an application
                // reaches by following the manual.
                await windowed(app(BARE_ON_TOP), async (window) => {
                    expect(windowChromeCensus(window).headerBars).toBe(1);
                    router.push('/bare');
                    expect((await settle(() => observed.pathname === '/bare')) >= 0).toBe(true);
                    await settle(() => windowChromeProblems(window).length === 0);
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                    const onTop = windowChromeCensus(window);
                    expect(onTop.headerBars).toBe(1);
                    expect(Math.max(onTop.start, onTop.end)).toBe(1);
                    expect(onTop.start + onTop.end >= 1).toBe(true);

                    // And back: the stack takes the window's bar again, so the pushed
                    // screen having none is not a one-way door out of the owned chrome.
                    router.back();
                    expect((await settle(() => observed.pathname === '/')) >= 0).toBe(true);
                    await settle(() => windowChromeProblems(window).length === 0);
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                    expect(windowChromeCensus(window).headerBars).toBe(1);
                });
            });

            await it('gives the window its own header bar BACK when the router unmounts', async () => {
                // The claim is an effect with an undo, not a one-shot: without the undo
                // a window that outlived its React root would have no chrome at all, and
                // an `Adw.Window` carries no titlebar of its own.
                const shell = buildWindowShell();
                const AdwWindow = lookupWidget('AdwWindow').ctor() as unknown as new () => Adw.Window;
                const window = new AdwWindow();
                window.set_default_size(900, 700);
                window.set_content(shell.root);
                const root = createRoot(shell.content);
                // The unmount is the vector's SUBJECT and also its cleanup, and it still
                // belongs in a `finally`: `router` is module-level, so a vector that
                // fails before unmounting leaves the next one to fail with "RouterRoot is
                // already mounted" — a red reported against innocent code, which is the
                // misattribution `gated` exists for one level up.
                let unmounted = false;
                const unmount = (): void => {
                    if (unmounted) return;
                    unmounted = true;
                    root.unmount();
                    uninstallRouter();
                };
                try {
                    root.render(provideWindowChrome(shell.chrome, app()));
                    window.present();
                    expect((await settle(() => maybeFind(shell.content, 'AdwHeaderBar') !== null)) >= 0).toBe(true);
                    expect(windowChromeCensus(window).headerBars).toBe(1);
                    unmount();
                    expect((await settle(() => windowChromeCensus(window).headerBars === 1)) >= 0).toBe(true);
                    expect(windowChromeProblems(window)).toStrictEqual([]);
                } finally {
                    try {
                        unmount();
                    } finally {
                        window.destroy();
                    }
                }
            });

            await it('leaves the window its own bar when the root navigator renders none', async () => {
                // The regression the "chrome draws nothing" half also guards: taking the
                // window's bar away is only right when this level puts one back.
                // `<Tabs headerShown={false}>` puts none, so the window keeps its own —
                // otherwise an application that had a closable window before would stop
                // having one, and no widget-tree assertion would notice.
                //
                // AND THE LEVEL BELOW STAYS UNDECORATED: the window's bar is carrying
                // the controls, so the inner stack's page bars must not carry a second
                // set. Asserted by counting the controls the ROUTER drew, which is a
                // different question from how many the window has.
                await windowed(
                    app(BARLESS_ROOT),
                    async (window, container) => {
                        router.navigate('/detail');
                        expect((await settle(() => maybeFind(container, 'AdwNavigationView') !== null)) >= 0).toBe(
                            true,
                        );
                        expect(windowChromeProblems(window)).toStrictEqual([]);
                        const inWindow = windowChromeCensus(window);
                        expect(Math.max(inWindow.start, inWindow.end)).toBe(1);
                        expect(inWindow.start + inWindow.end >= 1).toBe(true);
                        const byTheRouter = windowChromeCensus(container);
                        expect(byTheRouter.start + byTheRouter.end).toBe(0);
                        // The inner stack DID render bars — this is not vacuous.
                        expect(byTheRouter.headerBars >= 1).toBe(true);
                    },
                    (container) => maybeFind(container, 'AdwViewStack') !== null,
                );

                // And with NOTHING below that could supply the chrome by accident,
                // which is the regression in its bare form: an unconditional claim
                // leaves this window with no header bar at all, and `Adw.Window` has
                // no titlebar of its own to fall back on.
                await windowed(
                    app(BARLESS_PLAIN),
                    (window, container) => {
                        expect(windowChromeProblems(window)).toStrictEqual([]);
                        expect(windowChromeCensus(container).headerBars).toBe(0);
                        expect(windowChromeCensus(window).headerBars).toBe(1);
                    },
                    (container) => maybeFind(container, 'AdwViewStack') !== null,
                );
            });

            await it('REFUSES a second claim on the window’s header bar, and names both', async () => {
                // Two levels each believing they are outermost is a composition defect,
                // and letting the second win would hide it behind a window that simply
                // has no chrome.
                const shell = buildWindowShell();
                const release = shell.chrome.claim('<Stack>');
                let message = '';
                try {
                    shell.chrome.claim('<Tabs>');
                } catch (error) {
                    message = (error as Error).message;
                }
                expect(message.includes('<Tabs> claimed')).toBe(true);
                expect(message.includes('<Stack> already')).toBe(true);
                // And the hand-back re-arms it, which is what makes a remount safe.
                release();
                shell.chrome.claim('<Tabs>')();
            });
        });

        // -------------------------------------------------------------------
        // What the navigators refuse
        // -------------------------------------------------------------------

        await gated('what the router refuses at the seams', async () => {
            const layoutOf = (Layout: () => ReactElement): RouteManifest => [
                { contextKey: '_layout.tsx', module: { default: Layout } },
                { contextKey: 'index.tsx', module: { default: Home } },
            ];

            await it('refuses a non-Screen child of a navigator instead of dropping it', async () => {
                const Bad = (): ReactElement => createElement(Stack, null, label('stray'));
                expect(
                    refusal(() => {
                        const root = createRoot(new Gtk.Box());
                        try {
                            root.render(app(layoutOf(Bad)));
                        } finally {
                            root.unmount();
                            uninstallRouter();
                        }
                    }),
                ).toBe('not-a-screen-child');
            });

            await it('refuses an option the navigator has no GTK answer for', async () => {
                const Bad = (): ReactElement =>
                    createElement(
                        Stack,
                        null,
                        createElement(Stack.Screen, {
                            name: 'index',
                            options: { headerTintColor: 'red' } as never,
                        }),
                    );
                expect(
                    refusal(() => {
                        const root = createRoot(new Gtk.Box());
                        try {
                            root.render(app(layoutOf(Bad)));
                        } finally {
                            root.unmount();
                            uninstallRouter();
                        }
                    }),
                ).toBe('unknown-screen-option');
            });

            await it('refuses a routes directory with no _layout', async () => {
                expect(
                    refusal(() => {
                        const root = createRoot(new Gtk.Box());
                        try {
                            root.render(app([{ contextKey: 'index.tsx', module: { default: Home } }]));
                        } finally {
                            root.unmount();
                            uninstallRouter();
                        }
                    }),
                ).toBe('bad-manifest');
            });

            await it('refuses a route file with no default export', async () => {
                expect(
                    refusal(() => {
                        const root = createRoot(new Gtk.Box());
                        try {
                            root.render(
                                app([
                                    { contextKey: '_layout.tsx', module: { Layout: RootLayout } },
                                    { contextKey: 'index.tsx', module: { default: Home } },
                                ]),
                            );
                        } finally {
                            root.unmount();
                            uninstallRouter();
                        }
                    }),
                ).toBe('bad-route-module');
            });

            await it('refuses a navigator rendered outside the router', async () => {
                expect(
                    refusal(() => {
                        const root = createRoot(new Gtk.Box());
                        try {
                            root.render(createElement(Stack, null));
                        } finally {
                            root.unmount();
                        }
                    }),
                ).toBe('no-route-node');
            });

            await it('refuses a <Stack.Screen> that is rendered rather than read', async () => {
                expect(
                    refusal(() => {
                        const root = createRoot(new Gtk.Box());
                        try {
                            root.render(createElement(Stack.Screen, { name: 'index' }));
                        } finally {
                            root.unmount();
                        }
                    }),
                ).toBe('not-a-screen-child');
            });

            await it('refuses router.* before anything is mounted', async () => {
                expect(refusal(() => router.push('/'))).toBe('no-router-mounted');
                expect(refusal(() => router.navigate('/'))).toBe('no-router-mounted');
                expect(refusal(() => router.replace('/'))).toBe('no-router-mounted');
                expect(refusal(() => router.back())).toBe('no-router-mounted');
            });
        });
    });
};
