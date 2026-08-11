// Sidebar width for the NativeScript split views — the pure half.
//
// `Adw.OverlaySplitView` does not have a sidebar width; it has a FRACTION of the
// container clamped between a minimum and a maximum, recomputed whenever the
// container resizes — so any single constant is wrong somewhere across the phone →
// tablet → desktop range. The arithmetic is HEADLESS in `@gjsify/adwaita-core`; what
// this module adds is the NativeScript defaults and the "no size yet" case.
//
// Free of `@nativescript/core` value imports so the spec suite exercises the shipping
// code; `split-view-base.ts` `extends GridLayout` and is unresolvable off-device.
//
// Reference: refs/libadwaita/src/adw-overlay-split-view.c
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

/** What the renderer knows about the layout the width is being derived for. */
export interface SplitViewWidthContext {
    /** The content pane's own minimum width. */
    contentMin?: number;
    /** The sidebar child's own minimum width. */
    sidebarChildMin?: number;
    /**
     * Whether the view is collapsed. Overlay only, and not a detail: a COLLAPSED
     * `get_sidebar_width` IGNORES the fraction and clamps the VIEW width instead, so
     * on a 360 DIP phone GTK draws 280 where a fraction would give 180.
     */
    collapsed?: boolean;
}

/**
 * The sidebar width for a container of `totalWidth` DIPs.
 *
 * The two widgets genuinely differ: OVERLAY takes a final
 * `min(width, totalWidth - contentMin)` and never claims more than the view has left;
 * NAVIGATION folds that limit into the clamp's UPPER bound, where the LOWER bound can
 * still win — so it may exceed the view. A 100 DIP container with no content minimum
 * splits them: navigation answers 180 (its minimum), overlay answers 100.
 *
 * `collapsed` only reaches the overlay rule, because only the overlay has a collapsed
 * sidebar to size ({@link appliesDerivedSidebarWidth}).
 *
 * `totalWidth <= 0` means NativeScript has not laid the view out yet, so the MINIMUM
 * is returned rather than a fraction of nothing: the smallest thing libadwaita would
 * draw, so the first layout can only widen it, never jump down.
 */
export function sidebarWidthFor(
    totalWidth: number,
    props: SidebarWidthProps,
    rule: SplitViewWidthRule = 'overlay',
    context: SplitViewWidthContext = {},
): number {
    if (!(totalWidth > 0)) return Math.max(props.minSidebarWidth, 0);
    const input = {
        totalWidth,
        minSidebarWidth: props.minSidebarWidth,
        maxSidebarWidth: props.maxSidebarWidth,
        sidebarWidthFraction: props.sidebarWidthFraction,
        contentMin: context.contentMin ?? 0,
        sidebarChildMin: context.sidebarChildMin ?? 0,
    };
    if (rule === 'navigation') return resolveNavigationSidebarWidth(input);
    return resolveOverlaySidebarWidth({ ...input, collapsed: context.collapsed ?? false });
}

/**
 * Whether the sidebar pane takes a DERIVED width at all, or sizes itself.
 *
 * Exactly one case says no: a COLLAPSED navigation split view has no sidebar column,
 * its visible page fills the whole view, and NativeScript expresses that as
 * `width = 'auto'` spanning both columns. Writing a number over it snaps the
 * full-screen pane back to 180-280 DIP one frame after the collapse.
 *
 * The overlay is deliberately NOT exempt: its collapsed sidebar really is a
 * clamped-width overlay drawn above the content, so it still wants a number.
 */
export function appliesDerivedSidebarWidth(collapsed: boolean, rule: SplitViewWidthRule): boolean {
    return !(collapsed && rule === 'navigation');
}

/**
 * Normalise one width property. A non-finite or negative input falls back to the
 * DEFAULT rather than to zero, because a zero-width sidebar is indistinguishable from
 * a missing one on screen.
 */
export function normalizeWidthProp(value: number, fallback: number): number {
    return Number.isFinite(value) && value >= 0 ? value : fallback;
}

/** Clamp the fraction into the `[0, 1]` range its GTK property is declared with. */
export function normalizeWidthFraction(value: number): number {
    if (!Number.isFinite(value)) return DEFAULT_SIDEBAR_WIDTH_FRACTION;
    return Math.min(1, Math.max(0, value));
}
