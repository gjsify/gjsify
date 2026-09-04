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
import { AdwToggle, AdwToggleGroup } from './elements/adw-toggle-group.js';

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
    /**
     * The arrow pair on the OTHER axis, which this widget must leave to the page.
     *
     * Asserted because the axis SEPARATION was held by nothing: `AXIS_KEYS` is one
     * table, and widening a single row to both pairs kept every test green while
     * every horizontal widget started swallowing the page scroll — `attachRovingFocus`
     * calls `preventDefault()` before it checks whether anything moved.
     */
    inert: readonly [string, string];
}

/** By TAG, never by index: a case inserted mid-array repoints an index silently, and
 *  the one test that would still PASS repointed is the one asserting the least. */
const rovingCase = (tag: string): RovingCase => {
    const found = ROVING_CASES.find((widget) => widget.tag === tag);
    if (found === undefined) throw new Error(`no roving case for ${tag}`);
    return found;
};

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
        inert: ['ArrowUp', 'ArrowDown'],
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
        inert: ['ArrowUp', 'ArrowDown'],
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
        inert: ['ArrowUp', 'ArrowDown'],
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
        inert: ['ArrowLeft', 'ArrowRight'],
    },
    {
        // Upstream's fifth roving widget, and the one that had none of it: three plain
        // tab stops, no role, and no arrow keys. `[role="radio"]` is the assertion —
        // reading `.adw-toggle` would pass on buttons carrying no role at all.
        tag: 'adw-toggle-group',
        make: () => {
            const el = document.createElement('adw-toggle-group');
            el.innerHTML = ['One', 'Two', 'Three']
                .map((label) => `<adw-toggle label="${label}"></adw-toggle>`)
                .join('');
            return el;
        },
        items: (el) => Array.from(el.querySelectorAll<HTMLElement>('[role="radio"]')),
        previous: 'ArrowLeft',
        next: 'ArrowRight',
        inert: ['ArrowUp', 'ArrowDown'],
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

            await it(`${widget.tag} leaves the other axis to the page`, async () => {
                withWidget(widget.make, (el) => {
                    const items = widget.items(el);
                    items[1].focus();

                    for (const key of widget.inert) {
                        const event = press(items[1], key);
                        // Focus unmoved AND the key unclaimed: a widget that swallows an
                        // off-axis arrow stops the page scrolling under a user who is
                        // standing inside it, and `attachRovingFocus` calls
                        // `preventDefault()` before it knows whether anything moved — so
                        // asserting only the focus would miss half of it.
                        expect(document.activeElement).toBe(items[1]);
                        expect(event.defaultPrevented).toBe(false);
                    }
                });
            });
        }

        await it('adw-sidebar arrow selects without activating', async () => {
            withWidget(rovingCase('adw-sidebar').make, (el) => {
                const items = rovingCase('adw-sidebar').items(el);
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

        await it('adw-toggle-group declares the radio group upstream defaults to', async () => {
            withWidget(rovingCase('adw-toggle-group').make, (el) => {
                // `GTK_ACCESSIBLE_ROLE_RADIO_GROUP` (adw-toggle-group.c:1191) and
                // `GTK_ACCESSIBLE_ROLE_RADIO` per toggle (:860). The element declared
                // neither, so nothing announced these three as one exclusive choice.
                expect(el.getAttribute('role')).toBe('radiogroup');
                const items = rovingCase('adw-toggle-group').items(el);
                expect(items.length).toBe(3);
                expect(items.map((item) => item.getAttribute('aria-checked'))).toStrictEqual([
                    'true',
                    'false',
                    'false',
                ]);
                // `aria-pressed` belongs to the toolbar toggle-BUTTON pattern, where each
                // button is independent. Announcing three separate on/off buttons is what
                // the element did before, so its absence is the assertion.
                expect(items.some((item) => item.hasAttribute('aria-pressed'))).toBe(false);
                // The flex wrapper is web-only — upstream the toggles are the group's own
                // children — so it declares itself out of the accessibility tree rather
                // than sitting as a `generic` between a radio group and its radios.
                expect(el.querySelector('.adw-toggle-group-inner')?.getAttribute('role')).toBe('none');

                items[0].focus();
                press(items[0], 'ArrowRight');
                expect(document.activeElement).toBe(items[1]);
                expect(items.map((item) => item.getAttribute('aria-checked'))).toStrictEqual([
                    'false',
                    'true',
                    'false',
                ]);
                expect(el.getAttribute('active')).toBe('1');
            });
        });

        await it('adw-toggle-group arrow moves focus even when the selection refuses', async () => {
            withWidget(rovingCase('adw-toggle-group').make, (el) => {
                const items = rovingCase('adw-toggle-group').items(el);
                const seen: number[] = [];
                el.addEventListener('notify::active', (event) => {
                    seen.push((event as CustomEvent).detail.active as number);
                });

                items[0].focus();
                // Focus and selection on DIFFERENT toggles, so the arrow targets the one
                // that is ALREADY selected and `_selectIndex` genuinely refuses — the
                // only shape that reaches the state machine's no-op guard through the
                // keyboard. Without it the arrow tests only ever make real changes, and
                // the guard could be deleted with the suite still green.
                el.setAttribute('active', '1');
                expect(items.map((item) => item.tabIndex)).toStrictEqual([-1, 0, -1]);
                expect(document.activeElement).toBe(items[0]);

                press(items[0], 'ArrowRight');
                expect(document.activeElement).toBe(items[1]);
                // No second notify for a selection that did not move.
                expect(seen).toStrictEqual([]);
            });
        });

        await it('adw-toggle-group keeps a role it did not choose', async () => {
            withWidget(
                () => {
                    const el = document.createElement('adw-toggle-group');
                    // Upstream writes no role at all: `gtk_widget_class_set_accessible_role`
                    // (adw-toggle-group.c:1191) is a CLASS DEFAULT an instance overrides,
                    // and `add_toggle` branches on `TAB_LIST` alone (:857) — so `GROUP`
                    // stays `GROUP` and still gets radio children.
                    el.setAttribute('role', 'group');
                    el.innerHTML = '<adw-toggle label="One"></adw-toggle><adw-toggle label="Two"></adw-toggle>';
                    return el;
                },
                (el) => {
                    expect(el.getAttribute('role')).toBe('group');
                    expect(el.querySelectorAll('[role="radio"]').length).toBe(2);
                },
            );
        });

        await it('adw-toggle-group treats an empty role as no role', async () => {
            withWidget(
                () => {
                    const el = document.createElement('adw-toggle-group');
                    // `role=""` is not a declared role. Reading it with `?? null` left the
                    // group with NO role while its children were radios — a radio outside
                    // any group.
                    el.setAttribute('role', '   ');
                    el.innerHTML = '<adw-toggle label="One"></adw-toggle><adw-toggle label="Two"></adw-toggle>';
                    return el;
                },
                (el) => {
                    expect(el.getAttribute('role')).toBe('radiogroup');
                    expect(el.querySelectorAll('[role="radio"]').length).toBe(2);
                },
            );
        });

        await it('adw-toggle-group has no orientation yet, so one axis is the whole truth', async () => {
            // The element is keyed to `'horizontal'`, and `inert` above pins ArrowUp/
            // ArrowDown as the page's. Both become WRONG the day the group gains the
            // `orientation` upstream already has — `AdwToggleGroup` implements
            // `GtkOrientable` (adw-toggle-group.c:187), installs PROP_ORIENTATION (:202),
            // reorients its layout (:929) and its separators (:873, :935), and
            // `AdwInlineViewSwitcher` forwards it (:107). In a vertical group Up/Down moves
            // inside and Left/Right propagates, so the axis has to follow the attribute.
            //
            // Prose cannot hold that: this line fails the commit that adds it.
            // `<adw-inline-view-switcher>` has the same gap (status/open-todos.md).
            expect([...AdwToggleGroup.observedAttributes]).toStrictEqual(['active', 'flat', 'round']);
        });

        await it('adw-toggle has no state a roving walk would have to skip', async () => {
            // `<adw-toggle-group>` passes its buttons to `attachRovingFocus` UNFILTERED,
            // which is only safe while no `<adw-toggle>` attribute can produce a disabled
            // or hidden button. That is a decision recorded in two comments and a ledger
            // entry, and this is the line that fails when it stops being true — the first
            // disabled toggle is otherwise a `focus()` the browser refuses, with nothing
            // in the walk to step over it. Grow this list and add the filter and its spec
            // in the same change (status/open-todos.md, `<adw-toggle>` has no `enabled`).
            expect([...AdwToggle.observedAttributes]).toStrictEqual(['label', 'icon-name']);
        });

        await it('adw-toggle-group notifies once per arrow, through the click path', async () => {
            withWidget(rovingCase('adw-toggle-group').make, (el) => {
                const seen: number[] = [];
                el.addEventListener('notify::active', (event) => {
                    seen.push((event as CustomEvent).detail.active as number);
                });
                const items = rovingCase('adw-toggle-group').items(el);

                items[0].focus();
                press(items[0], 'ArrowRight');
                press(items[1], 'ArrowRight');
                // One per real change, and none for the press at the end — which is the
                // ROVING module's guard (`target === undefined`), not the state machine's:
                // `_selectIndex` is never reached here. The no-op guard behind it is what
                // the "selection refuses" case beside it presses on.
                press(items[2], 'ArrowRight');

                expect(seen).toStrictEqual([1, 2]);
            });
        });

        await it('adw-toggle-group keeps a declared tab list a tab list', async () => {
            withWidget(
                () => {
                    const el = document.createElement('adw-toggle-group');
                    // The role upstream reads BEFORE it builds a toggle, under the comment
                    // "Special case for AdwInlineViewSwitcher" (adw-toggle-group.c:856) —
                    // that switcher builds exactly this widget with `TAB_LIST`
                    // (adw-inline-view-switcher.c:702). Without the branch a consumer
                    // following upstream gets radios inside a tab list.
                    el.setAttribute('role', 'tablist');
                    el.innerHTML = ['One', 'Two'].map((label) => `<adw-toggle label="${label}"></adw-toggle>`).join('');
                    return el;
                },
                (el) => {
                    expect(el.getAttribute('role')).toBe('tablist');
                    const tabs = Array.from(el.querySelectorAll<HTMLElement>('[role="tab"]'));
                    expect(tabs.length).toBe(2);
                    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toStrictEqual(['true', 'false']);
                    expect(el.querySelectorAll('[role="radio"]').length).toBe(0);

                    tabs[0].focus();
                    press(tabs[0], 'ArrowRight');
                    expect(document.activeElement).toBe(tabs[1]);
                    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toStrictEqual(['false', 'true']);
                },
            );
        });
    });

    await describe('a portable menu is traversable, page by page (ADR 0042)', async () => {
        // The roving tabindex on a menu row moved into `PopoverMenuView` when the two
        // menu buttons started sharing one popup, and it took its keyboard obligation
        // with it. `check-adwaita-keyboard-contract.mjs` holds that a listener EXISTS;
        // this holds that the keys move focus — the half a static reader cannot have.
        const open = (): { el: HTMLElement; rows: () => HTMLButtonElement[] } => {
            const el = document.createElement('gtk-menu-button') as HTMLElement & {
                menuModel: unknown;
                actions: unknown;
            };
            document.body.appendChild(el);
            el.actions = { 'app.export': { enabled: false }, 'app.new': {} };
            el.menuModel = [
                { label: 'New', action: 'app.new' },
                { section: [{ label: 'Export', action: 'app.export' }, { label: 'Print' }] },
                { label: 'More', submenu: [{ label: 'Rename' }, { label: 'Duplicate' }] },
            ];
            (el.querySelector('.adw-menu-button-button') as HTMLElement).click();
            return {
                el,
                rows: () => [...el.querySelectorAll<HTMLButtonElement>('.adw-popover-item')],
            };
        };
        const labelOf = (el: Element | null) =>
            el?.querySelector('.adw-menu-button-item-label')?.textContent ?? el?.localName ?? 'none';

        await it('the arrow keys walk the rows and wrap, and Home/End jump', () => {
            const { el, rows } = open();
            const items = rows();
            // Four ROWS, but only three are navigable: `app.export` is disabled by the
            // action group, and a disabled button cannot take focus.
            expect(items.length).toBe(4);
            expect(items[1].disabled).toBe(true);

            items[0].focus();
            press(items[0], 'ArrowDown');
            // Straight past the disabled row — an arrow that lands on it is a dead press.
            expect(labelOf(document.activeElement)).toBe('Print');
            press(document.activeElement as HTMLElement, 'ArrowDown');
            expect(labelOf(document.activeElement)).toBe('More');
            // A menu popover WRAPS, unlike the tab lists: `resolvePopoverKey` is modular.
            press(document.activeElement as HTMLElement, 'ArrowDown');
            expect(labelOf(document.activeElement)).toBe('New');

            press(document.activeElement as HTMLElement, 'End');
            expect(labelOf(document.activeElement)).toBe('More');
            press(document.activeElement as HTMLElement, 'Home');
            expect(labelOf(document.activeElement)).toBe('New');
            el.remove();
        });

        await it('neither a section heading nor a separator is a row', () => {
            const { el } = open();
            // Both are `<div>`s without `.adw-popover-item`, so the walk cannot land on
            // them — asserted rather than assumed, because the class is what decides it.
            expect(el.querySelectorAll('.adw-popover-separator').length).toBe(2);
            for (const node of el.querySelectorAll('.adw-popover-separator, .adw-popover-title')) {
                expect(node.classList.contains('adw-popover-item')).toBe(false);
            }
            el.remove();
        });

        await it('ArrowRight opens a submenu and ArrowLeft leaves it — the row answers, not the surface', () => {
            const { el, rows } = open();
            const opener = rows()[3];
            expect(labelOf(opener)).toBe('More');

            opener.focus();
            // `gtk_model_button_focus`: GTK_DIR_RIGHT on a row with a `menu-name`
            // (gtkmodelbutton.c:1189-1195).
            const right = press(opener, 'ArrowRight');
            expect(right.defaultPrevented).toBe(true);
            expect(rows().map(labelOf)).toStrictEqual(['More', 'Rename', 'Duplicate']);
            // Focus lands on the first ITEM of the page, past the back row.
            expect(labelOf(document.activeElement)).toBe('Rename');

            // GTK_DIR_LEFT answers only on the TITLE row (:1182-1188), so from the
            // middle of the page it does nothing — deliberately the same here.
            const inert = press(document.activeElement as HTMLElement, 'ArrowLeft');
            expect(inert.defaultPrevented).toBe(false);
            expect(labelOf(document.activeElement)).toBe('Rename');

            const back = rows()[0];
            back.focus();
            const left = press(back, 'ArrowLeft');
            expect(left.defaultPrevented).toBe(true);
            expect(rows().map(labelOf)).toStrictEqual(['New', 'Export', 'Print', 'More']);
            el.remove();
        });

        await it('a page change never strands focus outside the popup, whatever is disabled', () => {
            // K1. Both page changes focused a HARD-CODED index of `_rows`, which includes
            // rows no key can reach — so entering a submenu whose first item is disabled
            // put `document.activeElement` on <body>, OUTSIDE an open popover: Tab then
            // walked to the control behind it and every arrow was dead, because both
            // keydown listeners are element-scoped. The two ELEMENTS already filtered on
            // their open path; the two page changes did not, which is two of four.
            const el = document.createElement('gtk-menu-button') as HTMLElement & {
                menuModel: unknown;
                actions: unknown;
            };
            document.body.appendChild(el);
            el.actions = { 'app.off': { enabled: false } };
            el.menuModel = [
                { label: 'Dim', action: 'app.off' },
                { label: 'Live' },
                {
                    label: 'More',
                    submenu: [{ label: 'SubDim', action: 'app.off' }, { label: 'SubLive' }],
                },
            ];
            (el.querySelector('.adw-menu-button-button') as HTMLElement).click();
            const rows = () => [...el.querySelectorAll<HTMLButtonElement>('.adw-popover-item')];
            const label = () =>
                document.activeElement?.querySelector('.adw-menu-button-item-label')?.textContent ??
                document.activeElement?.localName ??
                'none';
            const inside = () => el.contains(document.activeElement);

            // ENTERING: past the back row, counted in REACHABLE rows — not index 1.
            const opener = rows()[2] as HTMLButtonElement;
            opener.focus();
            press(opener, 'ArrowRight');
            expect(inside()).toBe(true);
            expect(label()).toBe('SubLive');

            // LEAVING: the parent's first row is disabled too, so index 0 would strand.
            const back = rows()[0] as HTMLButtonElement;
            back.focus();
            press(back, 'ArrowLeft');
            expect(inside()).toBe(true);
            expect(label()).toBe('Live');
            el.remove();
        });

        await it('a submenu with NOTHING reachable focuses its back row, not the page', () => {
            const el = document.createElement('gtk-menu-button') as HTMLElement & {
                menuModel: unknown;
                actions: unknown;
            };
            document.body.appendChild(el);
            el.actions = { 'app.off': { enabled: false } };
            el.menuModel = [{ label: 'More', submenu: [{ label: 'Only', action: 'app.off' }] }];
            (el.querySelector('.adw-menu-button-button') as HTMLElement).click();
            const opener = el.querySelector('.adw-popover-item') as HTMLButtonElement;
            opener.focus();
            press(opener, 'ArrowRight');
            // The back row is always reachable, so the reader can still leave.
            expect(el.contains(document.activeElement)).toBe(true);
            expect(document.activeElement?.classList.contains('adw-popover-back')).toBe(true);
            el.remove();
        });

        await it('Enter activates the focused row, and reports its path', () => {
            const { el, rows } = open();
            const seen: number[][] = [];
            el.addEventListener('menu-item-activated', (event) => {
                seen.push((event as CustomEvent<{ path: number[] }>).detail.path);
            });
            const print = rows()[2];
            print.focus();
            press(print, 'Enter');
            // Inside a section, so only a PATH names it — the flat index would be 2 here
            // and 1 in the model.
            expect(seen).toStrictEqual([[1, 1]]);
            el.remove();
        });
    });

    await describe('the row family is a tab stop where libadwaita makes one', async () => {
        const mount = (markup: string) => {
            const host = document.createElement('div');
            host.innerHTML = markup;
            document.body.append(host);
            return host;
        };

        await it('takes a tab stop only where the row is activatable', () => {
            const host = mount(
                '<adw-preferences-group title="G">' +
                    '<adw-action-row id="k-act" title="Act" activatable></adw-action-row>' +
                    '<adw-action-row id="k-plain" title="Plain"></adw-action-row>' +
                    '<adw-button-row id="k-btn" title="Btn"></adw-button-row>' +
                    '<adw-switch-row id="k-sw" title="Sw"></adw-switch-row>' +
                    '</adw-preferences-group>',
            );
            const at = (id: string) => document.getElementById(id) as HTMLElement;
            // `tabIndex` alone cannot tell "not a stop" from "not set": a custom element
            // reports -1 for both. The ATTRIBUTE is the thing the row wrote.
            expect(at('k-act').getAttribute('tabindex')).toBe('0');
            expect(at('k-plain').hasAttribute('tabindex')).toBe(false);
            expect(at('k-btn').getAttribute('tabindex')).toBe('0');
            expect(at('k-sw').getAttribute('tabindex')).toBe('0');
            // adw-switch-row.c:159 — the slider is not a focus target; the row is.
            expect(at('k-sw').querySelector('input')?.tabIndex).toBe(-1);
            host.remove();
        });

        await it('follows `activatable` when it moves', () => {
            const host = mount('<adw-action-row id="k-move" title="Move"></adw-action-row>');
            const row = document.getElementById('k-move') as HTMLElement;
            expect(row.hasAttribute('tabindex')).toBe(false);
            row.toggleAttribute('activatable', true);
            expect(row.getAttribute('tabindex')).toBe('0');
            row.toggleAttribute('activatable', false);
            expect(row.hasAttribute('tabindex')).toBe(false);
            host.remove();
        });

        await it('activates on Enter and Space, and lets a child keep its own keys', () => {
            const host = mount(
                '<adw-action-row id="k-keys" title="Keys" activatable></adw-action-row>' +
                    '<adw-combo-row id="k-combo" title="Combo" model=\'["a","b"]\'></adw-combo-row>',
            );
            const row = document.getElementById('k-keys') as HTMLElement;
            let activated = 0;
            row.addEventListener('activated', () => activated++);
            const press = (el: HTMLElement, key: string) =>
                el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
            press(row, 'Enter');
            press(row, ' ');
            press(row, 'a');
            expect(activated).toBe(2);

            // A `<select>` uses Space itself; swallowing it to activate the row around it
            // would break the control to reach the thing it sits in.
            const select = document.getElementById('k-combo')?.querySelector('select') as HTMLElement;
            let prevented: boolean | null = null;
            select.addEventListener('keydown', (event) => {
                prevented = event.defaultPrevented;
            });
            press(select, ' ');
            expect(prevented).toBe(false);
            host.remove();
        });
    });
};
