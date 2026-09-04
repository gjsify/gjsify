// The Solid L3, and the measurement that turns ADR 0032 § 1 from a claim into a fact.
//
// THE LOAD-BEARING PART OF THIS FILE IS THE PARITY TABLE. Everything else — that a
// Solid tree renders, that a signal reaches GTK, that a refusal is named — could pass
// with an L2 that secretly depended on React, because a second binding written
// against a React-shaped L2 would simply carry the same assumptions. What cannot pass
// that way is ONE authored tree, described in neither framework's spelling, rendered
// through React's reconciler and through Solid's non-reconciler, producing the same
// GTK widget types, the same `css-classes` — generated class names included, which
// means both minted the identical declarations — and the same widget properties.
//
// The class names are worth naming separately: `StyleSheet.classFor` hashes the
// declaration set, so `gjsify-<hash>` being equal on both sides is a byte-level
// assertion that L1's partition produced the same CSS from the same input under both
// frameworks. A comparison that stripped them would have passed with two different
// stylesheets.
//
// EVERY CASE ASSERTS ZERO GTK DIAGNOSTICS, because GTK's failure mode is exit 0: a
// misspelled property, a refused insertion and a null child are all criticals on
// stderr and a process that reports success. `gated` is a local six-liner rather than
// an import, for the reason `widgets.spec.ts` records: `@gjsify/gtk-host`'s own
// version lives in a `.mts` its exports map deliberately does not publish, and
// `@gjsify/unit` keeps ONE `beforeEach`/`afterEach` slot per module and nulls both
// when a `describe` returns — so hooks registered before the first of several
// siblings leave every later one ungated.
//
// AND EVERY REACTIVE CASE MUTATES AFTER THE FIRST RENDER. `solid-js`' own export map
// routes the `node` and `deno` conditions to `dist/server.js` — the SSR build, which
// renders a perfect initial tree and then has no reactivity at all, with no error.
// A render-only smoke test passes against it; only an update can tell the two apart.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import { afterEach, beforeEach, describe, expect, it, on, type Runtime } from '@gjsify/unit';
import { registerBuiltinWidgets } from '@gjsify/gtk-host';
import { dumpTree, gtkChildren, installDiagnosticsGate } from '@gjsify/gtk-host/conformance';
import { MINIMAL_TOKENS, type StyleTokens } from '@gjsify/gtk-host/style';
import { createRoot } from '@gjsify/gtk-host/react';
import { For, createComponent, mount } from '@gjsify/gtk-host/solid';
import { createElement as createReactElement, type ReactNode } from 'react';
import { createSignal } from 'solid-js';

import { PrimitiveError } from '../primitives/errors.js';
import type { TextInputHandle } from '../primitives/handles.js';
import { configureStyle, resetStyleConfig } from '../style-config.js';
import * as react from '../components.js';
import * as solid from './index.js';

/** Named identities, not a capability: a probe that answers "no" stands the suite DOWN, and a suite that ran zero tests reports success. */
const GTK_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

/** The same scale `widgets.spec.ts` uses, so a class name is comparable across both files. */
const TOKENS: StyleTokens = {
    ...MINIMAL_TOKENS,
    spacing: { ...MINIMAL_TOKENS.spacing, '1': '4px', '2': '8px', '4': '16px' },
    colors: { ...MINIMAL_TOKENS.colors, emphasis: 'rgb(17 34 51)' },
};

type PrimitiveName = 'View' | 'Text' | 'Pressable' | 'ScrollView' | 'ActivityIndicator' | 'TextInput' | 'Switch';

/**
 * One authored element, in NEITHER framework's spelling.
 *
 * This is what makes the comparison a comparison. A vector written twice — once as
 * JSX and once as Solid calls — would let the two trees drift by a prop, and the
 * drift would look like a finding. Written once, `toReact` and `toSolid` are the only
 * places a framework appears, and they are eight lines each.
 */
interface Authored {
    readonly primitive: PrimitiveName;
    readonly props?: Readonly<Record<string, unknown>>;
    readonly children?: readonly (Authored | string)[];
}

/**
 * The properties a snapshot reads, in GJS' accessor spelling.
 *
 * Probed rather than looked up: a property the widget's class does not install has no
 * JS accessor, so it reads `undefined` and drops out — which is how one list covers a
 * `Gtk.Label`, a `Gtk.Entry` and an `Adw.Spinner` without a per-widget table. Enum
 * values arrive as numbers, and a number is exactly as comparable as a nick.
 */
const PROBED = [
    'orientation',
    'spacing',
    'halign',
    'valign',
    'hexpand',
    'vexpand',
    'marginTop',
    'marginBottom',
    'marginStart',
    'marginEnd',
    'widthRequest',
    'heightRequest',
    'visible',
    'sensitive',
    'canTarget',
    'overflow',
    'name',
    'label',
    'wrap',
    'lines',
    'ellipsize',
    'selectable',
    'xalign',
    'justify',
    'text',
    'placeholderText',
    'maxLength',
    'visibility',
    'inputPurpose',
    'wrapMode',
    'active',
    'hscrollbarPolicy',
    'vscrollbarPolicy',
] as const;

