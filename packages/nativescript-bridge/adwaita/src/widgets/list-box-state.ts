// `Gtk.ListBox` for NativeScript — the pure half: `Gtk.SelectionMode`, and what a tap or a
// mode change does to the set of selected rows. No `@nativescript/core` import.
//
// `Gtk.SelectionMode` is a list in declaration order, so a position IS the GIR constant
// (`GtkSelectionMode.multiple` is 3 in `generated/enum-values.mts`), held by arm 8 of
// `check-nativescript-xml-doors.mjs`; a number from a GJS snippet resolves by index and a word
// that is not a member is refused naming the members.
//
// Reference: refs/gtk gtk/gtklistbox.c (gtk_list_box_set_selection_mode, row selection)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { transitionNick } from './transition-type.js';

export const GTK_SELECTION_MODES = ['none', 'single', 'browse', 'multiple'] as const;

export type GtkSelectionModeNick = (typeof GTK_SELECTION_MODES)[number];

/** `GtkListBox:selection-mode` default. */
export const DEFAULT_LIST_SELECTION_MODE: GtkSelectionModeNick = 'single';

/** The selection mode a write means — a nick or the constant — or throw naming the members. */
export function selectionMode(value: unknown): GtkSelectionModeNick {
    return transitionNick(value, GTK_SELECTION_MODES, 'Gtk.SelectionMode');
}

/**
 * The rows selected after `row` was tapped.
 *
 * `none` selects nothing; `single` and `browse` select the tapped row and drop the rest
 * (`browse` additionally never lets the last one go, which a tap cannot do anyway);
 * `multiple` toggles it, which is what a click on an already-selected row does there.
 */
export function selectionAfterTap<Row>(mode: GtkSelectionModeNick, selected: readonly Row[], row: Row): Row[] {
    switch (mode) {
        case 'none':
            return [];
        case 'multiple':
            return selected.includes(row) ? selected.filter((held) => held !== row) : [...selected, row];
        default:
            return [row];
    }
}

/**
 * The rows still selected after the mode changed — `gtk_list_box_set_selection_mode` drops
 * every selection for `none`, and for a mode that holds one row when several were selected.
 */
export function selectionAfterModeChange<Row>(mode: GtkSelectionModeNick, selected: readonly Row[]): Row[] {
    if (mode === 'none') return [];
    if (mode !== 'multiple' && selected.length > 1) return [];
    return [...selected];
}
