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

import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { lookupWidget, registerBuiltinWidgets } from '@gjsify/gtk-host';
import { descriptorProblems, dumpTree, gtkChildren, installDiagnosticsGate } from '@gjsify/gtk-host/conformance';
import { createRoot } from '@gjsify/gtk-host/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import type { NavigationState } from '@react-navigation/core';
import type Adw from '@girs/adw-1';

import { RouterError } from './errors.js';
import { navigationRef, router, uninstallRouter, useLocalSearchParams, usePathname } from './navigation.js';
import { RouterRoot } from './root.js';
import type { RouteManifest } from './routes.js';
import { Stack } from './stack.js';
import { advanceTracking, applyStack, coalesce, initialTracking, releaseFrom, type Tracking } from './stack.js';
import { Tabs } from './tabs.js';

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

function RootLayout(): ReactElement {
    return createElement(
        Stack,
        null,
        createElement(Stack.Screen, { key: 'i', name: 'index', options: { title: 'Home' } }),
        createElement(Stack.Screen, { key: 'd', name: 'detail/[id]', options: { title: 'Detail' } }),
        createElement(Stack.Screen, { key: 't', name: '(tabs)', options: { title: 'Tabs', headerShown: false } }),
        createElement(Stack.Screen, { key: 'n', name: '+not-found', options: { title: 'Missing' } }),
    );
}
function TabsLayout(): ReactElement {
    return createElement(
        Tabs,
        null,
        createElement(Tabs.Screen, { key: '1', name: 'one', options: { title: 'One' } }),
        createElement(Tabs.Screen, { key: '2', name: 'two', options: { title: 'Two' } }),
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

const app = (manifest: RouteManifest = APP): ReactElement => createElement(RouterRoot, { manifest });

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

            await it('follows React when the route changes', async () => {
                await mounted(app(), async (container) => {
                    const stack = await enterTabs(container);
                    router.navigate('/two');
                    const turns = await settle(() => observed.pathname === '/two');
                    expect(turns >= 0).toBe(true);
                    expect(stack.get_page(stack.get_visible_child() as Gtk.Widget).get_title()).toBe('Two');
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