/**
 * The vacuity guard, and why it counts rather than matches exactly.
 *
 * A deep-equality assertion between two trees passes when both are empty, and "both
 * frameworks rendered nothing" is precisely the failure a parity test exists to
 * catch. So every vector declares the widgets it expects — but as a MULTISET the
 * rendered tree must contain, not as the tree's full type list.
 *
 * MEASURED, and it is the reason: GTK builds widgets of its own inside the ones this
 * layer asks for. A `Gtk.Button` with a label owns an internal `Gtk.Label`, a
 * `Gtk.Entry` owns one too, and a `Gtk.ScrolledWindow` owns a `Gtk.Viewport` and two
 * `Gtk.Scrollbar`s. An exact list would therefore be a claim about the installed
 * GTK's internals rather than about this layer, and it would go red on a GTK release
 * that changed them while the thing under test was still correct. The internals are
 * still fully compared — they are in the snapshots the equality assertion reads.
 */
const OWN_TAGS: ReadonlySet<string> = new Set([
    'GtkBox',
    'GtkLabel',
    'GtkButton',
    'GtkOverlay',
    'GtkScrolledWindow',
    'GtkEntry',
    'GtkTextView',
    'GtkSwitch',
    'AdwSpinner',
]);

/** Declared tags the tree does not hold enough of. Empty is the pass. */
function missingTags(observed: readonly string[], declared: readonly string[]): string[] {
    const left = [...observed];
    const missing: string[] = [];
    for (const tag of declared) {
        const at = left.indexOf(tag);
        if (at === -1) missing.push(tag);
        else left.splice(at, 1);
    }
    return missing;
}

interface Snapshot {
    readonly type: string;
    readonly classes: readonly string[];
    readonly props: Readonly<Record<string, unknown>>;
    readonly children: readonly Snapshot[];
}

const typeOf = (widget: Gtk.Widget): string =>
    // `type_name` is nullable in the GIR (an unregistered GType has no name), and a
    // widget a renderer produced always has one — so the `??` is a narrowing with a
    // sentinel, not a fallback anyone should ever see.
    GObject.type_name((widget as unknown as { constructor: { $gtype: GObject.GType } }).constructor.$gtype) ??
    '(unregistered GType)';

function snapshot(widget: Gtk.Widget): Snapshot {
    const probe = widget as unknown as Record<string, unknown>;
    const props: Record<string, unknown> = {};
    for (const name of PROBED) {
        const value = probe[name];
        // Objects and functions are skipped: a `buffer` or a `child` is the tree this
        // function is already walking, and comparing it here would compare identity.
        if (value === undefined || value === null) continue;
        if (typeof value === 'object' || typeof value === 'function') continue;
        props[name] = value;
    }
    return {
        type: typeOf(widget),
        // The WHOLE list, including the `horizontal`/`vertical` class `Gtk.Orientable`
        // adds behind both layers' backs — ADR 0032 § 5's union rule is only asserted
        // by comparing what GTK put there too.
        classes: [...widget.cssClasses],
        props,
        children: gtkChildren(widget).map(snapshot),
    };
}

const ownTypes = (tree: readonly Snapshot[]): string[] => {
    const out: string[] = [];
    let level = tree;
    while (level.length > 0) {
        for (const node of level) if (OWN_TAGS.has(node.type)) out.push(node.type);
        level = level.flatMap((node) => node.children);
    }
    return out;
};

// --- the two front ends, and nothing else in this file knows a framework ------

function toReact(node: Authored, key?: string): ReactNode {
    const children = (node.children ?? []).map((child, index) =>
        typeof child === 'string' ? child : toReact(child, String(index)),
    );
    const component = react[node.primitive] as unknown as (props: object) => ReactNode;
    return createReactElement(
        component as never,
        { ...(key === undefined ? {} : { key }), ...node.props },
        ...children,
    );
}

/**
 * The same tree, built the way COMPILED SOLID JSX builds one.
 *
 * `children` is a GETTER on the props object, which is what
 * `babel-plugin-jsx-dom-expressions` emits and what makes the L3's evaluation order
 * observable at all: the child components do not exist until something reads it. A
 * plain value here would have hidden the one L2 change this milestone needed, because
 * `Object.entries` over plain values has no side effect.
 */
function toSolid(node: Authored): unknown {
    const component = solid[node.primitive] as unknown as (props: object) => unknown;
    const props: Record<string, unknown> = { ...node.props };
    if (node.children !== undefined) {
        Object.defineProperty(props, 'children', {
            enumerable: true,
            get: () => {
                const children = (node.children ?? []).map((child) =>
                    typeof child === 'string' ? child : toSolid(child),
                );
                return children.length === 1 ? children[0] : children;
            },
        });
    }
    return createComponent(component as never, props as never);
}

const throughReact = (tree: Authored, body: (children: Gtk.Widget[]) => void): void => {
    const container = new Gtk.Box();
    const root = createRoot(container);
    try {
        root.render(toReact(tree));
        body(gtkChildren(container));
    } finally {
        root.unmount();
    }
};

