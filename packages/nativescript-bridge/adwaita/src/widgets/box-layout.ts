// `Gtk.Box` for NativeScript — the pure half: the tracks along the box's axis, and where a
// child lands in the child order.
//
// A `GtkBox` IS A ONE-AXIS GRID HERE, not a `StackLayout`: that measures every child at its
// natural size along the axis, so it has no spare space to hand to a child that asks for it
// (`hexpand` / `vexpand`) and no equal-share mode (`homogeneous`). A `GridLayout` has both
// as track kinds — `*` shares whatever is left, `auto` is the natural size — and a `pixel`
// track is the gap `Style` has no property for (`Style` carries no `columnGap`/`rowGap`, the
// same absence `wrap-box-layout.ts` records one widget over). So the widget plans a track
// list from its children ({@link boxTrackPlan}) and puts child `i` in track `2 * i`.
//
// WHAT IS EXACT AND WHAT IS NOT. The gap is exact: N children have N−1 gaps and the box's own
// bounds are untouched. The spare space is shared in equal weights, which is what GTK does
// for expanding children of equal weight; GTK also lets an expanding DESCENDANT make its
// ancestor expand (`compute_expand`), and this does not — only a child's own flag counts, so
// a `Gtk.Box` that holds the expanding widget must itself say `vexpand`. `homogeneous` is
// `*` tracks for everyone, which is equal but not minimal: GTK gives every child the size of
// the largest, and `*` gives every child an equal share of what the box was given.
//
// Both decisions are answered here, free of `@nativescript/core`, so the spec suite can drive
// them off-device — the widget module cannot even be imported there, because it extends
// `GridLayout`, which evaluates the bare `@nativescript/core` specifier at module eval
// (AGENTS.md). The child ORDER (`gtk_widget_insert_after`'s NULL-means-first rule) is the
// other.
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

/** One track of the box's main axis: how the `GridLayout` is told to size it. */
export interface BoxTrack {
    unit: 'auto' | 'star' | 'pixel';
    value: number;
}

/**
 * The tracks along a box's main axis, for children whose expand flags are `expands`.
 *
 * Child `i` lives in track `2 * i` ({@link boxChildTrack}) and a `pixel` gap track sits
 * between every two children, so N children have N−1 gaps and the box's own bounds are
 * untouched. A child that expands — or every child, when `homogeneous` — gets a `*` track and
 * the spare space is shared between them equally, which is `gtk_box_distribute_extra_space`'s
 * rule for equal weights; every other child is `auto`, its natural size.
 *
 * THE GAP IS A TRACK, NOT A MARGIN. This was the leading-edge margin of every child but the
 * first, written with `view.set('margin', …)` — which REPLACED the child's own margin on all
 * four edges, so a `margin-top: 12` authored on a child of a box vanished the moment the box
 * adopted it. A track leaves the child's margins alone.
 */
export function boxTrackPlan(expands: readonly boolean[], spacing: unknown, homogeneous: boolean): BoxTrack[] {
    const gap = normalizeBoxSpacing(spacing);
    const tracks: BoxTrack[] = [];
    for (const [index, expand] of expands.entries()) {
        if (index > 0) tracks.push({ unit: 'pixel', value: gap });
        tracks.push({ unit: homogeneous || expand ? 'star' : 'auto', value: 1 });
    }
    return tracks;
}

/** The track child `index` lives in — the even ones; the odd ones are the gaps. */
export function boxChildTrack(index: number): number {
    return index * 2;
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
