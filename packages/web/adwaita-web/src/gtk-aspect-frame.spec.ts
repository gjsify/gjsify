// DOM-level tests for <gtk-aspect-frame>: `obey-child` decides whose ratio wins, the two
// alignments reach the flex container, and the ratio is clamped to the pspec's range.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkAspectFrame } from './elements/gtk-aspect-frame.js';

function mount(attrs: Record<string, string> = {}): { el: GtkAspectFrame; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-aspect-frame') as GtkAspectFrame;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    if (attrs.width === undefined) el.style.width = '240px';
    const child = document.createElement('gtk-label');
    child.setAttribute('label', 'Framed');
    el.append(child);
    host.appendChild(el);
    return { el, host };
}

export const GtkAspectFrameTest = async () => {
    await describe('<gtk-aspect-frame> properties', async () => {
        await it('holds the pspec defaults, and obey-child is TRUE without the attribute', () => {
            const { el, host } = mount();
            expect(el.ratio).toBe(1);
            expect(el.xalign).toBe(0.5);
            expect(el.yalign).toBe(0.5);
            expect(el.obeyChild).toBe(true);
            expect(el.child?.tagName.toLowerCase()).toBe('gtk-label');
            host.remove();
        });

        await it('clamps the ratio to the pspec range and reads an unparseable one as the default', () => {
            const { el, host } = mount({ ratio: '0' });
            expect(el.ratio).toBe(0.0001);
            el.ratio = 16;
            expect(el.ratio).toBe(16);
            el.setAttribute('ratio', '99999');
            expect(el.ratio).toBe(10000);
            el.setAttribute('ratio', 'sixteen');
            expect(el.ratio).toBe(1);
            host.remove();
        });

        await it('clamps xalign and yalign to 0…1, and an unparseable one is the default', () => {
            const { el, host } = mount();
            el.setAttribute('xalign', '-2');
            expect(el.xalign).toBe(0);
            el.setAttribute('yalign', '3');
            expect(el.yalign).toBe(1);
            el.setAttribute('xalign', 'middle');
            expect(el.xalign).toBe(0.5);
            host.remove();
        });
    });

    await describe('<gtk-aspect-frame> look', async () => {
        await it('obeys the child by default: no aspect-ratio is written at all', () => {
            const { el, host } = mount();
            expect(el.child?.style.aspectRatio).toBe('');
            // The child still fills the frame — that is the allocation, not the ratio.
            expect(el.child?.style.flex).toBe('1 1 auto');
            expect(el.child?.style.maxWidth).toBe('100%');
            host.remove();
        });

        await it('writes the declared ratio once obey-child is false', () => {
            const { el, host } = mount({ 'obey-child': 'false', ratio: '2.5' });
            expect(el.obeyChild).toBe(false);
            // The RATIO, not the serialization: CSSOM echoes `2.5` back as `2.5 / 1`, which is
            // the same value and a string a test must not be pinned to.
            expect(Number.parseFloat(el.child?.style.aspectRatio ?? '')).toBe(2.5);
            el.setAttribute('obey-child', 'true');
            expect(el.obeyChild).toBe(true);
            expect(el.child?.style.aspectRatio).toBe('');
            host.remove();
        });

        await it('the alignments reach the container as justify-content and align-items', () => {
            const { el, host } = mount({ xalign: '0', yalign: '1' });
            expect(el.style.justifyContent).toBe('flex-start');
            expect(el.style.alignItems).toBe('flex-end');
            el.xalign = 0.5;
            el.yalign = 0.5;
            expect(el.style.justifyContent).toBe('center');
            expect(el.style.alignItems).toBe('center');
            host.remove();
        });

        await it('a ratio over a fixed box gives the child that shape', () => {
            const { el, host } = mount({ 'obey-child': 'false', ratio: '2' });
            const box = el.child?.getBoundingClientRect();
            expect(box).toBeDefined();
            expect(Math.round((box?.width ?? 0) / (box?.height ?? 1))).toBe(2);
            host.remove();
        });

        await it('is a generic container', () => {
            const { el, host } = mount();
            expect(el.getAttribute('role')).toBe('generic');
            expect(getComputedStyle(el).display).toBe('flex');
            host.remove();
        });

        await it('notifies on a real change only', () => {
            const { el, host } = mount();
            const notified: unknown[] = [];
            el.addEventListener('notify::ratio', (event) => notified.push((event as CustomEvent).detail));
            el.ratio = 2;
            el.ratio = 2;
            expect(notified).toStrictEqual([{ ratio: 2 }]);
            host.remove();
        });
    });
};
