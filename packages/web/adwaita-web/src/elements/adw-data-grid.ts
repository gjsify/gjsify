// <adw-data-grid> — A slim, Adwaita-styled ALIGNED data grid: the web mirror of
// the native Gtk.Grid an accounting app (Buchhaltung) uses for its financial
// statements (the BWA / P&L, invoice line-items). It is DELIBERATELY NOT a
// heavyweight sortable Gtk.ColumnView / TreeView — boxed lists (<adw-action-row>
// inside <adw-preferences-group>) stay the default for record lists. Reach for
// this ONLY for genuinely tabular numeric data where columns of figures must
// line up (labels left, amounts right-aligned with tabular figures), with the
// accounting row emphasis a statement needs: section headers, subtotals and a
// bold final total.
//
// It is a PLAIN presentational element — it does layout, alignment and emphasis;
// it never formats or sorts. Cell values are PRE-FORMATTED strings (locale
// currency formatting stays in the app, e.g. `1.234,50 €`); the grid renders the
// strings and aligns them. Sorting is a data op driven externally (e.g. an
// <adw-drop-down>) — there are no clickable-sortable column headers here.
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
// Reference: Gtk.Grid usage in the Buchhaltung BWA view (native financial grid).
// Reference: refs/libadwaita/src/stylesheet/_colors.scss (separator / card tokens).
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: Implemented as a Web Component for @gjsify/adwaita-web.

/** Horizontal alignment of a column's header + cells. */
export type AdwDataGridAlign = 'start' | 'end' | 'center';

/** Accounting row emphasis. `normal` is the default plain data row. */
export type AdwDataGridRowVariant = 'normal' | 'section' | 'subtotal' | 'total';

/** A column descriptor — what to read (`key`), how to label + align it. */
export interface AdwDataGridColumn {
    /** The row-object key this column renders. */
    key: string;
    /** Header text (defaults to `key`). */
    label?: string;
    /** 'start' | 'end' | 'center'. Defaults to 'start' (or 'end' when numeric). */
    align?: AdwDataGridAlign;
    /** Fixed CSS track size (e.g. '80px', '6rem') — pins the column width. */
    width?: string;
    /** Fractional track weight (→ `<flex>fr`) — lets the column grow. */
    flex?: number;
    /** Render cells in a monospace family (tabular figures apply regardless). */
    monospace?: boolean;
    /** Convenience: right-align + tabular-nums (numeric columns of figures). */
    numeric?: boolean;
}

/** A row: cell values keyed by column key + optional accounting metadata. */
export interface AdwDataGridRow {
    /** Accounting emphasis. Default 'normal'. */
    variant?: AdwDataGridRowVariant;
    /** Make just this row clickable (overrides the element-level flag). */
    interactive?: boolean;
    /** Cell values keyed by column key (pre-formatted strings, or numbers). */
    [key: string]: string | number | boolean | AdwDataGridRowVariant | undefined;
}

