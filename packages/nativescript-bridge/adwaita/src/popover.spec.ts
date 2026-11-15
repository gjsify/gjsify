// `Gtk.Popover` and the `popover` / `child` of `Gtk.MenuButton`, built as the REAL classes
// against the platform double.
//
// On the TREES entry for the reason `window-roots.spec.ts` gives. What it measures is the
// port's behaviour: where the card is mounted, what dismisses it, which signals fire and where
// the placement lands. It cannot measure a touch dispatch — whether Android's hit-testing stops
// at the card rather than reaching the dismiss view below it is owed to a device run.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';
import type { LayoutBase, View } from './testing/ns-core.mjs';

interface Located {
    getLocationInWindow?: () => { x: number; y: number };
    getActualSize?: () => { width: number; height: number };
}

interface Inside {
    _card: LayoutBase & View;
    _dismiss: LayoutBase & View;
    _place(): void;
}

const inside = (popover: Gtk.Popover): Inside => popover as unknown as Inside;

const tap = (view: object): void => {
    (view as unknown as { notify(data: object): void }).notify({ eventName: 'tap', object: view });
};

const place = (view: object, at: { x: number; y: number }, size: { width: number; height: number }): void => {
    (view as Located).getLocationInWindow = () => at;
    (view as Located).getActualSize = () => size;
};

const childrenOf = (layout: object): object[] => {
    const base = layout as LayoutBase;
    return Array.from({ length: base.getChildrenCount() }, (_unused, index) => base.getChildAt(index));
};

/** A window holding one menu button, with a popover on it. */
function mounted(): { window: Adw.Window; button: Gtk.MenuButton; popover: Gtk.Popover } {
    const window = new Adw.Window();
    const button = new Gtk.MenuButton();
    window.content = button as unknown as never;
    const popover = new Gtk.Popover();
    button.popover = popover;
    return { window, button, popover };
}

