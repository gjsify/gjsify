// DOM-level tests for <gtk-scrollbar>: the two properties it has (an adjustment and an
// orientation), `GtkRange`'s slider geometry in the two fractions upstream computes, and the
// keys `GtkScrollbar`'s own documentation names.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkScrollbar } from './elements/gtk-scrollbar.js';

/** A scrollbar of a known size, so the trough's own length — the fraction's denominator — is exact. */
function mount(vertical = false): { el: GtkScrollbar; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = '300px';
    host.style.height = '300px';
    document.body.appendChild(host);
    const el = document.createElement('gtk-scrollbar') as GtkScrollbar;
    if (vertical) el.setAttribute('orientation', 'vertical');
    el.style.height = vertical ? '200px' : '24px';
    el.style.width = vertical ? '24px' : '200px';
    host.appendChild(el);
    return { el, host };
}

const parts = (bar: GtkScrollbar): { trough: HTMLElement; slider: HTMLElement } => ({
    trough: bar.querySelector('.adw-scrollbar-trough') as HTMLElement,
    slider: bar.querySelector('.adw-scrollbar-slider') as HTMLElement,
});

/** `--adw-scrollbar-size` / `--adw-scrollbar-position`, which is what `_render` computed. */
const geometry = (slider: HTMLElement): { size: number; position: number } => ({
    size: Number.parseFloat(slider.style.getPropertyValue('--adw-scrollbar-size')),
    position: Number.parseFloat(slider.style.getPropertyValue('--adw-scrollbar-position')),
});

const press = (el: HTMLElement, key: string): void => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
};

export const GtkScrollbarTest = async () => {
    await describe('<gtk-scrollbar> its two properties', async () => {
        await it('is a horizontal scrollbar with NO adjustment, which is the pspec default', async () => {
            const { el, host } = mount();
            expect(el.orientation).toBe('horizontal');
            expect(el.classList.contains('horizontal')).toBe(true);
            expect(el.getAttribute('role')).toBe('scrollbar');
            expect(el.getAttribute('aria-orientation')).toBe('horizontal');
            // `gtk_scrollbar_adjustment_updated` sets the widget INSENSITIVE with no
            // adjustment, and that is `aria-disabled` here rather than a missing slider.
            expect(el.getAttribute('aria-disabled')).toBe('true');
            expect(el.hasAttribute('disabled')).toBe(true);
            expect(el.getAttribute('aria-valuenow')).toBe(null);
            host.remove();
        });

        await it('reads the adjustment from its JSON attribute and announces the range', async () => {
            const { el, host } = mount(true);
            el.setAttribute('adjustment', '{"upper":200,"pageSize":50,"stepIncrement":10,"pageIncrement":40}');
            expect(el.adjustment?.upper).toBe(200);
            expect(el.getAttribute('aria-valuemin')).toBe('0');
            // `aria-valuemax` is `upper - page_size`, the position the bar can reach.
            expect(el.getAttribute('aria-valuemax')).toBe('150');
            expect(el.getAttribute('aria-valuenow')).toBe('0');
            expect(el.getAttribute('aria-disabled')).toBe('false');
            expect(el.classList.contains('vertical')).toBe(true);
            host.remove();
        });

        await it('notifies the property when the adjustment is replaced', async () => {
            const { el, host } = mount();
            const seen: unknown[] = [];
            el.addEventListener('notify::adjustment', (e) => seen.push((e as CustomEvent).detail));
            el.adjustment = { lower: 0, upper: 10, stepIncrement: 1, pageIncrement: 1, pageSize: 0, value: 0 };
            expect(seen.length).toBe(1);
            el.setAttribute('adjustment', '{"upper":20}');
            // A partial write MERGES, which is `gtk_adjustment_configure`'s contract.
            expect(el.adjustment?.upper).toBe(20);
            expect(el.adjustment?.stepIncrement).toBe(1);
            host.remove();
        });

        await it('clamps the value it is given, which is what the setter promises', async () => {
            const { el, host } = mount();
            el.adjustment = { lower: 0, upper: 100, stepIncrement: 1, pageIncrement: 10, pageSize: 0, value: 0 };
            el.value = 500;
            expect(el.value).toBe(100);
            el.value = -20;
            expect(el.value).toBe(0);
            host.remove();
        });
    });

    await describe("<gtk-scrollbar> GtkRange's slider geometry", async () => {
        await it('sizes the slider by page_size over the whole range, and places it by the SCROLLABLE one', async () => {
            const { el, host } = mount(true);
            el.adjustment = { lower: 0, upper: 400, stepIncrement: 10, pageIncrement: 40, pageSize: 100, value: 0 };
            const { trough, slider } = parts(el);
            const length = trough.clientHeight;
            expect(length > 0).toBe(true);
            // Two DIFFERENT denominators: the length is a quarter of the range, the position
            // a fraction of the 300 that is left once the page is out of it.
            expect(geometry(slider).size).toBe(length * 0.25);
            expect(geometry(slider).position).toBe(0);
            el.value = 300;
            expect(geometry(slider).position).toBe(length - length * 0.25);
            host.remove();
        });

        await it('puts the slider at the far end for the last reachable value', async () => {
            const { el, host } = mount();
            el.adjustment = { lower: 0, upper: 200, stepIncrement: 10, pageIncrement: 40, pageSize: 50, value: 150 };
            const { trough, slider } = parts(el);
            const length = trough.clientWidth;
            expect(geometry(slider).position).toBe(length - length * 0.25);
            host.remove();
        });
    });

    await describe('<gtk-scrollbar> the keys its own doc names', async () => {
        await it('steps with the arrows, pages with Page Up/Down and jumps with Home/End', async () => {
            const { el, host } = mount();
            el.adjustment = { lower: 0, upper: 100, stepIncrement: 5, pageIncrement: 25, pageSize: 0, value: 0 };
            el.focus();
            press(el, 'ArrowRight');
            expect(el.value).toBe(5);
            press(el, 'ArrowLeft');
            expect(el.value).toBe(0);
            press(el, 'PageDown');
            expect(el.value).toBe(25);
            press(el, 'Home');
            expect(el.value).toBe(0);
            press(el, 'End');
            expect(el.value).toBe(100);
            host.remove();
        });

        await it('answers only the arrows on its OWN axis', async () => {
            const { el, host } = mount(true);
            el.adjustment = { lower: 0, upper: 100, stepIncrement: 5, pageIncrement: 25, pageSize: 0, value: 0 };
            el.focus();
            // A horizontal bar's keys must not move a vertical one, and the other way round.
            press(el, 'ArrowRight');
            expect(el.value).toBe(0);
            press(el, 'ArrowDown');
            expect(el.value).toBe(5);
            host.remove();
        });

        await it('does nothing at all without an adjustment', async () => {
            const { el, host } = mount();
            el.focus();
            press(el, 'End');
            expect(el.value).toBe(0);
            host.remove();
        });
    });
};
