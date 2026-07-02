// DOM-level behaviour tests for <adw-data-grid>. Runs in a real browser via the
// @gjsify/adwaita-web browser test axis. Asserts column parsing + alignment
// classes, the derived grid tracks, per-cell rendering of pre-formatted strings,
// the accounting row variants (normal / section / subtotal / total), and the
// row-activated interaction (element-level + per-row, keyboard + pointer).
import { describe, it, expect } from '@gjsify/unit';

import type { AdwDataGrid, AdwDataGridColumn, AdwDataGridRow } from './elements/adw-data-grid.js';

function makeGrid(columns?: AdwDataGridColumn[], rows?: AdwDataGridRow[]): AdwDataGrid {
    const el = document.createElement('adw-data-grid') as AdwDataGrid;
    if (columns) el.columns = columns;
    if (rows) el.rows = rows;
    document.body.appendChild(el);
    return el;
}

const BWA_COLUMNS: AdwDataGridColumn[] = [
    { key: 'position', label: 'BWA-Position' },
    { key: 'total', label: 'Σ Jahr', numeric: true },
];

export const AdwDataGridTest = async () => {
    await describe('adw-data-grid columns', async () => {
        await it('renders one header cell per column with the label', async () => {
            const grid = makeGrid(BWA_COLUMNS, []);
            const header = grid.querySelector('.adw-data-grid-row.header');
            expect(header).toBeTruthy();
            const cells = grid.querySelectorAll('.adw-data-grid-row.header .adw-data-grid-cell');
            expect(cells.length).toBe(2);
            expect(cells[0].textContent).toBe('BWA-Position');
            expect(cells[1].textContent).toBe('Σ Jahr');
            grid.remove();
        });

        await it('falls back to the key when no label is given', async () => {
            const grid = makeGrid([{ key: 'amount' }], []);
            const cell = grid.querySelector('.adw-data-grid-row.header .adw-data-grid-cell');
            expect(cell?.textContent).toBe('amount');
            grid.remove();
        });

        await it('a numeric column right-aligns + gets the numeric class', async () => {
            const grid = makeGrid(BWA_COLUMNS, []);
            const cells = grid.querySelectorAll('.adw-data-grid-row.header .adw-data-grid-cell');
            expect(cells[0].classList.contains('align-start')).toBe(true);
            expect(cells[1].classList.contains('align-end')).toBe(true);
            expect(cells[1].classList.contains('numeric')).toBe(true);
            grid.remove();
        });

        await it('honours an explicit align + monospace flag', async () => {
            const grid = makeGrid(
                [
                    { key: 'a', align: 'center' },
                    { key: 'b', monospace: true },
                ],
                [],
            );
            const cells = grid.querySelectorAll('.adw-data-grid-row.header .adw-data-grid-cell');
            expect(cells[0].classList.contains('align-center')).toBe(true);
            expect(cells[1].classList.contains('mono')).toBe(true);
            grid.remove();
        });

        await it('derives grid-template-columns from width / flex', async () => {
            const grid = makeGrid(
                [
                    { key: 'a', flex: 2 },
                    { key: 'b', width: '80px' },
                ],
                [],
            );
            const table = grid.querySelector('.adw-data-grid-table') as HTMLElement;
            expect(table.style.gridTemplateColumns).toBe('2fr 80px');
            grid.remove();
        });

        await it('defaults the first column to flexible so amounts hug the right edge', async () => {
            const grid = makeGrid(BWA_COLUMNS, []);
            const table = grid.querySelector('.adw-data-grid-table') as HTMLElement;
            // The CSSOM serialises the track back as `minmax(0px, 1fr)`.
            expect(table.style.gridTemplateColumns).toBe('minmax(0px, 1fr) auto');
            grid.remove();
        });

        await it('parses columns + rows from the JSON attributes', async () => {
            const grid = document.createElement('adw-data-grid') as AdwDataGrid;
            grid.setAttribute('columns', '[{"key":"a","label":"A"},{"key":"b","numeric":true}]');
            grid.setAttribute('rows', '[{"a":"x","b":"1,00 €"}]');
            document.body.appendChild(grid);
            expect(grid.columns.length).toBe(2);
            expect(grid.rows.length).toBe(1);
            const bodyCells = grid.querySelectorAll('.adw-data-grid-row:not(.header) .adw-data-grid-cell');
            expect(bodyCells[0].textContent).toBe('x');
            expect(bodyCells[1].textContent).toBe('1,00 €');
            grid.remove();
        });
    });

    await describe('adw-data-grid rows', async () => {
        await it('renders a row + a cell per column with the pre-formatted string', async () => {
            const grid = makeGrid(BWA_COLUMNS, [
                { position: 'Umsatzerlöse', total: '120.000,00 €' },
                { position: 'Sonstige Erträge', total: '5.000,00 €' },
            ]);
            const rows = grid.querySelectorAll('.adw-data-grid-row:not(.header)');
            expect(rows.length).toBe(2);
            const firstCells = rows[0].querySelectorAll('.adw-data-grid-cell');
            expect(firstCells.length).toBe(2);
            expect(firstCells[0].textContent).toBe('Umsatzerlöse');
            expect(firstCells[1].textContent).toBe('120.000,00 €');
            grid.remove();
        });

        await it('coerces a numeric cell value to a string', async () => {
            const grid = makeGrid([{ key: 'qty', numeric: true }], [{ qty: 3 }]);
            const cell = grid.querySelector('.adw-data-grid-row:not(.header) .adw-data-grid-cell');
            expect(cell?.textContent).toBe('3');
            grid.remove();
        });

        await it('renders an empty cell for a missing key', async () => {
            const grid = makeGrid(BWA_COLUMNS, [{ position: 'Only label' }]);
            const cells = grid.querySelectorAll('.adw-data-grid-row:not(.header) .adw-data-grid-cell');
            expect(cells[1].textContent).toBe('');
            grid.remove();
        });
    });

    await describe('adw-data-grid variants', async () => {
        await it('a section row spans all columns with the first column value', async () => {
            const grid = makeGrid(BWA_COLUMNS, [{ variant: 'section', position: 'Betriebseinnahmen' }]);
            const row = grid.querySelector('.adw-data-grid-row.variant-section') as HTMLElement;
            expect(row).toBeTruthy();
            const cells = row.querySelectorAll('.adw-data-grid-cell');
            expect(cells.length).toBe(1);
            expect(cells[0].textContent).toBe('Betriebseinnahmen');
            expect((cells[0] as HTMLElement).style.gridColumn).toBe('1 / -1');
            grid.remove();
        });

        await it('tags subtotal + total rows with their variant class', async () => {
            const grid = makeGrid(BWA_COLUMNS, [
                { variant: 'subtotal', position: 'Gesamtleistung', total: '125.000,00 €' },
                { variant: 'total', position: 'Betriebsergebnis', total: '42.000,00 €' },
            ]);
            expect(grid.querySelector('.adw-data-grid-row.variant-subtotal')).toBeTruthy();
            expect(grid.querySelector('.adw-data-grid-row.variant-total')).toBeTruthy();
            // A subtotal / total keeps the full per-column layout (not spanning).
            const subtotalCells = grid.querySelectorAll('.variant-subtotal .adw-data-grid-cell');
            expect(subtotalCells.length).toBe(2);
            grid.remove();
        });

        await it('an unknown / absent variant falls back to normal', async () => {
            const grid = makeGrid(BWA_COLUMNS, [
                { position: 'x' },
                { variant: 'bogus', position: 'y' } as unknown as AdwDataGridRow,
            ]);
            const normals = grid.querySelectorAll('.adw-data-grid-row.variant-normal');
            expect(normals.length).toBe(2);
            grid.remove();
        });
    });

    await describe('adw-data-grid row-activated', async () => {
        await it('element-level interactive makes normal rows clickable + fires {index,row}', async () => {
            const rows: AdwDataGridRow[] = [
                { position: 'Row A', total: '1,00 €' },
                { position: 'Row B', total: '2,00 €' },
            ];
            const grid = makeGrid(BWA_COLUMNS, rows);
            grid.interactive = true;
            let detail: { index: number; row: AdwDataGridRow } | null = null;
            grid.addEventListener('row-activated', (e) => {
                detail = (e as CustomEvent).detail;
            });
            const interactiveRows = grid.querySelectorAll('.adw-data-grid-row.interactive');
            expect(interactiveRows.length).toBe(2);
            (interactiveRows[1] as HTMLElement).click();
            expect(detail).toBeTruthy();
            expect(detail!.index).toBe(1);
            expect(detail!.row.position).toBe('Row B');
            grid.remove();
        });

        await it('section / subtotal / total rows never activate', async () => {
            const grid = makeGrid(BWA_COLUMNS, [
                { variant: 'section', position: 'Sec' },
                { variant: 'subtotal', position: 'Sub', total: '1,00 €' },
                { variant: 'total', position: 'Tot', total: '2,00 €' },
                { position: 'Data', total: '3,00 €' },
            ]);
            grid.interactive = true;
            expect(grid.querySelectorAll('.adw-data-grid-row.interactive').length).toBe(1);
            grid.remove();
        });

        await it('a per-row interactive flag opts a single row in / out', async () => {
            const grid = makeGrid(BWA_COLUMNS, [
                { position: 'clickable', interactive: true },
                { position: 'not clickable' },
            ]);
            // No element-level flag: only the opted-in row is interactive.
            const interactiveRows = grid.querySelectorAll('.adw-data-grid-row.interactive');
            expect(interactiveRows.length).toBe(1);
            expect(interactiveRows[0].querySelector('.adw-data-grid-cell')?.textContent).toBe('clickable');
            grid.remove();
        });

        await it('a per-row interactive:false opts out even when the element is interactive', async () => {
            const grid = makeGrid(BWA_COLUMNS, [{ position: 'a' }, { position: 'b', interactive: false }]);
            grid.interactive = true;
            expect(grid.querySelectorAll('.adw-data-grid-row.interactive').length).toBe(1);
            grid.remove();
        });

        await it('Enter activates a focused interactive row', async () => {
            const grid = makeGrid(BWA_COLUMNS, [{ position: 'Row A', total: '1,00 €' }]);
            grid.interactive = true;
            let fired = 0;
            grid.addEventListener('row-activated', () => fired++);
            const row = grid.querySelector('.adw-data-grid-row.interactive') as HTMLElement;
            expect(row.tabIndex).toBe(0);
            row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            expect(fired).toBe(1);
            grid.remove();
        });
    });

    await describe('adw-data-grid caption', async () => {
        await it('shows the caption from the attribute + hides it when empty', async () => {
            const grid = makeGrid(BWA_COLUMNS, []);
            const caption = grid.querySelector('.adw-data-grid-caption') as HTMLElement;
            expect(caption.hidden).toBe(true);
            grid.caption = 'Betriebswirtschaftliche Auswertung';
            expect(caption.hidden).toBe(false);
            expect(caption.textContent).toBe('Betriebswirtschaftliche Auswertung');
            grid.remove();
        });
    });
};
