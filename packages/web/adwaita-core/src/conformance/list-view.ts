// List-view conformance vectors — the selection, column and sort rules every view surface
// is held to (ADR 0089).
//
// Unlike `list.ts` beside it, these rows ARE derived from the C: `refs/gtk` exists in the
// documentation worktree this package was ported in, and each table names the function it
// was read from. That is the difference between pinning a behaviour and pinning this
// package's current answer.
//
// WHAT EACH TABLE PINS DOWN, and the defect it exists for:
//
//   SELECT    a SEQUENCE of clicks, not a single step, so the table is drivable by a
//             renderer: the anchor a `<Shift>` extends from is `gtk_list_base_select_item`'s
//             private tracker and no surface publishes it, so a row that handed one in
//             could be asserted at the core and nowhere else. Each row starts from a fresh
//             view, which is also how a reader reproduces it by hand.
//   COLUMNS   `gtk_grid_view_compute_n_columns`, including the two things that look like
//             slips and are not: the spacing added to BOTH sides of the division (so the
//             last column needs no trailing gap) and `CLAMP (n, min, max)` evaluated in
//             that order, which answers `min` when `max` is below it.
//   SORT      `gtk_column_view_sorter_add_column`'s one rule — a second click on the
//             primary column inverts it, any other click makes that column primary and
//             ascending — plus the refusal of a column with no sorter.
//
// Reference: refs/gtk/gtk/gtklistbase.c:374-446, gtksingleselection.c:148-173
// Reference: refs/gtk/gtk/gtkgridview.c:619-641, 1147-1167
// Reference: refs/gtk/gtk/gtkcolumnviewsorter.c:294-344
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import type { AdwColumnViewSort, AdwListSelectionMode } from '../list-view.js';

/** One click on a row, with the two modifiers GTK reads off the event. */
export interface ListViewClick {
    /** The row that was clicked. */
    readonly position: number;
    /** `<Ctrl>` — toggle rather than replace. */
    readonly modify?: boolean;
    /** `<Shift>` — extend from the anchor. */
    readonly extend?: boolean;
}

/** One selection scenario: a fresh view of `length` rows, then these clicks. */
export interface ListViewSelectVector {
    /** What the row establishes, in one sentence. */
    readonly rule: string;
    /** Which `Gtk.SelectionModel` the view behaves as. */
    readonly mode: AdwListSelectionMode;
    /** How many items the model holds. */
    readonly length: number;
    /** The clicks, in order, from an empty selection. */
    readonly clicks: readonly ListViewClick[];
    /** The positions selected afterwards, ascending. */
    readonly selection: readonly number[];
}

export const LIST_VIEW_SELECT_VECTORS: readonly ListViewSelectVector[] = [
    {
        rule: 'a plain click selects exclusively',
        mode: 'single',
        length: 4,
        clicks: [{ position: 1 }, { position: 3 }],
        selection: [3],
    },
    {
        rule: 'a position the model does not have is ignored',
        mode: 'single',
        length: 4,
        clicks: [{ position: 1 }, { position: 9 }],
        selection: [1],
    },
    {
        rule: 'GtkNoSelection answers every click with nothing selected',
        mode: 'none',
        length: 4,
        clicks: [{ position: 2 }, { position: 0, modify: true }],
        selection: [],
    },
    {
        rule: 'Ctrl+click adds a row in multiple mode',
        mode: 'multiple',
        length: 4,
        clicks: [{ position: 0 }, { position: 2, modify: true }],
        selection: [0, 2],
    },
    {
        rule: 'Ctrl+click removes a selected row in multiple mode',
        mode: 'multiple',
        length: 4,
        clicks: [{ position: 0 }, { position: 2, modify: true }, { position: 0, modify: true }],
        selection: [2],
    },
    {
        // gtk_single_selection_unselect_item refuses while `autoselect` is on, and it
        // defaults TRUE — so the row the user Ctrl+clicked stays selected.
        rule: 'Ctrl+click on the selected row leaves it selected in single mode',
        mode: 'single',
        length: 4,
        clicks: [{ position: 1 }, { position: 1, modify: true }],
        selection: [1],
    },
    {
        rule: 'Ctrl+click on another row moves the single selection',
        mode: 'single',
        length: 4,
        clicks: [{ position: 1 }, { position: 3, modify: true }],
        selection: [3],
    },
    {
        rule: 'Shift+click selects the span from the anchor and drops the rest',
        mode: 'multiple',
        length: 4,
        clicks: [{ position: 0 }, { position: 2, extend: true }],
        selection: [0, 1, 2],
    },
    {
        rule: 'the span runs backwards from the anchor too',
        mode: 'multiple',
        length: 4,
        clicks: [{ position: 3 }, { position: 1, extend: true }],
        selection: [1, 2, 3],
    },
    {
        // The anchor's state decides the whole span, which is how a Ctrl+Shift drag can
        // CLEAR a run rather than only ever growing one.
        rule: 'Ctrl+Shift extends with the anchor state, clearing a run from an unselected anchor',
        mode: 'multiple',
        length: 4,
        clicks: [{ position: 1 }, { position: 3, extend: true }, { position: 0, modify: true }],
        selection: [0, 1, 2, 3],
    },
    {
        // GtkSingleSelection has no `select_range`, so the C's range branch fails and the
        // single-item path runs — Shift+click MOVES the selection rather than doing nothing.
        rule: 'Shift+click in single mode falls through to a plain selection',
        mode: 'single',
        length: 4,
        clicks: [{ position: 0 }, { position: 3, extend: true }],
        selection: [3],
    },
    {
        rule: 'the anchor follows the last accepted click, so a later extend starts there',
        mode: 'multiple',
        length: 5,
        clicks: [{ position: 0 }, { position: 3 }, { position: 4, extend: true }],
        selection: [3, 4],
    },
];

