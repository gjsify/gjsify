// GtkGrid — a container that lays its children out in rows and columns, for NativeScript.
//
// A REAL `GridLayout` whose tracks follow its children (`grid-state.ts`): every track is
// `auto`, or `*` when the matching `*-homogeneous` is set, and the list is rebuilt whenever a
// child is added, removed or moved. A child is placed by the platform's own `row` /
// `column` / `rowSpan` / `columnSpan` — the GTK spellings of `GtkGridLayoutChild`'s
// properties are NativeScript's own names on every view — so a `.blp`'s `layout { row: 1;
// column: 2; }`, an XML `row="1" column="2"` and `attach()` all reach the same four values,
// and the grid re-derives its tracks when any of them changes after the child was added.
//
// HOMOGENEOUS IS AN APPROXIMATION. GTK gives every track the size of the largest one; `*`
// tracks share whatever the grid is given, so they are equal but not minimal. Spacing is
// carried as an additive margin on the leading edges (`grid-state.ts`).
//
// `attach-next-to`, `insert-row` / `insert-column`, `remove-row` / `remove-column` and
// `baseline-row` have no counterpart.
//
// Reference: refs/gtk gtk/gtkgrid.c (GtkGrid)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GridLayout, ItemSpec, type View } from '@nativescript/core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { gridChildAt, gridGap, gridTrackCounts, gridSpacing, type GridPlacement } from './grid-state.js';
import { lengthValue } from './ns-length.js';
import { AdwStyledLayoutBase } from './styled-layout-base.js';
import { xmlBoolean, xmlNumber } from './xml-values.js';

/** The four events a placement write emits, one per property the platform registers. */
const PLACEMENT_EVENTS = ['colChange', 'rowChange', 'colSpanChange', 'rowSpanChange'] as const;

/** The gap a child carries from this grid, so it can be swapped rather than stacked. */
interface AppliedGap {
    left: number;
    top: number;
}

export class GtkGrid extends AdwStyledLayoutBase {
    private _rowSpacing = 0;
    private _columnSpacing = 0;
    private _rowHomogeneous = false;
    private _columnHomogeneous = false;
    // What the track list was last built for. NOT `_rows`/`_columns`: `GridLayoutBase` owns
    // `_rows` and assigns it in its constructor, and a subclass field of that name replaces it.
    private _columnKey = '';
    private _rowKey = '';
    private readonly _gaps = new Map<View, AppliedGap>();
    private readonly _followers = new Map<View, () => void>();

    constructor(props?: ConstructProps<GtkGrid>) {
        super();
        applyConstructProps(this, props);
    }

    // --- child list ---

    /**
     * Put `child` in the grid at `(column, row)`, spanning `width` columns and `height` rows
     * — `gtk_grid_attach`.
     */
    attach(child: View, column: number, row: number, width = 1, height = 1): void {
        child.column = column;
        child.row = row;
        child.columnSpan = width;
        child.rowSpan = height;
        this.addChild(child);
    }

    /** `gtk_grid_remove`. */
    remove(child: View): void {
        this.removeChild(child);
    }

    /** `gtk_grid_get_child_at` — the child covering `(column, row)`, or `null`. */
    get_child_at(column: number, row: number): View | null {
        return gridChildAt(this._placed(), column, row);
    }

    /**
     * Every path a child can enter by — `attach()`, a direct `addChild()`, and XML
     * inflation through `_addChildFromBuilder` — ends here, so the tracks and the gaps
     * are derived here.
     */
    addChild(view: View): void {
        super.addChild(view);
        this._follow(view);
        this._relayout();
    }

    insertChild(child: View, atIndex: number): void {
        super.insertChild(child, atIndex);
        this._follow(child);
        this._relayout();
    }

    removeChild(view: View): void {
        this._unfollow(view);
        super.removeChild(view);
        this._relayout();
    }

    // --- properties ---

    /** `Gtk.Grid:row-spacing` — the gap between rows, in DIPs. */
    get rowSpacing(): number {
        return this._rowSpacing;
    }

    set rowSpacing(value: number | string) {
        const next = gridSpacing(xmlNumber(value, Number.NaN), value, this._rowSpacing, 'rowSpacing');
        if (next === this._rowSpacing) return;
        this._rowSpacing = next;
        this._relayout();
    }

