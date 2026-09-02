/** @jsxImportSource @gjsify/gtk-host/react */
// `AdwOverlaySplitView` on GTK — the real `Adw.OverlaySplitView`. (On the pragma, see
// `bin.gtk.tsx`.)
//
// NO `Adw.NavigationPage` HERE, unlike its navigation sibling: `Adw.OverlaySplitView:sidebar`
// and `:content` are plain `GtkWidget`, so neither pane needs the page wrap that file
// explains. That is the only structural difference between the two, and it is a property
// of the C rather than a choice.
//
// The sidebar still gets one `GtkBox`, for the reason spelled out in `header-bar.gtk.tsx`:
// gtk-host routes a child by the `slot` prop on the CHILD, a prop of this component is an
// arbitrary `ReactNode`, and `cloneElement` cannot put a `slot` on a composite component.
// `children` needs none — it goes to the descriptor's `defaultSlot`, which is `content`.
//
// `OverlaySplitViewState` IS NOT USED HERE. The core's port of the collapse coupling —
// collapsing hides an unpinned sidebar, uncollapsing shows it again, without animating —
// is for a renderer with no libadwaita; on this half `adw_overlay_split_view_set_collapsed`
// does it, and `onNotifyShowSidebar` below is how the caller learns what it decided.
// Running both would give one widget two authorities for its own `show-sidebar`.
//
// `collapsed` IS WRITTEN LAST, AND THAT ORDER IS MEASURED RATHER THAN REASONED. gtk-host
// applies props in the order they appear on the element, and
// `adw_overlay_split_view_set_collapsed` HIDES an unpinned sidebar on its way through —
// so with `collapsed` first, `<AdwOverlaySplitView pinSidebar collapsed>` reached
// `set_collapsed` while `pin-sidebar` was still FALSE and read back `show-sidebar: false`
// on libadwaita 1.9.3, with no diagnostic and a sidebar simply not on screen. Writing the
// two flags it CONSULTS before it is the fix, and it is the same ordering
// `overlay-split-view.native.tsx`'s effect applies for the same reason —
// `@gjsify/adwaita-web`'s `_readAttribute` says so in a comment ("Last: it can change
// `show-sidebar`").
//
// THE NOTIFY HANDLER READS THE WIDGET BACK RATHER THAN TAKING THE VALUE FROM THE SIGNAL,
// because a `notify::` handler in this host receives the ParamSpec alone (`attrs.ts`
// strips the emitting object). A ref is therefore not optional decoration: without it
// the callback knows THAT `show-sidebar` moved and not what to.

import type Adw from 'gi://Adw?version=1';
import { useRef, type ReactElement } from 'react';

import type { AdwOverlaySplitViewProps } from '../props.js';

/** {@link import('./overlay-split-view.js').AdwOverlaySplitView} on GTK. */
export function AdwOverlaySplitView({
    children,
    sidebar,
    collapsed,
    showSidebar,
    pinSidebar,
    sidebarPosition,
    enableShowGesture,
    enableHideGesture,
    minSidebarWidth,
    maxSidebarWidth,
    sidebarWidthFraction,
    sidebarWidthUnit,
    onNotifyShowSidebar,
}: AdwOverlaySplitViewProps): ReactElement | null {
    const view = useRef<Adw.OverlaySplitView | null>(null);

    return (
        <adw-overlay-split-view
            ref={view}
            pin-sidebar={pinSidebar}
            show-sidebar={showSidebar}
            sidebar-position={sidebarPosition}
            enable-show-gesture={enableShowGesture}
            enable-hide-gesture={enableHideGesture}
            min-sidebar-width={minSidebarWidth}
            max-sidebar-width={maxSidebarWidth}
            sidebar-width-fraction={sidebarWidthFraction}
            sidebar-width-unit={sidebarWidthUnit}
            collapsed={collapsed}
            onNotifyShowSidebar={
                onNotifyShowSidebar === undefined
                    ? undefined
                    : () => onNotifyShowSidebar(view.current?.showSidebar ?? false)
            }
        >
            {sidebar === undefined ? null : (
                <gtk-box slot="sidebar" orientation="vertical">
                    {sidebar}
                </gtk-box>
            )}
            {children}
        </adw-overlay-split-view>
    );
}
