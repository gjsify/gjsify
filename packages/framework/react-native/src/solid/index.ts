// L3 — the SolidJS components, and the whole point of them is that L2 did not move.
//
// ADR 0032 § 1 splits this layer into L1 (the style partition), L2 (primitive
// descriptors as data) and L3 (framework components), and the entire justification
// for the split is that L1 and L2 carry no framework knowledge. With one L3 that was
// a CLAIM: a single binding cannot tell "the shared half is framework-agnostic" from
// "the shared half happens to fit React". Solid is the discriminator with the least
// in common with React that still renders a tree — no VDOM, no reconciler, no
// re-render: a component body runs ONCE and every later change arrives through a
// signal. The same `resolvePrimitive(name, props, ctx)` answering under both is the
// measurement, and `solid.spec.ts` renders one authored tree through each and
// compares the GTK widgets that come out.
//
// WHAT THE MEASUREMENT COST, stated first because it is the finding. One three-line
// change in L2 (`resolve.ts`' prop loop reads keys and applies the skip list before
// touching a value, because a Solid prop is a GETTER and the one behind `children`
// builds the subtree when it is read) and one defect found BELOW L2, in the host
// (`setProp` wrote `css-classes` through `set_property`, which cannot build a GStrv
// GValue out of a JS array — it only ever fired on an update, so a class list could
// be authored and never changed, which is what every spec here did). Neither is a
// widget mapping, a styling decision or a prop route. What is different in this file
// is not L2 but the CARRIER of the one parameter L2 takes as plain data —
// `{ parent }` — and it had to be, because the two frameworks build a tree in
// opposite directions:
//
//   React   the parent renders, provides a context, and THEN its children render.
//           It can inspect its children as descriptors before they are anything.
//   Solid   the children are created BOTTOM-UP, inside this body; by the time this
//           component can count them they are already GTK nodes, and its own node
//           does not exist yet.
//
// So the two facts L2 wants about the children (`ChildFacts`: how many are
// absolutely positioned, whether one is a text run) are read off the CREATED
// children, and the context they need on the way in is published as an ACCESSOR
// rather than a value. Neither of those is a change to L2; both are ten lines here.
//
// WHY THE FIRST RESOLUTION ASKS A HYPOTHETICAL QUESTION. The order above has one
// genuine cycle in it: what this element publishes to its children includes
// `overlay` — "am I a `Gtk.Overlay` that can take an absolutely positioned child" —
// and that answer depends on the children, who need the context to resolve at all.
// It is broken by asking L2 the question the child actually has, which is not "did
// one arrive" but "WOULD you host one": one resolution with `ONE_ABSOLUTE_CHILD`,
// and `childContext.overlay` from it is the published value for the life of the
// element. That keeps the decision inside L2 — reading `PRIMITIVES[name]
// .overlayOnAbsoluteChild` here would put the overlay switch in two places, which is
// exactly the second truth ADR 0027 rule 1 forbids.
//
// VALUES REACH GJS THROUGH `gi://` ONLY, and this file needs neither: every widget
// name comes out of L2 and every GTK call is a host op. There is no `gi://` import
// and no `@girs/*` import at all, which is the same shape `components.ts` has and
// the reason both are `node: "polyfill"` clean. The one GTK call this vocabulary
// cannot express as a host op — `Gtk.Accessible.announce()` for a live region — is
// made through `../announce.js`, which BOTH bindings share, so it is still not a
// widget decision taken in an L3.

import {
    createContext,
    createMemo,
    createSignal,
    onCleanup,
    onMount,
    untrack,
    useContext,
    type Accessor,
} from 'solid-js';
import {
    createComponent,
    createElement,
    effect,
    insert,
    insertNode,
    mount,
    setProp,
    widgetOf,
} from '@gjsify/gtk-host/solid';

import { accessor as accessorName } from '../accessor.js';
import { onLiveRegion } from '../announce.js';
import type { ClassNameInput } from '../primitives/classes.js';
import { PrimitiveError } from '../primitives/errors.js';
import { createHandle, type TextInputHandle } from '../primitives/handles.js';
import {
    resolvePrimitive,
    type ChildContext,
    type ChildFacts,
    type PrimitivePlan,
    type PrimitiveProps,
    type ResolvedEvent,
    type WidgetNode,
} from '../primitives/resolve.js';
import type { StyleInput } from '../primitives/style.js';
import { styleConfig } from '../style-config.js';