const throughSolid = (tree: Authored, body: (children: Gtk.Widget[]) => void): void => {
    const container = new Gtk.Box();
    const dispose = mount(() => toSolid(tree) as never, container);
    try {
        body(gtkChildren(container));
    } finally {
        dispose();
    }
};

/** Mount a hand-written Solid body, so a vector can hold its own signals. */
const mounted = (code: () => unknown, body: (container: Gtk.Box) => void): void => {
    const container = new Gtk.Box();
    const dispose = mount(() => code() as never, container);
    try {
        body(container);
    } finally {
        dispose();
    }
};

const labelsOf = (widget: Gtk.Widget): (string | undefined)[] =>
    gtkChildren(widget).map((child) => (child as Gtk.Label).label);

/** First strict descendant of a GType, breadth-first over the REAL tree. */
function find(root: Gtk.Widget, gtype: string): Gtk.Widget {
    const queue: Gtk.Widget[] = [...gtkChildren(root)];
    while (queue.length > 0) {
        const widget = queue.shift() as Gtk.Widget;
        if (typeOf(widget) === gtype) return widget;
        queue.push(...gtkChildren(widget));
    }
    throw new Error(`no ${gtype} under:\n${dumpTree(root)}`);
}

interface Vector {
    readonly name: string;
    readonly tree: Authored;
    /** Every tag this layer produces, breadth-first. The guard against comparing two empty trees. */
    readonly types: readonly string[];
}

/**
 * The parity table.
 *
 * Chosen so that between them the vectors exercise every mechanism ADR 0032 names as
 * hard: the two inverted defaults (§ 3's `View` column and `Text` wrap), the
 * orientation-dependent intent resolution (§ 6's `flex-1` and `items-*`), the
 * property/CSS partition (§ 5), the second styleable node (`ScrollView`), the overlay
 * switch (§ 6, decided from the CHILDREN — the one place the two frameworks' build
 * order genuinely differs), the `switchOn` widget swap, and a text alignment that has
 * to travel down to a descendant that can take it.
 */
