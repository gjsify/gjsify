// DOM-level tests for <gtk-scale>. `Gtk.Scale` extends the abstract `Gtk.Range`, so the
// surface under test is a range's plus four: the pointer mapping is `coord_to_value`, the
// keys are `GtkScale`'s own bindings, and the value text is `gtk_scale_format_value`.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkScale } from './elements/gtk-scale.js';

function mount(attrs: Record<string, string> = {}): { el: GtkScale; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.width = '300px';
    document.body.appendChild(host);
    const el = document.createElement('gtk-scale') as GtkScale;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

/** A real press on the trough, which is what `coord_to_value` is written against. */
function pressAt(el: GtkScale, fraction: number): void {
    const trough = el.querySelector('.adw-scale-trough') as HTMLElement;
    const rect = trough.getBoundingClientRect();
    const event = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        button: 0,
        clientX: rect.left + rect.width * fraction,
    });
    trough.dispatchEvent(event);
}

export const GtkScaleTest = async () => {
    await describe('<gtk-scale> range', async () => {
        await it('is a horizontal slider over 0…100 with a step of 1', () => {
            const { el, host } = mount();
            expect(el.orientation).toBe('horizontal');
            expect(el.adjustment).toStrictEqual({
                value: 0,
                lower: 0,
                upper: 100,
                stepIncrement: 1,
                pageIncrement: 1,
                pageSize: 0,
            });
            expect(el.getAttribute('role')).toBe('slider');
            expect(el.getAttribute('aria-orientation')).toBe('horizontal');
            expect(el.getAttribute('aria-valuemin')).toBe('0');
            expect(el.getAttribute('aria-valuemax')).toBe('100');
            expect(el.getAttribute('aria-valuenow')).toBe('0');
            host.remove();
        });

        await it('takes the adjustment as the portable value, and a bound move re-clamps', () => {
            const { el, host } = mount({ adjustment: '{"lower":10,"upper":40,"stepIncrement":5}', value: '30' });
            expect(el.adjustment.lower).toBe(10);
            expect(el.adjustment.upper).toBe(40);
            expect(el.value).toBe(30);
            el.adjustment = { upper: 20 };
            expect(el.value).toBe(20);
            host.remove();
        });

        await it('a declarative value emits nothing until it changes', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const el = document.createElement('gtk-scale') as GtkScale;
            el.setAttribute('value', '60');
            const changed = record(el, 'value-changed');
            host.appendChild(el);
            expect(el.value).toBe(60);
            expect(changed.length).toBe(0);
            el.value = 70;
            expect(changed).toStrictEqual([{ value: 70 }]);
            host.remove();
        });
    });

    await describe('<gtk-scale> pointer and keys', async () => {
        await it('a press on the trough moves the value to that fraction', () => {
            const { el, host } = mount();
            pressAt(el, 0.25);
            expect(el.value).toBe(25);
            pressAt(el, 0.5);
            expect(el.value).toBe(50);
            host.remove();
        });

        await it('an inverted horizontal scale answers the press the other way round', () => {
            const { el, host } = mount({ inverted: '' });
            pressAt(el, 0.25);
            expect(el.value).toBe(75);
            host.remove();
        });

        await it('an arrow steps and Ctrl+arrow pages, in either orientation', () => {
            const { el, host } = mount({ adjustment: '{"lower":0,"upper":100,"stepIncrement":2,"pageIncrement":20}' });
            const press = (key: string, ctrlKey = false) =>
                el.dispatchEvent(new KeyboardEvent('keydown', { key, ctrlKey, bubbles: true, cancelable: true }));
            press('ArrowRight');
            expect(el.value).toBe(2);
            press('ArrowLeft');
            expect(el.value).toBe(0);
            press('ArrowRight', true);
            expect(el.value).toBe(20);
            press('Home');
            expect(el.value).toBe(0);
            press('End');
            expect(el.value).toBe(100);
            host.remove();
        });

        await it('a disabled scale takes neither a press nor a key', () => {
            const { el, host } = mount({ disabled: '' });
            pressAt(el, 0.75);
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
            expect(el.value).toBe(0);
            expect(el.getAttribute('aria-disabled')).toBe('true');
            host.remove();
        });
    });

    await describe('<gtk-scale> rendering', async () => {
        await it('positions the knob by its centre and the highlight by the same fraction', () => {
            const { el, host } = mount({ value: '40', 'draw-value': '' });
            const knob = el.querySelector('.adw-scale-slider') as HTMLElement;
            const highlight = el.querySelector('.adw-scale-highlight') as HTMLElement;
            expect(knob.style.left).toBe('40%');
            expect(highlight.style.width).toBe('40%');
            expect((el.querySelector('.adw-scale-value') as HTMLElement).hidden).toBe(false);
            expect(el.getAttribute('aria-valuetext')).toBe('40.0');
            host.remove();
        });

        await it('digits is the number of decimal places, default 1', () => {
            const { el, host } = mount({ value: '0.5', 'draw-value': '' });
            expect(el.digits).toBe(1);
            expect((el.querySelector('.adw-scale-value') as HTMLElement).textContent).toBe('0.5');
            el.setAttribute('digits', '2');
            expect((el.querySelector('.adw-scale-value') as HTMLElement).textContent).toBe('0.50');
            host.remove();
        });

        await it('has-origin false withdraws the highlight, show-fill-level draws the second bar', () => {
            const { el, host } = mount({ 'has-origin': 'false', 'show-fill-level': '', 'fill-level': '60' });
            expect((el.querySelector('.adw-scale-highlight') as HTMLElement).hidden).toBe(true);
            expect((el.querySelector('.adw-scale-fill') as HTMLElement).hidden).toBe(false);
            expect((el.querySelector('.adw-scale-fill') as HTMLElement).style.width).toBe('60%');
            host.remove();
        });

        await it('round-digits rounds a dragged value half up, and -1 leaves it alone', () => {
            const { el, host } = mount({ 'round-digits': '0' });
            el.value = 42.5;
            expect(el.value).toBe(43);
            el.setAttribute('round-digits', '-1');
            el.value = 42.5;
            expect(el.value).toBe(42.5);
            host.remove();
        });

        await it('a vertical scale positions the knob from the bottom', () => {
            const { el, host } = mount({ orientation: 'vertical', value: '30' });
            expect((el.querySelector('.adw-scale-slider') as HTMLElement).style.bottom).toBe('30%');
            expect(el.classList.contains('vertical')).toBe(true);
            host.remove();
        });

        await it('draw-value false hides the value text but keeps the a11y value', () => {
            const { el, host } = mount({ value: '10' });
            expect((el.querySelector('.adw-scale-value') as HTMLElement).hidden).toBe(true);
            expect(el.getAttribute('aria-valuenow')).toBe('10');
            host.remove();
        });

        // `gtk_scale_allocate` (gtkscale.c:373-421) puts the value at one EDGE of the widget,
        // which is what the host's four `value-*` classes name — a class the element has to
        // write, because upstream's own `update_value_position` (gtkscale.c:1042-1073) only
        // ever puts the position on the value NODE.
        await it('value-pos names the edge on the host and on the value node', () => {
            const { el, host } = mount({ 'draw-value': '', 'value-pos': 'left' });
            const value = el.querySelector('.adw-scale-value') as HTMLElement;
            expect(el.classList.contains('value-left')).toBe(true);
            expect(el.classList.contains('value-top')).toBe(false);
            expect(value.classList.contains('left')).toBe(true);
            expect(value.classList.contains('top')).toBe(false);
            host.remove();
        });

        await it('value-pos defaults to top, follows a runtime change, and falls back to it', () => {
            const { el, host } = mount({ 'draw-value': '' });
            const value = el.querySelector('.adw-scale-value') as HTMLElement;
            expect(el.valuePos).toBe('top');
            expect(el.classList.contains('value-top')).toBe(true);
            expect(value.classList.contains('top')).toBe(true);
            el.setAttribute('value-pos', 'bottom');
            expect(el.classList.contains('value-bottom')).toBe(true);
            expect(el.classList.contains('value-top')).toBe(false);
            expect(value.classList.contains('bottom')).toBe(true);
            // Not one of the four nicks, so the pspec default stands.
            el.setAttribute('value-pos', 'middle');
            expect(el.valuePos).toBe('top');
            expect(el.classList.contains('value-top')).toBe(true);
            expect(el.classList.contains('value-bottom')).toBe(false);
            host.remove();
        });
    });
};