/**
 * The host's node type, named through the adapter rather than imported.
 *
 * `@gjsify/gtk-host` publishes no `./types` subpath (its exports map is curated), so
 * `HostNode` has no importable name — but `createElement`'s return type is the same
 * type, and `ReturnType` reaches it without widening anything to `unknown`.
 */
type HostNode = ReturnType<typeof createElement>;

/** What a child of one of these components can be. */
export type PrimitiveChild = HostNode | string | number | boolean | null | undefined;
export type PrimitiveChildren = PrimitiveChild | readonly PrimitiveChildren[];

/** What every primitive accepts on top of its own props. */
export interface CommonProps {
    className?: ClassNameInput;
    style?: StyleInput;
    children?: PrimitiveChildren;
    /**
     * The `Gtk.Widget` itself, once it exists.
     *
     * Called from `onMount` rather than during the body, and the reason is the
     * host's deferred materialisation: a node has no widget until something needs
     * one, and what needs one is being placed. Solid's own `spread` calls
     * `props.ref(node)` with the NODE for the same reason — it has nothing else at
     * that moment — so handing the widget is a deliberate difference from the
     * renderer's convention and the same value React's `ref` receives here.
     */
    ref?: (widget: unknown) => void;
    testID?: string;
}

type AnyProps = Readonly<Record<string, unknown>>;

/**
 * The parent's `ChildContext`, as an ACCESSOR.
 *
 * An accessor and not a value, because a parent's published context is derived from
 * its own props and those are reactive: `className={dir()}` flipping `flex-row` to
 * `flex-col` changes the axis every child's `flex-1` expands along, and under a
 * framework that never re-renders a subtree the only way that reaches the children
 * is a signal they read. React's carrier is a context VALUE because a changed
 * context re-renders the consumers; Solid's has to be a context holding a signal,
 * and L2 cannot tell the difference — it is handed the record either way.
 */
const PARENT = createContext<Accessor<ChildContext | null>>(() => null);

/**
 * Children this layer gave a `slot`, which today means an overlay child.
 *
 * A `WeakSet` keyed by the node rather than a field on it: the node is the host's
 * shape and this is not the host's business. The child stamps ITSELF, from its own
 * plan — so the count a parent takes here and the placement it makes cannot
 * disagree, for the same reason `components.ts` asks L2's `declaresAbsolute` rather
 * than testing for the string `absolute`.
 *
 * And it is strictly better than the React side's version of this question, which
 * has to guess about SOMEBODY ELSE'S props and needs a `catch` for a composite child
 * whose `style` L1 does not route. Nothing here guesses: the child already resolved.
 */
const SLOTTED = new WeakSet<object>();

/**
 * Which parent accessor each node this layer built actually read.
 *
 * The detector for the one authoring mistake a lazy-children framework makes
 * possible, and it is not hypothetical — the first draft of `solid.spec.ts` made it
 * four times. `children: Text({ … })` evaluates the child BEFORE the parent function
 * is entered, so the child resolves outside the parent's provider: `useContext`
 * hands it the module default, L2 is given no parent, and `flex-1` stays in
 * `plan.intent` unresolved. The widget renders, GTK says nothing, and the element
 * simply does not expand.
 *
 * Compiled JSX cannot produce it — every Solid compiler emits component children as
 * a GETTER, which is the whole reason Solid's context works at all — but this
 * repository has no JSX build for these specs and neither does every consumer, so
 * hand-written `createComponent` calls are a real path.
 *
 * The test is EXACT rather than heuristic: a node's recorded accessor is the identity
 * of `props.value` the provider handed it, so anything other than this element's own
 * `published` means the child was built somewhere else. Reading "was `plan.intent`
 * left non-empty" instead would miss every child whose only loss was an inherited
 * property, and those are the majority (`items-center` reaches a child through
 * `ChildContext.props`, not through an intent).
 */
const OWNED = new WeakMap<object, () => unknown>();

