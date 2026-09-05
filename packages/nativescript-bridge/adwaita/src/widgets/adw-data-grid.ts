// AdwDataGrid — a Libadwaita-styled ALIGNED data grid for NativeScript.
//
// The native mirror of `<adw-data-grid>`: the slim grid an accounting app fills
// for a financial statement (a BWA / P&L, invoice line-items) — labels left,
// amounts right-aligned, with the section / subtotal / total emphasis a
// statement needs. DELIBERATELY NOT a sortable column view; boxed lists
// (`AdwActionRow` inside `AdwPreferencesGroup`) stay the default for record
// lists. Cell values are PRE-FORMATTED strings: the grid aligns, it never
// formats or sorts.
//
// ONE GRID, CELLS AS DIRECT CHILDREN. The browser aligns columns with CSS
// `subgrid`; NativeScript has none, and the obvious transcription — a
// `StackLayout` of per-row `GridLayout`s — cannot work, because each row would
// resolve its own `auto` tracks from its OWN content and the figures would
// stagger. So this IS the grid: one `GridLayout`, one set of column tracks, every
// cell a direct child. What the per-row element bought comes back because
// NativeScript lets children share a cell: each row gets a full-width
// `StackLayout` placed FIRST at the same row with `setColumnSpan(columns.length)`
// — under the cells in paint order — carrying the background, the hairline rule
// above a subtotal/total, the tap target and {@link attachRowPressFeedback}.
//
// UNVERIFIED ON DEVICE (no device in this environment):
//   - a tap landing on a CELL is expected to fall through to the row background
//     behind it; every other activatable row here puts its listener on the
//     ANCESTOR of its labels, so this SIBLING fall-through has no precedent.
//   - the caller is expected to wrap this in a HORIZONTAL `ScrollView`, nested
//     inside the vertical one a page scrolls with — a known NativeScript gesture
//     conflict that no other widget here exercises.
//
// No `caption`: as a spanning child it would widen the tracks, since NativeScript
// cannot exclude a child from track sizing — the caller owns the title above the
// `ScrollView`. `columns` / `rows` are set from CODE; the element is registered so
// it can be PLACED in markup, structured data arrives from the code-behind, as for
// `AdwComboRow.model`.
//
// FIDELITY: approximated, typographically. libadwaita's `.numeric` is
// `font-variant-numeric: tabular-nums` and the NativeScript CSS subset has no
// font-feature property, so a numeric column gets the right EDGE but proportional
// digits. `monospace: true` is the way to real tabular figures here, which is why
// the column property exists on this renderer.
//
// The derivations — which column is fixed, which absorbs the slack, what a cell
// paints, which rows activate — are HEADLESS in `@gjsify/adwaita-core` (ADR 0004),
// held to its `DATA_GRID_*_VECTORS`. The NativeScript half of the mapping is in
// the pure sibling `data-grid-model.ts`, because this class `extends GridLayout`
// and therefore cannot be imported by a spec.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_labels.scss
//            (`.monospace` / `.numeric { font-variant-numeric: tabular-nums }`)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: the grid itself is a @gjsify/adwaita-* widget, not a port.

import { GridLayout, ItemSpec, Label, StackLayout, type EventData } from '@nativescript/core';
import {
    dataGridCellText,
    dataGridColumnClasses,
    dataGridRowInteractive,
    dataGridTracks,
    normalizeDataGridColumns,
    normalizeDataGridVariant,
} from '@gjsify/adwaita-core';
import type { AdwDataGridColumn, AdwDataGridRow } from '@gjsify/adwaita-core';
import { attachRowPressFeedback } from './row-press.js';
import {
    DATA_GRID_HEADER_CELL_CLASS,
    DATA_GRID_HEADER_ROW_CLASS,
    DATA_GRID_SECTION_CELL_CLASS,
    dataGridCellClass,
    dataGridItemSpec,
    dataGridRowClass,
    dataGridShapeKey,
    dataGridTracksKey,
} from './data-grid-model.js';
import { xmlBoolean } from './xml-values.js';

/** Event name emitted when an interactive row is tapped. Mirrors the browser's `row-activated`. */
export const ROW_ACTIVATED = 'row-activated';

