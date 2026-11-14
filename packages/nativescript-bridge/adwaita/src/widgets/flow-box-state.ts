// Gtk.FlowBox — the pure half: the counts, and what each child gets from them.
//
// No `@nativescript/core` imports, so a spec runs off-device.
//
// Reference: refs/gtk gtk/gtkflowbox.c (GtkFlowBox)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** `Gtk.FlowBox:max-children-per-line` default (gtkflowbox.c, `DEFAULT_MAX_CHILDREN_PER_LINE`). */
export const DEFAULT_MAX_CHILDREN_PER_LINE = 7;

/** `Gtk.FlowBox:min-children-per-line` default. */
export const DEFAULT_MIN_CHILDREN_PER_LINE = 0;

/** The largest count the platform's `guint` property takes (`G_MAXINT`). */
const MAX_COUNT = 2147483647;

/**
 * A `min-` / `max-children-per-line`: an integer from `lowest` to `G_MAXINT`, or throw. A blank
 * attribute keeps what was there; the count has no unit, so `"3px"` is not one.
 */
export function flowBoxCount(
    parsed: number,
    written: unknown,
    current: number,
    property: string,
    lowest: number,
): number {
    if (typeof written === 'string' && written.trim() === '') return current;
    if (Number.isInteger(parsed) && parsed >= lowest && parsed <= MAX_COUNT) return parsed;
    throw new TypeError(
        `'${String(written)}' is not a count: '${property}' takes an integer from ${lowest} to ${MAX_COUNT}.`,
    );
}

/** What one child of a flow box is given. */
export interface FlowBoxChildPlan {
    /** Break the line before this child, so a line never holds more than `max-children-per-line`. */
    wrapBefore: boolean;
    /** Whether the child absorbs the leftover space of its line. */
    grow: number;
}

/**
 * The plan for every child, read off the whole set.
 *
 * A line holds at most `max` children, which flexbox has no word for — only a forced break
 * before every `max`-th child says it. A homogeneous box gives every child the same grow, so a
 * line's children share it equally; otherwise only a child that asked for the space (`hexpand`)
 * takes any.
 */
export function flowBoxPlan(expands: readonly boolean[], max: number, homogeneous: boolean): FlowBoxChildPlan[] {
    return expands.map((expand, index) => ({
        wrapBefore: index > 0 && index % max === 0,
        grow: homogeneous || expand ? 1 : 0,
    }));
}

/** The margin each facing edge carries: half a gap, so two neighbours add up to the whole gap. */
export function flowBoxGap(
    columnSpacing: number,
    rowSpacing: number,
): {
    left: number;
    top: number;
    right: number;
    bottom: number;
} {
    return {
        left: columnSpacing / 2,
        right: columnSpacing / 2,
        top: rowSpacing / 2,
        bottom: rowSpacing / 2,
    };
}
