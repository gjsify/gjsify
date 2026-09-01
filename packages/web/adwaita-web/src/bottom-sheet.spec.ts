// DOM-level conformance tests for <adw-bottom-sheet>, driven by the SAME vectors
// the core suite and the NativeScript renderer assert against
// (`@gjsify/adwaita-core/conformance`).
//
// `Adw.BottomSheet` has four dismissal paths and they are four DIFFERENT gates, so one
// shared `_attemptClose()` cannot express them: the drag handle is `can_target = FALSE`
// and closes nothing; Escape on a closed-but-focused sheet still signals
// `close-attempt`; and the `sheet.close` action on an already-closed sheet forwards to
// the parent.
//
// The open STATE must be HELD, not read back off the attribute — reading it made
// `open="false"` render OPEN and let a re-spelt attribute fire a `notify::open` with an
// unchanged payload.
import { describe, expect, it } from '@gjsify/unit';

import type { AdwBottomSheet } from './elements/adw-bottom-sheet.js';
import {
    BOTTOM_SHEET_CLOSE_VECTORS,
    BOTTOM_SHEET_PRESENTATION_VECTORS,
    runBottomSheetSteps,
} from '@gjsify/adwaita-core/conformance';
import type { BottomSheetCloseOutcome } from '@gjsify/adwaita-core';

/** A mounted sheet with one child in each slot, ready to be driven. */
function mountSheet(markup = ''): AdwBottomSheet {
    const sheet = document.createElement('adw-bottom-sheet') as AdwBottomSheet;
    sheet.innerHTML =
        markup ||
        '<adw-bottom-sheet-content><button id="under">Under</button></adw-bottom-sheet-content>' +
            '<adw-bottom-sheet-sheet><button id="inside">Inside</button></adw-bottom-sheet-sheet>';
    document.body.appendChild(sheet);
    return sheet;
}

function dimming(sheet: AdwBottomSheet): HTMLElement {
    return sheet.querySelector('.adw-bottom-sheet-dimming') as HTMLElement;
}

function dragHandle(sheet: AdwBottomSheet): HTMLElement {
    return sheet.querySelector('.adw-bottom-sheet-drag-handle') as HTMLElement;
}

function insideSheet(sheet: AdwBottomSheet): HTMLElement {
    return sheet.querySelector('.adw-bottom-sheet-sheet-body > button') as HTMLElement;
}

/** Count the dismissal signals a sheet raises while `run` executes. */
function recordSignals(sheet: AdwBottomSheet, run: () => void): { attempts: number; delegated: number } {
    let attempts = 0;
    let delegated = 0;
    const onAttempt = () => attempts++;
    const onDelegate = () => delegated++;
    sheet.addEventListener('close-attempt', onAttempt);
    sheet.addEventListener('sheet.close', onDelegate);
    run();
    sheet.removeEventListener('close-attempt', onAttempt);
    sheet.removeEventListener('sheet.close', onDelegate);
    return { attempts, delegated };
}

