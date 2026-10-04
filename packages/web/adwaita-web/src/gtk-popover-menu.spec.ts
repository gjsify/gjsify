// `<gtk-popover-menu>` — the menu-model-driven popover. What is worth pinning here is what
// `gtkpopovermenu.c` adds ON TOP of `<gtk-popover>`: the page stack (`visible-submenu`,
// `gtk_stack_set_visible_child_name`, gtkpopovermenu.c:755-757), the `main` way back, and
// the activation rule that closes the popover and gives focus to the anchor.
//
// The rows themselves are `PopoverMenuView`, ratcheted through `MENU_*_VECTORS` in
// `<gtk-menu-button>`'s spec against the same core tables — a third copy of those vectors
// would be a third place to forget.

import { describe, expect, it } from '@gjsify/unit';
import { MENU_REFUSAL_VECTORS } from '@gjsify/adwaita-core/conformance';
import { flattenMenu } from '@gjsify/adwaita-core';
import type { AdwMenuInput, AdwMenuModel } from '@gjsify/adwaita-core';

interface PopoverMenuElement extends HTMLElement {
    menuModel: AdwMenuInput | AdwMenuModel;
    actions: Record<string, { enabled?: boolean; state?: string }> | null;
    visibleSubmenu: string;
    // The three below are `GtkPopover`'s own — the reason this spec can say "inherits the
    // state machine rather than copying it" and have the compiler agree.
    open: boolean;
    autohide: boolean;
    anchor: HTMLElement | null;
    openSubmenu(name: string): void;
    closeSubmenus(): void;
    popup(): void;
    popdown(): void;
}

const NESTED = [{ label: 'New' }, { label: 'More', submenu: [{ label: 'Rename' }, { label: 'Duplicate' }] }];

function mount(json?: string): PopoverMenuElement {
    const el = document.createElement('gtk-popover-menu') as PopoverMenuElement;
    if (json !== undefined) el.setAttribute('menu-model', json);
    document.body.appendChild(el);
    return el;
}

function labels(el: HTMLElement): string[] {
    return [...el.querySelectorAll('.adw-popover-item')].map(
        (row) => row.querySelector('.adw-popover-menu-item-label')?.textContent ?? '',
    );
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-popover-menu'))) el.remove();
}