/**
 * "Would you host an absolutely positioned child?", in `ChildFacts`' spelling.
 *
 * The hypothesis that breaks the cycle in the header comment. `count: 1` and
 * `text: false` go with it so the record is coherent — `absolute: 1, count: 0` is not
 * a state any tree can be in, and L2 is entitled to assume its inputs are.
 */
const ONE_ABSOLUTE_CHILD: ChildFacts = { absolute: 1, count: 1, text: false };

/** Deep enough for a `ChildContext`, whose values are strings, numbers and booleans. */
const sameContext = (a: ChildContext, b: ChildContext): boolean => JSON.stringify(a) === JSON.stringify(b);

const sameValue = (a: unknown, b: unknown): boolean =>
    Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((v, i) => v === b[i]) : a === b;

/**
 * One authored element → its GTK nodes, its props and its children.
 *
 * The shared body of all seven components, and the order of its steps is
 * load-bearing in the same way `resolvePrimitive`'s six are:
 *
 *   1. the plan, as a MEMO over the props and the parent — reactive by construction
 *   2. the published context, from the hypothesis' answer to `overlay`
 *   3. the children, INSIDE the provider, so they read step 2 while resolving
 *   4. the real `ChildFacts`, now that they exist, back into the plan
 *   5. the nodes, whose TAGS come from step 4 (an overlay `View` is decided there)
 *   6. the signal handlers, once — a Solid tree has no commit to rebind them on
 *   7. the properties, in a render effect, so a signal reaches GTK
 *   8. the placement, last, because a child's `slot` must be set before it is placed
 *
 * Steps 3 and 4 are the pair that cannot be reordered and the pair React does not
 * have: the children are created by reading `props.children`, and reading it is what
 * makes them countable.
 */
