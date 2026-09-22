// `Gtk.Box` for NativeScript — the pure half: the gap, and where a child lands.
//
// TWO DECISIONS, AND NEITHER OF THEM IS A LAYOUT. A NativeScript `StackLayout` already
// stacks children along an axis, which is what `GtkBox` does; what it has no word for is
// the GAP between them (`Style` carries no `columnGap`/`rowGap`, the same absence
// `wrap-box-layout.ts` records one widget over), and it has no notion of GTK's
// `insert_after` child ORDER. Both are answered here so the spec suite can drive them
// off-device — the widget module cannot even be imported there, because `extends
// StackLayout` evaluates the bare `@nativescript/core` specifier at module eval
// (AGENTS.md).
//
// THE GAP IS EXACT HERE AND APPROXIMATE IN THE WRAP BOX, and the difference is worth
// stating because the two look like the same problem. `AdwWrapBox` puts HALF the spacing
// on every edge of every child, because a wrapping run has gaps on two axes and a child
// does not know whether it is first in its line. A `GtkBox` has one axis and one run, so
// the gap is the LEADING margin of every child but the first — `gtk_box` spacing to the
// pixel, with no outer inset and no cross-axis margin. That is the shape libadwaita's own
// `border-spacing` has, and it is reachable here only because the box does not wrap.
//
// A BOX OWNS ITS CHILDREN'S MARGINS, which is the one thing a caller has to know: the
// margin is written as NativeScript's four-value shorthand, so a margin the caller set on
// a child is replaced rather than added to. `AdwWrapBox` makes the same trade for the same
// reason (one write, no read-modify-write against a value NS resolves through CSS), and a
// caller who wants an inset puts a padding on the box or a wrapper around the child.
//
// PHYSICAL EDGES, NOT LOGICAL ONES. NativeScript's `Style` has `marginLeft`/`marginRight`
// and no `marginStart`/`marginEnd` — only ALIGNMENT is direction-relative there
// (`gtk-align.ts` records that measurement) — so a horizontal box's gap sits on the LEFT
// of each child and an RTL layout gets the gap on the wrong side of the run. Declared
// rather than mapped: there is no property to route the logical edge to.
//
// Reference: refs/gtk gtk/gtkbox.c (gtk_box_set_spacing, gtk_box_insert_child_after)
// Copyright (c) The GTK Team. LGPLv2.1+.

import {
    DEFAULT_BOX_SPACING,
    normalizeBoxSpacing,
    resolveWrapBoxChildOrder,
    type BoxOrientation,
} from '@gjsify/adwaita-core';

// The property readings are `@gjsify/adwaita-core`'s (`box.ts`), because the web box reads
// the same authored values; only the margin distribution below is this platform's.
export { DEFAULT_BOX_SPACING, normalizeBoxSpacing };
export type { BoxOrientation };

/** Whether writing `next` over `current` is a change the box must push to its children. */
export function boxSpacingChanges(current: number, next: unknown): boolean {
    return normalizeBoxSpacing(next) !== normalizeBoxSpacing(current);
}

/**
 * The margin shorthand that gives child `index` its share of the box's gap.
 *
 * `top right bottom left`, NativeScript's own order. The first child gets none: with N
 * children there are N−1 gaps, and putting the gap on the LEADING edge of every child but
 * the first is the only distribution that leaves the box's own bounds untouched.
 */
export function boxChildMargin(index: number, spacing: unknown, orientation: BoxOrientation): string {
    const gap = index <= 0 ? 0 : normalizeBoxSpacing(spacing);
    return orientation === 'vertical' ? `${gap} 0 0 0` : `0 0 0 ${gap}`;
}

/**
 * Where the child list ends up after an `insert_child_after` / `reorder_child_after`, or
 * `null` where C would have hit a `g_return_if_fail`.
 *
 * SHARED WITH THE WRAP BOX RATHER THAN COPIED, and the name is the wrap box's only
 * because that widget needed it first: the rule is `gtk_widget_insert_after`'s — a NULL
 * sibling means the FIRST position, not the last — and `gtk_box_insert_child_after`
 * documents itself by pointing at it. `resolveWrapBoxChildOrder` is generic over the
 * child type and pure, so the alternative was a second copy of one paragraph of GTK
 * semantics that could drift from the vectors already pinning it.
 */
export { resolveWrapBoxChildOrder as resolveBoxChildOrder };
