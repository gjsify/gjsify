// DOM-level tests for <gtk-separator>: the orientation property is GtkOrientable's (shared
// parser with <gtk-box>), the host carries the orientation as the CSS state the stylesheet
// selects on, and the RENDERED box is a one-pixel rule, or a 12px gap for `.spacer`.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkSeparator } from './elements/gtk-separator.js';

function mount(attrs: Record<string, string> = {}): { el: GtkSeparator; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-separator') as GtkSeparator;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

export const GtkSeparatorTest = async () => {
    await describe('<gtk-separator> orientation', async () => {
        await it('is horizontal by default and says so to CSS and to assistive technology', () => {
            const { el, host } = mount();
            expect(el.orientation).toBe('horizontal');
            expect(el.classList.contains('horizontal')).toBe(true);
            expect(el.classList.contains('vertical')).toBe(false);
            expect(el.getAttribute('role')).toBe('separator');
            expect(el.getAttribute('aria-orientation')).toBe('horizontal');
            host.remove();
        });

        await it('follows the attribute and the property, and an unknown value is the default', () => {
            const { el, host } = mount({ orientation: 'vertical' });
            expect(el.orientation).toBe('vertical');
            expect(el.classList.contains('vertical')).toBe(true);
            el.orientation = 'horizontal';
            expect(el.getAttribute('orientation')).toBe('horizontal');
            expect(el.classList.contains('horizontal')).toBe(true);
            expect(el.classList.contains('vertical')).toBe(false);
            el.setAttribute('orientation', 'diagonal');
            expect(el.orientation).toBe('horizontal');
            host.remove();
        });
    });

    await describe('<gtk-separator> geometry', async () => {
        await it('a horizontal rule is 1px tall and takes the width it is given', () => {
            const { el, host } = mount();
            host.style.width = '200px';
            const box = el.getBoundingClientRect();
            expect(box.height).toBe(1);
            expect(box.width).toBe(200);
            host.remove();
        });

        await it('a vertical rule is 1px wide', () => {
            const { el, host } = mount({ orientation: 'vertical' });
            expect(el.getBoundingClientRect().width).toBe(1);
            host.remove();
        });

        await it('.spacer draws nothing and reserves 12px along its axis', () => {
            const { el, host } = mount();
            el.classList.add('spacer');
            host.style.width = '200px';
            expect(getComputedStyle(el).backgroundImage).toBe('none');
            expect(getComputedStyle(el).backgroundColor).toBe('rgba(0, 0, 0, 0)');
            const vertical = mount({ orientation: 'vertical' });
            vertical.el.classList.add('spacer');
            const box = vertical.el.getBoundingClientRect();
            expect(box.height).toBe(12);
            expect(box.width).toBe(1);
            host.remove();
            vertical.host.remove();
        });
    });
};
