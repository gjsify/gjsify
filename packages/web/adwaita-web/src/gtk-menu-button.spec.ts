// DOM-level tests for <gtk-menu-button>'s `menu-model` attribute.
//
// The element parsed the JSON itself, and the copy was weaker than the core parser
// the split button next to it already used: it kept `id` and `icon` whatever their
// runtime type, so author markup could put a number in a field typed `string` — and
// `id` is exactly what the activation event reports. These drive the core's parse and
// flatten vectors against the real element.

import { describe, expect, it } from '@gjsify/unit';
import { MENU_ITEM_STATE_VECTORS, MENU_PARSE_VECTORS, MENU_REFUSAL_VECTORS } from '@gjsify/adwaita-core/conformance';
import { flattenMenu } from '@gjsify/adwaita-core';
import type { AdwMenuInput } from '@gjsify/adwaita-core';

interface MenuButtonElement extends HTMLElement {
    menuModel: AdwMenuInput;
    actions: Record<string, { enabled?: boolean; state?: string }> | null;
}

/** Mount a menu button carrying `menu-model` as JSON, and return its rendered row labels. */
function mountWithMenu(json: string): { el: HTMLElement; labels: string[] } {
    const el = document.createElement('gtk-menu-button');
    el.setAttribute('menu-model', json);
    document.body.appendChild(el);
    const labels = Array.from(el.querySelectorAll('.adw-popover-item')).map(
        (b) => b.querySelector('.adw-menu-button-item-label')?.textContent ?? '',
    );
    return { el, labels };
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-menu-button'))) el.remove();
}

