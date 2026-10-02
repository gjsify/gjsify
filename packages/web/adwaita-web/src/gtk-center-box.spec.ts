// DOM-level tests for <gtk-center-box>: the three slots are read off each child's `slot=`
// (so the markup order is not the layout's), `shrink-center-last` becomes the flex WEIGHTS
// that reproduce GTK's order, and `baseline-position` only moves the children when authored.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkCenterBox } from './elements/gtk-center-box.js';

const SLOT_CHILD = (role: string, text: string): HTMLElement => {
    const el = document.createElement('gtk-label');
    el.setAttribute('slot', role);
    el.setAttribute('label', text);
    return el;
};

function mount(attrs: Record<string, string> = {}): { el: GtkCenterBox; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = '300px';
    document.body.appendChild(host);
    const el = document.createElement('gtk-center-box') as GtkCenterBox;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    el.append(
        SLOT_CHILD('start-widget', 'Start'),
        SLOT_CHILD('center-widget', 'Centre'),
        SLOT_CHILD('end-widget', 'End'),
    );
    host.appendChild(el);
    return { el, host };
}

/** The `flex-shrink` the element wrote on each of the three slots. */
const weights = (el: GtkCenterBox): Record<string, string> => ({
    start: (el.startWidget as HTMLElement).style.flexShrink,
    center: (el.centerWidget as HTMLElement).style.flexShrink,
    end: (el.endWidget as HTMLElement).style.flexShrink,
});

export const GtkCenterBoxTest = async () => {
    await describe('<gtk-center-box> slots', async () => {
        await it('reads the three widgets off their slot names', () => {
            const { el, host } = mount();
            expect(el.startWidget?.getAttribute('label')).toBe('Start');
            expect(el.centerWidget?.getAttribute('label')).toBe('Centre');
            expect(el.endWidget?.getAttribute('label')).toBe('End');
            expect(el.getAttribute('role')).toBe('generic');
            host.remove();
        });

        await it('a child assigned through the property takes that slot', () => {
            const { el, host } = mount();
            const late = document.createElement('gtk-label');
            late.setAttribute('label', 'Late');
            el.endWidget = late;
            expect(el.endWidget).toBe(late);
            expect(el.endWidget?.style.flexShrink).toBe('100');
            host.remove();
        });

        await it('the children sit at the start, the middle and the end of the box', () => {
            const { el, host } = mount();
            const box = el.getBoundingClientRect();
            expect(Math.round((el.startWidget as HTMLElement).getBoundingClientRect().left - box.left)).toBe(0);
            expect(Math.round(box.right - (el.endWidget as HTMLElement).getBoundingClientRect().right)).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-center-box> shrink-center-last', async () => {
        await it('is TRUE by default, and the centre then carries the small weight', () => {
            const { el, host } = mount();
            expect(el.shrinkCenterLast).toBe(true);
            // The START and END children are the ones that shrink FIRST, so they get the
            // large weight (gtkcenterlayout.c:150-158 with the default TRUE).
            expect(weights(el)).toStrictEqual({ start: '100', center: '1', end: '100' });
            host.remove();
        });

        await it('flips the weights when the attribute says the centre shrinks first', () => {
            const { el, host } = mount({ 'shrink-center-last': 'false' });
            expect(el.shrinkCenterLast).toBe(false);
            expect(weights(el)).toStrictEqual({ start: '1', center: '100', end: '1' });
            host.remove();
        });

        await it('an unknown nick is the default, and writing the value already held notifies nothing', () => {
            const { el, host } = mount();
            const notified: unknown[] = [];
            el.addEventListener('notify::shrink-center-last', (e) => notified.push((e as CustomEvent).detail));
            // The pspec default is TRUE, and the setter compares against it
            // (gtkcenterbox.c:596-602), so writing TRUE back is not a change — while the
            // write that IS one notifies exactly once.
            el.shrinkCenterLast = true;
            expect(el.shrinkCenterLast).toBe(true);
            expect(notified).toStrictEqual([]);
            el.shrinkCenterLast = false;
            expect(el.getAttribute('shrink-center-last')).toBe('false');
            el.shrinkCenterLast = false;
            expect(notified).toStrictEqual([{ 'shrink-center-last': false }]);
            host.remove();
        });
    });

    await describe('<gtk-center-box> baseline-position', async () => {
        await it('is the centre position by default and leaves the stylesheet to stretch', () => {
            const { el, host } = mount();
            expect(el.baselinePosition).toBe('center');
            // Nothing inline: the default position must not change the default look, and the
            // stylesheet's `align-items: stretch` is what a box of FILL children draws.
            expect(el.style.alignItems).toBe('');
            expect(getComputedStyle(el).alignItems).toBe('stretch');
            host.remove();
        });

        await it('the three nicks move the children in the extra space', () => {
            const { el, host } = mount({ 'baseline-position': 'top' });
            expect(el.baselinePosition).toBe('top');
            expect(el.style.alignItems).toBe('flex-start');
            el.baselinePosition = 'bottom';
            expect(el.style.alignItems).toBe('flex-end');
            el.setAttribute('baseline-position', 'middle');
            expect(el.baselinePosition).toBe('center');
            expect(el.style.alignItems).toBe('center');
            host.remove();
        });
    });
};
