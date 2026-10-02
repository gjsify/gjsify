// The view half of the portable list — what `Gtk.ListView`, `Gtk.GridView` and
// `Gtk.ColumnView` need on top of ADR 0046's model (ADR 0089).
//
// ADR 0046 gave the LIST a portable value and stopped at the five widgets GTK gives a
// `model`, of which it built two: `Adw.ComboRow` and `Gtk.DropDown`. Its closing section
// names the other three and declines ONE thing for them — "a portable SELECTION model",
// the `Gtk.SelectionModel` layering. That declination is kept here and it is the reason
// this module exists at all: a view's `model` stays an `AdwListModel` (the same value the
// two selectors take), and the SELECTION is state on the WIDGET, exactly as ADR 0046 § 6
// already decided for `ComboState` — "a list model is not a selection model".
//
// WHAT THE THREE VIEWS SHARE, measured against the C rather than assumed: the model, the
// factory, and the selection RULES. `gtk_list_base_select_item` (gtklistbase.c:374-446) is
// one function for all three views — they derive from `GtkListBase` — and the three
// selection models it talks to are `GtkNoSelection`, `GtkSingleSelection` and
// `GtkMultiSelection`. {@link listViewSelect} is that function plus the three models'
// answers, as one pure step: in, the current selection and a click; out, the next
// selection. Everything the views do NOT share — a grid's column count, a column view's
// headers — is a separate function below rather than a flag on a shared one.
//
// THE FACTORY IS A FUNCTION, because that is what `GtkSignalListItemFactory` is: `setup`
// builds a widget, `bind` fills it from the item. {@link AdwListItemFactory} collapses the
// pair into one call per item, which is what a renderer that rebuilds a node per splice
// needs, and it is generic in the node type so a non-DOM renderer can take the same seam.
// `GtkBuilderListItemFactory`, the `.ui`-template half, has no counterpart: it needs a
// binding dialect, and inventing one is the kind of second vocabulary ADR 0034 exists to
// refuse.
//
// PROVENANCE. The C is `refs/gtk` in the sibling docs worktree, cited by file:lines at
// each function. The selection-model answers are read off the three implementations, not
// off their documentation: `gtk_single_selection_unselect_item` refusing while
// `autoselect` is on (gtksingleselection.c:160-173) is the rule that makes Ctrl+click on
// the selected row a no-op in single mode, and nothing says so in prose.
//
// PLATFORM-NEUTRAL: pure data and pure functions, like `list.ts` beside it. Nothing here
// touches a DOM node or a GObject.
//
// Reference: refs/gtk/gtk/gtklistbase.c:374-446 (gtk_list_base_select_item)
// Reference: refs/gtk/gtk/gtksingleselection.c:148-173, gtkmultiselection.c, gtknoselection.c
// Reference: refs/gtk/gtk/gtkgridview.c:619-641 (gtk_grid_view_compute_n_columns)
// Reference: refs/gtk/gtk/gtkcolumnviewsorter.c:294-344 (gtk_column_view_sorter_add_column)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import type { DataGridTrack } from './data-grid.js';
import { listItemsChanged, type AdwComboOption, type AdwListItemsChanged, type AdwListModel } from './list.js';

/**
 * Which `Gtk.SelectionModel` wraps the view's model, as a WORD.
 *
 * GTK composes the three — `Gtk.NoSelection`, `Gtk.SingleSelection`, `Gtk.MultiSelection`
 * — around a `Gio.ListModel` and hands the result to `GtkListView:model`. ADR 0046
 * declined that layering as a portable VALUE and ADR 0089 keeps the declination, so what
 * crosses here is the choice rather than the wrapper: one of three nicks, on the widget.
 *
 * `single` is the default because it is the one a `Gtk.ListView` is built with in every
 * upstream example, and because a view that answers no click at all is the surprising one.
 */
export type AdwListSelectionMode = 'none' | 'single' | 'multiple';

const SELECTION_MODES: ReadonlySet<string> = new Set(['none', 'single', 'multiple']);

/** An unknown mode is `single`, the way an unknown enum nick falls back to a default. */
export function normalizeListSelectionMode(raw: unknown): AdwListSelectionMode {
    return typeof raw === 'string' && SELECTION_MODES.has(raw) ? (raw as AdwListSelectionMode) : 'single';
}

