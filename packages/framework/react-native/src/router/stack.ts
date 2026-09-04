// `<Stack>` — React Navigation's stack router, rendered onto `Adw.NavigationView`.
//
// TWO STACKS, ONE JOIN KEY. `Adw.NavigationView` owns a real navigation stack and
// React Navigation owns another, and neither is willing to be a mirror of the other:
// the widget animates, swipes and pops on Escape by itself, and React Navigation is
// the state a screen reads. ADR 0032 § 10 records the split that makes them one
// thing — **React declares MEMBERSHIP and GTK owns ORDERING.** The pages are React
// children, so the widget's page POOL is whatever React rendered; the widget's STACK
// is set imperatively by tag, and the tag is the route key.
//
// MEASURED, which is why the split is not a stylistic choice: with two pages
// `add`ed, `Adw.NavigationView.get_navigation_stack().get_n_items()` is **1**. `add`
// puts a page in the pool and only the first one becomes the stack. There is no
// declarative way to say "these three, in this order" — `replace_with_tags` is it.
//
// THREE BEHAVIOURS THAT ARE NOT OPTIONAL, each cheap to leave out and expensive to
// find missing:
//
//   1. The stack diff is CLASSIFIED, not replayed. Desired is a strict prefix of
//      current → `pop_to_tag`, so the pop animates and the user sees a back
//      transition. Current is a strict prefix of desired → set the base and
//      `push_by_tag` the last one, so the push animates. Anything else → one
//      `replace_with_tags`. A `replace_with_tags` for every change is correct and
//      SILENT: every navigation becomes a cut, and nothing anywhere says so.
//   2. The REVERSE direction exists. A swipe, Escape, Alt+Left or the mouse back
//      button pops the widget without React Navigation being asked, and the `popped`
//      signal has to become `StackActions.pop(delta)`. Without this bridge
//      `usePreventRemove` is a lie on every gesture; WITH it, a prevented pop leaves
//      React's state unchanged and the re-sync pushes the page back onto the widget,
//      which is what "prevented" means. It is DEBOUNCED — see `coalesce` for what that
//      is measured to buy, which is not what the obvious guess says.
//   3. A POPPED PAGE STAYS MOUNTED until GTK has finished animating it out. Its route
//      is already gone from React Navigation's state, so React would unmount it
//      mid-transition and the user would watch an empty page slide away. TWO paths
//      release it and each covers the other's gap, both measured:
//        - the page's own `hidden` signal, which is the one that fires in a window
//          when the animation ends;
//        - a sweep over pages that are not mapped, which is the one that fires when
//          the pop came FROM the widget. MEASURED: a widget-driven pop emits `hidden`
//          while it pops, BEFORE React has been told and therefore before that
//          descriptor is `closing` at all — so the handler releases a key nothing is
//          holding, and `hidden` never fires again. Without the sweep that descriptor
//          is held for the life of the process.
//
// WHERE THE HEADER BAR COMES FROM is `chrome.ts`' rule, not this file's: a page's bar
// carries the window controls when no bar above it already does, and drops them when
// one does. The page also publishes its bar's title slot, which is where a `<Tabs>`
// inside one of its screens puts its switcher instead of growing a second bar.
//
// THE PAGE LIST IS APPEND-ONLY, and that is a requirement rather than a convenience.
// `AdwNavigationView` declares `reorder: 'remove-all'` in the host's table (there is
// no `insert`, measured), and its `remove()` also takes the page OUT OF THE
// NAVIGATION STACK — so a reordering renderer would disturb navigation, not just
// paint order. An append-only order means the host never reorders these children.

import { StackActions, StackRouter, useNavigationBuilder } from '@react-navigation/core';
import type {
    Descriptor,
    ParamListBase,
    RouteProp,
    StackActionHelpers,
    StackNavigationState,
    StackRouterOptions,
} from '@react-navigation/core';
import {
    createElement,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ComponentType,
    type ReactElement,
    type ReactNode,
} from 'react';
import type Adw from '@girs/adw-1';

import {
    provideChromeLevel,
    underHeaderBar,
    useChrome,
    useTitleSlots,
    withoutHeaderBar,
    type ChromeSlot,
} from './chrome.js';
import { RouterError } from './errors.js';
import { PerRouteCache } from './per-route-cache.js';
import {
    navigationPair,
    screenOptionsFrom,
    useRouteNode,
    useSynthesisedScreens,
    type ScreenDeclaration,
} from './screens.js';

