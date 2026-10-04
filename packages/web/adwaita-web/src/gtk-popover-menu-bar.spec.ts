// `<gtk-popover-menu-bar>` — the widget whose whole behaviour is `set_active_item`
// (gtkpopovermenubar.c:126-163). Three outcomes hang off two booleans there, and this spec
// drives each of them separately, because merging them is how a menubar comes to open its
// menus on HOVER — the one thing that distinguishes it from a row of menu buttons.

import { describe, expect, it } from '@gjsify/unit';
import type { AdwMenuInput } from '@gjsify/adwaita-core';

interface MenuBarElement extends HTMLElement {
    menuModel: AdwMenuInput;
    actions: Record<string, { enabled?: boolean; state?: string }> | null;
    activeItem: HTMLElement | null;
    selectFirst(): void;
    popup(): void;
}

/** Three submenus, the shape GTK builds one item for (`tracker_insert`, :422-468). */
const MENU = [
    { label: 'File', submenu: [{ label: 'New' }, { label: 'Open' }] },
    { label: 'Edit', submenu: [{ label: 'Cut' }] },
    { label: 'View', submenu: [{ label: 'Zoom In' }] },
];

function mount(json?: string): MenuBarElement {
    const el = document.createElement('gtk-popover-menu-bar') as MenuBarElement;
    if (json !== undefined) el.setAttribute('menu-model', json);
    document.body.appendChild(el);
    return el;
}

const items = (el: HTMLElement): HTMLElement[] => [...el.querySelectorAll<HTMLElement>('.adw-popover-menu-bar-item')];
const buttons = (el: HTMLElement): HTMLButtonElement[] => [
    ...el.querySelectorAll<HTMLButtonElement>('.adw-popover-menu-bar-button'),
];
/** Each item's popover, typed with the surface the element drives. */
interface PopoverSurface extends HTMLElement {
    open: boolean;
    popdown(): void;
}

const popovers = (el: HTMLElement): PopoverSurface[] =>
    [...el.querySelectorAll<HTMLElement>('gtk-popover-menu')] as unknown as PopoverSurface[];

/** `item_enter_cb` — a motion ENTER, which selects WITHOUT opening. */
function hover(item: HTMLElement): void {
    item.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false }));
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-popover-menu-bar'))) el.remove();
}