export const GtkPopoverMenuTest = async () => {
    await describe('<gtk-popover-menu> the surface', async () => {
        await it('carries the .menu variant and the menu role, as GtkPopoverMenu does', () => {
            const el = mount();
            // gtkpopovermenu.c:152-154 — "It is one of the cases that add a `.menu` style
            // class to the main `popover` node", and :688-692 for the accessible role.
            expect(el.classList.contains('adw-popover-menu')).toBe(true);
            expect(el.getAttribute('menu')).toBe('');
            expect(el.getAttribute('role')).toBe('menu');
            unmountAll();
        });

        await it('inherits the popover state machine rather than copying it', () => {
            const el = mount();
            el.open = true;
            expect(el.hasAttribute('open')).toBe(true);
            expect(el.hidden).toBe(false);
            el.popdown();
            expect(el.open).toBe(false);
            // `autohide` is `GtkPopover`'s, and `GtkPopoverMenu` is a subclass of it —
            // which is why `gtk_popover_menu_new` spells `autohide = TRUE` explicitly
            // (gtkpopovermenu.c:729-731) even though it is already the default.
            expect(el.autohide).toBe(true);
            unmountAll();
        });
    });

    await describe('<gtk-popover-menu> the page stack', async () => {
        await it('renders the model and reports the root page as `main`', () => {
            const el = mount();
            el.menuModel = NESTED;
            expect(labels(el)).toStrictEqual(['New', 'More']);
            expect(el.visibleSubmenu).toBe('main');
            unmountAll();
        });

        await it('opens a submenu by name and swaps the page', () => {
            const el = mount();
            el.menuModel = NESTED;
            el.openSubmenu('More');
            // A submenu's page is the back row plus its own items — the submenu's contents
            // are never inlined into the parent.
            expect(labels(el)).toStrictEqual(['More', 'Rename', 'Duplicate']);
            expect(el.visibleSubmenu).toBe('More');
            unmountAll();
        });

        await it('`main` goes back, and so does closeSubmenus', () => {
            const el = mount();
            el.menuModel = NESTED;
            el.openSubmenu('More');
            el.openSubmenu('main');
            expect(labels(el)).toStrictEqual(['New', 'More']);
            el.openSubmenu('More');
            // `gtk_popover_menu_close_submenus` leaves ONE level (gtkpopovermenu.c:223-233).
            el.closeSubmenus();
            expect(el.visibleSubmenu).toBe('main');
            expect(labels(el)).toStrictEqual(['New', 'More']);
            unmountAll();
        });

        await it('a name no submenu carries leaves the open page alone', () => {
            const el = mount();
            el.menuModel = NESTED;
            el.openSubmenu('More');
            // `gtk_stack_set_visible_child_name` on a child that is not there is a no-op in
            // GTK, so the current page must survive rather than blank the surface.
            el.openSubmenu('Nope');
            expect(el.visibleSubmenu).toBe('More');
            expect(labels(el)).toStrictEqual(['More', 'Rename', 'Duplicate']);
            unmountAll();
        });

        await it('`visible-submenu` as an ATTRIBUTE navigates, and notifies once per page', () => {
            const el = mount();
            el.menuModel = NESTED;
            const seen: string[] = [];
            el.addEventListener('notify::visible-submenu', (event) => {
                seen.push((event as CustomEvent<{ visibleSubmenu: string }>).detail.visibleSubmenu);
            });
            el.setAttribute('visible-submenu', 'More');
            expect(el.visibleSubmenu).toBe('More');
            // ONE notify per real change: the attribute path is answered by navigation, and
            // navigation writes the attribute back — a second notify would report the same
            // page twice.
            expect(seen).toStrictEqual(['More']);
            unmountAll();
        });

        await it('a CHANGED model drops the open page', () => {
            const el = mount();
            el.menuModel = NESTED;
            el.openSubmenu('More');
            el.menuModel = [{ label: 'Only' }];
            // The submenu the page named is gone; staying on it would leave a back row and
            // no items behind it.
            expect(el.visibleSubmenu).toBe('main');
            expect(labels(el)).toStrictEqual(['Only']);
            unmountAll();
        });

        await it('an UNCHANGED model keeps the open page', () => {
            const el = mount();
            el.menuModel = NESTED;
            el.openSubmenu('More');
            el.menuModel = JSON.parse(JSON.stringify(NESTED)) as AdwMenuInput;
            expect(el.visibleSubmenu).toBe('More');
            unmountAll();
        });

        await it('closing the popover returns to the root page', async () => {
            const el = mount();
            el.menuModel = NESTED;
            el.openSubmenu('More');
            el.open = true;
            el.open = false;
            el.open = true;
            // `gtk_popover_menu_show` clears the open submenu (gtkpopovermenu.c:573-579).
            expect(el.visibleSubmenu).toBe('main');
            unmountAll();
        });
    });

    await describe('<gtk-popover-menu> activation closes it', async () => {
        await it('choosing an item pops down, focuses the anchor and reports the path', () => {
            const anchor = document.createElement('button');
            const el = document.createElement('gtk-popover-menu') as PopoverMenuElement;
            anchor.appendChild(el);
            document.body.appendChild(anchor);
            el.menuModel = NESTED;
            el.openSubmenu('More');
            el.anchor = anchor;
            el.open = true;

            let detail: { id: string; label: string; path: number[] } | null = null;
            el.addEventListener('menu-item-activated', (event) => {
                detail = (event as CustomEvent<{ id: string; label: string; path: number[] }>).detail;
            });
            const rows = [...el.querySelectorAll<HTMLButtonElement>('.adw-popover-item')];
            rows[1].click(); // `Rename`, inside the submenu

            // A menu cannot be left open by choosing from it, and the reader is handed back
            // to whatever opened it.
            expect(el.open).toBe(false);
            expect(document.activeElement).toBe(anchor);
            expect(detail).toStrictEqual({ id: 'Rename', label: 'Rename', path: [1, 0] });
            anchor.remove();
        });

        await it('a disabled row activates nothing', () => {
            const el = mount();
            el.menuModel = [{ label: 'Quit', action: 'app.quit' }];
            el.actions = { 'app.quit': { enabled: false } };
            let fired = false;
            el.addEventListener('menu-item-activated', () => {
                fired = true;
            });
            (el.querySelector('.adw-popover-item') as HTMLButtonElement).click();
            expect(fired).toBe(false);
            unmountAll();
        });
    });

    await describe('<gtk-popover-menu> the menu attribute', async () => {
        await it('reads the JSON and draws the same rows `flattenMenu` names', () => {
            const el = mount('[{"label":"New"},{"section":[{"label":"Cut"}],"label":"Edit"}]');
            const model: AdwMenuModel = [
                { kind: 'item', label: 'New' },
                { kind: 'section', label: 'Edit', items: [{ kind: 'item', label: 'Cut' }] },
            ];
            expect(labels(el)).toStrictEqual(flattenMenu(model).map((row) => row.node.label));
            unmountAll();
        });

        await it('a malformed attribute is not a refusal — a typo may not stop the upgrade', () => {
            const el = mount('not json at all');
            expect(labels(el)).toStrictEqual([]);
            unmountAll();
        });

        await it('the ATTRIBUTE path refuses a `custom` item without throwing', () => {
            const errors: unknown[] = [];
            const real = console.error;
            console.error = (...args: unknown[]) => errors.push(args.join(' '));
            try {
                const el = mount('[{"label":"Zoom","custom":"zoom-control"}]');
                // A throw from `connectedCallback` reaches nobody — it is an uncaught page
                // error — so markup refuses the menu instead, which is visible.
                expect(labels(el)).toStrictEqual([]);
                expect(errors.join('\n')).toContain('zoom-control');
                el.remove();
            } finally {
                console.error = real;
            }
        });

        await it('the PROPERTY path refuses a `custom` item loudly', () => {
            for (const { model, paths, rule } of MENU_REFUSAL_VECTORS) {
                const el = mount();
                if (paths.length > 0) {
                    expect(() => {
                        el.menuModel = model;
                    }).toThrow('adwaita-web');
                } else {
                    el.menuModel = model;
                    expect(labels(el)).toStrictEqual(flattenMenu(model).map((row) => row.node.label));
                }
                expect(rule.length > 0).toBe(true);
                el.remove();
            }
        });
    });
};