function element(primitive: string, authored: object): HostNode {
    const props = authored as AnyProps;
    const config = styleConfig();
    const parentRead = useContext(PARENT);

    // 1. Every read inside this memo is a subscription: `resolvePrimitive` walks the
    //    props (getters, under compiled JSX) and this reads the parent accessor, so
    //    the plan re-derives when either changes and nothing else has to know which
    //    props were reactive. It mints a class as a side effect, exactly as the React
    //    L3 does during render — `classFor` is idempotent by declaration hash, so a
    //    re-derivation that changed no style adds nothing to the sheet.
    const [facts, setFacts] = createSignal<ChildFacts | null>(null);
    const planAt = createMemo<PrimitivePlan>(() => {
        const parent = parentRead();
        return resolvePrimitive(primitive, props as PrimitiveProps, {
            tokens: config.tokens,
            sheet: config.sheet,
            ...(parent === null ? {} : { parent }),
            children: facts() ?? ONE_ABSOLUTE_CHILD,
        });
    });

    // 2. Read off the memo's FIRST value — the hypothesis' answer — rather than
    //    resolving a second time for it. It is fixed for the life of the element
    //    because the question is about this primitive and its own props, never about
    //    which children turned up: a `View` hosts one, a `ScrollView` does not, and a
    //    child that asks gets L2's own named refusal in the second case.
    const hostsAbsoluteChild = untrack(planAt).childContext.overlay;
    const published: Accessor<ChildContext> = createMemo(
        () => ({ ...planAt().childContext, overlay: hostsAbsoluteChild }),
        undefined,
        { equals: sameContext },
    );

    // 3. The children, and this line is the one that creates them.
    const kids = childrenUnder(props, published);

    // 4. Facts, from the children that now exist — and first, the check that they
    //    are really THIS element's children. `published`'s `equals` is what keeps the
    //    write cheap: the only field of the context that reads the facts is
    //    `overlay`, and step 2 pinned that — so every child resolves ONCE.
    assertOwnChildren(primitive, kids(), published);
    setFacts(factsOf(primitive, kids()));

    // 5. The nodes. Their tags cannot change afterwards (a Solid element is created
    //    once), which is what `assertStableShape` holds the later resolutions to.
    const first = untrack(planAt);
    const node = createElement(first.node.tag);
    const content = first.content === null ? null : createElement(first.content.tag);
    if (first.slot !== null) SLOTTED.add(node);
    OWNED.set(node, parentRead);

    // 6. One dispatcher per signal, built once and never replaced. The React L3 needs
    //    a `useRef` + `useMemo` dance for this because its handler identities are new
    //    on every render and the host would disconnect and reconnect every commit;
    //    Solid's props object is stable and its getters are live, so reading
    //    `props[event.prop]` inside the dispatcher already yields the current callback
    //    and there is nothing to stabilise.
    for (const [key, handler] of Object.entries(dispatchers(first.events, props, node))) setProp(node, key, handler);

    // 6b. The live regions, through the module BOTH bindings share — and NOT through
    //     `setProp`, which is the whole of the finding: the host suppresses a
    //     `notify::` raised inside its own property write, and a `<Text>`'s content is
    //     exactly that write, so a live region bound as a host handler would announce
    //     every change except the one the application made (`announce.ts`).
    //     `onMount`, because the widget does not exist until the node is placed, and
    //     `onCleanup` because a handler GJS still holds after GC is a blocked callback.
    if (first.announcements.length > 0) {
        onMount(() => {
            const widget = widgetOf(node) as Parameters<typeof onLiveRegion>[0];
            const disposers = first.announcements.map((one) => onLiveRegion(widget, one));
            onCleanup(() => {
                for (const dispose of disposers) dispose();
            });
        });
    }

    // 7. Properties, every time the plan changes.
    const writtenOuter: Record<string, unknown> = {};
    const writtenContent: Record<string, unknown> = {};
    effect(() => {
        const plan = planAt();
        assertStableShape(primitive, first, plan);
        writeProps(node, writtenOuter, {
            // inherited (the parent's `alignItems`) < the element's own (its
            // `alignSelf`, its style, its props) < the framework's (`slot`). Flexbox's
            // own `align-self` beats `align-items`, encoded as a merge order — the
            // same three-step merge `components.ts` spells out, because the precedence
            // is L2's answer and not a framework's.
            ...parentRead()?.props,
            ...plan.node.props,
            ...(plan.slot === null ? {} : { slot: plan.slot }),
            ...classProp(plan.node),
        });
        if (content !== null && plan.content !== null) {
            writeProps(content, writtenContent, { ...plan.content.props, ...classProp(plan.content) });
        }
    });

    const ref = (props as { ref?: unknown }).ref;
    // `createHandle` and not the widget, for the primitives L2 says carry one — the
    // SAME call the React binding makes, so a `<TextInput ref>` means the same thing
    // under both. `plan.handle` is null for every other primitive and the widget
    // passes straight through.
    if (typeof ref === 'function') {
        onMount(() => (ref as (handle: unknown) => void)(createHandle(first.handle, widgetOf(node), first.node.tag)));
    }

    // 8. Placement. The content node first, so an overlay has its main child before
    //    anything is added beside it.
    if (content !== null) insertNode(node, content);
    const target = content ?? node;
    if (first.absoluteSlot === null) {
        // `insert` with the children ACCESSOR, which is what buys Solid's own list
        // reconciliation: a `<For>` under here moves the same widgets rather than
        // rebuilding them.
        insert(target, kids);
    } else {
        insert(target, () => split(kids()).ordinary);
        // The slotted children are placed ONCE, not through `insert`, and that is a
        // limit rather than an oversight: `insert` without a marker answers an empty
        // array by clearing every child of the parent, and the parent here is the
        // overlay whose main child is the content box. A reactive list of absolutely
        // positioned children would need an anchor the host has no use for; a static
        // one is what ADR 0032's measurement found (5 `absolute`, all on the child).
        for (const child of split(untrack(kids)).slotted) insertNode(node, child);
    }
    return node;
}

/**
 * `props.children`, resolved inside a provider that publishes `context`.
 *
 * `Provider` and not a module-level "current parent" variable, and the difference
 * only shows up on an UPDATE: a `<For>` that gains a row runs that row's component
 * body long after this synchronous walk is over, and only Solid's owner tree still
 * knows which parent it belongs to. A stack would be empty by then, and the row
 * would resolve as a root — its `flex-1` silently unresolved.
 *
 * TWO CASTS, both because Solid's `Provider` is typed against `JSX.Element` (its JSX
 * namespace pins that to the DOM's `Element`) while this renderer's node type is
 * `HostNode`. It is the same re-typing the host's own adapter does for `For`, `Index`
 * and `Show`, in one place so no application ever writes it.
 */
