/** @jsxImportSource react */
// `AdwOverlaySplitView` on React Native — `@gjsify/adwaita-core`'s `OverlaySplitViewState`
// plus `layoutOverlaySplitView`. (On the pragma, see `bin.native.tsx`.)
//
// THE WIDTH RULE IS NOT ITS SIBLING'S, and that is the whole reason the two widgets are
// two files rather than one with a flag. `resolveOverlaySidebarWidth` caps the RESULT by
// `width - content_min` where `resolveNavigationSidebarWidth` caps the BOUND, and a
// COLLAPSED overlay ignores the fraction entirely and clamps the VIEW width instead — 280
// on a 360-point phone, where a quarter would be 180. Both are the C's, ported once.
//
// BOTH PANES ARE PLACED AT THE RECTS THE CORE RETURNS, and one code path covers docked
// and overlaid. `@gjsify/adwaita-web` keeps the docked case in flex flow with a negative
// margin and places only the collapsed one absolutely; the rects are the same numbers
// either way, and one path is one place for them to be wrong. `layoutOverlaySplitView`
// answers for ANY progress, overshoot included, which is what makes the reveal a
// continuum rather than two end states.
//
// THE REVEAL IS INSTANT HERE. The core's default is `INSTANT_SPLIT_VIEW_ANIMATOR`, and
// this file does not replace it: libadwaita animates with a spring `(1, 0.5, 500)`, the
// browser renderer approximates it from `requestAnimationFrame` and NativeScript from
// `View.animate()`, and React Native's own answer is `Animated` — a COMPOSITE surface
// this package's test double may not stand in for (`testing/react-native.ts` names the
// rule and `spinner.native.tsx` the precedent). So `show-progress` steps 0 → 1 and the
// gesture properties are carried and inert. The README names it.
//
// `showSidebar` IS NOT PURELY THE CALLER'S, and that costs this file two rules rather
// than one. Unless `pin-sidebar` is set, collapsing HIDES the sidebar and uncollapsing
// SHOWS it, and `setCollapsed` does that itself.
//
// FIRST: `collapsed` IS APPLIED LAST, at construction as well as on update. It is
// deliberately not a constructor option here — the constructor ASSIGNS its options and
// runs no coupling, so a `collapsed` passed in would leave an unpinned sidebar shown,
// where the GTK half (whose props gtk-host writes in element order, `collapsed` last)
// reads back `show-sidebar: false`. Measured on libadwaita 1.9.3, and the reason
// `overlay-split-view.gtk.tsx` carries the same ordering note.
//
// SECOND: ONLY A PROP THAT CHANGED IS PUSHED. A blanket re-apply on every commit would
// take the auto-hide the widget just performed and overwrite it with the caller's stale
// `showSidebar`, one render later and with no diagnostic — which is exactly why
// `@gjsify/adwaita-web` pushes ONE attribute per `attributeChangedCallback` and says so
// ("a blanket re-read would clobber that decision with the stale attribute"). React has
// no per-prop callback, so the previously-applied values live in a ref and this effect is
// the diff.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { OverlaySplitViewState, layoutOverlaySplitView, resolveOverlaySidebarWidth } from '@gjsify/adwaita-core';

import type { AdwOverlaySplitViewProps } from '../props.js';

