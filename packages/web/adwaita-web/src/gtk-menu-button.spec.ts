// DOM-level tests for <gtk-menu-button>'s `menu` attribute.
//
// The element parsed the JSON itself, and the copy was weaker than the core parser
// the split button next to it already used: it kept `id` and `icon` whatever their
// runtime type, so author markup could put a number in a field typed `string` — and
// `id` is exactly what the activation event reports. These drive the core's parse
// vectors against the real element.

import { describe, expect, it } from '@gjsify/unit';
import { SPLIT_BUTTON_MENU_PARSE_VECTORS } from '@gjsify/adwaita-core/conformance';

/** Mount a menu button carrying `menu` as JSON, and return its rendered item labels. */
function mountWithMenu(json: string): { el: HTMLElement; labels: string[] } {
    const el = document.createElement('gtk-menu-button');
    el.setAttribute('menu', json);
    document.body.appendChild(el);
    const labels = Array.from(el.querySelectorAll('.adw-popover button')).map((b) => b.textContent?.trim() ?? '');
    return { el, labels };
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-menu-button'))) el.remove();
}

export const GtkMenuButtonTest = async () => {
    await describe('<gtk-menu-button> menu attribute', async () => {
        for (const { json, entries, rule } of SPLIT_BUTTON_MENU_PARSE_VECTORS) {
            await it(`${rule}`, () => {
                const { labels } = mountWithMenu(json ?? '');
                expect(labels).toStrictEqual(entries.map((entry) => entry.label));
                unmountAll();
            });
        }

        await it('drops a non-string id instead of leaking a number into the event', () => {
            const el = document.createElement('gtk-menu-button');
            el.setAttribute('menu', '[{"label":"Open","id":7}]');
            document.body.appendChild(el);

            let seen: unknown = 'not fired';
            el.addEventListener('menu-item-activated', (e) => {
                seen = (e as CustomEvent<{ id: string }>).detail.id;
            });
            (el.querySelector('.adw-popover button') as HTMLElement | null)?.click();

            // `id` fell back to the label, which is the documented default — rather
            // than arriving as the number 7 in a field every consumer reads as text.
            expect(seen).toBe('Open');
            unmountAll();
        });
    });
};
