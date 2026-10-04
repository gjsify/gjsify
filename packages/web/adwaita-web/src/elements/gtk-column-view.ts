// <gtk-column-view> — the list view with columns and a header, the web counterpart of
// `Gtk.ColumnView`.
//
// IT EXTENDS `<gtk-list-view>` BECAUSE UPSTREAM DOES THE SAME THING ONE LAYER DOWN. A
// `GtkColumnView` is not a `GtkListBase`, but its own CSS node tree says where its rows
// come from — `columnview > header` plus `columnview > listview > row > cell`
// (gtkcolumnview.c) — and `show-row-separators` is passed STRAIGHT THROUGH to that inner
// list view. So the model, the factory, the splice, the selection and the rubberband are
// the base element's, and what is added here is the header and the cells.
//
// A COLUMN DRAWS ONE PORTABLE FIELD, OR ITS OWN FACTORY. Upstream a column pulls whatever
// its factory wants off an arbitrary GObject; a portable item is `value` and `label` and
// nothing else by contract (ADR 0046 § 2), so `key` chooses between those two and anything
// richer is a `factory` — which is what GTK demands of every column anyway. Two columns
// over `label` and `value` is the name/id table this makes directly authorable, and it is
// what the gallery block shows.
//
// SORTING IS STATE, NOT AN ORDERING, and that is upstream's division of labour rather
// than a shortfall: `gtk_column_view_get_sorter` hands an app a `GtkSorter` to put on a
// `GtkSortListModel`, and the view itself never reorders anything. So a click on a
// sortable header runs `columnViewSort` — `gtk_column_view_sorter_add_column`'s rule, a
// second click on the primary column inverting it — moves the indicator and emits
// `notify::sorter`. The consumer re-assigns `model`, and the splice puts the rows where
// the new order wants them.
//
// Attributes: model, selection-mode, single-click-activate, enable-rubberband,
//   tab-behavior (the base element's), plus `columns` (JSON), `show-row-separators`,
//   `show-column-separators` and `reorderable`, which are `Gtk.ColumnView`'s own.
// Properties: everything `<gtk-list-view>` publishes, plus columns, sorter, reorderable,
//   showRowSeparators, showColumnSeparators.
// Events: `activate`, `notify::selected` (the base element's), and `notify::sorter`
//   (CustomEvent, bubbles, detail = { sorter }).
// A11Y: `grid` with `row`, `columnheader` and `gridcell`. GTK declares `TREE_GRID`
//   (gtkcolumnview.c) because a column view may hold `Gtk.TreeExpander`s; the port
//   announces the non-tree role and `<gtk-tree-expander>` contributes the `aria-level`
//   and `aria-expanded` of any row that is a tree row, so a flat table does not promise
//   a hierarchy it has not got.
//
// Reference: refs/gtk/gtk/gtkcolumnview.c (the widget, its CSS nodes and its roles)
// Reference: refs/gtk/gtk/gtkcolumnviewsorter.c:294-344 (the header-click rule)
// Reference: refs/libadwaita/src/stylesheet/widgets/_column-view.scss:1-112
// Copyright (c) GNOME contributors (GTK/libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    columnViewSort,
    columnViewTracks,
    dataGridTrackTemplate,
    listItemField,
    normalizeColumnViewColumns,
    parseColumnViewColumns,
    type AdwColumnViewColumn,
    type AdwColumnViewSort,
    type AdwListItemContext,
    type AdwListItemFactory,
} from '@gjsify/adwaita-core';

import { LIST_ITEM_LABEL_CLASS } from '../list-view-dom.js';

import { createGtkImage } from './gtk-image.js';
import { GtkListView } from './gtk-list-view.js';

/** A per-column renderer — `Gtk.ColumnViewColumn:factory`, keyed by the column's id. */
export type GtkColumnViewFactories = Readonly<Record<string, AdwListItemFactory<Node>>>;

export class GtkColumnView extends GtkListView {
    private _headerEl!: HTMLDivElement;
    private _columns: AdwColumnViewColumn[] = [];
    private _factories: GtkColumnViewFactories = {};
    private _sorter: AdwColumnViewSort | null = null;
    private _dragged: string | null = null;

