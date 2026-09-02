/** @jsxImportSource react */
// `AdwNavigationSplitView` on React Native — `@gjsify/adwaita-core`'s ports of
// `allocate_uncollapsed` and `update_navigation_stack`. (On the pragma, see
// `bin.native.tsx`.)
//
// TWO CORE ANSWERS, AND NEITHER IS APPROXIMATED HERE. `resolveNavigationSidebarWidth` is
// the C's own arithmetic — the fraction truncated with `(int)`, the max bound capped by
// `width - content_min`, and GLib's `CLAMP`, which tests the HIGH bound first and
// therefore disagrees with `Math.min(max, Math.max(min, x))` exactly where the bounds
// invert. `resolveNavigationStack` is the ordering table: a LONE child stays visible
// whatever `show-content` says, and under `sidebar-position: end` the CONTENT is the
// root page. A `width: '25%'` and an `if (showContent)` would agree with libadwaita in
// the easy cases and nowhere else.
//
// THE SIZE SOURCE IS `onLayout`, NOT `useWindowDimensions()`, for the reason
// `clamp.native.tsx` gives: every renderer of this design binds to the size of the VIEW.
// A split view nested in a pane has to divide the pane.
//
// `contentMin` AND `sidebarChildMin` ARE PASSED AS 0 BECAUSE REACT NATIVE HAS NO MEASURE
// PASS — the same one-directional divergence `AdwClamp` carries and the README names.
// libadwaita protects the content pane by capping the sidebar's max bound with the
// content's own minimum; `onLayout` reports a size AFTER layout and never a child's
// intrinsic minimum, so that protection is absent here and the sidebar can take its full
// share of a view too narrow for both.
//
// THE STATE IS IN A `useRef` AND THE PANES ARE MOUNTED BY IDENTITY.
// `NavigationSplitViewState.setSidebar` compares the page ref by IDENTITY and emits on
// every change, so handing it a fresh `{ tag }` each commit would emit each commit —
// which, with the repaint this file subscribes, is a render loop rather than a
// divergence. One ref object per pane, mounted once and RETAGGED through `setTag`, is
// what makes mounting idempotent; it is also libadwaita's own split, where mounting a
// colliding tag REFUSES the assignment and retagging a mounted page CLEARS the tag.
//
// THE READING DIRECTION IS `ltr` HERE. `isSidebarAtVisualStart` takes one, GTK resolves
// it from the widget, and React Native's is on `I18nManager` — which is not a host
// component and therefore not something `testing/react-native.ts` may stand in for. The
// README names it; the core call still takes the parameter, so closing it is one
// argument.

import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import {
    NavigationSplitViewState,
    layoutNavigationSplitView,
    resolveNavigationSidebarWidth,
    type NavigationPageRef,
    type SplitViewPane,
} from '@gjsify/adwaita-core';

import type { AdwNavigationSplitViewProps } from '../props.js';

/** What survives every render: the ordering machine and one mountable ref per pane. */
interface SplitViewStore {
    state: NavigationSplitViewState;
    sidebarPage: NavigationPageRef;
    contentPage: NavigationPageRef;
}

/**
 * {@link import('./navigation-split-view.js').AdwNavigationSplitView} on React Native.
 *
 * BEFORE THE FIRST LAYOUT there is no available width, so both panes render unsized for
 * exactly one frame — the same one-frame case `AdwClamp` has, and for the same reason.
 */
export function AdwNavigationSplitView({
    children,
    sidebar,
    sidebarTag,
    contentTag,
    collapsed,
    showContent,
    sidebarPosition,
    minSidebarWidth,
    maxSidebarWidth,
    sidebarWidthFraction,
    sidebarWidthUnit,
}: AdwNavigationSplitViewProps): ReactElement | null {
    const [available, setAvailable] = useState<number | null>(null);
    const [, repaint] = useState(0);

    const store = useRef<SplitViewStore | null>(null);
    store.current ??= {
        state: new NavigationSplitViewState({
            sidebarPosition: sidebarPosition ?? 'start',
            collapsed: collapsed ?? false,
            showContent: showContent ?? false,
        }),
        sidebarPage: { tag: sidebarTag ?? null },
        contentPage: { tag: contentTag ?? null },
    };
    const { state, sidebarPage, contentPage } = store.current;

    useEffect(() => state.subscribe(() => repaint((count) => count + 1)), [state]);

    useEffect(() => {
        // The tag has to be current BEFORE the pane is mounted: `setSidebar` reads it off
        // the ref and refuses the whole assignment on a collision.
        sidebarPage.tag = sidebarTag ?? null;
        contentPage.tag = contentTag ?? null;
        if ((sidebar !== undefined) !== (state.sidebar !== null)) {
            state.setSidebar(sidebar === undefined ? null : sidebarPage);
        } else if (state.sidebar !== null && state.sidebarTag !== (sidebarTag ?? null)) {
            state.setTag('sidebar', sidebarTag ?? null);
        }
        if ((children !== undefined) !== (state.content !== null)) {
            state.setContent(children === undefined ? null : contentPage);
        } else if (state.content !== null && state.contentTag !== (contentTag ?? null)) {
            state.setTag('content', contentTag ?? null);
        }
        state.setSidebarPosition(sidebarPosition ?? 'start');
        state.setCollapsed(collapsed ?? false);
        state.setShowContent(showContent ?? false);
    });

    const onLayout = (event: LayoutChangeEvent): void => setAvailable(event.nativeEvent.layout.width);

    const pane = (which: SplitViewPane, body: ReactNode, style: Record<string, number> | undefined): ReactElement => (
        <View key={which} style={style}>
            {body}
        </View>
    );

    // Collapsed, the visible pane fills the view — and WHICH pane that is comes out of
    // the ordering table, never out of `showContent`. Keying it on the flag renders a
    // split view holding only a sidebar blank, which is the bug
    // `@gjsify/adwaita-nativescript` records against its own `_applyLayout`.
    if (state.collapsed) {
        const visible = state.visiblePane;
        if (visible === null) return <View onLayout={onLayout} style={{ flex: 1 }} />;
        return (
            <View onLayout={onLayout} style={{ flex: 1 }}>
                {pane(visible, visible === 'sidebar' ? sidebar : children, { flex: 1 })}
            </View>
        );
    }

    const layout =
        available === null
            ? null
            : layoutNavigationSplitView({
                  totalWidth: available,
                  sidebarWidth: resolveNavigationSidebarWidth({
                      totalWidth: available,
                      minSidebarWidth,
                      maxSidebarWidth,
                      sidebarWidthFraction,
                      sidebarWidthUnit,
                  }),
                  sidebarPosition: state.sidebarPosition,
              });
    const sidebarStyle = layout === null ? undefined : { width: layout.sidebar.width };
    const contentStyle = layout === null ? undefined : { width: layout.content.width };

    const sidebarPane = sidebar === undefined ? null : pane('sidebar', sidebar, sidebarStyle);
    const contentPane = children === undefined ? null : pane('content', children, contentStyle);
    // Draw order follows the rects the core returned, so `sidebar-position: end` puts the
    // sidebar last rather than needing a second predicate here.
    const sidebarFirst = layout === null || layout.sidebar.x <= layout.content.x;

    return (
        <View onLayout={onLayout} style={{ flex: 1, flexDirection: 'row' }}>
            {sidebarFirst ? sidebarPane : contentPane}
            {sidebarFirst ? contentPane : sidebarPane}
        </View>
    );
}
