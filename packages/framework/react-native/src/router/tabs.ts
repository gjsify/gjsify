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
    type ComponentType,
    type ReactElement,
    type ReactNode,
} from 'react';
import type Adw from '@girs/adw-1';

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
const TAB_OPTIONS: readonly string[] = ['title'];

/** What one tab can be told. */
export interface TabScreenOptions {
    /** The switcher button's label. Defaults to the route name. */
    title?: string;
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
    const focused = state.routes[state.index]?.key;
    const chrome = useChrome('Tabs');

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
        const switcher = switcherRef.current;
        const stack = stackRef.current;
        if (switcher !== null && stack !== null && switcher.get_stack() !== stack) switcher.set_stack(stack);
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
    useLayoutEffect(() => {
        if (titleSlot === null || props.headerShown === false) return;
        titleSlot.setTitleWidget(switcher);
        return () => titleSlot.setTitleWidget(null);
    }, [titleSlot, props.headerShown, switcher]);

    // React → widget. The name is the route key, which is also what the page was
    // added under, so this is the join and not a lookup.
    useLayoutEffect(() => {
        const stack = stackRef.current;
        if (stack === null || focused === undefined) return;
        showFocusedPage(stack, focused);
    });

    /**
     * Widget → React: the user clicked a switcher button.
     *
     * No debounce is needed and none is added — `notify::visible-child-name` fires
     * once per change, unlike `Adw.NavigationView::popped` which fires once per popped
     * page. The `focused` guard is what stops the echo: the effect above sets the same
     * property, and its notify arrives with the name already equal.
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
            // follows to try again.
            showFocusedPage(stack, current.routes[current.index]?.key ?? name);
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

    // Nothing to wrap: the switcher is either refused (`headerShown: false`) or it is
    // living in the enclosing level's header bar.
    if (props.headerShown === false || contributes) return createElement(NavigationContent, null, viewStack);

    return createElement(
        NavigationContent,
        null,
        createElement(
            'AdwToolbarView',
            null,
            createElement(
                'AdwHeaderBar',
                { slot: 'top', showStartTitleButtons: !chrome.decorated, showEndTitleButtons: !chrome.decorated },
                switcher,
            ),
            viewStack,
        ),
    );
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
