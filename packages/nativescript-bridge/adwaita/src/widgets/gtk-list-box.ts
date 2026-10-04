// GtkListBox — a vertical list of rows that can be selected and activated, for NativeScript.
//
// A REAL `GridLayout`: one star column and one `auto` row per child, so the rows stack as a
// vertical list and each takes its natural height. The rows are the children — a
// `GtkListBox` wraps every child in an implicit `GtkListBoxRow`, and here the port's own
// rows (`Adw.ActionRow` and its siblings) and plain widgets are the rows directly, which is
// what a `Gtk.ListBox { Adw.ActionRow … }` template builds.
//
// ACTIVATION. A port row emits `activated` itself when it is activatable and tapped; a plain
// widget has no such event, so a tap on it activates it. Either way the list emits
// `row-activated` with the row — GJS's `(box, row)` handler gets the list first and `data.row`.
// `activate-on-single-click` is held and read back: the port's rows activate on the first tap
// and a row cannot be told to wait for a second.
//
// SELECTION is `selection-mode` + `list-box-state.ts`'s rules, painted as the
// `adw-list-row-selected` class. The `boxed-list` look is a style class the template gives it
// (`styles ["boxed-list"]`); the first row is flagged `adw-row-flush-top` so the card's rounded
// corner does not show the separator the rows carry above themselves, as `AdwPreferencesGroup`
// does.
//
// `show-separators` and `accept-unpaired-release` are held and read back and draw nothing:
// the separators a boxed list draws are the rows' own borders. `set_header_func`,
// `set_filter_func`, `set_sort_func`, `bind_model` and `drag_highlight_row` have no
// counterpart.
//
// Reference: refs/gtk gtk/gtklistbox.c (GtkListBox)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout, ItemSpec, type EventData, type View } from '@nativescript/core';

import { ACTIVATED } from './adw-action-row.js';
import { addMarkerClass, removeMarkerClass } from './bottom-sheet-state.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import {
    DEFAULT_LIST_SELECTION_MODE,
    type GtkSelectionModeNick,
    selectionAfterModeChange,
    selectionAfterTap,
    selectionMode,
} from './list-box-state.js';
import { AdwStyledLayoutBase } from './styled-layout-base.js';
import { xmlBoolean } from './xml-values.js';

/** `GtkListBox::row-activated`, payload `{ row }`. */
export const LIST_BOX_ROW_ACTIVATED = 'row-activated';

/** `GtkListBox::row-selected`, payload `{ row }` — the first selected row, or `null`. */
export const LIST_BOX_ROW_SELECTED = 'row-selected';

/** The class a selected row wears. */
export const LIST_ROW_SELECTED_CLASS = 'adw-list-row-selected';

/** The class the first row wears so its top separator stays inside the rounded card. */
const FLUSH_TOP_CLASS = 'adw-row-flush-top';

/** What `row-activated` / `row-selected` carry beside the usual event fields. */
export interface ListBoxRowEventData extends EventData {
    row: View | null;
}

/** What a row stops listening to when it leaves the list. */
interface RowListeners {
    tap: () => void;
    activated: () => void;
}

/**
 * Put `marker` on a row's `className`, or take it off — writing only when that changes it, so
 * a classless row (`className` is `undefined`, not `''`) stays classless until it needs one.
 */
function markRow(row: View, marker: string, on: boolean): void {
    const next = on ? addMarkerClass(row.className, marker) : removeMarkerClass(row.className, marker);
    if (next !== (row.className ?? '')) row.className = next;
}

export class GtkListBox extends AdwStyledLayoutBase {
    private _selectionMode: GtkSelectionModeNick = DEFAULT_LIST_SELECTION_MODE;
    private _activateOnSingleClick = true;
    private _showSeparators = false;
    private _acceptUnpairedRelease = false;
    private _selected: View[] = [];
    private readonly _listeners = new Map<View, RowListeners>();

    constructor(props?: ConstructProps<GtkListBox>) {
        super();
        this.addColumn(new ItemSpec(1, 'star'));
        applyConstructProps(this, props);
    }

    // --- rows ---

    /** Add a row at the end — `gtk_list_box_append`. */
    append(row: View): void {
        this.addChild(row);
    }

    /** Add a row at the start — `gtk_list_box_prepend`. */
    prepend(row: View): void {
        this.insert(row, 0);
    }

    /** Add a row at `position`; a negative or too-large one appends — `gtk_list_box_insert`. */
    insert(row: View, position: number): void {
        const count = this.getChildrenCount();
        if (position < 0 || position >= count) {
            this.addChild(row);
            return;
        }
        this.insertChild(row, position);
    }

    /** `gtk_list_box_remove`. */
    remove(row: View): void {
        this.removeChild(row);
    }

    /** `gtk_list_box_remove_all`. */
    remove_all(): void {
        for (const row of this._rowViews()) this.removeChild(row);
    }

    /** `gtk_list_box_get_row_at_index`, or `null` past either end. */
    get_row_at_index(index: number): View | null {
        return this._rowViews()[index] ?? null;
    }

    /** Every path a row can enter by ends here, so the rows are numbered here. */
    addChild(view: View): void {
        super.addChild(view);
        this._adopt(view);
    }

    insertChild(child: View, atIndex: number): void {
        super.insertChild(child, atIndex);
        this._adopt(child);
    }

    removeChild(view: View): void {
        this._release(view);
        super.removeChild(view);
        this._renumber();
    }

