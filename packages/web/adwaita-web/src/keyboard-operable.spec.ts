// Where a KEY PRESS puts focus — the half of accessibility this package declared and
// did not implement.
//
// Runs in a real browser via the tests/browser Playwright harness. Every assertion here
// reads `document.activeElement`, never a class, an attribute or a state object: the
// whole defect class this file exists for was GREEN under a suite that read state while
// the widget was unusable. `aria-modal="true"` was set on four surfaces and honoured by
// one; `role="tablist"` plus a roving tabindex was set on four composites and navigable
// by none.
//
// SYNTHETIC EVENTS, AND WHY THEY STILL DISCRIMINATE. A dispatched `keydown` is the same
// event object a real key produces, minus the browser's own default action — and for
// both shapes the default action is exactly what must NOT happen. A trap that works
// calls `preventDefault()` and moves focus itself, which is observable here; a trap that
// does not work leaves focus where it was, so asserting "focus is still inside the
// dialog" would pass on the bug. The assertion is therefore where focus LANDED — the
// far edge, not the near one — plus `defaultPrevented`, which is the only discriminator
// left when a dialog has a single focusable control and first and last are one element.
// A real Tab press escaping an untrapped dialog is measured one layer up, by
// `tests/browser/specs/adwaita-keyboard.spec.ts`.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwAlertDialog } from './elements/adw-alert-dialog.js';

/** Unique per element so a spec's `stack="…"` reference cannot pick up an earlier one. */
let seq = 0;
const uniqueId = (prefix: string) => `${prefix}-${(seq += 1)}`;

function press(target: HTMLElement, key: string, shiftKey = false): KeyboardEvent {
    const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}

// ---------------------------------------------------------------------------
// Modal surfaces
// ---------------------------------------------------------------------------

interface ModalCase {
    tag: string;
    /** Builds the dialog, connected, with as many focusable controls as it can have. */
    make: () => HTMLElement;
    /** The element carrying `aria-modal` — the boundary focus may not cross. */
    surface: (el: HTMLElement) => HTMLElement;
}

const MODAL_CASES: ModalCase[] = [
    {
        tag: 'adw-dialog',
        make: () => {
            const el = document.createElement('adw-dialog');
            el.setAttribute('title', 'Dialog');
            el.innerHTML = '<button class="one">One</button><button class="two">Two</button>';
            return el;
        },
        surface: (el) => el.querySelector('.adw-dialog-box') as HTMLElement,
    },
    {
        tag: 'adw-alert-dialog',
        make: () => {
            const el = document.createElement('adw-alert-dialog');
            el.setAttribute('heading', 'Heading');
            el.innerHTML =
                '<adw-alert-response id="cancel">Cancel</adw-alert-response>' +
                '<adw-alert-response id="ok" appearance="suggested">OK</adw-alert-response>';
            return el;
        },
        surface: (el) => el.querySelector('.adw-alert-dialog-box') as HTMLElement,
    },
    {
        tag: 'adw-about-dialog',
        make: () => {
            const el = document.createElement('adw-about-dialog');
            el.setAttribute('application-name', 'App');
            el.setAttribute('version', '1.0');
            el.setAttribute('website', 'https://example.com');
            return el;
        },
        surface: (el) => el.querySelector('.adw-about-dialog-sheet') as HTMLElement,
    },
    {
        tag: 'adw-preferences-dialog',
        make: () => {
            const el = document.createElement('adw-preferences-dialog');
            el.setAttribute('title', 'Preferences');
            el.innerHTML =
                '<adw-preferences-page title="Page"><adw-preferences-group title="Group">' +
                '<button class="inside">Inside</button>' +
                '</adw-preferences-group></adw-preferences-page>';
            return el;
        },
        surface: (el) => el.querySelector('.adw-preferences-dialog-box') as HTMLElement,
    },
];

/** Everything the browser would hand focus to inside `surface`, in tab order. */
function tabbable(surface: HTMLElement): HTMLElement[] {
    const selector =
        'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),' +
        'textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
    return Array.from(surface.querySelectorAll<HTMLElement>(selector)).filter(
        (el) => !el.hidden && el.getClientRects().length > 0,
    );
}

// ---------------------------------------------------------------------------
// Roving-tabindex composites
// ---------------------------------------------------------------------------

