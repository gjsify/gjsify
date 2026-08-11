// Data-grid layout mapping for NativeScript — the pure half.
//
// NativeScript has no CSS `subgrid`, so `AdwDataGrid` is ONE `GridLayout` whose CELLS
// are direct children (see `adw-data-grid.ts`). This module holds the two parts of
// that mapping a spec can pin: the `DataGridTrack` → `ItemSpec` numbers and the
// rebuild guard keys; the `ItemSpec` OBJECT is constructed in the widget, the same
// seam `splitViewColumns()` uses. The derivations one level up — which column is
// fixed, which absorbs the slack, what a cell paints, whether a row activates — live
// in `@gjsify/adwaita-core` (ADR 0004), held to its `DATA_GRID_*_VECTORS`.
//
// No `@nativescript/core` VALUE imports; required here, because nothing in the widget
// module (`extends GridLayout`) can be reached by a test at all.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_labels.scss
//            (`.numeric` / `.monospace` — the classes the cells carry)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: the grid itself is a @gjsify/adwaita-* widget, not a port.

import { DATA_GRID_CELL_CLASS, DATA_GRID_ROW_CLASS } from '@gjsify/adwaita-core';
import type { AdwDataGridRowVariant, DataGridTrack } from '@gjsify/adwaita-core';
import type { GridUnitType } from '@nativescript/core';

/** The two numbers a NativeScript `ItemSpec` is constructed from. */
export interface DataGridItemSpec {
    /** A star weight, a pixel length, or 1 for `auto`. */
    value: number;
    type: GridUnitType;
}

/** The class the header row's background carries. */
export const DATA_GRID_HEADER_ROW_CLASS = `${DATA_GRID_ROW_CLASS} header`;

/** The class a section row's single spanning cell carries. */
export const DATA_GRID_SECTION_CELL_CLASS = `${DATA_GRID_CELL_CLASS} align-start section-cell`;

/** The class a header CELL carries, on top of its column's own classes. */
export const DATA_GRID_HEADER_CELL_CLASS = 'header-cell';

/**
 * A fixed track's CSS length in device-independent pixels, or `null` when this
 * renderer cannot resolve it.
 *
 * `DataGridTrack`'s `fixed` kind carries the author's `width` string verbatim,
 * because only a CSS engine can resolve every unit CSS has. NativeScript has
 * exactly one length unit — the DIP — and its own stylesheet subset writes it as
 * a bare number (`min-height: 34`), so BOTH `'80px'` and `'80'` are read as 80
 * here and everything else (`6rem`, `50%`, `calc(...)`) falls back to a
 * content-sized track.
 *
 * Accepting a bare number diverges from the browser deliberately, where `width:
 * '80'` is not a valid CSS length and takes the whole `grid-template-columns`
 * declaration down with it; falling back to `auto` for one column is the smaller
 * failure. A negative or non-finite length is rejected rather than clamped:
 * `ItemSpec` refuses one, and a column silently pinned to 0 reads as missing.
 */
export function parseDataGridWidth(css: string): number | null {
    const match = /^\s*(\d+(?:\.\d+)?)(?:px)?\s*$/.exec(css);
    if (match === null) return null;
    const value = Number(match[1]);
    return Number.isFinite(value) ? value : null;
}

/**
 * The `ItemSpec` numbers for one column track.
 *
 * The four track kinds map onto the three `GridUnitType`s:
 *   - `slack` → `1 star`. The slack column takes what the fixed and content
 *     columns leave, which is what `minmax(0px, 1fr)` does in the browser.
 *   - `flex` → `<weight> star`, the same proportional share `<weight>fr` gives.
 *   - `fixed` → `<px> pixel` when {@link parseDataGridWidth} can read the length,
 *     `auto` when it cannot.
 *   - `auto` → `1 auto` (the value is ignored for an auto track).
 *
 * A `flex` weight of 0 becomes a ZERO-WIDTH PIXEL track rather than a star one:
 * `0fr` collapses the column in the browser, and `ItemSpec(0, 'star')` is not a
 * spelling for that — a star weight is a divisor. Same for a negative or
 * non-finite weight, which cannot mean anything a layout can honour.
 */
export function dataGridItemSpec(track: DataGridTrack): DataGridItemSpec {
    switch (track.kind) {
        case 'slack':
            return { value: 1, type: 'star' };
        case 'flex':
            return Number.isFinite(track.weight) && track.weight > 0
                ? { value: track.weight, type: 'star' }
                : { value: 0, type: 'pixel' };
        case 'fixed': {
            const px = parseDataGridWidth(track.css);
            return px === null ? { value: 1, type: 'auto' } : { value: px, type: 'pixel' };
        }
        case 'auto':
            return { value: 1, type: 'auto' };
    }
}

/**
 * A stable key for a track list — what the widget re-declares its columns on.
 *
 * The guard is the tracks themselves, not their COUNT: a column list can change
 * without changing length (pinning a column's `width` on a narrow screen does
 * exactly that) and a count guard would keep painting against the old tracks.
 * Whenever the count moves the key moves too, and a repaint (new rows, a toggled
 * `interactive`) never touches the columns.
 */
export function dataGridTracksKey(tracks: ReadonlyArray<DataGridTrack>): string {
    return tracks
        .map((track) => {
            switch (track.kind) {
                case 'fixed':
                    return `fixed:${track.css}`;
                case 'flex':
                    return `flex:${track.weight}`;
                case 'slack':
                    return 'slack';
                case 'auto':
                    return 'auto';
            }
        })
        .join('|');
}

/**
 * A stable key for the grid's SHAPE — what the widget rebuilds its views on.
 *
 * Rows and columns only, deliberately: every row is built with one cell per
 * column whatever its variant, and a `section` row spans its first cell over the
 * rest instead of dropping them. So changing a row's variant is a repaint, not a
 * rebuild, and the cell views survive a data change of the same size.
 */
export function dataGridShapeKey(columnCount: number, rowCount: number): string {
    return `${columnCount}x${rowCount}`;
}

/**
 * The classes a data row's background carries.
 *
 * The row background is a NativeScript-only node: the browser paints the fill, the
 * hairline rules and the hover affordance on the row ELEMENT, which is a real
 * element there because it is a subgrid. Here the cells are direct children of the
 * one grid, so a full-width `StackLayout` placed first at the same row — below the
 * cells, spanning every column — carries them plus the tap target and press
 * feedback.
 *
 * `interactive` is a class rather than a widget flag so the press-darken keys off
 * it: `attachRowPressFeedback` is wired on EVERY data row, and a non-interactive
 * one gets a `highlighted` pseudo-class that no stylesheet rule claims.
 */
export function dataGridRowClass(variant: AdwDataGridRowVariant, interactive: boolean): string {
    const classes = [DATA_GRID_ROW_CLASS, `variant-${variant}`];
    if (interactive) classes.push('interactive');
    return classes.join(' ');
}

/**
 * The classes a body cell carries: its column's own, plus the row's variant.
 *
 * The variant is repeated onto the CELL because the browser bolds a subtotal's
 * figures with a DESCENDANT selector (`.variant-subtotal .adw-data-grid-cell`)
 * while here cell and row background are SIBLINGS in one grid — the row class
 * cannot reach the cells. `normal` adds nothing, since the stylesheet has no rule
 * for it.
 */
export function dataGridCellClass(columnClasses: ReadonlyArray<string>, variant: AdwDataGridRowVariant): string {
    const classes = variant === 'normal' ? [...columnClasses] : [...columnClasses, `variant-${variant}`];
    return classes.join(' ');
}