export const AdwBottomSheetTest = async () => {
    await describe('adw-bottom-sheet dismissal gate (libadwaita conformance vectors)', async () => {
        for (const { source, open, canClose, outcome, rule } of BOTTOM_SHEET_CLOSE_VECTORS) {
            await it(`${source} · open=${open} · canClose=${canClose} → ${outcome} — ${rule}`, () => {
                const sheet = mountSheet();
                sheet.canClose = canClose;
                sheet.open = open;

                let returned: BottomSheetCloseOutcome | null = null;
                const { attempts, delegated } = recordSignals(sheet, () => {
                    returned = sheet.requestClose(source);
                });

                expect(returned).toBe(outcome);
                // The verdict must be VISIBLE, not just returned: returning the right word
                // and closing anyway is still wrong.
                expect(sheet.open).toBe(outcome === 'close' ? false : open);
                expect(attempts).toBe(outcome === 'close-attempt' ? 1 : 0);
                expect(delegated).toBe(outcome === 'delegate' ? 1 : 0);
                sheet.remove();
            });
        }
    });

    await describe('adw-bottom-sheet presentation (libadwaita conformance vectors)', async () => {
        for (const vector of BOTTOM_SHEET_PRESENTATION_VECTORS) {
            await it(vector.rule, () => {
                const sheet = mountSheet();
                const notifications: boolean[] = [];
                sheet.addEventListener('notify::open', (event) => {
                    notifications.push((event as CustomEvent).detail.open);
                });

                const outcomes = runBottomSheetSteps(
                    {
                        setOpen: (open) => {
                            sheet.open = open;
                        },
                        setCanClose: (canClose) => {
                            sheet.canClose = canClose;
                        },
                        requestClose: (source) => sheet.requestClose(source),
                    },
                    vector.steps,
                );

                expect(outcomes).toStrictEqual([...vector.outcomes]);
                expect(notifications).toStrictEqual([...vector.notifications]);
                expect(sheet.open).toBe(vector.open);
                // The `open` attribute is the CSS hook, so it must track the state.
                expect(sheet.hasAttribute('open')).toBe(vector.open);
                expect(sheet.classList.contains('open')).toBe(vector.open);
                sheet.remove();
            });
        }
    });

    await describe('adw-bottom-sheet open attribute semantics', async () => {
        await it('open="false" renders CLOSED', () => {
            // `hasAttribute('open')` for the getter while every other boolean uses
            // `!== 'false'` gives one element two conventions.
            // adw-bottom-sheet.c — `open = !!open` on a strict gboolean.
            const sheet = document.createElement('adw-bottom-sheet') as AdwBottomSheet;
            sheet.setAttribute('open', 'false');
            document.body.appendChild(sheet);
            expect(sheet.open).toBe(false);
            expect(sheet.classList.contains('open')).toBe(false);
            sheet.remove();
        });

        await it('open="" and open="open" both render OPEN', () => {
            const sheet = mountSheet();
            sheet.setAttribute('open', '');
            expect(sheet.open).toBe(true);
            sheet.setAttribute('open', 'open');
            expect(sheet.open).toBe(true);
            sheet.remove();
        });

        await it('re-spelling the attribute fires no spurious notify::open', () => {
            // Guarding only on `oldValue === newValue` lets `open=""` → `open="open"` fire
            // a second notification carrying an UNCHANGED payload.
            // adw-bottom-sheet.c returns before notifying.
            const sheet = mountSheet();
            const payloads: boolean[] = [];
            sheet.addEventListener('notify::open', (event) => {
                payloads.push((event as CustomEvent).detail.open);
            });
            sheet.setAttribute('open', '');
            sheet.setAttribute('open', 'open');
            sheet.setAttribute('open', 'false');
            expect(payloads).toStrictEqual([true, false]);
            sheet.remove();
        });

        await it('an attribute set before connect survives the upgrade', () => {
            const sheet = document.createElement('adw-bottom-sheet') as AdwBottomSheet;
            sheet.setAttribute('can-close', 'false');
            sheet.setAttribute('open', '');
            document.body.appendChild(sheet);
            expect(sheet.open).toBe(true);
            expect(sheet.canClose).toBe(false);
            sheet.remove();
        });
    });

    await describe('adw-bottom-sheet affordances', async () => {
        await it('the drag handle is decorative — not focusable, not a button, closes nothing', () => {
            // `gtk_widget_set_can_focus/can_target (self->drag_handle, FALSE)` — so no
            // role="button", no tabindex=0 and no click-to-close handler.
            const sheet = mountSheet();
            sheet.open = true;
            const handle = dragHandle(sheet);
            expect(handle.getAttribute('role')).toBe(null);
            expect(handle.hasAttribute('tabindex')).toBe(false);
            expect(handle.getAttribute('aria-hidden')).toBe('true');

            const { attempts } = recordSignals(sheet, () => {
                handle.dispatchEvent(new MouseEvent('click', { bubbles: true }));
                handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                handle.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
            });
            expect(sheet.open).toBe(true);
            expect(attempts).toBe(0);
            sheet.remove();
        });

        await it('a dimming click closes an unlocked sheet and signals a locked one', () => {
            const sheet = mountSheet();
            sheet.open = true;
            dimming(sheet).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(sheet.open).toBe(false);

            sheet.open = true;
            sheet.canClose = false;
            const { attempts } = recordSignals(sheet, () => {
                dimming(sheet).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            expect(sheet.open).toBe(true);
            expect(attempts).toBe(1);
            sheet.remove();
        });

        await it('a dismissed sheet re-opens, through either toggle spelling', () => {
            // Reported as "the sheet never comes back": a preview that mounts open, gets
            // dismissed by a scrim click, and then stays closed. Every other case here
            // stops at its FIRST close, so a close path that latched (a listener torn
            // down and never re-attached, a state that only travels one way) could have
            // kept the suite green. The two spellings are the two a host actually
            // writes: `sheet.open = !sheet.open`, and `toggleAttribute('open')` (what the
            // storybook story uses), which only works while the element keeps reflecting
            // the state back onto the attribute.
            const sheet = document.createElement('adw-bottom-sheet') as AdwBottomSheet;
            // `open="true"`, not a bare `open`: that is what Astro's MDX compiler emits
            // for the documentation preview, so it is the markup that gets upgraded.
            sheet.setAttribute('open', 'true');
            sheet.innerHTML =
                '<adw-bottom-sheet-content><button id="under">Under</button></adw-bottom-sheet-content>' +
                '<adw-bottom-sheet-sheet><button id="inside">Inside</button></adw-bottom-sheet-sheet>';
            document.body.appendChild(sheet);
            expect(sheet.open).toBe(true);

            const payloads: boolean[] = [];
            sheet.addEventListener('notify::open', (event) => {
                payloads.push((event as CustomEvent).detail.open);
            });

            dimming(sheet).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(sheet.open).toBe(false);
            expect(sheet.hasAttribute('open')).toBe(false);

            sheet.open = true;
            expect(sheet.open).toBe(true);
            expect(sheet.hasAttribute('open')).toBe(true);
            expect(sheet.classList.contains('open')).toBe(true);
            // The scrim has to become interactive again, or the sheet is dismissible
            // exactly once even though the state reopened.
            expect(dimming(sheet).classList.contains('visible')).toBe(true);

            sheet.toggleAttribute('open');
            expect(sheet.open).toBe(false);
            sheet.toggleAttribute('open');
            expect(sheet.open).toBe(true);

            expect(payloads).toStrictEqual([false, true, false, true]);
            sheet.remove();
        });

        await it('survives the template-clone mount the docs preview uses, and reopens from it', () => {
            // Every other case here builds the sheet with createElement, so the element
            // is upgraded before it has children. The documentation site never does
            // that: it clones an inert <template> and appends the whole subtree in ONE
            // insertion, so the sheet is constructed, gets its attributes and is
            // connected while the same walk is still upgrading its descendants, and its
            // connectedCallback moves those descendants into the content/sheet layers
            // mid-walk. That is the mount the reported "the sheet never comes back" was
            // seen in, and the toggle button has to come back out of it wired and
            // reachable or the preview has no way back from a scrim dismissal.
            const tpl = document.createElement('template');
            tpl.innerHTML =
                '<adw-bottom-sheet open="true" modal="true" can-close="true">' +
                '<adw-bottom-sheet-content><gtk-button pill>Toggle sheet</gtk-button></adw-bottom-sheet-content>' +
                '<adw-bottom-sheet-sheet><button id="inside">Inside</button></adw-bottom-sheet-sheet>' +
                '</adw-bottom-sheet>';
            const stage = document.createElement('div');
            document.body.appendChild(stage);
            stage.append(tpl.content.cloneNode(true));

            const sheet = stage.querySelector('adw-bottom-sheet') as AdwBottomSheet;
            expect(sheet.open).toBe(true);

            const toggle = sheet.querySelector('.adw-bottom-sheet-content gtk-button') as HTMLElement;
            expect(toggle).toBeTruthy();
            expect(insideSheet(sheet).id).toBe('inside');
            // What the page binds: a listener on the custom element, driven by a click
            // on the inner native button.
            toggle.addEventListener('click', () => sheet.toggleAttribute('open'));
            const inner = toggle.querySelector('button') as HTMLElement;

            dimming(sheet).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(sheet.open).toBe(false);

            inner.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            expect(sheet.open).toBe(true);
            expect(sheet.classList.contains('open')).toBe(true);
            expect(dimming(sheet).classList.contains('visible')).toBe(true);

            stage.remove();
        });

        await it('a dimming click on a CLOSED sheet does nothing and signals nothing', () => {
            // The scrim is `can_target = open`, so it is not reachable at all — unlike
            // Escape, it does not signal.
            const sheet = mountSheet();
            sheet.canClose = false;
            const { attempts } = recordSignals(sheet, () => {
                dimming(sheet).dispatchEvent(new MouseEvent('click', { bubbles: true }));
            });
            expect(sheet.open).toBe(false);
            expect(attempts).toBe(0);
            sheet.remove();
        });

        await it('Escape closes an open sheet', () => {
            const sheet = mountSheet();
            sheet.open = true;
            insideSheet(sheet).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            expect(sheet.open).toBe(false);
            sheet.remove();
        });

        await it('Escape on a CLOSED but focused sheet still raises close-attempt', () => {
            // `maybe_close_cb`'s emit is the fallthrough for every case that is NOT
            // (can_close && open); guarding it away in the key handler and in
            // `_attemptClose` makes the corner unreachable.
            const sheet = mountSheet();
            const { attempts } = recordSignals(sheet, () => {
                insideSheet(sheet).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            });
            expect(sheet.open).toBe(false);
            expect(attempts).toBe(1);
            sheet.remove();
        });

        await it('Escape from the CONTENT of a closed sheet stays silent', () => {
            // The shortcut lives on the sheet in GTK, so a key pressed outside it
            // while the sheet is closed reaches nothing.
            const sheet = mountSheet();
            const under = sheet.querySelector('#under') as HTMLElement;
            const { attempts } = recordSignals(sheet, () => {
                under.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
            });
            expect(attempts).toBe(0);
            sheet.remove();
        });

        await it('sheet.close on an already-closed sheet delegates upward', () => {
            // `sheet_close_cb` activates the PARENT's `sheet.close` action rather than
            // doing nothing; a bubbling event is the DOM equivalent, so an enclosing
            // sheet or dialog can act on it.
            const sheet = mountSheet();
            const host = sheet.parentElement as HTMLElement;
            let seenOnAncestor = 0;
            const onAncestor = () => seenOnAncestor++;
            host.addEventListener('sheet.close', onAncestor);
            expect(sheet.requestClose('close-button')).toBe('delegate');
            host.removeEventListener('sheet.close', onAncestor);
            expect(seenOnAncestor).toBe(1);
            sheet.remove();
        });
    });

    await describe('adw-bottom-sheet slots + flags', async () => {
        await it('keeps the declared content and sheet children apart', () => {
            const sheet = mountSheet();
            expect((sheet.querySelector('.adw-bottom-sheet-content > button') as HTMLElement).id).toBe('under');
            expect(insideSheet(sheet).id).toBe('inside');
            sheet.remove();
        });

        await it('consumes the slot wrappers instead of leaving them in the content', () => {
            // `<child type="sheet">` is GtkBuilder markup and nothing of it survives into
            // the widget tree, so the emptied <adw-bottom-sheet-sheet> /
            // <adw-bottom-sheet-content> wrappers must not fall through to `unslotted` and
            // land in the content layer.
            const sheet = mountSheet();
            const content = sheet.querySelector('.adw-bottom-sheet-content') as HTMLElement;
            expect(Array.from(content.children).map((el) => el.tagName.toLowerCase())).toStrictEqual(['button']);
            sheet.remove();
        });

        await it('mixes wrapper and slot="…" children in document order', () => {
            const sheet = mountSheet(
                '<span slot="sheet" id="first">1</span>' +
                    '<adw-bottom-sheet-sheet><span id="second">2</span></adw-bottom-sheet-sheet>',
            );
            const body = sheet.querySelector('.adw-bottom-sheet-sheet-body') as HTMLElement;
            expect(Array.from(body.children).map((el) => el.id)).toStrictEqual(['first', 'second']);
            sheet.remove();
        });

        await it('modal and show-drag-handle default on and honour ="false"', () => {
            const sheet = mountSheet();
            expect(sheet.modal).toBe(true);
            expect(sheet.showDragHandle).toBe(true);
            expect(sheet.classList.contains('modal')).toBe(true);
            expect(dragHandle(sheet).hidden).toBe(false);

            sheet.showDragHandle = false;
            expect(dragHandle(sheet).hidden).toBe(true);
            sheet.modal = false;
            expect(sheet.classList.contains('modal')).toBe(false);
            sheet.remove();
        });

        await it('the dimming layer becomes interactive only while open AND modal', () => {
            const sheet = mountSheet();
            expect(dimming(sheet).classList.contains('visible')).toBe(false);
            sheet.open = true;
            expect(dimming(sheet).classList.contains('visible')).toBe(true);
            sheet.modal = false;
            expect(dimming(sheet).classList.contains('visible')).toBe(false);
            sheet.remove();
        });
    });
};