    static get observedAttributes() {
        return [
            'model',
            'columns',
            'selection-mode',
            'single-click-activate',
            'enable-rubberband',
            'tab-behavior',
            'show-row-separators',
            'show-column-separators',
            'reorderable',
        ];
    }

    /** `Gtk.ColumnView:columns`, as descriptors rather than as a read-only `Gio.ListModel`. */
    get columns(): AdwColumnViewColumn[] {
        return this._columns.map((column) => ({ ...column }));
    }

    set columns(value: readonly AdwColumnViewColumn[] | null) {
        this._columns = normalizeColumnViewColumns(value);
        this._renderHeader();
        this._renderRows();
    }

    /** Per-column factories, keyed by `Gtk.ColumnViewColumn:id`. */
    get columnFactories(): GtkColumnViewFactories {
        return this._factories;
    }

    set columnFactories(value: GtkColumnViewFactories | null) {
        this._factories = value ?? {};
        this._renderRows();
    }

    /** `gtk_column_view_get_sorter`'s state — which column, which direction. */
    get sorter(): AdwColumnViewSort | null {
        return this._sorter === null ? null : { ...this._sorter };
    }

    set sorter(value: AdwColumnViewSort | null) {
        this._applySorter(value);
    }

    get showRowSeparators(): boolean {
        return this.hasAttribute('show-row-separators');
    }

    set showRowSeparators(value: boolean) {
        this.toggleAttribute('show-row-separators', !!value);
    }

    get showColumnSeparators(): boolean {
        return this.hasAttribute('show-column-separators');
    }

    set showColumnSeparators(value: boolean) {
        this.toggleAttribute('show-column-separators', !!value);
    }

    get reorderable(): boolean {
        return this.hasAttribute('reorderable');
    }

    set reorderable(value: boolean) {
        this.toggleAttribute('reorderable', !!value);
    }

    connectedCallback() {
        // ONCE, not per connect: a re-parent runs this again, and building a second header
        // left the view with two of them — caught by the re-parent suite, which compares
        // the subtree before and after a move.
        const first = this._headerEl === undefined;
        if (first) {
            this._columns = parseColumnViewColumns(this.getAttribute('columns'));
            this._headerEl = document.createElement('div');
            this._headerEl.className = 'adw-column-view-header';
            this._headerEl.setAttribute('role', 'row');
        }
        super.connectedCallback();
        // Before the rows, as `columnview > header` precedes `columnview > listview`.
        if (first) this.insertBefore(this._headerEl, this.firstChild);
        this._renderHeader();
        this._renderRows();
    }

    attributeChangedCallback(name?: string) {
        if (name === 'columns') {
            this._columns = parseColumnViewColumns(this.getAttribute('columns'));
            this._renderHeader();
            this._renderRows();
            return;
        }
        super.attributeChangedCallback(name);
    }

    protected override _applyAttributes(): void {
        super._applyAttributes();
        // `show-row-separators` is passed to the inner list view, which is what wears
        // `.separators`; `show-column-separators` is the column view's own class.
        this.classList.toggle('separators', this.showRowSeparators);
        this.classList.toggle('column-separators', this.showColumnSeparators);
        this.setAttribute('role', 'grid');
        this.removeAttribute('aria-multiselectable');
        // `Gtk.ColumnView` derives from `Gtk.Widget`, not `Gtk.ListBase`, and implements no
        // `GtkOrientable`: its rows always run down and its columns across. So the axis
        // class the base element carries is dropped rather than inherited, and
        // `observedAttributes` above lists no `orientation` for an author to set.
        this.classList.remove('horizontal');
        if (this._headerEl !== undefined) this._applyTracks(this._headerEl);
    }

    protected override get _viewClass(): string {
        return 'adw-column-view';
    }

    protected override get _rowClass(): string {
        return 'adw-column-view-row';
    }

    protected override _createRow(position: number): HTMLElement | null {
        const row = super._createRow(position);
        if (row === null) return null;
        row.setAttribute('role', 'row');
        // The base element put the factory's node straight into the row; a column view
        // puts one `cell` per column there instead.
        row.replaceChildren();
        const context = this._state.itemContext(position);
        if (context !== null) {
            for (const column of this._columns) {
                if (column.visible === false) continue;
                row.appendChild(this._createCell(column, context));
            }
        }
        this._applyTracks(row);
        return row;
    }

