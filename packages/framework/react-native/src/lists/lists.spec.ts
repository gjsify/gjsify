// The list family, against the GTK that is installed — including the three facts that
// forced it not to be an element.
//
// THE CONTAINER IS ROOTED IN A `Gtk.Window`, and that is the vector's own measurement
// rather than a convenience. MEASURED on gtk 4.22.4: a `Gtk.ListView` with a model and
// a factory binds NOTHING while it is detached — not on construction, not inside a
// `Gtk.ScrolledWindow`, not after `measure()`, not after `allocate(400, 400)`, and not
// after 50 main-loop iterations — and binds every row the moment it is rooted in a
// window, with no `present()`, no map and no main loop. So a spec that mounted into a
// detached box (which is what `widgets.spec.ts` does, and rightly) would exercise the
// frame and none of the rows, and would report success having checked nothing that
// matters here.
//
// The window is CONSTRUCTED and never presented. That keeps the suite off every
// question about a compositor: `Gtk.init()` succeeding is already this gate's
// precondition, and nothing below needs a mapped surface.
//
// AND THE ROWS ARE DRAINED WITH AN `await`. A row's React tree is rendered on a
// microtask (`controller.ts` says why: GTK binds from inside React's own commit, where
// a nested root cannot flush). Awaiting a freshly queued microtask is what makes the
// real path observable — not a synchronous flush seam, which would test a shortcut.

import GObject from 'gi://GObject';
import Gtk from 'gi://Gtk?version=4.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { lookupWidget, registerBuiltinWidgets } from '@gjsify/gtk-host';
import { gtkChildren, installDiagnosticsGate } from '@gjsify/gtk-host/conformance';
import { createRoot } from '@gjsify/gtk-host/react';
import { MINIMAL_TOKENS, type StyleTokens } from '@gjsify/gtk-host/style';
import { createElement, type ReactElement } from 'react';

import {
    FlatList,
    SectionList,
    VirtualizedList,
    type FlatListProps,
    type SectionListProps,
    type VirtualizedListProps,
} from './components.js';
import { rowKey } from './controller.js';
import { Text, View } from '../components.js';
import { PrimitiveError } from '../primitives/errors.js';
import { configureStyle, resetStyleConfig } from '../style-config.js';

/** Named identities, not a capability — a probe that answers "no" stands the suite DOWN. */
const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

const TOKENS: StyleTokens = {
    ...MINIMAL_TOKENS,
    spacing: { ...MINIMAL_TOKENS.spacing, '2': '8px' },
};

const typeOf = (widget: Gtk.Widget): string =>
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

/** Every `Gtk.Label`'s text under `root`, breadth-first — which is what a row renders to. */
function labels(root: Gtk.Widget): string[] {
    const out: string[] = [];
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === 'GtkLabel') out.push((widget as Gtk.Label).label);
        queue.push(...gtkChildren(widget));
    }
    return out;
}

/** The first strict descendant of a GType, or null. */
function find(root: Gtk.Widget, gtype: string): Gtk.Widget | null {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === gtype) return widget;
        queue.push(...gtkChildren(widget));
    }
    return null;
}

/** Let every queued microtask run — which is where a row's tree is rendered. */
const drain = (): Promise<void> => new Promise<void>((resolve) => queueMicrotask(resolve));

interface Mounted {
    readonly container: Gtk.Box;
    render(element: ReactElement | null): Promise<void>;
}

/**
 * Mount into a box that IS rooted in a window, and tear both down.
 *
 * The teardown order is load-bearing: `root.unmount()` runs the component cleanups —
 * which is where `ListController.dispose()` unmounts every row and disconnects the
 * factory — and only then is the window destroyed. The other order leaves JS handlers
 * on a factory whose view is about to be collected, and GJS blocks those callbacks
 * during GC sweeping while printing a `Gjs-CRITICAL` for each (measured).
 */
