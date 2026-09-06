// `<Tabs>` — React Navigation's tab router, rendered onto `Adw.ViewStack` plus
// `Adw.ViewSwitcher`.
//
// AND THE SWITCHER IS THE BETTER WIDGET, not a substitute for a tab bar. A React
// Native tab bar is a fixed row of views the application lays out and re-lays-out
// itself; `Adw.ViewSwitcher` is DRIVEN BY THE STACK'S OWN PAGE MODEL, so:
//
//   - adding a route file adds a button, with no tab-bar bookkeeping anywhere;
//   - the labels come from `Adw.ViewStackPage:title`, which is also what a screen
//     reader announces, so the accessible name is the visible one by construction;
//   - it has a NARROW and a WIDE policy, which is what lets an application's own
//     breakpoint restyle it as the window widens — icons over labels in a narrow
//     window, icons beside labels in a wide one — from the SAME declaration. A tab
//     bar has one shape and the application owns every pixel of the other.
//
// MEASURED on libadwaita 1.9.3: the default policy is NARROW (0), which is the
// phone-shaped one, so this layer sets WIDE explicitly. A desktop window starts wide,
// and a switcher that defaults to the narrow layout on a 900 px window looks like a
// bug rather than a choice.
//
// WHERE THE HEADER BAR COMES FROM is `chrome.ts`' rule. As the outermost navigator
// this one owns the window's single bar and puts the switcher in its title. INSIDE
// another navigator it builds no bar at all: the switcher is contributed to the
// enclosing page's header bar, which is where a hand-written Adwaita application puts
// it — and it is what stops a nested navigator from drawing a second close button.
//
// ONE PAGE IS ONE `Adw.ViewStackPage`, ADDRESSED BY ROUTE KEY — the same join key the
// stack navigator uses, for the same reason: `set_visible_child_name` is how focus is
// set, and `notify::visible-child-name` is how the USER'S click comes back. The
// reverse direction is not optional here either; without it a click on the switcher
// changes the widget and not React's state, and every hook in the tab that just
// appeared reads the wrong route.
//
// AND THE REVERSE DIRECTION NEEDS AN ECHO GUARD THIS LAYER OWNS, because
// `Adw.ViewStack` emits that one signal for three different events and only one of
// them is a click: the user's, the layer's own `set_visible_child_name`, and
// libadwaita's pick of a first page while the reconciler is still INSERTING them
// (`add_page` selects a page whenever the stack has none). `shownRef` is that guard —
// `onVisibleChildChanged` carries what it replaced, and why the obvious guard raced.

import { TabActions, TabRouter, useNavigationBuilder } from '@react-navigation/core';
import type {
    Descriptor,
    ParamListBase,
    RouteProp,
    TabActionHelpers,
    TabNavigationState,
    TabRouterOptions,
} from '@react-navigation/core';
import {
    createElement,
    useCallback,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type ComponentType,
    type ReactElement,
    type ReactNode,
} from 'react';
import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';

import { provideChromeLevel, underHeaderBar, useChrome, withoutHeaderBar } from './chrome.js';
import { RouterError } from './errors.js';
import {
    navigationPair,
    screenOptionsFrom,
    useRouteNode,
    useSynthesisedScreens,
    type ScreenDeclaration,
} from './screens.js';

/** Options a `<Tabs.Screen>` may set. Anything else is refused by name. */
const TAB_OPTIONS: readonly string[] = ['title', 'iconName'];

/** What one tab can be told. */
export interface TabScreenOptions {
    /** The switcher button's label. Defaults to the route name. */
    title?: string;
    /**
     * The switcher button's icon, as an icon-theme name (`go-home-symbolic`).
     *
     * NOT OPTIONAL DECORATION, which is why it is here rather than left to the
     * application. `Adw.ViewSwitcher` reserves the icon whether or not one is set —
     * MEASURED, the same five tabs measure 317/647 px with icons and without — and a
     * page with no `icon-name` draws the icon theme's missing-image glyph in the space
     * it reserved. So the choice was never "icons or no icons"; it was "your icon or a
     * broken one".
     *
     * A name the theme does not carry draws that same glyph, and nothing says so.
     * `Gtk.IconTheme.has_icon()` is the check worth running when picking one.
     */
    iconName?: string;
}

