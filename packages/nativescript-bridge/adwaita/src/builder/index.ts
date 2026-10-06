// THE `xmlns`-BARREL TREE BUILDER, SHIPPED — the NativeScript half of what PR #1726 did for
// `packages/framework/gtk-host`: `elementFor`/`build` are the dialect's OWN interpreter (ADR
// 0034 § Amendment 9), not a test helper, so keeping them in a `.spec.ts` file put production
// logic where only a test entry could ever reach it.
//
// REACHABILITY IS THE RULE THIS FILE MUST NOT BREAK. The namespace barrels below
// (`../namespace/adw.js`, `../namespace/gtk.js`) evaluate EVERY widget class in this package
// at module scope, and every widget module opens with a value import from `@nativescript/core`
// — unresolvable off a device unless aliased. An app reaches this module through the package's
// `./builder` subpath export, on a device where `@nativescript/core` is real, and builds the
// `?shared-tree` projection of a `.blp` with it. Inside this package it may be imported ONLY from
// `src/test.trees.mts`, whose two builds supply `--alias @nativescript/core=../testing/ns-core.mjs`
// (`package.json` `build:test:trees:{gjs,node}`). It must NEVER be reachable from `src/index.ts`
// (that entry already reaches every widget on its own terms, but re-exporting this from there
// would put test-only tooling on the public API) and NEVER from `src/test.mts` (that entry
// bundles every OTHER spec in this package with no alias at all — one edge into this file
// would drag `@nativescript/core` under specs that build without it today, silently, the same
// class of defect the package's own AGENTS.md names for the ONE existing exception).
//
// THE ONLY THING THIS FILE NEEDS FROM `@nativescript/core` ITSELF IS THE `View` CLASS, as the
// one test that tells a widget from a VALUE object (below). It adds no specifier the barrels
// do not already carry — every widget module opens with a value import of the same package —
// so it changes nothing about which alias a build needs. This module still does not depend on
// the testing double's OWN directory depth (`src/testing/ns-core.mjs`, one level under `src/`,
// per the alias's own relative target): it names the package, never the double's path.
//
// The `throw`s in {@link build} and `buildNode` are door refusals, not test assertions — ADR
// 0051 Amendment 3 broke the first three on purpose to prove each fires — and they moved here
// with the function they belong to. The two about ids (an unknown one, a duplicate one) are
// GtkBuilder's own refusals, restated where the ids are resolved.

import { createBreakpointDriver, parseBreakpointCondition, type BreakpointSize } from '@gjsify/adwaita-core';
import { assertTreeConstructs, type SharedTreeNode } from '@gjsify/adwaita-core/conformance';
import { propertyOf } from '@gjsify/adwaita-core/tags';
import { View } from '@nativescript/core';

import { capabilities } from '../capabilities.js';
import { observeWindowSize } from '../widgets/breakpoint.js';
import { declaredBuilderReferences, declaredBuilderSlots } from '../widgets/builder-slots.js';
import { templateClassFor } from './template-classes.js';

export { registerTemplateClass } from './template-classes.js';

// The two `xmlns` barrels this package owns, one module per library (ADR 0034 § Amendment 9).
// Imported as MODULE NAMESPACES because that is literally what this door is:
// `component-builder`'s `createComponentInstance` ends in `instanceModule[elementName]`, and
// the prefix selects the module. Importing the widget classes by name instead would be a
// per-widget table and would skip the door entirely.
import * as Adw from '../namespace/adw.js';
import * as Gtk from '../namespace/gtk.js';

/**
 * A class the barrel offers as an element. A widget is built with NO arguments, as
 * NativeScript builds one; a value object ({@link build}) takes its construct bag.
 */
export type ElementClass = new (props?: Record<string, unknown>) => object;

/** `AdwSwitchRow` -> `<adw:SwitchRow>`: the element name, and the class behind it. */
export interface Element {
    /** The XML name this dialect spells, which is also what an XML child arrives under. */
    xmlName: string;
    ctor: ElementClass;
}

/** One library's barrel: the `xmlns` prefix an app declares, the GIR name its classes start with, its module. */
interface Barrel {
    prefix: string;
    library: string;
    namespace: object;
}

const BARRELS: Barrel[] = [
    { prefix: 'adw', library: 'Adw', namespace: Adw },
    { prefix: 'gtk', library: 'Gtk', namespace: Gtk },
];

