// `<gtk-popover-bin>` — one child, and a popover to present from it. Every behaviour here is
// one of the four gtkpopoverbin.c has, and each of them is a rule about WHEN the popover
// appears or what it leaves behind:
//
//   · `menu-model` and `popover` are ONE slot (each setter clears the other);
//   · `handle-input` claims a CONTEXT MENU and a LONG PRESS, and denies a plain click so it
//     reaches the child;
//   · the child wears `.has-open-popup` while the popover is mapped;
//   · `menu.popup` is an ACTION, so the element exposes it as an event too.

import { describe, expect, it } from '@gjsify/unit';
import type { AdwMenuInput } from '@gjsify/adwaita-core';

interface PopoverBinElement extends HTMLElement {
    menuModel: AdwMenuInput;
    // `popoverElement`, not `popover`: `HTMLElement` already declares a `popover` STRING
    // attribute for the DOM Popover API, and an interface cannot narrow that to a widget.
    popoverElement: HTMLElement | null;
    handleInput: boolean;
    actions: Record<string, { enabled?: boolean; state?: string }> | null;
    childElement: HTMLElement | null;
    popup(): void;
    popdown(): void;
}

const MENU = [{ label: 'Cut' }, { label: 'Copy' }, { label: 'Paste' }];

function mount(json?: string): { el: PopoverBinElement; child: HTMLElement } {
    const el = document.createElement('gtk-popover-bin') as PopoverBinElement;
    const child = document.createElement('gtk-button');
    child.setAttribute('label', 'row');
    el.appendChild(child);
    if (json !== undefined) el.setAttribute('menu-model', json);
    document.body.appendChild(el);
    return { el, child };
}

const popoverOf = (el: HTMLElement): HTMLElement | null => el.querySelector('gtk-popover-menu');

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-popover-bin'))) el.remove();
}

