// DOM-level tests for <gtk-color-dialog-button>. The ported rules are GTK's: the button is
// INSENSITIVE until a dialog is set, `set_rgba` refuses a write of the colour it already
// holds, and the swatch's accessible name is the channel percentages — with the Alpha
// clause only while the colour is translucent.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkColorDialogButton } from './elements/gtk-color-dialog-button.js';

function mount(attrs: Record<string, string> = {}): {
    el: GtkColorDialogButton;
    host: HTMLElement;
    button: HTMLButtonElement;
    input: HTMLInputElement;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-color-dialog-button') as GtkColorDialogButton;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    const button = el.querySelector('button') as HTMLButtonElement;
    const input = el.querySelector('input') as HTMLInputElement;
    // The chooser is a native `<input type="color">`; opening it for real would block the
    // suite, so the click on it is what stands in for the platform picker.
    input.click = () => {};
    return { el, host, button, input };
}

export const GtkColorDialogButtonTest = async () => {
    await describe('<gtk-color-dialog-button> sensitivity', async () => {
        await it('is insensitive until a dialog is set — the first half of the C’s rule', () => {
            const { el, host, button } = mount();
            expect(button.disabled).toBe(true);
            el.dialog = {};
            expect(button.disabled).toBe(false);
            el.dialog = null;
            expect(button.disabled).toBe(true);
            host.remove();
        });

        await it('a dialog written in markup counts as one', () => {
            const { host, button } = mount({ dialog: '' });
            expect(button.disabled).toBe(false);
            host.remove();
        });

        await it('the disabled attribute is the author’s own switch, beside the dialog gate', () => {
            const { el, host, button } = mount({ dialog: '' });
            el.setAttribute('disabled', '');
            expect(button.disabled).toBe(true);
            el.removeAttribute('disabled');
            expect(button.disabled).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-color-dialog-button> rgba', async () => {
        await it('opens on the colour init gives it, not on black', () => {
            const { el, host } = mount();
            expect(el.rgba.red).toBe(0.75);
            expect(el.rgba.green).toBe(0.25);
            expect(el.rgba.blue).toBe(0.25);
            expect(el.rgba.alpha).toBe(1);
            host.remove();
        });

        await it('reads every CSS colour the browser knows, because CSSOM parses it', () => {
            const { el, host } = mount({ rgba: '#3584e4' });
            expect(el.rgba.red).toBeCloseTo(53 / 255, 4);
            expect(el.rgba.green).toBeCloseTo(132 / 255, 4);
            expect(el.rgba.blue).toBeCloseTo(228 / 255, 4);
            el.setAttribute('rgba', 'rgba(255, 0, 0, 0.5)');
            expect(el.rgba.alpha).toBe(0.5);
            el.setAttribute('rgba', 'not-a-colour');
            expect(el.rgba.red).toBeCloseTo(1, 4);
            host.remove();
        });

        await it('a write of the colour already held changes nothing and notifies nothing', () => {
            const { el, host } = mount({ rgba: '#ff0000' });
            const notified: unknown[] = [];
            el.addEventListener('notify::rgba', (e) => notified.push((e as CustomEvent).detail));
            el.rgba = '#ff0000';
            expect(notified.length).toBe(0);
            el.rgba = { red: 0, green: 0, blue: 1, alpha: 1 };
            expect(notified.length).toBe(1);
            host.remove();
        });
    });

    await describe('<gtk-color-dialog-button> accessible name', async () => {
        await it('is the channel percentages, with Alpha only while translucent', () => {
            const { el, host, button } = mount();
            expect(button.getAttribute('aria-label')).toBe('Red 75%, Green 25%, Blue 25%');
            el.rgba = 'rgba(255, 0, 0, 0.5)';
            expect(button.getAttribute('aria-label')).toBe('Red 100%, Green 0%, Blue 0%, Alpha 50%');
            host.remove();
        });

        await it('rounds half up, the way scale_round does', () => {
            const { el, host, button } = mount();
            // 0.255 is exactly the case a truncating round gets wrong.
            el.rgba = { red: 0.255, green: 0.754, blue: 0.5, alpha: 1 };
            expect(button.getAttribute('aria-label')).toBe('Red 26%, Green 75%, Blue 50%');
            host.remove();
        });
    });

    await describe('<gtk-color-dialog-button> chooser', async () => {
        await it('a chosen colour lands on the button, and the alpha it already had survives', () => {
            const { el, host, input } = mount({ dialog: '', rgba: '#ff0000' });
            el.rgba = 'rgba(255, 0, 0, 0.25)';
            el.activate();
            expect(input.value).toBe('#ff0000');
            input.value = '#0000ff';
            input.dispatchEvent(new Event('change'));
            expect(el.rgba.blue).toBe(1);
            expect(el.rgba.alpha).toBe(0.25);
            host.remove();
        });

        await it('is a group with a popup button, as GTK marks it', () => {
            const { host, button } = mount({ dialog: '' });
            expect(host.ownerDocument.activeElement).not.toBe(button);
            expect(button.getAttribute('aria-haspopup')).toBe('dialog');
            expect(host.firstElementChild?.getAttribute('role')).toBe('group');
            host.remove();
        });
    });

    await describe('<gtk-color-dialog-button> look', async () => {
        await it('paints the swatch with the colour, and marks a translucent one', () => {
            const { el, host } = mount({ rgba: '#3584e4' });
            const swatch = el.querySelector('.color-button-swatch') as HTMLElement;
            expect(getComputedStyle(swatch).backgroundColor).toBe('rgb(53, 132, 228)');
            expect(swatch.dataset.translucent).toBe('false');
            el.rgba = 'rgba(53, 132, 228, 0.5)';
            expect(swatch.dataset.translucent).toBe('true');
            host.remove();
        });
    });
};