export const GtkPopoverNsTest = async () => {
    await describe('Gtk.Popover', async () => {
        await it('starts closed with the measured GTK defaults', () => {
            const popover = new Gtk.Popover();
            expect(popover.autohide).toBe(true);
            expect(popover.position).toBe(3);
            expect(popover.open).toBe(false);
        });

        await it('notifies autohide only on change', () => {
            const popover = new Gtk.Popover();
            let seen = 0;
            popover.connect('notify::autohide', () => seen++);
            popover.autohide = true;
            popover.autohide = false;
            popover.autohide = false;
            expect(seen).toBe(1);
        });

        await it('reads position as the number GJS reads, and accepts the nick', () => {
            const popover = new Gtk.Popover();
            popover.position = 'top' as unknown as number;
            expect(popover.position).toBe(2);
            popover.position = 3;
            expect(popover.position).toBe(3);
        });

        await it('refuses a position it does not place, and one that is no position', () => {
            const popover = new Gtk.Popover();
            let left = '';
            let nonsense = '';
            try {
                popover.position = 0;
            } catch (error) {
                left = (error as Error).message;
            }
            try {
                popover.position = 'sideways' as unknown as number;
            } catch (error) {
                nonsense = (error as Error).message;
            }
            expect(left.includes('top` or `bottom')).toBe(true);
            expect(nonsense.includes('is not a Gtk.PositionType')).toBe(true);
        });

        await it('puts its child in the card', () => {
            const popover = new Gtk.Popover();
            const label = new Gtk.Label();
            popover.child = label as unknown as never;
            expect(childrenOf(inside(popover)._card)).toStrictEqual([label]);
            popover.child = null;
            expect(childrenOf(inside(popover)._card).length).toBe(0);
        });

        await it('refuses to show without a window, naming why', () => {
            let message = '';
            try {
                new Gtk.Popover().popup();
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('has no window to appear in')).toBe(true);
        });

        await it('mounts above the content on popup and removes itself on popdown', () => {
            const { window, button, popover } = mounted();
            popover.popup();
            expect(popover.open).toBe(true);
            const stack = childrenOf(window);
            expect(stack[0]).toBe(button);
            expect(stack[stack.length - 1]).toBe(popover);
            popover.popdown();
            expect(popover.open).toBe(false);
            expect(childrenOf(window)).toStrictEqual([button]);
        });

        await it('emits closed once per way out, and not for a popup that never happened', () => {
            const { popover } = mounted();
            let closed = 0;
            popover.connect('closed', () => closed++);
            popover.popdown();
            expect(closed).toBe(0);
            popover.popup();
            popover.popdown();
            popover.popup();
            popover.close();
            expect(closed).toBe(2);
        });

        await it('is dismissed by a tap outside the card when autohide is on', () => {
            const { popover } = mounted();
            popover.popup();
            tap(inside(popover)._dismiss);
            expect(popover.open).toBe(false);
        });

        await it('stays open on a tap outside when autohide is off', () => {
            const { popover } = mounted();
            popover.autohide = false;
            popover.popup();
            tap(inside(popover)._dismiss);
            expect(popover.open).toBe(true);
            popover.close();
        });

        await it('is not dismissed by a tap on the card itself', () => {
            const { popover } = mounted();
            popover.popup();
            tap(inside(popover)._card);
            expect(popover.open).toBe(true);
            popover.close();
        });

        await it('places the card under its anchor once both have a size, and shows it', () => {
            const { window, button, popover } = mounted();
            place(window, { x: 0, y: 0 }, { width: 400, height: 800 });
            place(button, { x: 140, y: 100 }, { width: 40, height: 40 });
            popover.popup();
            const card = inside(popover)._card;
            expect(card.opacity).toBe(0);
            place(popover, { x: 0, y: 0 }, { width: 400, height: 800 });
            place(card, { x: 0, y: 0 }, { width: 120, height: 100 });
            inside(popover)._place();
            expect(card.marginLeft).toBe(100);
            expect(card.marginTop).toBe(146);
            expect(card.opacity).toBe(1);
            popover.close();
        });

        await it('flips above the anchor when there is no room below', () => {
            const { window, button, popover } = mounted();
            place(window, { x: 0, y: 0 }, { width: 400, height: 800 });
            place(button, { x: 140, y: 750 }, { width: 40, height: 40 });
            popover.popup();
            place(popover, { x: 0, y: 0 }, { width: 400, height: 800 });
            place(inside(popover)._card, { x: 0, y: 0 }, { width: 120, height: 100 });
            inside(popover)._place();
            expect(inside(popover)._card.marginTop).toBe(750 - 6 - 100);
            popover.close();
        });
    });

    await describe('Gtk.MenuButton with a popover', async () => {
        await it('reparents the popover onto the button and notifies', () => {
            const button = new Gtk.MenuButton();
            let seen = 0;
            button.connect('notify::popover', () => seen++);
            const popover = new Gtk.Popover();
            button.popover = popover;
            expect(button.get_popover()).toBe(popover);
            expect(seen).toBe(1);
        });

        await it('toggles the popover on tap', () => {
            const { button, popover } = mounted();
            tap(button);
            expect(popover.open).toBe(true);
            tap(button);
            expect(popover.open).toBe(false);
        });

        await it('prefers the popover to the menu model', () => {
            const { button, popover } = mounted();
            button.menuModel = new Gtk.MenuButton().menuModel;
            tap(button);
            expect(popover.open).toBe(true);
            popover.close();
        });

        await it('shows its child in place of the icon, and the icon again without it', () => {
            const button = new Gtk.MenuButton();
            const image = (button as unknown as { _image: View })._image;
            const label = new Gtk.Label();
            button.child = label as unknown as never;
            expect(button.get_child()).toBe(label);
            expect(image.visibility).toBe('collapse');
            expect(childrenOf(button).includes(label)).toBe(true);
            button.child = null;
            expect(image.visibility).toBe('visible');
            expect(childrenOf(button).includes(label)).toBe(false);
        });

        await it('takes a template child through the builder door', () => {
            const button = new Gtk.MenuButton();
            const label = new Gtk.Label();
            button._addChildFromBuilder('child', label as unknown as never);
            expect(button.child).toBe(label);
        });
    });
};
