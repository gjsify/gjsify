// One primitive plus its props → the widget, its properties and its class name.
//
// This is L2's whole public surface, and it is a PLAIN FUNCTION over plain records
// on purpose (ADR 0032 § 1: L2 sits below the framework, and the Solid proof of
// that is a later milestone which depends on it being true today). Nothing here
// imports React, nothing imports `gi://`, and the only GTK knowledge it holds comes
// from `@gjsify/gtk-host/style` — which is where ADR 0027 rule 1 says widget
// knowledge lives.
//
// THE ORDER OF THE SIX STEPS IS LOAD-BEARING, so it is written out:
//
//   1. pick the spec, and let `switchOn` swap it   — one RN prop, two GTK widgets
//   2. route the props                            — fills `style-property` too
//   3. normalise + PARTITION the style             — this is where `orientation` appears
//   4. derive the effective orientation            — from step 3, not from the spec
//   5. resolve the intents                         — needs step 4's answer
//   6. mint the class                              — needs step 5's extra declarations
//
// Steps 3 and 4 are the pair that cannot be reordered: `flex-row` becomes the
// widget property `orientation`, and `items-center` becomes `halign` or `valign`
// depending on it. Resolving the intent from the SPEC's default orientation instead
// would align every child of a `flex-row` on the wrong axis — and the window looks
// plausible either way, which is how it would survive review.

import type { LayoutIntent, StyleProps, StyleTokens } from '@gjsify/gtk-host/style';

import type { ClassNameInput } from './classes.js';
import { PrimitiveError } from './errors.js';
import { resolveIntent, type ChildContext, type ChildFacts, type Orientation, type WidgetFacts } from './intents.js';
import { mintClass, normalise, partition, variantDeclarations, type ClassNameSink, type StyleInput } from './style.js';
import {
    FRAMEWORK_PROPS,
    PRIMITIVES,
    type ContentSpec,
    type PrimitiveSpec,
    type PropertyRoute,
    type PropRoute,
} from './table.js';

/**
 * Properties only a `Gtk.Box` installs.
 *
 * Measured (`gtk-props.ts`, and re-measured for this milestone): `Gtk.Overlay`
 * installs 37 properties and none of them is `orientation` or `spacing`. So when a
 * `View` grows an inner box, these two are the ONLY properties that have to move
 * into it — everything else (margins, expand, alignment, visibility, the generated
 * class) belongs on the outer node, where it positions and paints the element as a
 * whole.
 *
 * A declared set rather than a per-primitive field, because the split is a fact
 * about GTK's class hierarchy and not about any primitive's design.
 */
const BOX_ONLY_PROPS: readonly string[] = ['orientation', 'spacing'];

/**
 * Keep the style class GTK adds behind the layer's back.
 *
 * MEASURED: a `Gtk.Box` carries `css-classes` of its ORIENTATION with nothing
 * authored — `Gtk.Orientable` adds `.horizontal`/`.vertical` itself when the
 * orientation is set. And `css-classes` is a whole-list property, so writing the
 * generated name REPLACES it: a box with `p-2` came out of the reconciler with
 * `["gjsify-ssrm40p"]` and GTK's own class gone. Adwaita's stylesheet selects on
 * those classes, so losing one is a paint change with nothing to attribute it to.
 *
 * ADR 0032 § 5 already states the rule this restores — "a separately authored
 * `css-classes` is unioned, never overwritten" — and the other author here happens
 * to be GTK. Only applied when there IS a write: a node this layer gives no classes
 * to never touches the property, so GTK's own list survives untouched.
 */
const withOrientationClass = (
    props: Readonly<Record<string, unknown>>,
    classes: readonly string[],
): readonly string[] => {
    if (classes.length === 0) return classes;
    const orientation = props.orientation;
    return typeof orientation === 'string' ? [orientation, ...classes] : classes;
};