    /** XML inflation — every child is a row, whatever slot it names. */
    _addChildFromBuilder(_name: string, view: View): void {
        this.append(view);
    }

    // --- selection ---

    /** `gtk_list_box_get_selected_row` — the first selected row, or `null`. */
    get_selected_row(): View | null {
        return this._selected[0] ?? null;
    }

    /** `gtk_list_box_get_selected_rows`, in list order. */
    get_selected_rows(): View[] {
        return this._rowViews().filter((row) => this._selected.includes(row));
    }

    /** `gtk_list_box_select_row`; `null` unselects everything, as in C. */
    select_row(row: View | null): void {
        if (row === null) {
            this.unselect_all();
            return;
        }
        if (this._selectionMode === 'none' || !this._rowViews().includes(row)) return;
        this._setSelected(this._selectionMode === 'multiple' ? [...this._selected, row] : [row]);
    }

    /** `gtk_list_box_unselect_row`. */
    unselect_row(row: View): void {
        this._setSelected(this._selected.filter((held) => held !== row));
    }

    /** `gtk_list_box_select_all` — only in `multiple`, as C warns otherwise. */
    select_all(): void {
        if (this._selectionMode === 'multiple') this._setSelected(this._rowViews());
    }

    /** `gtk_list_box_unselect_all`. */
    unselect_all(): void {
        this._setSelected([]);
    }

    // --- properties ---

    /** `Gtk.ListBox:selection-mode` — a `Gtk.SelectionMode` nick, default `single`. */
    get selectionMode(): GtkSelectionModeNick {
        return this._selectionMode;
    }

    set selectionMode(value: GtkSelectionModeNick) {
        this._selectionMode = selectionMode(value);
        this._setSelected(selectionAfterModeChange(this._selectionMode, this._selected));
    }

    /** `Gtk.ListBox:activate-on-single-click` — held; see the file header. */
    get activateOnSingleClick(): boolean {
        return this._activateOnSingleClick;
    }

    set activateOnSingleClick(value: boolean | string) {
        this._activateOnSingleClick = xmlBoolean(value, this._activateOnSingleClick);
    }

    /** `Gtk.ListBox:show-separators` — held; the boxed list's rows draw their own. */
    get showSeparators(): boolean {
        return this._showSeparators;
    }

    set showSeparators(value: boolean | string) {
        this._showSeparators = xmlBoolean(value, this._showSeparators);
    }

    /** `Gtk.ListBox:accept-unpaired-release` — held; a touch platform has no unpaired release. */
    get acceptUnpairedRelease(): boolean {
        return this._acceptUnpairedRelease;
    }

    set acceptUnpairedRelease(value: boolean | string) {
        this._acceptUnpairedRelease = xmlBoolean(value, this._acceptUnpairedRelease);
    }

    // --- internals ---

    private _rowViews(): View[] {
        const rows: View[] = [];
        for (let index = 0; index < this.getChildrenCount(); index++) rows.push(this.getChildAt(index));
        return rows;
    }

    /** Number the rows, one `auto` track each, and flag the first. */
    private _renumber(): void {
        const rows = this._rowViews();
        this.removeRows();
        for (const [index, row] of rows.entries()) {
            this.addRow(new ItemSpec(1, 'auto'));
            GridLayout.setColumn(row, 0);
            GridLayout.setRow(row, index);
            markRow(row, FLUSH_TOP_CLASS, index === 0);
        }
    }

    private _adopt(row: View): void {
        this._renumber();
        if (this._listeners.has(row)) return;
        // A port row emits `activated` for itself; a plain widget has no such event, so its tap is
        // the activation. `activatable` is the port rows' own declared accessor, which is how
        // the two are told apart without a class list.
        const listeners: RowListeners = {
            tap: () => {
                this._tapped(row);
                if (!('activatable' in row)) this._activated(row);
            },
            activated: () => this._activated(row),
        };
        this._listeners.set(row, listeners);
        row.addEventListener('tap', listeners.tap);
        row.addEventListener(ACTIVATED, listeners.activated);
    }

    private _release(row: View): void {
        const listeners = this._listeners.get(row);
        if (listeners !== undefined) {
            row.removeEventListener('tap', listeners.tap);
            row.removeEventListener(ACTIVATED, listeners.activated);
            this._listeners.delete(row);
        }
        markRow(row, FLUSH_TOP_CLASS, false);
        markRow(row, LIST_ROW_SELECTED_CLASS, false);
        if (this._selected.includes(row)) this._setSelected(this._selected.filter((held) => held !== row));
    }

    private _tapped(row: View): void {
        this._setSelected(selectionAfterTap(this._selectionMode, this._selected, row));
    }

    private _activated(row: View): void {
        const data: ListBoxRowEventData = { eventName: LIST_BOX_ROW_ACTIVATED, object: this, row };
        this.notify(data);
    }

    private _setSelected(next: readonly View[]): void {
        const before = this._selected;
        const unchanged = before.length === next.length && before.every((row, index) => row === next[index]);
        if (unchanged) return;
        for (const row of before) {
            if (!next.includes(row)) markRow(row, LIST_ROW_SELECTED_CLASS, false);
        }
        for (const row of next) markRow(row, LIST_ROW_SELECTED_CLASS, true);
        this._selected = [...next];
        const data: ListBoxRowEventData = {
            eventName: LIST_BOX_ROW_SELECTED,
            object: this,
            row: this._selected[0] ?? null,
        };
        this.notify(data);
    }
}
