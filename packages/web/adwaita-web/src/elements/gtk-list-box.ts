// <gtk-list-box> — a vertical list of `<gtk-list-box-row>` children with GTK's four selection
// modes, the web counterpart of `Gtk.ListBox`.
//
// THE SELECTION IS `listBoxSelect` AND FRIENDS, in `@gjsify/adwaita-core` (ADR 0004), NOT the
// `listViewSelect` beside it that `<gtk-list-view>` uses. The two are different C functions and
// they disagree in four places, each of which a reader would get wrong from the other: this
// box has a `browse` mode the list base has no word for; Ctrl+click on the selected row
// CLEARS the selection here where `GtkSingleSelection` refuses (`autoselect`); Shift+click
// keeps the ANCHOR where the list base moves it; and `select_row`/`unselect_row` are a
// separate, idempotent door that is NOT the click. `box-selection.ts` carries the reasoning
// and the vectors; this element holds the rows and the anchor.
//
// `activate-on-single-click` DEFAULTS TRUE (gtklistbox.c:541-544), as does
// `<gtk-flow-box>`'s — unlike `Gtk.ListView:single-click-activate`, which defaults FALSE and
// reads its flag the other way round. The port keeps each widget's own spelling rather than
// normalising three properties into one, because the fence rules key on GIR defaults: a bare
// attribute here means the default, and `activate-on-single-click="false"` is how you ask for
// a double click.
//
// ARIA. GTK declares `GTK_ACCESSIBLE_ROLE_LIST` unconditionally (gtklistbox.c:778) and the row
// `LIST_ITEM` (:3955). That pairing carries no selection at all in ARIA — `aria-selected` is
// not valid on a `listitem` — so a box that can select anything is announced as a `listbox`
// with `option` rows, and only a `none` box keeps GTK's own `list`/`listitem`. It is the same
// divergence `<gtk-list-view>` records and for the same reason.
//
// `tab-behavior` (4.18) is `tabIndex` on the rows: `all` gives every activatable row its own
// tab stop, `item` and `cell` hand out a roving tabindex — the split `gtk_list_box_focus`
// draws by walking between rows for Tab only under `GTK_LIST_TAB_ALL` (gtklistbox.c:2037,
// :2067), which is what makes the list one stop from outside under the other two. A roving
// tabindex that does not move leaves every unselected row unreachable by any key, which is
// what `attachRovingFocus` is for (the incident `roving-focus.ts` records in full). The rows
// are `claim`ed here, so they stop deriving their own: a row's `connectedCallback` runs after
// this one's and would otherwise put every row back in the Tab order.
//
// WHAT IS NOT HERE, and why nothing was lost. `bind_model` is ADR 0046's `Gio.ListModel` — the
// family the four model views' refusals name. `set_filter_func`, `set_sort_func` and
// `set_header_func` are three FUNCTION properties with no markup form. `get_row_at_y` is a hit
// test over a GTK allocation. `drag_highlight_row` / `drag_unhighlight_row` drive a drop target
// this port has no DND layer for. `set_placeholder` is a widget property and so a slot, which
// this element does not take one for. `set_adjustment` is the scrolled-window relationship ADR
// 0047 gave a portable value for, and the host wires it with its scrolled-window wrapper rather
// than as a property here.
//
// Reference: refs/gtk/gtk/gtklistbox.c:524-778 (properties, signals, the keys, css name, role),
//   :915-996 (select/unselect/all), :1901-1935 (the click gesture), :1799-1871 (the selection
//   rules), :3600-3624 (the per-row class and accessible state), :4127-4134 (`.separators`)
// Reference: refs/libadwaita/src/stylesheet/widgets/_lists.scss:5-38, :47-95 (list, row)
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web; the selection rules
// composed from @gjsify/adwaita-core.

import {
    listBoxSelect,
    listBoxSelectAll,
    listBoxSelectRow,
    listBoxUnselectAll,
    listBoxUnselectRow,
    normalizeBoxSelectionMode,
    type AdwBoxSelectionMode,
} from '@gjsify/adwaita-core';

import type { GtkListBoxRow } from './gtk-list-box-row.js';
import { attachRovingFocus } from './roving-focus.js';

// SIDE-EFFECT import, deliberately separate from the type import above: it guarantees
// `gtk-list-box-row` is defined before this module's `customElements.define` can upgrade a
// server-rendered box and collect its rows. See `adw-expander-row.ts` for why a combined
// `import { GtkListBoxRow }` would not do it.
import './gtk-list-box-row.js';

/** `GtkListTabBehavior`'s nicks — `cell` behaves as `item` outside a cell-based box. */
export type GtkListTabBehavior = 'all' | 'item' | 'cell';