/** Everything L2 needs that is not the primitive and not its props. */
export interface PrimitiveContext {
    /** The project's own token scales. ADR 0032 § 3: the families are declared, the values are the project's. */
    readonly tokens: StyleTokens;
    /** Where a declaration set becomes a class name. `StyleSheet` satisfies this structurally. */
    readonly sheet: ClassNameSink;
    /** What the parent published. Absent at a root, and then `expand`/`alignSelf` pass up. */
    readonly parent?: ChildContext;
    /** What the element's own children are. Absent means "no children", not "unknown". */
    readonly children?: ChildFacts;
}

/** One GTK node in the plan. */
export interface WidgetNode {
    /** GType name — the tag the host takes. */
    readonly tag: string;
    /** Widget properties in GTK's own spelling, for the host to coerce and apply. */
    readonly props: Readonly<Record<string, unknown>>;
    /** `css-classes`. At most one generated name, plus whatever the primitive always carries. */
    readonly cssClasses: readonly string[];
}

/** A GTK signal this element binds, and how to build the React Native argument. */
export interface ResolvedEvent {
    /** The React Native prop that supplied the callback. */
    readonly prop: string;
    /** The GObject signal name, in GObject's spelling. */
    readonly signal: string;
    /** The widget property to read for the callback's argument, or null for no argument. */
    readonly read: string | null;
}

export interface PrimitivePlan {
    readonly primitive: string;
    /** The node the PARENT adopts. */
    readonly node: WidgetNode;
    /** The node the element's ordinary children go into, when it is not `node`. */
    readonly content: WidgetNode | null;
    /** The `slot` this element declares to its parent, or null. */
    readonly slot: string | null;
    /** Where an absolutely positioned CHILD goes: into `node`, under this slot. */
    readonly absoluteSlot: string | null;
    readonly events: readonly ResolvedEvent[];
    /** Where a text child goes, or null when text under this primitive is refused. */
    readonly textSink: string | null;
    /** What this element publishes to its children. */
    readonly childContext: ChildContext;
    /** What L2 could not answer. Empty when the caller supplied a parent. */
    readonly intent: LayoutIntent;
}

/** What one element authored, in React Native's own spelling. */
export type PrimitiveProps = Readonly<Record<string, unknown>> & {
    readonly className?: ClassNameInput;
    readonly style?: StyleInput;
};

/**
 * Does this style declare `position: absolute`?
 *
 * A PARENT needs the answer about its CHILDREN — `absolute` is triggered by the
 * child, never by the element (ADR 0032 § 3) — and the parent has the children's
 * props before it has their plans.
 *
 * It runs the real resolution rather than testing for the literal string
 * `absolute`, because the syntactic test is exact only while L1's vocabulary has
 * exactly one spelling for it. It has two today (`absolute`, and `style={{
 * position: 'absolute' }}`) and nothing stops it having three.
 */
export function declaresAbsolute(props: PrimitiveProps, tokens: StyleTokens, primitive = 'View'): boolean {
    const { props: styleProps } = normalise(props, tokens, primitive);
    return partition(styleProps).intent.overlay?.role === 'child';
}