/** Payload of the `row-activated` event. */
export interface RowActivatedEventData extends EventData {
    /** The row's index in the `rows` array. */
    index: number;
    row: AdwDataGridRow;
}

/** The views one grid row owns: its full-width background and its cells. */
interface DataGridRowNodes {
    /** Spans every column UNDER the cells — background, rules, tap target. */
    background: StackLayout;
    /** One label per column, whatever the row's variant. */
    cells: Label[];
}

export class AdwDataGrid extends GridLayout {
    private _columns: AdwDataGridColumn[] = [];
    private _rows: AdwDataGridRow[] = [];
    private _interactive = false;
    /** The header row's nodes, or `null` while there are no columns. */
    private _header: DataGridRowNodes | null = null;
    /** One entry per data row, index-aligned with {@link _rows}. */
    private _rowNodes: DataGridRowNodes[] = [];
    /** The tracks the declared columns were built from — the re-declare guard. */
    private _trackKey = '';
    /** The columns×rows the views were built for — the rebuild guard. */
    private _shapeKey = '';

    constructor() {
        super();
        this.className = 'adw-data-grid';
    }

    /** The column descriptors. Setting them re-derives the tracks. */
    get columns(): AdwDataGridColumn[] {
        return this._columns;
    }

    set columns(value: ReadonlyArray<AdwDataGridColumn>) {
        this._columns = normalizeDataGridColumns(value);
        this._render();
    }

    /** The row objects (copied, like the browser element does). */
    get rows(): AdwDataGridRow[] {
        return this._rows;
    }

    set rows(value: ReadonlyArray<AdwDataGridRow>) {
        this._rows = Array.isArray(value) ? value.map((row) => ({ ...row })) : [];
        this._render();
    }

    /**
     * Whether every `normal` row is tappable (a row may still opt out with
     * `interactive: false`). Section / subtotal / total rows never activate.
     *
     * A REPAINT, not a rebuild: the flag changes which rows carry the
     * `interactive` class and answer a tap, and nothing about the layout.
     */
    get interactive(): boolean {
        return this._interactive;
    }

    set interactive(raw: boolean | string) {
        const value = xmlBoolean(raw, this.interactive);
        this._interactive = !!value;
        this._paint();
    }

    private _render(): void {
        this._syncColumns();
        this._syncNodes();
        this._paint();
    }

    /**
     * (Re)declare the column tracks from the descriptors.
     *
     * Guarded on the derived tracks rather than run on every render: re-declaring
     * invalidates the layout, and a data change must not move the columns.
     */
    private _syncColumns(): void {
        const tracks = dataGridTracks(this._columns);
        const key = dataGridTracksKey(tracks);
        if (key === this._trackKey) return;
        this._trackKey = key;
        this.removeColumns();
        for (const track of tracks) {
            const spec = dataGridItemSpec(track);
            this.addColumn(new ItemSpec(spec.value, spec.type));
        }
    }

    /**
     * Rebuild the cell views when the grid's SHAPE moves, and only then — replacing
     * the row under the user's finger on every data update would drop the press
     * state mid-touch.
     */
    private _syncNodes(): void {
        const columnCount = this._columns.length;
        const key = dataGridShapeKey(columnCount, this._rows.length);
        if (key === this._shapeKey) return;
        this._shapeKey = key;

        for (const nodes of [this._header, ...this._rowNodes]) {
            if (nodes === null) continue;
            this.removeChild(nodes.background);
            for (const cell of nodes.cells) this.removeChild(cell);
        }
        this._header = null;
        this._rowNodes = [];
        this.removeRows();
        if (columnCount === 0) return;

        // One `auto` row per line: a row is as tall as its tallest cell, which is
        // the boxed-list rhythm the cell padding sets.
        this.addRow(new ItemSpec(1, 'auto'));
        this._header = this._buildRow(0, columnCount, false);
        this._rowNodes = this._rows.map((_row, index) => {
            this.addRow(new ItemSpec(1, 'auto'));
            return this._buildRow(index + 1, columnCount, true);
        });
    }