export const GtkMenuButtonTest = async () => {
    await describe('<gtk-menu-button> menu attribute', async () => {
        for (const { json, model, rule } of MENU_PARSE_VECTORS) {
            await it(`${rule}`, () => {
                const { labels } = mountWithMenu(json ?? '');
                // The rendered rows are what `flattenMenu` says: a section is inlined,
                // a submenu is ONE row, and both keep their own label.
                expect(labels).toStrictEqual(flattenMenu(model).map((row) => row.node.label));
                unmountAll();
            });
        }

        await it('drops a non-string id instead of leaking a number into the event', () => {
            const el = document.createElement('gtk-menu-button');
            el.setAttribute('menu-model', '[{"label":"Open","id":7}]');
            document.body.appendChild(el);

            let seen: unknown = 'not fired';
            el.addEventListener('menu-item-activated', (e) => {
                seen = (e as CustomEvent<{ id: string }>).detail.id;
            });
            (el.querySelector('.adw-popover-item') as HTMLElement | null)?.click();

            // `id` fell back to the label, which is the documented default — rather
            // than arriving as the number 7 in a field every consumer reads as text.
            expect(seen).toBe('Open');
            unmountAll();
        });
    });

    await describe('<gtk-menu-button> keeps its menu replaceable while live', async () => {
        // The property `check-adwaita-collection-reactivity.mjs` exists to protect, and
        // the one it cannot see here: this widget keeps its model in its own field rather
        // than in a core state class, and parses its attribute through a MODULE function,
        // so every rule in that reader is silent on it. A spec stands where the reader
        // cannot.
        await it('a menuModel assigned AFTER connect reaches the rows', () => {
            const el = document.createElement('gtk-menu-button') as MenuButtonElement;
            document.body.appendChild(el);
            expect(el.querySelectorAll('.adw-popover-item').length).toBe(0);
            el.menuModel = ['New', 'Open'];
            expect([...el.querySelectorAll('.adw-menu-button-item-label')].map((n) => n.textContent)).toStrictEqual([
                'New',
                'Open',
            ]);
            // REPLACED, not merely seeded — the failure mode is a second assignment
            // writing an expando while the first happened to work at connect.
            el.menuModel = [{ label: 'Only', action: 'app.only' }];
            expect([...el.querySelectorAll('.adw-menu-button-item-label')].map((n) => n.textContent)).toStrictEqual([
                'Only',
            ]);
            unmountAll();
        });

        await it('a menu-model ATTRIBUTE set after connect reaches them too', () => {
            const el = document.createElement('gtk-menu-button') as MenuButtonElement;
            document.body.appendChild(el);
            el.setAttribute('menu-model', '[{"label":"Later"}]');
            expect([...el.querySelectorAll('.adw-menu-button-item-label')].map((n) => n.textContent)).toStrictEqual([
                'Later',
            ]);
            unmountAll();
        });
    });

    await describe('<gtk-menu-button> renders the whole model (ADR 0042)', async () => {
        await it('draws a section heading, a separator and a submenu page', () => {
            const el = document.createElement('gtk-menu-button') as MenuButtonElement;
            document.body.appendChild(el);
            el.menuModel = [
                { label: 'New' },
                { section: [{ label: 'Cut' }, { label: 'Copy' }], label: 'Edit' },
                { label: 'More', submenu: [{ label: 'Rename' }, { label: 'Duplicate' }] },
            ];

            // TWO: a section is separated from what comes before it AND from what comes
            // after, which is what `GtkPopoverMenu` draws for the same model.
            expect(el.querySelectorAll('.adw-popover-separator').length).toBe(2);
            expect(el.querySelector('.adw-popover-section-title')?.textContent).toBe('Edit');
            const rows = [...el.querySelectorAll('.adw-popover-item')] as HTMLButtonElement[];
            expect(rows.length).toBe(4);
            // The submenu is a row that OPENS, not a row that acts.
            expect(rows[3].getAttribute('aria-haspopup')).toBe('menu');

            rows[3].click();
            const page = [...el.querySelectorAll('.adw-popover-item')] as HTMLButtonElement[];
            // A back row plus the submenu's two items — the submenu's contents were
            // never inlined into the parent page.
            expect(page.length).toBe(3);
            expect(page[0].classList.contains('adw-popover-back')).toBe(true);
            expect(page.map((r) => r.querySelector('.adw-menu-button-item-label')?.textContent)).toStrictEqual([
                'More',
                'Rename',
                'Duplicate',
            ]);

            page[0].click();
            expect(el.querySelectorAll('.adw-popover-item').length).toBe(4);
            unmountAll();
        });

        for (const { item, actions, state, rule } of MENU_ITEM_STATE_VECTORS) {
            await it(`action state reaches the DOM — ${rule}`, () => {
                const el = document.createElement('gtk-menu-button') as MenuButtonElement;
                document.body.appendChild(el);
                el.actions = { ...actions };
                el.menuModel = [item];
                const row = el.querySelector('.adw-popover-item') as HTMLButtonElement;
                expect(row.hidden).toBe(!state.visible);
                expect(row.disabled).toBe(!state.sensitive);
                const expectedRole =
                    state.role === 'normal'
                        ? 'menuitem'
                        : state.role === 'check'
                          ? 'menuitemcheckbox'
                          : 'menuitemradio';
                expect(row.getAttribute('role')).toBe(expectedRole);
                expect(row.getAttribute('aria-checked')).toBe(state.role === 'normal' ? null : String(state.toggled));
                unmountAll();
            });
        }

        await it('the ATTRIBUTE path refuses too — markup is where a blank row actually ships', () => {
            // The first cut asserted only the property setter, so a `custom` item written
            // in markup drew exactly the row the refusal exists to prevent.
            //
            // It does NOT throw, and that is measured rather than chosen: a throw from
            // `connectedCallback` is not delivered to whoever appended the element, it is
            // reported as an uncaught PAGE error — it broke `adwaita-upgrade-order`,
            // which counts those. So the menu is refused whole (a menu-less dropdown is
            // insensitive, which is visible) and the reason goes to `console.error`.
            const errors: unknown[] = [];
            const real = console.error;
            console.error = (...args: unknown[]) => errors.push(args.join(' '));
            try {
                const el = document.createElement('gtk-menu-button');
                el.setAttribute('menu-model', '[{"label":"Zoom","custom":"zoom-control"},{"label":"Quit"}]');
                document.body.appendChild(el);
                expect(el.querySelectorAll('.adw-popover-item').length).toBe(0);
                expect(errors.join('\n')).toContain('zoom-control');
            } finally {
                console.error = real;
            }
            unmountAll();
        });

        await it('a malformed attribute is NOT a refusal — a typo may not stop the upgrade', () => {
            // The other half of the same rule: `parseMenuModel` stays total, so this
            // element upgrades with no menu instead of throwing.
            const { labels } = mountWithMenu('not json at all');
            expect(labels).toStrictEqual([]);
            unmountAll();
        });

        for (const { model, paths, rule } of MENU_REFUSAL_VECTORS) {
            await it(`refusal — ${rule}`, () => {
                const el = document.createElement('gtk-menu-button') as MenuButtonElement;
                document.body.appendChild(el);
                if (paths.length === 0) {
                    el.menuModel = model;
                    expect(el.querySelectorAll('.adw-popover-item').length).toBe(flattenMenu(model).length);
                } else {
                    // LOUD, at the assignment: a `custom` item names an application
                    // widget, and a surface that ignored it would draw a blank row.
                    expect(() => {
                        el.menuModel = model;
                    }).toThrow('adwaita-web');
                }
                unmountAll();
            });
        }
    });
};
