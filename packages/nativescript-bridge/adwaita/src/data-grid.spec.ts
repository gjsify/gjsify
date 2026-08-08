// AdwDataGrid's column mapping, against the shared conformance table.
//
// The widget itself cannot be imported here — `AdwDataGrid extends GridLayout`
// evaluates the bare `@nativescript/core` specifier at module eval, which is
// unresolvable on GJS/Node. Unlike the drop-down, which needed no pure sibling
// because `ComboState` already WAS its behaviour, this widget has a real
// NativeScript-only derivation to pin: `DataGridTrack` → `ItemSpec` numbers, and
// the two keys the widget re-declares its columns and rebuilds its views on.
// Those live in `widgets/data-grid-model.ts` and are exercised directly here.
//
// Everything above that seam is shared with the browser renderer and driven from
// `@gjsify/adwaita-core/conformance` — which is also how this suite detects the
// failure it exists for: if the core this package resolves ever derived
// different tracks from the same columns, the grid would silently paint against
// a stale set of `ItemSpec`s and nothing about the widget would look wrong.

import { describe, expect, it } from '@gjsify/unit';

import {
    dataGridCellText,
    dataGridColumnClasses,
    dataGridRowInteractive,
    dataGridTracks,
    normalizeDataGridVariant,
} from '@gjsify/adwaita-core';
import type { DataGridTrack } from '@gjsify/adwaita-core';
import {
    DATA_GRID_CELL_TEXT_VECTORS,
    DATA_GRID_COLUMN_CLASS_VECTORS,
    DATA_GRID_INTERACTIVE_VECTORS,
    DATA_GRID_TRACK_VECTORS,
    DATA_GRID_VARIANT_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import {
    DATA_GRID_HEADER_CELL_CLASS,
    DATA_GRID_HEADER_ROW_CLASS,
    DATA_GRID_SECTION_CELL_CLASS,
    dataGridCellClass,
    dataGridItemSpec,
    dataGridRowClass,
    dataGridShapeKey,
    dataGridTracksKey,
    parseDataGridWidth,
    type DataGridItemSpec,
} from './widgets/data-grid-model.js';

/** One `DataGridTrack` → `ItemSpec` expectation. This mapping is NativeScript's
 *  own, so the table is local rather than in the cross-renderer corpus. */
interface ItemSpecVector {
    track: DataGridTrack;
    spec: DataGridItemSpec;
    rule: string;
}

const ITEM_SPEC_VECTORS: ReadonlyArray<ItemSpecVector> = [
    {
        track: { kind: 'slack' },
        spec: { value: 1, type: 'star' },
        rule: 'the slack column takes what the others leave — what minmax(0px, 1fr) does in the browser',
    },
    {
        track: { kind: 'auto' },
        spec: { value: 1, type: 'auto' },
        rule: 'a content-sized track; the value is ignored for auto',
    },
    {
        track: { kind: 'flex', weight: 2 },
        spec: { value: 2, type: 'star' },
        rule: 'a weight is a star share, the same proportion 2fr gives',
    },
    {
        track: { kind: 'flex', weight: 0.5 },
        spec: { value: 0.5, type: 'star' },
        rule: 'fractional weights are passed through — star accepts them',
    },
    {
        track: { kind: 'flex', weight: 0 },
        spec: { value: 0, type: 'pixel' },
        rule: '0fr COLLAPSES the column; a zero star weight is a divisor, not a spelling for that',
    },
    {
        track: { kind: 'flex', weight: -1 },
        spec: { value: 0, type: 'pixel' },
        rule: 'a negative weight cannot mean anything a layout honours, and ItemSpec refuses it',
    },
    {
        track: { kind: 'flex', weight: Number.NaN },
        spec: { value: 0, type: 'pixel' },
        rule: 'NaN survives normalizeDataGridColumns (it is a number), so it has to be caught here',
    },
    {
        track: { kind: 'fixed', css: '80px' },
        spec: { value: 80, type: 'pixel' },
        rule: 'the unit both renderers share',
    },
    {
        track: { kind: 'fixed', css: '80' },
        spec: { value: 80, type: 'pixel' },
        rule: 'a bare number is a DIP length in the NativeScript stylesheet subset, so it is read as one',
    },
    {
        track: { kind: 'fixed', css: '6rem' },
        spec: { value: 1, type: 'auto' },
        rule: 'no CSS engine here: an unresolvable unit falls back to content-sized rather than to zero',
    },
    {
        track: { kind: 'fixed', css: '50%' },
        spec: { value: 1, type: 'auto' },
        rule: 'a percentage is relative to a container this mapping never sees',
    },
    {
        track: { kind: 'fixed', css: '' },
        spec: { value: 1, type: 'auto' },
        rule: 'an empty width string is not a length',
    },
];

export const AdwDataGridNsTest = async () => {
    await describe('AdwDataGrid tracks (shared vectors, resolved in this package)', async () => {
        for (const vector of DATA_GRID_TRACK_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                // The reading the core THIS package resolves derives, against the
                // reading the browser renderer is held to.
                expect(dataGridTracks(vector.columns)).toStrictEqual([...vector.tracks]);
                // Every column gets exactly one ItemSpec — a grid with fewer
                // tracks than cells stacks the overflow into the last column.
                expect(vector.tracks.map(dataGridItemSpec).length).toBe(vector.columns.length);
            });
        }

        await it('gives the statement default a star column and an auto one', () => {
            // The load-bearing pair, spelled out: the label column absorbs the
            // slack (star) so the figures column hugs the right edge (auto).
            const specs = dataGridTracks([{ key: 'position' }, { key: 'total', numeric: true }]).map(dataGridItemSpec);
            expect(specs).toStrictEqual([
                { value: 1, type: 'star' },
                { value: 1, type: 'auto' },
            ]);
        });
    });

    await describe('dataGridItemSpec (the NativeScript mapping)', async () => {
        for (const { track, spec, rule } of ITEM_SPEC_VECTORS) {
            await it(`${JSON.stringify(track)} → ${JSON.stringify(spec)} — ${rule}`, () => {
                expect(dataGridItemSpec(track)).toStrictEqual(spec);
            });
        }
    });

    await describe('parseDataGridWidth (the one unit this renderer has)', async () => {
        await it('reads px and bare DIPs, including fractions', () => {
            expect(parseDataGridWidth('80px')).toBe(80);
            expect(parseDataGridWidth('80')).toBe(80);
            expect(parseDataGridWidth(' 12.5px ')).toBe(12.5);
        });

        await it('refuses everything it cannot resolve', () => {
            // Each of these would otherwise become a NUMBER by way of parseFloat
            // and pin a column at a width the author never wrote.
            expect(parseDataGridWidth('6rem')).toBe(null);
            expect(parseDataGridWidth('50%')).toBe(null);
            expect(parseDataGridWidth('calc(100% - 10px)')).toBe(null);
            expect(parseDataGridWidth('80pt')).toBe(null);
            expect(parseDataGridWidth('')).toBe(null);
            expect(parseDataGridWidth('-80px')).toBe(null);
        });
    });

    await describe('dataGridTracksKey (when the columns are re-declared)', async () => {
        await it('holds still for a repaint', () => {
            const columns = [{ key: 'position' }, { key: 'total', numeric: true }];
            expect(dataGridTracksKey(dataGridTracks(columns))).toBe(dataGridTracksKey(dataGridTracks(columns)));
        });

        await it('moves when a width changes WITHOUT the count changing', () => {
            // The case a count-only guard misses: same two columns, one of them
            // newly pinned, and the grid would keep painting against the old
            // tracks. Both keys below are two columns long.
            const loose = dataGridTracksKey(dataGridTracks([{ key: 'a' }, { key: 'b' }]));
            const pinned = dataGridTracksKey(dataGridTracks([{ key: 'a' }, { key: 'b', width: '80px' }]));
            expect(loose === pinned).toBe(false);
        });

        await it('moves when the count changes', () => {
            const two = dataGridTracksKey(dataGridTracks([{ key: 'a' }, { key: 'b' }]));
            const three = dataGridTracksKey(dataGridTracks([{ key: 'a' }, { key: 'b' }, { key: 'c' }]));
            expect(two === three).toBe(false);
        });

        await it('separates two tracks from one whose text contains the separator', () => {
            // A width string is author input and reaches the key verbatim, so the
            // joiner has to be a character a CSS length cannot hold.
            expect(dataGridTracksKey([{ kind: 'auto' }, { kind: 'auto' }])).toBe('auto|auto');
            expect(dataGridTracksKey([{ kind: 'fixed', css: 'auto|auto' }])).toBe('fixed:auto|auto');
        });
    });

    await describe('dataGridShapeKey (when the cell views are rebuilt)', async () => {
        await it('keys on columns and rows only', () => {
            expect(dataGridShapeKey(2, 5)).toBe('2x5');
            expect(dataGridShapeKey(2, 5) === dataGridShapeKey(2, 4)).toBe(false);
            expect(dataGridShapeKey(2, 5) === dataGridShapeKey(3, 5)).toBe(false);
        });

        await it('does not distinguish 2 columns × 1 row from 1 × 2', () => {
            // Cheap to get wrong with a concatenation, and it would keep a grid
            // painting one row's cells across two rows' tracks.
            expect(dataGridShapeKey(2, 1) === dataGridShapeKey(1, 2)).toBe(false);
        });
    });

    await describe('dataGridRowClass (the row background carries the emphasis)', async () => {
        await it('names the variant', () => {
            expect(dataGridRowClass('normal', false)).toBe('adw-data-grid-row variant-normal');
            expect(dataGridRowClass('section', false)).toBe('adw-data-grid-row variant-section');
            expect(dataGridRowClass('subtotal', false)).toBe('adw-data-grid-row variant-subtotal');
            expect(dataGridRowClass('total', false)).toBe('adw-data-grid-row variant-total');
        });

        await it('adds interactive last, so the pressed shade can beat the variant', () => {
            expect(dataGridRowClass('normal', true)).toBe('adw-data-grid-row variant-normal interactive');
        });

        await it('names the header row and the two special cells', () => {
            // The stylesheet keys off these exact strings and the NativeScript CSS
            // subset has no :first-child / :not() to derive them with.
            expect(DATA_GRID_HEADER_ROW_CLASS).toBe('adw-data-grid-row header');
            expect(DATA_GRID_SECTION_CELL_CLASS).toBe('adw-data-grid-cell align-start section-cell');
            expect(DATA_GRID_HEADER_CELL_CLASS).toBe('header-cell');
        });
    });

    await describe('AdwDataGrid cells (shared vectors — what the labels paint)', async () => {
        for (const { name, column, classes, rule } of DATA_GRID_COLUMN_CLASS_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                expect(dataGridColumnClasses(column)).toStrictEqual([...classes]);
            });
        }

        for (const { input, text, rule } of DATA_GRID_CELL_TEXT_VECTORS) {
            await it(`cell ${JSON.stringify(input) ?? String(input)} → ${JSON.stringify(text)} — ${rule}`, () => {
                expect(dataGridCellText(input)).toBe(text);
            });
        }

        await it('repeats an emphasising variant onto the cell, and only then', () => {
            // The row background is the cells' SIBLING here, not their ancestor,
            // so the browser's `.variant-subtotal .adw-data-grid-cell` has no
            // reach and the cell has to carry the variant itself. A `normal` row
            // is every row but a handful, and carries nothing.
            const base = dataGridColumnClasses({ key: 'total', numeric: true });
            expect(dataGridCellClass(base, 'normal')).toBe('adw-data-grid-cell align-end numeric');
            expect(dataGridCellClass(base, 'subtotal')).toBe('adw-data-grid-cell align-end numeric variant-subtotal');
            expect(dataGridCellClass(base, 'total')).toBe('adw-data-grid-cell align-end numeric variant-total');
        });
    });

    await describe('AdwDataGrid rows (shared vectors — variant + activation)', async () => {
        for (const { input, variant, rule } of DATA_GRID_VARIANT_VECTORS) {
            await it(`variant ${JSON.stringify(input) ?? String(input)} → ${variant} — ${rule}`, () => {
                expect(normalizeDataGridVariant(input)).toBe(variant);
            });
        }

        for (const { variant, rowFlag, gridInteractive, interactive, rule } of DATA_GRID_INTERACTIVE_VECTORS) {
            const name = `${variant} + row ${String(rowFlag)} + grid ${gridInteractive} → ${interactive}`;
            await it(`${name} — ${rule}`, () => {
                // The widget re-evaluates this at TAP time rather than at wiring
                // time, so every row's background carries a listener and this is
                // the only thing standing between a section header and an event.
                expect(dataGridRowInteractive(variant, rowFlag, gridInteractive)).toBe(interactive);
                // …and the class the background paints follows the same answer.
                expect(dataGridRowClass(variant, interactive).includes('interactive')).toBe(interactive);
            });
        }
    });
};

export default AdwDataGridNsTest;
