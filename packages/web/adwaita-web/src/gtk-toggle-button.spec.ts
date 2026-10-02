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

        await it('an ungrouped button still toggles off when clicked', () => {
            const { el, host } = mount({ label: 'Mute' });
            el.button.click();
            expect(el.active).toBe(true);
            el.button.click();
            expect(el.active).toBe(false);
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

    await describe('<gtk-toggle-button> group', async () => {
        await it('joining a group links the two ways, and leaves the attribute naming it', () => {
            const a = mount({ id: 'group-a', label: 'A' });
            const b = mount({ id: 'group-b', label: 'B' });
            b.el.group = a.el;
            expect(b.el.getAttribute('group')).toBe('group-a');
            // `gtk_toggle_button_set_group` inserts SELF before the target, so B is the one
            // that gains `group_next` — which is also the one a click can no longer release.
            b.el.button.click();
            expect(b.el.active).toBe(true);
            b.el.button.click();
            expect(b.el.active).toBe(true);
            a.host.remove();
            b.host.remove();
        });

        await it('activating a member releases the others, whichever order they were linked in', () => {
            const a = mount({ id: 'chain-a', label: 'A' });
            const b = mount({ id: 'chain-b', label: 'B' });
            const c = mount({ id: 'chain-c', label: 'C' });
            b.el.group = a.el;
            c.el.group = a.el;
            const toggled = record(c.el, 'toggled');
            c.el.active = true;
            expect(a.el.active).toBe(false);
            expect(b.el.active).toBe(false);
            expect(c.el.active).toBe(true);
            a.el.active = true;
            expect(c.el.active).toBe(false);
            expect(b.el.active).toBe(false);
            expect(a.el.active).toBe(true);
            expect(toggled.length).toBe(2);
            a.host.remove();
            b.host.remove();
            c.host.remove();
        });

        await it('the attribute door names the partner by id, and an unknown name changes nothing', () => {
            const a = mount({ id: 'attr-a', label: 'A' });
            const b = mount({ id: 'attr-b', label: 'B' });
            b.el.setAttribute('group', 'attr-a');
            a.el.active = true;
            b.el.active = true;
            expect(a.el.active).toBe(false);
            expect(b.el.active).toBe(true);
            b.el.setAttribute('group', 'nowhere');
            expect(b.el.getAttribute('group')).toBe('nowhere');
            a.el.active = true;
            expect(b.el.active).toBe(true);
            a.host.remove();
            b.host.remove();
        });

        await it('leaving the group releases the links, and the same group twice notifies once', () => {
            const a = mount({ id: 'once-a', label: 'A' });
            const b = mount({ id: 'once-b', label: 'B' });
            const notified = record(b.el, 'notify::group');
            b.el.group = a.el;
            b.el.group = a.el;
            expect(notified.length).toBe(1);
            b.el.group = null;
            expect(notified.length).toBe(2);
            expect(b.el.hasAttribute('group')).toBe(false);
            // Unlinked, B is clickable off again — the guard is the link, not the element.
            b.el.button.click();
            expect(b.el.active).toBe(true);
            b.el.button.click();
            expect(b.el.active).toBe(false);
            a.host.remove();
            b.host.remove();
        });
    });
};
