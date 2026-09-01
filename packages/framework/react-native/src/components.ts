// L3 — the React components. Thin, and thin is the point.
//
// Every one of the seven is the same two lines: ask L2 what this element becomes,
// and hand the answer to `createElement(<GType name>, …)`. There is no widget name
// in this file that L2 did not produce, no property mapping, and no styling
// decision — those all live one layer down, where a Vue or Solid adapter can reach
// them too (ADR 0032 § 1).
//
// `createElement` FROM `react`, NOT A JSX RUNTIME. A JSX runtime import would tie
// this module to a dialect the consumer has not chosen: they point
// `jsxImportSource` at `@gjsify/gtk-host/react` or at `react`, and importing
// `react/jsx-runtime` here would decide it for them. `app-registry.ts` records the
// same rule and the second half of its reason — a hand-built element literal's
// `$$typeof` symbol is React-version-specific (`react.element` became
// `react.transitional.element` in 19), so `createElement` is also the only spelling
// that does not pin a React version.
//
// WHAT THE PARENT CONTEXT IS AND IS NOT. `ParentContext` carries the four facts a
// child needs about its parent (`intents.ts`' `ChildContext`). It is L3's CARRIER
// for a parameter L2 takes as plain data, not the mechanism — which is the
// distinction ADR 0032 § 6 asks anyone touching this to be able to state. A Vue
// adapter would use `provide`/`inject`, and an attach-time resolver in the host
// would read the shadow tree; all three call the same `resolvePrimitive(name,
// props, { parent })` and none of them can see the others' carrier.
//
// WHY EVENT HANDLERS GO THROUGH A REF. The host strips the emitter before calling a
// handler (`next(...args.slice(1))` in `signals.ts`) and `Gtk.Editable::changed`
// carries no payload of its own, so `onChangeText(text)` cannot be built from the
// signal arguments at all. L2 says WHICH widget property holds the value
// (`ResolvedEvent.read`); this file reads it off the widget its ref holds.

import Gio from 'gi://Gio';
import {
    Children,
    createElement,
    isValidElement,
    useContext,
    useEffect,
    useMemo,
    useRef,
    useState,
    type ReactElement,
    type ReactNode,
    type Ref,
} from 'react';

import { ParentContext, ParentProvider } from './parent-context.js';
import { onGesture, onPressStateChange } from './press.js';
import type { ClassNameInput } from './primitives/classes.js';
import { PrimitiveError } from './primitives/errors.js';
import {
    declaresAbsolute,
    resolvePrimitive,
    type ChildContext,
    type ChildFacts,
    type PrimitivePlan,
    type PrimitiveProps,
    type ResolvedEvent,
    type ResolvedFile,
    type ResolvedGesture,
    type WidgetNode,
} from './primitives/resolve.js';
import { flattenStyle, type StyleAuthored, type StyleInput, type StyleObject } from './primitives/style.js';
import { isAnimatedValue } from './animated/brand.js';
import { animatedProperty, assertNoStaticClash } from './animated/properties.js';
import type { AnimatedValue } from './animated/value.js';
import { styleConfig } from './style-config.js';
import type { StyleTokens } from '@gjsify/gtk-host/style';

/** What every primitive accepts on top of its own props. */
export interface CommonProps {
    className?: ClassNameInput;
    style?: StyleInput;
    children?: ReactNode;
    /** The `Gtk.Widget` itself — the host's `getPublicInstance` hands back the real widget. */
    ref?: Ref<unknown>;
    testID?: string;
}

type AnyProps = Readonly<Record<string, unknown>>;

/** `max-length` → `maxLength`: the spelling GJS installs the JS accessor under. */
const accessor = (name: string): string => name.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());

const isTextNode = (child: ReactNode): boolean => typeof child === 'string' || typeof child === 'number';

/**
 * Does this child declare `position: absolute`?
 *
 * The predicate is L2's, so the COUNT the parent takes here and the PLACEMENT it
 * makes later cannot disagree. The `catch` is the one place in this package where
 * swallowing is correct, and it is not defensive padding: the parent is asking a
 * question about SOMEBODY ELSE'S props, and a composite child whose `style` carries
 * a property L1 does not route (`<MyCard style={{ shadowColor }}/>`, a component
 * that never reaches L2) would otherwise make the PARENT throw for a defect that is
 * not its own. Nothing is lost — a child that really is absolute and answered
 * `false` here lands under a parent that stayed a `Gtk.Box`, and `resolveIntent`
 * refuses it by name: "the PARENT has to be a `Gtk.Overlay`, and it is not".
 */
function isAbsoluteChild(child: ReactNode, tokens: StyleTokens): boolean {
    if (!isValidElement(child)) return false;
    try {
        return declaresAbsolute(child.props as PrimitiveProps, tokens);
    } catch {
        return false;
    }
}