/**
 * What a factory is handed for ONE item — `GtkListItem`'s three readable properties that
 * a renderer actually binds against (`item`, `position`, `selected`).
 *
 * `GtkListItem` carries five more (`activatable`, `focusable`, `selectable`, `child`, and
 * the two accessible strings). They are the LIST's business rather than the item's
 * content: the view decides whether a row can be activated, so making them inputs to the
 * factory would offer a per-item answer the view then overrides.
 */
export interface AdwListItemContext {
    /** The model item at {@link position}. */
    readonly item: AdwComboOption;
    /** Where the item sits in the model. */
    readonly position: number;
    /** Whether the view has this position selected. */
    readonly selected: boolean;
}

/**
 * `GtkSignalListItemFactory`'s `setup` + `bind`, as one call.
 *
 * GTK keeps them apart because it RECYCLES row widgets while scrolling: setup builds,
 * bind refills, and a view of ten thousand items holds two hundred widgets. This port
 * builds a node per item and splices ({@link ListViewState}), so there is nothing to
 * recycle and nothing for the split to buy — and a factory that is one function is a
 * factory an author can write inline.
 *
 * Generic in the node so the seam is not a DOM one: `@gjsify/adwaita-web` instantiates it
 * at `Node`, and a renderer with another node type takes the same interface.
 */
export type AdwListItemFactory<TNode> = (context: AdwListItemContext) => TNode;

/** One positional selection, normalised: ascending, no duplicates. */
export type AdwListSelection = readonly number[];

/** What a click (or a Space press) on a row means, in `gtk_list_base_select_item`'s words. */
export interface AdwListSelectStep {
    /** `<Ctrl>` — toggle this row rather than replacing the selection. */
    readonly modify?: boolean;
    /** `<Shift>` — extend from the anchor to this row. */
    readonly extend?: boolean;
}

/** The selection plus the position a later `extend` measures from. */
export interface AdwListSelectResult {
    /** The next selection, ascending. */
    readonly selection: number[];
    /** Where the next `extend` starts — GTK's `priv->selected` tracker. */
    readonly anchor: number;
}

/** Ascending, de-duplicated, and nothing outside `[0, length)`. */
function normalizeSelection(positions: Iterable<number>, length: number): number[] {
    const kept = new Set<number>();
    for (const position of positions) {
        if (Number.isInteger(position) && position >= 0 && position < length) kept.add(position);
    }
    return [...kept].sort((a, b) => a - b);
}

/**
 * One click on row `position` → the selection that follows it.
 *
 * This is `gtk_list_base_select_item` (gtklistbase.c:374-446) with the selection model's
 * answer folded in, because on this surface the two are not separable: GTK asks the model
 * and falls back when it says no, and the three models say different things.
 *
 * The C, step for step:
 *
 *   · a position outside the model is ignored — `pos >= n_items` returns early;
 *   · `extend` asks the model for a RANGE from the anchor. With `modify` the range takes
 *     the anchor's own state (select the span if the anchor is selected, unselect it
 *     otherwise); without, it is a plain `select_range(…, TRUE)` — unselect the rest;
 *   · a range the model refuses falls THROUGH to the single-item path, which is why
 *     Shift+click in single mode just moves the selection rather than doing nothing:
 *     `GtkSingleSelection` has no `select_range`;
 *   · `modify` alone toggles — except that `gtk_single_selection_unselect_item` refuses
 *     while `autoselect` is on (gtksingleselection.c:160-173, and `autoselect` defaults
 *     TRUE), so Ctrl+click on the SELECTED row in single mode leaves it selected;
 *   · plain click selects exclusively;
 *   · and the anchor moves to `pos` in every case the function does not return early
 *     from — it is the last statement of the function, after the range branch.
 *
 * `none` answers every step with the empty selection: `GtkNoSelection` implements the
 * interface by returning FALSE from each of the four mutators.
 */