export function resolvePrimitive(primitive: string, props: PrimitiveProps, context: PrimitiveContext): PrimitivePlan {
    const base = PRIMITIVES[primitive];
    if (base === undefined) {
        throw new PrimitiveError(
            primitive,
            '',
            `is not a primitive this layer answers for. Known: ${Object.keys(PRIMITIVES).sort().join(', ')}`,
        );
    }
    // 1. `switchOn`: one React Native prop, two GTK widgets.
    const spec = base.switchOn !== undefined && props[base.switchOn.prop] === true ? base.switchOn.whenTrue : base;
    const content = spec.content;

    // 2. Route the props. `styleExtra` is what a `style-property` route contributed
    //    and it joins the normalised record — the whole point of ADR 0032 § 4 is
    //    that there is exactly one, so `ActivityIndicator`'s `color` prop goes
    //    through the same partition as `text-grey-700` rather than beside it.
    const outerProps: Record<string, unknown> = { ...spec.widgetProps };
    const contentProps: Record<string, unknown> = { ...content?.widgetProps };
    const styleExtra: Record<string, unknown> = {};
    const events: ResolvedEvent[] = [];
    const contentStyleProps: ReadonlySet<string> = new Set(
        [content?.styleProp, content?.classNameProp].filter((name): name is string => typeof name === 'string'),
    );

    for (const [prop, value] of Object.entries(props)) {
        // `undefined` is React's absent prop, not an authored one — every optional
        // prop in a spread is `undefined`, and refusing those would refuse every
        // `{...rest}` in the ecosystem.
        if (value === undefined) continue;
        if (FRAMEWORK_PROPS.has(prop) || contentStyleProps.has(prop)) continue;
        const route = spec.props[prop];
        if (route === undefined) {
            throw new PrimitiveError(
                primitive,
                `prop "${prop}"`,
                `is not a prop this primitive answers for. It takes: ${Object.keys(spec.props).sort().join(', ')}. ` +
                    'An unlisted prop is refused rather than dropped: a prop that silently does nothing is indistinguishable from a bug in the application, forever',
            );
        }
        for (const one of Array.isArray(route) ? (route as readonly PropRoute[]) : [route as PropRoute]) {
            applyRoute(one, prop, value, { primitive, spec, outerProps, contentProps, styleExtra, events });
        }
    }

    // 3. Normalise + partition the element's own style set.
    const authored = normalise(props, context.tokens, primitive);
    const styleSet: StyleProps = { ...authored.props, ...(styleExtra as StyleProps) };
    const partitioned = partition(styleSet);

    // 4. The EFFECTIVE orientation, which step 3 may have changed. A prop route
    //    (`ScrollView`'s `horizontal`) writes it too, and the STYLE wins — the same
    //    precedence `style` already has over `className`, for the same reason.
    const nodeOrientation = orientationOf(partitioned.props.orientation ?? outerProps.orientation, spec.orientation);
    // Where the CHILDREN actually land, which is the axis every child-facing intent
    // is about. It is the content box's for a `ScrollView` and the element's own
    // otherwise.
    const childOrientation =
        content === undefined ? nodeOrientation : orientationOf(contentProps.orientation, content.orientation);

    // 5. Resolve what the intents allow.
    const resolved = resolveIntent({
        primitive,
        intent: partitioned.intent,
        orientation: childOrientation,
        widget: spec.widget,
        ...(context.parent === undefined ? {} : { parent: context.parent }),
        ...(context.children === undefined ? {} : { children: context.children }),
        emittedProps: partitioned.props,
    });

    // 6. Mint the class. AFTER step 5, because an absolutely positioned element's
    //    horizontal offsets become CSS declarations there, and a class minted before
    //    them would be missing exactly the half that positions it.
    const generated = mintClass(
        context.sheet,
        [...partitioned.css, ...resolved.css],
        variantDeclarations(authored.groups, context.tokens, primitive),
    );

    Object.assign(outerProps, partitioned.props, resolved.props);
    assertOneTextAuthority(primitive, spec, outerProps, context.children);
    const cssClasses = [...spec.cssClasses, ...(generated === null ? [] : [generated])];

    // --- which nodes exist, and which of them holds what ----------------------

    const overlay = spec.overlayOnAbsoluteChild;
    if (overlay !== undefined && (context.children?.absolute ?? 0) > 0) {
        const inner: Record<string, unknown> = { ...spec.widgetProps };
        for (const name of BOX_ONLY_PROPS) {
            if (outerProps[name] === undefined) continue;
            inner[name] = outerProps[name];
            delete outerProps[name];
        }
        return {
            primitive,
            node: { tag: overlay.tag, props: outerProps, cssClasses: withOrientationClass(outerProps, cssClasses) },
            content: { tag: spec.tag, props: inner, cssClasses: [] },
            slot: resolved.slot,
            absoluteSlot: overlay.slot,
            events,
            textSink: spec.textSink,
            childContext: { ...resolved.childContext, orientation: childOrientation, overlay: true },
            intent: resolved.remaining,
        };
    }

    const contentResolved =
        content === undefined ? null : resolveContent(content, props, contentProps, context, primitive);

    return {
        primitive,
        node: { tag: spec.tag, props: outerProps, cssClasses: withOrientationClass(outerProps, cssClasses) },
        content: contentResolved === null ? null : contentResolved.node,
        slot: resolved.slot,
        absoluteSlot: null,
        events,
        textSink: spec.textSink,
        childContext:
            contentResolved === null
                ? { ...resolved.childContext, overlay: false }
                : {
                      ...contentResolved.childContext,
                      // A `text-center` on the OUTER style still has to reach a
                      // descendant label: the scrolled window cannot align text and
                      // neither can the box, so the value keeps travelling. The
                      // content's own value wins where there is one.
                      ...(contentResolved.childContext.textAlign === undefined &&
                      resolved.childContext.textAlign !== undefined
                          ? { textAlign: resolved.childContext.textAlign }
                          : {}),
                      overlay: false,
                  },
        intent: resolved.remaining,
    };
}