type TabState = TabNavigationState<ParamListBase>;
type TabEvents = { readonly tabPress: { readonly data: undefined; readonly canPreventDefault: true } };

interface TabsViewProps {
    children: ReactNode;
    screenOptions?: TabScreenOptions;
    /** `false` renders the stack with no header bar, and so with no switcher. */
    headerShown?: boolean;
}

type TabDescriptor = Pick<
    Descriptor<TabScreenOptions, never, RouteProp<ParamListBase>>,
    'route' | 'options' | 'render'
>;

/**
 * Put the stack on the focused page, or leave it alone because that page is not there yet.
 *
 * THE PRESENCE CHECK IS THE TERMINATING CONDITION, and the reason it has to be explicit is
 * that the obvious guard is a bet rather than a test. Writing
 *
 *     if (stack.get_visible_child_name() !== focused) stack.set_visible_child_name(focused);
 *
 * reads as "set it unless it is already set", and it terminates only when the set TAKES.
 * MEASURED on libadwaita 1.9.3: `set_visible_child_name` with a name the stack does not hold
 * changes nothing, emits NO `notify::visible-child-name`, and prints
 * `Adwaita-WARNING: Child name '…' not found in AdwViewStack`. So `get_visible_child_name()`
 * still answers the old page, the comparison is still unequal, and the effect — which has no
 * dependency array on purpose, because a page can materialise on a render where `focused` did
 * not change — repeats the failing call on every render for as long as the mismatch lasts.
 *
 * A focused route whose page React has not committed yet is an ORDINARY intermediate state,
 * not a fault: the effect runs after the commit that added the OTHER pages, and the missing
 * one arrives on a later commit. So the answer is to do nothing and let the next render try,
 * which is what "not there yet" deserves — and one warning per render for a normal state is
 * how a log stops being read.
 *
 * AND THE SET HAS A SECOND WAY TO DO NOTHING, which is why presence alone is not the whole
 * gate. `adw_view_stack_set_visible_child_name` ends on
 * `if (gtk_widget_get_visible (page->widget)) set_visible_child (...)`, so a page that is
 * there but HIDDEN changes nothing, emits no notify and — unlike the missing name — prints
 * NOTHING AT ALL (measured). That is the same non-terminating state by the quieter road: the
 * caller would be told the stack shows `focused` while it shows the other page, and no log
 * anywhere would disagree. Both no-op paths are therefore asked about BEFORE the write, which
 * is also what keeps each one attributable to its own failing assertion.
 *
 * @returns whether the stack now shows `focused`.
 */
export function showFocusedPage(stack: Adw.ViewStack, focused: string): boolean {
    if (stack.get_visible_child_name() === focused) return true;
    const page = stack.get_child_by_name(focused);
    if (page === null) return false; // not committed yet — the branch that would warn
    if (!page.get_visible()) return false; // there, but the set would silently skip it
    stack.set_visible_child_name(focused);
    return true;
}

