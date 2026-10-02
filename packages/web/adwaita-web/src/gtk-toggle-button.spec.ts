// DOM-level tests for <gtk-toggle-button>. It IS a <gtk-button>, so what matters here is
// the one thing it adds: `active`. The state is the attribute; the inner button wears
// libadwaita's `:checked` as `.checked` and `aria-pressed`; `toggled` and `notify::active`
// fire on every real change and on none that did not happen.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkToggleButton } from './elements/gtk-toggle-button.js';

function mount(attrs: Record<string, string> = {}): { el: GtkToggleButton; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-toggle-button') as GtkToggleButton;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

/** Collect the `detail` of every `event` dispatched on (or bubbling to) `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

export const GtkToggleButtonTest = async () => {
    await describe('<gtk-toggle-button> state', async () => {
        await it('starts released, and renders as a gtk-button would', () => {
            const { el, host } = mount({ label: 'Mute' });
            expect(el.active).toBe(false);
            expect(el.button.classList.contains('adw-button')).toBe(true);
            expect(el.button.classList.contains('checked')).toBe(false);
            expect(el.button.getAttribute('aria-pressed')).toBe('false');
            expect(el.button.textContent).toBe('Mute');
            host.remove();
        });

        await it('adopts a declarative active attribute without emitting', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const el = document.createElement('gtk-toggle-button') as GtkToggleButton;
            el.setAttribute('active', '');
            const events = record(el, 'toggled');
            host.appendChild(el);
            expect(el.active).toBe(true);
            expect(el.button.classList.contains('checked')).toBe(true);
            expect(el.button.getAttribute('aria-pressed')).toBe('true');
            expect(events.length).toBe(0);
            host.remove();
        });

        await it('a click flips it, and notifies once per change', () => {
            const { el, host } = mount({ label: 'Mute' });
            const toggled = record(el, 'toggled');
            const notified = record(el, 'notify::active');
            el.button.click();
            expect(el.active).toBe(true);
            expect(el.button.classList.contains('checked')).toBe(true);
            el.button.click();
            expect(el.active).toBe(false);
            expect(toggled.length).toBe(2);
            expect(notified).toStrictEqual([{ active: true }, { active: false }]);
            host.remove();
        });

        await it('a programmatic set notifies, and re-setting the same value does not', () => {
            const { el, host } = mount();
            const notified = record(el, 'notify::active');
            el.active = true;
            el.active = true;
            expect(notified).toStrictEqual([{ active: true }]);
            host.remove();
        });

        await it('a disabled button does not toggle on a click, but the property still applies', () => {
            const { el, host } = mount({ disabled: '' });
            el.button.click();
            expect(el.active).toBe(false);
            el.active = true;
            expect(el.button.classList.contains('checked')).toBe(true);
            host.remove();
        });

        await it('keeps the checked class through a re-render of the label and the styles', () => {
            const { el, host } = mount({ label: 'Mute', active: '' });
            el.setAttribute('label', 'Unmute');
            el.setAttribute('flat', '');
            expect(el.button.textContent).toBe('Unmute');
            expect(el.button.classList.contains('flat')).toBe(true);
            expect(el.button.classList.contains('checked')).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-toggle-button> look', async () => {
        await it('a checked button paints darker than a released one', () => {
            const { el, host } = mount({ label: 'Mute' });
            const released = getComputedStyle(el.button).backgroundColor;
            el.active = true;
            const checked = getComputedStyle(el.button).backgroundColor;
            expect(checked === released).toBe(false);
            host.remove();
        });
    });
};
