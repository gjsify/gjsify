// DOM-level tests for <gtk-grid-view>: it is a <gtk-list-view> with a column count, so
// what is asserted here is the half that differs — the measured track count and the two
// bounds — plus the proof that the inherited model/selection machinery still reaches it.
import { describe, expect, it } from '@gjsify/unit';

import { GRID_VIEW_COLUMN_VECTORS } from '@gjsify/adwaita-core/conformance';

import type { GtkGridView } from './elements/gtk-grid-view.js';

function mount(attrs: Record<string, string> = {}, width = '640px'): { el: GtkGridView; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = width;
    document.body.appendChild(host);
    const el = document.createElement('gtk-grid-view') as GtkGridView;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

const cells = (el: GtkGridView): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.adw-grid-view-child')];

/** The track COUNT the element wrote, read back off `repeat(<n>, 1fr)`. */
const tracks = (el: GtkGridView): number => {
    const template = el.querySelector<HTMLElement>('.adw-list-view-rows')?.style.gridTemplateColumns ?? '';
    return Number.parseInt(/repeat\((\d+)/.exec(template)?.[1] ?? '', 10);
};

export const GtkGridViewTest = async () => {
    await describe('<gtk-grid-view> items', async () => {
        await it('draws one child per item, with the grid node name GTK gives them', () => {
            const { el, host } = mount({ model: '["A","B","C"]' });
            expect(cells(el).length).toBe(3);
            expect(cells(el)[0]!.textContent).toBe('A');
            host.remove();
        });

        await it('still selects and splices, because both belong to the list view', () => {
            const { el, host } = mount({ model: '["A","B"]' });
            const before = cells(el);
            cells(el)[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(el.selected).toStrictEqual([1]);
            el.model = ['A', 'B', 'C'];
            expect(cells(el)[0]).toBe(before[0]);
            expect(cells(el).length).toBe(3);
            host.remove();
        });
    });

    await describe('<gtk-grid-view> drives the column vectors against real boxes', async () => {
        // The two numbers the arithmetic takes are the stylesheet's — a cell's `min-width`
        // and the container's `column-gap` — so a vector is driven by declaring them and
        // reading back the tracks the element wrote.
        for (const vector of GRID_VIEW_COLUMN_VECTORS) {
            await it(vector.rule, () => {
                const { el, host } = mount({ model: '["A","B","C","D","E","F","G","H"]' }, `${vector.forSize}px`);
                const container = el.querySelector<HTMLElement>('.adw-list-view-rows')!;
                container.style.columnGap = `${vector.spacing}px`;
                for (const cell of cells(el)) cell.style.minWidth = `${vector.itemSize}px`;
                // Writing the bounds is also what re-measures: the ResizeObserver fires on
                // a real layout change, and the style writes above are not one.
                el.setAttribute('min-columns', String(vector.minColumns));
                el.setAttribute('max-columns', String(vector.maxColumns));
                expect(tracks(el)).toBe(vector.columns);
                host.remove();
            });
        }
    });

    await describe('<gtk-grid-view> columns', async () => {
        await it('defaults to the two bounds GtkGridView declares', () => {
            const { el, host } = mount();
            expect(el.minColumns).toBe(1);
            expect(el.maxColumns).toBe(7);
            host.remove();
        });

        await it('reads an attribute that is a positive integer, and ignores anything else', () => {
            const { el, host } = mount({ 'max-columns': '3' });
            expect(el.maxColumns).toBe(3);
            el.setAttribute('max-columns', 'many');
            expect(el.maxColumns).toBe(7);
            el.setAttribute('min-columns', '0');
            expect(el.minColumns).toBe(1);
            host.remove();
        });

        await it('writes as many equal tracks as the width fits', () => {
            // 640px of host, cells floored at 120px with a 6px gap: (640 + 6) / 126 = 5.
            const { el, host } = mount({ model: '["A","B","C","D","E","F"]' });
            expect(tracks(el)).toBe(5);
            host.remove();
        });

        await it('clamps the measured count to max-columns', () => {
            const { el, host } = mount({ model: '["A","B","C","D","E","F"]', 'max-columns': '2' });
            expect(tracks(el)).toBe(2);
            host.remove();
        });

        await it('clamps it up to min-columns in a view too narrow for them', () => {
            const { el, host } = mount({ model: '["A","B","C"]', 'min-columns': '3' }, '140px');
            expect(tracks(el)).toBe(3);
            host.remove();
        });
    });
};