function childFacts(children: readonly ReactNode[], tokens: StyleTokens): ChildFacts {
    let absolute = 0;
    let text = false;
    for (const child of children) {
        if (isTextNode(child)) text = true;
        else if (isAbsoluteChild(child, tokens)) absolute++;
    }
    return { absolute, count: children.length, text };
}

/**
 * L2's `events` → host props, with STABLE identities.
 *
 * Stable because a new function per render makes the props change every render,
 * which makes the host disconnect and reconnect every handler every render — one
 * `g_signal_connect` per event per commit, for nothing. The dispatchers close over a
 * ref to the latest props instead, so the user's callback may change freely while
 * the identity the host sees does not.
 *
 * The dependency is the SIGNAL LIST rather than `events`, whose array identity is
 * new on every call by construction.
 */
function useSignals(
    events: readonly ResolvedEvent[],
    props: AnyProps,
): { readonly props: AnyProps; readonly widgetRef: { current: unknown } } {
    const widgetRef = useRef<unknown>(null);
    const latest = useRef(props);
    latest.current = props;
    const signature = events.map((event) => `${event.prop}>${event.signal}>${event.read ?? ''}`).join('|');
    const bound = useMemo(() => {
        const out: Record<string, () => void> = {};
        for (const event of events) {
            // `on:<raw signal name>` — `parseEventProp` takes that spelling verbatim,
            // which is the only one that works for `notify::active`: the camelCase
            // form would kebab the whole string into `notify-active`.
            out[`on:${event.signal}`] = () => {
                const callback = latest.current[event.prop];
                if (typeof callback !== 'function') return;
                if (event.read === null) {
                    (callback as () => void)();
                    return;
                }
                const widget = widgetRef.current as Record<string, unknown> | null;
                (callback as (value: unknown) => void)(widget === null ? undefined : widget[accessor(event.read)]);
            };
        }
        return out;
        // `signature` ALONE, deliberately. `events` is freshly allocated by every
        // `resolvePrimitive` call, so including it invalidated the memo on every
        // render and the host reconnected every signal on every commit — the exact
        // opposite of what this function exists for. Dropping it is safe because the
        // closures read only `event.prop`/`event.signal`/`event.read`, all three of
        // which `signature` encodes; a stale array with an equal signature is
        // behaviourally identical, and the CALLBACKS come from `latest.current`.
    }, [signature]);
    return { props: bound, widgetRef };
}

/** One plan node → its host props, in the order that makes precedence explicit. */
export function nodeProps(node: WidgetNode, inherited: AnyProps, extra: AnyProps): AnyProps {
    // inherited (the parent's `alignItems`) < the element's own (its `alignSelf`,
    // its style, its props) < the framework's (ref, slot, signal handlers, which
    // never collide with a GTK property name). That middle step is flexbox's own
    // `align-self` beats `align-items`, encoded as a merge order.
    const out: Record<string, unknown> = { ...inherited, ...node.props, ...extra };
    // Set `css-classes` ONLY when there is something to set. Writing `[]` would
    // CLEAR whatever else put classes there, and ADR 0032 § 5 asks for a union — the
    // cheapest union is not touching the property when this layer has nothing to add.
    if (node.cssClasses.length > 0) out['css-classes'] = [...node.cssClasses];
    return out;
}

export interface Rendered {
    readonly plan: PrimitivePlan;
    readonly children: readonly ReactNode[];
    readonly inherited: AnyProps;
    readonly extra: AnyProps;
    /** `Gio.File` values and the slot, for the content node. */
    readonly contentExtra: AnyProps;
    /** `Gio.File` values and the slot, for the backdrop node. */
    readonly backdropExtra: AnyProps;
    readonly published: ChildContext;
    readonly tokens: StyleTokens;
    /** The element's own `Gtk.Widget`, once it is attached. The press and gesture seams need it. */
    readonly widgetRef: { current: unknown };
}

/**
 * The shared body of all seven components.
 *
 * `props` is `object` and cast ONCE here, rather than each component's own props
 * interface. An interface without an index signature is not assignable to
 * `Record<string, unknown>` (TS2345), and widening every one of the seven with
 * `[key: string]: unknown` would make a MISSPELLED prop type-check — which is
 * exactly the refusal L2's unknown-prop throw exists to give at build time through
 * these declarations.
 */