export function listViewSelect(
    selection: AdwListSelection,
    anchor: number,
    position: number,
    length: number,
    mode: AdwListSelectionMode,
    step: AdwListSelectStep = {},
): AdwListSelectResult {
    const current = normalizeSelection(selection, length);
    if (mode === 'none') return { selection: [], anchor };
    if (!Number.isInteger(position) || position < 0 || position >= length) {
        return { selection: current, anchor };
    }

    const selected = new Set(current);
    if (mode === 'multiple' && step.extend && anchor >= 0 && anchor < length) {
        const min = Math.min(anchor, position);
        const max = Math.max(anchor, position);
        const span: number[] = [];
        for (let i = min; i <= max; i++) span.push(i);
        if (step.modify) {
            // The anchor's state decides the whole span, which is how a Ctrl+Shift drag
            // can CLEAR a run rather than only ever growing one.
            if (selected.has(anchor)) for (const i of span) selected.add(i);
            else for (const i of span) selected.delete(i);
        } else {
            selected.clear();
            for (const i of span) selected.add(i);
        }
        return { selection: normalizeSelection(selected, length), anchor: position };
    }

    if (step.modify) {
        if (selected.has(position)) {
            // Single mode refuses the unselect while autoselect is on; multiple honours it.
            if (mode === 'multiple') selected.delete(position);
        } else if (mode === 'multiple') {
            selected.add(position);
        } else {
            selected.clear();
            selected.add(position);
        }
    } else {
        selected.clear();
        selected.add(position);
    }
    return { selection: normalizeSelection(selected, length), anchor: position };
}

/** `list.select-all` — refused by every model but `GtkMultiSelection`. */
export function listViewSelectAll(length: number, mode: AdwListSelectionMode): number[] {
    if (mode !== 'multiple') return [];
    return Array.from({ length }, (_, index) => index);
}

/** A selection subscriber — the positions, and whether a USER produced them. */
export type ListViewSelectionListener = (change: ListViewSelectionChange) => void;

/** What a selection subscriber is handed. */
export interface ListViewSelectionChange {
    /** The selected positions, ascending. */
    readonly selection: AdwListSelection;
    /** False for a programmatic write, the way `ComboStateChange.interactive` reads. */
    readonly interactive: boolean;
}

/** An items subscriber — one `Gio.ListModel::items-changed` per model assignment. */
export type ListViewItemsListener = (change: AdwListItemsChanged) => void;

/**
 * The model + selection a view holds — headless (ADR 0004, ADR 0089).
 *
 * `ComboState` is the same shape one widget over and is NOT reused: it holds ONE index
 * because `Adw.ComboRow:selected` is one `guint`, and widening it to a set would put a
 * multi-selection vocabulary on a widget that has none. What the two DO share is already
 * shared — the item vocabulary, the splice, and the autoselect clamp all live in
 * `list.ts` and both classes call them.
 *
 * THE MODEL IS COPIED IN BOTH DIRECTIONS, for the reason ADR 0046 § 3 measured on
 * `ComboState`: the splice is computed by COMPARING the assigned model against the stored
 * one, so a shared array or a shared item makes both sides read the new value and answer
 * "nothing changed" — silently, because there is nothing to throw.
 */
export class ListViewState {
    private _model: AdwComboOption[] = [];
    private _selection: number[] = [];
    private _anchor = -1;
    private _mode: AdwListSelectionMode = 'single';
    private readonly _itemListeners = new Set<ListViewItemsListener>();
    private readonly _selectionListeners = new Set<ListViewSelectionListener>();

    /** Subscribe to MODEL changes — one splice per {@link setModel}. Returns an unsubscribe. */
    subscribeItems(listener: ListViewItemsListener): () => void {
        this._itemListeners.add(listener);
        return () => {
            this._itemListeners.delete(listener);
        };
    }

    /** Subscribe to SELECTION changes. Returns an unsubscribe. */
    subscribeSelection(listener: ListViewSelectionListener): () => void {
        this._selectionListeners.add(listener);
        return () => {
            this._selectionListeners.delete(listener);
        };
    }

    /** The list model, as a COPY — see the class header. */
    get model(): AdwComboOption[] {
        return this._model.map((item) => ({ value: item.value, label: item.label }));
    }

    /** How many items the model holds (`g_list_model_get_n_items`). */
    get count(): number {
        return this._model.length;
    }

