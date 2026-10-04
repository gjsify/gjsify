// DOM-level tests for <gtk-fixed>: the children are out of flow at pixel offsets, an
// unpositioned one is at 0, 0 as GtkBuilder puts it, and the fixed's own box is the UNION
// of its children's rectangles — `gtk_fixed_layout_measure` in one number per axis.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkFixed } from './elements/gtk-fixed.js';

/** A fixed-size box, so the union below is arithmetic and not a measurement of text. */
function cell(x: number, y: number, width: number, height: number): HTMLElement {
    const el = document.createElement('div');
    el.style.width = `${width}px`;
    el.style.height = `${height}px`;
    if (x !== 0 || y !== 0) {
        el.style.left = `${x}px`;
        el.style.top = `${y}px`;
    }
    return el;
}

function mount(...children: HTMLElement[]): { el: GtkFixed; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-fixed') as GtkFixed;
    el.append(...children);
    host.appendChild(el);
    return { el, host };
}

export const GtkFixedTest = async () => {
    await describe('<gtk-fixed> placement', async () => {
        await it('takes a child out of flow and leaves an unpositioned one at 0, 0', () => {
            const { el, host } = mount(cell(0, 0, 40, 10));
            const style = getComputedStyle(el.firstElementChild as HTMLElement);
            expect(style.position).toBe('absolute');
            expect(style.left).toBe('0px');
            expect(style.top).toBe('0px');
            expect(getComputedStyle(el).position).toBe('relative');
            host.remove();
        });

        await it('put() writes the offset the child sits at', () => {
            const { el, host } = mount(cell(0, 0, 40, 10));
            const child = el.firstElementChild as HTMLElement;
            el.put(child, 20, 30);
            expect(child.style.left).toBe('20px');
            expect(child.style.top).toBe('30px');
            // move() is the same without the parent change.
            el.move(child, 5, 6);
            expect(child.style.left).toBe('5px');
            host.remove();
        });

        await it('put() adopts a child that is not in it yet', () => {
            const { el, host } = mount();
            const late = cell(0, 0, 20, 20);
            document.body.appendChild(late);
            el.put(late, 8, 9);
            expect(late.parentNode).toBe(el);
            expect(late.style.left).toBe('8px');
            host.remove();
        });
    });

    await describe('<gtk-fixed> size', async () => {
        await it("is the union of its children's rectangles", () => {
            const { el, host } = mount(cell(20, 10, 60, 20), cell(10, 30, 40, 15));
            // MAX (x + width) = 80 and MAX (y + height) = 45 over the two children.
            expect(el.style.minWidth).toBe('80px');
            expect(el.style.minHeight).toBe('45px');
            host.remove();
        });

        await it('an empty fixed asks for nothing', () => {
            const { el, host } = mount();
            expect(el.style.minWidth).toBe('0px');
            expect(el.style.minHeight).toBe('0px');
            host.remove();
        });

        await it('a child added after connect is in the next union', async () => {
            const { el, host } = mount(cell(0, 0, 30, 30));
            expect(el.style.minWidth).toBe('30px');
            el.appendChild(cell(70, 0, 30, 30));
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(el.style.minWidth).toBe('100px');
            host.remove();
        });

        await it('clips like GTK_OVERFLOW_HIDDEN, and is a block that holds a position', () => {
            const { el, host } = mount(cell(0, 0, 10, 10));
            const style = getComputedStyle(el);
            expect(style.overflow).toBe('hidden');
            expect(style.display).toBe('block');
            host.remove();
        });
    });
};