function TabsView(props: TabsViewProps): ReactElement {
    const { state, descriptors, navigation, NavigationContent } = useNavigationBuilder<
        TabState,
        TabRouterOptions,
        TabActionHelpers<ParamListBase>,
        TabScreenOptions,
        TabEvents
    >(TabRouter, props);

    const stackRef = useRef<Adw.ViewStack | null>(null);
    const switcherRef = useRef<Adw.ViewSwitcher | null>(null);
    const barRef = useRef<Adw.ViewSwitcherBar | null>(null);
    const binRef = useRef<Adw.BreakpointBin | null>(null);
    const breakpointRef = useRef<Adw.Breakpoint | null>(null);
    const thresholdRef = useRef<number | null>(null);
    const focused = state.routes[state.index]?.key;
    const chrome = useChrome('Tabs', props.headerShown !== false);

    /**
     * Narrow means THE SWITCHER GOES TO THE BOTTOM, which is Adwaita's own answer and
     * not a phone imitation: `Adw.ViewSwitcherBar` exists for exactly this, and every
     * adaptive GNOME application moves the switcher there when the window stops being
     * a desktop window. It matters beyond aesthetics because the same window runs on a
     * Linux phone, where this IS the tab bar.
     *
     * Without it the switcher stays in the header bar and is allocated less than it
     * asks for, which does not look like a limit — it looks like a bug. MEASURED on
     * libadwaita 1.9.3, five labelled tabs: the switcher's natural width is 647 px and
     * its minimum is 317, so between those two every label is ellipsised to "…" and
     * the window shows five identical buttons.
     */
    const [narrow, setNarrow] = useState(false);

    /**
     * The switcher's `stack` is set IMPERATIVELY, from a ref.
     *
     * It is an object-valued GObject property whose value is another widget in the
     * same tree, and a declarative prop would need the host to marshal a widget
     * reference into a `GValue` at a moment when the other widget may not have been
     * materialised yet. One `set_stack` after both exist is exactly the guarantee
     * that is needed and the only one available.
     */
    const wire = useCallback(() => {
        const stack = stackRef.current;
        if (stack === null) return;
        const switcher = switcherRef.current;
        if (switcher !== null && switcher.get_stack() !== stack) switcher.set_stack(stack);
        // The bottom bar takes the same treatment for the same reason: it builds its
        // own switcher from the stack, so it needs the stack and nothing else.
        const bar = barRef.current;
        if (bar !== null && bar.get_stack() !== stack) bar.set_stack(stack);
    }, []);

    /**
     * TWO TRIGGERS, and each covers the other's gap.
     *
     * The layout effect is the one that fires when this navigator renders the switcher
     * itself: the refs are attached during the commit, in tree order, so the switcher's
     * may run before the stack exists.
     *
     * The REF callbacks are the ones that fire when the switcher is CONTRIBUTED to an
     * enclosing header bar (`chrome.ts`) — that element is rendered by the level above,
     * so the commit that mounts it need not re-render this component at all, and an
     * effect here would never run for it. `wire` is idempotent, so both firing is free.
     *
     * `useCallback` with stable deps on both: the host disconnects and re-attaches a
     * ref whose identity changed on every commit, which would leave the widget
     * unreachable in between.
     */
    useLayoutEffect(wire);
    const attachStack = useCallback(
        (widget: unknown): void => {
            stackRef.current = (widget ?? null) as Adw.ViewStack | null;
            wire();
        },
        [wire],
    );
    const attachSwitcher = useCallback(
        (widget: unknown): void => {
            switcherRef.current = (widget ?? null) as Adw.ViewSwitcher | null;
            wire();
        },
        [wire],
    );
    const attachBar = useCallback(
        (widget: unknown): void => {
            barRef.current = (widget ?? null) as Adw.ViewSwitcherBar | null;
            wire();
        },
        [wire],
    );
    const attachBin = useCallback((widget: unknown): void => {
        binRef.current = (widget ?? null) as Adw.BreakpointBin | null;
    }, []);

    /**
     * WHERE THE BREAKPOINT COMES FROM: the header bar, measured, not a number.
     *
     * libadwaita's own example writes `max-width: 550px`, and a router cannot: the
     * width at which a switcher stops fitting is the width of ITS OWN LABELS plus
     * whatever that window's header bar puts around them, and both are the
     * application's. MEASURED here on the five labels this was found with, the bar
     * wants 671 px; the same bar with the user's window controls on one side wants
     * 52 px more than one with none (also measured), so even the surrounding chrome is
     * a setting rather than a constant.
     *
     * So the threshold is `Adw.HeaderBar`'s own natural width WHILE IT HOLDS THE
     * SWITCHER, which is by definition the width below which it cannot show it at
     * natural size. Natural width does not depend on the allocation, so this reads the
     * same in an already-narrow window as in a wide one.
     *
     * Re-read on every commit where the switcher is in a bar, so a tab whose title
     * changes moves the threshold with it. While NARROW the switcher is not rendered
     * at all, `switcherRef` is null, and the cached threshold is what the breakpoint
     * keeps — which is also what stops the obvious feedback loop: a switcher that has
     * been taken out of the bar measures nothing, and a threshold recomputed from that
     * would never let the window be wide again.
     */
    const applyThreshold = useCallback((): void => {
        const bin = binRef.current;
        const switcher = switcherRef.current;
        if (bin === null || switcher === null) return;
        const bar = switcher.get_ancestor(Adw.HeaderBar.$gtype) as Adw.HeaderBar | null;
        if (bar === null) return;
        const threshold = bar.measure(Gtk.Orientation.HORIZONTAL, -1)[1];
        if (threshold === thresholdRef.current) return;
        thresholdRef.current = threshold;
        // `max-width` is inclusive, so the switch happens one pixel BELOW the width
        // the bar asked for rather than at it.
        const condition = Adw.BreakpointCondition.parse(`max-width: ${Math.max(1, threshold - 1)}px`);
        const existing = breakpointRef.current;
        if (existing !== null) {
            existing.set_condition(condition);
        } else {
            const breakpoint = new Adw.Breakpoint({ condition });
            breakpointRef.current = breakpoint;
            bin.add_breakpoint(breakpoint);
        }
        // A breakpoint added to a bin that ALREADY matches does not announce itself —
        // `current-breakpoint` is settled during allocation, and the allocation that
        // would settle it has already happened. Asking for another one is what makes a
        // window that STARTS narrow start with its bottom bar, which is the case a
        // phone always takes.
        bin.queue_resize();
    }, []);

    /**
     * A breakpoint with NO SETTERS, used purely as the width predicate.
     *
     * libadwaita would apply the two setters itself (`reveal` on the bar, an unset
     * `title-widget` on the bar above) and that was the first shape this took. It puts
     * the same fact in two places: React decides what is in the header bar on every
     * other commit, and a setter that reaches around it leaves the two disagreeing the
     * moment a tab is added. The condition is libadwaita's; the placement stays
     * React's.
     */
    const onBreakpoint = useCallback((): void => {
        const bin = binRef.current;
        if (bin === null) return;
        setNarrow(bin.get_current_breakpoint() !== null);
    }, []);
    useLayoutEffect(applyThreshold);

    /**
     * The switcher, as ONE element whichever header bar ends up holding it.
     *
     * `slot: 'title'` is `Adw.HeaderBar.set_title_widget`, so the switcher sits where
     * the window title would be — Adwaita's own placement for it, and the reason a
     * routed application looks like a desktop application rather than a phone with a
     * tab bar. The element is memoised because it is handed UP into another
     * component's state when this navigator is not the chrome owner, and a fresh
     * element per render would re-contribute in a loop.
     */
    const switcher = useMemo(
        () => createElement('AdwViewSwitcher', { slot: 'title', ref: attachSwitcher, policy: 'wide' }),
        [attachSwitcher],
    );

    /**
     * What the header bar shows INSTEAD of the switcher once the switcher has gone
     * to the bottom.
     *
     * Not "nothing", which is what withdrawing the title widget alone leaves. An
     * `Adw.HeaderBar` with no title widget falls back to the enclosing
     * `Adw.NavigationPage`'s title, and under a route group that title is the group's
     * own name — a window whose header read "(tabs)" the moment the switcher moved.
     * The focused tab's title is the honest answer and the one a phone-shaped Adwaita
     * window shows: the switcher says where you can go, and when it is at the bottom
     * the bar says where you are.
     */
    const focusedTitle = (focused === undefined ? undefined : descriptors[focused]?.options.title) ?? '';
    const narrowTitle = useMemo(
        () => createElement('AdwWindowTitle', { slot: 'title', title: focusedTitle }),
        [focusedTitle],
    );

    /**
     * The bottom bar, rendered ALWAYS and revealed only when narrow.
     *
     * `Adw.ViewSwitcherBar` has a `reveal` property and animates it, so the bar slides
     * in and out the way it does in every other Adwaita application. Mounting it only
     * while narrow would swap that for a widget appearing, which is a different thing
     * to look at.
     */
    const switcherBar = useMemo(
        () => createElement('AdwViewSwitcherBar', { slot: 'bottom', ref: attachBar, reveal: narrow }),
        [attachBar, narrow],
    );

    /**
     * Contribute the switcher upward instead of building a second header bar.
     *
     * The condition is the whole chrome rule for this navigator: an inner `<Tabs>` with
     * a bar above it puts its switcher in that bar. With no bar above — `headerShown:
     * false` on the enclosing screen — there is nothing to contribute to, so the
     * fallback below renders a bar, and `chrome.decorated` decides whether it carries
     * the window controls.
     */
    const titleSlot = chrome.titleSlot;
    const contributes = titleSlot !== null && props.headerShown !== false;
    // WITHDRAWN while narrow, rather than hidden. The bar falls back to the page's own
    // title when its title widget is unset, which is what a phone shows above a bottom
    // tab bar; a switcher merely made invisible would leave that title area blank.
    useLayoutEffect(() => {
        if (titleSlot === null || props.headerShown === false) return;
        titleSlot.setTitleWidget(narrow ? narrowTitle : switcher);
        return () => titleSlot.setTitleWidget(null);
    }, [titleSlot, props.headerShown, switcher, narrow, narrowTitle]);

    /**
     * The page THIS layer last asked the stack to show, so its own echo is
     * recognisable. `null` until it has asked at all.
     *
     * Written BEFORE the call and not after, and that ordering is the whole point:
     * `set_visible_child_name` emits `notify::visible-child-name` from inside itself,
     * so the handler runs while `showFocusedPage` is still on the stack. Recording the
     * name afterwards would record it one emission too late — which is exactly the
     * window the defect lived in.
     */
    const shownRef = useRef<string | null>(null);

    // React → widget. The name is the route key, which is also what the page was
    // added under, so this is the join and not a lookup.
    useLayoutEffect(() => {
        const stack = stackRef.current;
        if (stack === null || focused === undefined) return;
        shownRef.current = focused;
        showFocusedPage(stack, focused);
    });

    /**
     * Widget → React: the user clicked a switcher button.
     *
     * No debounce is needed and none is added — `notify::visible-child-name` fires
     * once per change, unlike `Adw.NavigationView::popped` which fires once per popped
     * page.
     *
     * THE ECHO GUARD READS `shownRef`, NOT `navigation.getState()`, AND THAT IS
     * MEASURED. The obvious guard — "the name already equals the focused route" — asks
     * the CONTAINER, whose state `BaseNavigationContainer` publishes from an effect and
     * which therefore still holds the route the commit in progress has already left.
     * Measured on a five-tab group entered at `/t3`: the effect above put the stack on
     * `t3`, the notify arrived from inside that very call, and `navigation.getState()`
     * answered `t0` — so the guard missed its own echo, and this handler emitted a
     * `tabPress` and dispatched a `jumpTo` for a tab nobody pressed. That it named the
     * RIGHT tab there is timing: the same lag with the stack still on libadwaita's
     * insertion-time pick dispatches the FIRST page instead, and the deep link the
     * application was entered with is gone (#1453).
     *
     * `shownRef.current === null` is the third emitter and it is not a click either:
     * `add_page` selects a page whenever the stack has none, so the reconciler's first
     * insertion picks one before this layer has asked for anything at all.
     *
     * `tabPress` is emitted first and CAN be prevented, because that is React
     * Navigation's own contract for a tab and the thing a "scroll to top on second
     * press" handler hangs off. A prevented press leaves React's state alone, and the
     * effect above then puts the widget back on the focused page.
     */
    const onVisibleChildChanged = useCallback(() => {
        const stack = stackRef.current;
        if (stack === null) return;
        const name = stack.get_visible_child_name();
        if (name === null) return;
        if (shownRef.current === null || name === shownRef.current) return;
        const current = navigation.getState();
        if (name === current.routes[current.index]?.key) return;
        const route = current.routes.find((candidate) => candidate.key === name);
        if (route === undefined) {
            throw new RouterError(
                'no-route-node',
                `<Tabs> page "${name}"`,
                'became visible and belongs to no route in this navigator. Every page is added under its route ' +
                    'key, so this means something outside the router added a child to the Adw.ViewStack',
            );
        }
        const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
        if (event.defaultPrevented) {
            // Through the same guard, not a raw set: putting the widget BACK is the same
            // operation with the same two silent no-ops, and this is the one caller React
            // does not re-run afterwards — a prevented press changes no state, so no render
            // follows to try again. `shownRef` first, for the reason the effect above
            // records: the notify comes out of the call.
            const back = current.routes[current.index]?.key ?? name;
            shownRef.current = back;
            showFocusedPage(stack, back);
            return;
        }
        navigation.dispatch({ ...TabActions.jumpTo(route.name, route.params), target: current.key });
    }, [navigation]);

    // What the tabs publish downward, and it is decided by whether THIS level ends up
    // with a bar: contributing or refusing one leaves the question exactly as it was.
    const level =
        contributes || props.headerShown === false ? withoutHeaderBar(chrome.decorated) : underHeaderBar(null);

    const pages = state.routes.map((route) => {
        const descriptor = descriptors[route.key] as TabDescriptor | undefined;
        if (descriptor === undefined) {
            throw new RouterError(
                'no-route-node',
                `<Tabs> route "${route.name}"`,
                'has no descriptor. React Navigation builds one per screen, so this is a route the navigator ' +
                    'never received a <Screen> for',
            );
        }
        return createElement(
            // An `AdwBin` per page, so ONE widget lands in the stack under one name.
            // A screen that rendered two roots would otherwise add two children under
            // the same page name; the bin's `single` policy refuses that BY NAME
            // instead, naming the screen.
            'AdwBin',
            {
                key: route.key,
                // `layout` is how a `keyed` parent addresses a child (gtk-host's child
                // placement): `add_titled(child, name, title)`.
                layout: { name: route.key, title: descriptor.options.title ?? route.name },
            },
            // No title slot either way: this navigator's bar holds the switcher, so a
            // navigator inside a tab has nothing to contribute to and renders its own
            // bar. The level is published all the same — without it that navigator
            // reads the default, believes it is outermost, and its claim on the
            // window's header bar is refused as the second one.
            provideChromeLevel(level, descriptor.render()),
        );
    });

    const viewStack = createElement(
        'AdwViewStack',
        { ref: attachStack, 'on:notify::visible-child-name': onVisibleChildChanged },
        ...pages,
    );

    /**
     * `Adw.ViewStackPage:icon-name`, re-applied on EVERY commit and deliberately
     * without a dependency array.
     *
     * The icon cannot travel with the page the way the name and the title do:
     * `add_titled(child, name, title)` is the whole of the keyed placement, and the
     * icon belongs to the `Adw.ViewStackPage` that call RETURNS. `add_titled_with_icon`
     * exists and is not what this reaches for either — the page object is the thing
     * that carries it, and the page object is not stable.
     *
     * THAT INSTABILITY IS THE REASON THERE IS NO DEPENDENCY ARRAY. A keyed reorder
     * removes and re-adds every child, so every page is rebuilt; `name` and `title`
     * come back because the placement re-supplies them, and `icon-name` does not
     * (measured, and written down in the `AdwViewStack` descriptor). An effect that
     * only ran when the icon CHANGED would therefore lose it on the first reorder,
     * which is a route being added.
     *
     * Addressed by page NAME rather than by child widget, because the name is the route
     * key the placement already used and needs no second ref per tab.
     */
    const iconNames = state.routes.map((route) => [route.key, descriptors[route.key]?.options.iconName] as const);
    useLayoutEffect(() => {
        const stack = stackRef.current;
        if (stack === null) return;
        const wanted = new Map(iconNames);
        const list = stack.get_pages();
        for (let i = 0; i < list.get_n_items(); i += 1) {
            const page = list.get_item(i) as Adw.ViewStackPage | null;
            if (page === null) continue;
            const icon = wanted.get(page.get_name() ?? '');
            if (icon !== undefined && page.get_icon_name() !== icon) page.set_icon_name(icon);
        }
    });

    // `headerShown: false` refuses the switcher, and with it the bottom bar: a
    // navigator asked for no tab chrome gets none, in either place.
    if (props.headerShown === false) return createElement(NavigationContent, null, viewStack);

    /**
     * The shell, and it is now built in BOTH cases rather than only when this
     * navigator owns the window's bar.
     *
     * A contributing `<Tabs>` used to render its `Adw.ViewStack` bare, because
     * everything it needed was in somebody else's header bar. The bottom bar is not:
     * it belongs to THIS navigator whichever bar holds the switcher, so the toolbar
     * view that carries it is this navigator's too. Nesting one inside the enclosing
     * page's is what `Adw.ToolbarView` is for — a bar above or below a piece of
     * content — and it keeps the contribution seam at one method.
     *
     * `Adw.BreakpointBin` is the width predicate and has to wrap the toolbar view
     * rather than sit inside it: it measures ITS OWN allocation, which here is the
     * page's full width, and that is the width the header bar above also gets.
     */
    const shell = createElement(
        'AdwBreakpointBin',
        {
            ref: attachBin,
            'on:notify::current-breakpoint': onBreakpoint,
            // `Adw.BreakpointBin` refuses to guess: without both it warns "does not
            // have a minimum size" on every allocation. 360x294 is GNOME's own
            // smallest supported window, which is the size this is adapting to.
            widthRequest: 360,
            heightRequest: 294,
        },
        createElement(
            'AdwToolbarView',
            null,
            contributes
                ? null
                : createElement(
                      'AdwHeaderBar',
                      {
                          slot: 'top',
                          showStartTitleButtons: !chrome.decorated,
                          showEndTitleButtons: !chrome.decorated,
                      },
                      narrow ? narrowTitle : switcher,
                  ),
            switcherBar,
            viewStack,
        ),
    );
    return createElement(NavigationContent, null, shell);
}
TabsView.displayName = 'GjsifyTabsView';