    /** The selected positions, ascending, as a copy. */
    get selection(): number[] {
        return [...this._selection];
    }

    /** Which selection model the view behaves as. */
    get selectionMode(): AdwListSelectionMode {
        return this._mode;
    }

    /**
     * Replace the model: emit the splice that turns the old one into the new, then drop
     * any selected position the new model does not have.
     *
     * A VIEW DOES NOT AUTOSELECT, and that is the one place this class deliberately
     * differs from `ComboState`. `clampListSelection` is `GtkSingleSelection`'s
     * `autoselect`, which exists so a combo row always has a value to SHOW; a list view
     * has no inline value and GTK's own `GtkMultiSelection` keeps nothing selected after
     * a model it cannot map. So positions are filtered, not clamped.
     */
    setModel(model: readonly AdwComboOption[] | null | undefined): void {
        const next = Array.isArray(model) ? model : [];
        const change = listItemsChanged(this._model, next as AdwListModel);
        this._model = next.map((item) => ({ value: item.value, label: item.label }));
        const kept = normalizeSelection(this._selection, this._model.length);
        const selectionChanged = kept.length !== this._selection.length;
        this._selection = kept;
        if (this._anchor >= this._model.length) this._anchor = -1;
        if (change) {
            // Snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip
            // the next listener — the reason `ComboState._emit` states.
            // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot
            for (const listener of [...this._itemListeners]) listener(change);
        }
        if (selectionChanged) this._emitSelection(false);
    }

    /** `Gtk.SelectionModel` choice. Narrowing it drops what the new mode cannot hold. */
    setSelectionMode(mode: AdwListSelectionMode): void {
        if (mode === this._mode) return;
        this._mode = mode;
        if (mode === 'none' && this._selection.length > 0) {
            this._selection = [];
            this._emitSelection(false);
        } else if (mode === 'single' && this._selection.length > 1) {
            // The LAST click wins, which is the anchor — a narrowing that kept the first
            // position would move the selection somewhere the user never clicked.
            this._selection = this._selection.includes(this._anchor) ? [this._anchor] : [this._selection[0]!];
            this._emitSelection(false);
        }
    }

    /** Whether `position` is selected. */
    isSelected(position: number): boolean {
        return this._selection.includes(position);
    }

    /**
     * One click or Space on `position` — {@link listViewSelect} applied to this state.
     *
     * Returns whether the selection CHANGED, which is what gates a notify: the anchor
     * moves on every accepted step and is not itself observable, so reporting it would
     * make a repeat click on one row look like a selection change.
     */
    selectItem(position: number, step: AdwListSelectStep = {}, interactive = true): boolean {
        const result = listViewSelect(this._selection, this._anchor, position, this._model.length, this._mode, step);
        this._anchor = result.anchor;
        return this._applySelection(result.selection, interactive);
    }

    /** `list.select-all`. */
    selectAll(interactive = false): boolean {
        return this._applySelection(listViewSelectAll(this._model.length, this._mode), interactive);
    }

    /** `list.unselect-all`. */
    unselectAll(interactive = false): boolean {
        return this._applySelection([], interactive);
    }

    /** Programmatic assignment — out-of-range positions are dropped, as a model replacement drops them. */
    setSelection(positions: Iterable<number>, interactive = false): boolean {
        const next = normalizeSelection(positions, this._model.length);
        const limited = this._mode === 'none' ? [] : this._mode === 'single' ? next.slice(0, 1) : next;
        if (limited.length > 0) this._anchor = limited[limited.length - 1]!;
        return this._applySelection(limited, interactive);
    }

    /** The context a factory is handed for `position`, or null past the end of the model. */
    itemContext(position: number): AdwListItemContext | null {
        const item = this._model[position];
        if (item === undefined) return null;
        return { item: { value: item.value, label: item.label }, position, selected: this.isSelected(position) };
    }

    private _applySelection(next: number[], interactive: boolean): boolean {
        if (next.length === this._selection.length && next.every((position, i) => position === this._selection[i])) {
            return false;
        }
        this._selection = next;
        this._emitSelection(interactive);
        return true;
    }