interface RovingCase {
    tag: string;
    /** Builds a connected widget with exactly three navigable items. */
    make: () => HTMLElement;
    /** The navigable items, read from the rendered DOM. */
    items: (el: HTMLElement) => HTMLElement[];
    previous: string;
    next: string;
}

function makeStack(): HTMLElement {
    const stack = document.createElement('adw-view-stack');
    stack.id = uniqueId('stack');
    stack.innerHTML = ['a', 'b', 'c']
        .map(
            (name) =>
                `<adw-view-stack-page name="${name}" title="${name.toUpperCase()}"><p>${name}</p></adw-view-stack-page>`,
        )
        .join('');
    return stack;
}

const ROVING_CASES: RovingCase[] = [
    {
        tag: 'adw-view-switcher',
        make: () => {
            const el = document.createElement('adw-view-switcher');
            el.innerHTML = ['a', 'b', 'c']
                .map(
                    (name) =>
                        `<adw-view-switcher-page name="${name}" title="${name.toUpperCase()}"><p>${name}</p></adw-view-switcher-page>`,
                )
                .join('');
            return el;
        },
        items: (el) => Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]')),
        previous: 'ArrowLeft',
        next: 'ArrowRight',
    },
    {
        tag: 'adw-view-switcher-bar',
        make: () => {
            const stack = makeStack();
            document.body.appendChild(stack);
            const el = document.createElement('adw-view-switcher-bar');
            el.setAttribute('stack', stack.id);
            el.setAttribute('reveal', '');
            // The stack is the widget's model, so it has to come down with it.
            el.addEventListener('adw-test-teardown', () => stack.remove());
            return el;
        },
        items: (el) => Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]')),
        previous: 'ArrowLeft',
        next: 'ArrowRight',
    },
    {
        tag: 'adw-inline-view-switcher',
        make: () => {
            const el = document.createElement('adw-inline-view-switcher');
            el.innerHTML = ['a', 'b', 'c']
                .map(
                    (name) =>
                        `<adw-view-stack-page name="${name}" title="${name.toUpperCase()}"><p>${name}</p></adw-view-stack-page>`,
                )
                .join('');
            return el;
        },
        items: (el) => Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]')),
        previous: 'ArrowLeft',
        next: 'ArrowRight',
    },
    {
        tag: 'adw-sidebar',
        make: () => {
            const el = document.createElement('adw-sidebar');
            el.innerHTML =
                '<adw-sidebar-section title="Section">' +
                ['One', 'Two', 'Three']
                    .map((title) => `<adw-sidebar-item title="${title}"></adw-sidebar-item>`)
                    .join('') +
                '</adw-sidebar-section>';
            return el;
        },
        items: (el) => Array.from(el.querySelectorAll<HTMLElement>('[role="option"]')),
        previous: 'ArrowUp',
        next: 'ArrowDown',
    },
];

/** A connected `<adw-alert-dialog>` carrying `inner` as its declared markup. */
function makeAlertDialog(inner: string): AdwAlertDialog {
    const el = document.createElement('adw-alert-dialog') as AdwAlertDialog;
    el.setAttribute('heading', 'Heading');
    el.innerHTML = inner;
    document.body.appendChild(el);
    return el;
}

/** Connect, run, disconnect — including whatever model the case put beside the widget. */
function withWidget(make: () => HTMLElement, body: (el: HTMLElement) => void): void {
    const el = make();
    document.body.appendChild(el);
    try {
        body(el);
    } finally {
        el.dispatchEvent(new CustomEvent('adw-test-teardown'));
        el.remove();
    }
}