/**
 * Teach {@link elementFor} one more library, so a `.blp` that says `using GtkSource 5;` builds.
 *
 * The barrels above are the two this package OWNS. Every other library's widgets live in a
 * package that depends on THIS one (`@gjsify/gtksource-nativescript` imports
 * `@gjsify/adwaita-nativescript`), so this package cannot import them back: the library
 * registers itself instead, from its own `./builder` subpath, and an app opts in by importing
 * that subpath once beside this one.
 *
 * `library` is the GIR namespace a tag starts with (`GtkSource` for `GtkSourceView`) and
 * `namespace` is the module whose members are the classes, each named by its full GIR name as
 * the `Adw` and `Gtk` barrels do. The longest library wins a tag, because `GtkSourceView`
 * starts with `Gtk` too. Registering the same prefix twice replaces the first, which is what
 * a hot reload does; a prefix that belongs to another library
 * is refused, because two libraries behind one `xmlns` prefix is a widget built from the wrong one.
 */
export function registerBarrel(prefix: string, library: string, namespace: object): void {
    const known = BARRELS.find((barrel) => barrel.prefix === prefix);
    if (known !== undefined && known.library !== library) {
        throw new Error(
            `The prefix '${prefix}' already names \`${known.library}\`; it cannot also name \`${library}\`.`,
        );
    }
    if (known === undefined) BARRELS.push({ prefix, library, namespace });
    else known.namespace = namespace;
}

/**
 * The element a GIR class name is, in the `xmlns` barrel dialect.
 *
 * THE WHOLE TRANSFORM, and it is a split rather than a table: the prefix names the library,
 * the member is the rest. What makes it safe is that the member is then READ OFF THE BARREL
 * — the same module NativeScript would read — so a placement this split gets wrong is a
 * missing member and throws, never another library's widget under this prefix. That is the
 * measured hazard `generate-adwaita-nativescript-templates.mjs` records as the
 * prefix-as-membership-test defect: the defect was deciding placement from the name ALONE.
 *
 * The class the barrel hands back must be the class the corpus NAMED, which is ADR 0034
 * clause 1 — a widget is named after the library owning its GType — held at runtime instead
 * of taken on trust. (The tree-driver bundles that reach this function are built
 * `--no-minify` so a class name is the one the source declares; a mangled one fails here
 * rather than resolving to a stranger.)
 */
export function elementFor(tag: string): Element {
    const byLength = [...BARRELS].sort((a, b) => b.library.length - a.library.length);
    for (const { prefix, library, namespace } of byLength) {
        if (!tag.startsWith(library)) continue;
        const member = tag.slice(library.length);
        const exported = (namespace as Record<string, unknown>)[member];
        if (typeof exported !== 'function') {
            throw new Error(
                `Module '~/${prefix}' has no member for element '${prefix}:${member}' — the name ` +
                    `\`${tag}\` is authored in the shared corpus and this dialect cannot spell it. Give the ` +
                    'widget a namespace member (ADR 0034 clause 2), or ledger the block as divergent.',
            );
        }
        if (exported.name !== tag) {
            throw new Error(
                `'${prefix}:${member}' resolves to class \`${exported.name}\`, not \`${tag}\`. The corpus is ` +
                    'authored in GIR class names and ADR 0034 clause 1 says a widget carries that name, so a ' +
                    'barrel member bound to another class would build the wrong widget at exit 0.',
            );
        }
        return { xmlName: `${prefix}:${member}`, ctor: exported as ElementClass };
    }
    throw new Error(
        `\`${tag}\` starts with no library this dialect has a barrel for (${BARRELS.map((barrel) => barrel.prefix).join(', ')}).`,
    );
}

/**
 * The element a NODE is: the registered class for an `extern` node (ADR 0093), else the barrel
 * member its GIR tag names. The `app:` prefix is only what an error prints, as `adw:` is for a
 * barrel member.
 */
function elementOf(node: SharedTreeNode): Element {
    if (node.extern === true) return { xmlName: `app:${node.tag}`, ctor: templateClassFor(node.tag) };
    return elementFor(node.tag);
}

/** What a parent must be for an XML child to reach a slot rather than the first cell. */
interface BuilderParent {
    _addChildFromBuilder(name: string, child: object): void;
}

/** An object-valued property waiting for the rest of the tree, and the id it names. */
interface PendingReference {
    view: View;
    element: Element;
    prop: string;
    id: string;
}

/** What one {@link build} call collects while it walks the tree. */
interface BuildContext {
    ids: Map<string, View>;
    pending: PendingReference[];
    /** The `bindings` of every node, resolved once every id exists (a source may be built after its target). */
    binds: PendingBind[];
    /** The nodes that carry `breakpoints`, wired once every id exists (a setter may name a later sibling). */
    breakpointHosts: { view: object; element: Element; node: SharedTreeNode }[];
    observeSize: SizeSource;
    scope: Readonly<Record<string, unknown>> | undefined;
    /**
     * Where a VALUE object's id goes, when the caller can ask for it ({@link buildWithSiblings}).
     * Undefined for `build`, whose one return value cannot hand a dialog or a stack page back, so
     * an id on one is refused rather than dropped.
     */
    values: Map<string, object> | undefined;
}

