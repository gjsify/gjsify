// Selection vectors for the two child-holding GTK containers — `Gtk.ListBox` and
// `Gtk.FlowBox` (ADR 0089).
//
// WHAT EACH TABLE PINS DOWN, and the defect it exists for:
//
//   SELECT  One click on one row → the selection that follows. The rows that matter are the
//           four places this is NOT `listViewSelect`: `browse` (a mode the list base does not
//           have), single-mode `<Ctrl>`+click (which CLEARS here and is refused by
//           `GtkSingleSelection`), multiple-mode `<Shift>` (which keeps the ANCHOR, so a
//           second extend walks the range outward from the first click rather than from the
//           last), and multiple-mode plain click (which is a replace, not a toggle).
//   ROW     The PROGRAMMATIC `select_row`/`unselect_row`, kept apart from the click because
//           upstream keeps them apart: select is idempotent, unselect in a non-multiple box
//           clears the WHOLE box.
//   ALL     `select_all`/`unselect_all`, whose refusals are load-bearing — every mode but
//           `multiple` refuses select-all, and `browse` refuses unselect-all.
//
// The four vectors are driven from the core suite AND from both browser elements' specs with
// real clicks and real modifiers, so a renderer that re-implements the rules instead of
// delegating fails naming the input that drifted.
//
// Reference: refs/gtk/gtk/gtklistbox.c:958-996, :1711-1871
// Reference: refs/gtk/gtk/gtkflowbox.c:966-1131, :4766-4800
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import type { AdwBoxSelectResult, AdwBoxSelectionMode, AdwBoxSelectStep } from '../box-selection.js';

/** One click on one row, and what it must produce. */
export interface BoxSelectVector {
    /** The C branch this row pins down. */
    readonly rule: string;
    /** The selection the box held before the click. */
    readonly selection: readonly number[];
    /** `box->selected_row` before the click; `-1` is the C's NULL. */
    readonly anchor: number;
    /** Which row was clicked. */
    readonly position: number;
    /** How many rows the box holds. */
    readonly length: number;
    readonly mode: AdwBoxSelectionMode;
    /** The modifiers, and whether the row is `selectable` (`GtkListBoxRow:selectable`). */
    readonly step: AdwBoxSelectStep & { readonly selectable?: boolean };
    readonly expected: AdwBoxSelectResult;
}