/**
 * The second styleable node, and its own full pass.
 *
 * `ScrollView` is the only primitive with one today, and the reason it needs a full
 * pass rather than a property copy is React Native's own split: `style` describes
 * the scroller and `contentContainerStyle` describes what is inside it, so the two
 * are separate declaration sets minting separate classes. Sharing one pass would
 * put the content's padding on the scrolled window, where it clips instead of
 * insetting.
 *
 * The content box IS given a parent context, and its orientation is the SCROLL
 * AXIS. That is what makes `contentContainerStyle={{ flexGrow: 1 }}` — React
 * Native's own idiom for "the content is at least as tall as the viewport" —
 * resolve to `vexpand` on a vertical scroller instead of passing up unresolved.
 */
function resolveContent(
    content: ContentSpec,
    props: PrimitiveProps,
    contentProps: Record<string, unknown>,
    context: PrimitiveContext,
    primitive: string,
): { readonly node: WidgetNode; readonly childContext: ChildContext } {
    const label = `${primitive} ${content.styleProp ?? 'content'}`;
    const authored = normalise(
        {
            ...(content.classNameProp === null ? {} : { className: props[content.classNameProp] as ClassNameInput }),
            ...(content.styleProp === null ? {} : { style: props[content.styleProp] as StyleInput }),
        },
        context.tokens,
        label,
    );
    const partitioned = partition(authored.props);
    const orientation = orientationOf(partitioned.props.orientation ?? contentProps.orientation, content.orientation);
    const resolved = resolveIntent({
        primitive: label,
        intent: partitioned.intent,
        orientation,
        widget: content.widget,
        parent: { orientation, props: {}, overlay: false },
        emittedProps: partitioned.props,
    });
    const generated = mintClass(
        context.sheet,
        [...partitioned.css, ...resolved.css],
        variantDeclarations(authored.groups, context.tokens, label),
    );
    Object.assign(contentProps, partitioned.props, resolved.props);
    return {
        node: {
            tag: content.tag,
            props: contentProps,
            cssClasses: withOrientationClass(contentProps, generated === null ? [] : [generated]),
        },
        childContext: { ...resolved.childContext, orientation },
    };
}

interface RouteSink {
    readonly primitive: string;
    readonly spec: PrimitiveSpec;
    readonly outerProps: Record<string, unknown>;
    readonly contentProps: Record<string, unknown>;
    readonly styleExtra: Record<string, unknown>;
    readonly events: ResolvedEvent[];
}

function applyRoute(route: PropRoute, prop: string, value: unknown, sink: RouteSink): void {
    switch (route.to) {
        case 'refused':
            throw new PrimitiveError(sink.primitive, `prop "${prop}"`, route.why);
        case 'ignored':
            // Recognised and deliberately without effect. The `why` is NOT printed
            // at runtime by design: printing it would make an ordinary, correct prop
            // noisy on every render. The spec is what asserts each one contributes
            // nothing, which is what keeps "no GTK meaning" apart from "the table
            // forgot it" — the same shape as `flex-nowrap` in L1.
            return;
        case 'style-property':
            sink.styleExtra[route.name] = value;
            return;
        case 'event':
            if (typeof value !== 'function') {
                throw new PrimitiveError(
                    sink.primitive,
                    `prop "${prop}"`,
                    `binds the GTK signal "${route.signal}" and needs a function; got ${describe(value)}`,
                );
            }
            sink.events.push({ prop, signal: route.signal, read: route.read ?? null });
            return;
        case 'property': {
            if (route.on === 'content' && sink.spec.content === undefined) {
                throw new PrimitiveError(
                    sink.primitive,
                    `prop "${prop}"`,
                    'is routed to a content node this primitive does not declare — the table is wrong, not the call',
                );
            }
            const target = route.on === 'content' ? sink.contentProps : sink.outerProps;
            const coerced = coerce(route, prop, value, sink.primitive);
            for (const name of route.names) target[name] = coerced;
            if (route.also !== undefined) Object.assign(target, route.also);
            return;
        }
    }
}

