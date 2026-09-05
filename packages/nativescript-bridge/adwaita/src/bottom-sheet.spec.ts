// AdwBottomSheet conformance tests, driven by the SAME vectors the core suite
// and the `<adw-bottom-sheet>` browser suite assert against
// (`@gjsify/adwaita-core/conformance`).
//
// IMPORTANT: this imports `./widgets/bottom-sheet-state.js`, NOT the widget. A
// widget module `extends GridLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable on GJS/Node,
// so `adw-bottom-sheet.ts` cannot be loaded here. That widget is a thin
// `GridLayout` wrapper over exactly the surface below: `open` forwards to
// `state.setOpen`, `canClose` to `state.setCanClose`, the subscription calls
// {@link applySheetVisibility} and notifies `notify::open`, and `requestClose`
// is {@link requestBottomSheetClose} plus one `notify()`.
//
// Everything asserted here is behaviour this port did NOT have before the lift:
// there was no `can-close`, no `close-attempt`, no dismissal gate and no
// Escape/back path at all, so a locked sheet was silently dismissable and the
// drag handle closed it on tap. The vectors come from the C source, not from
// this port, which is the point.
import { describe, expect, it } from '@gjsify/unit';

import type { View } from '@nativescript/core';
import {
    BOTTOM_SHEET_CLOSE_VECTORS,
    BOTTOM_SHEET_PRESENTATION_VECTORS,
    runBottomSheetSteps,
} from '@gjsify/adwaita-core/conformance';
import type { BottomSheetCloseOutcome, BottomSheetCloseSource } from '@gjsify/adwaita-core';

import {
    CLOSE_ATTEMPT,
    NOTIFY_OPEN,
    SHEET_CLOSE,
    addMarkerClass,
    applySheetVisibility,
    createBottomSheetPresentation,
    removeMarkerClass,
    requestBottomSheetClose,
    sheetVisibility,
    type NsSheetVisibility,
} from './widgets/bottom-sheet-state.js';

/**
 * A stand-in for the sheet panel view. Only `visibility` is ever touched by the
 * sheet, so this is the whole contract — not a re-implementation of anything.
 */
function fakePanel(): View {
    return { visibility: 'collapse' } as unknown as View;
}

/**
 * The widget's own wiring: a presentation, the panel it drives, and the event
 * log `notify()` would produce. Built from the SHARED functions the widget
 * calls, so a drift in either fails here.
 */
function mountSheet() {
    const state = createBottomSheetPresentation();
    const panel = fakePanel();
    const events: string[] = [];
    const notifications: boolean[] = [];
    state.subscribe((open) => {
        applySheetVisibility(panel, open);
        events.push(NOTIFY_OPEN);
        notifications.push(open);
    });
    const requestClose = (source: BottomSheetCloseSource): BottomSheetCloseOutcome => {
        const { outcome, eventName } = requestBottomSheetClose(state, source);
        if (eventName) events.push(eventName);
        return outcome;
    };
    return { state, panel, events, notifications, requestClose };
}

/** The native events a verdict produces, in order — `close` shows up as the notify. */
function expectedEvents(outcome: BottomSheetCloseOutcome): string[] {
    if (outcome === 'close') return [NOTIFY_OPEN];
    if (outcome === 'close-attempt') return [CLOSE_ATTEMPT];
    if (outcome === 'delegate') return [SHEET_CLOSE];
    return [];
}