export const BOX_SELECT_VECTORS: readonly BoxSelectVector[] = [
    {
        rule: 'a plain click in single mode replaces the selection and moves the anchor',
        selection: [1],
        anchor: 1,
        position: 3,
        length: 5,
        mode: 'single',
        step: {},
        expected: { selection: [3], anchor: 3 },
    },
    {
        // The difference from `listViewSelect`, which cites `gtk_single_selection_unselect_item`
        // refusing while `autoselect` is on (gtksingleselection.c:160-173): this box has no
        // selection model to ask, so Ctrl+click on the selected row CLEARS the selection and
        // the anchor goes with it.
        rule: 'Ctrl+click on the selected row in single mode clears the selection',
        selection: [2],
        anchor: 2,
        position: 2,
        length: 5,
        mode: 'single',
        step: { modify: true },
        expected: { selection: [], anchor: -1 },
    },
    {
        rule: 'Ctrl+click on an UNselected row in single mode just selects it',
        selection: [0],
        anchor: 0,
        position: 4,
        length: 5,
        mode: 'single',
        step: { modify: true },
        expected: { selection: [4], anchor: 4 },
    },
    {
        // `browse` is a mode `AdwListSelectionMode` has no word for, and the branch is not a
        // variation on single: there is no toggle, so Ctrl+click on the selected row keeps it.
        rule: 'browse selects the clicked row and has no toggle at all',
        selection: [1],
        anchor: 1,
        position: 1,
        length: 5,
        mode: 'browse',
        step: { modify: true },
        expected: { selection: [1], anchor: 1 },
    },
    {
        rule: 'none answers every click with no change, anchor included',
        selection: [],
        anchor: -1,
        position: 2,
        length: 5,
        mode: 'none',
        step: {},
        expected: { selection: [], anchor: -1 },
    },
    {
        // `gtk_list_box_update_selection_full` tests `selectable` AFTER the NONE branch, so
        // the row is left exactly as it was — and GTK cannot hold the clicked row selected
        // AND unselectable at once: `gtk_list_box_row_set_selectable` UNSELECTS the row as it
        // turns the flag off (gtklistbox.c:3697-3698). So the box opens on the OTHER row and
        // the branch still has something to prove: a click on an unselectable row moves
        // nothing, in the one mode where a click would otherwise have toggled.
        rule: 'an unselectable row is ignored, in every mode',
        selection: [0],
        anchor: 0,
        position: 2,
        length: 5,
        mode: 'multiple',
        step: { selectable: false },
        expected: { selection: [0], anchor: 0 },
    },
    {
        rule: 'Shift+click with no anchor selects the clicked row and anchors on it',
        selection: [],
        anchor: -1,
        position: 2,
        length: 6,
        mode: 'multiple',
        step: { extend: true },
        expected: { selection: [2], anchor: 2 },
    },
    {
        // `gtk_list_box_update_selection_full` :1846-1850 — the span is selected and the
        // anchor STAYS, which is what makes a second extend grow the range from the first
        // click instead of sliding it.
        rule: 'Shift+click from an anchor selects the span and keeps the anchor',
        selection: [],
        anchor: 1,
        position: 4,
        length: 6,
        mode: 'multiple',
        step: { extend: true },
        expected: { selection: [1, 2, 3, 4], anchor: 1 },
    },
    {
        rule: 'a backwards Shift+click selects the span in order',
        selection: [3, 4],
        anchor: 4,
        position: 1,
        length: 6,
        mode: 'multiple',
        step: { extend: true },
        expected: { selection: [1, 2, 3, 4], anchor: 4 },
    },
    {
        rule: 'Shift+click in single mode falls through to the plain path',
        selection: [1],
        anchor: 1,
        position: 3,
        length: 6,
        mode: 'single',
        step: { extend: true },
        expected: { selection: [3], anchor: 3 },
    },
    {
        rule: 'Ctrl+click in multiple mode toggles one row and keeps the anchor',
        selection: [0, 3],
        anchor: 3,
        position: 1,
        length: 5,
        mode: 'multiple',
        step: { modify: true },
        expected: { selection: [0, 1, 3], anchor: 3 },
    },
    {
        rule: 'Ctrl+click on a selected row in multiple mode removes only that row',
        selection: [0, 1, 3],
        anchor: 3,
        position: 1,
        length: 5,
        mode: 'multiple',
        step: { modify: true },
        expected: { selection: [0, 3], anchor: 3 },
    },
    {
        rule: 'a plain click in multiple mode replaces the selection outright',
        selection: [0, 1, 2],
        anchor: 2,
        position: 4,
        length: 5,
        mode: 'multiple',
        step: {},
        expected: { selection: [4], anchor: 4 },
    },
    {
        rule: 'a click past the end of the box is ignored',
        selection: [1],
        anchor: 1,
        position: 9,
        length: 5,
        mode: 'single',
        step: {},
        expected: { selection: [1], anchor: 1 },
    },
    {
        rule: 'a click on a negative index is ignored',
        selection: [1],
        anchor: 1,
        position: -1,
        length: 5,
        mode: 'multiple',
        step: {},
        expected: { selection: [1], anchor: 1 },
    },
];

/** One programmatic call, and what it must produce. */
export interface BoxRowVector {
    readonly rule: string;
    readonly op: 'select' | 'unselect';
    readonly selection: readonly number[];
    readonly anchor: number;
    readonly position: number | null;
    readonly length: number;
    readonly mode: AdwBoxSelectionMode;
    readonly step: AdwBoxSelectStep & { readonly selectable?: boolean };
    readonly expected: AdwBoxSelectResult;
}

