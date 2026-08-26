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

import {
    Children,
    createContext,
    createElement,
    isValidElement,
    useContext,
    useMemo,
    useRef,
    type ReactElement,
    type ReactNode,
    type Ref,
} from 'react';

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
    type WidgetNode,
} from './primitives/resolve.js';
import type { StyleInput } from './primitives/style.js';
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

const ParentContext = createContext<ChildContext | null>(null);

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
    }, [signature, events]);
    return { props: bound, widgetRef };
}

/** One plan node → its host props, in the order that makes precedence explicit. */
function nodeProps(node: WidgetNode, inherited: AnyProps, extra: AnyProps): AnyProps {
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

interface Rendered {
    readonly plan: PrimitivePlan;
    readonly children: readonly ReactNode[];
    readonly inherited: AnyProps;
    readonly extra: AnyProps;
    readonly published: ChildContext;
    readonly tokens: StyleTokens;
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
function usePlan(primitive: string, authored: object): Rendered {
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

    const extra: Record<string, unknown> = { ...signals.props, ref: mergedRef };
    // A child's `slot` is declared BY THE CHILD — the host reads it off the child at
    // placement time — so it belongs on this element's own props, not on its
    // parent's `createElement` call.
    if (plan.slot !== null) extra.slot = plan.slot;

    // Memoised on its own content: a fresh context value re-renders every consumer
    // below it, and this object is rebuilt on every call by construction.
    const contextKey = JSON.stringify(plan.childContext);
    const published = useMemo(() => plan.childContext, [contextKey, plan.childContext]);

    return { plan, children, inherited: parent?.props ?? {}, extra, published, tokens: config.tokens };
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
    const { plan, children, inherited, extra, published, tokens } = rendered;
    const wrap = (nodes: readonly ReactNode[]): ReactNode =>
        createElement(ParentContext.Provider, { value: published }, ...nodes);

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
    const inner = createElement(plan.content.tag, nodeProps(plan.content, {}, {}), wrap(ordinary));
    return createElement(
        plan.node.tag,
        nodeProps(plan.node, inherited, extra),
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

export interface PressableProps extends CommonProps {
    onPress?: () => void;
    disabled?: boolean;
    pointerEvents?: 'auto' | 'none';
    /**
     * `ReactNode`, NEVER a function.
     *
     * ADR 0032 § 7: children-as-a-function-of-`{ pressed }` belongs to the "usable"
     * milestone and is a NAMED BUILD-TIME REFUSAL until then. This declaration is
     * that build-time half — `children={({ pressed }) => …}` becomes a type error
     * naming the property — and it earns its place on its own: the press state is
     * the GTK CSS `:active` pseudo-class, so `active:opacity-70` already does what
     * nearly every use of the function form does, with no re-render at all. Measured
     * in the application ADR 0032 read: ZERO occurrences of the function form.
     */
    children?: ReactNode;
}

export function Pressable(props: PressableProps): ReactElement {
    // The runtime half of the same refusal, for the JavaScript callers a type cannot
    // reach. "Never an `undefined` render" is the requirement: React renders a
    // function child as nothing at all, which presents as an empty button.
    if (typeof props.children === 'function') {
        throw new PrimitiveError(
            'Pressable',
            'children',
            'was given a function. Children-as-a-function-of-`{ pressed }` is not implemented (ADR 0032 § 7) — the press state is the GTK CSS `:active` pseudo-class, so write `className="active:opacity-70"` and GTK animates it with no re-render at all. A function child would otherwise render as nothing',
        );
    }
    return render(usePlan('Pressable', props));
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
