// One primitive plus its props → the widget, its properties and its class name.
//
// This is L2's whole public surface, and it is a PLAIN FUNCTION over plain records
// on purpose (ADR 0032 § 1: L2 sits below the framework). `../solid/index.ts` is
// what measures that rather than asserting it — the same function, under a
// framework with no VDOM and no reconciler, and the only thing it had to change
// here is the prop loop below. Nothing here
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
//   7. apply the wrap swap                         — step 5 says WHICH widget, not this
//
// Step 7 is the second widget swap in this function and the opposite trigger to step
// 1's: `switchOn` reads one React Native PROP, while a wrap is decided by the STYLE
// and can therefore only be known after step 3. The class is minted before it (step
// 6) because a generated class name travels with the element and not with the tag.
//
// Steps 3 and 4 are the pair that cannot be reordered: `flex-row` becomes the
// widget property `orientation`, and `items-center` becomes `halign` or `valign`
// depending on it. Resolving the intent from the SPEC's default orientation instead
// would align every child of a `flex-row` on the wrong axis — and the window looks
// plausible either way, which is how it would survive review.

import type { LayoutIntent, StyleProps, StyleTokens } from '@gjsify/gtk-host/style';

import type { ClassNameInput } from './classes.js';
import { PrimitiveError } from './errors.js';
import {
    resolveIntent,
    type ChildContext,
    type ChildFacts,
    type Orientation,
    type WidgetFacts,
    type WrapResolution,
} from './intents.js';
import { mintClass, normalise, partition, variantDeclarations, type ClassNameSink, type StyleInput } from './style.js';
import {
    FRAMEWORK_PROPS,
    PRIMITIVES,
    type ContentSpec,
    type NodeKind,
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

/**
 * The node the children go into, after a wrap has changed which widget that is.
 *
 * ONE function for the three places a plan can put the children — the element's own
 * node, the inner box of an overlay, and a `ScrollView`'s content box — because the
 * swap is the same operation on all three and a second copy is the one that would
 * miss `contentContainerClassName="flex-wrap"`.
 */
const wrapped = (
    tag: string,
    props: Record<string, unknown>,
    wrapping: WrapResolution | null,
): { readonly tag: string; readonly props: Record<string, unknown> } => {
    if (wrapping === null) return { tag, props };
    // `spacing` is `Gtk.Box`'s and the swapped-in class does not install it (measured,
    // gtk-props.ts). L1 already routes a wrapping element's gap into the intent, so
    // there is normally nothing here — this is the line that keeps that true if a
    // spec ever carries a `spacing` of its own, rather than letting the host refuse
    // the property at attach time in a consumer's window.
    const { spacing: _dropped, ...rest } = props;
    return { tag: wrapping.tag, props: { ...rest, ...wrapping.props } };
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

/**
 * A widget property whose value is a `Gio.File`, decided here and BUILT one layer up.
 *
 * L2 holds every decision — which schemes have a synchronous loader, which shapes
 * React Native accepts that this build chain cannot honour — and none of the
 * construction, because building a `Gio.File` needs `gi://Gio` and nothing under
 * `primitives/` imports `gi://`. That is not a stylistic rule: it is what lets this
 * whole layer be asserted by comparison, with no display and no toolkit.
 */
export interface ResolvedFile {
    /** Which node of the plan the property is on. */
    readonly on: NodeKind;
    /** The GTK property that takes it — `file` on a `Gtk.Picture`. */
    readonly property: string;
    /** `path` → `Gio.File.new_for_path`; `uri` → `Gio.File.new_for_uri`. */
    readonly kind: 'path' | 'uri';
    readonly value: string;
}

/** A press this element takes through a `Gtk.GestureClick` rather than a widget signal. */
export interface ResolvedGesture {
    /** The React Native prop that supplied the callback. */
    readonly prop: string;
    /** The `Gtk.GestureClick` signal — `released` is a completed press. */
    readonly signal: string;
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
    /** A node that takes no children and sits BEHIND them — `ImageBackground`'s picture. */
    readonly backdrop: WidgetNode | null;
    /** The slot `backdrop` declares to `node`, or null for the default slot. */
    readonly backdropSlot: string | null;
    /** The slot `content` declares to `node`, or null for the default slot. */
    readonly contentSlot: string | null;
    readonly events: readonly ResolvedEvent[];
    /** Widget properties whose value is a file the framework layer constructs. */
    readonly files: readonly ResolvedFile[];
    /** Presses that arrive through a gesture controller instead of a signal. */
    readonly gestures: readonly ResolvedGesture[];
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
    const backdropProps: Record<string, unknown> = { ...spec.backdrop?.widgetProps };
    const styleExtra: Record<string, unknown> = {};
    const events: ResolvedEvent[] = [];
    const files: ResolvedFile[] = [];
    const gestures: ResolvedGesture[] = [];
    const contentStyleProps: ReadonlySet<string> = new Set(
        [content?.styleProp, content?.classNameProp, spec.backdrop?.styleProp, spec.backdrop?.classNameProp].filter(
            (name): name is string => typeof name === 'string',
        ),
    );

    // `Button` and nothing else. Checked before the prop loop so the refusal names
    // the primitive rather than whatever the loop reaches first, and checked HERE
    // rather than in a component's prop type so it also reaches a JavaScript caller
    // and the second L3.
    if (spec.refusesStyle !== undefined && (props.className !== undefined || props.style !== undefined)) {
        throw new PrimitiveError(
            primitive,
            props.className === undefined ? 'prop "style"' : 'prop "className"',
            spec.refusesStyle,
        );
    }

    // KEYS FIRST, AND THE SKIP LIST BEFORE THE VALUE IS READ. `Object.entries` would
    // read every prop, and reading a prop is only free in React: Solid's props object
    // is a record of GETTERS, and the getter behind `children` CREATES the child
    // components when it is touched. So the entries form built this element's whole
    // subtree — outside the parent-context provider, and again on every re-resolution
    // — for props this loop then skipped by name. `FRAMEWORK_PROPS` already said which
    // props L2 does not answer for; this only stops it finding out too late.
    //
    // Nothing changes for React (a plain value read twice costs nothing), which is
    // what makes it the right place to fix rather than a per-adapter shim: the
    // assumption "reading a prop has no side effect" is framework knowledge, and this
    // file is the layer that is not allowed to hold any.
    for (const prop of Object.keys(props)) {
        if (FRAMEWORK_PROPS.has(prop) || contentStyleProps.has(prop)) continue;
        const value = props[prop];
        // `undefined` is React's absent prop, not an authored one — every optional
        // prop in a spread is `undefined`, and refusing those would refuse every
        // `{...rest}` in the ecosystem.
        if (value === undefined) continue;
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
            applyRoute(one, prop, value, {
                primitive,
                spec,
                outerProps,
                contentProps,
                backdropProps,
                styleExtra,
                events,
                files,
                gestures,
            });
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
        const innerNode = wrapped(spec.tag, inner, resolved.wrapping);
        return {
            primitive,
            node: { tag: overlay.tag, props: outerProps, cssClasses: withOrientationClass(outerProps, cssClasses) },
            content: { tag: innerNode.tag, props: innerNode.props, cssClasses: [] },
            backdrop: null,
            backdropSlot: null,
            contentSlot: null,
            slot: resolved.slot,
            absoluteSlot: overlay.slot,
            events,
            files,
            gestures,
            textSink: spec.textSink,
            childContext: { ...resolved.childContext, orientation: childOrientation, overlay: true },
            intent: resolved.remaining,
        };
    }

    const contentResolved =
        content === undefined ? null : resolveNode(content, props, contentProps, context, primitive);
    const backdropResolved =
        spec.backdrop === undefined ? null : resolveNode(spec.backdrop, props, backdropProps, context, primitive);

    // A primitive WITH a content node styles the scroller with its own class list, so
    // a wrap written there belongs to the scroller — which cannot wrap, and
    // `resolveIntent` has already refused it by then (`ScrollView`'s widget facts say
    // `wrapsInto: null`). So this swap only ever fires on a primitive that holds its
    // own children.
    const ownNode = wrapped(spec.tag, outerProps, resolved.wrapping);
    return {
        primitive,
        node: {
            tag: ownNode.tag,
            props: ownNode.props,
            cssClasses: withOrientationClass(ownNode.props, cssClasses),
        },
        content: contentResolved === null ? null : contentResolved.node,
        backdrop: backdropResolved === null ? null : backdropResolved.node,
        backdropSlot: spec.backdrop?.slot ?? null,
        contentSlot: content?.slot ?? null,
        slot: resolved.slot,
        absoluteSlot: null,
        events,
        files,
        gestures,
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
 *
 * The BACKDROP goes through the same function, and that is the whole reason it is
 * spelled `ContentSpec` rather than a type of its own: a backdrop is a second
 * styleable node with its own style prop (`ImageBackground`'s `imageStyle`) that
 * simply takes no children. Two functions differing in whether they returned a
 * `childContext` nobody reads would be the same code twice.
 */
function resolveNode(
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
    const node = wrapped(content.tag, contentProps, resolved.wrapping);
    return {
        node: {
            tag: node.tag,
            props: node.props,
            cssClasses: withOrientationClass(node.props, generated === null ? [] : [generated]),
        },
        childContext: { ...resolved.childContext, orientation },
    };
}

interface RouteSink {
    readonly primitive: string;
    readonly spec: PrimitiveSpec;
    readonly outerProps: Record<string, unknown>;
    readonly contentProps: Record<string, unknown>;
    readonly backdropProps: Record<string, unknown>;
    readonly styleExtra: Record<string, unknown>;
    readonly events: ResolvedEvent[];
    readonly files: ResolvedFile[];
    readonly gestures: ResolvedGesture[];
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
        case 'file':
            sink.files.push({
                on: nodeOf(route.on, sink, prop),
                property: route.property,
                ...normaliseSource(sink.primitive, prop, value),
            });
            return;
        case 'gesture':
            if (typeof value !== 'function') {
                throw new PrimitiveError(
                    sink.primitive,
                    `prop "${prop}"`,
                    `binds a Gtk.GestureClick's "${route.signal}" and needs a function; got ${describe(value)}`,
                );
            }
            sink.gestures.push({ prop, signal: route.signal });
            return;
        case 'property': {
            const on = nodeOf(route.on, sink, prop);
            const target =
                on === 'content' ? sink.contentProps : on === 'backdrop' ? sink.backdropProps : sink.outerProps;
            const coerced = coerce(route, prop, value, sink.primitive);
            for (const name of route.names) target[name] = coerced;
            if (route.also !== undefined) Object.assign(target, route.also);
            return;
        }
    }
}

/** The node a route names, refusing a table that names one the primitive does not have. */
function nodeOf(on: NodeKind | undefined, sink: RouteSink, prop: string): NodeKind {
    if (on === 'content' && sink.spec.content === undefined) {
        throw new PrimitiveError(
            sink.primitive,
            `prop "${prop}"`,
            'is routed to a content node this primitive does not declare — the table is wrong, not the call',
        );
    }
    if (on === 'backdrop' && sink.spec.backdrop === undefined) {
        throw new PrimitiveError(
            sink.primitive,
            `prop "${prop}"`,
            'is routed to a backdrop node this primitive does not declare — the table is wrong, not the call',
        );
    }
    return on ?? 'outer';
}

/**
 * `source` → the one file GTK can open, or a named refusal saying why not.
 *
 * FOUR SHAPES REACH HERE AND ONE SURVIVES, and each refusal is a measurement rather
 * than a scheduling statement:
 *
 * - `{ uri }` with a local path, a `file:` URI or a `resource:` URI is the one that
 *   works. MEASURED: `Gio.File.new_for_uri('resource:///a/b.png')` round-trips its
 *   URI and `Gtk.Picture:file` accepts it, and a path that does not exist leaves
 *   `paintable` null with no diagnostic at all.
 * - `http:` / `https:` / `data:` need a LOADER. `Gtk.Picture:file` would hand a
 *   non-native `Gio.File` to a synchronous decoder on the main loop, and the honest
 *   alternative — fetch, decode, `Gdk.Texture.new_from_bytes` — is an asynchronous
 *   pipeline with a cache and a cancellation story, which is a package rather than a
 *   prop route.
 * - a NUMBER is `require('./x.png')`, an opaque id into Metro's asset registry. ADR
 *   0032 § 12 puts the build chain with the consumer, and this one has no registry to
 *   resolve the id against.
 * - an ARRAY is React Native's per-device-scale picker (`@2x`, `@3x`). GTK scales one
 *   texture by the surface's scale factor, so there is no choice to make.
 */
function normaliseSource(
    primitive: string,
    prop: string,
    value: unknown,
): { readonly kind: 'path' | 'uri'; readonly value: string } {
    const refuse = (why: string): never => {
        throw new PrimitiveError(primitive, `prop "${prop}"`, why);
    };
    if (typeof value === 'number') {
        return refuse(
            "is a number, which is what `require('./image.png')` returns: an opaque id into React Native’s own asset registry. This build chain has no such registry (ADR 0032 § 12 leaves the build to the consumer), so there is nothing to resolve it against. Use `{ uri: '/path/to/image.png' }`, or ship the image in a GResource and use `{ uri: 'resource:///…' }`",
        );
    }
    if (Array.isArray(value)) {
        return refuse(
            'is an array, which is React Native’s per-device-scale picker (`@2x`, `@3x`). GTK draws ONE texture and scales it by the surface’s own scale factor, so there is no candidate to choose between. Give one source',
        );
    }
    if (typeof value === 'string') {
        return refuse(
            'is a bare string. React Native’s own type is `{ uri }`, and accepting both spellings here would make one string ambiguous between a path and a URI at exactly the layer that has to decide. Write `{ uri: … }`',
        );
    }
    if (value === null || typeof value !== 'object') {
        return refuse(`expects { uri }; got ${describe(value)}`);
    }
    const record = value as Record<string, unknown>;
    const extra = Object.keys(record).filter((key) => key !== 'uri');
    if (extra.length > 0) {
        return refuse(
            `carries ${extra.join(', ')} beside \`uri\`. Those describe a remote image React Native measures before it arrives (\`width\`/\`height\`) or fetches with headers, and neither reaches a \`Gtk.Picture\` — it takes a file and draws it. Keep \`uri\` alone`,
        );
    }
    const uri = record.uri;
    if (typeof uri !== 'string' || uri === '') {
        return refuse(`expects { uri: string }; got uri = ${describe(uri)}`);
    }
    const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(uri)?.[1]?.toLowerCase();
    if (scheme === undefined) return { kind: 'path', value: uri };
    if (scheme === 'file' || scheme === 'resource') return { kind: 'uri', value: uri };
    if (scheme === 'http' || scheme === 'https' || scheme === 'data') {
        return refuse(
            `is a \`${scheme}:\` URI, and loading one needs a fetch, a decoder and a cache — an asynchronous pipeline this layer does not own. Handing a non-native \`Gio.File\` to \`Gtk.Picture:file\` would decode on the main loop instead. Fetch the bytes yourself, build a \`Gdk.Texture\`, and set \`paintable\` through a ref`,
        );
    }
    return refuse(
        `is a \`${scheme}:\` URI, and this layer only opens what GTK can read synchronously: a local path, \`file:\` and \`resource:\` (measured). Anything else needs a loader that is not here`,
    );
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
