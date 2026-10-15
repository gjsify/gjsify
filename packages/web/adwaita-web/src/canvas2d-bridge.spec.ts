// DOM-level tests for <gjsify-canvas2d-bridge>: the keyboard focus a game console needs for its keys.
import { describe, expect, it } from '@gjsify/unit';

import type { Canvas2DBridgeElement } from './canvas2d/canvas2d-bridge.js';

function mount(attrs: Record<string, string> = {}): { el: Canvas2DBridgeElement; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gjsify-canvas2d-bridge') as Canvas2DBridgeElement;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

export const Canvas2DBridgeTest = async () => {
    await describe('<gjsify-canvas2d-bridge> focus', async () => {
        await it('is not focusable by default, so grab_focus returns false', () => {
            const { el, host } = mount();
            expect(el.focusable).toBe(false);
            expect(el.grab_focus()).toBe(false);
            expect(document.activeElement === el).toBe(false);
            host.remove();
        });

        await it('grab_focus takes the keyboard focus when focusable', () => {
            const { el, host } = mount({ focusable: '' });
            expect(el.grab_focus()).toBe(true);
            expect(document.activeElement === el).toBe(true);
            host.remove();
        });

        await it('a focusable set after connect makes the element focusable', () => {
            const { el, host } = mount();
            el.focusable = true;
            expect(el.grab_focus()).toBe(true);
            host.remove();
        });

        await it('can-focus false refuses the focus', () => {
            const { el, host } = mount({ focusable: '' });
            el.canFocus = false;
            expect(el.can_focus).toBe(false);
            expect(el.grab_focus()).toBe(false);
            host.remove();
        });
    });
};