interface PendingBind {
    target: object;
    element: Element;
    property: string;
    source: string;
    sourceProperty: string;
    flags: readonly string[];
}

/** Calls `onSize` with the view's measured size, now and on every change; returns its disposer. */
export type SizeSource = (view: View, onSize: (size: BreakpointSize) => void) => () => void;

/** What a caller hands {@link build} beside the tree. */
export interface BuildOptions {
    /** Where a `breakpoints` node reads its size from; the view's post-layout size unless supplied. */
    observeSize?: SizeSource;
    /** The object a signal handler's NAME is resolved against (ADR 0093 § 3), as `Gtk.BuilderScope` does. */
    scope?: Readonly<Record<string, unknown>>;
}

/**
 * Build one authored node the way NativeScript's XML builder does: construct with no
 * arguments, write the attributes, then hand each child to the parent's own child door
 * under the name its placement asks for ({@link builderNameFor}).
 *
 * AN OBJECT-VALUED PROPERTY IS WRITTEN LAST, with the object. `stack: stack` in a `.blp`
 * projects as the string `"stack"`, and GtkBuilder resolves it to the object with that id
 * once the whole file is parsed — which is what lets a switcher above its stack name it. The
 * properties a widget declares object-valued (`builderReferences`, `widgets/builder-slots.ts`)
 * are held back the same way here and assigned once every node exists, so the switcher also
 * binds to a stack whose pages are all in. An id nothing in the tree carries is refused, as
 * GtkBuilder refuses an unknown object id, rather than handing the widget a string.
 *
 * AN ATTRIBUTE IS ALWAYS A STRING, and that is the door rather than a choice of this
 * builder: `setPropertyValue` ends in `instance[name] = value` with no conversion at all for
 * a plain accessor, so a setter declared `boolean` is handed `'true'`. Writing the authored
 * boolean instead would drive the construct-props bag — a different door — and would leave
 * the coercion `widgets/xml-values.ts` exists for untested on the trees the website ships.
 *
 * AN ATTRIBUTE THAT LANDS NOWHERE IS REFUSED HERE. `instance[name] = value` on a name
 * nothing declares adds a dead own-property and returns, at exit 0 — this surface's own
 * silent drop. The membership test runs BEFORE the write, because afterwards the dead
 * property answers it.
 *
 * The root is always a widget: a tree whose root is a value object has nothing to show.
 */
export function build(node: SharedTreeNode, options: BuildOptions = {}): View {
    refuseSiblings(node, 'build');
    const built = buildTree(node, options).root;
    if (!(built instanceof View)) {
        throw new Error(`\`${node.tag}\` is not a widget, so a tree cannot root at it: there is nothing to show.`);
    }
    return built;
}

/** What {@link buildDialog} hands back: the object `present()` is called on. */
export interface PresentableRoot {
    present(): unknown;
}

/**
 * A tree rooted at a DIALOG — ADR 0072's `responses`.
 *
 * This port's `Adw.AlertDialog` is not a `View`: it presents through the platform's own
 * dialog, so {@link build} rightly refuses it as a root. Its own entry point keeps that
 * refusal intact for every other value object, and admits a root by the one method a dialog
 * is for rather than by a class list.
 */
export function buildDialog(node: SharedTreeNode, options: BuildOptions = {}): PresentableRoot {
    refuseSiblings(node, 'buildDialog');
    const built = buildTree(node, options).root;
    if (built instanceof View || typeof (built as Partial<PresentableRoot>).present !== 'function') {
        throw new Error(`\`${node.tag}\` is not a dialog: it has no \`present()\`, so use \`build\` for it.`);
    }
    return built as PresentableRoot;
}

/** What {@link buildWithSiblings} hands back: the root widget and the objects built beside it. */
export interface BuiltTree {
    /** The widget the tree roots at, as {@link build} returns it. */
    root: View;
    /**
     * The sibling objects by id — `Adw.AlertDialog unsavedChangesDialog { }` or `$Learn learn { }`
     * written after the template. A sibling is built in the root's id scope (a setter or a
     * reference may name it) but is no child of the root: the code beside the file decides where,
     * or whether, it is placed.
     */
    siblings: ReadonlyMap<string, object>;
    /**
     * Every object the tree names by id, widget or value, siblings included: what
     * `GtkBuilder.get_object` answers for in GTK. A value object (a `Gtk.StackPage`, a dialog)
     * has no other way to be reached, because `getViewById` walks views.
     */
    objects: ReadonlyMap<string, object>;
}

