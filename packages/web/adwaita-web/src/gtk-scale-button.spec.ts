// DOM-level tests for <gtk-scale-button>. Three things are ported from the C and none of
// them is obvious: the icon FOLLOWS THE VALUE (one name for every value, two split the
// range in half, three or more put the first at the bottom and the second at the top), the
// steppers move by the PAGE increment and go insensitive at the ends, and `active` is
// read-only — the dock follows it, not the other way round.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkScaleButton } from './elements/gtk-scale-button.js';

function mount(attrs: Record<string, string> = {}): { el: GtkScaleButton; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-scale-button') as GtkScaleButton;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

/** The three children of the dock, in DOM order: the minus stepper, the range, the plus. */
function parts(el: GtkScaleButton): { minus: HTMLButtonElement; range: HTMLInputElement; plus: HTMLButtonElement } {
    const box = el.querySelector('.scale-button-box') as HTMLElement;
    const [minus, range, plus] = [...box.children] as [HTMLButtonElement, HTMLInputElement, HTMLButtonElement];
    return { minus, range, plus };
}

/** The icon the button currently shows — `image-missing` when the list is empty. */
function iconOf(el: GtkScaleButton): string | null {
    return el.querySelector('.scale-button-glyph')?.getAttribute('icon-name') ?? null;
}

const VOLUME_ICONS = '["audio-volume-muted-symbolic","audio-volume-low-symbolic","audio-volume-high-symbolic"]';

export const GtkScaleButtonTest = async () => {
    await describe('<gtk-scale-button> defaults', async () => {
        await it('opens at the bottom of GTK’s own 0…100 by 2 range, with a page of 20', () => {
            const { el, host } = mount();
            const { range } = parts(el);
            expect(el.value).toBe(0);
            expect(range.min).toBe('0');
            expect(range.max).toBe('100');
            expect(range.step).toBe('2');
            host.remove();
        });

        await it('is vertical by default, because Gtk.ScaleButton is', () => {
            const { el, host } = mount();
            expect(el.orientation).toBe('vertical');
            expect(el.classList.contains('vertical')).toBe(true);
            el.orientation = 'horizontal';
            expect(el.getAttribute('orientation')).toBe('horizontal');
            expect(el.classList.contains('horizontal')).toBe(true);
            expect(el.classList.contains('vertical')).toBe(false);
            host.remove();
        });

        await it('has no frame, so the icon button is flat', () => {
            const { el, host } = mount();
            const icon = el.querySelector('.scale-button-icon') as HTMLButtonElement;
            expect(el.hasFrame).toBe(false);
            expect(icon.classList.contains('flat')).toBe(true);
            el.hasFrame = true;
            expect(icon.classList.contains('flat')).toBe(false);
            host.remove();
        });

        await it('shows image-missing with no icon list at all', () => {
            const { el, host } = mount();
            expect(iconOf(el)).toBe('image-missing');
            host.remove();
        });
    });

    await describe('<gtk-scale-button> icon selection', async () => {
        await it('one icon is used for every value', () => {
            const { el, host } = mount({ icons: '["only-symbolic"]' });
            el.value = 100;
            expect(iconOf(el)).toBe('only-symbolic');
            el.value = 0;
            expect(iconOf(el)).toBe('only-symbolic');
            host.remove();
        });

        await it('two icons split the range in half', () => {
            const { el, host } = mount({ icons: '["low-symbolic","high-symbolic"]' });
            expect(iconOf(el)).toBe('low-symbolic');
            el.value = 50;
            expect(iconOf(el)).toBe('high-symbolic');
            host.remove();
        });

        await it('three icons put the first at the bottom and the SECOND at the top', () => {
            const { el, host } = mount({ icons: VOLUME_ICONS, value: '50' });
            // Two arithmetic facts of the C, both visible, neither a reading of the prose:
            // with three names the step is the whole range, so the interior shares ONE icon
            // (the third); and `value == upper` takes icon_list[1] — the SECOND name, which
            // for this volume list is `audio-volume-low-symbolic`. The property doc calls it
            // "the second item for the highest value" (:250-252), which is the same rule.
            expect(iconOf(el)).toBe('audio-volume-high-symbolic');
            el.value = 100;
            expect(iconOf(el)).toBe('audio-volume-low-symbolic');
            el.value = 0;
            expect(iconOf(el)).toBe('audio-volume-muted-symbolic');
            host.remove();
        });

        await it('five icons spread the interior evenly over the three that are left', () => {
            const { el, host } = mount({
                icons: '["a-symbolic","b-symbolic","c-symbolic","d-symbolic","e-symbolic"]',
                value: '90',
            });
            // step = 100 / 3, and the index is `2 + floor((value - lower) / step)`:
            // 90 → 4 (the fifth), 40 → 3 (the fourth), 20 → 2 (the third).
            expect(iconOf(el)).toBe('e-symbolic');
            el.value = 40;
            expect(iconOf(el)).toBe('d-symbolic');
            el.value = 20;
            expect(iconOf(el)).toBe('c-symbolic');
            host.remove();
        });

        await it('a malformed icons attribute is no list, and image-missing is that answer', () => {
            const { el, host } = mount({ icons: 'audio-volume-high-symbolic' });
            expect(el.icons).toStrictEqual([]);
            expect(iconOf(el)).toBe('image-missing');
            host.remove();
        });
    });

    await describe('<gtk-scale-button> value', async () => {
        await it('clamps into the adjustment, and notifies once per real change', () => {
            const { el, host } = mount();
            const changed: unknown[] = [];
            const notified: unknown[] = [];
            el.addEventListener('value-changed', (e) => changed.push((e as CustomEvent).detail));
            el.addEventListener('notify::value', (e) => notified.push((e as CustomEvent).detail));
            el.value = 500;
            expect(el.value).toBe(100);
            expect(el.getAttribute('value')).toBe('100');
            el.value = 100;
            expect(changed).toStrictEqual([{ value: 100 }]);
            expect(notified).toStrictEqual([{ value: 100 }]);
            host.remove();
        });

        await it('an authored adjustment replaces the range, and the value is clamped into it', () => {
            const { el, host } = mount({
                adjustment: '{"lower":10,"upper":30,"stepIncrement":5}',
                value: '100',
            });
            const { range } = parts(el);
            expect(range.min).toBe('10');
            expect(range.max).toBe('30');
            expect(range.step).toBe('5');
            expect(el.value).toBe(30);
            host.remove();
        });

        await it('a stepper moves by the PAGE increment, not the step', () => {
            const { el, host } = mount();
            const { plus, minus } = parts(el);
            plus.click();
            expect(el.value).toBe(20);
            minus.click();
            expect(el.value).toBe(0);
            host.remove();
        });

        await it('each stepper goes insensitive at its end of the range', () => {
            const { el, host } = mount();
            const { plus, minus } = parts(el);
            expect(plus.disabled).toBe(false);
            expect(minus.disabled).toBe(true);
            el.value = 100;
            expect(plus.disabled).toBe(true);
            expect(minus.disabled).toBe(false);
            host.remove();
        });

        await it('carries the value as an ARIA range on the control that owns it', () => {
            const { el, host } = mount({ value: '42' });
            const { range } = parts(el);
            expect(range.getAttribute('aria-valuenow')).toBe('42');
            expect(range.getAttribute('aria-valuemin')).toBe('0');
            expect(range.getAttribute('aria-valuemax')).toBe('100');
            host.remove();
        });
    });

    await describe('<gtk-scale-button> dock', async () => {
        await it('pressing the icon button pops the scale up and marks the button pressed', () => {
            const { el, host } = mount();
            const icon = el.querySelector('.scale-button-icon') as HTMLButtonElement;
            const dock = el.querySelector('gtk-popover') as HTMLElement;
            const popped: string[] = [];
            el.addEventListener('popup', () => popped.push('popup'));
            el.addEventListener('popdown', () => popped.push('popdown'));
            icon.click();
            expect(el.active).toBe(true);
            expect(icon.classList.contains('checked')).toBe(true);
            expect(dock.hasAttribute('open')).toBe(true);
            expect(popped).toStrictEqual(['popup']);
            icon.click();
            expect(el.active).toBe(false);
            expect(dock.hasAttribute('open')).toBe(false);
            expect(popped).toStrictEqual(['popup', 'popdown']);
            host.remove();
        });

        await it('a value written while the dock is up does not close it', () => {
            const { el, host } = mount();
            const icon = el.querySelector('.scale-button-icon') as HTMLButtonElement;
            icon.click();
            el.value = 30;
            expect(el.active).toBe(true);
            host.remove();
        });
    });
};