/** Options a `<Stack.Screen>` may set. Anything else is refused by name. */
const STACK_OPTIONS: readonly string[] = ['title', 'headerShown', 'animation'];

/** What one screen of a stack can be told. */
export interface StackScreenOptions {
    /** The page title, shown by the page's own header bar. Defaults to the route name. */
    title?: string;
    /**
     * `false` renders the screen with no `Adw.HeaderBar`, and so with no back button.
     *
     * It also leaves the level below with no title slot to contribute to, so a
     * navigator inside this screen renders its own bar — see `chrome.ts`.
     */
    headerShown?: boolean;
    /** `none` turns the transition off for this screen only. */
    animation?: 'default' | 'none';
}

type StackState = StackNavigationState<ParamListBase>;
type StackEvents = Record<string, never>;

interface StackViewProps {
    children: ReactNode;
    screenOptions?: StackScreenOptions;
}

/**
 * What this view needs off a descriptor: the route, the options, and how to render.
 *
 * Narrowed from React Navigation's own `Descriptor`, which also carries a navigation
 * object shaped by five generic parameters. Narrowing it here is what lets the
 * closing-page bookkeeping hold descriptors in plain records without spelling that
 * type out four more times.
 */
type StackDescriptor = Pick<
    Descriptor<StackScreenOptions, never, RouteProp<ParamListBase>>,
    'route' | 'options' | 'render'
>;
type StackDescriptors = Readonly<Record<string, StackDescriptor>>;

// ---------------------------------------------------------------------------
// Behaviour 1 — the widget's stack against the desired one
// ---------------------------------------------------------------------------

/**
 * The tags the widget's navigation stack holds, bottom first.
 *
 * NO `instanceof` GUARD, deliberately: the model is `AdwNavigationView`'s own and
 * holds `AdwNavigationPage`s by construction, and an `instanceof` would buy a VALUE
 * import of Adw for a fact the widget's API already guarantees. A null tag ENDS the
 * read rather than being skipped — a hole in this list would silently shift every
 * later comparison by one, and a shifted comparison classifies a push as a replace.
 */
function widgetStack(view: Adw.NavigationView): readonly string[] {
    const model = view.get_navigation_stack();
    const count = model.get_n_items();
    const tags: string[] = [];
    for (let index = 0; index < count; index++) {
        const page = model.get_item(index) as Adw.NavigationPage | null;
        const tag = page === null ? null : page.get_tag();
        if (tag === null) break;
        tags.push(tag);
    }
    return tags;
}

const same = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((tag, index) => right[index] === tag);

/** `prefix` is `list` with at least one entry cut off the top. */
const isStrictPrefix = (prefix: readonly string[], list: readonly string[]): boolean =>
    prefix.length < list.length && prefix.every((tag, index) => list[index] === tag);

/** What `applyStack` did, so a vector can assert the classification and not the paint. */
export type StackChange = 'pop' | 'push' | 'replace' | 'none';

/**
 * Classify the difference, and apply the one operation that fits it.
 *
 * `animate` is asked about the page that is MOVING — the departing one for a pop and
 * the arriving one for a push, because the transition belongs to the page the user is
 * about to stop or start looking at.
 */
export function applyStack(
    view: Adw.NavigationView,
    current: readonly string[],
    desired: readonly string[],
    animate: (key: string | undefined) => boolean,
): StackChange {
    if (same(current, desired)) return 'none';

    const last = desired[desired.length - 1];
    if (last !== undefined && isStrictPrefix(desired, current)) {
        view.set_animate_transitions(animate(current[current.length - 1]));
        view.pop_to_tag(last);
        return 'pop';
    }
    if (last !== undefined && isStrictPrefix(current, desired)) {
        const base = desired.slice(0, -1);
        // The base is set FIRST and only when it differs, so the push animates from
        // the page the user is actually looking at. Replacing unconditionally would
        // make every push a cut, which is behaviour 1's whole point.
        if (!same(base, current)) view.replace_with_tags([...base]);
        view.set_animate_transitions(animate(last));
        view.push_by_tag(last);
        return 'push';
    }
    view.replace_with_tags([...desired]);
    return 'replace';
}