function childrenUnder(props: AnyProps, context: Accessor<ChildContext>): Accessor<unknown> {
    const provider = PARENT.Provider as unknown as (p: {
        value: Accessor<ChildContext>;
        children: unknown;
    }) => HostNode;
    return createComponent(provider, {
        value: context,
        get children() {
            return (props as { children?: unknown }).children;
        },
        // `createComponent` hands back what the provider returns, which is Solid's
        // `children()` memo over the resolved subtree — an accessor, not a node.
    }) as unknown as Accessor<unknown>;
}

/**
 * Every child of this element was built INSIDE it, or the layout is already lost.
 *
 * See `OWNED`. The refusal names the cause rather than the symptom because the
 * symptom is invisible: a missing `hexpand` looks like a layout that was never
 * written, and the props the child lost are the ones a reader would look for last.
 */
function assertOwnChildren(primitive: string, resolved: unknown, published: () => unknown): void {
    for (const child of Array.isArray(resolved) ? (resolved as readonly unknown[]) : [resolved]) {
        if (child === null || typeof child !== 'object') continue;
        const owner = OWNED.get(child);
        if (owner === undefined || owner === published) continue;
        throw new PrimitiveError(
            primitive,
            'children',
            "contains an element that was built BEFORE this one, so it resolved outside this element's context: it never learned this parent's orientation or its inherited alignment, and the loss is silent — `flex-1` stays unresolved and `items-center` never reaches it. Pass children lazily, `get children() { return … }`, which is what every Solid JSX compiler emits and the reason Solid's context works at all",
        );
    }
}

/**
 * The resolved children → the two facts L2 asks about them.
 *
 * `null`, `undefined` and booleans are dropped, which is what React's
 * `Children.toArray` does with the same values — a `{cond && <Row/>}` that
 * short-circuits must not count as a child under either framework, or the two
 * disagree about `count` for a tree neither author would call different.
 *
 * A FUNCTION child is refused by name. Solid's `resolveChildren` has already called
 * every zero-argument one (that is its dynamic-child form), so a function surviving
 * to here takes an argument — which is React Native's `children={({ pressed }) => …}`
 * and ADR 0032 § 7's named refusal until the "usable" milestone. Left alone it
 * reaches the host's `insertNode` and is refused there as "not a node of this
 * renderer", which is true and names the wrong layer.
 */
function factsOf(primitive: string, resolved: unknown): ChildFacts {
    const list = (Array.isArray(resolved) ? (resolved as readonly unknown[]) : [resolved]).filter(
        (child) => child !== null && child !== undefined && typeof child !== 'boolean',
    );
    let absolute = 0;
    let text = false;
    for (const child of list) {
        if (typeof child === 'string' || typeof child === 'number') {
            text = true;
        } else if (typeof child === 'function') {
            throw new PrimitiveError(
                primitive,
                'children',
                'was given a function that takes an argument. Children-as-a-function-of-`{ pressed }` is implemented in the REACT binding and not in this one, and the difference is Solid\'s own: a component body runs once, so the press state would have to arrive as a SIGNAL the child reads rather than as a value the parent re-renders with — a different design, not a port of the React one. Write `className="active:opacity-70"`, which is the GTK CSS `:active` pseudo-class (ADR 0032 § 7) and what nearly every use of the function form is asking for. A zero-argument accessor is Solid\'s own dynamic child and never reaches this refusal',
            );
        } else if (child !== null && typeof child === 'object' && SLOTTED.has(child)) {
            absolute++;
        }
    }
    return { absolute, count: list.length, text };
}

/** The resolved children, split the way an overlay places them. */
function split(resolved: unknown): { readonly ordinary: unknown[]; readonly slotted: HostNode[] } {
    const list = Array.isArray(resolved) ? (resolved as readonly unknown[]) : [resolved];
    const ordinary: unknown[] = [];
    const slotted: HostNode[] = [];
    for (const child of list) {
        if (child !== null && typeof child === 'object' && SLOTTED.has(child)) slotted.push(child as HostNode);
        else ordinary.push(child);
    }
    return { ordinary, slotted };
}