const TAB_BEHAVIORS: ReadonlySet<string> = new Set(['all', 'item', 'cell']);

/** An unknown nick is `all`, the ParamSpec's default (gtklistbox.c:574-578). */
export function normalizeListTabBehavior(raw: string | null | undefined): GtkListTabBehavior {
    return raw !== null && raw !== undefined && TAB_BEHAVIORS.has(raw) ? (raw as GtkListTabBehavior) : 'all';
}

export class GtkListBox extends HTMLElement {
    private _rows: GtkListBoxRow[] = [];
    private _selection: number[] = [];
    /** `box->selected_row`, `-1` for the C's NULL. */
    private _anchor = -1;
    private _initialized = false;

    static get observedAttributes() {
        return [
            'selection-mode',
            'activate-on-single-click',
            'accept-unpaired-release',
            'show-separators',
            'tab-behavior',
        ];
    }

    /** `GtkListBox:selection-mode` — the four `Gtk.SelectionMode` values. */
    get selectionMode(): AdwBoxSelectionMode {
        return normalizeBoxSelectionMode(this.getAttribute('selection-mode'));
    }

    set selectionMode(value: AdwBoxSelectionMode) {
        this.setAttribute('selection-mode', value);
    }

    /** Default TRUE (gtklistbox.c:543), so the attribute is the OFF switch. */
    get activateOnSingleClick(): boolean {
        return this.getAttribute('activate-on-single-click') !== 'false';
    }

    set activateOnSingleClick(value: boolean) {
        this.setAttribute('activate-on-single-click', String(!!value));
    }

    /**
     * `GtkListBox:accept-unpaired-release` — FALSE by default (gtklistbox.c:552-553).
     *
     * Upstream this decides whether a press followed by a release somewhere else still
     * activates the row under the press (:1922-1935). A browser delivers `click` on the
     * NEAREST COMMON ANCESTOR of the press and the release, so a release outside the row
     * reaches this box rather than the row — and this attribute says whether that box-level
     * click selects the row the press started on or is dropped.
     */
    get acceptUnpairedRelease(): boolean {
        return this.hasAttribute('accept-unpaired-release');
    }

    set acceptUnpairedRelease(value: boolean) {
        this.toggleAttribute('accept-unpaired-release', !!value);
    }

    get showSeparators(): boolean {
        return this.hasAttribute('show-separators');
    }

    set showSeparators(value: boolean) {
        this.toggleAttribute('show-separators', !!value);
    }

    /** `GtkListBox:tab-behavior` (4.18) — `all` | `item` | `cell`. */
    get tabBehavior(): GtkListTabBehavior {
        return normalizeListTabBehavior(this.getAttribute('tab-behavior'));
    }

    set tabBehavior(value: GtkListTabBehavior) {
        this.setAttribute('tab-behavior', value);
    }

    /** The rows, in order. */
    get rows(): readonly GtkListBoxRow[] {
        return this._rows;
    }

    /**
     * The selected positions, ascending.
     *
     * NOT a GIR property: `GtkListBox` exposes its selection through the `row-selected` /
     * `selected-rows-changed` SIGNALS and the `get_selected_rows()` METHOD, and this element
     * spells the signal as `notify::selected-rows` so a `notify::` listener finds the shape it
     * expects everywhere else in the package.
     */
    get selectedRows(): number[] {
        return [...this._selection];
    }

    set selectedRows(value: Iterable<number> | number | null) {
        for (const position of typeof value === 'number' ? [value] : (value ?? [])) {
            this.selectRow(this._rows[position] ?? null);
        }
    }

    /** `gtk_list_box_selected_foreach`, as the rows themselves. */
    get selectedRowElements(): GtkListBoxRow[] {
        return this._selection.map((position) => this._rows[position]).filter((row) => row !== undefined);
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.addEventListener('click', (event) => this._onClick(event));
        this.addEventListener('dblclick', (event) => this._onDoubleClick(event));
        this.addEventListener('keydown', (event) => this._onKeyDown(event));

        attachRovingFocus({
            host: this,
            // Always vertical: `GtkListBox` is NOT a `GtkOrientable` — it has no `orientation`
            // property, unlike `Gtk.FlowBox` — so this is a VALUE rather than the FUNCTION
            // `<gtk-list-view>` needs for a property that can change after connect.
            orientation: 'vertical',
            items: () => this._rows,
            select: (row) => this._updateSelection(row as GtkListBoxRow, {}),
        });

        // A row appended AFTER connect has to join the selection from its first frame. The
        // observer watches THIS element, so it dies with the element and there is nothing for
        // `check-adwaita-connect-rebind` to hold — `slotted-children.ts` states why.
        new MutationObserver(() => this._collectRows()).observe(this, { childList: true });

        this._applyAttributes();
        this._collectRows();
    }

