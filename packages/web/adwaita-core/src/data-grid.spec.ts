// Data-grid derivation specs — driven by the shared conformance vectors, so this
// suite and the NativeScript renderer suite assert the SAME table. The browser
// element is held to it by its own DOM spec (see `conformance/data-grid.ts` §
// WHO DRIVES THIS TABLE).

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_DATA_GRID_ROW_VARIANTS,
    DATA_GRID_CELL_CLASS,
    DATA_GRID_ROW_CLASS,
    dataGridCellText,
    dataGridColumnAlign,
    dataGridColumnClasses,
    dataGridRowInteractive,
    dataGridTrackTemplate,
    dataGridTracks,
    normalizeDataGridColumns,
    normalizeDataGridVariant,
} from './data-grid.js';
import {
    DATA_GRID_CELL_TEXT_VECTORS,
    DATA_GRID_COLUMN_CLASS_VECTORS,
    DATA_GRID_COLUMN_NORMALIZE_VECTORS,
    DATA_GRID_INTERACTIVE_VECTORS,
    DATA_GRID_TRACK_VECTORS,
    DATA_GRID_VARIANT_VECTORS,
} from './conformance/data-grid.js';

export default async () => {
    await describe('dataGridTracks (the renderer-neutral column tracks)', async () => {
        for (const { name, columns, tracks, template, rule } of DATA_GRID_TRACK_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                expect(dataGridTracks(columns)).toStrictEqual([...tracks]);
                // The browser mapping, from the SAME descriptors the NativeScript
                // port turns into ItemSpecs — the seam the table exists for.
                expect(dataGridTrackTemplate(dataGridTracks(columns))).toBe(template);
            });
        }

        await it('spells the slack track with the CSSOM-canonical 0px', () => {
            // `0` and `0px` are the same length and NOT the same CSS text: the
            // browser reads `style.gridTemplateColumns` back canonicalised, so a
            // bare `0` fails an equality assertion in the browser suite alone.
            expect(dataGridTrackTemplate([{ kind: 'slack' }])).toBe('minmax(0px, 1fr)');
        });
    });

    await describe('dataGridColumnClasses (_labels.scss:81-88 opt-ins)', async () => {
        for (const { name, column, align, classes, rule } of DATA_GRID_COLUMN_CLASS_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                expect(dataGridColumnAlign(column)).toBe(align);
                expect(dataGridColumnClasses(column)).toStrictEqual([...classes]);
            });
        }

        await it('names the base classes both renderers style off', () => {
            expect(DATA_GRID_CELL_CLASS).toBe('adw-data-grid-cell');
            expect(DATA_GRID_ROW_CLASS).toBe('adw-data-grid-row');
        });
    });

    await describe('normalizeDataGridVariant (the emphasis is clamped)', async () => {
        for (const { input, variant, rule } of DATA_GRID_VARIANT_VECTORS) {
            await it(`${JSON.stringify(input) ?? String(input)} → ${variant} — ${rule}`, () => {
                expect(normalizeDataGridVariant(input)).toBe(variant);
            });
        }

        await it('lists exactly the four variants it accepts', () => {
            expect([...ADW_DATA_GRID_ROW_VARIANTS]).toStrictEqual(['normal', 'section', 'subtotal', 'total']);
        });
    });

    await describe('dataGridCellText (the grid formats nothing)', async () => {
        for (const { input, text, rule } of DATA_GRID_CELL_TEXT_VECTORS) {
            await it(`${JSON.stringify(input) ?? String(input)} → ${JSON.stringify(text)} — ${rule}`, () => {
                expect(dataGridCellText(input)).toBe(text);
            });
        }
    });

    await describe('dataGridRowInteractive (variant gate + both override directions)', async () => {
        for (const { variant, rowFlag, gridInteractive, interactive, rule } of DATA_GRID_INTERACTIVE_VECTORS) {
            const name = `${variant} + row ${String(rowFlag)} + grid ${gridInteractive} → ${interactive}`;
            await it(`${name} — ${rule}`, () => {
                expect(dataGridRowInteractive(variant, rowFlag, gridInteractive)).toBe(interactive);
            });
        }
    });

    await describe('normalizeDataGridColumns (a parsed JSON attribute, so anything)', async () => {
        for (const { name, input, columns, rule } of DATA_GRID_COLUMN_NORMALIZE_VECTORS) {
            await it(`${name} — ${rule}`, () => {
                expect(normalizeDataGridColumns(input)).toStrictEqual([...columns]);
            });
        }

        await it("copies rather than aliasing the caller's descriptors", () => {
            // The grid re-derives its tracks from the stored list, so a caller
            // mutating the array it passed must not move the columns under it.
            const raw = [{ key: 'a', numeric: true }];
            const normalized = normalizeDataGridColumns(raw);
            raw[0].numeric = false;
            expect(normalized[0].numeric).toBe(true);
        });
    });
};
