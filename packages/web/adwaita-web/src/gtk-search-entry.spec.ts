// DOM-level tests for <gtk-search-entry>. Its whole reason to exist is the DELAY: typing
// queues `search-changed`, emptying the field fires it at once and cancels the queue, and
// the two keybinding signals are dispatched rather than acted on.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkSearchEntry } from './elements/gtk-search-entry.js';

function mount(attrs: Record<string, string> = {}): { el: GtkSearchEntry; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-search-entry') as GtkSearchEntry;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

function inner(el: GtkSearchEntry): HTMLInputElement {
    return el.querySelector('input') as HTMLInputElement;
}

function clear(el: GtkSearchEntry): HTMLButtonElement {
    return el.querySelector('.adw-search-entry-clear') as HTMLButtonElement;
}

/** Wait past the default 150ms delay, which is what `search-changed` is for. */
function settle(ms = 220): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export const GtkSearchEntryTest = async () => {
    await describe('<gtk-search-entry> the two icons', async () => {
        await it('shows the search glyph always and the clear button only with text', () => {
            const { el, host } = mount();
            expect(el.querySelector('.adw-search-entry-icon')).not.toBeNull();
            expect(clear(el).hidden).toBe(true);
            inner(el).value = 'gjs';
            inner(el).dispatchEvent(new Event('input'));
            expect(clear(el).hidden).toBe(false);
            host.remove();
        });

        await it('is a search box to assistive technology', () => {
            const { el, host } = mount();
            expect(el.getAttribute('role')).toBe('searchbox');
            expect(el.querySelector('.adw-search-entry-clear')?.getAttribute('aria-label')).toBe('Clear Entry');
            host.remove();
        });

        await it('the clear button empties the field, as gtk_icon_release does', () => {
            const { el, host } = mount({ value: 'gtk' });
            clear(el).click();
            expect(inner(el).value).toBe('');
            expect(clear(el).hidden).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-search-entry> search-delay', async () => {
        await it('defaults to 150ms, which is the pspec default', () => {
            const { el, host } = mount();
            expect(el.searchDelay).toBe(150);
            el.setAttribute('search-delay', '0');
            expect(el.searchDelay).toBe(0);
            host.remove();
        });

        await it('a keystroke queues search-changed instead of firing it at once', async () => {
            const { el, host } = mount();
            const seen: unknown[] = [];
            el.addEventListener('search-changed', (e) => seen.push((e as CustomEvent).detail));
            inner(el).value = 'g';
            inner(el).dispatchEvent(new Event('input'));
            expect(seen.length).toBe(0);
            await settle();
            expect(seen).toStrictEqual([{ value: 'g' }]);
            host.remove();
        });

        await it('two keystrokes make ONE signal — the timeout is replaced, not queued', async () => {
            const { el, host } = mount();
            let count = 0;
            el.addEventListener('search-changed', () => (count += 1));
            for (const text of ['g', 'gj', 'gjs']) {
                inner(el).value = text;
                inner(el).dispatchEvent(new Event('input'));
            }
            await settle();
            expect(count).toBe(1);
            host.remove();
        });

        await it('emptying the field fires at once and cancels what was pending', async () => {
            const { el, host } = mount({ value: 'gjs' });
            const seen: unknown[] = [];
            el.addEventListener('search-changed', (e) => seen.push((e as CustomEvent).detail));
            clear(el).click();
            expect(seen).toStrictEqual([{ value: '' }]);
            await settle();
            expect(seen.length).toBe(1);
            host.remove();
        });
    });

    await describe('<gtk-search-entry> keys', async () => {
        await it('Enter activates and Escape stops the search', () => {
            const { el, host } = mount();
            const seen: string[] = [];
            for (const name of ['activate', 'stop-search', 'next-match', 'previous-match']) {
                el.addEventListener(name, () => seen.push(name));
            }
            const press = (key: string, init: KeyboardEventInit = {}) =>
                inner(el).dispatchEvent(
                    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
                );
            press('Enter');
            press('Escape');
            press('g', { ctrlKey: true });
            press('g', { ctrlKey: true, shiftKey: true });
            expect(seen).toStrictEqual(['activate', 'stop-search', 'next-match', 'previous-match']);
            host.remove();
        });

        await it('a bare g is text, not next-match', () => {
            const { el, host } = mount();
            let count = 0;
            el.addEventListener('next-match', () => (count += 1));
            inner(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'g', bubbles: true, cancelable: true }));
            expect(count).toBe(0);
            host.remove();
        });
    });

    await describe('<gtk-search-entry> as an entry', async () => {
        await it('keeps the value, placeholder and disabled behaviour it inherits', () => {
            const { el, host } = mount({ value: 'gtk', placeholder: 'Search…', disabled: '' });
            expect(el.value).toBe('gtk');
            expect(inner(el).placeholder).toBe('Search…');
            expect(inner(el).disabled).toBe(true);
            host.remove();
        });
    });
};