    private _emitSelection(interactive: boolean): void {
        const change: ListViewSelectionChange = { selection: [...this._selection], interactive };
        // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot
        for (const listener of [...this._selectionListeners]) listener(change);
    }
}

/** `GtkGridView:max-columns`' default — `DEFAULT_MAX_COLUMNS` (gtkgridview.c:42). */
export const ADW_GRID_VIEW_MAX_COLUMNS = 7;

/** `GtkGridView:min-columns`' default — the ParamSpec's own (gtkgridview.c:1164-1167). */
export const ADW_GRID_VIEW_MIN_COLUMNS = 1;

/**
 * How many columns a grid lays out in `forSize` pixels — `gtk_grid_view_compute_n_columns`
 * (gtkgridview.c:619-641).
 *
 * The arithmetic is upstream's, including the `+ spacing` on both sides, which is what
 * makes the LAST column need no trailing gap, and the integer division, which the C calls
 * out as deliberate ("rounding down is exactly what we want here").
 *
 * `MAX (1, …)` in the denominator is kept: an item that measures zero would otherwise
 * divide by zero, and the C asserts the result is positive.
 *
 * The clamp order is `CLAMP (n, min, max)` as written, so `max < min` answers `min` for a
 * narrow view and `max` for a wide one — the asymmetry the property's own documentation
 * describes from one side only ("if this number is smaller than min-columns, that value is
 * used instead", gtkgridview.c:1147-1157).
 */
export function gridViewColumns(
    forSize: number,
    itemSize: number,
    spacing: number,
    minColumns: number = ADW_GRID_VIEW_MIN_COLUMNS,
    maxColumns: number = ADW_GRID_VIEW_MAX_COLUMNS,
): number {
    const min = Math.max(1, Math.floor(minColumns));
    const max = Math.max(1, Math.floor(maxColumns));
    const columns = Math.floor((forSize + spacing) / Math.max(1, itemSize + spacing));
    return Math.min(Math.max(columns, min), Math.max(min, max));
}

/**
 * Which half of a portable item a column draws, for a column that declares no factory.
 *
 * A `GtkColumnViewColumn` has no such property: upstream a column draws whatever its
 * FACTORY pulls off the item, and the item is an arbitrary GObject. A portable item is
 * `AdwComboOption` — `value` and `label`, and nothing else by contract (ADR 0046 § 2) —
 * so a column that wants to draw without a factory has exactly these two choices, and
 * `key` is the declarative door onto them. Anything else is a `factory`, which is the
 * same thing GTK requires of every column.
 */
export type AdwListItemField = 'label' | 'value';

/** `item[field]`, with the field clamped — the one place a column's `key` is resolved. */
export function listItemField(item: AdwComboOption, field: AdwListItemField): string {
    return field === 'value' ? item.value : item.label;
}

/**
 * One `Gtk.ColumnViewColumn`, in plain data.
 *
 * Every other member IS a GTK property; `key` is the exception and {@link AdwListItemField}
 * says why. `id` is kept beside it rather than derived from it because it is a real
 * property with a different job — it is what `Gtk.ColumnView` persists a column layout by
 * — and because two columns over the same field are a legitimate thing to author.
 */
export interface AdwColumnViewColumn {
    /** Which portable field this column draws when it has no factory. */
    key: AdwListItemField;
    /** `Gtk.ColumnViewColumn:title` — the header text. Defaults to {@link key}. */
    title?: string;
    /** `Gtk.ColumnViewColumn:id`. Defaults to {@link key}. */
    id?: string;
    /** `Gtk.ColumnViewColumn:expand` — take a share of the extra width. */
    expand?: boolean;
    /** `Gtk.ColumnViewColumn:fixed-width`, in pixels. `-1` is "not fixed", as in C. */
    fixedWidth?: number;
    /** `Gtk.ColumnViewColumn:visible`. */
    visible?: boolean;
    /** Whether the header sorts — the portable stand-in for a non-null `Gtk.Sorter`. */
    sortable?: boolean;
}

/** Which column a column view is sorted by, and in which direction. */
export interface AdwColumnViewSort {
    /** The sorted column's {@link AdwColumnViewColumn.id}. */
    readonly column: string;
    /** `Gtk.SortType.DESCENDING` — the sorter's `inverted` flag. */
    readonly descending: boolean;
}