// ---------------------------------------------------------------------------
// Behaviour 3 — pages that are closing
// ---------------------------------------------------------------------------

/**
 * Which pages exist, and which of them are on their way out.
 *
 * Generic over the descriptor, and exported with the three functions that advance
 * it, because this is where behaviour 3's edge cases live and none of them needs a
 * widget or a reconciler to be wrong: a key held after its page is gone leaks for
 * the life of the process, a key dropped too early flashes an empty page, and a
 * reordered `order` makes the host reorder `Adw.NavigationView`'s children — which
 * that widget answers by taking pages out of the navigation stack. Pure arithmetic
 * over key sets is exactly what a spec can pin exhaustively.
 */
export interface Tracking<D> {
    /** Page order — append-only for as long as a key is needed. See the header. */
    readonly order: readonly string[];
    /** The focused route key at the last advance, so a departure can be recognised. */
    readonly focused: string | undefined;
    /** Descriptors whose routes are gone and whose pages GTK is still animating out. */
    readonly closing: Readonly<Record<string, D>>;
}

/** The tracking a first render starts from. */
export const initialTracking = <D>(live: readonly string[], focused: string | undefined): Tracking<D> => ({
    order: [...live],
    focused,
    closing: {},
});

const sameMembers = (left: readonly string[], right: readonly string[]): boolean =>
    left.length === right.length && left.every((key) => right.includes(key));

/** Every key that must still be rendered: the live routes plus what is closing. */
export const neededKeys = <D>(tracking: Tracking<D>, live: readonly string[]): readonly string[] => [
    ...live,
    ...Object.keys(tracking.closing).filter((key) => !live.includes(key)),
];

/** Has anything changed that the tracking has to answer for? */
export const needsAdvance = <D>(tracking: Tracking<D>, live: readonly string[], focused: string | undefined): boolean =>
    !sameMembers(tracking.order, neededKeys(tracking, live)) || tracking.focused !== focused;

/**
 * The next tracking, given the live routes and the descriptors of the LAST commit.
 *
 * `previous` and not the current descriptors: the descriptor of a route that just
 * left the state is not in the current map any more, and the closing page still has
 * to render something.
 *
 * ONLY THE DEPARTING FOCUSED KEY BECOMES `closing`. A route removed from the middle
 * of the stack was never on screen, so nothing is animating it out and holding it
 * would be a leak with no symptom.
 */
export function advanceTracking<D>(
    tracking: Tracking<D>,
    live: readonly string[],
    focused: string | undefined,
    previous: Readonly<Record<string, D>>,
): Tracking<D> {
    const closing: Record<string, D> = {};
    for (const [key, descriptor] of Object.entries(tracking.closing)) {
        if (!live.includes(key)) closing[key] = descriptor;
    }
    const left = tracking.focused;
    if (left !== undefined && !live.includes(left)) {
        const descriptor = previous[left];
        if (descriptor !== undefined) closing[left] = descriptor;
    }
    const keys = [...live, ...Object.keys(closing).filter((key) => !live.includes(key))];
    return {
        // APPEND-ONLY: surviving keys keep their positions and new ones go on the end.
        // A sort here would be the reorder `Adw.NavigationView` cannot afford.
        order: [
            ...tracking.order.filter((key) => keys.includes(key)),
            ...keys.filter((key) => !tracking.order.includes(key)),
        ],
        focused,
        closing,
    };
}

/** Let go of one closing page. Identity-stable when the key was not closing. */
export function releaseFrom<D>(tracking: Tracking<D>, key: string): Tracking<D> {
    if (tracking.closing[key] === undefined) return tracking;
    return {
        order: tracking.order.filter((entry) => entry !== key),
        focused: tracking.focused,
        closing: Object.fromEntries(Object.entries(tracking.closing).filter(([entry]) => entry !== key)),
    };
}