export const AdwBottomSheetNsTest = async () => {
    await describe('AdwBottomSheet dismissal gate (libadwaita conformance vectors)', async () => {
        for (const { source, open, canClose, outcome, rule } of BOTTOM_SHEET_CLOSE_VECTORS) {
            await it(`${source} · open=${open} · canClose=${canClose} → ${outcome} — ${rule}`, () => {
                const sheet = mountSheet();
                sheet.state.setCanClose(canClose);
                sheet.state.setOpen(open);
                sheet.events.length = 0;

                expect(sheet.requestClose(source)).toBe(outcome);
                // The verdict must reach the native projection, not just the
                // return value: `close` collapses the panel, everything else
                // leaves it exactly where it was.
                expect(sheet.state.open).toBe(outcome === 'close' ? false : open);
                expect(sheet.panel.visibility).toBe(sheetVisibility(sheet.state.open));

                expect(sheet.events).toStrictEqual(expectedEvents(outcome));
            });
        }
    });

    await describe('AdwBottomSheet presentation (libadwaita conformance vectors)', async () => {
        for (const vector of BOTTOM_SHEET_PRESENTATION_VECTORS) {
            await it(vector.rule, () => {
                const sheet = mountSheet();

                const outcomes = runBottomSheetSteps(
                    {
                        setOpen: (open) => {
                            sheet.state.setOpen(open);
                        },
                        setCanClose: (canClose) => {
                            sheet.state.setCanClose(canClose);
                        },
                        requestClose: (source) => sheet.requestClose(source),
                    },
                    vector.steps,
                );

                expect(outcomes).toStrictEqual([...vector.outcomes]);
                expect(sheet.notifications).toStrictEqual([...vector.notifications]);
                expect(sheet.state.open).toBe(vector.open);
                expect(sheet.state.hasBeenOpen).toBe(vector.hasBeenOpen);
                expect(sheet.panel.visibility).toBe(sheetVisibility(vector.open));
            });
        }
    });

    await describe('AdwBottomSheet native projection', async () => {
        await it('toggles visibility rather than translating — the NS CSS subset has no transform', () => {
            const sheet = mountSheet();
            const seen: NsSheetVisibility[] = [];
            sheet.state.setOpen(true);
            seen.push(sheet.panel.visibility as NsSheetVisibility);
            sheet.state.setOpen(false);
            seen.push(sheet.panel.visibility as NsSheetVisibility);
            expect(seen).toStrictEqual(['visible', 'collapse']);
        });

        await it('emits notify::open only on a real change', () => {
            // `open` used to be the only state this port had, and its guard
            // is the one thing it got right (adw-bottom-sheet.c:1672-1682) —
            // this pins it so the lift did not lose it.
            const sheet = mountSheet();
            sheet.state.setOpen(true);
            sheet.state.setOpen(true);
            sheet.state.setOpen(false);
            expect(sheet.notifications).toStrictEqual([true, false]);
        });

        await it('close() stays ungated while a dismissal is gated', () => {
            // "Bottom sheet can still be closed using [property@BottomSheet:open]"
            // — adw-bottom-sheet.c:2071. `close()` is that property; the drag
            // handle and the back button are not.
            const sheet = mountSheet();
            sheet.state.setOpen(true);
            sheet.state.setCanClose(false);
            expect(sheet.requestClose('escape')).toBe('close-attempt');
            expect(sheet.state.open).toBe(true);
            expect(sheet.state.setOpen(false)).toBe(true);
            expect(sheet.state.open).toBe(false);
        });

        await it('a drag-handle tap leaves an open sheet open', () => {
            // REGRESSION PIN: the handle was a Label with a `tap` listener wired
            // straight to `close()`. adw-bottom-sheet.c:1197-1198 makes it
            // untargetable, so it closes nothing.
            const sheet = mountSheet();
            sheet.state.setOpen(true);
            sheet.events.length = 0;
            expect(sheet.requestClose('drag-handle')).toBe('ignored');
            expect(sheet.state.open).toBe(true);
            expect(sheet.panel.visibility).toBe('visible');
            expect(sheet.events).toStrictEqual([]);
        });
    });

    await describe('AdwBottomSheet slot marker classes', async () => {
        await it('applies a marker exactly once, however often the same view is set', () => {
            // libadwaita never writes to the child's own style classes
            // (adw-bottom-sheet.c:1497-1510); this port does, and used to do it
            // with a bare concat, so setContent(v) twice left the marker twice.
            const once = addMarkerClass('story-content', 'adw-bottom-sheet-content');
            expect(once).toBe('story-content adw-bottom-sheet-content');
            expect(addMarkerClass(once, 'adw-bottom-sheet-content')).toBe(once);
        });

        await it('drops the marker again when the view leaves the slot', () => {
            const marked = addMarkerClass('story-content', 'adw-bottom-sheet-content');
            expect(removeMarkerClass(marked, 'adw-bottom-sheet-content')).toBe('story-content');
            // A view that never carried it is left alone.
            expect(removeMarkerClass('story-content', 'adw-bottom-sheet-content')).toBe('story-content');
        });

        await it('handles an empty or absent className without leaving stray spaces', () => {
            expect(addMarkerClass(undefined, 'adw-bottom-sheet-sheet')).toBe('adw-bottom-sheet-sheet');
            expect(addMarkerClass('', 'adw-bottom-sheet-sheet')).toBe('adw-bottom-sheet-sheet');
            expect(removeMarkerClass('adw-bottom-sheet-sheet', 'adw-bottom-sheet-sheet')).toBe('');
        });
    });
};

export default AdwBottomSheetNsTest;
