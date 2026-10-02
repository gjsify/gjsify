// DOM-level tests for <gtk-grid>: the four numbers reach CSS Grid as the two spacings and
// the two `1fr` track sizes, and placement is source order, which is what GtkBuilder does.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkGrid } from './elements/gtk-grid.js';

function mount(attrs: Record<string, string> = {}, cells = 4): { el: GtkGrid; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-grid') as GtkGrid;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    for (let index = 0; index < cells; index += 1) {
        const cell = document.createElement('gtk-label');
        cell.setAttribute('label', `cell ${index}`);
        el.append(cell);
    }
    host.appendChild(el);
    return { el, host };
}

export const GtkGridTest = async () => {
    await describe('<gtk-grid> properties', async () => {
        await it('holds the pspec defaults: no spacing, nothing homogeneous, horizontal', () => {
            const { el, host } = mount();
            expect(el.rowSpacing).toBe(0);
            expect(el.columnSpacing).toBe(0);
            expect(el.rowHomogeneous).toBe(false);
            expect(el.columnHomogeneous).toBe(false);
            expect(el.orientation).toBe('horizontal');
            host.remove();
        });

        await it('a negative spacing is the pspec minimum, and an unparseable one the default', () => {
            const { el, host } = mount({ 'row-spacing': '-4' });
            expect(el.rowSpacing).toBe(0);
            el.setAttribute('column-spacing', 'lots');
            expect(el.columnSpacing).toBe(0);
            el.rowSpacing = 12;
            expect(el.rowSpacing).toBe(12);
            host.remove();
        });

        await it('writes the two spacings onto the two gap longhands', () => {
            const { el, host } = mount({ 'row-spacing': '6', 'column-spacing': '18' });
            expect(el.style.rowGap).toBe('6px');
            expect(el.style.columnGap).toBe('18px');
            host.remove();
        });

        await it('a homogeneous axis is one equal share of the space the grid is given', () => {
            const { el, host } = mount({ 'column-homogeneous': '', 'row-homogeneous': '' });
            expect(el.style.gridAutoColumns).toBe('1fr');
            expect(el.style.gridAutoRows).toBe('1fr');
            el.columnHomogeneous = false;
            expect(el.style.gridAutoColumns).toBe('');
            host.remove();
        });

        await it('a vertical grid attaches down the rows instead of across the columns', () => {
            const { el, host } = mount();
            // `column` first: the default orientation is HORIZONTAL, so an unpositioned
            // child opens a new column rather than a new row (see the element's own note
            // on `find_attach_position`), and `vertical` is the mirror.
            expect(el.style.gridAutoFlow).toBe('column');
            el.orientation = 'vertical';
            expect(el.style.gridAutoFlow).toBe('row');
            el.setAttribute('orientation', 'sideways');
            expect(el.orientation).toBe('horizontal');
            host.remove();
        });
    });

    await describe('<gtk-grid> look', async () => {
        await it('is a CSS grid, and a generic one', () => {
            const { el, host } = mount();
            expect(getComputedStyle(el).display).toBe('grid');
            expect(el.getAttribute('role')).toBe('generic');
            host.remove();
        });

        await it('appends every unpositioned child to row 0, at the next free column', () => {
            const { el, host } = mount({}, 3);
            const [first, second, third] = Array.from(el.children) as HTMLElement[];
            const a = first.getBoundingClientRect();
            const b = second.getBoundingClientRect();
            const c = third.getBoundingClientRect();
            // `find_attach_position` searches the cross range that starts at 0 and returns
            // the MAXIMUM position along the orientation (gtkgrid.c:293-342), so the row
            // stays 0 and only the column grows: all three share one row, left to right.
            // They do NOT wrap into a second row — that would need an explicit track count.
            expect(Math.round(a.top)).toBe(Math.round(b.top));
            expect(Math.round(b.top)).toBe(Math.round(c.top));
            expect(Math.round(a.left)).toBeLessThan(Math.round(b.left));
            expect(Math.round(b.left)).toBeLessThan(Math.round(c.left));
            host.remove();
        });

        await it('fills column 0 downward when the orientation is vertical', () => {
            const { el, host } = mount({ orientation: 'vertical' }, 3);
            const [first, second, third] = Array.from(el.children) as HTMLElement[];
            const a = first.getBoundingClientRect();
            const b = second.getBoundingClientRect();
            const c = third.getBoundingClientRect();
            // The mirror of the horizontal case: the column stays 0, the row grows.
            expect(Math.round(a.left)).toBe(Math.round(b.left));
            expect(Math.round(b.left)).toBe(Math.round(c.left));
            expect(Math.round(a.top)).toBeLessThan(Math.round(b.top));
            expect(Math.round(b.top)).toBeLessThan(Math.round(c.top));
            host.remove();
        });

        await it('notifies on a real change and on none that did not happen', () => {
            const { el, host } = mount();
            const notified: unknown[] = [];
            el.addEventListener('notify::row-spacing', (e) => notified.push((e as CustomEvent).detail));
            el.rowSpacing = 8;
            el.rowSpacing = 8;
            expect(notified).toStrictEqual([{ 'row-spacing': 8 }]);
            host.remove();
        });
    });
};