/**
 * A tree with sibling roots (ADR 0093): the root widget, and each sibling object by id.
 *
 * {@link build} and {@link buildDialog} refuse such a tree by name, because they return one
 * object and the siblings would be built and then thrown away. A sibling with no id is refused
 * too: nothing could ever ask for it, which is how a dropped object looks finished.
 */
export function buildWithSiblings(node: SharedTreeNode, options: BuildOptions = {}): BuiltTree {
    const built = buildTree(node, options, true);
    if (!(built.root instanceof View)) {
        throw new Error(`\`${node.tag}\` is not a widget, so a tree cannot root at it: there is nothing to show.`);
    }
    return { root: built.root, siblings: built.siblings, objects: built.objects };
}

function refuseSiblings(node: SharedTreeNode, door: string): void {
    if ((node.siblings?.length ?? 0) === 0) return;
    throw new Error(
        `\`${node.tag}\` carries ${node.siblings!.length} sibling object(s), and \`${door}\` returns one object ` +
            'so they would be built and lost. Use `buildWithSiblings`, which hands them back by id.',
    );
}

/** Every node, then every held-back object reference resolved against the ids the tree built. */
function buildTree(
    node: SharedTreeNode,
    options: BuildOptions,
    collectValues = false,
): { root: View | object } & Pick<BuiltTree, 'siblings' | 'objects'> {
    // ADR 0093 § 2: the whole tree against the capability table, before anything is created.
    assertTreeConstructs('adwaita-nativescript', capabilities, node);
    const context: BuildContext = {
        ids: new Map(),
        pending: [],
        binds: [],
        breakpointHosts: [],
        observeSize: options.observeSize ?? observeWindowSize,
        scope: options.scope,
        values: collectValues ? new Map() : undefined,
    };
    const root = buildNode(node, context);
    const siblings = new Map<string, object>();
    for (const sibling of node.siblings ?? []) {
        if (sibling.id === undefined) {
            throw new Error(
                `the sibling \`${sibling.tag}\` has no id, so nothing could ever ask for it: give it one in the .blp.`,
            );
        }
        siblings.set(sibling.id, buildNode(sibling, context));
    }
    for (const { view, element, prop, id } of context.pending) {
        const target = context.ids.get(id);
        if (target === undefined) {
            throw new Error(
                `<${element.xmlName} ${prop}="${id}"> names no object: nothing in this tree has the id '${id}', ` +
                    `so \`${prop}\` would be handed the string instead of the widget it refers to.`,
            );
        }
        (view as unknown as Record<string, unknown>)[prop] = target;
    }
    for (const bind of context.binds) bindProperty(bind, context);
    for (const host of context.breakpointHosts) bindBreakpoints(host, context);
    return { root, siblings, objects: new Map([...context.ids, ...(context.values ?? [])]) };
}

/**
 * ADR 0093's `bindings`, the simple form: the target property takes the source's value now and
 * again on every `notify::<property>` the source emits (`G_BINDING_SYNC_CREATE`, which is what
 * GtkBuilder's `bind-flags` default means).
 *
 * Refused by name, never dropped: a source that is not an id of this tree (`template` included),
 * a source class that does not emit `notify::<property>`, a target without that property, and
 * any flag, which this first slice has not verified.
 */
function bindProperty(bind: PendingBind, context: BuildContext): void {
    const { target, element, property, source, sourceProperty, flags } = bind;
    const where = `<${element.xmlName}> \`${property}: bind ${source}.${sourceProperty}\``;
    const from = context.ids.get(source);
    if (from === undefined) {
        throw new Error(`${where} names no object: nothing in this tree has the id '${source}'.`);
    }
    if (flags.length > 0) {
        throw new Error(
            `${where} carries ${flags.join(', ')}: adwaita-nativescript binds the plain form only until each flag ` +
                'is verified against GObject.',
        );
    }
    const sourceProp = propertyOf(sourceProperty);
    const targetProp = propertyOf(property);
    const emitted = (from.constructor as { emittedSignals?: readonly string[] }).emittedSignals ?? [];
    const notification = `notify::${sourceProperty}`;
    if (!(sourceProp in from) || !emitted.includes(notification)) {
        throw new Error(
            `${where}: ${from.constructor.name} does not emit '${notification}', so the target would follow the ` +
                `source once and never again. It emits: ${emitted.join(', ') || 'none'}.`,
        );
    }
    if (!(targetProp in target)) {
        throw new Error(`${where}: the target has no property '${targetProp}'.`);
    }
    const follow = () => {
        (target as Record<string, unknown>)[targetProp] = (from as unknown as Record<string, unknown>)[sourceProp];
    };
    follow();
    (from as unknown as { connect(name: string, callback: () => void): number }).connect(notification, follow);
}

