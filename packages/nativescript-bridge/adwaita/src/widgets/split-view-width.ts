// Sidebar width for the NativeScript split views — the pure half.
//
// `Adw.OverlaySplitView` does not have a sidebar width; it has a FRACTION of the
// container clamped between a minimum and a maximum, recomputed whenever the
// container resizes. The NativeScript port instead carried a single invented
// constant (240 DIP), which cannot be right across the range it has to serve:
//
//   411 DIP phone  -> libadwaita 180 (clamp lifts 102 up), NS 240 = 58% of it
//   800 DIP tablet -> libadwaita 200,                       NS 240
//  1200 DIP        -> libadwaita 280 (clamp holds 300 down), NS 240
//
// The arithmetic itself is HEADLESS and lives in `@gjsify/adwaita-core`; what
// this module adds is the NativeScript defaults and the "no size yet" case, so
// that a widget which has not been laid out still has something to draw.
//
// Free of `@nativescript/core` value imports — like `icon-path.ts`,
// `row-press.ts` and `avatar-color.ts` — so the spec suite exercises the
// shipping code rather than a transcription of it. `split-view-base.ts` cannot
// serve that role: it `extends GridLayout`, which is unresolvable off-device.
//
// Reference: refs/libadwaita/src/adw-overlay-split-view.c (:1036-1075)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import {
    DEFAULT_MAX_SIDEBAR_WIDTH,
    DEFAULT_MIN_SIDEBAR_WIDTH,
    DEFAULT_SIDEBAR_WIDTH_FRACTION,
    resolveNavigationSidebarWidth,
    resolveOverlaySidebarWidth,
} from '@gjsify/adwaita-core';

export { DEFAULT_MAX_SIDEBAR_WIDTH, DEFAULT_MIN_SIDEBAR_WIDTH, DEFAULT_SIDEBAR_WIDTH_FRACTION };

/** The three width properties, as a split view holds them. */
export interface SidebarWidthProps {
    /** Lower bound in DIPs. Defaults to libadwaita's 180. */
    minSidebarWidth: number;
    /** Upper bound in DIPs. Defaults to libadwaita's 280. */
    maxSidebarWidth: number;
    /** Share of the container the sidebar asks for. Defaults to 0.25. */
    sidebarWidthFraction: number;
}

/** The property defaults a fresh split view starts with. */
export function defaultSidebarWidthProps(): SidebarWidthProps {
    return {
        minSidebarWidth: DEFAULT_MIN_SIDEBAR_WIDTH,
        maxSidebarWidth: DEFAULT_MAX_SIDEBAR_WIDTH,
        sidebarWidthFraction: DEFAULT_SIDEBAR_WIDTH_FRACTION,
    };
}

/** Which split view is asking — the two answer the same input differently. */
export type SplitViewWidthRule = 'navigation' | 'overlay';

/** The pane minimums, when the renderer knows them. */
export interface SidebarPaneMinimums {
    /** The content pane's own minimum width. */
    contentMin?: number;
    /** The sidebar child's own minimum width. */
    sidebarChildMin?: number;
}

/**
 * The sidebar width for a container of `totalWidth` DIPs.
 *
 * The two widgets genuinely differ, and not only in a corner: OVERLAY takes a
 * final `min(width, totalWidth - contentMin)`, so it never claims more than the
 * view has left; NAVIGATION folds that same limit into the clamp's UPPER bound,
 * where the LOWER bound can still win — so it may exceed the view. A 100 DIP
 * container with no content minimum at all already splits them: navigation
 * answers 180 (its minimum), overlay answers 100 (all there is).
 *
 * `totalWidth <= 0` means the view has not been laid out yet — NativeScript
 * reports a zero size before the first pass — so the MINIMUM is returned rather
 * than a fraction of nothing. That is the smallest thing libadwaita would ever
 * draw, so the first layout can only widen it, never jump down.
 */
export function sidebarWidthFor(
    totalWidth: number,
    props: SidebarWidthProps,
    rule: SplitViewWidthRule = 'overlay',
    panes: SidebarPaneMinimums = {},
): number {
    if (!(totalWidth > 0)) return Math.max(props.minSidebarWidth, 0);
    const input = {
        totalWidth,
        minSidebarWidth: props.minSidebarWidth,
        maxSidebarWidth: props.maxSidebarWidth,
        sidebarWidthFraction: props.sidebarWidthFraction,
        contentMin: panes.contentMin ?? 0,
        sidebarChildMin: panes.sidebarChildMin ?? 0,
    };
    return rule === 'navigation' ? resolveNavigationSidebarWidth(input) : resolveOverlaySidebarWidth(input);
}

/**
 * Normalise one width property, keeping a nonsense value from reaching layout.
 *
 * A non-finite or negative input falls back to the default rather than to zero:
 * a zero-width sidebar is indistinguishable from a missing one on screen, which
 * turns a typo into a widget that looks broken instead of one that looks wrong.
 */
export function normalizeWidthProp(value: number, fallback: number): number {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Clamp the fraction into the `[0, 1]` range its GTK property is declared with. */
export function normalizeWidthFraction(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH_FRACTION;
    return Math.min(1, Math.max(0, value));
}