async function mounted(body: (mount: Mounted) => Promise<void>): Promise<void> {
    const window = new Gtk.Window();
    const container = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL });
    window.set_child(container);
    const root = createRoot(container);
    try {
        await body({
            container,
            render: async (element) => {
                root.render(element);
                await drain();
            },
        });
    } finally {
        root.unmount();
        window.destroy();
    }
}

const threw = (fn: () => unknown): PrimitiveError => {
    try {
        fn();
    } catch (error) {
        if (error instanceof PrimitiveError) return error;
        throw error;
    }
    throw new Error('expected a PrimitiveError, nothing was thrown');
};

/** The row shape every vector below uses. */
interface Item {
    readonly title: string;
    readonly key?: string;
}

const row = (item: Item): ReactElement => createElement(Text, null, item.title);

// `createElement` cannot infer a generic component's type parameter from its props
// object, so the element type is pinned once here rather than cast at twenty call
// sites. Nothing about the components changes — JSX infers it from `data`.
const flatList = (props: FlatListProps<Item>): ReactElement =>
    createElement(FlatList as (p: FlatListProps<Item>) => ReactElement, props);
const sectionList = (props: SectionListProps<Item>): ReactElement =>
    createElement(SectionList as (p: SectionListProps<Item>) => ReactElement, props);
