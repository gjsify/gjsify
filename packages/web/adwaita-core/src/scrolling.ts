// GtkScrolledWindow's two edge indicators — headless (ADR 0004).
//
// They are routinely conflated, because both are a shade at a scrollport edge and
// the stylesheet declares them ten lines apart. They answer opposite questions,
// and a renderer that paints one gradient for both gets the common case exactly
// backwards — a permanent hairline under every header bar:
//
// - UNDERSHOOT — "there IS content past this edge". Constant size, keyed on a
//   BOOLEAN: `value > lower` for the top edge, `value < upper - page_size` for the
//   bottom (`gtk_scrolled_window_snapshot_undershoot`). At rest against the top it
//   is not drawn at all, which is what makes a flat header bar read as one surface
//   with the content under it.
// - OVERSHOOT — "there is NOTHING past this edge". A glow whose SIZE is how far
//   past the edge the user pushed, capped at {@link ADW_MAX_OVERSHOOT_DISTANCE},
//   springing back once the scroll stops (`gtk_scrolled_window_snapshot_overshoot`).
//
// The overshoot arithmetic runs on an UNCLAMPED adjustment value: the scroll
// position keeps accumulating past the edge (bounded by a hard clamp, with no
// rubber-band damping — `_gtk_scrolled_window_set_adjustment_value`), and the
// overshoot is the difference between that and the real position. A renderer that
// only ever sees the clamped position — every browser scroll container, for one —
// has to keep the unclamped value itself; {@link accumulateOvershoot} is that
// bookkeeping.
//
// Reference: refs/gtk/gtk/gtkscrolledwindow.c (snapshot_undershoot, snapshot_overshoot,
//   _gtk_scrolled_window_get_overshoot, _gtk_scrolled_window_set_adjustment_value)
// Reference: refs/libadwaita/src/stylesheet/widgets/_scrolling.scss
// Reference: refs/libadwaita/src/stylesheet/_drawing.scss (undershoot/overshoot mixins)
// Copyright (c) GNOME contributors (GTK, libadwaita). LGPLv2.1+.

/**
 * `UNDERSHOOT_SIZE` — the band the undershoot node is allocated, in px.
 *
 * Larger than what is visible on purpose: the gradient over it fades out after 4px,
 * so the band is mostly transparent. A renderer sizing the element to the visible
 * 4px would be describing the gradient, not the node.
 */
export const ADW_UNDERSHOOT_SIZE = 40;

/** `MAX_OVERSHOOT_DISTANCE` — how far past an edge the position may travel, in px. */
export const ADW_MAX_OVERSHOOT_DISTANCE = 100;

/**
 * The idle gap after which a non-smooth scroll starts decelerating, in ms.
 *
 * `scrolled_window_scroll` arms this timeout on every wheel event that left an
 * overshoot standing, so the spring-back happens once the wheel STOPS rather than
 * between two detents of the same gesture.
 */
export const ADW_OVERSHOOT_SETTLE_MS = 50;

/** One axis of a `GtkAdjustment`, as a scrollport reports it. */
export interface ScrollAdjustment {
    /** `gtk_adjustment_get_value` — the current scroll position. */
    value: number;
    /** `gtk_adjustment_get_lower` — the position of the start edge, normally 0. */
    lower: number;
    /** `gtk_adjustment_get_upper` — the full content length. */
    upper: number;
    /** `gtk_adjustment_get_page_size` — the visible length. */
    pageSize: number;
}

/** The highest position an adjustment can hold — `upper - page_size`. */
export function scrollMaxValue(adjustment: ScrollAdjustment): number {
    return adjustment.upper - adjustment.pageSize;
}

/** Whether content is hidden BEFORE the current position, i.e. `value > lower`. */
export function isScrolledFromStart(adjustment: ScrollAdjustment): boolean {
    return adjustment.value > adjustment.lower;
}

/** Whether content is hidden AFTER the current position, i.e. `value < upper - page_size`. */
export function isScrolledFromEnd(adjustment: ScrollAdjustment): boolean {
    return adjustment.value < scrollMaxValue(adjustment);
}

/** The four undershoot classes a scroller owns, so a renderer can clear them. */
export const ADW_UNDERSHOOT_CLASSES: ReadonlyArray<string> = [
    'undershoot-top',
    'undershoot-bottom',
    'undershoot-start',
    'undershoot-end',
];

/** The adjustments of a scroller, either axis optional (an axis that cannot scroll). */
export interface ScrollAdjustments {
    /** The vertical axis — drives `undershoot-top` / `undershoot-bottom`. */
    vertical?: ScrollAdjustment;
    /** The horizontal axis — drives `undershoot-start` / `undershoot-end`. */
    horizontal?: ScrollAdjustment;
}

/**
 * Which undershoot indicators a scroller shows at its current position.
 *
 * The horizontal pair is named start/end rather than left/right because the
 * stylesheet resolves them per text direction (`_scrolling.scss:158-166`); the
 * arithmetic is direction-blind, which is why it lives here and the flip lives in
 * CSS.
 */
export function scrollUndershootClasses(adjustments: ScrollAdjustments): string[] {
    const classes: string[] = [];
    const { vertical, horizontal } = adjustments;
    if (vertical) {
        if (isScrolledFromStart(vertical)) classes.push('undershoot-top');
        if (isScrolledFromEnd(vertical)) classes.push('undershoot-bottom');
    }
    if (horizontal) {
        if (isScrolledFromStart(horizontal)) classes.push('undershoot-start');
        if (isScrolledFromEnd(horizontal)) classes.push('undershoot-end');
    }
    return classes;
}

/**
 * `_gtk_scrolled_window_get_overshoot` for one axis: how far the unclamped position
 * lies past an edge.
 *
 * Signed — negative past the start edge, positive past the end edge, `0` in range —
 * so one number carries both which edge glows and how much.
 */
export function overshootDistance(unclamped: number, adjustment: ScrollAdjustment): number {
    const max = scrollMaxValue(adjustment);
    if (unclamped < adjustment.lower) return unclamped - adjustment.lower;
    if (unclamped > max) return unclamped - max;
    return 0;
}

/**
 * `_gtk_scrolled_window_set_adjustment_value`: advance the unclamped position by a
 * scroll delta, held within one overshoot distance of either edge.
 *
 * A hard CLAMP, not a spring: upstream damps nothing on the way out, so pushing
 * twice as hard past the edge does not glow twice as far — it stops at
 * {@link ADW_MAX_OVERSHOOT_DISTANCE} and stays there until the gesture ends.
 */
export function accumulateOvershoot(unclamped: number, delta: number, adjustment: ScrollAdjustment): number {
    const lower = adjustment.lower - ADW_MAX_OVERSHOOT_DISTANCE;
    const upper = scrollMaxValue(adjustment) + ADW_MAX_OVERSHOOT_DISTANCE;
    return Math.min(Math.max(unclamped + delta, lower), upper);
}