    /** Build one row: the spanning background first, then a cell per column. */
    private _buildRow(row: number, columnCount: number, activatable: boolean): DataGridRowNodes {
        const background = new StackLayout();
        GridLayout.setRow(background, row);
        GridLayout.setColumn(background, 0);
        GridLayout.setColumnSpan(background, columnCount);
        // FIRST — NativeScript paints children in add order, so everything added
        // after this lands on top of it.
        this.addChild(background);

        if (activatable) {
            // Both are wired unconditionally and gated at activation time: a row's
            // interactivity is DATA (its variant, its own flag, the grid's flag)
            // and changes on a repaint, which must not add or drop listeners. The
            // press-darken is gated by CSS instead — a non-interactive row gets a
            // `highlighted` pseudo-class no rule claims.
            attachRowPressFeedback(background);
            background.addEventListener('tap', () => this._activate(row - 1));
        }

        const cells: Label[] = [];
        for (let column = 0; column < columnCount; column++) {
            const cell = new Label();
            // Single-line, like the browser's `white-space: nowrap`: a wrapped
            // figure column stops being a column of figures.
            cell.textWrap = false;
            GridLayout.setRow(cell, row);
            GridLayout.setColumn(cell, column);
            this.addChild(cell);
            cells.push(cell);
        }
        return { background, cells };
    }

    /** Repaint text + classes from the current data. Never structural. */
    private _paint(): void {
        const header = this._header;
        if (header === null) return;

        header.background.className = DATA_GRID_HEADER_ROW_CLASS;
        this._columns.forEach((column, index) => {
            const cell = header.cells[index];
            if (cell === undefined) return;
            cell.className = `${dataGridColumnClasses(column).join(' ')} ${DATA_GRID_HEADER_CELL_CLASS}`;
            cell.text = column.label ?? column.key;
            this._showCell(cell, 1);
        });

        this._rows.forEach((rowData, index) => {
            const nodes = this._rowNodes[index];
            if (nodes === undefined) return;
            const variant = normalizeDataGridVariant(rowData.variant);
            const interactive = dataGridRowInteractive(variant, rowData.interactive, this._interactive);
            nodes.background.className = dataGridRowClass(variant, interactive);

            if (variant === 'section') {
                // A section header spans all columns; its text is the FIRST column's
                // value. The remaining cells are collapsed rather than removed so
                // the variant stays a repaint — and a collapsed child is not
                // measured, so stale text cannot widen a content-sized column.
                const firstKey = this._columns[0]?.key ?? '';
                nodes.cells.forEach((cell, column) => {
                    if (column === 0) {
                        cell.className = DATA_GRID_SECTION_CELL_CLASS;
                        cell.text = dataGridCellText(rowData[firstKey]);
                        this._showCell(cell, this._columns.length);
                    } else {
                        cell.text = '';
                        cell.visibility = 'collapse';
                        GridLayout.setColumnSpan(cell, 1);
                    }
                });
                return;
            }

            this._columns.forEach((column, columnIndex) => {
                const cell = nodes.cells[columnIndex];
                if (cell === undefined) return;
                cell.className = dataGridCellClass(dataGridColumnClasses(column), variant);
                cell.text = dataGridCellText(rowData[column.key]);
                this._showCell(cell, 1);
            });
        });
    }

    /** Un-collapse a cell and set its span — the inverse of the section branch. */
    private _showCell(cell: Label, span: number): void {
        cell.visibility = 'visible';
        GridLayout.setColumnSpan(cell, span);
    }

    /**
     * Emit `row-activated` for a tapped row — if it activates at all.
     *
     * The gate is re-evaluated here rather than at wiring time, and it reads the
     * CURRENT row object: the listener outlives a `rows` assignment of the same
     * length, so a captured row would be the previous data set's.
     */
    private _activate(index: number): void {
        const rowData = this._rows[index];
        if (rowData === undefined) return;
        const variant = normalizeDataGridVariant(rowData.variant);
        if (!dataGridRowInteractive(variant, rowData.interactive, this._interactive)) return;
        const data: RowActivatedEventData = {
            eventName: ROW_ACTIVATED,
            object: this,
            index,
            row: rowData,
        };
        this.notify(data);
    }
}
