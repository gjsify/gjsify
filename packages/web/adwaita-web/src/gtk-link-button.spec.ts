// DOM-level tests for <gtk-link-button>: the two properties Gtk.LinkButton adds on top of
// Gtk.Button (`uri`, `visited`), the order GTK writes them in — a new URI un-visits, a click
// visits — and the boolean-accumulator shape of `::activate-link`.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkLinkButton } from './elements/gtk-link-button.js';

function mount(attrs: Record<string, string> = {}): { el: GtkLinkButton; host: HTMLElement; opened: string[] } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-link-button') as GtkLinkButton;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    // `window.open` is the launcher call; the specs must not open a tab to prove a colour.
    const opened: string[] = [];
    (el as unknown as { launch: (uri: string) => void }).launch = (uri: string) => opened.push(uri);
    return { el, host, opened };
}

/** Collect the `detail` of every `event` dispatched on (or bubbling to) `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

export const GtkLinkButtonTest = async () => {
    await describe('<gtk-link-button> uri', async () => {
        await it('is a gtk-button with a uri, and the uri is what a new one unsets', async () => {
            const { el, host } = mount({ uri: 'https://example.org/a', visited: '' });
            expect(el.uri).toBe('https://example.org/a');
            expect(el.visited).toBe(true);
            expect(el.button.classList.contains('adw-button')).toBe(true);
            expect(el.button.classList.contains('link')).toBe(true);
            expect(el.button.classList.contains('visited')).toBe(true);
            el.uri = 'https://example.org/b';
            expect(el.getAttribute('uri')).toBe('https://example.org/b');
            expect(el.visited).toBe(false);
            expect(el.button.classList.contains('visited')).toBe(false);
            host.remove();
        });

        await it('shows the uri as the tooltip only when the label is not the uri already', () => {
            const named = mount({ uri: 'https://example.org/', label: 'Example' });
            expect(named.el.button.title).toBe('https://example.org/');
            const same = mount({ uri: 'https://example.org/', label: 'https://example.org/' });
            expect(same.el.button.title).toBe('');
            const own = mount({ uri: 'https://example.org/', label: 'Example', tooltip: 'Home' });
            expect(own.el.button.title).toBe('Home');
            named.host.remove();
            same.host.remove();
            own.host.remove();
        });
    });

    await describe('<gtk-link-button> activation', async () => {
        await it('a click launches the uri and then visits the link', () => {
            const { el, host, opened } = mount({ uri: 'https://example.org/a', label: 'Example' });
            const notified = record(el, 'notify::visited');
            el.button.click();
            expect(opened).toStrictEqual(['https://example.org/a']);
            expect(el.visited).toBe(true);
            expect(notified).toStrictEqual([{ visited: true }]);
            host.remove();
        });

        await it('cancelling activate-link is a handler returning TRUE: no launch, no visit', () => {
            const { el, host, opened } = mount({ uri: 'https://example.org/a', label: 'Example' });
            let handled = false;
            el.addEventListener('activate-link', (event) => {
                event.preventDefault();
                handled = true;
            });
            el.button.click();
            expect(handled).toBe(true);
            expect(opened).toStrictEqual([]);
            expect(el.visited).toBe(false);
            host.remove();
        });

        await it('a button with no uri launches nothing', () => {
            const { el, host, opened } = mount({ label: 'Nowhere' });
            el.button.click();
            expect(opened).toStrictEqual([]);
            expect(el.visited).toBe(false);
            host.remove();
        });

        await it('writing the visited state directly notifies, and re-writing it does not', () => {
            const { el, host } = mount({ uri: 'https://example.org/a' });
            const notified = record(el, 'notify::visited');
            el.visited = true;
            el.visited = true;
            expect(notified).toStrictEqual([{ visited: true }]);
            host.remove();
        });
    });

    await describe('<gtk-link-button> look', async () => {
        await it('a visited link is drawn in a different colour than a fresh one', () => {
            const { el, host } = mount({ uri: 'https://example.org/a', label: 'Example' });
            const fresh = getComputedStyle(el.button).color;
            el.visited = true;
            expect(getComputedStyle(el.button).color === fresh).toBe(false);
            host.remove();
        });

        await it('keeps the link treatment through a re-render of the label', () => {
            const { el, host } = mount({ uri: 'https://example.org/a', label: 'Example', visited: '' });
            el.setAttribute('label', 'Other');
            expect(el.button.textContent).toBe('Other');
            expect(el.button.classList.contains('link')).toBe(true);
            expect(el.button.classList.contains('visited')).toBe(true);
            host.remove();
        });
    });
};
