// <adw-data-grid> — A slim, Adwaita-styled ALIGNED data grid: the web mirror of the
// native Gtk.Grid an accounting app uses for its financial statements (BWA / P&L,
// invoice line-items). DELIBERATELY NOT a heavyweight sortable Gtk.ColumnView /
// TreeView — boxed lists (<adw-action-row> inside <adw-preferences-group>) stay the
// default for record lists. Reach for this ONLY for genuinely tabular numeric data
// where columns of figures must line up, with the accounting row emphasis a statement
// needs: section headers, subtotals and a bold final total.
//
// PRESENTATIONAL ONLY: layout, alignment and emphasis, never formatting or sorting.
// Cell values are PRE-FORMATTED strings (locale currency formatting stays in the app,
// e.g. `1.234,50 €`); sorting is a data op driven externally, so there are no
// clickable-sortable column headers here.
//
// Columns (the `columns` property, or a JSON `columns` attribute):
//   { key, label?, align?, width?, flex?, monospace?, numeric? }
//     key       — the row-object key this column reads.
//     label     — header text (defaults to `key`).
//     align     — 'start' | 'end' | 'center' (default 'start'; a `numeric`
//                 column defaults to 'end' so figures right-align).
//     width     — a fixed CSS track size ('80px', '6rem') — pins the column.
//     flex      — a fractional track weight (→ `<flex>fr`) — grows the column.
//     monospace — render cells in a monospace family (tabular figures either way).
//     numeric   — convenience: right-aligns + applies tabular-nums (the point of
//                 the grid vs a boxed list — numeric columns of figures line up).
//   With neither width nor flex declared anywhere, the FIRST column absorbs the
//   slack (so trailing numeric columns hug the right edge) and the rest size to
//   content — the faithful "label left, amounts right" statement shape.
//
// Rows (the `rows` property, or a JSON `rows` attribute) — row objects keyed by
// column key, PLUS optional accounting metadata:
//   variant?     — 'normal' | 'section' | 'subtotal' | 'total'
//     section  — a bold group header spanning all columns (its text = the value
//                under the FIRST column's key). Nests a BWA into its sections.
//     subtotal — bold, with a hairline rule above (Gesamtleistung, Rohertrag…).
//     total    — bold + a stronger rule above (the final result — Betriebsergebnis).
//     normal   — a plain data row (the default).
//   interactive? — make just this row clickable (see `row-activated`).
//
// Attributes / properties:
//   caption      — an optional title shown above the grid.
//   interactive  — element-level flag: every `normal` row becomes clickable
//                  (a row may opt out with `interactive: false`); mainly for a
//                  master-detail list. Section/subtotal/total rows never activate.
// Events:
//   `row-activated` (CustomEvent, bubbles, detail = { index, row }) — a clickable
//     row was activated by click or Enter/Space. `index` is the row's index in
//     the `rows` array; `row` is the original row object.
// Responsive: the grid scrolls horizontally within its OWN container on narrow
//   viewports (it never overflows the page); it sits inside an <adw-card>/boxed
//   surface and follows light + dark via the adwaita-web CSS variables.
// The derivations are HEADLESS and live in `@gjsify/adwaita-core` (ADR 0004): the
// column tracks, the cell classes, the two normalisers, the cell text and the activation
// rule. `@gjsify/adwaita-nativescript` renders the same widget over `GridLayout`
// `ItemSpec`s — NativeScript has no subgrid — so the TRACK rule is a renderer-neutral
// descriptor and only the mapping onto `grid-template-columns` stays here. The NativeScript
// suite is held to DATA_GRID_TRACK_VECTORS, DATA_GRID_COLUMN_CLASS_VECTORS,
// DATA_GRID_VARIANT_VECTORS, DATA_GRID_CELL_TEXT_VECTORS and DATA_GRID_INTERACTIVE_VECTORS.
// This element is held to none of them — the browser half of the shared derivation is
// asserted only against itself, which is the gap, not the arrangement.
// Reference: Gtk.Grid usage in the Buchhaltung BWA view (native financial grid).
// Reference: refs/libadwaita/src/stylesheet/_colors.scss (separator / card tokens).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

import {
    dataGridCellText,
    dataGridColumnClasses,
    dataGridRowInteractive,
    dataGridTrackTemplate,
    dataGridTracks,
    normalizeDataGridColumns,
    normalizeDataGridVariant,
} from '@gjsify/adwaita-core';
import type { AdwDataGridColumn, AdwDataGridRow } from '@gjsify/adwaita-core';

export type {
    AdwDataGridAlign,
    AdwDataGridCellValue,
    AdwDataGridColumn,
    AdwDataGridRow,
    AdwDataGridRowVariant,
} from '@gjsify/adwaita-core';

export class AdwDataGrid extends HTMLElement {
    private _captionEl!: HTMLDivElement;
    private _scrollEl!: HTMLDivElement;
    private _tableEl!: HTMLDivElement;
    private _columns: AdwDataGridColumn[] = [];
    private _rows: AdwDataGridRow[] = [];
    private _initialized = false;

    static get observedAttributes() {
        return ['columns', 'rows', 'caption', 'interactive'];
    }

    get columns(): AdwDataGridColumn[] {
        return this._columns;
    }

    set columns(value: ReadonlyArray<AdwDataGridColumn>) {
        this._columns = normalizeDataGridColumns(value);
        if (this._initialized) this._render();
    }

    get rows(): AdwDataGridRow[] {
        return this._rows;
    }

    set rows(value: ReadonlyArray<AdwDataGridRow>) {
        this._rows = Array.isArray(value) ? value.map((r) => ({ ...r })) : [];
        if (this._initialized) this._render();
    }