/**
 * Run `action` at most once per microtask, however many times the trigger fires.
 *
 * MEASURED on libadwaita 1.9.3: `pop_to_tag` over two pages emits `popped` TWICE,
 * and the widget's navigation stack is ALREADY FINAL at the first emission — both
 * handlers see `a,b`. So every emission in a burst asks the same question.
 *
 * AND THE OBVIOUS JUSTIFICATION IS NOT THE ONE THAT HOLDS, which is worth writing
 * down because it is the one a reader will supply. "Without this it over-pops" is
 * NOT measured: with the coalescer disabled, a four-to-two gesture still lands on two
 * routes, because `@react-navigation/core` 7.21.13 updates `navigation.getState()`
 * eagerly on dispatch, so the second handler computes a delta of zero. What the
 * coalescer actually buys is:
 *
 *   - ATTRIBUTABILITY. Undebounced, correctness rests on that eagerness, which is an
 *     internal and not a documented contract. If a future version batched its state,
 *     an undebounced bridge would dispatch the same pop N times and the symptom —
 *     "back skips two screens" — would surface nowhere near the cause.
 *   - N − 1 fewer passes per gesture: one dispatch and one walk of the widget's list
 *     model instead of one per popped page.
 *
 * Also measured, and the reason no echo guard is needed anywhere else here:
 * `replace_with_tags` emits NO `popped` at all, so this layer's own React→widget sync
 * cannot re-enter through the bridge.
 */
export function coalesce(action: () => void): () => void {
    let scheduled = false;
    return () => {
        if (scheduled) return;
        scheduled = true;
        // A PROMISE JOB, not a timer and not `queueMicrotask`: coalescing has to
        // happen inside the emission burst, and a promise job is a language
        // guarantee rather than a host API this layer would have to probe for.
        void Promise.resolve().then(() => {
            scheduled = false;
            action();
        });
    };
}

const focusedKeyOf = (state: StackState): string | undefined => state.routes[state.index]?.key;

/**
 * The pages to render: the live routes PLUS whatever is still animating out.
 *
 * THE TRACKING LIVES IN A REF, NOT IN STATE, AND THE REASON IS MEASURED. The obvious
 * shape — `useState` plus React's documented "adjust state when props change"
 * render-phase update — loses the closing page. Traced: on the render after a pop,
 * `advanceTracking` ran, recorded the departing key, and its render-phase `setTracking`
 * was DISCARDED; a later pass re-ran the advance, and by then `previous` had been
 * overwritten by the intervening commit, so the descriptor came back MISSING and the
 * page was dropped mid-transition. Nothing failed; the page just vanished.
 *
 * A ref makes the advance IDEMPOTENT, which is the property that was actually needed:
 * `needsAdvance` is false once the tracking has advanced, so a discarded pass or an
 * extra pass changes nothing, and the one-shot fact — "which key was focused before" —
 * is consumed exactly once. `release` is a real event, so it does use state (a bump) to
 * ask for the re-render that drops the page.
 *
 * `committed` holds the LAST COMMITTED descriptors, because the descriptor of a route
 * that just left the state is not in the current `descriptors` any more — it is in the
 * previous one, and the closing page still has to render something.
 */
function useStackPages(
    state: StackState,
    descriptors: StackDescriptors,
): { readonly pages: readonly StackDescriptor[]; readonly release: (key: string) => void } {
    const live = state.routes.map((route) => route.key);
    const focused = focusedKeyOf(state);
    const committed = useRef<StackDescriptors>(descriptors);
    const tracking = useRef<Tracking<StackDescriptor>>(initialTracking(live, focused));
    const [, bump] = useState(0);

    if (needsAdvance(tracking.current, live, focused)) {
        tracking.current = advanceTracking(tracking.current, live, focused, committed.current);
    }

    useLayoutEffect(() => {
        committed.current = descriptors;
    });

    const release = useCallback((key: string) => {
        const next = releaseFrom(tracking.current, key);
        // `releaseFrom` is identity-stable for a key it was not holding, which is the
        // ordinary case: a widget-driven pop emits `hidden` before React has been told,
        // so this runs for a key nothing is closing yet. No bump, no re-render.
        if (next === tracking.current) return;
        tracking.current = next;
        bump((count) => count + 1);
    }, []);

    const pages = tracking.current.order
        .map((key) => descriptors[key] ?? tracking.current.closing[key])
        .filter((descriptor): descriptor is StackDescriptor => descriptor !== undefined);
    return { pages, release };
}

// ---------------------------------------------------------------------------
// Per-page callbacks with STABLE identities
// ---------------------------------------------------------------------------