const virtualizedList = (props: VirtualizedListProps<Item>): ReactElement =>
    createElement(VirtualizedList as (p: VirtualizedListProps<Item>) => ReactElement, props);

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

        await gated('why a list is not an element', async () => {
            await it('installs no child-adding method at all, so no policy could name one', async () => {
                // The measurement the whole design rests on. A `Gtk.ListView` renders
                // from a model through a factory; the host's placement policies are
                // data naming a method for the host to call, and here there is none.
                for (const method of ['append', 'add', 'insert', 'prepend', 'remove', 'set_child']) {
                    expect(
                        `${method}: ${typeof (Gtk.ListView.prototype as unknown as Record<string, unknown>)[method]}`,
                    ).toBe(`${method}: undefined`);
                }
                expect(typeof Gtk.ListView.prototype.set_model).toBe('function');
                expect(typeof Gtk.ListView.prototype.set_factory).toBe('function');
                // So the honest state in the host's table is `uncurated`: the tag can be
                // created and given properties, and inserting a child is a named
                // refusal rather than a guessed adder.
                expect(lookupWidget('GtkListView').children.kind).toBe('uncurated');
            });

            await it('binds rows into a Gtk.ListItem, which is not a Gtk.Widget', async () => {
                // Which is why the React root goes into the widget the factory PUTS in
                // the item, not into the item.
                expect(GObject.type_is_a(Gtk.ListItem.$gtype, Gtk.Widget.$gtype)).toBe(false);
                const child = GObject.Object.list_properties
                    .call(Gtk.ListItem)
                    .find((spec) => spec.get_name() === 'child');
                expect(child !== undefined).toBe(true);
                expect((child!.flags & GObject.ParamFlags.WRITABLE) !== 0).toBe(true);
                // And `item` is READ-ONLY (measured: `set_property('item', …)` is a
                // GLib-GObject-CRITICAL), which is why no spec can hand-build a BOUND
                // list item and why these vectors go through a real view in a window.
                const item = GObject.Object.list_properties
                    .call(Gtk.ListItem)
                    .find((spec) => spec.get_name() === 'item');
                expect((item!.flags & GObject.ParamFlags.WRITABLE) === 0).toBe(true);
            });
        });

        await gated('a FlatList in a window', async () => {
            beforeEach(() => configureStyle({ tokens: TOKENS }));
            afterEach(() => resetStyleConfig());

            await it('builds the frame and puts the list inside the scroller itself', async () => {
                await mounted(async (mount) => {
                    await mount.render(
                        flatList({
                            className: 'p-2',
                            data: [{ title: 'one' }, { title: 'two' }],
                            renderItem: ({ item }) => row(item),
                        }),
                    );
                    const box = gtkChildren(mount.container)[0] as Gtk.Box;
                    expect(typeOf(box)).toBe('GtkBox');
                    const scroller = gtkChildren(box)[0] as Gtk.ScrolledWindow;
                    expect(typeOf(scroller)).toBe('GtkScrolledWindow');
                    // The list is the scroller's OWN child, so GTK's `Gtk.Scrollable`
                    // path is the one in use — measured: wrapping it in a box makes
                    // `get_child()` a `GtkViewport` instead, which is the arrangement
                    // the header and footer are kept OUT of.
                    expect(typeOf(scroller.get_child() as Gtk.Widget)).toBe('GtkListView');
                });
            });

            await it('renders renderItem into every row, through a React root per item', async () => {
                await mounted(async (mount) => {
                    await mount.render(
                        flatList({
                            data: [{ title: 'alpha' }, { title: 'beta' }, { title: 'gamma' }],
                            renderItem: ({ item, index }) =>
                                createElement(View, null, createElement(Text, null, `${index}:${item.title}`)),
                        }),
                    );
                    const list = find(mount.container, 'GtkListView');
                    expect(list !== null).toBe(true);
                    expect(labels(list!)).toStrictEqual(['0:alpha', '1:beta', '2:gamma']);
                });
            });

            await it('re-renders a row IN PLACE when its key did not change', async () => {
                // GTK does not re-bind a row whose model object is unchanged (measured:
                // `items_changed` over the same object produced nothing), so a content
                // change behind a stable key has to be pushed into the row's own root.
                await mounted(async (mount) => {
                    const list = (data: Item[]): ReactElement =>
                        flatList({
                            data,
                            keyExtractor: (item: Item) => item.key as string,
                            renderItem: ({ item }) => createElement(Text, null, item.title),
                        });
                    await mount.render(list([{ key: 'a', title: 'first' }]));
                    const view = find(mount.container, 'GtkListView')!;
                    expect(labels(view)).toStrictEqual(['first']);
                    await mount.render(list([{ key: 'a', title: 'second' }]));
                    expect(labels(view)).toStrictEqual(['second']);
                });
            });

            await it('splices the model when the keys DO change', async () => {
                await mounted(async (mount) => {
                    const list = (titles: string[]): ReactElement =>
                        flatList({
                            data: titles.map((title) => ({ title, key: title })),
                            keyExtractor: (item: Item) => item.key as string,
                            renderItem: ({ item }) => createElement(Text, null, item.title),
                        });
                    await mount.render(list(['a', 'b']));
                    const view = find(mount.container, 'GtkListView')!;
                    expect(labels(view)).toStrictEqual(['a', 'b']);
                    await mount.render(list(['c']));
                    expect(labels(view)).toStrictEqual(['c']);
                });
            });

            await it('puts the header and footer OUTSIDE the scroller, where they stay put', async () => {
                await mounted(async (mount) => {
                    await mount.render(
                        flatList({
                            data: [{ title: 'body' }],
                            renderItem: ({ item }) => row(item),
                            ListHeaderComponent: createElement(Text, null, 'head'),
                            ListFooterComponent: createElement(Text, null, 'foot'),
                        }),
                    );
                    const box = gtkChildren(mount.container)[0] as Gtk.Box;
                    // Three children of the outer box: label, scroller, label. The
                    // header being a SIBLING of the scroller is the declared limit —
                    // inside it, the list stops being the scrollable (measured).
                    expect(gtkChildren(box).map(typeOf)).toStrictEqual(['GtkLabel', 'GtkScrolledWindow', 'GtkLabel']);
                });
            });

            await it('renders ListEmptyComponent INSTEAD of the scroller, and back again', async () => {
                await mounted(async (mount) => {
                    const list = (data: Item[]): ReactElement =>
                        flatList({
                            data,
                            renderItem: ({ item }) => row(item),
                            ListEmptyComponent: createElement(Text, null, 'nothing here'),
                        });
                    await mount.render(list([]));
                    const box = gtkChildren(mount.container)[0] as Gtk.Box;
                    expect(gtkChildren(box).map(typeOf)).toStrictEqual(['GtkLabel']);
                    expect(labels(box)).toStrictEqual(['nothing here']);
                    await mount.render(list([{ title: 'one' }]));
                    expect(gtkChildren(box).map(typeOf)).toStrictEqual(['GtkScrolledWindow']);
                    expect(labels(find(mount.container, 'GtkListView')!)).toStrictEqual(['one']);
                });
            });

            await it('turns horizontal into the box axis AND the scrollbar policies', async () => {
                await mounted(async (mount) => {
                    await mount.render(
                        flatList({
                            horizontal: true,
                            data: [{ title: 'one' }],
                            renderItem: ({ item }) => row(item),
                        }),
                    );
                    const box = gtkChildren(mount.container)[0] as Gtk.Box;
                    expect(box.orientation).toBe(Gtk.Orientation.HORIZONTAL);
                    const scroller = gtkChildren(box)[0] as Gtk.ScrolledWindow;
                    expect(scroller.hscrollbarPolicy).toBe(Gtk.PolicyType.AUTOMATIC);
                    expect(scroller.vscrollbarPolicy).toBe(Gtk.PolicyType.NEVER);
                    expect((scroller.get_child() as Gtk.ListView).orientation).toBe(Gtk.Orientation.HORIZONTAL);
                });
            });

            await it('reaches onEndReached from the scroller’s own Gtk.Adjustment', async () => {
                await mounted(async (mount) => {
                    const seen: number[] = [];
                    await mount.render(
                        flatList({
                            data: [{ title: 'one' }],
                            renderItem: ({ item }) => row(item),
                            onEndReached: ({ distanceFromEnd }) => seen.push(distanceFromEnd),
                        }),
                    );
                    const scroller = find(mount.container, 'GtkScrolledWindow') as Gtk.ScrolledWindow;
                    const adjustment = scroller.get_vadjustment();
                    // Nothing to scroll yet — which is every list before it has been
                    // allocated, and firing there would call `onEndReached` on mount for
                    // every list in an application.
                    expect(seen).toStrictEqual([]);
                    adjustment.set_upper(1000);
                    adjustment.set_page_size(100);
                    adjustment.set_value(100);
                    expect(seen).toStrictEqual([]);
                    adjustment.set_value(880);
                    expect(seen).toStrictEqual([20]);
                    // Once per arrival: scrolling further into the threshold does not
                    // fire again.
                    adjustment.set_value(890);
                    expect(seen).toStrictEqual([20]);
                });
            });

            await it('unmounts every row’s root, so nothing is left for GC to block', async () => {
                // The measured hazard: a factory whose handlers are still connected when
                // its view is collected produced six `Gjs-CRITICAL` lines — "Attempting
                // to call back into JSAPI during the sweeping phase of GC … the JS
                // callback not invoked" — and ran none of them. The diagnostics gate
                // around this describe is what would report them.
                await mounted(async (mount) => {
                    await mount.render(
                        flatList({
                            data: [{ title: 'one' }, { title: 'two' }],
                            renderItem: ({ item }) => row(item),
                        }),
                    );
                    expect(labels(find(mount.container, 'GtkListView')!).length).toBe(2);
                    await mount.render(null);
                    expect(gtkChildren(mount.container).length).toBe(0);
                });
                // NO FORCED COLLECTION HERE, and that is itself a measurement: calling
                // `imports.system.gc()` inside this gate produced
                // "Attempting to run a JS callback during garbage collection … The
                // offending callback was GLogWriterFunc()" and took the runner down with
                // a SIGTERM — because the diagnostics gate's own log writer is a JS
                // callback, and GC blocks those. The hazard this vector is about is
                // asserted the other way round: the gate sees zero diagnostics across a
                // mount and an unmount, which it would not if a row's root or a factory
                // handler were still connected when the widgets went away.
            });
        });

        await gated('the sections, flattened into one model', async () => {
            beforeEach(() => configureStyle({ tokens: TOKENS }));
            afterEach(() => resetStyleConfig());

            await it('emits a header ROW per section, in order', async () => {
                await mounted(async (mount) => {
                    await mount.render(
                        sectionList({
                            sections: [
                                { key: 'fruit', title: 'Fruit', data: [{ title: 'apple' }, { title: 'pear' }] },
                                { key: 'veg', title: 'Veg', data: [{ title: 'leek' }] },
                            ],
                            renderItem: ({ item }) => row(item),
                            renderSectionHeader: ({ section }) => createElement(Text, null, `— ${section.title} —`),
                        }),
                    );
                    expect(labels(find(mount.container, 'GtkListView')!)).toStrictEqual([
                        '— Fruit —',
                        'apple',
                        'pear',
                        '— Veg —',
                        'leek',
                    ]);
                });
            });

            await it('renders items with no header factory when renderSectionHeader is absent', async () => {
                await mounted(async (mount) => {
                    await mount.render(
                        sectionList({
                            sections: [{ key: 'a', data: [{ title: 'only' }] }],
                            renderItem: ({ item }) => row(item),
                        }),
                    );
                    expect(labels(find(mount.container, 'GtkListView')!)).toStrictEqual(['only']);
                });
            });
        });

        await gated('VirtualizedList’s accessor form', async () => {
            beforeEach(() => configureStyle({ tokens: TOKENS }));
            afterEach(() => resetStyleConfig());

            await it('reads the rows through getItem and getItemCount', async () => {
                await mounted(async (mount) => {
                    await mount.render(
                        virtualizedList({
                            data: [{ title: 'x' }, { title: 'y' }, { title: 'z' }],
                            getItemCount: (data) => (data?.length ?? 0) - 1,
                            getItem: (data, index) => (data as Item[])[index + 1]!,
                            keyExtractor: (item: Item) => item.title,
                            renderItem: ({ item }) => row(item),
                        }),
                    );
                    // The accessors are honoured rather than ignored: two rows, starting
                    // at the second item. A component that quietly read `data` would
                    // show three, starting at the first.
                    expect(labels(find(mount.container, 'GtkListView')!)).toStrictEqual(['y', 'z']);
                });
            });
        });

        await gated('what the list family refuses, by name', async () => {
            await it('refuses a missing renderItem rather than rendering empty rows', async () => {
                // A list of correctly sized blank rows is the exact silent failure this
                // package exists to remove, and React Native requires `renderItem` too.
                //
                // The throw happens inside a ROW's render, which happens on the microtask
                // drain rather than inside `mount.render` — so it arrives through the row
                // root's error channel, and `onUncaughtError` is what makes it a value
                // this vector can read instead of a diagnostic the gate counts.
                configureStyle({ tokens: TOKENS });
                const errors: Error[] = [];
                try {
                    await mounted(async (mount) => {
                        await mount.render(
                            flatList({ data: [{ title: 'one' }], onRowError: (error) => errors.push(error) }),
                        );
                        expect(errors.length).toBe(1);
                        expect(errors[0] instanceof PrimitiveError).toBe(true);
                        expect(errors[0]!.message).toContain('nothing to put in a row');
                    });
                } finally {
                    resetStyleConfig();
                }
            });

            await it('refuses renderItem’s separators, which have no widget to restyle', async () => {
                const separators = { current: null as unknown };
                configureStyle({ tokens: TOKENS });
                try {
                    await mounted(async (mount) => {
                        await mount.render(
                            flatList({
                                data: [{ title: 'one' }],
                                renderItem: (info) => {
                                    separators.current = info.separators;
                                    return row(info.item);
                                },
                            }),
                        );
                        const api = separators.current as { highlight(): void; updateProps(): void };
                        expect(threw(() => api.highlight()).message).toContain('no separator widget to restyle');
                        expect(threw(() => api.updateProps()).message).toContain('border-b');
                    });
                } finally {
                    resetStyleConfig();
                }
            });

            await it('keys a row React Native’s way: key, then id, then the index', async () => {
                expect(rowKey({ key: 'k' }, 3)).toBe('k');
                expect(rowKey({ id: 7 }, 3)).toBe('7');
                expect(rowKey({ title: 'no identity' }, 3)).toBe('3');
                expect(rowKey({ key: 'k' }, 3, () => 'mine')).toBe('mine');
            });
        });
    });
};