    /** The optional grid caption/title (reflected to the attribute). */
    get caption(): string {
        return this.getAttribute('caption') ?? '';
    }

    set caption(value: string) {
        if (value) this.setAttribute('caption', value);
        else this.removeAttribute('caption');
    }

    get interactive(): boolean {
        return this.hasAttribute('interactive');
    }

    set interactive(value: boolean) {
        if (value) this.setAttribute('interactive', '');
        else this.removeAttribute('interactive');
    }

    connectedCallback() {
        if (this._initialized) return;
        this._initialized = true;

        this.classList.add('adw-data-grid');

        this._captionEl = document.createElement('div');
        this._captionEl.className = 'adw-data-grid-caption';
        this._captionEl.hidden = true;

        this._scrollEl = document.createElement('div');
        this._scrollEl.className = 'adw-data-grid-scroll';

        this._tableEl = document.createElement('div');
        this._tableEl.className = 'adw-data-grid-table';
        this._tableEl.setAttribute('role', 'table');
        this._scrollEl.appendChild(this._tableEl);

        // Seed from JSON attributes only when the properties were not set.
        if (this._columns.length === 0) this._columns = this._parseJsonAttr('columns', normalizeDataGridColumns);
        if (this._rows.length === 0) this._rows = this._parseJsonAttr('rows', (v) => (Array.isArray(v) ? v : []));

        this.replaceChildren(this._captionEl, this._scrollEl);
        this._render();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'columns') {
            this._columns = this._parseJsonAttr('columns', normalizeDataGridColumns);
            this._render();
        } else if (name === 'rows') {
            this._rows = this._parseJsonAttr('rows', (v) => (Array.isArray(v) ? (v as AdwDataGridRow[]) : []));
            this._render();
        } else if (name === 'caption') {
            this._renderCaption();
        } else if (name === 'interactive') {
            this._render();
        }
        void value;
    }

    private _parseJsonAttr<T>(name: string, coerce: (v: unknown) => T): T {
        const raw = this.getAttribute(name);
        if (!raw) return coerce(undefined);
        try {
            return coerce(JSON.parse(raw) as unknown);
        } catch {
            return coerce(undefined);
        }
    }

    private _renderCaption(): void {
        const caption = this.getAttribute('caption') ?? '';
        this._captionEl.textContent = caption;
        this._captionEl.hidden = caption.length === 0;
    }

    /**
     * The CSS `grid-template-columns` value derived from the column descriptors. The
     * DERIVATION is core's (`dataGridTracks`), because NativeScript needs the same one for
     * its `ItemSpec`s and can do nothing with a CSS string; the mapping onto CSS text —
     * including the `minmax(0px, 1fr)` slack track whose `0px` must keep its unit to
     * round-trip through the CSSOM — is `dataGridTrackTemplate`.
     */
    private _trackTemplate(): string {
        return dataGridTrackTemplate(dataGridTracks(this._columns));
    }

    private _columnClasses(column: AdwDataGridColumn): string {
        return dataGridColumnClasses(column).join(' ');
    }

    private _render(): void {
        if (!this._tableEl) return;
        this._renderCaption();
        this._tableEl.style.gridTemplateColumns = this._trackTemplate();
        this._tableEl.replaceChildren();

        const columnCount = this._columns.length;
        if (columnCount === 0) return;

        const header = document.createElement('div');
        header.className = 'adw-data-grid-row header';
        header.setAttribute('role', 'row');
        for (const column of this._columns) {
            const cell = document.createElement('div');
            cell.className = `${this._columnClasses(column)} header-cell`;
            cell.setAttribute('role', 'columnheader');
            cell.textContent = column.label ?? column.key;
            header.appendChild(cell);
        }
        this._tableEl.appendChild(header);

        const elementInteractive = this.hasAttribute('interactive');

        this._rows.forEach((rowData, index) => {
            const variant = normalizeDataGridVariant(rowData.variant);
            const row = document.createElement('div');
            row.className = `adw-data-grid-row variant-${variant}`;
            row.setAttribute('role', 'row');

            if (variant === 'section') {
                // A section header spans all columns; its text is the first column's
                // value (the section title).
                const firstKey = this._columns[0]?.key ?? '';
                const cell = document.createElement('div');
                cell.className = 'adw-data-grid-cell align-start section-cell';
                cell.setAttribute('role', 'cell');
                cell.style.gridColumn = '1 / -1';
                cell.textContent = dataGridCellText(rowData[firstKey]);
                row.appendChild(cell);
            } else {
                for (const column of this._columns) {
                    const cell = document.createElement('div');
                    cell.className = this._columnClasses(column);
                    cell.setAttribute('role', 'cell');
                    cell.textContent = dataGridCellText(rowData[column.key]);
                    row.appendChild(cell);
                }
            }

            // A row is clickable only when it is a plain data row AND either the element
            // opts everything in or the row opts itself in.
            if (dataGridRowInteractive(variant, rowData.interactive, elementInteractive)) {
                row.classList.add('interactive');
                row.tabIndex = 0;
                row.addEventListener('click', () => this._activate(index, rowData));
                row.addEventListener('keydown', (event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        this._activate(index, rowData);
                    }
                });
            }

            this._tableEl.appendChild(row);
        });
    }

    private _activate(index: number, row: AdwDataGridRow): void {
        this.dispatchEvent(new CustomEvent('row-activated', { bubbles: true, detail: { index, row } }));
    }
}

customElements.define('adw-data-grid', AdwDataGrid);