export const GtkPopoverMenuBarTest = async () => {
    await describe('<gtk-popover-menu-bar> the items', async () => {
        await it('builds one item per TOPLEVEL SUBMENU, each with a popover under it', () => {
            const el = mount();
            el.menuModel = MENU;
            expect(items(el).length).toBe(3);
            expect(buttons(el).map((b) => b.textContent)).toStrictEqual(['File', 'Edit', 'View']);
            expect(popovers(el).length).toBe(3);
            // `role` is set on the BAR and on the ITEMS, never on the wrapper
            // (gtkpopovermenubar.c:641, :347-349, :55-57).
            expect(el.getAttribute('role')).toBe('menubar');
            expect(buttons(el).every((b) => b.getAttribute('role') === 'menuitem')).toBe(true);
            expect(items(el).every((item) => item.getAttribute('role') === 'none')).toBe(true);
            unmountAll();
        });

        await it('pins each popover to the bottom, start-aligned and arrow-less', () => {
            const el = mount();
            el.menuModel = MENU;
            // `gtk_popover_set_position (popover, GTK_POS_BOTTOM)`,
            // `set_has_arrow (FALSE)` and `set_halign (START)` (gtkpopovermenubar.c:435-437).
            for (const popover of popovers(el)) {
                expect(popover.getAttribute('position')).toBe('bottom');
                expect(popover.getAttribute('align')).toBe('start');
                expect(popover.hasAttribute('has-arrow')).toBe(false);
            }
            unmountAll();
        });

        await it('renders the submenu’s own items, not the whole model', () => {
            const el = mount();
            el.menuModel = MENU;
            const first = popovers(el)[0];
            expect([...first.querySelectorAll('.adw-popover-menu-item-label')].map((n) => n.textContent)).toStrictEqual(
                ['New', 'Open'],
            );
            unmountAll();
        });

        await it('gives every item HAS_POPUP and a CONTROLS relation', () => {
            const el = mount();
            el.menuModel = MENU;
            for (const button of buttons(el)) {
                expect(button.getAttribute('aria-haspopup')).toBe('menu');
                expect(button.getAttribute('aria-expanded')).toBe('false');
                // `gtk_accessible_update_relation (…, LABELLED_BY, label, CONTROLS, popover)`.
                expect(button.getAttribute('aria-controls')).toBe('popover');
            }
            unmountAll();
        });
    });

    await describe('<gtk-popover-menu-bar> set_active_item', async () => {
        await it('a CLICK opens; a HOVER only selects', () => {
            const el = mount();
            el.menuModel = MENU;
            const [file] = items(el);

            hover(file);
            // `item_enter_cb` passes FALSE for `popup` (gtkpopovermenubar.c:178-189), so the
            // popover stays down while the item is the selected one.
            expect(el.activeItem).toBe(buttons(el)[0]);
            expect(popovers(el)[0].hasAttribute('open')).toBe(false);
            // `.active` belongs to the item whose POPOVER IS OPEN (gtkpopovermenubar.c:50-51).
            expect(file.classList.contains('active')).toBe(false);

            buttons(el)[0].click();
            // `clicked_cb` passes TRUE (:165-176).
            expect(popovers(el)[0].open).toBe(true);
            expect(file.classList.contains('active')).toBe(true);
            unmountAll();
        });

        await it('opening a second item closes the first, because it was already mapped', () => {
            const el = mount();
            el.menuModel = MENU;
            buttons(el)[0].click();
            expect(popovers(el)[0].open).toBe(true);
            // `changed` alone does not close it; `was_popup && changed` does (:137-139).
            buttons(el)[1].click();
            expect(popovers(el)[0].open).toBe(false);
            expect(popovers(el)[1].open).toBe(true);
            expect(items(el)[1].classList.contains('active')).toBe(true);
            expect(items(el)[0].classList.contains('active')).toBe(false);
            unmountAll();
        });

        await it('hovering away from an OPEN item carries the menu along', () => {
            const el = mount();
            el.menuModel = MENU;
            buttons(el)[0].click();
            // `if (popup || (was_popup && changed)) open_submenu (…)` (:153-155) — a pointer
            // moving along the bar keeps the menu open and follows it.
            hover(items(el)[2]);
            expect(popovers(el)[2].open).toBe(true);
            expect(popovers(el)[0].open).toBe(false);
            unmountAll();
        });

        await it('leaving the bar clears the selection but not an open menu', () => {
            const el = mount();
            el.menuModel = MENU;
            hover(items(el)[1]);
            el.dispatchEvent(new PointerEvent('pointerleave'));
            // `bar_leave_cb` clears only when the item's popover is NOT mapped
            // (gtkpopovermenubar.c:203-214) — the pointer may be on the menu, not the bar.
            expect(el.activeItem).toBeNull();

            buttons(el)[1].click();
            expect(popovers(el)[1].open).toBe(true);
            el.dispatchEvent(new PointerEvent('pointerleave'));
            expect(el.activeItem).not.toBeNull();
            unmountAll();
        });

        await it('unmapping a popover clears its item, as popover_unmap does', () => {
            const el = mount();
            el.menuModel = MENU;
            buttons(el)[0].click();
            expect(el.activeItem).not.toBeNull();
            popovers(el)[0].popdown();
            // `popover_unmap` → `set_active_item (bar, NULL, FALSE)` (:389-396).
            expect(el.activeItem).toBeNull();
            expect(buttons(el)[0].getAttribute('aria-expanded')).toBe('false');
            unmountAll();
        });

        await it('selectFirst activates the FIRST item and opens it', () => {
            const el = mount();
            el.menuModel = MENU;
            el.selectFirst();
            expect(el.activeItem).toBe(buttons(el)[0]);
            expect(popovers(el)[0].open).toBe(true);
            // `gtk_popover_menu_bar_select_first` (:761-767).
            unmountAll();
        });
    });

    await describe('<gtk-popover-menu-bar> the keys', async () => {
        await it('Left and Right wrap at both ends', () => {
            const el = mount();
            el.menuModel = MENU;
            const send = (key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

            // No active item, so there is no sibling: RIGHT goes to the FIRST child and LEFT
            // to the LAST (gtkpopovermenubar.c:232-252).
            send('ArrowRight');
            expect(el.activeItem).toBe(buttons(el)[0]);
            send('ArrowRight');
            expect(el.activeItem).toBe(buttons(el)[1]);
            send('ArrowRight');
            expect(el.activeItem).toBe(buttons(el)[2]);
            send('ArrowRight');
            expect(el.activeItem).toBe(buttons(el)[0]);
            send('ArrowLeft');
            expect(el.activeItem).toBe(buttons(el)[2]);
            unmountAll();
        });

        await it('an OPEN popover keeps the keys — the bar forwards into it first', () => {
            const el = mount();
            el.menuModel = MENU;
            buttons(el)[0].click();
            const before = el.activeItem;
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
            // `gtk_popover_menu_bar_focus` tries `gtk_widget_child_focus` on the open
            // submenu BEFORE moving between items (:224-231), so LEFT/RIGHT belongs to the
            // menu and not to the bar.
            expect(el.activeItem).toBe(before);
            unmountAll();
        });

        await it('an item focused by a key opens its menu when focus is already in the bar', async () => {
            const el = mount();
            el.menuModel = MENU;
            buttons(el)[0].focus();
            const send = (key: string) => el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
            send('ArrowRight'); // no active item yet, so RIGHT is the FIRST child
            send('ArrowRight'); // and from there the next one
            // `else if (changed && (state & GTK_STATE_FLAG_FOCUS_WITHIN)) grab_focus` — and
            // focus MOVED, because a `.selected` class alone does not take focus.
            expect(el.activeItem).toBe(buttons(el)[1]);
            expect(document.activeElement).toBe(buttons(el)[1]);
            unmountAll();
        });
    });

    await describe('<gtk-popover-menu-bar> activation', async () => {
        await it('choosing a row closes that popover and reports the WHOLE-model path', () => {
            const el = mount();
            el.menuModel = MENU;
            buttons(el)[0].click();
            let detail: { id: string; label: string; path: number[] } | null = null;
            el.addEventListener('menu-item-activated', (event) => {
                detail = (event as CustomEvent<{ id: string; label: string; path: number[] }>).detail;
            });
            const rows = [...popovers(el)[0].querySelectorAll<HTMLButtonElement>('.adw-popover-item')];
            rows[1].click(); // `Open`, inside `File`
            // `File ▸ Open` is `[0, 1]` in the bar's model, not `[1]` in the submenu's.
            expect(detail).toStrictEqual({ id: 'Open', label: 'Open', path: [0, 1] });
            expect(popovers(el)[0].open).toBe(false);
            expect(document.activeElement).toBe(buttons(el)[0]);
            unmountAll();
        });
    });

    await describe('<gtk-popover-menu-bar> refuses what it cannot use', async () => {
        await it('a toplevel item is warned about and NOT drawn, as tracker_insert does', () => {
            const warnings: unknown[] = [];
            const real = console.warn;
            console.warn = (...args: unknown[]) => warnings.push(args.join(' '));
            try {
                const el = mount('[{"label":"Not a menu"},{"label":"File","submenu":[{"label":"New"}]}]');
                // "Don't know how to handle this item" (gtkpopovermenubar.c:466) — and
                // `g_warning` is RECOVERABLE, so the submenu beside it still works.
                expect(warnings.join('\n')).toContain("Don't know how to handle this item");
                expect(buttons(el).map((b) => b.textContent)).toStrictEqual(['File']);
                unmountAll();
            } finally {
                console.warn = real;
            }
        });

        await it('a `custom` item anywhere in the model refuses the whole menu', () => {
            const errors: unknown[] = [];
            const real = console.error;
            console.error = (...args: unknown[]) => errors.push(args.join(' '));
            try {
                const el = mount('[{"label":"File","submenu":[{"label":"Zoom","custom":"zoom"}]}]');
                expect(buttons(el).length).toBe(0);
                expect(errors.join('\n')).toContain('zoom');
                unmountAll();
            } finally {
                console.error = real;
            }
        });

        await it('a malformed attribute leaves the bar empty rather than failing to upgrade', () => {
            const el = mount('not json at all');
            expect(buttons(el).length).toBe(0);
            unmountAll();
        });
    });
};