/**
 * L2's `events` → one `on:<signal>` dispatcher each.
 *
 * `on:<raw signal name>`, which is the spelling the host's `parseEventProp` takes
 * verbatim — the only one that works for `notify::active`, where the camelCase form
 * would kebab the whole string into `notify-active`.
 *
 * The value the callback receives comes off the WIDGET and not off the signal: the
 * host strips the emitter before calling a handler and `Gtk.Editable::changed`
 * carries no payload at all, so `onChangeText(text)` cannot be built from the signal
 * arguments. L2 says which property holds it (`ResolvedEvent.read`); `widgetOf`
 * reads it. That is the host op the adapter exports for exactly this, which is why
 * this file needs no `ref` of its own to reach a widget.
 */
function dispatchers(events: readonly ResolvedEvent[], props: AnyProps, node: HostNode): Record<string, () => void> {
    const out: Record<string, () => void> = {};
    for (const event of events) {
        out[`on:${event.signal}`] = () => {
            const callback = props[event.prop];
            if (typeof callback !== 'function') return;
            if (event.read === null) {
                (callback as () => void)();
                return;
            }
            const widget = widgetOf(node) as unknown as Record<string, unknown>;
            (callback as (value: unknown) => void)(widget[accessorName(event.read)]);
        };
    }
    return out;
}

/**
 * Write only what changed, and REMOVE what the plan stopped asking for.
 *
 * A reconciler diffs props for its host; a universal renderer's element has no such
 * pass, so the diff lives here or nowhere. `undefined` is the host's own spelling for
 * "removed" — it resets the property to what CONSTRUCTION would have left there,
 * which is the only definition that survives 104 ParamSpecs whose declared default
 * disagrees with it.
 *
 * `css-classes` needs the array compared by CONTENT: L2 builds a fresh array every
 * resolution, so identity would call every class list changed and rewrite a
 * whole-list property on every signal.
 */
function writeProps(node: HostNode, written: Record<string, unknown>, next: Readonly<Record<string, unknown>>): void {
    for (const key of Object.keys(written)) {
        if (key in next) continue;
        setProp(node, key, undefined);
        delete written[key];
    }
    for (const [key, value] of Object.entries(next)) {
        if (sameValue(written[key], value)) continue;
        setProp(node, key, value);
        written[key] = value;
    }
}

/**
 * Set `css-classes` only when this layer has something to put there.
 *
 * Writing `[]` would CLEAR whatever else put classes on the widget, and ADR 0032 § 5
 * asks for a union — GTK itself being the other author, since `Gtk.Orientable` adds
 * `.horizontal`/`.vertical` with nothing authored. The cheapest union is not touching
 * the property.
 */
const classProp = (widget: WidgetNode): Readonly<Record<string, unknown>> =>
    widget.cssClasses.length === 0 ? {} : { 'css-classes': [...widget.cssClasses] };

/**
 * A Solid element's shape is fixed at creation, so a plan that changes it is refused.
 *
 * The tag, the second node's tag and the signal set are all decided once — there is
 * no commit to swap a widget in. A `className` that flips a `View` between a
 * `Gtk.Box` and a `Gtk.Overlay` (by a child becoming absolutely positioned), or a
 * prop that adds an event route mid-life, therefore has no honest answer here, and
 * the alternative to naming it is a tree that renders the old shape for ever.
 * React's reconciler CAN do this, which is a real difference between the two L3s
 * rather than a defect in either.
 */
function assertStableShape(primitive: string, first: PrimitivePlan, next: PrimitivePlan): void {
    const shape = (plan: PrimitivePlan): string =>
        [
            plan.node.tag,
            plan.content?.tag ?? '-',
            plan.events.map((event) => `${event.prop}>${event.signal}`).join(','),
            // The live regions are part of the shape for the same reason the events
            // are: they are subscribed once in `onMount` and there is no commit that
            // could re-subscribe them, so `accessibilityLiveRegion` flipping from
            // `none` to `polite` on a signal would silently never announce.
            plan.announcements.map((one) => `${one.signal}>${one.priority}`).join(','),
        ].join('|');
    const was = shape(first);
    const now = shape(next);
    if (was === now) return;
    throw new PrimitiveError(
        primitive,
        'reactive update',
        `would change the element from ${was} to ${now}, and a Solid element is created once — there is no reconciler pass that could swap the widget. Split the branches into two elements under a <Show>, where each one is created for its own shape`,
    );
}