export function usePlan(primitive: string, authored: object): Rendered {
    const props = authored as AnyProps;
    const parent = useContext(ParentContext);
    const config = styleConfig();
    const children = Children.toArray((props as { children?: ReactNode }).children);
    const plan = resolvePrimitive(primitive, props as PrimitiveProps, {
        tokens: config.tokens,
        sheet: config.sheet,
        ...(parent === null ? {} : { parent }),
        children: childFacts(children, config.tokens),
    });

    // THE ONE SILENT DROP THIS LAYER HAD, AND WHY IT IS NOW LOUD.
    //
    // `resolveIntent` answers what it can and hands back the rest as
    // `plan.intent` — `expand` and `alignSelf` when no parent context exists,
    // `overlay` when the parent never became one. Nothing read it, so at the ROOT of
    // a tree `flex-1`, `self-*` and `absolute` did exactly nothing, with no message
    // anywhere. That is the failure mode the whole partition is built against, sitting
    // in the layer that argues for it.
    //
    // A root element genuinely cannot answer these — `flex-1` means "grow along my
    // parent's main axis" and there is no parent — so the honest answer is a refusal
    // naming the utility and the position, not a no-op.
    //
    // THE OBVIOUS FIX WAS TRIED AND WITHDRAWN, so nobody spends the afternoon again.
    // Defining a root context as a column (React Native's root view IS one, so it
    // reads as a definition rather than a guess) makes `flex-1` at the root resolve —
    // and the parity vector immediately caught the two bindings DISAGREEING: React
    // wrote `vexpand` onto the adopted container widget and Solid did not, for the
    // same authored tree. A feature whose two frameworks differ is worse than a
    // refusal, so this stays a refusal until that difference is understood. The
    // workaround is the container's own expand, which the application owns anyway.
    const unresolved = Object.keys(plan.intent);
    if (unresolved.length > 0) {
        throw new PrimitiveError(
            primitive,
            unresolved.join(', '),
            'carries layout that cannot be resolved at this position. These need a parent to resolve against — ' +
                '`flex-1` and `self-*` need the parent orientation, `absolute` needs the parent to be an overlay — ' +
                'and this element is the root of its tree, or its parent is not a box. Wrap it in a <View>, or move ' +
                'the utility to a child.',
        );
    }

    const signals = useSignals(plan.events, props);
    const userRef = (props as { ref?: Ref<unknown> }).ref;
    // Memoised on the user's ref identity: a new callback ref every render makes
    // React detach (call with null) and re-attach on every commit, which would leave
    // `widgetRef.current` null for the duration of a handler that fired in between.
    const mergedRef = useMemo(
        () => (widget: unknown) => {
            signals.widgetRef.current = widget;
            if (typeof userRef === 'function') userRef(widget);
            else if (userRef !== null && userRef !== undefined) (userRef as { current: unknown }).current = widget;
        },
        [userRef, signals.widgetRef],
    );

    useGestures(plan.gestures, props, signals.widgetRef);
    const files = useFiles(plan.files);

    const extra: Record<string, unknown> = { ...signals.props, ref: mergedRef, ...files.outer };
    // A child's `slot` is declared BY THE CHILD — the host reads it off the child at
    // placement time — so it belongs on this element's own props, not on its
    // parent's `createElement` call.
    if (plan.slot !== null) extra.slot = plan.slot;
    const contentExtra: Record<string, unknown> = { ...files.content };
    if (plan.contentSlot !== null) contentExtra.slot = plan.contentSlot;
    const backdropExtra: Record<string, unknown> = { ...files.backdrop };
    if (plan.backdropSlot !== null) backdropExtra.slot = plan.backdropSlot;

    // Memoised on its own content: a fresh context value re-renders every consumer
    // below it, and this object is rebuilt on every call by construction.
    const contextKey = JSON.stringify(plan.childContext);
    const published = useMemo(() => plan.childContext, [contextKey, plan.childContext]);

    return {
        plan,
        children,
        inherited: parent?.props ?? {},
        extra,
        contentExtra,
        backdropExtra,
        published,
        tokens: config.tokens,
        widgetRef: signals.widgetRef,
    };
}

/**
 * L2's `files` → `Gio.File` values, one per node, with a STABLE identity.
 *
 * Memoised on the URIs rather than rebuilt per render, and for the same reason
 * `useSignals` memoises its dispatchers: a fresh `Gio.File` every render makes the
 * props change every render, so the host writes `Gtk.Picture:file` on every commit —
 * and writing that property makes GTK re-read and re-decode the image.
 *
 * This is the one place in L3 that constructs a `gi://` value, and L2 decided
 * everything about it: which shapes are refused, which schemes have a synchronous
 * loader, and whether the string is a path or a URI (`ResolvedFile`). All that is left
 * here is the call GTK needs.
 */
