// DOM-level tests for <gtk-password-entry>. It composes `<gtk-entry>`'s input, so what is
// under test is the half C adds: masked by default, the peek button off unless
// `show-peek-icon` is asked for, and the Caps Lock warning shown only while the field has
// focus AND the text is still masked — the two rules `PasswordEntryRowState` derives.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkPasswordEntry } from './elements/gtk-password-entry.js';

function mount(attrs: Record<string, string> = {}): { el: GtkPasswordEntry; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-password-entry') as GtkPasswordEntry;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

function inner(el: GtkPasswordEntry): HTMLInputElement {
    return el.querySelector('input') as HTMLInputElement;
}

function peek(el: GtkPasswordEntry): HTMLButtonElement {
    return el.querySelector('.adw-password-entry-peek') as HTMLButtonElement;
}

function indicator(el: GtkPasswordEntry): HTMLElement {
    return el.querySelector('.adw-password-entry-caps-lock') as HTMLElement;
}

export const GtkPasswordEntryTest = async () => {
    await describe('<gtk-password-entry> masking', async () => {
        await it('starts masked, with the password input purpose a password field asks for', () => {
            const { el, host } = mount();
            expect(inner(el).type).toBe('password');
            // Read the ATTRIBUTE, not the IDL property: Firefox's form autofill owns the
            // reflected `autocomplete` IDL attribute and answers '' for a field it manages.
            expect(inner(el).getAttribute('autocomplete')).toBe('new-password');
            expect(el.revealed).toBe(false);
            expect(el.hasAttribute('revealed')).toBe(false);
            host.remove();
        });

        await it('show-peek-icon is off by default and the toggle appears with it', () => {
            const { el, host } = mount();
            expect(peek(el).hidden).toBe(true);
            el.setAttribute('show-peek-icon', '');
            expect(peek(el).hidden).toBe(false);
            host.remove();
        });

        await it('the peek button reveals, then conceals again, and notifies once each', async () => {
            const { el, host } = mount({ 'show-peek-icon': '' });
            const notified: unknown[] = [];
            el.addEventListener('notify::revealed', (e) => notified.push((e as CustomEvent).detail));
            peek(el).click();
            expect(el.revealed).toBe(true);
            expect(inner(el).type).toBe('text');
            expect(el.hasAttribute('revealed')).toBe(true);
            expect(peek(el).getAttribute('aria-pressed')).toBe('true');
            peek(el).click();
            expect(inner(el).type).toBe('password');
            expect(notified).toStrictEqual([{ revealed: true }, { revealed: false }]);
            host.remove();
        });

        await it('the peek glyph swaps between reveal and conceal, carrying the libadwaita name', () => {
            const { el, host } = mount({ 'show-peek-icon': '' });
            const icon = peek(el).querySelector('gtk-image') as HTMLElement;
            expect(icon.dataset.iconName).toBe('view-reveal-symbolic');
            expect(icon.classList.contains('adw-icon--view-reveal')).toBe(true);
            el.revealed = true;
            expect(icon.dataset.iconName).toBe('view-conceal-symbolic');
            expect(icon.classList.contains('adw-icon--view-conceal')).toBe(true);
            host.remove();
        });

        await it('re-setting the same revealed state notifies nothing', () => {
            const { el, host } = mount({ 'show-peek-icon': '' });
            const notified: unknown[] = [];
            el.addEventListener('notify::revealed', (e) => notified.push((e as CustomEvent).detail));
            el.revealed = false;
            el.revealed = false;
            expect(notified.length).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-password-entry> caps lock', async () => {
        await it('is off until the keyboard reports it, and never on while unfocused', () => {
            const { el, host } = mount();
            expect(el.capsLockOn).toBe(false);
            expect(indicator(el).hidden).toBe(true);
            el.setCapsLockOn(true);
            expect(el.capsLockOn).toBe(true);
            // `editing && show_indicator` — the focus condition GTK's own
            // `caps_lock_state_changed` has and the core derives.
            expect(indicator(el).hidden).toBe(true);
            inner(el).focus();
            expect(indicator(el).hidden).toBe(false);
            expect(indicator(el).dataset.iconName).toBe('caps-lock-symbolic');
            expect(indicator(el).title).toBe('Caps Lock is on');
            host.remove();
        });

        await it('peeking retracts the warning in the same turn, as C does', () => {
            const { el, host } = mount({ 'show-peek-icon': '' });
            inner(el).focus();
            el.setCapsLockOn(true);
            expect(indicator(el).hidden).toBe(false);
            el.revealed = true;
            expect(indicator(el).hidden).toBe(true);
            el.revealed = false;
            expect(indicator(el).hidden).toBe(false);
            host.remove();
        });

        await it('a keyboard event with Caps Lock engaged feeds the derivation', () => {
            const { el, host } = mount();
            // `modifierCapsLock` is a Firefox extension to `KeyboardEventInit` and the only
            // way a dispatched event can report Caps Lock; `getModifierState` is not an init
            // member, so passing it as one is silently dropped.
            inner(el).dispatchEvent(
                new KeyboardEvent('keydown', { key: 'A', bubbles: true, modifierCapsLock: true } as KeyboardEventInit),
            );
            expect(el.capsLockOn).toBe(true);
            inner(el).dispatchEvent(new KeyboardEvent('keyup', { key: 'A', bubbles: true }));
            expect(el.capsLockOn).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-password-entry> as an entry', async () => {
        await it('keeps the value, placeholder and disabled behaviour it inherits', () => {
            const { el, host } = mount({ value: 'hunter2', placeholder: 'Password', disabled: '' });
            expect(el.value).toBe('hunter2');
            expect(inner(el).placeholder).toBe('Password');
            expect(inner(el).disabled).toBe(true);
            host.remove();
        });

        await it('Enter activates, which Gtk.PasswordEntry signals on all forms of Enter', () => {
            const { el, host } = mount();
            let count = 0;
            el.addEventListener('activate', () => (count += 1));
            inner(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
            expect(count).toBe(1);
            host.remove();
        });
    });
};