/**
 * ADR 0093's `breakpoints`: each setter's `object` resolves to the view built for that id and the
 * write is the one an authored prop takes (the value as its string, which the property's setter
 * coerces). The parent's post-layout size is the size source, which is the window's on a root
 * view; `adwaita-core` picks the breakpoint and the restores.
 *
 * Refused by name, never dropped: a host that is not a view, a setter whose object is not an id of
 * this tree (`template` included), a property the target does not declare, and a condition the
 * grammar cannot read, which libadwaita would drop silently.
 */
function bindBreakpoints(
    { view, element, node }: BuildContext['breakpointHosts'][number],
    context: BuildContext,
): void {
    if (!(view instanceof View)) {
        throw new Error(`<${element.xmlName}> is not a view, so it has no size for a breakpoint to read.`);
    }
    wireBreakpoints(element.xmlName, view, node.breakpoints ?? [], context.ids, context.observeSize);
}

/**
 * The breakpoints of a view the application built itself, for a shell that is not (yet) a tree:
 * the same data `breakpoints` carries, wired the same way. `ids` names the views the setters
 * address; `host` is the view whose size decides (the window's, when it is the root).
 */
export function applyBreakpoints(
    host: View,
    breakpoints: NonNullable<SharedTreeNode['breakpoints']>,
    ids: Readonly<Record<string, View>>,
    options: Pick<BuildOptions, 'observeSize'> = {},
): void {
    wireBreakpoints(
        host.constructor.name,
        host,
        breakpoints,
        new Map(Object.entries(ids)),
        options.observeSize ?? observeWindowSize,
    );
}

function wireBreakpoints(
    owner: string,
    view: View,
    breakpoints: NonNullable<SharedTreeNode['breakpoints']>,
    ids: ReadonlyMap<string, View>,
    observeSize: SizeSource,
): void {
    const definitions = breakpoints.map((breakpoint) => {
        if (parseBreakpointCondition(breakpoint.condition) === null) {
            throw new Error(
                `<${owner}> \`condition ("${breakpoint.condition}")\` is not an Adwaita breakpoint condition.`,
            );
        }
        return {
            condition: breakpoint.condition,
            setters: breakpoint.setters.map((setter) => {
                const object = ids.get(setter.object);
                const where = `<${owner}> breakpoint setter \`${setter.object}.${setter.property}\``;
                if (object === undefined) {
                    throw new Error(`${where} names no object: nothing in this tree has the id '${setter.object}'.`);
                }
                if (!(propertyOf(setter.property) in object)) {
                    throw new Error(`${where}: the target declares no '${propertyOf(setter.property)}'.`);
                }
                return { object, property: setter.property, value: { authored: setter.value } };
            }),
        };
    });
    const driver = createBreakpointDriver<View>(definitions, {
        read: (target, property) => ({
            original: (target as unknown as Record<string, unknown>)[propertyOf(property)],
        }),
        write(target, property, value) {
            const slot = value as { authored: unknown } | { original: unknown };
            (target as unknown as Record<string, unknown>)[propertyOf(property)] =
                'authored' in slot ? String(slot.authored) : slot.original;
        },
    });
    observeSize(view, (size) => driver.evaluate(size));
}

/**
 * One node, widget or VALUE OBJECT.
 *
 * A VALUE OBJECT is what the barrel offers that is not a `View`: `Gtk.Adjustment`,
 * `Gtk.StringList`, `Adw.Toggle`, `Adw.SidebarSection`, `Adw.SidebarItem`. In GTK they are
 * GObjects that are not widgets, and a `.blp` writes them where a widget would go —
 * `adjustment: Adjustment { … }`, `Adw.Toggle { … }` inside a toggle group. They have no
 * place in the view tree, so they cannot be written the way a widget is: their fields are
 * plain data with no XML coercion behind them, and `lower = '0'` would reach
 * `normalizeAdjustment`'s arithmetic as a string. So a value object is built the way GJS
 * builds one, from ONE construct bag carrying the authored values as authored (a number
 * stays a number), and it is handed to its parent's child door like any other child — the
 * parent decides what it means, as `GtkBuildable.add_child` does.
 *
 * The same refusals hold: a property the object does not declare is refused by name before
 * construction. An id and style classes are refused too — `getViewById` walks views and a
 * value object has no class list — rather than dropped.
 */
