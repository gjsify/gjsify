// `Gtk.Grid` for NativeScript — the pure half: how many tracks the children need, what gap
// a child carries, and what a spacing may be. No `@nativescript/core` import.
//
// A `GtkGrid` has no declared tracks: any `(column, row)` a child names exists. A
// NativeScript `GridLayout` is the opposite — it needs an `ItemSpec` per track and clamps a
// child whose index is past the last one into it (`ns-core.d.ts` records the measurement),
// so the widget derives the track list from where its children ARE and rebuilds it when one
// moves. That derivation is {@link gridTrackCounts}.
//
// THE GAP IS A MARGIN, AND IT IS ADDITIVE. `Style` carries no `columnGap` / `rowGap`
// (`box-layout.ts` records the measurement), and a spacer TRACK would have to renumber the
// children — but a child's `column` / `row` are the platform's own `col` / `row` properties,
// the very ones a `.blp`'s `layout { column: 1 }` writes, so renumbering would make them
// read back a value nobody wrote. So the gap goes on the leading edge of every child that has
// something before it, ON TOP of the margin the child already carries: {@link gridGap} is
// what a child is owed, and the widget swaps the previous share for the new one rather than
// overwriting the margin, which is the clobbering the pre-grid `Gtk.Box` did.
//
// WHAT IT DOES NOT DO: a column or row nothing occupies keeps its gap (GTK collapses the
// empty track and its spacing), and `baseline-row` has no counterpart.
//
// Reference: refs/gtk gtk/gtkgrid.c (GtkGrid), gtk/gtkgridlayout.c (GtkGridLayoutChild)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** Where one child sits: the four `GtkGridLayoutChild` properties. */
export interface GridPlacement {
    column: number;
    row: number;
    columnSpan: number;
    rowSpan: number;
}

/** `gtkgrid.c`'s spacing pspecs: `guint16`, `0 … 65535`. */
const MAX_SPACING = 0xffff;

/**
 * A `row-spacing` / `column-spacing`: an integer in `0 … 65535`, or throw. The setter parses
 * with `xmlNumber` (an attribute is always a string) and hands the result here with what was
 * written; a blank attribute keeps what was there.
 */
export function gridSpacing(parsed: number, written: unknown, current: number, property: string): number {
    if (typeof written === 'string' && written.trim() === '') return current;
    if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_SPACING) return parsed;
    throw new TypeError(
        `'${String(written)}' is not a spacing: '${property}' takes an integer from 0 to ${MAX_SPACING}.`,
    );
}

/**
 * How many columns and rows the placements need — one past the furthest edge any child
 * reaches, so a child at `column 3` makes four columns even when 0 … 2 are empty.
 */
export function gridTrackCounts(placements: readonly GridPlacement[]): { columns: number; rows: number } {
    let columns = 0;
    let rows = 0;
    for (const { column, row, columnSpan, rowSpan } of placements) {
        columns = Math.max(columns, column + columnSpan);
        rows = Math.max(rows, row + rowSpan);
    }
    return { columns, rows };
}

/**
 * The gap a child at `placement` carries on its LEADING edges: the column gap unless it sits
 * in the first column, the row gap unless it sits in the first row.
 */
export function gridGap(
    placement: Pick<GridPlacement, 'column' | 'row'>,
    columnSpacing: number,
    rowSpacing: number,
): { left: number; top: number } {
    return {
        left: placement.column > 0 ? columnSpacing : 0,
        top: placement.row > 0 ? rowSpacing : 0,
    };
}

/** The child, if any, whose cells include `(column, row)` — `gtk_grid_get_child_at`. */
export function gridChildAt<Child>(
    children: readonly { child: Child; placement: GridPlacement }[],
    column: number,
    row: number,
): Child | null {
    for (const { child, placement } of children) {
        const insideColumns = column >= placement.column && column < placement.column + placement.columnSpan;
        const insideRows = row >= placement.row && row < placement.row + placement.rowSpan;
        if (insideColumns && insideRows) return child;
    }
    return null;
}
