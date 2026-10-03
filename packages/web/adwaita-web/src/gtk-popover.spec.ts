// The ROLE a `<gtk-popover>` announces, and what that role then obliges it to do.
//
// `menu` and `listbox` are list roles: their `.adw-popover-item` rows are what the arrow
// keys walk. A popover that holds CONTENT instead — an info button's explanatory text,
// the HIG pattern — was announced as a menu of commands no matter what it contained, and
// the type had no spelling for the difference, so a consumer set `role="dialog"` as an
// attribute the element kept but did not know: `popoverRole` answered `menu` about it.
//
// Every KEYBOARD assertion reads `document.activeElement`, never a class or a state object:
// the half under test is where a key put the focus. A synthetic `keydown` is the event a
// real key produces minus the browser's own default action, and the default action is
// exactly what must NOT happen — `preventDefault()` on a walk that moves focus is
// observable, and an arrow that leaves focus where it was is the defect.

import { describe, it, expect } from '@gjsify/unit';

import type { GtkPopover, GtkPopoverRole } from './elements/gtk-popover.js';

function press(target: HTMLElement, key: string): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}

/** An open surface holding `count` navigable rows, in the shape the LIST keys walk. */
function openSurface(
    role: GtkPopoverRole | null,
    count = 2,
): { popover: GtkPopover; rows: HTMLButtonElement[]; anchor: HTMLButtonElement; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const anchor = document.createElement('button') as HTMLButtonElement;
    anchor.textContent = 'anchor';
    const popover = document.createElement('gtk-popover') as GtkPopover;
    if (role !== null) popover.setAttribute('role', role);
    host.append(anchor, popover);
    for (let i = 0; i < count; i++) {
        const row = document.createElement('button') as HTMLButtonElement;
        row.className = 'adw-popover-item';
        row.textContent = `row ${i}`;
        popover.appendChild(row);
    }
    popover.popup();
    return { popover, rows: [...popover.querySelectorAll<HTMLButtonElement>('.adw-popover-item')], anchor, host };
}

export const GtkPopoverTest = async () => {
    await describe('<gtk-popover> surface role', async () => {
        await it('reads a dialog role off the surface instead of answering menu', async () => {
            const { popover, host } = openSurface('dialog');
            expect(popover.popoverRole).toBe('dialog');
            host.remove();
        });

        await it('keeps reading the two list roles, and defaults to menu', async () => {
            for (const role of ['menu', 'listbox'] as const) {
                const { popover, host } = openSurface(role);
                expect(popover.popoverRole).toBe(role);
                host.remove();
            }
            const { popover, host } = openSurface(null);
            expect(popover.popoverRole).toBe('menu');
            host.remove();
        });

        await it('falls back to the default on an unknown role, on a removed one too', async () => {
            const { popover, host } = openSurface('dialog');
            popover.setAttribute('role', 'teapot');
            // Only the GETTER has a default: an author may spell a role outside this union
            // (a `region`, a `tooltip`), and rewriting what they wrote would take the
            // surface's own choice away from them.
            expect(popover.popoverRole).toBe('menu');
            // A REMOVED role is different — there is nothing left to honour, so it
            // re-declares the default rather than leaving the surface unlabelled.
            popover.setAttribute('role', 'dialog');
            popover.removeAttribute('role');
            expect(popover.getAttribute('role')).toBe('menu');
            expect(popover.popoverRole).toBe('menu');
            host.remove();
        });

        await it('keeps a role authored in markup across connect', async () => {
            const host = document.createElement('div');
            host.innerHTML = '<gtk-popover role="dialog" aria-label="About"><p>a sentence</p></gtk-popover>';
            document.body.appendChild(host);
            const popover = host.querySelector('gtk-popover') as GtkPopover;
            expect(popover.popoverRole).toBe('dialog');
            expect(popover.getAttribute('role')).toBe('dialog');
            host.remove();
        });
    });

    await describe('<gtk-popover> the LIST keys follow the role', async () => {
        await it('an arrow walks the rows of a menu surface', async () => {
            const { popover, rows, anchor, host } = openSurface('menu');
            anchor.focus();
            press(popover, 'ArrowDown');
            // The control for the case below: focus that lands on a row is what a walk
            // looks like, and focus that stays put is what its absence looks like.
            expect(document.activeElement).toBe(rows[0]);
            host.remove();
        });

        await it('an arrow leaves a dialog surface to its content', async () => {
            const { popover, anchor, host } = openSurface('dialog');
            anchor.focus();
            const event = press(popover, 'ArrowDown');
            // The keys are the CONTENT's here — the arrows scroll it — and taking them for
            // a row walk would leave an explanatory popover on arrows that move nothing.
            expect(document.activeElement).toBe(anchor);
            expect(event.defaultPrevented).toBe(false);
            host.remove();
        });

        await it('Enter does not activate a dialog surface as a menu row', async () => {
            const { popover, rows, host } = openSurface('dialog');
            let activated = -1;
            popover.addEventListener('popover-item-activated', (event) => {
                activated = (event as CustomEvent<{ index: number }>).detail.index;
            });
            rows[0].focus();
            press(popover, 'Enter');
            expect(activated).toBe(-1);
            host.remove();
        });

        await it('Escape still dismisses a dialog surface, and returns focus to the anchor', async () => {
            // Bound at the document in capture, so the list walk's early return above
            // cannot take the escape hatch with it.
            const { popover, anchor, host } = openSurface('dialog');
            anchor.focus();
            press(popover, 'Escape');
            expect(popover.open).toBe(false);
            expect(document.activeElement).toBe(anchor);
            host.remove();
        });
    });
};