function useFiles(files: readonly ResolvedFile[]): {
    readonly outer: AnyProps;
    readonly content: AnyProps;
    readonly backdrop: AnyProps;
} {
    const signature = files.map((file) => `${file.on}>${file.property}>${file.kind}>${file.value}`).join('|');
    return useMemo(() => {
        const nodes: {
            outer: Record<string, unknown>;
            content: Record<string, unknown>;
            backdrop: Record<string, unknown>;
        } = {
            outer: {},
            content: {},
            backdrop: {},
        };
        for (const file of files) {
            nodes[file.on][file.property] =
                file.kind === 'path' ? Gio.File.new_for_path(file.value) : Gio.File.new_for_uri(file.value);
        }
        return nodes;
        // `signature` alone, exactly as `useSignals` does it: `files` is freshly
        // allocated by every `resolvePrimitive` call, so including it would invalidate
        // the memo on every render and undo the whole point.
    }, [signature]);
}

/**
 * L2's `gestures` → a `Gtk.GestureClick` on the widget, for as long as it is mounted.
 *
 * `TouchableWithoutFeedback` is the only primitive that needs it, and the reason it is
 * an effect rather than a prop is that a controller is not a property: it is
 * `widget.add_controller(new Gtk.GestureClick())`, which needs the widget to exist.
 * `press.ts` owns both halves of that and REMOVES the controller in the disposer —
 * GJS blocks JS callbacks during GC, so a controller left on a widget is a handler
 * connected for the life of the process.
 */
function useGestures(gestures: readonly ResolvedGesture[], props: AnyProps, widgetRef: { current: unknown }): void {
    const latest = useRef(props);
    latest.current = props;
    const signature = gestures.map((gesture) => `${gesture.prop}>${gesture.signal}`).join('|');
    useEffect(() => {
        const widget = widgetRef.current;
        if (signature === '' || widget === null || widget === undefined) return;
        const disposers = signature.split('|').map((entry) => {
            const [prop, signal] = entry.split('>');
            return onGesture(widget as Parameters<typeof onGesture>[0], signal as string, () => {
                const callback = latest.current[prop as string];
                if (typeof callback === 'function') (callback as () => void)();
            });
        });
        return () => {
            for (const dispose of disposers) dispose();
        };
    }, [signature, widgetRef]);
}

/**
 * A plan plus its children → the React elements.
 *
 * THREE arrangements, and the plan says which one without this function ever
 * branching on a primitive name: no content node (children go straight in), a
 * content node (children go into it), and a content node with an `absoluteSlot`
 * (ordinary children go into it, absolutely positioned ones go into the OUTER node,
 * where `Gtk.Overlay`'s `add_overlay` slot takes them).
 */
function render(rendered: Rendered): ReactElement {
    const { plan, children, inherited, extra, contentExtra, backdropExtra, published, tokens } = rendered;
    const wrap = (nodes: readonly ReactNode[]): ReactNode =>
        createElement(ParentProvider, { value: published }, ...nodes);

    if (plan.content === null) {
        // A text run must NOT be wrapped in a provider. A provider is not a host
        // element, and the reconciler would still deliver the string as a text
        // instance — but nothing under a sink-only primitive has children to publish
        // to, so the wrapper would be pure overhead on the most common element in
        // any application (233 `Text` uses against 55 `View`s, ADR 0032's
        // measurement).
        const body = children.some(isTextNode) ? children : [wrap(children)];
        return createElement(plan.node.tag, nodeProps(plan.node, inherited, extra), ...body);
    }

    const absolute = plan.absoluteSlot === null ? [] : children.filter((child) => isAbsoluteChild(child, tokens));
    const ordinary =
        plan.absoluteSlot === null ? children : children.filter((child) => !isAbsoluteChild(child, tokens));
    const inner = createElement(plan.content.tag, nodeProps(plan.content, {}, contentExtra), wrap(ordinary));
    // The BACKDROP first, and the order is load-bearing rather than cosmetic: it is the
    // overlay's MAIN child (`slot="child"`, a setter slot) and the content box is an
    // `add_overlay` on top of it. A `Gtk.Overlay` paints its overlays above its main
    // child, so a backdrop added second would still be behind — but the main child is
    // also the one the overlay measures, and giving it to the overlay before anything
    // stacks on it is what makes the element's first measurement its real one.
    const backdrop =
        plan.backdrop === null ? [] : [createElement(plan.backdrop.tag, nodeProps(plan.backdrop, {}, backdropExtra))];
    return createElement(
        plan.node.tag,
        nodeProps(plan.node, inherited, extra),
        ...backdrop,
        inner,
        ...(absolute.length === 0 ? [] : [wrap(absolute)]),
    );
}

// ---------------------------------------------------------------------------
// The seven
// ---------------------------------------------------------------------------

export interface ViewProps extends CommonProps {
    /** `auto` and `none` only — GTK's `can-target` covers the widget AND its subtree. */
    pointerEvents?: 'auto' | 'none';
}