// ---------------------------------------------------------------------------
// The seven
// ---------------------------------------------------------------------------

export interface ViewProps extends CommonProps {
    /** `auto` and `none` only — GTK's `can-target` covers the widget AND its subtree. */
    pointerEvents?: 'auto' | 'none';
}

export function View(props: ViewProps): HostNode {
    return element('View', props);
}

export interface TextProps extends CommonProps {
    numberOfLines?: number;
    ellipsizeMode?: 'head' | 'middle' | 'tail';
    selectable?: boolean;
    /** Announce this label's text when it changes. `Text` alone — see the React binding's own note. */
    accessibilityLiveRegion?: 'none' | 'polite' | 'assertive';
}

export function Text(props: TextProps): HostNode {
    return element('Text', props);
}

export interface PressableProps extends CommonProps {
    onPress?: () => void;
    disabled?: boolean;
    pointerEvents?: 'auto' | 'none';
    /**
     * Never a function of `{ pressed }`.
     *
     * `PrimitiveChildren` excludes functions, which is the build-time half of the
     * refusal. The runtime half is in `factsOf`, and it is generic rather than
     * per-primitive here because Solid resolves children before any primitive sees
     * them.
     *
     * The REACT binding implements the function form; this one does not, and the
     * reason is in `factsOf`' message: a Solid component body runs once, so the press
     * state has to reach the child as a signal rather than as a re-render, which is a
     * design of its own rather than a port.
     */
    children?: PrimitiveChildren;
}

export function Pressable(props: PressableProps): HostNode {
    return element('Pressable', props);
}

export interface ScrollViewProps extends CommonProps {
    horizontal?: boolean;
    showsVerticalScrollIndicator?: boolean;
    showsHorizontalScrollIndicator?: boolean;
    contentContainerStyle?: StyleInput;
    /** NativeWind's spelling for the inner node's class list. See `ContentSpec.classNameProp`. */
    contentContainerClassName?: ClassNameInput;
}

export function ScrollView(props: ScrollViewProps): HostNode {
    return element('ScrollView', props);
}

export interface ActivityIndicatorProps extends CommonProps {
    animating?: boolean;
    size?: 'small' | 'large' | number;
    color?: string;
    hidesWhenStopped?: boolean;
}

export function ActivityIndicator(props: ActivityIndicatorProps): HostNode {
    return element('ActivityIndicator', props);
}

export interface TextInputProps extends Omit<CommonProps, 'ref'> {
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
    /** A declared no-op: there is no autofill service on a GTK desktop. */
    autoComplete?: string;
    /** `autoComplete`'s iOS spelling, and the same absent addressee. */
    textContentType?: string;
    /** A declared no-op: each widget has one Return behaviour, and `multiline` picks the widget. */
    submitBehavior?: 'submit' | 'blurAndSubmit' | 'newline';
    /** The imperative handle, not the widget — L2 decides that, so both bindings agree. */
    ref?: (handle: TextInputHandle) => void;
}

/** The instance type, merged with the component below. React Native's `TextInput` is a class. */
export interface TextInput extends TextInputHandle {}

export function TextInput(props: TextInputProps): HostNode {
    return element('TextInput', props);
}

export interface SwitchProps extends CommonProps {
    value?: boolean;
    onValueChange?: (value: boolean) => void;
    disabled?: boolean;
}

export function Switch(props: SwitchProps): HostNode {
    return element('Switch', props);
}

/**
 * Re-exported, not re-implemented: mounting a Solid tree into a widget the
 * application owns is the host adapter's op, and it is the same one whether the tree
 * is written in GTK's vocabulary or React Native's. Having it here means a consumer
 * of this subpath needs one import to render, and there is still exactly one `mount`.
 */
export { mount };