export const AdwKeyboardOperableTest = async () => {
    await describe('modal surfaces keep Tab inside themselves', async () => {
        for (const modal of MODAL_CASES) {
            await it(`${modal.tag} declares aria-modal on a surface that traps`, async () => {
                const opener = document.createElement('button');
                document.body.appendChild(opener);
                const el = modal.make();
                document.body.appendChild(el);
                opener.focus();
                el.setAttribute('open', '');
                // `<adw-about-dialog>` appends its close button from a `queueMicrotask`,
                // because `<adw-header-bar>` builds the section it goes in from its own
                // `connectedCallback`. Without this the dialog measures as having no
                // focusable control at all — which is also what its initial focus sees,
                // ledgered in status/open-todos.md.
                await Promise.resolve();

                const surface = modal.surface(el);
                expect(surface.getAttribute('aria-modal')).toBe('true');
                // Presenting moves focus in — otherwise the first Tab is pressed outside
                // the dialog and the trap never sees it.
                expect(surface.contains(document.activeElement)).toBe(true);

                const focusables = tabbable(surface);
                expect(focusables.length > 0).toBe(true);
                const first = focusables[0];
                const last = focusables[focusables.length - 1];

                last.focus();
                const forward = press(last, 'Tab');
                // WRAPPED, not merely "still inside": a dialog with no trap leaves focus
                // on `last`, which is inside too. `defaultPrevented` carries the same
                // claim where `first === last` and the wrap is invisible.
                expect(document.activeElement).toBe(first);
                expect(forward.defaultPrevented).toBe(true);

                first.focus();
                const backward = press(first, 'Tab', true);
                expect(document.activeElement).toBe(last);
                expect(backward.defaultPrevented).toBe(true);

                el.removeAttribute('open');
                // Return focus: the interaction ends where it started, not on whatever
                // the escaped Tab happened to land on.
                expect(document.activeElement).toBe(opener);

                el.remove();
                opener.remove();
            });
        }

        await it('adw-alert-dialog with a disabled default response still focuses inside', async () => {
            const opener = document.createElement('button');
            document.body.appendChild(opener);
            const el = makeAlertDialog(
                '<adw-alert-response id="ok">OK</adw-alert-response>' +
                    '<adw-alert-response id="cancel">Cancel</adw-alert-response>',
            );
            el.setDefaultResponse('ok');
            el.setResponseEnabled('ok', false);
            opener.focus();
            el.setAttribute('open', '');

            const surface = el.querySelector('.adw-alert-dialog-box') as HTMLElement;
            // The element asked for a control `focus()` REFUSES. Measured in Firefox before
            // the surface checked that: the dialog opened with focus still on the opener
            // OUTSIDE it, no key reached the trap (its listener is on the host), and Escape
            // left `open` true — unreachable and undismissable at once.
            expect(surface.contains(document.activeElement)).toBe(true);
            expect((document.activeElement as HTMLButtonElement).disabled).toBe(false);
            // The C skips a disabled response and takes the next enabled one
            // (adw-alert-dialog.c:413), which is the only one left here.
            expect(document.activeElement?.textContent).toBe('Cancel');

            press(el, 'Escape');
            expect(el.hasAttribute('open')).toBe(false);
            expect(document.activeElement).toBe(opener);

            el.remove();
            opener.remove();
        });

        await it('adw-alert-dialog focuses its content before its default response', async () => {
            const el = makeAlertDialog(
                '<input class="field">' +
                    '<adw-alert-response id="ok">OK</adw-alert-response>' +
                    '<adw-alert-response id="cancel">Cancel</adw-alert-response>',
            );
            el.setDefaultResponse('ok');
            el.setAttribute('open', '');

            // `adw_alert_dialog_grab_focus` tries the CONTENT first (adw-alert-dialog.c:397)
            // and only then the default widget: an alert carrying an entry is answered by
            // typing into it, not by tabbing back to it.
            expect(document.activeElement).toBe(el.querySelector('.field'));

            el.remove();
        });

        await it('adw-dialog with nothing focusable inside holds focus on the box', async () => {
            const el = document.createElement('adw-dialog');
            el.innerHTML = '<p>Nothing to focus</p>';
            document.body.appendChild(el);
            el.setAttribute('open', '');

            const box = el.querySelector('.adw-dialog-box') as HTMLElement;
            expect(document.activeElement).toBe(box);
            const event = press(box, 'Tab');
            expect(document.activeElement).toBe(box);
            expect(event.defaultPrevented).toBe(true);

            el.remove();
        });
    });

    await describe('roving tabindex moves under the arrow keys', async () => {
        for (const widget of ROVING_CASES) {
            await it(`${widget.tag} steps forward and back, taking focus along`, async () => {
                withWidget(widget.make, (el) => {
                    const items = widget.items(el);
                    expect(items.length).toBe(3);
                    // The precondition IS the defect: two of three are out of the tab
                    // order, so an arrow key is the only way left to reach them.
                    expect(items.map((item) => item.tabIndex)).toStrictEqual([0, -1, -1]);

                    items[0].focus();
                    press(items[0], widget.next);
                    expect(document.activeElement).toBe(items[1]);
                    // The roving tabindex travelled with focus, or the next press starts
                    // from an item the browser no longer considers focusable.
                    expect(items[1].tabIndex).toBe(0);
                    expect(items[0].tabIndex).toBe(-1);

                    press(items[1], widget.next);
                    expect(document.activeElement).toBe(items[2]);

                    press(items[2], widget.previous);
                    expect(document.activeElement).toBe(items[1]);
                });
            });

            await it(`${widget.tag} jumps with Home/End and stops at the ends`, async () => {
                withWidget(widget.make, (el) => {
                    const items = widget.items(el);

                    items[0].focus();
                    press(items[0], 'End');
                    expect(document.activeElement).toBe(items[2]);

                    // No wrap, following <adw-tab-view> and `adw_widget_focus_child`.
                    const past = press(items[2], widget.next);
                    expect(document.activeElement).toBe(items[2]);
                    // Still claimed: an ArrowDown falling through at the last row would
                    // scroll the page out from under a user who is inside the widget.
                    expect(past.defaultPrevented).toBe(true);

                    press(items[2], 'Home');
                    expect(document.activeElement).toBe(items[0]);

                    press(items[0], widget.previous);
                    expect(document.activeElement).toBe(items[0]);
                });
            });
        }

        await it('adw-sidebar arrow selects without activating', async () => {
            withWidget(ROVING_CASES[3].make, (el) => {
                const items = ROVING_CASES[3].items(el);
                const seen: string[] = [];
                el.addEventListener('activated', () => seen.push('activated'));
                el.addEventListener('notify::selected', (event) => {
                    seen.push(`selected:${(event as CustomEvent).detail.selected}`);
                });

                items[0].focus();
                press(items[0], 'ArrowDown');

                expect(document.activeElement).toBe(items[1]);
                // GtkListBox splits the two: an arrow key is `row-selected`, and only
                // Enter/Space/click reach `row-activated`. `activated` per keypress would
                // navigate a split view on every press.
                expect(seen).toStrictEqual(['selected:1']);

                // Enter still activates — the row is a <button>, so this is the browser's
                // own activation and not something this widget re-implements.
                items[1].click();
                expect(seen).toContain('activated');
            });
        });

        await it('adw-sidebar arrow moves focus even when the selection refuses', async () => {
            const el = document.createElement('adw-sidebar');
            el.innerHTML =
                '<adw-sidebar-section title="Section">' +
                ['One', 'Two', 'Three'].map((t) => `<adw-sidebar-item title="${t}"></adw-sidebar-item>`).join('') +
                '</adw-sidebar-section>';
            document.body.appendChild(el);

            const rows = Array.from(el.querySelectorAll<HTMLElement>('[role="option"]'));
            rows[0].focus();
            // Focus and selection on DIFFERENT rows — reachable by setting `selected`
            // while focus sits elsewhere. The arrow now targets the row that is already
            // selected, so the widget's `select` refuses.
            el.setAttribute('selected', '1');
            expect(rows.map((row) => row.tabIndex)).toStrictEqual([-1, 0, -1]);
            expect(document.activeElement).toBe(rows[0]);

            press(rows[0], 'ArrowDown');
            // Focus travels with the KEY, not with the selection. Gating it on the
            // selection having moved swallowed the press and left the user standing on a
            // row the roving tabindex had taken out of the Tab order — reachable by no
            // key, which is the whole defect this module removes.
            expect(document.activeElement).toBe(rows[1]);

            el.remove();
        });

        await it('adw-sidebar arrow skips a disabled row', async () => {
            const el = document.createElement('adw-sidebar');
            el.innerHTML =
                '<adw-sidebar-section title="Section">' +
                '<adw-sidebar-item title="One"></adw-sidebar-item>' +
                '<adw-sidebar-item title="Two" disabled></adw-sidebar-item>' +
                '<adw-sidebar-item title="Three"></adw-sidebar-item>' +
                '</adw-sidebar-section>';
            document.body.appendChild(el);

            const rows = Array.from(el.querySelectorAll<HTMLButtonElement>('[role="option"]'));
            expect(rows.length).toBe(3);
            expect(rows[1].disabled).toBe(true);

            rows[0].focus();
            press(rows[0], 'ArrowDown');
            // A disabled <button> cannot take focus, so leaving it in the walk would
            // strand the user on a `focus()` the browser refuses.
            expect(document.activeElement).toBe(rows[2]);

            el.remove();
        });
    });
};