export function View(props: ViewProps): ReactElement {
    return render(usePlan('View', props));
}

export interface TextProps extends CommonProps {
    numberOfLines?: number;
    ellipsizeMode?: 'head' | 'middle' | 'tail';
    selectable?: boolean;
}

export function Text(props: TextProps): ReactElement {
    return render(usePlan('Text', props));
}

/** What React Native hands a `Pressable`'s function child. */
export interface PressableState {
    readonly pressed: boolean;
}

export interface PressableProps extends Omit<CommonProps, 'children'> {
    onPress?: () => void;
    disabled?: boolean;
    pointerEvents?: 'auto' | 'none';
    /**
     * A node, or a function of `{ pressed }`.
     *
     * THE FUNCTION FORM IS THE EXPENSIVE ONE AND IT IS NOT THE DEFAULT PATH. ADR 0032
     * § 7: press styling is the GTK CSS `:active` pseudo-class, `active:opacity-70`
     * costs nothing, and GTK animates the state itself with no re-render — measured in
     * the application ADR 0032 read, the function form occurs ZERO times. So the
     * function form is implemented for the code that does use it, and an element that
     * does not use it subscribes to nothing at all: `press.ts`' `pressWatchCount()`
     * exists so a spec can hold that apart, because both render and only a count tells
     * them apart.
     */
    children?: ReactNode | ((state: PressableState) => ReactNode);
}

export function Pressable(props: PressableProps): ReactElement {
    const asFunction =
        typeof props.children === 'function' ? (props.children as (s: PressableState) => ReactNode) : null;
    // Unconditional, because hooks are — and free when the function form is unused:
    // nothing ever calls this setter, so the state never changes and React never
    // re-renders for it.
    const [pressed, setPressed] = useState(false);
    const rendered = usePlan(
        'Pressable',
        asFunction === null ? props : { ...props, children: asFunction({ pressed }) },
    );
    const widgetRef = rendered.widgetRef;
    useEffect(() => {
        // THE CHEAP PATH'S GUARD. No function child means no subscription, which means
        // `state-flags-changed` is never connected and a finger going down never
        // reaches the reconciler. The `active:*` utilities still work — they became CSS
        // in L1 and are already on the widget.
        if (asFunction === null) return;
        const widget = widgetRef.current;
        if (widget === null || widget === undefined) return;
        return onPressStateChange(widget as Parameters<typeof onPressStateChange>[0], setPressed);
    }, [asFunction === null, widgetRef]);
    return render(rendered);
}

export interface ScrollViewProps extends CommonProps {
    horizontal?: boolean;
    showsVerticalScrollIndicator?: boolean;
    showsHorizontalScrollIndicator?: boolean;
    contentContainerStyle?: StyleInput;
    /** NativeWind's spelling for the inner node's class list. See `ContentSpec.classNameProp`. */
    contentContainerClassName?: ClassNameInput;
}

export function ScrollView(props: ScrollViewProps): ReactElement {
    return render(usePlan('ScrollView', props));
}

export interface ActivityIndicatorProps extends CommonProps {
    animating?: boolean;
    size?: 'small' | 'large' | number;
    color?: string;
    hidesWhenStopped?: boolean;
}

export function ActivityIndicator(props: ActivityIndicatorProps): ReactElement {
    return render(usePlan('ActivityIndicator', props));
}

export interface TextInputProps extends CommonProps {
    value?: string;
    defaultValue?: string;
    placeholder?: string;
    onChangeText?: (text: string) => void;
    onSubmitEditing?: () => void;
    /** One prop, two widgets: `Gtk.Entry` without it, `Gtk.TextView` with it. */
    multiline?: boolean;
    editable?: boolean;
    maxLength?: number;
    secureTextEntry?: boolean;
    keyboardType?: 'default' | 'email-address' | 'phone-pad' | 'number-pad' | 'numeric' | 'decimal-pad' | 'url';
}

export function TextInput(props: TextInputProps): ReactElement {
    return render(usePlan('TextInput', props));
}

export interface SwitchProps extends CommonProps {
    value?: boolean;
    onValueChange?: (value: boolean) => void;
    disabled?: boolean;
}

export function Switch(props: SwitchProps): ReactElement {
    return render(usePlan('Switch', props));
}

// ---------------------------------------------------------------------------
// P2 — the surface that makes the layer usable rather than a subset
// ---------------------------------------------------------------------------

/** React Native's `ImageSourcePropType`, as much of it as GTK can open. */
export interface ImageURISource {
    /** A local path, a `file:` URI or a `resource:` URI. Anything else is refused by name. */
    uri: string;
}

