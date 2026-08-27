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
    useRef,
    type ComponentType,
    type ReactElement,
    type ReactNode,
} from 'react';
import type Adw from '@girs/adw-1';

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

    /**
     * The switcher's `stack` is set IMPERATIVELY, from a ref.
     *
     * It is an object-valued GObject property whose value is another widget in the
     * same tree, and a declarative prop would need the host to marshal a widget
     * reference into a `GValue` at a moment when the other widget may not have been
     * materialised yet. One `set_stack` in a layout effect happens after both exist,
     * which is exactly the guarantee that is needed and the only one available.
     */
    useLayoutEffect(() => {
        const switcher = switcherRef.current;
        const stack = stackRef.current;
        if (switcher !== null && stack !== null && switcher.get_stack() !== stack) switcher.set_stack(stack);
    });

    // React → widget. The name is the route key, which is also what the page was
    // added under, so this is the join and not a lookup.
    useLayoutEffect(() => {
        const stack = stackRef.current;
        if (stack === null || focused === undefined) return;
        if (stack.get_visible_child_name() !== focused) stack.set_visible_child_name(focused);
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
            stack.set_visible_child_name(current.routes[current.index]?.key ?? name);
            return;
        }
        navigation.dispatch({ ...TabActions.jumpTo(route.name, route.params), target: current.key });
    }, [navigation]);

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
            descriptor.render(),
        );
    });

    const viewStack = createElement(
        'AdwViewStack',
        { ref: stackRef, 'on:notify::visible-child-name': onVisibleChildChanged },
        ...pages,
    );

    if (props.headerShown === false) return createElement(NavigationContent, null, viewStack);

    return createElement(
        NavigationContent,
        null,
        createElement(
            'AdwToolbarView',
            null,
            createElement(
                'AdwHeaderBar',
                { slot: 'top' },
                // `slot="title"` is `Adw.HeaderBar.set_title_widget`, so the switcher
                // sits where the window title would be — Adwaita's own placement for
                // it, and the reason it looks like a desktop application rather than
                // a phone with a tab bar.
                createElement('AdwViewSwitcher', { slot: 'title', ref: switcherRef, policy: 'wide' }),
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