    /** One `cell`: the column's own factory, or the portable field its `key` names. */
    private _createCell(column: AdwColumnViewColumn, context: AdwListItemContext): HTMLElement {
        const cell = document.createElement('div');
        cell.className = 'adw-column-view-cell';
        cell.setAttribute('role', 'gridcell');
        const factory = this._factories[column.id ?? column.key];
        if (factory !== undefined) {
            cell.appendChild(factory(context));
        } else {
            const label = document.createElement('span');
            label.className = LIST_ITEM_LABEL_CLASS;
            label.textContent = listItemField(context.item, column.key);
            cell.appendChild(label);
        }
        return cell;
    }

    /** The header row — one button per visible column, with its sort indicator. */
    private _renderHeader(): void {
        if (this._headerEl === undefined) return;
        this._headerEl.replaceChildren();
        for (const column of this._columns) {
            if (column.visible === false) continue;
            this._headerEl.appendChild(this._createHeaderCell(column));
        }
        this._applyTracks(this._headerEl);
    }

    private _createHeaderCell(column: AdwColumnViewColumn): HTMLElement {
        const id = column.id ?? column.key;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'adw-column-view-header-cell';
        button.setAttribute('role', 'columnheader');
        button.dataset.columnId = id;

        const text = document.createElement('span');
        text.className = 'adw-column-view-header-title';
        text.textContent = column.title ?? column.key;
        button.appendChild(text);

        if (column.sortable === true) {
            const sorted = this._sorter !== null && this._sorter.column === id;
            // libadwaita draws `pan-up-symbolic` / `pan-down-symbolic` in a
            // `sort-indicator` node (_column-view.scss:52-62); this package's icon subset
            // carries `go-down`, and `.ascending` turns it over — the same substitution
            // `<adw-expander-row>` makes for its chevron.
            const indicator = createGtkImage('go-down', 'adw-column-view-sort-indicator');
            indicator.classList.toggle('ascending', sorted && !this._sorter!.descending);
            indicator.classList.toggle('descending', sorted && this._sorter!.descending);
            indicator.hidden = !sorted;
            button.appendChild(indicator);
            button.setAttribute('aria-sort', sorted ? (this._sorter!.descending ? 'descending' : 'ascending') : 'none');
            button.addEventListener('click', () => this._applySorter(columnViewSort(this._sorter, column)));
        } else {
            button.disabled = true;
        }

        if (this.reorderable) this._makeDraggable(button, id);
        return button;
    }

    /**
     * Column reordering by dragging a header — `Gtk.ColumnView:reorderable`.
     *
     * The HTML drag-and-drop events rather than a pointer drag, because the header is a
     * `<button>` and a pointer drag would have to suppress its own click; `draggable`
     * suppresses it for us, which is also what keeps a drag from sorting the column it
     * started on.
     */
    private _makeDraggable(button: HTMLElement, id: string): void {
        button.draggable = true;
        button.addEventListener('dragstart', (event) => {
            this._dragged = id;
            (event as DragEvent).dataTransfer?.setData('text/plain', id);
        });
        button.addEventListener('dragover', (event) => event.preventDefault());
        button.addEventListener('drop', (event) => {
            event.preventDefault();
            const from = this._columns.findIndex((column) => (column.id ?? column.key) === this._dragged);
            const to = this._columns.findIndex((column) => (column.id ?? column.key) === id);
            this._dragged = null;
            if (from < 0 || to < 0 || from === to) return;
            const moved = this._columns.splice(from, 1);
            this._columns.splice(to, 0, ...moved);
            this._renderHeader();
            this._renderRows();
        });
    }

    private _applySorter(next: AdwColumnViewSort | null): void {
        const same =
            (next === null && this._sorter === null) ||
            (next !== null &&
                this._sorter !== null &&
                next.column === this._sorter.column &&
                next.descending === this._sorter.descending);
        this._sorter = next === null ? null : { ...next };
        if (same) return;
        this._renderHeader();
        this.dispatchEvent(new CustomEvent('notify::sorter', { bubbles: true, detail: { sorter: this.sorter } }));
    }

    /** One track list for the header and every row, so the two cannot fall out of step. */
    private _applyTracks(element: HTMLElement): void {
        element.style.gridTemplateColumns = dataGridTrackTemplate(columnViewTracks(this._columns));
    }
}

customElements.define('gtk-column-view', GtkColumnView);