export interface ImageProps extends Omit<CommonProps, 'children'> {
    source?: ImageURISource;
    /** `repeat` is absent on purpose: `Gtk.ContentFit` has no tiling member (measured). */
    resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
    /** React Native 0.71's own name for the accessible description — `Gtk.Picture:alternative-text`. */
    alt?: string;
}

export function Image(props: ImageProps): ReactElement {
    return render(usePlan('Image', props));
}

export interface ImageBackgroundProps extends CommonProps {
    source?: ImageURISource;
    resizeMode?: 'cover' | 'contain' | 'stretch' | 'center';
    alt?: string;
    /** Styles the picture behind the children, not the container. React Native's own name. */
    imageStyle?: StyleInput;
    pointerEvents?: 'auto' | 'none';
}

export function ImageBackground(props: ImageBackgroundProps): ReactElement {
    return render(usePlan('ImageBackground', props));
}

/**
 * The Touchable family, written OVER `Pressable` rather than beside it.
 *
 * ADR 0032's planning entries say "the same machinery as Pressable, and nearly free
 * once it exists", and this is what that costs when it is true: the three components
 * are one line each over the same `usePlan`/`render` pair, and the only thing that
 * differs is the row L2 looks up — `TouchableOpacity` and `TouchableHighlight` spread
 * `Pressable`'s own routes out of one shared record, and `TouchableWithoutFeedback` is
 * a `Gtk.Box` with a gesture controller because it has no chrome to press.
 *
 * `activeOpacity` and `underlayColor` are refusals rather than mappings, and the
 * reason is ADR 0032 § 3 rather than ADR 0032 § 7: honouring them would put an opacity
 * and a colour into the styling path that did not come from the project's token scale.
 * `active:opacity-70` and `active:bg-<token>` do the same thing through the mechanism
 * that reads it.
 */
export interface TouchableProps extends PressableProps {
    /** Refused by name — write `active:opacity-70`. Declared so the type says so too. */
    activeOpacity?: never;
}

export function TouchableOpacity(props: TouchableProps): ReactElement {
    return render(usePlan('TouchableOpacity', props));
}

export interface TouchableHighlightProps extends TouchableProps {
    /** Refused by name — write `active:bg-<token>`. */
    underlayColor?: never;
}

export function TouchableHighlight(props: TouchableHighlightProps): ReactElement {
    return render(usePlan('TouchableHighlight', props));
}

export interface TouchableWithoutFeedbackProps extends Omit<TouchableProps, 'children'> {
    children?: ReactNode;
}

export function TouchableWithoutFeedback(props: TouchableWithoutFeedbackProps): ReactElement {
    return render(usePlan('TouchableWithoutFeedback', props));
}

/**
 * The one component whose styling story is "you cannot", in both vocabularies.
 *
 * `ButtonProps` does NOT extend `CommonProps`, which is the build-time half of the
 * refusal: `<Button style={…}>` is a type error naming the property. The runtime half
 * is L2's `refusesStyle`, checked before any prop is routed, so a JavaScript caller and
 * the second L3 get the same sentence.
 */
export interface ButtonProps {
    title: string;
    onPress?: () => void;
    disabled?: boolean;
    testID?: string;
    ref?: Ref<unknown>;
}

export function Button(props: ButtonProps): ReactElement {
    return render(usePlan('Button', props));
}

/**
 * A no-op that still lays out — which is what keeps it a no-op rather than a bug.
 *
 * The insets a `SafeAreaView` exists to apply are zero on a desktop window, so the
 * INSET is what disappears. Everything else about it is a `View`: a vertical box, its
 * children in a column, the same overlay switch when one of them is absolutely
 * positioned, the same style vocabulary. A component that rendered nothing, or that
 * rendered a `Gtk.Box` with the children dropped, would be a layout that silently
 * lost a screen.
 */
export function SafeAreaView(props: ViewProps): ReactElement {
    return render(usePlan('SafeAreaView', props));
}

export interface KeyboardAvoidingViewProps extends ViewProps {
    /** A declared no-op: there is no on-screen keyboard to move out of the way of. */
    behavior?: 'height' | 'position' | 'padding';
    keyboardVerticalOffset?: number;
    enabled?: boolean;
}

/**
 * The same no-op, and the same reason it still lays out.
 *
 * React Native's `KeyboardAvoidingView` IS a `View` that changes its own height,
 * padding or position while a keyboard is up. No keyboard comes up here, so what is
 * left is the `View` — and `behavior`, `keyboardVerticalOffset` and `enabled` are
 * declared no-ops in the table rather than refusals, because they describe the
 * behaviour that is already off.
 */
export function KeyboardAvoidingView(props: KeyboardAvoidingViewProps): ReactElement {
    return render(usePlan('KeyboardAvoidingView', props));
}