const VECTORS: readonly Vector[] = [
    {
        name: 'a padded View holding a Text',
        tree: {
            primitive: 'View',
            props: { className: 'p-2' },
            children: [{ primitive: 'Text', children: ['hello'] }],
        },
        types: ['GtkBox', 'GtkLabel'],
    },
    {
        name: 'a row that centres its children on the cross axis',
        tree: {
            primitive: 'View',
            props: { className: 'flex-row items-center gap-x-2' },
            children: [
                { primitive: 'Text', children: ['a'] },
                { primitive: 'Text', children: ['b'] },
            ],
        },
        types: ['GtkBox', 'GtkLabel', 'GtkLabel'],
    },
    {
        name: 'flex-1 in a ROW, which is hexpand',
        tree: {
            primitive: 'View',
            props: { className: 'flex-row' },
            children: [{ primitive: 'Text', props: { className: 'flex-1' }, children: ['wide'] }],
        },
        types: ['GtkBox', 'GtkLabel'],
    },
    {
        name: 'flex-1 in a COLUMN, which is vexpand',
        tree: {
            primitive: 'View',
            children: [{ primitive: 'Text', props: { className: 'flex-1' }, children: ['tall'] }],
        },
        types: ['GtkBox', 'GtkLabel'],
    },
    {
        name: 'self-end beating items-center',
        tree: {
            primitive: 'View',
            props: { className: 'flex-row items-center' },
            children: [{ primitive: 'Text', props: { className: 'self-end' }, children: ['x'] }],
        },
        types: ['GtkBox', 'GtkLabel'],
    },
    {
        name: 'a text alignment travelling down to the label that can take it',
        tree: {
            primitive: 'View',
            props: { className: 'text-center' },
            children: [{ primitive: 'Text', children: ['centred'] }],
        },
        types: ['GtkBox', 'GtkLabel'],
    },
    {
        name: 'a View that becomes a Gtk.Overlay because a CHILD is absolute',
        tree: {
            primitive: 'View',
            props: { className: 'p-2' },
            children: [
                { primitive: 'Text', children: ['body'] },
                { primitive: 'Text', props: { className: 'absolute inset-0' }, children: ['badge'] },
            ],
        },
        types: ['GtkOverlay', 'GtkBox', 'GtkLabel', 'GtkLabel'],
    },
    {
        name: 'a ScrollView with its own content-container class',
        tree: {
            primitive: 'ScrollView',
            props: { contentContainerClassName: 'p-2' },
            children: [{ primitive: 'Text', children: ['row'] }],
        },
        types: ['GtkScrolledWindow', 'GtkBox', 'GtkLabel'],
    },
    {
        name: 'a Pressable with an active: variant',
        tree: { primitive: 'Pressable', props: { className: 'active:opacity-70' }, children: ['Go'] },
        types: ['GtkButton'],
    },
    {
        name: 'a TextInput, which is a Gtk.Entry',
        tree: { primitive: 'TextInput', props: { value: 'x', placeholder: 'p', maxLength: 4 } },
        types: ['GtkEntry'],
    },
    {
        name: 'a multiline TextInput, which is a Gtk.TextView',
        tree: { primitive: 'TextInput', props: { multiline: true } },
        types: ['GtkTextView'],
    },
    {
        name: 'a Switch',
        tree: { primitive: 'Switch', props: { value: true, testID: 'toggle' } },
        types: ['GtkSwitch'],
    },
    {
        name: 'an ActivityIndicator',
        tree: { primitive: 'ActivityIndicator', props: { size: 'small' } },
        types: ['AdwSpinner'],
    },
    {
        name: 'a nested tree with a scroller, a row and a pressable',
        // The ROOT carries no `flex-1`, and that is deliberate. L3 refuses layout
        // that needs a parent at a position where there is none, and the refusal
        // stays: defining a root context made the two bindings DISAGREE (React wrote
        // `vexpand` onto the adopted container, Solid did not), and a feature whose
        // frameworks differ is worse than a refusal. `components.ts` carries the
        // measurement. The parity this vector measures is unaffected — `flex-1` is
        // still exercised one level in, where it resolves against a real parent.
        tree: {
            primitive: 'ScrollView',
            props: { contentContainerClassName: 'p-2 gap-y-1' },
            children: [
                {
                    primitive: 'View',
                    props: { className: 'flex-1 flex-row items-center gap-x-2' },
                    children: [
                        { primitive: 'Text', props: { className: 'flex-1 text-left' }, children: ['title'] },
                        { primitive: 'Pressable', props: { onPress: () => undefined }, children: ['more'] },
                    ],
                },
                { primitive: 'ActivityIndicator', props: { animating: false } },
            ],
        },
        types: ['GtkScrolledWindow', 'GtkBox', 'GtkBox', 'AdwSpinner', 'GtkLabel', 'GtkButton'],
    },
];

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();
        const diagnostics = installDiagnosticsGate();
        const gated = (name: string, run: () => Promise<void>): Promise<void> =>
            describe(name, async () => {
                beforeEach(() => {
                    diagnostics.reset();
                    configureStyle({ tokens: TOKENS });
                });
                afterEach(() => {
                    resetStyleConfig();
                    diagnostics.assertQuiet();
                });
                await run();
            }) as Promise<void>;

        await gated('L2 under two frameworks — the same widgets, or the split is fiction', async () => {
            for (const vector of VECTORS) {
                await it(`${vector.name}: React and Solid produce the identical GTK tree`, async () => {
                    let fromReact: Snapshot[] = [];
                    throughReact(vector.tree, (children) => {
                        fromReact = children.map(snapshot);
                    });
                    let fromSolid: Snapshot[] = [];
                    throughSolid(vector.tree, (children) => {
                        fromSolid = children.map(snapshot);
                    });

                    // The guard first: an assertion between two empty trees is the one
                    // way this test could be green having measured nothing.
                    expect(missingTags(ownTypes(fromReact), vector.types)).toStrictEqual([]);
                    expect(missingTags(ownTypes(fromSolid), vector.types)).toStrictEqual([]);
                    expect(fromReact.length).toBe(1);
                    expect(fromReact[0].type).toBe(vector.types[0]);
                    // Types, `css-classes` (generated names included) and every probed
                    // property, at every depth — GTK's own internal children included.
                    expect(fromSolid).toStrictEqual(fromReact);
                });
            }

            await it('compares the generated class name and not just its shape', async () => {
                // Without this the parity table would pass with `classes: []`
                // everywhere, and "neither framework styled anything" is a way to
                // agree. So: the class list of the ONE vector whose padding must
                // produce a minted name, asserted to hold one.
                const tree: Authored = VECTORS[0].tree;
                let fromReact: Snapshot[] = [];
                throughReact(tree, (children) => {
                    fromReact = children.map(snapshot);
                });
                const generated = fromReact[0].classes.filter((name) => name.startsWith('gjsify-'));
                expect(generated.length).toBe(1);
                let fromSolid: Snapshot[] = [];
                throughSolid(tree, (children) => {
                    fromSolid = children.map(snapshot);
                });
                expect(fromSolid[0].classes.filter((name) => name.startsWith('gjsify-'))).toStrictEqual(generated);
                // GTK's own orientation class survived the whole-list `css-classes`
                // write on both sides — ADR 0032 § 5's union, with GTK as the other
                // author.
                expect(fromSolid[0].classes).toContain('vertical');
            });

            await it('has a comparison that can tell two trees apart', async () => {
                // The control probe, kept rather than run once by hand. `missingTags`
                // is a multiset check and `toStrictEqual` over two snapshots is only
                // as good as `snapshot` is discriminating — a version that read no
                // properties, or walked no children, would make the whole table above
                // pass by construction. So: two vectors that MUST differ, compared
                // with the same function, asserted unequal.
                let a: Snapshot[] = [];
                let b: Snapshot[] = [];
                throughReact(VECTORS[1].tree, (children) => {
                    a = children.map(snapshot);
                });
                throughReact(VECTORS[2].tree, (children) => {
                    b = children.map(snapshot);
                });
                expect(JSON.stringify(a) === JSON.stringify(b)).toBe(false);
                // And the same tree twice IS equal, so the inequality above is about
                // the trees and not about snapshot noise (a widget address, a counter).
                let again: Snapshot[] = [];
                throughReact(VECTORS[1].tree, (children) => {
                    again = children.map(snapshot);
                });
                expect(again).toStrictEqual(a);
            });
        });

        await gated('a real Solid tree, through the real universal renderer', async () => {
            await it('renders a View holding a Text into a widget the application owns', async () => {
                mounted(
                    () =>
                        solid.View({
                            className: 'p-2',
                            // A GETTER for an element child, always: that is what a
                            // Solid JSX compiler emits, and the adapter refuses the
                            // eager form by name (see the refusal gate below).
                            get children() {
                                return solid.Text({ children: 'hello' });
                            },
                        }),
                    (container) => {
                        const box = gtkChildren(container)[0] as Gtk.Box;
                        expect(typeOf(box)).toBe('GtkBox');
                        // The inversion: a React Native `View` is a COLUMN and a
                        // `Gtk.Box` defaults to horizontal.
                        expect(box.orientation).toBe(Gtk.Orientation.VERTICAL);
                        const label = gtkChildren(box)[0] as Gtk.Label;
                        expect(label.label).toBe('hello');
                        // The second inversion, read off the widget.
                        expect(label.wrap).toBe(true);
                    },
                );
            });

            await it('reads props.children exactly ONCE, however often the plan re-derives', async () => {
                // The witness for the one L2 change this milestone needed, and it has
                // to be a counter because nothing in a rendered tree can show the
                // defect. `resolvePrimitive` walks the authored props; under Solid
                // every prop is a GETTER and the one behind `children` BUILDS the
                // subtree. With `Object.entries` there — the shape before this
                // milestone — each plan derivation built a second, unattached copy of
                // every child, outside the provider, for props the loop then skipped
                // by name. The orphans are unparented, GTK says nothing, the window is
                // correct, and the tree doubles on every signal.
                let reads = 0;
                const [wide, setWide] = createSignal(false);
                mounted(
                    () =>
                        solid.View({
                            get className() {
                                return wide() ? 'p-4' : 'p-2';
                            },
                            get children() {
                                reads += 1;
                                return solid.Text({ children: 'x' });
                            },
                        }),
                    () => {
                        expect(reads).toBe(1);
                        setWide(true);
                        // The plan re-derived — the padding class changed — and the
                        // children were not rebuilt.
                        expect(reads).toBe(1);
                    },
                );
            });

            await it('updates a widget property when a signal changes — the reactivity discriminator', async () => {
                const [direction, setDirection] = createSignal('flex-row');
                mounted(
                    () =>
                        solid.View({
                            // A GETTER, which is what compiled JSX emits for a dynamic
                            // prop and the only spelling that makes the plan reactive.
                            get className() {
                                return direction();
                            },
                            get children() {
                                return solid.Text({ children: 'x' });
                            },
                        }),
                    (container) => {
                        const box = gtkChildren(container)[0] as Gtk.Box;
                        expect(box.orientation).toBe(Gtk.Orientation.HORIZONTAL);
                        setDirection('flex-col');
                        // An SSR build renders the row and stops. This line is the only
                        // thing in the file that can tell the two solid builds apart.
                        expect(box.orientation).toBe(Gtk.Orientation.VERTICAL);
                    },
                );
            });

            await it('re-resolves a CHILD when the parent’s axis changes, and removes the stale property', async () => {
                // The whole reason the parent context is published as an ACCESSOR.
                // `flex-1` is `hexpand` in a row and `vexpand` in a column (ADR 0032
                // § 6), the axis belongs to the PARENT, and Solid never re-renders a
                // subtree — so without a signal the child would keep expanding along
                // the axis its parent had when it was created.
                //
                // The second half is the removal: `hexpand` must go back to false, and
                // the only mechanism for that here is `writeProps` writing `undefined`
                // and the host resetting the property to its construction default.
                const [direction, setDirection] = createSignal('flex-row');
                mounted(
                    () =>
                        solid.View({
                            get className() {
                                return direction();
                            },
                            get children() {
                                return solid.Text({ className: 'flex-1', children: 'x' });
                            },
                        }),
                    (container) => {
                        const label = gtkChildren(gtkChildren(container)[0])[0] as Gtk.Label;
                        expect(label.hexpand).toBe(true);
                        expect(label.vexpand).toBe(false);
                        setDirection('flex-col');
                        expect(label.vexpand).toBe(true);
                        expect(label.hexpand).toBe(false);
                    },
                );
            });

            await it('replaces a Text’s text child on an update', async () => {
                const [text, setText] = createSignal('first');
                mounted(
                    () =>
                        solid.Text({
                            get children() {
                                return text();
                            },
                        }),
                    (container) => {
                        const label = gtkChildren(container)[0] as Gtk.Label;
                        expect(label.label).toBe('first');
                        setText('second');
                        // `replaceText` on the SAME text node, into the same sink.
                        expect(label.label).toBe('second');
                    },
                );
            });

            await it('reconciles a <For> of Texts, and a reorder keeps the widgets', async () => {
                const [items, setItems] = createSignal(['a', 'b', 'c']);
                mounted(
                    () =>
                        solid.View({
                            className: 'flex-col',
                            get children() {
                                return createComponent(For, {
                                    get each() {
                                        return items();
                                    },
                                    children: (item: string) => solid.Text({ children: item }) as never,
                                });
                            },
                        }),
                    (container) => {
                        const box = gtkChildren(container)[0] as Gtk.Box;
                        expect(labelsOf(box)).toStrictEqual(['a', 'b', 'c']);
                        const before = gtkChildren(box);
                        setItems(['c', 'b', 'a']);
                        expect(labelsOf(box)).toStrictEqual(['c', 'b', 'a']);
                        // Identity is the point of a keyed list, and it is also the
                        // proof that the L3 handed the children accessor to `insert`
                        // instead of placing them itself: a manual placement would
                        // rebuild every row.
                        expect(gtkChildren(box).filter((w) => before.includes(w)).length).toBe(before.length);
                        setItems(['b']);
                        expect(labelsOf(box)).toStrictEqual(['b']);
                    },
                );
            });

            await it('gives a row added AFTER mount the parent’s inherited alignment', async () => {
                // Why the carrier is Solid's context and not a module-level "current
                // parent" stack. This row's component body runs during an update, long
                // after the synchronous first walk is over; a stack would be empty by
                // then and the row would resolve as a root, with `items-center`
                // silently absent. Only the owner tree still knows whose child it is.
                const [items, setItems] = createSignal(['a']);
                mounted(
                    () =>
                        solid.View({
                            className: 'flex-row items-center',
                            get children() {
                                return createComponent(For, {
                                    get each() {
                                        return items();
                                    },
                                    children: (item: string) => solid.Text({ children: item }) as never,
                                });
                            },
                        }),
                    (container) => {
                        const box = gtkChildren(container)[0] as Gtk.Box;
                        expect((gtkChildren(box)[0] as Gtk.Label).valign).toBe(Gtk.Align.CENTER);
                        setItems(['a', 'b']);
                        const added = gtkChildren(box)[1] as Gtk.Label;
                        expect(added.label).toBe('b');
                        expect(added.valign).toBe(Gtk.Align.CENTER);
                    },
                );
            });

            await it('routes an absolutely positioned child into the overlay slot', async () => {
                mounted(
                    () =>
                        solid.View({
                            className: 'p-2',
                            get children() {
                                return [
                                    solid.Text({ children: 'body' }),
                                    solid.Text({ className: 'absolute inset-0', children: 'badge' }),
                                ];
                            },
                        }),
                    (container) => {
                        const overlay = gtkChildren(container)[0] as Gtk.Overlay;
                        expect(typeOf(overlay)).toBe('GtkOverlay');
                        const box = overlay.get_child() as Gtk.Box;
                        expect(typeOf(box)).toBe('GtkBox');
                        // The ordinary child went into the inner box; the absolute one
                        // sits beside it in the overlay slot, which is only possible
                        // because the child stamped ITSELF and the parent counted the
                        // stamp before its own tag was chosen.
                        expect(labelsOf(box)).toStrictEqual(['body']);
                        const badge = gtkChildren(overlay).find((child) => child !== box) as Gtk.Label;
                        expect(badge.label).toBe('badge');
                        expect(badge.halign).toBe(Gtk.Align.FILL);
                        expect(badge.valign).toBe(Gtk.Align.FILL);
                    },
                );
            });

            await it('puts a ScrollView’s children in the implicit content box', async () => {
                mounted(
                    () =>
                        solid.ScrollView({
                            contentContainerClassName: 'p-2',
                            get children() {
                                return solid.Text({ children: 'row' });
                            },
                        }),
                    (container) => {
                        const scrolled = gtkChildren(container)[0] as Gtk.ScrolledWindow;
                        expect(typeOf(scrolled)).toBe('GtkScrolledWindow');
                        expect(scrolled.hscrollbarPolicy).toBe(Gtk.PolicyType.NEVER);
                        // GTK wraps a scrolled window's child in a `GtkViewport`, so the
                        // box is a DESCENDANT rather than the direct child.
                        const box = find(scrolled, 'GtkBox');
                        expect([...box.cssClasses].filter((name) => name.startsWith('gjsify-')).length).toBe(1);
                        expect(labelsOf(box)).toStrictEqual(['row']);
                    },
                );
            });
        });

        await gated('signals, refs and the values they carry', async () => {
            await it('reaches onPress from a real GTK click', async () => {
                let pressed = 0;
                mounted(
                    () => solid.Pressable({ onPress: () => (pressed += 1), children: 'Go' }),
                    (container) => {
                        const button = gtkChildren(container)[0] as Gtk.Button;
                        expect([...button.cssClasses]).toContain('flat');
                        button.emit('clicked');
                        expect(pressed).toBe(1);
                    },
                );
            });

            await it('calls the LATEST onPress without rebinding the handler', async () => {
                // The React L3 needs a ref plus a memo for this, because its handler
                // identity is new on every render. Solid's props object is stable and
                // its getters are live, so the dispatcher reads the current callback
                // and the host never disconnects anything.
                const seen: string[] = [];
                const [which, setWhich] = createSignal('first');
                mounted(
                    () =>
                        solid.Pressable({
                            get onPress() {
                                const label = which();
                                return () => seen.push(label);
                            },
                            children: 'Go',
                        }),
                    (container) => {
                        const button = gtkChildren(container)[0] as Gtk.Button;
                        button.emit('clicked');
                        setWhich('second');
                        button.emit('clicked');
                        expect(seen).toStrictEqual(['first', 'second']);
                    },
                );
            });

            await it('hands onValueChange the switch’s NEW value, read off the widget', async () => {
                const seen: unknown[] = [];
                mounted(
                    () => solid.Switch({ value: false, onValueChange: (value: boolean) => seen.push(value) }),
                    (container) => {
                        const toggle = gtkChildren(container)[0] as Gtk.Switch;
                        expect(toggle.active).toBe(false);
                        toggle.active = true;
                        // The host strips the emitter and `notify::active` carries no
                        // payload, so this value can only have come off the widget
                        // through `ResolvedEvent.read` — which is L2's answer, not the
                        // adapter's.
                        expect(seen).toStrictEqual([true]);
                    },
                );
            });

            await it('hands onChangeText the entry’s text, once per write', async () => {
                const seen: unknown[] = [];
                mounted(
                    () => solid.TextInput({ value: 'x', onChangeText: (text: string) => seen.push(text) }),
                    (container) => {
                        const entry = gtkChildren(container)[0] as Gtk.Entry;
                        expect(entry.text).toBe('x');
                        entry.text = 'xy';
                        // ONE emission: `gtk_editable_set_text` is a delete plus an
                        // insert, so `Gtk.Editable::changed` would have reported the
                        // intermediate empty string as the user clearing the field.
                        expect(seen).toStrictEqual(['xy']);
                    },
                );
            });

            await it('gives ref the Gtk.Widget itself', async () => {
                let held: unknown = null;
                mounted(
                    () => solid.View({ testID: 'held', ref: (widget: unknown) => (held = widget) }),
                    (container) => {
                        const box = gtkChildren(container)[0];
                        expect(held === box).toBe(true);
                        expect((box as Gtk.Widget).name).toBe('held');
                    },
                );
            });

            await it('gives a TextInput ref the same imperative handle React gets', async () => {
                // The handle is L2's (`plan.handle`), so the two bindings cannot
                // disagree about it — which is the whole reason it is a table field
                // rather than something either L3 assembles. One built inside the React
                // binding would have been a vocabulary this one does not have.
                let held: unknown = null;
                mounted(
                    () => solid.TextInput({ value: 'hello', ref: (handle: unknown) => (held = handle) }),
                    (container) => {
                        const entry = gtkChildren(container)[0] as Gtk.Entry;
                        const handle = held as TextInputHandle;
                        expect(handle.widget).toBe(entry);
                        handle.clear();
                        expect(entry.text).toBe('');
                    },
                );
            });

            await it('announces a Text live region when the SIGNAL changes its content', async () => {
                // The application's own change, not one made from outside — which is
                // the only one a live region is for, and the one the host's echo guard
                // hides from a handler bound as a prop (`announce.ts`). Solid's update
                // path here is `replaceText` into the same sink, and it is still a host
                // write, so this is the same claim the React binding's vector makes
                // through a re-render.
                const seen: [string, number][] = [];
                const [text, setText] = createSignal('first');
                mounted(
                    () =>
                        solid.Text({
                            accessibilityLiveRegion: 'assertive',
                            get children() {
                                return text();
                            },
                        }),
                    (container) => {
                        const label = gtkChildren(container)[0] as Gtk.Label;
                        (label as unknown as Record<string, unknown>).announce = (message: string, priority: number) =>
                            seen.push([message, priority]);
                        setText('second');
                        expect(seen).toStrictEqual([['second', Gtk.AccessibleAnnouncementPriority.HIGH]]);
                    },
                );
            });

            await it('writes the accessibility props into the AT context, as the React binding does', async () => {
                // The parity claim that matters for this feature: the CALL lives in
                // one shared module, so what a vector here proves is that this
                // binding reaches it at all — Solid has no commit phase, so the
                // effect is wired differently and could be wired to nothing.
                mounted(
                    () =>
                        solid.View({
                            accessibilityLabel: 'Save document',
                            accessibilityRole: 'button',
                            accessibilityState: { checked: 'mixed' },
                        }),
                    (container) => {
                        const box = gtkChildren(container)[0] as Gtk.Widget;
                        expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.LABEL)).toBe(true);
                        expect(Gtk.test_accessible_has_state(box, Gtk.AccessibleState.CHECKED)).toBe(true);
                        expect(Gtk.test_accessible_has_role(box, Gtk.AccessibleRole.BUTTON)).toBe(true);
                    },
                );
            });

            await it('re-applies an accessible property when a signal changes it', async () => {
                // Solid's element is created ONCE, so a changed label has nowhere to
                // arrive except this effect — and a label that stopped updating would
                // leave a screen reader reading the first value forever.
                const [label, setLabel] = createSignal('first');
                mounted(
                    () =>
                        solid.View({
                            get accessibilityLabel() {
                                return label();
                            },
                        }),
                    (container) => {
                        const box = gtkChildren(container)[0] as Gtk.Widget;
                        expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.LABEL)).toBe(true);
                        // PRESENCE ALONE CANNOT TELL "re-applied" FROM "never re-ran":
                        // the first write already set the attribute, so it stays set
                        // either way. So the CALL is counted as well — the instance
                        // method is shadowed and calls through, which is the technique
                        // the live-region vectors use for the same reason.
                        const original = box.update_property.bind(box);
                        let calls = 0;
                        (box as unknown as Record<string, unknown>).update_property = (
                            properties: Gtk.AccessibleProperty[],
                            values: unknown[],
                        ) => {
                            calls += 1;
                            original(properties, values as never);
                        };
                        setLabel('second');
                        expect(calls).toBe(1);
                        // …and the re-application did not leave the attribute reset by
                        // its own cleanup, which is the ordering defect this shape has.
                        expect(Gtk.test_accessible_has_property(box, Gtk.AccessibleProperty.LABEL)).toBe(true);
                    },
                );
            });
        });

        await gated('what it refuses, by name', async () => {
            const refusal = (body: () => void): PrimitiveError => {
                let error: unknown = null;
                try {
                    body();
                } catch (caught) {
                    error = caught;
                }
                if (!(error instanceof PrimitiveError)) {
                    throw new Error(`expected a PrimitiveError, got ${String(error)}`);
                }
                return error;
            };

            await it('refuses an unlisted prop rather than dropping it', async () => {
                const error = refusal(() =>
                    mounted(
                        () => solid.View({ nonsuch: 1 } as never),
                        () => undefined,
                    ),
                );
                expect(error.message).toContain('prop "nonsuch"');
                expect(error.message).toContain('is not a prop this primitive answers for');
            });

            await it('refuses an absolute child whose parent cannot become an overlay', async () => {
                // The published `overlay` is L2's own answer to "would you host one",
                // and a `Pressable` answers no — so the child's refusal is the same
                // sentence React gets, from the same place.
                const error = refusal(() =>
                    mounted(
                        () =>
                            solid.Pressable({
                                get children() {
                                    return solid.Text({ className: 'absolute inset-0', children: 'badge' });
                                },
                            }),
                        () => undefined,
                    ),
                );
                expect(error.message).toContain('has to be a `Gtk.Overlay`');
            });

            await it('refuses children-as-a-function-of-{ pressed }', async () => {
                const error = refusal(() =>
                    mounted(
                        () =>
                            solid.Pressable({
                                get children() {
                                    return ((state: { pressed: boolean }) => String(state.pressed)) as never;
                                },
                            }),
                        () => undefined,
                    ),
                );
                expect(error.message).toContain('function that takes an argument');
                expect(error.message).toContain('active:opacity-70');
            });

            await it('refuses a reactive update that would change the WIDGET', async () => {
                // `multiline` swaps `Gtk.Entry` for `Gtk.TextView` (L2's `switchOn`),
                // and a Solid element is created once — there is no commit that could
                // replace it. React's reconciler can do this; naming the difference is
                // the alternative to a tree that renders the old widget for ever.
                const [multiline, setMultiline] = createSignal(false);
                const error = refusal(() =>
                    mounted(
                        () =>
                            solid.TextInput({
                                get multiline() {
                                    return multiline();
                                },
                            }),
                        () => setMultiline(true),
                    ),
                );
                expect(error.message).toContain('GtkEntry');
                expect(error.message).toContain('GtkTextView');
                expect(error.message).toContain('a Solid element is created once');
            });

            await it('refuses a child that was built before its parent', async () => {
                // The one mistake a lazy-children framework makes possible, and it is
                // silent without this: the child resolves outside the parent's
                // provider, so L2 is handed no parent, `flex-1` stays in
                // `plan.intent`, and the widget renders without expanding. Found by
                // this file's own first draft, four times.
                const error = refusal(() =>
                    mounted(
                        () => solid.View({ className: 'flex-row', children: solid.Text({ className: 'flex-1' }) }),
                        () => undefined,
                    ),
                );
                expect(error.message).toContain('built BEFORE this one');
                expect(error.message).toContain('get children()');
            });

            await it('refuses an unknown utility from L1, unwrapped', async () => {
                // Not a `PrimitiveError`: L1's `UnknownUtilityError` already names the
                // utility and lists what the scale holds, and L2 deliberately does not
                // re-wrap it. Asserting that here is asserting the layer boundary.
                let error: unknown = null;
                try {
                    mounted(
                        () => solid.View({ className: 'mt-nonsuch' }),
                        () => undefined,
                    );
                } catch (caught) {
                    error = caught;
                }
                expect(error instanceof PrimitiveError).toBe(false);
                expect(String((error as Error | null)?.message)).toContain('mt-nonsuch');
            });
        });
    });
};
