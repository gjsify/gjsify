// Grid arrow-key conformance vectors — the spec every renderer is held to.
//
// One fixed geometry, three columns and seven items, so a renderer can lay out a real grid
// of that shape and replay every row against it:
//
//     0 1 2
//     3 4 5
//     6
//
// `to: null` is "the cursor stays": an edge, or Down from a column the last row does not
// reach. The key is still claimed — a browser's own Down would scroll the page.
//
// The rows are what `GtkGridView` does by reading `gtk_list_base_move_cursor`, not values
// measured out of a running GTK; a change to them is a claim about GTK to be re-checked.
//
// Reference: refs/gtk/gtk/gtklistbase.c, refs/gtk/gtk/gtkgridview.c
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

/** The geometry every row below is stated against. */
export const GRID_NAVIGATION_GEOMETRY = { count: 7, columns: 3 } as const;

export interface GridNavigationVector {
    key: string;
    from: number;
    /** The index the cursor lands on, `null` when it stays. */
    to: number | null;
}

export const GRID_NAVIGATION_VECTORS: readonly GridNavigationVector[] = [
    { key: 'ArrowRight', from: 1, to: 2 },
    { key: 'ArrowLeft', from: 1, to: 0 },
    // Linear in reading order: Right at a row's end lands on the next row's first item.
    { key: 'ArrowRight', from: 2, to: 3 },
    { key: 'ArrowLeft', from: 0, to: null },
    { key: 'ArrowRight', from: 6, to: null },
    { key: 'ArrowDown', from: 1, to: 4 },
    { key: 'ArrowUp', from: 4, to: 1 },
    { key: 'ArrowUp', from: 2, to: null },
    { key: 'ArrowDown', from: 4, to: null },
    { key: 'ArrowDown', from: 6, to: null },
    { key: 'Home', from: 5, to: 0 },
    { key: 'Home', from: 0, to: null },
    { key: 'End', from: 1, to: 6 },
    { key: 'End', from: 6, to: null },
];
