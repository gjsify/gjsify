// `<gtk-popover>` — the surface every other popover in this package is built on, and the
// only one that had no spec of its own: `gtk-drop-down.spec.ts`, `gtk-menu-button.spec.ts`,
// `split-button.spec.ts` and `keyboard-operable.spec.ts` all drive it THROUGH the widget
// that owns one, so nothing here pins what it does on its own — which is why
// `autohide` could be unimplemented while every surface around it was tested.
//
// The dismissal arithmetic lives in `@gjsify/adwaita-core` (`PopoverState`,
// `resolvePopoverKey`, ADR 0004) and is ratcheted there; what these are about is the DOM
// wiring that binds it: the document grab, the attribute reflection, the anchor, and the
// row walk with its two skips.

import { describe, expect, it } from '@gjsify/unit';

import { PopoverState, resolvePopoverKey } from '@gjsify/adwaita-core';

interface PopoverElement extends HTMLElement {
    open: boolean;
    autohide: boolean;
    anchor: HTMLElement | null;
    items: HTMLElement[];
    popup(): void;
    popdown(): void;
}

/** A button (the anchor) with a popover holding `labels` rows, mounted in the document. */
function mount(labels: string[] = []): { anchor: HTMLButtonElement; popover: PopoverElement } {
    const anchor = document.createElement('button');
    anchor.textContent = 'anchor';
    const popover = document.createElement('gtk-popover') as PopoverElement;
    popover.setAttribute('menu', '');
    for (const label of labels) {
        const row = document.createElement('button');
        row.className = 'adw-popover-item';
        row.type = 'button';
        row.textContent = label;
        popover.appendChild(row);
    }
    anchor.appendChild(popover);
    document.body.appendChild(anchor);
    return { anchor, popover };
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('button'))) {
        if (el.querySelector('gtk-popover') !== null) el.remove();
    }
    for (const el of Array.from(document.querySelectorAll('gtk-popover'))) el.remove();
}

/** A keydown on the document, which is where both grab handlers are bound. */
function press(key: string): void {
    document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
}