function coerce(route: PropertyRoute, prop: string, value: unknown, primitive: string): unknown {
    const bad = (wanted: string): never => {
        throw new PrimitiveError(primitive, `prop "${prop}"`, `expects ${wanted}; got ${describe(value)}`);
    };
    switch (route.as) {
        case 'string':
            // A number or a boolean is ordinary JSX (`value={count}`) and
            // unambiguous. Anything else is not, and the host's own `coerce` refuses
            // it one layer down — refusing here names the REACT NATIVE prop instead
            // of the GTK property, which is the name the author actually wrote.
            if (typeof value === 'string') return value;
            if (typeof value === 'number' || typeof value === 'boolean') return String(value);
            return bad('a string');
        case 'boolean':
            return typeof value === 'boolean' ? value : bad('a boolean');
        case 'not':
            return typeof value === 'boolean' ? !value : bad('a boolean');
        case 'int':
            if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
            return bad('a number');
        case 'map':
            return lookup(route, prop, value, primitive);
        case 'pixels-or-map':
            // A number is a pixel count and needs no table. React Native's own
            // `ActivityIndicator` takes both shapes, so accepting both is parity
            // rather than convenience.
            if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
            return lookup(route, prop, value, primitive);
    }
}

function lookup(route: PropertyRoute, prop: string, value: unknown, primitive: string): unknown {
    const map = route.map ?? {};
    // `String(value)` because a boolean-keyed map is the honest spelling for a
    // boolean prop with two GTK answers (`horizontal` → two scrollbar policies),
    // and an object literal cannot be keyed by `true`.
    const mapped = map[String(value)];
    if (mapped !== undefined) return mapped;
    throw new PrimitiveError(
        primitive,
        `prop "${prop}"`,
        `has no GTK equivalent for ${describe(value)}. Known: ${Object.keys(map).sort().join(', ')}. ` +
            'A value absent from that list is absent because GTK has no member for it, not because the table is short',
    );
}

/**
 * `<TextInput value="a">b</TextInput>` is two authorities for one string.
 *
 * The host records the same collision from its own side — "one widget, one slot,
 * two APIs": `button.set_child(w)` after a `label` write leaves the label null, and
 * a `label` write after `set_child` unparents the child. For `Gtk.Entry` the two
 * APIs are the `text` PROPERTY and the `text` TEXT SINK, and whichever the
 * reconciler applies last wins — silently, and possibly differently between a first
 * render and an update.
 */
function assertOneTextAuthority(
    primitive: string,
    spec: PrimitiveSpec,
    props: Readonly<Record<string, unknown>>,
    children: ChildFacts | undefined,
): void {
    if (spec.textSink === null || children?.text !== true) return;
    if (props[spec.textSink] === undefined) return;
    throw new PrimitiveError(
        primitive,
        `prop → "${spec.textSink}"`,
        'is the same widget property a text CHILD writes, and both were given. Whichever the reconciler applied last would win, possibly differently on a first render and on an update — so it is refused. Keep one',
    );
}

const orientationOf = (value: unknown, fallback: Orientation): Orientation =>
    value === 'horizontal' || value === 'vertical' ? value : fallback;

const describe = (value: unknown): string =>
    typeof value === 'string'
        ? `"${value}"`
        : value !== null && typeof value === 'object'
          ? Object.prototype.toString.call(value)
          : String(value);

export type { ChildContext, ChildFacts, Orientation, WidgetFacts };