const pair = navigationPair<TabsViewProps>(TabsView);

/** A `<Tabs.Screen>` declaration. Read as data by `<Tabs>`; never rendered. */
function TabsScreen(_props: ScreenDeclaration & { options?: TabScreenOptions }): never {
    throw new RouterError(
        'not-a-screen-child',
        '<Tabs.Screen>',
        'was rendered instead of being read. It is a declaration: `<Tabs>` collects its `name` and `options` and ' +
            'never renders it, so it only belongs as a direct child of `<Tabs>`',
    );
}
TabsScreen.displayName = 'Tabs.Screen';

/** What `<Tabs>` accepts. */
export interface TabsProps {
    /** `<Tabs.Screen>` declarations, and nothing else. */
    children?: ReactNode;
    /** Options for every tab, before its own. */
    screenOptions?: TabScreenOptions;
    /** `false` drops the header bar, and with it the switcher. */
    headerShown?: boolean;
}

/**
 * `expo-router`'s `<Tabs>`: its tabs are the FILES this `_layout` owns.
 *
 * Every tab is mounted. React Native's tab navigator mounts lazily because a phone
 * cannot afford five screens; a GTK page that is not the visible child of an
 * `Adw.ViewStack` is not realised and costs a widget, and the laziness would buy a
 * flash on first switch. Declared as a limit rather than left as a surprise.
 */
export function Tabs(props: TabsProps): ReactElement {
    const node = useRouteNode('Tabs');
    const options = screenOptionsFrom(
        'Tabs',
        TabsScreen as unknown as ComponentType<ScreenDeclaration>,
        TAB_OPTIONS,
        props.children,
    );
    const screens = useSynthesisedScreens(node, pair.Screen, options);
    return createElement(
        pair.Navigator,
        {
            ...(props.screenOptions === undefined ? {} : { screenOptions: props.screenOptions }),
            ...(props.headerShown === undefined ? {} : { headerShown: props.headerShown }),
        } as TabsViewProps,
        ...screens,
    );
}
Tabs.Screen = TabsScreen;