export const GtkPopoverTest = async () => {
    await describe('<gtk-popover> open state', async () => {
        await it('reflects the state onto `open` and back, idempotently', () => {
            const { popover } = mount();
            expect(popover.open).toBe(false);
            popover.popup();
            expect(popover.hasAttribute('open')).toBe(true);
            expect(popover.hidden).toBe(false);
            // The markup path: `open` is a GObject-shaped attribute, so setting it in markup
            // has to open the popover rather than leave a stale attribute on a closed one.
            popover.removeAttribute('open');
            expect(popover.open).toBe(false);
            popover.setAttribute('open', '');
            expect(popover.open).toBe(true);
            unmountAll();
        });

        await it('fires notify::open on a real change only', () => {
            const { popover } = mount();
            const seen: boolean[] = [];
            popover.addEventListener('notify::open', (event) => {
                seen.push((event as CustomEvent<{ open: boolean }>).detail.open);
            });
            popover.popup();
            popover.popup(); // idempotent: `PopoverState._setOpen` returns early
            popover.popdown();
            expect(seen).toStrictEqual([true, false]);
            unmountAll();
        });

        await it('an element rendered WITH `open` comes up already dismissed-on', () => {
            const popover = document.createElement('gtk-popover') as PopoverElement;
            popover.setAttribute('open', '');
            document.body.appendChild(popover);
            expect(popover.open).toBe(true);
            // The document grab must be armed for a popover that was ALREADY open when it
            // connected, or nothing can dismiss it: `connectedCallback` re-binds every time.
            press('Escape');
            expect(popover.open).toBe(false);
            popover.remove();
        });

        await it('loses its grab when it is disconnected while open', () => {
            const { anchor, popover } = mount();
            popover.popup();
            anchor.remove();
            // `disconnectedCallback` released the listeners, so an Escape now falls through
            // to the page. Reconnecting re-arms them.
            press('Escape');
            expect(popover.open).toBe(true);
            anchor.appendChild(popover);
            document.body.appendChild(anchor);
            press('Escape');
            expect(popover.open).toBe(false);
            unmountAll();
        });
    });

    await describe('<gtk-popover> autohide is GTK’s grab', async () => {
        await it('defaults to TRUE, and an outside click then dismisses', () => {
            const { popover } = mount();
            // `priv->autohide = TRUE` (gtkpopover.c:1046), which is what `gtk_popover_map`
            // takes the grab on (gtkpopover.c:1245-1247).
            expect(popover.autohide).toBe(true);
            popover.popup();
            document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(popover.open).toBe(false);
            unmountAll();
        });

        await it('with it off, neither an outside click nor Escape dismisses', () => {
            const { popover } = mount();
            popover.setAttribute('autohide', 'false');
            popover.popup();
            document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(popover.open).toBe(true);
            // Same gate, same reason: without the grab GTK never routes the key here.
            press('Escape');
            expect(popover.open).toBe(true);
            unmountAll();
        });

        await it('a bare `autohide` attribute is the DEFAULT-TRUE spelling, not "off"', () => {
            const { popover } = mount();
            popover.setAttribute('autohide', '');
            // The property is default-TRUE, so only the string can say "off"; a bare
            // attribute must read as the default or every opt-in would read as an opt-out.
            expect(popover.autohide).toBe(true);
            popover.autohide = false;
            expect(popover.getAttribute('autohide')).toBe('false');
            expect(popover.autohide).toBe(false);
            unmountAll();
        });

        await it('a click on the ANCHOR does not dismiss — it is the anchor’s own toggle', () => {
            const { anchor, popover } = mount();
            popover.popup();
            anchor.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            expect(popover.open).toBe(true);
            unmountAll();
        });
    });

    await describe('<gtk-popover> the row walk', async () => {
        await it('skips hidden and disabled rows', () => {
            const { popover } = mount(['New', 'Cut', 'Copy']);
            const rows = [...popover.querySelectorAll<HTMLButtonElement>('.adw-popover-item')];
            (rows[0] as HTMLButtonElement).disabled = true;
            rows[2].hidden = true;
            // A disabled `<button>` cannot take focus at all, so `focus()` on one is a
            // silent no-op and the arrow key reads as dead; `gtk_widget_focus_move` skips
            // insensitive widgets for the same reason.
            expect(popover.items.map((item) => item.textContent)).toStrictEqual(['Cut']);
            unmountAll();
        });

        await it('ArrowDown walks the rows and wraps, Enter activates the focused one', () => {
            const { popover } = mount(['a', 'b', 'c']);
            popover.popup();
            const rows = [...popover.querySelectorAll<HTMLButtonElement>('.adw-popover-item')];
            rows[0].focus();

            const send = (key: string) =>
                popover.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            send('ArrowDown');
            expect(document.activeElement).toBe(rows[1]);
            send('End');
            expect(document.activeElement).toBe(rows[2]);
            // The wrap the naive modulo gets wrong: ArrowUp from no focus is `n - 1`.
            rows[0].blur();
            rows[0].focus();
            send('ArrowUp');
            expect(document.activeElement).toBe(rows[2]);

            let activated = -1;
            popover.addEventListener('popover-item-activated', (event) => {
                activated = (event as CustomEvent<{ index: number }>).detail.index;
            });
            send('Enter');
            expect(activated).toBe(2);
            unmountAll();
        });

        await it('Escape dismisses through the grab, and activates nothing', () => {
            const { popover } = mount(['a']);
            popover.popup();
            let activated = -1;
            popover.addEventListener('popover-item-activated', (event) => {
                activated = (event as CustomEvent<{ index: number }>).detail.index;
            });
            const row = popover.querySelector('.adw-popover-item') as HTMLButtonElement;
            row.focus();

            popover.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            // `resolvePopoverKey` answers 'close' for Escape and the SURFACE's own handler
            // ignores that answer: the document capture listener is what dismisses, and
            // capture runs from `window` down through every ancestor — so the key closes the
            // popover on the way IN, before the surface's own listener ever sees it.
            expect(popover.open).toBe(false);
            // …and `close` is not `activate`. A dismissal chooses nothing, which is the
            // whole difference between it and Enter.
            expect(activated).toBe(-1);
            unmountAll();
        });
    });

    await describe('<gtk-popover> core’s arithmetic is the one it resolves', async () => {
        await it('answers the same moves the surface applies', () => {
            // The pin that keeps the element from re-deriving the arithmetic: whatever this
            // table says, `_onKeyDown` must do.
            expect(resolvePopoverKey('ArrowDown', { itemCount: 3, currentIndex: -1 })).toStrictEqual({
                action: 'focus',
                index: 0,
            });
            expect(resolvePopoverKey('ArrowUp', { itemCount: 3, currentIndex: -1 })).toStrictEqual({
                action: 'focus',
                index: 2,
            });
            expect(resolvePopoverKey('ArrowDown', { itemCount: 3, currentIndex: 2 })).toStrictEqual({
                action: 'focus',
                index: 0,
            });
            expect(resolvePopoverKey(' ', { itemCount: 3, currentIndex: 1 })).toStrictEqual({
                action: 'activate',
                index: 1,
            });
            expect(resolvePopoverKey('Escape', { itemCount: 0, currentIndex: -1 })).toStrictEqual({
                action: 'close',
                index: -1,
            });
            // A search entry owns the caret keys while it has focus.
            expect(resolvePopoverKey('Home', { itemCount: 3, currentIndex: -1, hasSearch: true })).toStrictEqual({
                action: 'none',
                index: -1,
            });
        });

        await it('a state whose programmatic and interactive changes are distinguishable', () => {
            // What a renderer re-emits `notify::*` for, and what makes a dismissal read as
            // a gesture rather than a call.
            const state = new PopoverState();
            const seen: boolean[] = [];
            state.subscribe((change) => seen.push(change.interactive));
            state.popup();
            state.toggle(); // the anchor was clicked: interactive
            state.dismiss(); // already closed — IDEMPOTENT, so it notifies nobody
            expect(seen).toStrictEqual([false, true]);
        });
    });
};