function buildNode(node: SharedTreeNode, context: BuildContext): View | object {
    const element = elementOf(node);
    const probe = new element.ctor();
    const built =
        probe instanceof View ? buildView(node, element, probe, context) : buildValue(node, element, probe, context);
    bindSignals(built, element, node, context);
    for (const [property, binding] of Object.entries(node.bindings ?? {})) {
        context.binds.push({
            target: built,
            element,
            property,
            source: binding.source,
            sourceProperty: binding.property,
            flags: binding.flags ?? [],
        });
    }
    if (node.breakpoints !== undefined) context.breakpointHosts.push({ view: built, element, node });
    for (const child of node.children ?? []) {
        const parent = built as Partial<BuilderParent>;
        if (typeof parent._addChildFromBuilder !== 'function') {
            throw new Error(
                `<${element.xmlName}> takes no XML child: \`${node.tag}\` has no \`_addChildFromBuilder\`, so ` +
                    'the corpus nests a node this element cannot hold.',
            );
        }
        const childBuilt = buildNode(child, context);
        applyLayout(child, childBuilt, element, node.tag);
        parent._addChildFromBuilder(builderNameFor(element, node.tag, child), childBuilt);
    }
    return built;
}

/**
 * ADR 0093's `signals`: each handler NAME is looked up on the scope and connected through the
 * widget's GJS-shaped `connect`, which hands the callback `(self, data)`.
 *
 * Refused by name, never dropped: a value object (no `connect`), a signal the class does not
 * declare in `emittedSignals`, a missing scope or handler (as `Gtk.Builder` refuses one), and the
 * `swapped`, `after` and `object` forms, which this first slice has not verified.
 */
function bindSignals(built: object, element: Element, node: SharedTreeNode, context: BuildContext): void {
    if (node.signals === undefined) return;
    const emitted = (element.ctor as { emittedSignals?: readonly string[] }).emittedSignals ?? [];
    const connectable = built as Partial<{ connect(name: string, callback: (...args: unknown[]) => void): number }>;
    for (const signal of node.signals) {
        const name = signal.detail === undefined ? signal.name : `${signal.name}::${signal.detail}`;
        if (typeof connectable.connect !== 'function' || !emitted.includes(name)) {
            throw new Error(
                `<${element.xmlName}> declares no signal '${name}', so the handler '${signal.handler}' would never ` +
                    `run. It emits: ${emitted.join(', ') || 'none'}.`,
            );
        }
        if (signal.object !== undefined || (signal.flags?.length ?? 0) > 0) {
            throw new Error(
                `the handler '${signal.handler}' for '${name}' uses ${signal.object === undefined ? '' : 'an object '}` +
                    `${(signal.flags ?? []).join(', ')}: adwaita-nativescript binds plain handlers only until each ` +
                    'of those is verified against GTK.',
            );
        }
        const handler = context.scope?.[signal.handler];
        if (typeof handler !== 'function') {
            throw new Error(
                `the tree binds the handler '${signal.handler}' for '${name}', and the scope ` +
                    `${context.scope === undefined ? 'was not given (pass `scope`)' : 'has no such function'}.`,
            );
        }
        connectable.connect(name, (...args) => handler.apply(context.scope, args));
    }
}

/** The `GtkGridLayoutChild` properties `layout { }` may carry, and the NativeScript member each is. */
const GRID_LAYOUT: Readonly<Record<string, string>> = {
    row: 'row',
    column: 'column',
    'row-span': 'rowSpan',
    'column-span': 'columnSpan',
};

/**
 * ADR 0092's `layout { }`: the child's cell in a `Gtk.Grid`, written BEFORE the child is handed
 * to the parent, whose `addChild` reads the placement to derive its tracks.
 *
 * The one layout manager this port has is the grid, and the parent says so by `attach` (the
 * GtkGrid method that takes the same four values), so a layout under any other parent is
 * REFUSED: a cell the tree asked for would be silently ignored there. A key the grid child has
 * no spelling for, or a value that is not a whole number (`column: null` is a `.blp` ident), is
 * refused by name too — NativeScript would take either as a dead write or as cell 0.
 */
function applyLayout(child: SharedTreeNode, built: View | object, parentElement: Element, parentTag: string): void {
    if (child.layout === undefined) return;
    if (typeof (parentElement.ctor.prototype as { attach?: unknown }).attach !== 'function') {
        throw new Error(
            `<${elementOf(child).xmlName}> authored layout (${Object.keys(child.layout).join(', ')}) under ` +
                `\`${parentTag}\`, which has no \`attach\`: this port's only layout manager is the grid, so the ` +
                'placement would be dropped.',
        );
    }
    if (!(built instanceof View)) {
        throw new Error(`\`${child.tag}\` is not a view, so it has no cell to place.`);
    }
    for (const [key, value] of Object.entries(child.layout)) {
        const member = GRID_LAYOUT[key];
        if (member === undefined) {
            throw new Error(
                `layout \`${key}\` on \`${child.tag}\` reaches nothing: a grid child takes ` +
                    `${Object.keys(GRID_LAYOUT).join(', ')}.`,
            );
        }
        if (typeof value !== 'number' || !Number.isInteger(value)) {
            throw new Error(`layout \`${key}: ${String(value)}\` on \`${child.tag}\` is not a whole number.`);
        }
        (built as unknown as Record<string, number>)[member] = value;
    }
}