export const GtkPopoverBinTest = async () => {
    await describe('<gtk-popover-bin> the model builds the popover', async () => {
        await it('a menu-model creates the popover, pinned to the bottom', () => {
            const { el } = mount(JSON.stringify(MENU));
            const popover = popoverOf(el);
            expect(popover).not.toBeNull();
            // `gtk_popover_set_position (popover, GTK_POS_BOTTOM)` in the same function
            // (gtkpopoverbin.c:493).
            expect(popover?.getAttribute('position')).toBe('bottom');
            expect([...el.querySelectorAll('.adw-popover-menu-item-label')].map((n) => n.textContent)).toStrictEqual([
                'Cut',
                'Copy',
                'Paste',
            ]);
            unmountAll();
        });

        await it('an empty model leaves NO popover, as set_menu_model(NULL) does', () => {
            const { el } = mount();
            expect(popoverOf(el)).toBeNull();
            unmountAll();
        });

        await it('setting the model REPLACES the popover', () => {
            const { el } = mount(JSON.stringify(MENU));
            const before = popoverOf(el);
            el.menuModel = [{ label: 'Only' }];
            expect(popoverOf(el)).not.toBe(before);
            expect(before?.isConnected).toBe(false);
            unmountAll();
        });

        await it('setting a popover DROPS the model — one slot, two directions', () => {
            const { el } = mount(JSON.stringify(MENU));
            // `set_popover` does `g_clear_object (&self->menu_model)`
            // (gtkpopoverbin.c:548) — the two properties are one field, and this is the half
            // that is easy to get wrong by keeping them apart.
            const replacement = document.createElement('gtk-popover') as unknown as HTMLElement;
            el.popoverElement = replacement;
            expect(el.menuModel).toStrictEqual([]);
            expect(el.popoverElement).toBe(replacement);
            // The old popover is unparented rather than left behind as a second surface:
            // `gtk_popover_bin_set_popover` unparents the one it displaces.
            expect(popoverOf(el)).toBeNull();
            unmountAll();
        });

        await it('notifies both properties when the model changes', () => {
            const { el } = mount();
            const seen: unknown[] = [];
            el.addEventListener('notify::menu-model', (event) => seen.push((event as CustomEvent).detail));
            el.menuModel = MENU;
            // GTK notifies `:popover` AND `:menu-model` from BOTH setters
            // (gtkpopoverbin.c:502, :586-587), so one event carrying both is the faithful
            // reading rather than two that can disagree.
            expect(seen.length).toBe(1);
            expect(Object.keys(seen[0] as object).sort()).toStrictEqual(['menuModel', 'popover']);
            unmountAll();
        });
    });

    await describe('<gtk-popover-bin> the child wears .has-open-popup', async () => {
        await it('while the popover is open, and not while it is closed', () => {
            const { el, child } = mount(JSON.stringify(MENU));
            const popover = popoverOf(el) as HTMLElement & { open: boolean };
            // `on_popover_map` / `on_popover_unmap` (gtkpopoverbin.c:117-126) — the class is
            // how libadwaita says WHICH row generated the popup (`_lists.scss:57`).
            expect(child.classList.contains('has-open-popup')).toBe(false);
            popover.open = true;
            expect(child.classList.contains('has-open-popup')).toBe(true);
            popover.open = false;
            expect(child.classList.contains('has-open-popup')).toBe(false);
            unmountAll();
        });

        await it('the class is on the CHILD, never on the bin', () => {
            const { el, child } = mount(JSON.stringify(MENU));
            (popoverOf(el) as HTMLElement & { open: boolean }).open = true;
            expect(el.classList.contains('has-open-popup')).toBe(false);
            expect(child.classList.contains('has-open-popup')).toBe(true);
            unmountAll();
        });

        await it('`childElement` is the child, not the popover', () => {
            const { el, child } = mount(JSON.stringify(MENU));
            // The popover is also an element child of the bin, so a `firstElementChild`
            // that did not skip it would paint `.has-open-popup` on the popup.
            expect(el.childElement).toBe(child);
            unmountAll();
        });
    });

    await describe('<gtk-popover-bin> handle-input', async () => {
        await it('defaults to FALSE, so a right click does nothing', () => {
            const { el } = mount(JSON.stringify(MENU));
            // `g_param_spec_boolean ("handle-input", NULL, NULL, FALSE, …)`
            // (gtkpopoverbin.c:370-374).
            expect(el.handleInput).toBe(false);
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            expect((popoverOf(el) as HTMLElement & { open: boolean }).open).toBe(false);
            unmountAll();
        });

        await it('with it on, a context menu opens the popover and is consumed', () => {
            const { el } = mount(JSON.stringify(MENU));
            el.handleInput = true;
            const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
            el.dispatchEvent(event);
            // `pressed_cb` only claims when `gdk_event_triggers_context_menu`, and then
            // CLAIMS + resets the controller (gtkpopoverbin.c:165-175) — so the browser's
            // own context menu must not also appear.
            expect(event.defaultPrevented).toBe(true);
            expect((popoverOf(el) as HTMLElement & { open: boolean }).open).toBe(true);
            unmountAll();
        });

        await it('a plain click still reaches the child', () => {
            const { el } = mount(JSON.stringify(MENU));
            el.handleInput = true;
            const event = new MouseEvent('click', { bubbles: true, cancelable: true });
            el.dispatchEvent(event);
            // The gesture DENIES any sequence it does not claim (gtkpopoverbin.c:185-186),
            // which in the DOM is doing nothing at all.
            expect(event.defaultPrevented).toBe(false);
            expect((popoverOf(el) as HTMLElement & { open: boolean }).open).toBe(false);
            unmountAll();
        });

        await it('a mouse long press does NOT open it — GTK’s is touch-only', async () => {
            const { el } = mount(JSON.stringify(MENU));
            el.handleInput = true;
            el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'mouse', bubbles: true }));
            await new Promise((resolve) => setTimeout(resolve, 600));
            // `gtk_gesture_single_set_touch_only (…, TRUE)` (gtkpopoverbin.c:657).
            expect((popoverOf(el) as HTMLElement & { open: boolean }).open).toBe(false);
            unmountAll();
        });

        await it('turning it OFF cancels a long press already under way', async () => {
            const { el } = mount(JSON.stringify(MENU));
            el.handleInput = true;
            el.dispatchEvent(new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true }));
            el.handleInput = false;
            await new Promise((resolve) => setTimeout(resolve, 600));
            // `set_handle_input (FALSE)` removes both gestures (gtkpopoverbin.c:668-672), so
            // the timer it armed must not survive the turn-off.
            expect((popoverOf(el) as HTMLElement & { open: boolean }).open).toBe(false);
            unmountAll();
        });
    });

    await describe('<gtk-popover-bin> menu.popup is an ACTION', async () => {
        await it('the method opens the popover and announces the activation', () => {
            const { el } = mount(JSON.stringify(MENU));
            let announced = false;
            el.addEventListener('menu.popup', () => {
                announced = true;
            });
            el.popup();
            // `gtk_widget_class_install_action (widget_class, "menu.popup", NULL,
            // popup_action)` (gtkpopoverbin.c:381) — an action is GTK plumbing a browser
            // cannot host, so the activation is an event and the call is `popup()`.
            expect(announced).toBe(true);
            expect((popoverOf(el) as HTMLElement & { open: boolean }).open).toBe(true);
            unmountAll();
        });

        await it('the Menu key opens it, which is the shortcut beside the gestures', () => {
            const { el } = mount(JSON.stringify(MENU));
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true }));
            // `gtk_shortcut_trigger_create_for_menu` (gtkpopoverbin.c:643-649) beside the
            // named action, so a keyboard can reach the same popup the gesture does.
            expect((popoverOf(el) as HTMLElement & { open: boolean }).open).toBe(true);
            el.popdown();
            expect((popoverOf(el) as HTMLElement & { open: boolean }).open).toBe(false);
            unmountAll();
        });

        await it('without a popover there is nothing to activate', () => {
            const { el } = mount();
            el.popup();
            expect(popoverOf(el)).toBeNull();
            unmountAll();
        });
    });
};