    attributeChangedCallback(name?: string) {
        if (!this._initialized) return;
        this._applyAttributes();
        // `can_select` feeds every row's `.activatable` class, so a mode change reaches them.
        if (name === 'selection-mode') this._syncRows();
        if (name === 'tab-behavior') this._syncTabIndexes();
    }

    /** `gtk_list_box_select_row` (gtklistbox.c:915-933). `null` is the C's unselect-all (:926). */
    selectRow(row: GtkListBoxRow | null): void {
        const position = row === null ? null : this._rows.indexOf(row);
        const result = listBoxSelectRow(
            this._selection,
            this._anchor,
            position,
            this._rows.length,
            this.selectionMode,
            row === null || row.selectable,
        );
        if (same(result.selection, this._selection) && result.anchor === this._anchor) return;
        this._selection = result.selection;
        this._anchor = result.anchor;
        this._emitSelection(row);
    }

    /** `gtk_list_box_unselect_row` (gtklistbox.c:943-950). */
    unselectRow(row: GtkListBoxRow): void {
        const result = listBoxUnselectRow(
            this._selection,
            this._anchor,
            this._rows.indexOf(row),
            this._rows.length,
            this.selectionMode,
        );
        if (same(result.selection, this._selection)) return;
        this._selection = result.selection;
        this._emitSelection(null);
    }

    /** `gtk_list_box_select_all` — refused unless the mode is `multiple` (:963-964). */
    selectAll(): void {
        const next = listBoxSelectAll(this._rows.length, this.selectionMode);
        if (next === null) return;
        this._selection = next;
        this._anchor = next.length > 0 ? next[0]! : -1;
        this._emitSelection(this.selectedRowElements[0] ?? null);
    }

    /** `gtk_list_box_unselect_all` — refused in `browse`, a no-op on an empty selection. */
    unselectAll(): void {
        if (listBoxUnselectAll(this._selection, this.selectionMode) === null) return;
        this._selection = [];
        this._anchor = -1;
        this._emitSelection(null);
    }

    /** The classes and ARIA that follow directly from the attributes. */
    private _applyAttributes(): void {
        this.classList.toggle('separators', this.showSeparators);
        const selectable = this.selectionMode !== 'none';
        this.setAttribute('role', selectable ? 'listbox' : 'list');
        if (this.selectionMode === 'multiple') this.setAttribute('aria-multiselectable', 'true');
        else this.removeAttribute('aria-multiselectable');
    }

    /** Re-read the children and re-derive everything that follows from them. */
    private _collectRows(): void {
        const next = [...this.querySelectorAll(':scope > gtk-list-box-row')] as GtkListBoxRow[];
        if (next.length === this._rows.length && next.every((row, position) => row === this._rows[position])) return;
        // The box owns each row's `.activatable` class and tab stop while it manages it, and
        // a row's own `connectedCallback` runs AFTER this one — see `GtkListBoxRow.claim`.
        for (const row of this._rows) if (!next.includes(row)) row.release();
        for (const row of next) row.claim();
        this._rows = next;
        this._selection = this._selection.filter((position) => position < this._rows.length);
        if (this._anchor >= this._rows.length) this._anchor = -1;
        this._syncRows();
    }

    /**
     * Re-derive every row's `.activatable` class, its `aria-selected` and the roving tabindex.
     *
     * Called on connect, on `selection-mode`, and from the childList observer, so a row
     * appended after connect is in the selection from its first frame.
     */
    private _syncRows(): void {
        const canSelect = this.selectionMode !== 'none';
        const selection = new Set(this._selection);
        this._rows.forEach((row, position) => {
            row.syncClasses(canSelect);
            // `gtk_list_box_update_row` :3617-3623 — the accessible state is published only
            // while the row is selectable AND the box can select, and RESET otherwise, so a
            // row in a `none` box must not announce itself as merely unselected.
            if (row.selectable && canSelect) row.setAttribute('aria-selected', String(selection.has(position)));
            else row.removeAttribute('aria-selected');
        });
        this._syncTabIndexes();
    }

    /** The tab stops `tab-behavior` hands out: one per row, or one for the whole box. */
    private _syncTabIndexes(): void {
        const roving = this.tabBehavior !== 'all';
        // Where Tab ENTERS the box is `gtk_list_box_focus` with no focus child yet: the
        // selected row, and the first focusable row when there is none (gtklistbox.c:2108-2111).
        // Leaving is the mirror image, `get_last_focusable` (:2099-2101), and the two stops
        // are what `item`/`cell` mean — `all` walks rows in between (gtklistbox.c:2037, :2067).
        const cursor = this._selection.length > 0 ? this._selection[0]! : 0;
        this._rows.forEach((row, position) => {
            row.tabIndex = roving ? (position === cursor ? 0 : -1) : row.classList.contains('activatable') ? 0 : -1;
        });
    }