export const BOX_ROW_VECTORS: readonly BoxRowVector[] = [
    {
        // `gtk_list_box_select_row_internal` :1735-1736 — the early return that separates the
        // programmatic call from the click. Without it `select_row` on a selected row would
        // CLEAR it in single mode, because the click's `!was_selected` is not here.
        rule: 'select_row on the already-selected row changes nothing',
        op: 'select',
        selection: [2],
        anchor: 2,
        position: 2,
        length: 5,
        mode: 'single',
        step: {},
        expected: { selection: [2], anchor: 2 },
    },
    {
        rule: 'select_row replaces the selection and moves the anchor',
        op: 'select',
        selection: [0],
        anchor: 0,
        position: 3,
        length: 5,
        mode: 'single',
        step: {},
        expected: { selection: [3], anchor: 3 },
    },
    {
        // The arm a replace-everywhere port gets wrong, and the one that decides whether a
        // `multiple` box can be built at all: `gtk_list_box_select_row_internal` clears the
        // box only where the mode is NOT multiple (gtklistbox.c:1741-1742) and then adds the
        // row, so two `select_row` calls leave BOTH rows selected — the same line as
        // `gtk_flow_box_select_child_internal` (gtkflowbox.c:1012-1030). `select_row` is how
        // `Gtk.ListBox` fills a multiple selection, so a version that replaced would cap a
        // `multiple` box at one row however many calls it took.
        rule: 'select_row in multiple mode ADDS to the selection and moves the anchor',
        op: 'select',
        selection: [0, 3],
        anchor: 3,
        position: 1,
        length: 5,
        mode: 'multiple',
        step: {},
        expected: { selection: [0, 1, 3], anchor: 1 },
    },
    {
        rule: "a null row is the C's unselect-everything, and clears the anchor",
        op: 'select',
        selection: [1, 3],
        anchor: 3,
        position: null,
        length: 5,
        mode: 'multiple',
        step: {},
        expected: { selection: [], anchor: -1 },
    },
    {
        rule: 'select_row on an unselectable row is ignored',
        op: 'select',
        selection: [0],
        anchor: 0,
        position: 2,
        length: 5,
        mode: 'single',
        step: { selectable: false },
        expected: { selection: [0], anchor: 0 },
    },
    {
        rule: 'unselect_row in multiple mode removes just that row',
        op: 'unselect',
        selection: [0, 2, 4],
        anchor: 4,
        position: 2,
        length: 5,
        mode: 'multiple',
        step: {},
        expected: { selection: [0, 4], anchor: 4 },
    },
    {
        // `gtk_list_box_unselect_row_internal` :1719-1720 — NOT a one-row removal outside
        // multiple mode. A port that narrowed to the row leaves a single-selection box with
        // several rows lit, which is unreachable by clicking.
        rule: 'unselect_row in single mode clears the WHOLE box',
        op: 'unselect',
        selection: [1, 2],
        anchor: 2,
        position: 1,
        length: 5,
        mode: 'single',
        step: {},
        expected: { selection: [], anchor: 2 },
    },
    {
        rule: 'unselect_row on an unselected row is ignored',
        op: 'unselect',
        selection: [1],
        anchor: 1,
        position: 3,
        length: 5,
        mode: 'multiple',
        step: {},
        expected: { selection: [1], anchor: 1 },
    },
];

/** One `select_all` / `unselect_all`, and what it must answer. */
export interface BoxAllVector {
    readonly rule: string;
    readonly op: 'select-all' | 'unselect-all';
    readonly selection: readonly number[];
    readonly length: number;
    readonly mode: AdwBoxSelectionMode;
    /** `null` is the refusal — the C emits nothing. */
    readonly expected: number[] | null;
}

export const BOX_ALL_VECTORS: readonly BoxAllVector[] = [
    {
        rule: 'select-all is refused by every mode but multiple',
        op: 'select-all',
        selection: [],
        length: 4,
        mode: 'single',
        expected: null,
    },
    {
        rule: 'select-all in browse is refused, because browse is not multi',
        op: 'select-all',
        selection: [1],
        length: 4,
        mode: 'browse',
        expected: null,
    },
    {
        rule: 'select-all in multiple selects every row',
        op: 'select-all',
        selection: [0],
        length: 4,
        mode: 'multiple',
        expected: [0, 1, 2, 3],
    },
    {
        // The C emits `selected-rows-changed` only when the box HAS children
        // (gtklistbox.c:966-970), so an empty box is a silent no-op.
        rule: 'select-all on an empty box changes nothing and says nothing',
        op: 'select-all',
        selection: [],
        length: 0,
        mode: 'multiple',
        expected: null,
    },
    {
        // :986-987 — `unselect_all` returns before there is any `dirty` to report, which is
        // what makes browse's "something is always selected" a property rather than a
        // convention.
        rule: 'unselect-all is refused in browse',
        op: 'unselect-all',
        selection: [1, 2],
        length: 4,
        mode: 'browse',
        expected: null,
    },
    {
        rule: 'unselect-all on an already-empty selection changes nothing',
        op: 'unselect-all',
        selection: [],
        length: 4,
        mode: 'multiple',
        expected: null,
    },
    {
        rule: 'unselect-all clears the selection in every other mode',
        op: 'unselect-all',
        selection: [0, 3],
        length: 4,
        mode: 'multiple',
        expected: [],
    },
];