/**
 * One `ref` and one `hidden` handler per route key, allocated once.
 *
 * A fresh closure per render costs twice over, and both costs are the ones
 * `components.ts` already records: React detaches and re-attaches a changed callback
 * ref on every commit, leaving the widget unreachable in between, and the host
 * disconnects and re-connects a changed signal handler on every commit — one
 * `g_signal_connect` per page per render, for nothing.
 *
 * `widgets` prunes itself — a `null` ref is the page going away — and the binding pair
 * did not, which is #1547's third map: it is `PerRouteCache` now and the navigator
 * calls `retain` with the pages it still renders.
 */
type PageBindings = { readonly ref: (widget: unknown) => void; readonly onHidden: () => void };

function usePageBindings(release: (key: string) => void): {
    readonly bindingsFor: (key: string) => PageBindings;
    readonly widgets: Map<string, Adw.NavigationPage>;
    readonly retain: (keys: ReadonlySet<string>) => void;
} {
    const widgets = useRef(new Map<string, Adw.NavigationPage>());
    const cache = useRef(new PerRouteCache<PageBindings>());
    const bindingsFor = useCallback(
        (key: string) =>
            cache.current.getOrCreate(key, () => ({
                ref: (widget: unknown): void => {
                    if (widget === null || widget === undefined) widgets.current.delete(key);
                    else widgets.current.set(key, widget as Adw.NavigationPage);
                },
                onHidden: (): void => release(key),
            })),
        [release],
    );
    const pages = cache.current;
    useEffect(() => () => pages.clear(), [pages]);
    const retain = useCallback((keys: ReadonlySet<string>): void => cache.current.retain(keys), []);
    return { bindingsFor, widgets: widgets.current, retain };
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** What one page knows about the window's chrome. See `chrome.ts` for the rule. */
interface PageChrome {
    /** A header bar above already carries the window controls, so this page's must not. */
    readonly decorated: boolean;
    /** What the level below contributed to this page's header bar title, if anything. */
    readonly titleWidget: ReactElement | null;
    /** This page's title slot, published to the screen it renders. */
    readonly titleSlot: ChromeSlot;
}

/** One page: the Adwaita page, its optional header bar, and the screen inside it. */
function pageElement(
    descriptor: StackDescriptor,
    bindings: { readonly ref: (widget: unknown) => void; readonly onHidden: () => void },
    chrome: PageChrome,
): ReactElement {
    const { route, options } = descriptor;
    const body =
        options.headerShown === false
            ? provideChromeLevel(withoutHeaderBar(chrome.decorated), descriptor.render())
            : createElement(
                  'AdwToolbarView',
                  null,
                  // An `Adw.HeaderBar` inside an `Adw.NavigationView` grows its own
                  // back button and shows the page's own title — there is nothing to
                  // wire. Without one a page has no back affordance at all, which is
                  // why the default is ON and turning it off is per-screen.
                  //
                  // THE WINDOW CONTROLS ARE CONDITIONAL, and that is the invariant
                  // rather than a nicety: an inner stack's pages still need their back
                  // buttons, so their bars stay — and a second close button in one
                  // window is indistinguishable from the one that closes it (#1460).
                  // `Adw.NavigationSplitView` splits the same decoration across its
                  // two visible bars for the same reason.
                  createElement(
                      'AdwHeaderBar',
                      {
                          slot: 'top',
                          showStartTitleButtons: !chrome.decorated,
                          showEndTitleButtons: !chrome.decorated,
                      },
                      chrome.titleWidget,
                  ),
                  provideChromeLevel(underHeaderBar(chrome.titleSlot), descriptor.render()),
              );
    return createElement(
        'AdwNavigationPage',
        {
            key: route.key,
            // THE JOIN KEY. Everything imperative — `push_by_tag`, `pop_to_tag`,
            // `replace_with_tags` — addresses a page by this string.
            tag: route.key,
            title: options.title ?? route.name,
            'on:hidden': bindings.onHidden,
            ref: bindings.ref,
        },
        body,
    );
}

function StackView(props: StackViewProps): ReactElement {
    const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder<
        StackState,
        StackRouterOptions,
        StackActionHelpers<ParamListBase>,
        StackScreenOptions,
        StackEvents
    >(StackRouter, props);

    const viewRef = useRef<Adw.NavigationView | null>(null);
    const { pages, release } = useStackPages(state, descriptors);
    const { bindingsFor, widgets, retain: retainBindings } = usePageBindings(release);
    // `rendersChrome` is asked of the pages that are ON SCREEN, and the whole page list
    // is the wrong set: `Adw.NavigationView` maps only the visible page (plus the one
    // sliding out), so a bar on a page further down the stack draws nothing. MEASURED —
    // with the whole list, pushing a `headerShown: false` screen onto a bar-ful one
    // kept the claim alive for the bar UNDER it, and the window was left with 0 mapped
    // header bars and no window control anywhere: nothing to close or move it with, on
    // a window that had chrome a moment earlier.
    //
    // The CLOSING pages belong in the set for the opposite reason. They are still
    // mapped while the arriving page slides in, so dropping the claim as soon as focus
    // moves would put the window's bar back on top of a page bar that is still drawing
    // its own controls.
    const live = state.routes.map((route) => route.key);
    const focused = focusedKeyOf(state);
    const onScreen = pages.filter((page) => page.route.key === focused || !live.includes(page.route.key));
    const chrome = useChrome(
        'Stack',
        onScreen.some((descriptor) => descriptor.options.headerShown !== false),
    );
    const { titleWidgetFor, slotFor, retain: retainSlots } = useTitleSlots('Stack');

    // Options by route key, kept ACROSS renders: `reconcilePopped` runs from a signal
    // handler, outside any render, and needs the options of a page that may already
    // have left `descriptors`.
    const optionsRef = useRef(new PerRouteCache<StackScreenOptions>());
    for (const descriptor of pages) optionsRef.current.set(descriptor.route.key, descriptor.options);
    const options = optionsRef.current;
    useEffect(() => () => options.clear(), [options]);

    /**
     * The one prune for every per-key cache this navigator owns (#1547).
     *
     * DRIVEN BY THE PAGE LIST, which is the lifecycle the closing-page bookkeeping
     * already maintains: a page held for its exit animation is still in `pages`, so its
     * entries survive until the release that drops it, and nothing needs a second
     * lifecycle to say when a key is dead. It is also wider than a delete hung off
     * `release` alone would be, and deliberately: a route removed from the MIDDLE of the
     * stack was never on screen, so nothing animates it out and no `hidden` ever comes —
     * `advanceTracking` simply stops listing it, and only a sweep over the page list
     * sees that.
     */
    useLayoutEffect(() => {
        const kept = new Set(pages.map((descriptor) => descriptor.route.key));
        optionsRef.current.retain(kept);
        retainSlots(kept);
        retainBindings(kept);
    });

    const animate = useCallback(
        (key: string | undefined): boolean =>
            key === undefined ? true : optionsRef.current.get(key)?.animation !== 'none',
        [],
    );

    /**
     * The widget→React direction, and then the React→widget direction again.
     *
     * The second half is not belt-and-braces, it is what makes `usePreventRemove`
     * TRUE: a prevented POP leaves React's state holding the route, so the desired
     * stack still contains the page the widget just removed, and this re-sync pushes
     * it back. Without the re-sync a prevented pop looks exactly like an allowed one.
     */
    const reconcilePopped = useCallback(() => {
        const view = viewRef.current;
        if (view === null) return;
        const before = navigation.getState();
        const actual = widgetStack(view);
        const desired = before.routes.map((route) => route.key);
        if (isStrictPrefix(actual, desired)) {
            navigation.dispatch({ ...StackActions.pop(desired.length - actual.length), target: before.key });
        }
        const after = navigation.getState();
        applyStack(
            view,
            widgetStack(view),
            after.routes.map((route) => route.key),
            animate,
        );
    }, [navigation, animate]);

    // `useMemo`, not `useCallback`: the coalescer holds a flag ACROSS calls, so it has
    // to be the same closure for the whole burst — and the host would reconnect the
    // signal on every render if its identity changed anyway.
    const onPopped = useMemo(() => coalesce(reconcilePopped), [reconcilePopped]);

    const initial = useRef(true);
    useLayoutEffect(() => {
        const view = viewRef.current;
        if (view === null) return;
        const desired = state.routes.map((route) => route.key);
        // The FIRST sync is always a replace, unanimated: the widget's stack at that
        // moment is whatever `add` left behind (measured — the first page only), and
        // animating from it would animate a transition the user never navigated.
        if (initial.current) {
            initial.current = false;
            view.set_animate_transitions(false);
            if (!same(widgetStack(view), desired)) view.replace_with_tags([...desired]);
            view.set_animate_transitions(true);
            return;
        }
        applyStack(view, widgetStack(view), desired, animate);
    });

    // Behaviour 3's SECOND path, and the case it catches is the reverse direction.
    // MEASURED: a widget-driven pop (swipe, Escape, Alt+Left) emits the page's
    // `hidden` WHILE it pops — before the reconcile has told React anything, so the
    // handler releases a key that is not `closing` yet and the signal never comes
    // again. `mapped` is the discriminator that makes the sweep safe: in a window the
    // page being animated out is still mapped, so it is left alone until `hidden`;
    // one that is not mapped is not animating and nothing is waiting for it.
    //
    // MEASURED too, so nobody removes the first path instead: `Adw.NavigationPage`
    // emits `hidden` even on a DETACHED view — GTK drives shown/hidden off the
    // navigation stack, not off mapping — so `hidden` is a real path, not a
    // window-only one.
    useLayoutEffect(() => {
        for (const descriptor of pages) {
            const key = descriptor.route.key;
            if (state.routes.some((route) => route.key === key)) continue;
            const widget = widgets.get(key);
            if (widget !== undefined && !widget.get_mapped()) release(key);
        }
    });

    return createElement(
        NavigationContent,
        null,
        createElement(
            'AdwNavigationView',
            {
                ref: viewRef,
                // Escape pops, which is Adwaita's own convention and half of the
                // reverse direction behaviour 2 exists for.
                popOnEscape: true,
                'on:popped': onPopped,
            },
            ...pages.map((descriptor) =>
                pageElement(descriptor, bindingsFor(descriptor.route.key), {
                    decorated: chrome.decorated,
                    titleWidget: titleWidgetFor(descriptor.route.key),
                    titleSlot: slotFor(descriptor.route.key),
                }),
            ),
        ),
    );
}
StackView.displayName = 'GjsifyStackView';

const pair = navigationPair<StackViewProps>(StackView);

/**
 * A `<Stack.Screen>` declaration. Read as data by `<Stack>`; never rendered.
 *
 * It throws if it ever IS rendered, because that means it was put somewhere no
 * navigator reads it — inside a `<View>`, or in a route file — and a component that
 * rendered nothing there would be a silent drop.
 */
function StackScreen(_props: ScreenDeclaration & { options?: StackScreenOptions }): never {
    throw new RouterError(
        'not-a-screen-child',
        '<Stack.Screen>',
        'was rendered instead of being read. It is a declaration: `<Stack>` collects its `name` and `options` ' +
            'and never renders it, so it only belongs as a direct child of `<Stack>`',
    );
}
StackScreen.displayName = 'Stack.Screen';

/** What `<Stack>` accepts. */
export interface StackProps {
    /** `<Stack.Screen>` declarations, and nothing else. */
    children?: ReactNode;
    /** Options for every screen, before its own. */
    screenOptions?: StackScreenOptions;
}

/**
 * `expo-router`'s `<Stack>`: its screens are the FILES this `_layout` owns.
 *
 * Its children are read as declarations, so the ordinary React reflex — putting
 * content in a navigator — is refused by name rather than dropped.
 */
export function Stack(props: StackProps): ReactElement {
    const node = useRouteNode('Stack');
    const options = screenOptionsFrom(
        'Stack',
        StackScreen as unknown as ComponentType<ScreenDeclaration>,
        STACK_OPTIONS,
        props.children,
    );
    const screens = useSynthesisedScreens(node, pair.Screen, options);
    // `children` comes from the varargs, and `screenOptions` is omitted rather than
    // passed as `undefined`: `useNavigationBuilder` reads the key's PRESENCE in places.
    const navigatorProps = (
        props.screenOptions === undefined ? {} : { screenOptions: props.screenOptions }
    ) as StackViewProps;
    return createElement(pair.Navigator, navigatorProps, ...screens);
}
Stack.Screen = StackScreen;