/** The refusal for an authored property the class does not declare. */
function unknownProperty(element: Element, tag: string, authored: string, prop: string, value: unknown): Error {
    return new Error(
        `<${element.xmlName} ${authored}="${String(value)}"> reaches nothing: \`${tag}\` declares no ` +
            `'${prop}'. NativeScript's builder assigns it anyway, as a dead own-property at exit 0, ` +
            'so the attribute door cannot report this and the tree would render without it.',
    );
}

function buildView(node: SharedTreeNode, element: Element, view: View, context: BuildContext): View {
    // `page`: refused by name until the port has the parent for it. `Gtk.Notebook` has no
    // NativeScript widget yet (it is not the port's TabView, which owns its own strip), and
    // `Gtk.Stack` pages need `StackPage`, which lives on feat/learn6502-android-widgets.
    if (node.page !== undefined) {
        throw new Error(
            `<${element.xmlName}> is a page (${JSON.stringify(node.page)}), and adwaita-nativescript builds no ` +
                'pages: there is no NS widget yet for Gtk.Notebook, and Gtk.StackPage is not on this branch.',
        );
    }
    // The id is how the TypeScript beside a `.blp` reaches this view (`getViewById`),
    // the counterpart of `InternalChildren` on GTK and `querySelector('#…')` on the web.
    if (node.id !== undefined) {
        if (context.ids.has(node.id) || context.values?.has(node.id)) {
            throw new Error(`Two nodes of this tree carry the id '${node.id}'; GtkBuilder refuses a duplicate id.`);
        }
        context.ids.set(node.id, view);
        view.id = node.id;
    }
    const references = declaredBuilderReferences(element.ctor);
    for (const [authored, value] of Object.entries(node.props ?? {})) {
        // A projected `.blp` spells a property as GObject does (`maximum-size`); the widget
        // declares it in camel case (`maximumSize`). Without the case rule every hyphenated
        // property of a real `.blp` was refused below, so only hand-authored trees built.
        const prop = propertyOf(authored);
        if (!(prop in view)) throw unknownProperty(element, node.tag, authored, prop, value);
        if (references.includes(prop)) {
            context.pending.push({ view, element, prop, id: String(value) });
            continue;
        }
        (view as unknown as Record<string, unknown>)[prop] = String(value);
    }
    // `styles ["card"]` in a `.blp`. Refused like an attribute when the widget has no
    // `styleClasses` setter: writing `className` instead would bypass the class list the
    // widget keeps for `add_css_class`, and dropping it would render the tree unstyled.
    if (node.styleClasses !== undefined && node.styleClasses.length > 0) {
        if (!('styleClasses' in view)) {
            throw new Error(
                `<${element.xmlName}> takes no style classes: \`${node.tag}\` declares no 'styleClasses', so ` +
                    `[${node.styleClasses.join(', ')}] would be dropped.`,
            );
        }
        (view as unknown as Record<string, unknown>).styleClasses = node.styleClasses.join(' ');
    }
    // A string list is a list MODEL, never a widget, so items authored on a view have nowhere
    // to go; refused by name, as `buildValue` refuses them on a value class without `append`.
    if (node.extensions?.strings !== undefined) {
        throw new Error(
            `<${element.xmlName}> takes no string-list items: \`${node.tag}\` is a widget, and only a list ` +
                `model holds them, so [${node.extensions.strings.map((string) => string.value).join(', ')}] would be dropped.`,
        );
    }
    applyResponses(view, element, node);
    return view;
}