/** One column-count scenario — the four inputs `gtk_grid_view_compute_n_columns` takes. */
export interface GridViewColumnVector {
    /** What the row establishes, in one sentence. */
    readonly rule: string;
    /** The size available along the reflow axis, in px. */
    readonly forSize: number;
    /** One item's size along the same axis, in px. */
    readonly itemSize: number;
    /** The gap between two items, in px. */
    readonly spacing: number;
    /** `GtkGridView:min-columns`. */
    readonly minColumns: number;
    /** `GtkGridView:max-columns`. */
    readonly maxColumns: number;
    /** How many columns the view lays out. */
    readonly columns: number;
}

export const GRID_VIEW_COLUMN_VECTORS: readonly GridViewColumnVector[] = [
    {
        rule: 'the available size divided by the item size, rounding down',
        forSize: 400,
        itemSize: 100,
        spacing: 0,
        minColumns: 1,
        maxColumns: 7,
        columns: 4,
    },
    {
        rule: 'one pixel short of a column is one column fewer',
        forSize: 399,
        itemSize: 100,
        spacing: 0,
        minColumns: 1,
        maxColumns: 7,
        columns: 3,
    },
    {
        // Three 100px items with 12px gaps measure 324px, and the C's spacing on both sides
        // of the division is what makes 324 fit exactly three.
        rule: 'the spacing counts BETWEEN items only, so the last column needs no trailing gap',
        forSize: 324,
        itemSize: 100,
        spacing: 12,
        minColumns: 1,
        maxColumns: 7,
        columns: 3,
    },
    {
        rule: 'one pixel short of that is two columns',
        forSize: 323,
        itemSize: 100,
        spacing: 12,
        minColumns: 1,
        maxColumns: 7,
        columns: 2,
    },
    {
        rule: 'a wide view is capped at max-columns',
        forSize: 4000,
        itemSize: 100,
        spacing: 0,
        minColumns: 1,
        maxColumns: 7,
        columns: 7,
    },
    {
        rule: 'a narrow view is floored at min-columns, cramped rather than reflowed',
        forSize: 50,
        itemSize: 100,
        spacing: 0,
        minColumns: 2,
        maxColumns: 7,
        columns: 2,
    },
    {
        // CLAMP (n, min, max) evaluated in that order: the floor is applied last, so `min`
        // wins at a narrow size and `max` at a wide one. The ParamSpec documents one side
        // of this ("if max is smaller than min, that value is used instead").
        rule: 'with max below min, a narrow view answers min',
        forSize: 50,
        itemSize: 100,
        spacing: 0,
        minColumns: 4,
        maxColumns: 2,
        columns: 4,
    },
    {
        rule: 'with max below min, a wide view answers min too',
        forSize: 4000,
        itemSize: 100,
        spacing: 0,
        minColumns: 4,
        maxColumns: 2,
        columns: 4,
    },
    {
        // The C asserts the result is positive, and `MAX (1, …)` in the denominator is what
        // keeps a zero-measuring item from dividing by zero.
        rule: 'an item that measures nothing does not divide by zero',
        forSize: 400,
        itemSize: 0,
        spacing: 0,
        minColumns: 1,
        maxColumns: 7,
        columns: 7,
    },
];

/** One header click: the sort before it, the column clicked, the sort after. */
export interface ColumnViewSortVector {
    /** What the row establishes, in one sentence. */
    readonly rule: string;
    /** The sort in force before the click. */
    readonly current: AdwColumnViewSort | null;
    /** The clicked column's id. */
    readonly column: string;
    /** Whether that column declares a sorter at all. */
    readonly sortable: boolean;
    /** The sort in force afterwards. */
    readonly next: AdwColumnViewSort | null;
}

export const COLUMN_VIEW_SORT_VECTORS: readonly ColumnViewSortVector[] = [
    {
        rule: 'a first click sorts the column ascending',
        current: null,
        column: 'name',
        sortable: true,
        next: { column: 'name', descending: false },
    },
    {
        rule: 'a second click on the primary column inverts it',
        current: { column: 'name', descending: false },
        column: 'name',
        sortable: true,
        next: { column: 'name', descending: true },
    },
    {
        rule: 'a third click inverts it back rather than clearing the sort',
        current: { column: 'name', descending: true },
        column: 'name',
        sortable: true,
        next: { column: 'name', descending: false },
    },
    {
        rule: 'a click on another column makes that one primary, ascending',
        current: { column: 'name', descending: true },
        column: 'code',
        sortable: true,
        next: { column: 'code', descending: false },
    },
    {
        // `sorter == NULL` returns FALSE before anything is written, so the sort in force
        // is untouched — not cleared.
        rule: 'a column with no sorter leaves the sort exactly as it was',
        current: { column: 'name', descending: false },
        column: 'code',
        sortable: false,
        next: { column: 'name', descending: false },
    },
];
