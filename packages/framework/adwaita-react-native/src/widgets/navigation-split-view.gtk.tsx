/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwNavigationSplitView` on GTK — the real `Adw.NavigationSplitView`. (On the pragma,
// see `bin.gtk.tsx`.)
//
// NEITHER THE WIDTH NOR THE ORDERING IS COMPUTED HERE. `resolveNavigationSidebarWidth`
// and `resolveNavigationStack` are `@gjsify/adwaita-core`'s ports of
// `allocate_uncollapsed` and `update_navigation_stack`; on this half the C originals are
// right there, and computing the same answer twice would give the widget two
// authorities for its own layout. That is the rule `clamp.gtk.tsx` states for
// `clampAllocate`, and the core's value on this path is as the oracle
// `navigation-split-view.native.spec.tsx` is measured against.
//
// BOTH PANES ARE WRAPPED IN AN `Adw.NavigationPage`, AND THAT IS NOT A CONVENIENCE.
// `adw_navigation_split_view_set_sidebar` is typed `AdwNavigationPage*`; handing it a
// `GtkBox` is a rejected child, so the wrap is what makes a `ReactNode` sidebar
// expressible at all. The two other renderers wrap too — `@gjsify/adwaita-web` moves
// each slotted pane into its own `.adw-nsv-sidebar` / `.adw-nsv-content` box and reads
// `tag` off the child, `@gjsify/adwaita-nativescript` keeps `sidebarTag`/`contentTag`
// on the widget because "a `View` is not an `Adw.NavigationPage`". The four page props
// on this surface are that wrap's properties, named where the caller can reach them.
//
// A PANE IS OMITTED WHEN ITS PROP IS, and the distinction is load-bearing rather than
// tidy: `update_navigation_stack` branches on which children EXIST, so a split view
// with only a sidebar keeps that sidebar visible whatever `show-content` says. Always
// emitting an empty content page would make `hasContent` true and collapse that rule to
// a blank pane — measured as the exact bug `@gjsify/adwaita-nativescript` names in
// `_applyLayout` ("keying it on `showSidebar` alone rendered a split view holding only
// a sidebar blank").

import type { ReactElement } from 'react';

import type { AdwNavigationSplitViewProps } from '../props.js';

/** {@link import('./navigation-split-view.js').AdwNavigationSplitView} on GTK. */
export function AdwNavigationSplitView({
    children,
    sidebar,
    sidebarTag,
    contentTag,
    sidebarTitle,
    contentTitle,
    collapsed,
    showContent,
    sidebarPosition,
    minSidebarWidth,
    maxSidebarWidth,
    sidebarWidthFraction,
    sidebarWidthUnit,
}: AdwNavigationSplitViewProps): ReactElement | null {
    return (
        <adw-navigation-split-view
            collapsed={collapsed}
            show-content={showContent}
            sidebar-position={sidebarPosition}
            min-sidebar-width={minSidebarWidth}
            max-sidebar-width={maxSidebarWidth}
            sidebar-width-fraction={sidebarWidthFraction}
            sidebar-width-unit={sidebarWidthUnit}
        >
            {sidebar === undefined ? null : (
                <adw-navigation-page slot="sidebar" tag={sidebarTag} title={sidebarTitle}>
                    {sidebar}
                </adw-navigation-page>
            )}
            {children === undefined ? null : (
                <adw-navigation-page slot="content" tag={contentTag} title={contentTitle}>
                    {children}
                </adw-navigation-page>
            )}
        </adw-navigation-split-view>
    );
}