const VARIANTS: ReadonlySet<string> = new Set(['normal', 'section', 'subtotal', 'total']);

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

    /** The column descriptors. Setting rebuilds the grid. */
    get columns(): AdwDataGridColumn[] {
        return this._columns;
    }

    set columns(value: ReadonlyArray<AdwDataGridColumn>) {
        this._columns = normalizeColumns(value);
        if (this._initialized) this._render();
    }

    /** The row objects. Setting rebuilds the body. */
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

    /** Whether every `normal` row is clickable (element-level flag). */
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
        if (this._columns.length === 0) this._columns = this._parseJsonAttr('columns', normalizeColumns);
        if (this._rows.length === 0) this._rows = this._parseJsonAttr('rows', (v) => (Array.isArray(v) ? v : []));

        this.replaceChildren(this._captionEl, this._scrollEl);
        this._render();
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null) {
        if (!this._initialized) return;
        if (name === 'columns') {
            this._columns = this._parseJsonAttr('columns', normalizeColumns);
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

    // ── internals ──────────────────────────────────────────────────────────

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

    /** The CSS `grid-template-columns` value derived from the column descriptors. */
    private _trackTemplate(): string {
        const anyExplicit = this._columns.some((c) => c.width !== undefined || c.flex !== undefined);
        return this._columns
            .map((column, index) => {
                if (column.width !== undefined) return column.width;
                if (column.flex !== undefined) return `${column.flex}fr`;
                // With no explicit sizing anywhere, the first (label) column
                // absorbs slack so trailing numeric columns hug the right edge.
                // `0px` (not `0`) is the CSSOM-canonical form so it round-trips.
                if (!anyExplicit && index === 0) return 'minmax(0px, 1fr)';
                return 'auto';
            })
            .join(' ');
    }

    private _columnClasses(column: AdwDataGridColumn): string {
        const align: AdwDataGridAlign = column.align ?? (column.numeric ? 'end' : 'start');
        const classes = ['adw-data-grid-cell', `align-${align}`];
        if (column.numeric) classes.push('numeric');
        if (column.monospace) classes.push('mono');
        return classes.join(' ');
    }

    private _render(): void {
        if (!this._tableEl) return;
        this._renderCaption();
        this._tableEl.style.gridTemplateColumns = this._trackTemplate();
        this._tableEl.replaceChildren();

        const columnCount = this._columns.length;
        if (columnCount === 0) return;

        // Header row (dim, small-caps) — column labels, aligned per column.
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
            const variant = normalizeVariant(rowData.variant);
            const row = document.createElement('div');
            row.className = `adw-data-grid-row variant-${variant}`;
            row.setAttribute('role', 'row');

            if (variant === 'section') {
                // A section header spans all columns; its text is the first
                // column's value (the section title).
                const firstKey = this._columns[0]?.key ?? '';
                const cell = document.createElement('div');
                cell.className = 'adw-data-grid-cell align-start section-cell';
                cell.setAttribute('role', 'cell');
                cell.style.gridColumn = '1 / -1';
                cell.textContent = cellText(rowData[firstKey]);
                row.appendChild(cell);
            } else {
                for (const column of this._columns) {
                    const cell = document.createElement('div');
                    cell.className = this._columnClasses(column);
                    cell.setAttribute('role', 'cell');
                    cell.textContent = cellText(rowData[column.key]);
                    row.appendChild(cell);
                }
            }

            // A row is clickable only when it is a plain data row AND either the
            // element opts everything in or the row opts itself in.
            const rowInteractive =
                variant === 'normal' &&
                rowData.interactive !== false &&
                (rowData.interactive === true || elementInteractive);
            if (rowInteractive) {
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

/** Coerce a cell value to display text — pre-formatted strings pass through. */
function cellText(value: string | number | boolean | AdwDataGridRowVariant | undefined): string {
    if (value === undefined || value === null) return '';
    return String(value);
}

/** Clamp an arbitrary variant to the known set (unknown → 'normal'). */
function normalizeVariant(variant: unknown): AdwDataGridRowVariant {
    return typeof variant === 'string' && VARIANTS.has(variant) ? (variant as AdwDataGridRowVariant) : 'normal';
}

/** Normalise raw column descriptors to a stable list (drops malformed entries). */
function normalizeColumns(raw: unknown): AdwDataGridColumn[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((c): c is AdwDataGridColumn => typeof c === 'object' && c !== null && 'key' in c)
        .map((c) => ({
            key: String(c.key),
            label: c.label !== undefined ? String(c.label) : undefined,
            align: c.align,
            width: c.width !== undefined ? String(c.width) : undefined,
            flex: typeof c.flex === 'number' ? c.flex : undefined,
            monospace: c.monospace === true,
            numeric: c.numeric === true,
        }));
}

customElements.define('adw-data-grid', AdwDataGrid);