/** `fixed-width`'s "no fixed width" sentinel (`gtk_column_view_column_set_fixed_width`). */
export const ADW_COLUMN_VIEW_NO_FIXED_WIDTH = -1;

/**
 * Raw authored columns → stable descriptors. TOTAL, for the reason
 * `normalizeComboOptions` is: the doors it reaches are a property assignment and a markup
 * attribute, and an author's typo must not take the widget down.
 *
 * An entry with no `key` is DROPPED rather than defaulted — a column that draws no field
 * is an empty strip a reader cannot tell from a layout bug, and `normalizeDataGridColumns`
 * answers the identical input the identical way.
 */
export function normalizeColumnViewColumns(raw: unknown): AdwColumnViewColumn[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter(
            (column): column is Partial<AdwColumnViewColumn> =>
                typeof column === 'object' && column !== null && 'key' in column,
        )
        .map((column) => {
            // An unknown field is `label`, the half a reader can always see — `value` is
            // an id, and a column of ids where a typo was meant to show names is the
            // quieter of the two wrong answers.
            const key: AdwListItemField = column.key === 'value' ? 'value' : 'label';
            return {
                key,
                title: column.title === undefined ? key : String(column.title),
                id: column.id === undefined ? key : String(column.id),
                expand: column.expand === true,
                fixedWidth: typeof column.fixedWidth === 'number' ? column.fixedWidth : ADW_COLUMN_VIEW_NO_FIXED_WIDTH,
                visible: column.visible !== false,
                sortable: column.sortable === true,
            };
        });
}

/** The MARKUP door: a JSON attribute → normalised columns. Total in both failure modes. */
export function parseColumnViewColumns(raw: string | null | undefined): AdwColumnViewColumn[] {
    if (!raw) return [];
    try {
        return normalizeColumnViewColumns(JSON.parse(raw));
    } catch {
        return [];
    }
}

/**
 * A click on a sortable header → the sort that follows it —
 * `gtk_column_view_sorter_add_column` (gtkcolumnviewsorter.c:294-344).
 *
 * The rule is two lines of that function: if the clicked column is ALREADY the primary
 * sorter, `inverted` flips; otherwise the column becomes primary, ascending. A column
 * with no sorter is refused (`sorter == NULL` returns FALSE), which is what `sortable`
 * stands in for here.
 *
 * The secondary sorters upstream keeps in a sequence are not modelled: they are reachable
 * only through `GtkColumnViewSorter`'s own API, never through a header click, and a
 * portable multi-key sort would need the comparators this surface does not carry.
 */
export function columnViewSort(
    current: AdwColumnViewSort | null,
    column: AdwColumnViewColumn,
): AdwColumnViewSort | null {
    if (column.sortable !== true) return current;
    const id = column.id ?? column.key;
    if (current !== null && current.column === id) return { column: id, descending: !current.descending };
    return { column: id, descending: false };
}

/**
 * The column tracks a column view lays out — in `data-grid.ts`'s renderer-neutral
 * {@link DataGridTrack}, reused rather than restated.
 *
 * The two widgets answer the SAME question (which track is pinned, which absorbs the
 * slack) from two property names, and `AdwDataGrid` is where that vocabulary already
 * lives. What differs is only the mapping: `fixed-width` is a pixel number rather than a
 * CSS length, and `expand` is a boolean share rather than a weight — GTK divides the extra
 * width evenly among the expanding columns, so every one of them is `1fr`.
 *
 * A view with NO expanding column gets `auto` throughout, which leaves the trailing space
 * unclaimed exactly as `gtk_column_view_measure` does.
 */
export function columnViewTracks(columns: readonly AdwColumnViewColumn[]): DataGridTrack[] {
    return columns
        .filter((column) => column.visible !== false)
        .map((column): DataGridTrack => {
            const fixed = column.fixedWidth ?? ADW_COLUMN_VIEW_NO_FIXED_WIDTH;
            if (fixed > 0) return { kind: 'fixed', css: `${fixed}px` };
            if (column.expand === true) return { kind: 'flex', weight: 1 };
            return { kind: 'auto' };
        });
}