    /**
     * One click. Selection always follows; activation depends on the click COUNT, which a
     * plain `click` cannot say — so the count comes from `detail` and a second click arrives
     * here too.
     */
    private _onClick(event: MouseEvent): void {
        const row = this._rowAt(event.target);
        // An unpaired release — the press landed in a row, the release outside it — arrives as
        // a box-level click with no row under the pointer. That is what the attribute decides.
        if (row === null && !this.acceptUnpairedRelease) return;
        if (row !== null) {
            this._updateSelection(row, { modify: event.ctrlKey || event.metaKey, extend: event.shiftKey });
        }
        // One press activates when `activate-on-single-click` is TRUE — the ParamSpec default
        // (gtklistbox.c:543) — and a SECOND one when it is off (gtklistbox.c:1917-1918). A
        // browser reports the press count as `detail`, so the threshold is the property and not
        // a constant.
        if (event.detail < (this.activateOnSingleClick ? 1 : 2)) return;
        if (row !== null) this._activate(row);
    }

    /** The double-click arm, for the browser that reports the second click as `detail === 2`. */
    private _onDoubleClick(event: MouseEvent): void {
        if (this.activateOnSingleClick) return;
        const row = this._rowAt(event.target);
        if (row === null) return;
        this._activate(row);
    }

    /**
     * `Ctrl`+Space is `toggle-cursor-row` (gtklistbox.c:753-755) and nothing else is: Enter and
     * Space reach the ROW, which `attachRowActivation` owns, and this box must not answer the
     * same key twice.
     */
    private _onKeyDown(event: KeyboardEvent): void {
        if (!event.ctrlKey || event.altKey || event.metaKey || event.key !== ' ') return;
        const row = this._rowAt(event.target);
        if (row === null) return;
        event.preventDefault();
        this._updateSelection(row, { modify: true });
    }

    /** The row a click or key landed in, or null. */
    private _rowAt(target: EventTarget | null): GtkListBoxRow | null {
        if (!(target instanceof Element)) return null;
        const row = target.closest('gtk-list-box-row');
        return this.contains(row) ? (row as GtkListBoxRow) : null;
    }

    /** One click or `Ctrl`+Space — `gtk_list_box_update_selection_full` (:1799-1871). */
    private _updateSelection(row: GtkListBoxRow, step: { modify?: boolean; extend?: boolean }): void {
        const result = listBoxSelect(
            this._selection,
            this._anchor,
            this._rows.indexOf(row),
            this._rows.length,
            this.selectionMode,
            step,
            row.selectable,
        );
        if (same(result.selection, this._selection)) return;
        this._selection = result.selection;
        this._anchor = result.anchor;
        // `row-selected` names the row the click LANDED ON, or NULL when that row ended
        // unselected (gtklistbox.c:1826-1828, :1856-1858) — which is why it is the click's row
        // and not the first selected one.
        this._emitSelection(result.selection.includes(this._rows.indexOf(row)) ? row : null);
    }

    /** `gtk_list_box_activate` (:1873-1884) — an unactivatable row emits nothing. */
    private _activate(row: GtkListBoxRow): void {
        if (!row.activatable) return;
        this.dispatchEvent(new CustomEvent('row-activated', { bubbles: true, detail: { row } }));
        row.dispatchEvent(new CustomEvent('activate', { bubbles: true }));
    }

    /**
     * The two signals GObject emits for every selection change (:594-616) plus the notify a
     * declarative port owes. `selected-rows-changed` is `RUN_FIRST` upstream and carries
     * nothing, so its `detail` stays empty.
     */
    private _emitSelection(row: GtkListBoxRow | null): void {
        this._syncRows();
        this.dispatchEvent(new CustomEvent('selected-rows-changed', { bubbles: true }));
        this.dispatchEvent(new CustomEvent('row-selected', { bubbles: true, detail: { row } }));
        this.dispatchEvent(
            new CustomEvent('notify::selected-rows', { bubbles: true, detail: { selectedRows: [...this._selection] } }),
        );
    }
}

/** Selection equality without an allocation — the arrays are sorted, so lengths decide. */
function same(next: readonly number[], current: readonly number[]): boolean {
    return next.length === current.length && next.every((position, index) => position === current[index]);
}

customElements.define('gtk-list-box', GtkListBox);
