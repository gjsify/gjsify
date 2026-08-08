// Data-grid layout mapping for NativeScript — the pure half.
//
// `AdwDataGrid` aligns its columns with CSS `subgrid` on the browser: the table
// declares the tracks once and every row is a subgrid spanning them, so a figure
// in column 2 lands on the same edge in every row while the columns still size
// to their content. NativeScript has no subgrid and no equivalent, so the port
// is ONE `GridLayout` whose CELLS are direct children — a `StackLayout` of
// per-row `GridLayout`s would resolve every `auto` track from ONE row's content
// and stagger the columns, which is the exact failure subgrid exists to prevent.
//
// This module holds the two things that mapping needs and that a spec can
// therefore pin: the `DataGridTrack` → `ItemSpec` numbers, and the rebuild guard
// key. The `ItemSpec` OBJECT is constructed in the widget — the same seam
// `splitViewColumns()` uses for the split views, where which column a pane goes
// in is pure and the platform object is not.
//
// Free of `@nativescript/core` VALUE imports — like `split-view-width.ts`,
// `row-press.ts` and `split-view-state.ts` — so the spec suite exercises the
// shipping code rather than a transcription of it. And here that is REQUIRED,
// not merely tidy: `AdwDataGrid extends GridLayout` evaluates the bare
// `@nativescript/core` specifier at module eval, which is unresolvable on
// GJS/Node, so nothing in the widget module itself can be reached by a test.
//
// The derivations one level up — which column is fixed, which absorbs the slack,
// what a cell paints, whether a row activates — are NOT here. They are shared
// with the browser renderer in `@gjsify/adwaita-core` (ADR 0004) and held to
// `@gjsify/adwaita-core/conformance`'s `DATA_GRID_*_VECTORS`.
//
// Reference: refs/libadwaita/src/stylesheet/widgets/_labels.scss:81-88
//            (`.numeric` / `.monospace` — the classes the cells carry)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.
// Modifications: the grid itself is a @gjsify/adwaita-* widget, not a port.

import { DATA_GRID_CELL_CLASS, DATA_GRID_ROW_CLASS } from '@gjsify/adwaita-core';
import type { AdwDataGridRowVariant, DataGridTrack } from '@gjsify/adwaita-core';
import type { GridUnitType } from '@nativescript/core';

/** The two numbers a NativeScript `ItemSpec` is constructed from. */
export interface DataGridItemSpec {
    /** The `ItemSpec` value: a star weight, a pixel length, or 1 for `auto`. */
    value: number;
    /** The `GridUnitType` — `'star'`, `'pixel'` or `'auto'`. */
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
 * a bare number (`min-height: 34`, `padding: 5 10 5 10`), so BOTH `'80px'` and
 * `'80'` are read as 80 here and everything else (`6rem`, `50%`, `calc(...)`)
 * is unresolvable and falls back to a content-sized track.
 *
 * That bare-number acceptance is a deliberate divergence from the browser, where
 * `width: '80'` is not a valid CSS length and takes the WHOLE
 * `grid-template-columns` declaration down with it. Falling back to `auto` for
 * one column is the smaller failure, and refusing a spelling that is valid in
 * this renderer's own stylesheet would be the surprising half.
 *
 * A negative or non-finite length is rejected rather than clamped: `ItemSpec`
 * refuses one, and a column silently pinned to 0 reads as a missing column.
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
 * The precedent is `AdwViewSwitcherBar`, which rebuilds its buttons only when the
 * page COUNT moves so that a selection change cannot replace the button under
 * the user's finger. The same discipline applies here, with one difference the
 * grid forces: a column list can change WITHOUT changing length — pinning a
 * column's `width` on a narrow screen is exactly that — and a count guard would
 * keep painting against the old tracks. So the guard is the tracks themselves,
 * which is a strict superset: whenever the count moves the key moves too, and a
 * repaint (new rows, a toggled `interactive`) never touches the columns.
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
 * The row background is a NativeScript-only node and this is why it exists: the
 * browser paints the fill, the hairline rules and the hover affordance on the
 * row ELEMENT, which is a real element there because it is a subgrid. Here the
 * cells are direct children of the one grid, so a full-width `StackLayout`
 * placed first at the same row — below the cells, spanning every column — is
 * what carries them, plus the tap target and the press feedback.
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
 * The variant is repeated onto the CELL because of the same structural
 * difference: the browser bolds a subtotal's figures with
 * `.variant-subtotal .adw-data-grid-cell`, a DESCENDANT selector, and here the
 * cell is not inside the row background — the two are siblings in one grid. So
 * the row class cannot reach the cells and the cell has to say it itself.
 *
 * `normal` adds nothing: it is every row in a statement but the handful that
 * carry emphasis, and a class the stylesheet has no rule for is only noise in
 * the one place a reader looks when the emphasis is wrong.
 */
export function dataGridCellClass(columnClasses: ReadonlyArray<string>, variant: AdwDataGridRowVariant): string {
    const classes = variant === 'normal' ? [...columnClasses] : [...columnClasses, `variant-${variant}`];
    return classes.join(' ');
}