/** {@link import('./overlay-split-view.js').AdwOverlaySplitView} on React Native. */
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
    const [available, setAvailable] = useState<number | null>(null);
    const [, repaint] = useState(0);

    const state = useRef<OverlaySplitViewState | null>(null);
    if (state.current === null) {
        const created = new OverlaySplitViewState({
            showSidebar: showSidebar ?? true,
            pinSidebar: pinSidebar ?? false,
            sidebarPosition: sidebarPosition ?? 'start',
            enableShowGesture: enableShowGesture ?? true,
            enableHideGesture: enableHideGesture ?? true,
        });
        // LAST, and through the SETTER — see the second paragraph at the head.
        created.setCollapsed(collapsed ?? false);
        state.current = created;
    }
    const view = state.current;

    /** What was last pushed into the state, so the effect can push only what moved. */
    const applied = useRef({
        collapsed,
        showSidebar,
        pinSidebar,
        sidebarPosition,
        enableShowGesture,
        enableHideGesture,
    });

    // The callback is read out of a ref rather than closed over, so the subscription is
    // installed once: re-subscribing whenever a caller passes a fresh arrow would drop
    // and re-add a listener on every render, and the core snapshots its listener set
    // during a fan-out.
    const notify = useRef(onNotifyShowSidebar);
    notify.current = onNotifyShowSidebar;

    useEffect(
        () =>
            view.subscribe((change) => {
                if (change.property === 'show-sidebar') notify.current?.(view.showSidebar);
                repaint((count) => count + 1);
            }),
        [view],
    );

    useEffect(() => {
        const previous = applied.current;
        if (pinSidebar !== previous.pinSidebar) view.setPinSidebar(pinSidebar ?? false);
        if (sidebarPosition !== previous.sidebarPosition) view.setSidebarPosition(sidebarPosition ?? 'start');
        if (enableShowGesture !== previous.enableShowGesture) view.setEnableShowGesture(enableShowGesture ?? true);
        if (enableHideGesture !== previous.enableHideGesture) view.setEnableHideGesture(enableHideGesture ?? true);
        if (showSidebar !== previous.showSidebar) view.setShowSidebar(showSidebar ?? true, { animate: false });
        // LAST: it can change `show-sidebar` on its own.
        if (collapsed !== previous.collapsed) view.setCollapsed(collapsed ?? false);
        applied.current = { collapsed, showSidebar, pinSidebar, sidebarPosition, enableShowGesture, enableHideGesture };
    });

    const onLayout = (event: LayoutChangeEvent): void => setAvailable(event.nativeEvent.layout.width);

    const layout =
        available === null
            ? null
            : layoutOverlaySplitView({
                  totalWidth: available,
                  sidebarWidth: resolveOverlaySidebarWidth({
                      totalWidth: available,
                      collapsed: view.collapsed,
                      minSidebarWidth,
                      maxSidebarWidth,
                      sidebarWidthFraction,
                      sidebarWidthUnit,
                  }),
                  showProgress: view.showProgress,
                  collapsed: view.collapsed,
                  sidebarPosition: view.sidebarPosition,
              });

    // Paint order is content, shield, sidebar — the order `@gjsify/adwaita-nativescript`
    // re-raises its children into on every layout, because a shield under the content
    // shields nothing and a sidebar under the shield is unreachable.
    return (
        <View onLayout={onLayout} style={{ flex: 1 }}>
            <View
                style={
                    layout === null ? undefined : { position: 'absolute', top: 0, bottom: 0, ...rect(layout.content) }
                }
            >
                {children}
            </View>
            {layout === null || !layout.shieldVisible ? null : (
                <View
                    style={{
                        position: 'absolute',
                        top: 0,
                        bottom: 0,
                        left: 0,
                        right: 0,
                        // `shadowProgress` is INVERTED relative to the reveal: 1 is no
                        // shadow, 0 is fully shadowed.
                        opacity: 1 - layout.shadowProgress,
                    }}
                />
            )}
            {sidebar === undefined ? null : (
                <View
                    style={
                        layout === null
                            ? undefined
                            : {
                                  position: 'absolute',
                                  top: 0,
                                  bottom: 0,
                                  ...rect(layout.sidebar),
                                  // The snapshot gate: below zero progress nothing is
                                  // painted, and what is not painted takes no input.
                                  opacity: layout.sidebarPainted ? 1 : 0,
                              }
                    }
                >
                    {sidebar}
                </View>
            )}
        </View>
    );
}

/** A core pane rect as the two style keys React Native places a box with. */
function rect(pane: { x: number; width: number }): { left: number; width: number } {
    return { left: pane.x, width: pane.width };
}