export interface StatusBarProps {
    barStyle?: 'default' | 'light-content' | 'dark-content';
    hidden?: boolean;
    backgroundColor?: string;
    translucent?: boolean;
    animated?: boolean;
    networkActivityIndicatorVisible?: boolean;
    showHideTransition?: 'fade' | 'slide' | 'none';
}

/**
 * Renders NOTHING, and that is the whole of it — there is no status bar.
 *
 * The one component in this file with no widget. `<StatusBar barStyle="light-content"/>`
 * is in the first ten lines of most React Native screens, so it has to render; a
 * desktop window has no bar above it to configure, so it must not render a box that
 * takes space in the column. `null` is both.
 *
 * Its props are ACCEPTED rather than refused, which is the one place this component
 * differs from `Keyboard`: they are declarative appearance hints with nothing to apply
 * them to, like `hidesWhenStopped` on the spinner. Its imperative statics are a
 * different question and refuse by name — see `StatusBarStatics`.
 */
export function StatusBar(_props: StatusBarProps): null {
    return null;
}

/**
 * `StatusBar`'s statics, each refusing by name.
 *
 * These are imperative calls a component makes to change the bar NOW, and every one of
 * them would be a call that appears to work. `currentHeight` is the sharpest: it is
 * read into a layout (`paddingTop: StatusBar.currentHeight`), so an invented number
 * would inset a desktop window by a phone's status bar for ever.
 */
const NO_STATUS_BAR =
    'configures the status bar above a phone screen, and a desktop window has none — the space above it belongs to the compositor and the header bar inside it is `Adw.HeaderBar`, an ordinary widget you render. This refuses rather than accepting the call, because a setter that appears to work is indistinguishable from one that does';

const statusBarStatics = {
    setBarStyle: (): never => {
        throw new PrimitiveError('StatusBar', 'setBarStyle', NO_STATUS_BAR);
    },
    setHidden: (): never => {
        throw new PrimitiveError('StatusBar', 'setHidden', NO_STATUS_BAR);
    },
    setBackgroundColor: (): never => {
        throw new PrimitiveError('StatusBar', 'setBackgroundColor', NO_STATUS_BAR);
    },
    setTranslucent: (): never => {
        throw new PrimitiveError('StatusBar', 'setTranslucent', NO_STATUS_BAR);
    },
    setNetworkActivityIndicatorVisible: (): never => {
        throw new PrimitiveError('StatusBar', 'setNetworkActivityIndicatorVisible', NO_STATUS_BAR);
    },
    pushStackEntry: (): never => {
        throw new PrimitiveError('StatusBar', 'pushStackEntry', NO_STATUS_BAR);
    },
    popStackEntry: (): never => {
        throw new PrimitiveError('StatusBar', 'popStackEntry', NO_STATUS_BAR);
    },
    replaceStackEntry: (): never => {
        throw new PrimitiveError('StatusBar', 'replaceStackEntry', NO_STATUS_BAR);
    },
    get currentHeight(): never {
        throw new PrimitiveError(
            'StatusBar',
            'currentHeight',
            'is the height of a phone’s status bar, and code reads it straight into a layout (`paddingTop: StatusBar.currentHeight`). A desktop window has no such bar, so any number here would inset every ported screen by a bar that is not there. Use 0 explicitly if that is what you mean',
        );
    },
};

// `defineProperties` over the DESCRIPTORS, not `Object.assign`. `Object.assign` READS
// every source property, so it invoked the `currentHeight` getter and the refusal fired
// at module load — the whole test entry threw before a single spec ran. A getter that
// throws is exactly what this one is for, and copying it has to copy the getter rather
// than its value.
Object.defineProperties(StatusBar, Object.getOwnPropertyDescriptors(statusBarStatics));

// ---------------------------------------------------------------------------
// `Animated.View`
// ---------------------------------------------------------------------------

/** A `style` prop that may carry `Animated.Value`s. */
export type AnimatedStyleInput = StyleInput | Readonly<Record<string, unknown>>;

export interface AnimatedViewProps extends Omit<ViewProps, 'style'> {
    style?: AnimatedStyleInput;
}

/** One animated style entry, after the split. */
interface AnimatedBinding {
    readonly key: string;
    readonly value: AnimatedValue;
}

/**
 * An authored style → the plain half and the animated half.
 *
 * The split has to happen BEFORE the partition, and that is measured rather than
 * tidy: `@gjsify/gtk-host/style`'s `partitionPaint` pushes `${cssName}: ${value}`
 * with no check on the value's type, so an `Animated.Value` left in the object
 * becomes the GTK CSS declaration `opacity: [object Object]` — which GTK's parser
 * drops in silence. `primitives/style.ts` now refuses a non-scalar style value for
 * the same reason, which is what makes forgetting the `Animated.` on a plain
 * `<View>` a named error instead of a screen where nothing moves.
 */
