// Arrow-key arithmetic for a wrapping grid of items, headless.
//
// `GtkGridView` (and so `AdwTabOverview`'s thumbnail grid) moves a cursor in two
// dimensions: Left/Right step one item, Up/Down step one ROW, Home/End jump to the ends.
// The column count is a layout fact — the grid reflows with its width — so the caller
// measures it ({@link gridColumns}) and this stays pure.
//
// No wrap: stepping past an edge, or Down from a column the last row does not reach,
// returns `null` — the cursor stays, as `gtk_list_base` leaves it.
//
// Reference: refs/gtk/gtk/gtklistbase.c, refs/gtk/gtk/gtkgridview.c
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/**
 * How many items share the first row, from each item's top edge in visual order. Items
 * whose tops differ by at most `tolerance` are one row (sub-pixel layout rounds).
 * Always at least 1 for a non-empty grid, 0 for an empty one.
 */
export function gridColumns(tops: readonly number[], tolerance = 1): number {
    if (tops.length === 0) return 0;
    const first = tops[0]!;
    let columns = 1;
    while (columns < tops.length && Math.abs(tops[columns]! - first) <= tolerance) columns++;
    return columns;
}

/**
 * The index a key moves to, or `null` when the key is not a grid key or the move would
 * leave the grid. `columns` below 1 is treated as 1.
 */
export function gridNavigate(key: string, index: number, count: number, columns: number): number | null {
    if (count <= 0 || index < 0 || index >= count) return null;
    const cols = Math.max(1, Math.floor(columns));
    let to: number;
    switch (key) {
        case 'ArrowLeft':
            to = index - 1;
            break;
        case 'ArrowRight':
            to = index + 1;
            break;
        case 'ArrowUp':
            to = index - cols;
            break;
        case 'ArrowDown':
            to = index + cols;
            break;
        case 'Home':
            to = 0;
            break;
        case 'End':
            to = count - 1;
            break;
        default:
            return null;
    }
    if (to < 0 || to >= count || to === index) return null;
    return to;
}