function buildValue(node: SharedTreeNode, element: Element, probe: object, context: BuildContext): object {
    if (node.id !== undefined && context.values === undefined) {
        throw new Error(
            `<${element.xmlName} id="${node.id}"> reaches nothing: \`${node.tag}\` is not a view, and ` +
                '`getViewById` walks views, so code beside the `.blp` could never look it up. ' +
                '`buildWithSiblings` hands every object back by id.',
        );
    }
    if (node.styleClasses !== undefined && node.styleClasses.length > 0) {
        throw new Error(
            `<${element.xmlName}> takes no style classes: \`${node.tag}\` is not a widget, so ` +
                `[${node.styleClasses.join(', ')}] would be dropped.`,
        );
    }
    const bag: Record<string, unknown> = {};
    for (const [authored, value] of Object.entries(node.props ?? {})) {
        const prop = propertyOf(authored);
        if (!(prop in probe)) throw unknownProperty(element, node.tag, authored, prop, value);
        bag[prop] = value;
    }
    // ADR 0072's string-list items are CONSTRUCT data, the same `{ strings }` bag
    // `new Gtk.StringList({ strings })` takes in GJS. `append` is what marks a class as a list
    // that can hold them (`gtk_string_list_append` is what GtkBuilder's `<items>` calls), so a
    // value class without it refuses them by name rather than constructing without them.
    const strings = node.extensions?.strings;
    if (strings !== undefined) {
        if (typeof (probe as Partial<ExtensionDoors>).append !== 'function') {
            throw new Error(
                `<${element.xmlName}> takes no string-list items: \`${node.tag}\` has no \`append\`, so ` +
                    `[${strings.map((string) => string.value).join(', ')}] would be dropped.`,
            );
        }
        bag.strings = strings.map((string) => string.value);
    }
    const built = new element.ctor(bag);
    applyResponses(built, element, node);
    if (node.id !== undefined && context.values !== undefined) {
        if (context.values.has(node.id) || context.ids.has(node.id)) {
            throw new Error(`Two nodes of this tree carry the id '${node.id}'; GtkBuilder refuses a duplicate id.`);
        }
        context.values.set(node.id, built);
    }
    return built;
}

/** The two GTK methods ADR 0072's extensions are filled through, in this port's spelling. */
interface ExtensionDoors {
    append(string: string): void;
    add_response(id: string, label: string, options?: { appearance?: string; enabled?: boolean }): void;
}

/**
 * ADR 0072's `responses`, written through `adw_alert_dialog_add_response` with the appearance
 * and enabled state the flags stand for — what GtkBuilder's `<responses>` calls. Asked of a
 * widget and of a value object alike, because this port's `Adw.AlertDialog` is not a `View`:
 * it presents through the platform's own dialog. A class with no such method is REFUSED rather
 * than skipped: a dialog without its buttons looks finished.
 */
function applyResponses(built: object, element: Element, node: SharedTreeNode): void {
    const doors = built as Partial<ExtensionDoors>;
    const responses = node.extensions?.responses;
    if (responses !== undefined) {
        if (typeof doors.add_response !== 'function') {
            throw new Error(
                `<${element.xmlName}> takes no responses: \`${node.tag}\` has no \`add_response\`, so ` +
                    `[${responses.map((response) => response.id).join(', ')}] would be dropped.`,
            );
        }
        for (const { id, label, appearance, enabled } of responses) {
            doors.add_response(id, label, {
                ...(appearance === undefined ? {} : { appearance }),
                ...(enabled === undefined ? {} : { enabled }),
            });
        }
    }
}

/**
 * The name this child arrives under — its authored SLOT, or its element name when it
 * authored none.
 *
 * THE NAME IS THE WHOLE PLACEMENT HERE. `_addChildFromBuilder(name, view)` is NativeScript's
 * one child door, and `name` is the complex-property name for `<AdwToolbarView.topBar>` and
 * the plain element name for a bare child — which is never a slot name and so takes the
 * widget's fallback, exactly as GtkBuildable's untyped `<child>` does. This builder passed
 * the element name ALWAYS, so every authored placement in a tree it built took the fallback:
 * measured on the shipped `.blp` this path was written for, a `[top]` header bar and the
 * content landed in the same cell.
 *
 * AN UNKNOWN SLOT IS REFUSED, and it has to be refused HERE rather than inside the widget:
 * `resolveBuilderSlot` is total by design — a name the widget does not have takes the
 * fallback and lands somewhere plausible — and that totality is what makes a bare child
 * work. So the question "is this name one you have" is asked of the class's own
 * `builderSlots` declaration before the write, the same shape as the attribute door's
 * membership test one loop up, and for the same reason: afterwards there is nothing left to
 * report. A widget whose slot vocabulary does not yet spell what the corpus authored is a
 * ledgered `vocabulary` divergence, not a child to place somewhere close by.
 */
function builderNameFor(element: Element, tag: string, child: SharedTreeNode): string {
    const childElement = elementOf(child);
    if (child.slot === undefined) return childElement.xmlName;
    const slot = child.slot;
    const known = declaredBuilderSlots(element.ctor);
    if (known === null || !known.includes(slot)) {
        throw new Error(
            `<${element.xmlName}.${slot}> reaches nothing: \`${tag}\` declares no such builder slot, so ` +
                `NativeScript would hand <${childElement.xmlName}> to its fallback placement instead — at exit 0, ` +
                `in a cell the tree never asked for. Known slots: ${
                    known === null || known.length === 0 ? 'none' : known.join(', ')
                }.`,
        );
    }
    return slot;
}