function splitAnimatedStyle(
    primitive: string,
    style: AnimatedStyleInput | undefined,
): { readonly plain: StyleObject; readonly bindings: readonly AnimatedBinding[] } {
    const flat = flattenStyle(style as StyleInput);
    const plain: Record<string, unknown> = {};
    const bindings: AnimatedBinding[] = [];
    for (const [key, value] of Object.entries(flat)) {
        if (!isAnimatedValue(value)) {
            plain[key] = value;
            continue;
        }
        // The refusal for an unanimatable key fires here, at the element, rather than
        // inside the effect that would have bound it: an effect's stack names the
        // effect, and an author needs the element.
        animatedProperty(primitive, key);
        bindings.push({ key, value: value as AnimatedValue });
    }
    return { plain, bindings };
}

/**
 * A `View` whose animated style entries drive GTK widget properties directly.
 *
 * NO RE-RENDER PER FRAME, and that is the design rather than an optimisation. An
 * `Animated.Value` behind an `opacity` could have been React state, and then a 300 ms
 * fade would be ~18 reconciler passes over the subtree for a property GTK can
 * interpolate itself. So the value writes `Gtk.Widget:opacity` through the sink bound
 * below, `Adw.TimedAnimation` owns the frame clock (`animated/timing.ts`), and React
 * sees exactly two commits: the mount and the unmount.
 *
 * THE FIRST FRAME IS RENDERED, NOT BOUND. The sink is attached in an effect, which
 * runs after the commit — so the initial number is ALSO written as a widget property
 * in the render itself. Without it a `new Animated.Value(0)` behind an opacity paints
 * one frame fully opaque before the effect makes it transparent, which is a flash on
 * every mount of every faded-in screen.
 */
export function AnimatedView(props: AnimatedViewProps): ReactElement {
    const config = styleConfig();
    const { plain, bindings } = splitAnimatedStyle('Animated.View', props.style);
    const authored: AnimatedViewProps = { ...props, style: plain };
    assertNoStaticClash(
        'Animated.View',
        authored as StyleAuthored,
        bindings.map((binding) => binding.key),
        config.tokens,
    );

    const rendered = usePlan('View', authored);
    const widgetRef = rendered.widgetRef;
    // The VALUE's identity is in the signature, not just the key: a component that
    // swaps one `Animated.Value` for another under the same style key has to rebind,
    // and a key-only signature would leave the widget attached to the old value for
    // ever. `AnimatedValue.id` exists for exactly this comparison.
    const signature = bindings.map((binding) => `${binding.key}#${binding.value.id}`).join('|');
    const latest = useRef(bindings);
    latest.current = bindings;

    useEffect(() => {
        const widget = widgetRef.current;
        if (signature === '' || widget === null || widget === undefined) return;
        const target = widget as Record<string, unknown>;
        const disposers = latest.current.map((binding) => {
            const property = accessor(animatedProperty('Animated.View', binding.key).property);
            return binding.value.__attach({
                widget,
                write: (value: number) => {
                    target[property] = value;
                },
            });
        });
        return () => {
            for (const dispose of disposers) dispose();
        };
        // `signature` alone, for `useSignals`' reason: `bindings` is a fresh array on
        // every render, and including it would unbind and rebind every value on every
        // commit — which for a running animation means losing its frame clock, which
        // `AnimatedValue` correctly reports as `{ finished: false }`. The effect would
        // have cancelled the animation it exists to serve.
    }, [signature, widgetRef]);

    const initial: Record<string, unknown> = {};
    for (const binding of bindings) {
        initial[accessor(animatedProperty('Animated.View', binding.key).property)] = binding.value.__getValue();
    }
    return render({ ...rendered, extra: { ...rendered.extra, ...initial } });
}

/**
 * A themed icon — `Gtk.Image` with an `icon-name`.
 *
 * NOT a React Native name and not exported from the package root: it is the widget
 * ADR 0036's `@expo/vector-icons` surface renders, and it lives here rather than in
 * that surface for the reason ADR 0032 § 1 gives — a component that named `GtkImage`
 * itself would put a widget name in L3. `name` is a GTK icon name by the time it
 * arrives; the Ionicons vocabulary is translated in `surfaces/icon-map.ts`.
 */
export interface IconProps extends Omit<CommonProps, 'children'> {
    /** A GTK icon name, e.g. `go-home-symbolic`. */
    name: string;
    /** `Gtk.Image:pixel-size`, in pixels. */
    size?: number;
    color?: string;
}

export function Icon(props: IconProps): ReactElement {
    return render(usePlan('Icon', props));
}
