// The dialog model (ADR 0004): response ordering, confirm/action resolution and the
// appearance/enabled registry, against the real model rather than a renderer mock. The NS
// package keeps only the `present()` binding onto native `confirm()`/`action()`.

import { describe, it, expect } from '@gjsify/unit';

import { AdwAlertResponses, BottomSheetPresentation, resolveBottomSheetClose } from './dialog.js';
import type { BottomSheetTeardownCallback } from './dialog.js';
import {
    BOTTOM_SHEET_CLOSE_VECTORS,
    BOTTOM_SHEET_PRESENTATION_VECTORS,
    runBottomSheetSteps,
} from './conformance/dialog.js';

export default async () => {
    await describe('AdwAlertResponses registry (Adw.AlertDialog responses)', async () => {
        await it('registers responses with id/label and default appearance/enabled', () => {
            const d = new AdwAlertResponses('Delete file?', 'This cannot be undone.');
            expect(d.heading).toBe('Delete file?');
            expect(d.body).toBe('This cannot be undone.');
            d.addResponse('cancel', 'Cancel');
            d.addResponse('delete', 'Delete', { appearance: 'destructive' });
            expect(d.responses.length).toBe(2);
            expect(d.hasResponse('delete')).toBe(true);
            expect(d.getResponseAppearance('delete')).toBe('destructive');
            expect(d.getResponseAppearance('cancel')).toBe('default');
            expect(d.getResponseEnabled('cancel')).toBe(true);
        });

        await it('addResponses registers id/label pairs', () => {
            const d = new AdwAlertResponses();
            d.addResponses('a', 'A', 'b', 'B');
            expect(d.responses.map((r) => r.id)).toStrictEqual(['a', 'b']);
            expect(d.responses.map((r) => r.label)).toStrictEqual(['A', 'B']);
        });

        await it('a repeated id updates the response in place (no duplicate)', () => {
            const d = new AdwAlertResponses();
            d.addResponse('ok', 'OK');
            d.addResponse('ok', 'Okay', { appearance: 'suggested' });
            expect(d.responses.length).toBe(1);
            expect(d.responses[0]!.label).toBe('Okay');
            expect(d.getResponseAppearance('ok')).toBe('suggested');
        });

        await it('sets appearance/enabled after registration; unknown ids are inert', () => {
            const d = new AdwAlertResponses();
            d.addResponse('save', 'Save');
            d.setResponseAppearance('save', 'suggested');
            d.setResponseEnabled('save', false);
            expect(d.getResponseAppearance('save')).toBe('suggested');
            expect(d.getResponseEnabled('save')).toBe(false);
            // Unknown id: setters no-op, getters return the documented defaults.
            d.setResponseAppearance('nope', 'destructive');
            expect(d.getResponseAppearance('nope')).toBe('default');
            expect(d.getResponseEnabled('nope')).toBe(true);
        });
    });

    await describe('AdwAlertResponses ordering (OK / cancel / neutral slots)', async () => {
        await it('default→ok, last→cancel, middle→neutral', () => {
            const d = new AdwAlertResponses();
            d.addResponse('save', 'Save');
            d.addResponse('discard', 'Discard');
            d.addResponse('cancel', 'Cancel');
            d.defaultResponse = 'save';
            const ordered = d.orderResponses();
            expect(ordered.ok?.id).toBe('save'); // default = OK
            expect(ordered.cancel?.id).toBe('cancel'); // last = cancel
            expect(ordered.neutral?.id).toBe('discard'); // middle = neutral
        });

        await it('falls back to the first response as OK when no default is set', () => {
            const d = new AdwAlertResponses();
            d.addResponse('yes', 'Yes');
            d.addResponse('no', 'No');
            const ordered = d.orderResponses();
            expect(ordered.ok?.id).toBe('yes');
            expect(ordered.cancel?.id).toBe('no');
            expect(ordered.neutral).toBe(undefined);
        });

        await it('switches to an action sheet for more than three responses', () => {
            const d = new AdwAlertResponses();
            d.addResponses('a', 'A', 'b', 'B', 'c', 'C');
            expect(d.usesActionSheet).toBe(false);
            d.addResponse('d', 'D');
            expect(d.usesActionSheet).toBe(true);
        });
    });

    await describe('AdwAlertResponses resolve-to-chosen-id contract', async () => {
        await it('resolveById validates against the registry, falling back to closeResponse', () => {
            const d = new AdwAlertResponses();
            d.addResponse('ok', 'OK');
            d.closeResponse = 'dismissed';
            expect(d.resolveById('ok')).toBe('ok');
            expect(d.resolveById('ghost')).toBe('dismissed'); // unknown id
            expect(d.resolveById(null)).toBe('dismissed'); // dismissal
            expect(d.resolveById(undefined)).toBe('dismissed');
        });

        await it('closeResponse defaults to "close" and rejects an empty override', () => {
            const d = new AdwAlertResponses();
            expect(d.closeResponse).toBe('close');
            d.closeResponse = '';
            expect(d.closeResponse).toBe('close');
            expect(d.resolveById(null)).toBe('close');
        });

        await it('resolveLabel maps an action-sheet label to its id, else closeResponse', () => {
            const d = new AdwAlertResponses();
            d.addResponse('save', 'Save');
            d.addResponse('discard', 'Discard');
            expect(d.resolveLabel('Discard')).toBe('discard');
            expect(d.resolveLabel('Nonexistent')).toBe('close'); // no such label
            expect(d.resolveLabel(undefined)).toBe('close'); // cancelled sheet
        });

        await it('maps ordered slots to ids like a native confirm() (default emphasis)', () => {
            // Mirrors the NS `_presentConfirm` mapping: true→ok, false→cancel,
            // undefined→neutral, driven off orderResponses() + resolveById().
            const d = new AdwAlertResponses();
            d.addResponse('save', 'Save');
            d.addResponse('discard', 'Discard');
            d.addResponse('cancel', 'Cancel');
            d.defaultResponse = 'save';
            const o = d.orderResponses();
            expect(d.resolveById(o.ok?.id)).toBe('save');
            expect(d.resolveById(o.cancel?.id)).toBe('cancel');
            expect(d.resolveById(o.neutral?.id)).toBe('discard');
        });
    });

    await describe('resolveBottomSheetClose (libadwaita conformance vectors)', async () => {
        for (const { source, open, canClose, outcome, rule } of BOTTOM_SHEET_CLOSE_VECTORS) {
            await it(`${source} · open=${open} · canClose=${canClose} → ${outcome} — ${rule}`, () => {
                expect(resolveBottomSheetClose(source, { open, canClose })).toBe(outcome);
            });
        }

        await it('gives the four sources four different answers on a locked open sheet', () => {
            // Why the source is a PARAMETER: a renderer routing every affordance through
            // one `_attemptClose()` cannot produce this row at all.
            const locked = { open: true, canClose: false };
            expect([
                resolveBottomSheetClose('dimming', locked),
                resolveBottomSheetClose('escape', locked),
                resolveBottomSheetClose('close-button', locked),
                resolveBottomSheetClose('swipe', locked),
                resolveBottomSheetClose('drag-handle', locked),
            ]).toStrictEqual(['close-attempt', 'close-attempt', 'close-attempt', 'ignored', 'ignored']);
        });

        await it('never closes a sheet that is already closed', () => {
            // Drive the IMPLEMENTATION with each closed-sheet row: asserting on the
            // vector's own `outcome` would check the table against itself.
            for (const { source, open, canClose, outcome } of BOTTOM_SHEET_CLOSE_VECTORS) {
                if (open) continue;
                expect(resolveBottomSheetClose(source, { open, canClose })).toBe(outcome);
                expect(outcome).not.toBe('close');
            }
            expect(resolveBottomSheetClose('close-button', { open: false, canClose: true })).toBe('delegate');
        });
    });

    await describe('BottomSheetPresentation (libadwaita conformance vectors)', async () => {
        for (const vector of BOTTOM_SHEET_PRESENTATION_VECTORS) {
            await it(vector.rule, () => {
                const callbacks: BottomSheetTeardownCallback[] = [];
                const state = new BottomSheetPresentation({
                    onClosing: () => callbacks.push('closing'),
                    onClosed: () => callbacks.push('closed'),
                });
                const notifications: boolean[] = [];
                state.subscribe((open) => notifications.push(open));

                const outcomes = runBottomSheetSteps(
                    {
                        setOpen: (open) => {
                            state.setOpen(open);
                        },
                        setCanClose: (canClose) => {
                            state.setCanClose(canClose);
                        },
                        requestClose: (source) => state.requestClose(source),
                    },
                    vector.steps,
                );

                expect(outcomes).toStrictEqual([...vector.outcomes]);
                expect(notifications).toStrictEqual([...vector.notifications]);
                expect(callbacks).toStrictEqual([...vector.callbacks]);
                expect(state.open).toBe(vector.open);
                expect(state.hasBeenOpen).toBe(vector.hasBeenOpen);
            });
        }
    });

    await describe('BottomSheetPresentation lifecycle details', async () => {
        await it('setOpen reports whether it changed, so a renderer can skip its transition', () => {
            const state = new BottomSheetPresentation();
            expect(state.setOpen(true)).toBe(true);
            expect(state.setOpen(true)).toBe(false);
            expect(state.setOpen(false)).toBe(true);
            expect(state.setOpen(false)).toBe(false);
        });

        await it('coerces a truthy/falsy argument like the C `open = !!open`', () => {
            const state = new BottomSheetPresentation();
            // adw-bottom-sheet.c — a gboolean is normalised before the
            // idempotence check, so `1` and `true` are the same open.
            expect(state.setOpen(1 as unknown as boolean)).toBe(true);
            expect(state.setOpen(true)).toBe(false);
        });

        await it('lets a closing handler re-open the sheet, and does not notify twice', () => {
            // adw-bottom-sheet.c — the re-entrant call already emitted
            // notify::open(true); the outer close must return without emitting
            // its own notify::open(false), or a listener sees the sheet close.
            const notifications: boolean[] = [];
            let reopen = false;
            const state: BottomSheetPresentation = new BottomSheetPresentation({
                onClosing: () => {
                    if (reopen) state.setOpen(true);
                },
            });
            state.subscribe((open) => notifications.push(open));

            state.setOpen(true);
            reopen = true;
            expect(state.setOpen(false)).toBe(false);
            expect(state.open).toBe(true);
            expect(notifications).toStrictEqual([true, true]);
        });

        await it('finishClose fires onClosed only once the sheet has settled closed', () => {
            // open_animation_done_cb's `progress < 0.5` guard.
            const callbacks: BottomSheetTeardownCallback[] = [];
            const state = new BottomSheetPresentation({
                onClosing: () => callbacks.push('closing'),
                onClosed: () => callbacks.push('closed'),
            });
            state.setOpen(true);
            expect(state.finishClose()).toBe(false);
            expect(callbacks).toStrictEqual([]);

            state.setOpen(false);
            expect(state.finishClose()).toBe(true);
            expect(callbacks).toStrictEqual(['closing', 'closed']);
        });

        await it('setCanClose is idempotent and reports the change', () => {
            const state = new BottomSheetPresentation();
            expect(state.canClose).toBe(true);
            expect(state.setCanClose(true)).toBe(false);
            expect(state.setCanClose(false)).toBe(true);
            expect(state.canClose).toBe(false);
        });

        await it('unsubscribing mid-fan-out does not skip the next listener', () => {
            const state = new BottomSheetPresentation();
            const seen: string[] = [];
            const off = state.subscribe(() => {
                seen.push('first');
                off();
            });
            state.subscribe(() => seen.push('second'));
            state.setOpen(true);
            expect(seen).toStrictEqual(['first', 'second']);
        });
    });
};