    /** `Gtk.Grid:column-spacing` — the gap between columns, in DIPs. */
    get columnSpacing(): number {
        return this._columnSpacing;
    }

    set columnSpacing(value: number | string) {
        const next = gridSpacing(xmlNumber(value, Number.NaN), value, this._columnSpacing, 'columnSpacing');
        if (next === this._columnSpacing) return;
        this._columnSpacing = next;
        this._relayout();
    }

    /** `Gtk.Grid:row-homogeneous` — every row the same height (`*` tracks). */
    get rowHomogeneous(): boolean {
        return this._rowHomogeneous;
    }

    set rowHomogeneous(value: boolean | string) {
        const next = xmlBoolean(value, this._rowHomogeneous);
        if (next === this._rowHomogeneous) return;
        this._rowHomogeneous = next;
        this._relayout();
    }

    /** `Gtk.Grid:column-homogeneous` — every column the same width (`*` tracks). */
    get columnHomogeneous(): boolean {
        return this._columnHomogeneous;
    }

    set columnHomogeneous(value: boolean | string) {
        const next = xmlBoolean(value, this._columnHomogeneous);
        if (next === this._columnHomogeneous) return;
        this._columnHomogeneous = next;
        this._relayout();
    }

    // --- layout ---

    private _childViews(): View[] {
        const views: View[] = [];
        for (let index = 0; index < this.getChildrenCount(); index++) views.push(this.getChildAt(index));
        return views;
    }

    private _placementOf(view: View): GridPlacement {
        return {
            column: GridLayout.getColumn(view),
            row: GridLayout.getRow(view),
            columnSpan: GridLayout.getColumnSpan(view),
            rowSpan: GridLayout.getRowSpan(view),
        };
    }

    private _placed(): { child: View; placement: GridPlacement }[] {
        return this._childViews().map((child) => ({ child, placement: this._placementOf(child) }));
    }

    /** Re-derive the tracks when a child moves after it was added. */
    private _follow(view: View): void {
        if (this._followers.has(view)) return;
        const follower = () => this._relayout();
        this._followers.set(view, follower);
        for (const eventName of PLACEMENT_EVENTS) view.addEventListener(eventName, follower);
    }

    private _unfollow(view: View): void {
        const follower = this._followers.get(view);
        if (follower === undefined) return;
        for (const eventName of PLACEMENT_EVENTS) view.removeEventListener(eventName, follower);
        this._followers.delete(view);
        this._withGap(view, { left: 0, top: 0 });
        this._gaps.delete(view);
    }

    /** Make the margin carry `next` of this grid's gap, in place of whatever share it had. */
    private _withGap(view: View, next: AppliedGap): void {
        const previous = this._gaps.get(view) ?? { left: 0, top: 0 };
        if (previous.left !== next.left) {
            view.marginLeft = (lengthValue(view.marginLeft) ?? 0) - previous.left + next.left;
        }
        if (previous.top !== next.top) {
            view.marginTop = (lengthValue(view.marginTop) ?? 0) - previous.top + next.top;
        }
        this._gaps.set(view, next);
    }

    private _relayout(): void {
        const placed = this._placed();
        const { columns, rows } = gridTrackCounts(placed.map(({ placement }) => placement));
        this._syncTracks(columns, rows);
        for (const { child, placement } of placed) {
            this._withGap(child, gridGap(placement, this._columnSpacing, this._rowSpacing));
        }
    }

    /**
     * Rebuild a track list only when it differs: removing and re-adding every `ItemSpec`
     * makes the platform re-measure, which is wasted on a grid that did not change shape.
     */
    private _syncTracks(columns: number, rows: number): void {
        const columnKey = `${columns}:${this._columnHomogeneous}`;
        const rowKey = `${rows}:${this._rowHomogeneous}`;
        if (columnKey !== this._columnKey) {
            this.removeColumns();
            for (let index = 0; index < columns; index++) {
                this.addColumn(new ItemSpec(1, this._columnHomogeneous ? 'star' : 'auto'));
            }
            this._columnKey = columnKey;
        }
        if (rowKey !== this._rowKey) {
            this.removeRows();
            for (let index = 0; index < rows; index++) {
                this.addRow(new ItemSpec(1, this._rowHomogeneous ? 'star' : 'auto'));
            }
            this._rowKey = rowKey;
        }
    }
}
