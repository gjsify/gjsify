// AdwBottomSheet conformance tests, driven by the SAME vectors the core suite
// and the `<adw-bottom-sheet>` browser suite assert against
// (`@gjsify/adwaita-core/conformance`).
//
// IMPORTANT: this imports `./widgets/bottom-sheet-state.js`, NOT the widget. A
// widget module `extends GridLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable on GJS/Node,
// so `adw-bottom-sheet.ts` cannot be loaded here. That widget is a thin
// `GridLayout` wrapper over exactly the surface below: `open` forwards to
// `state.setOpen`, `canClose` to `state.setCanClose`, `canOpen` to
// `state.setCanOpen`, the subscription calls {@link applyBottomSheetChrome} and
// notifies `notify::open`, `requestOpen` is `state.requestOpen`, and
// `requestClose` is {@link requestBottomSheetClose} plus one `notify()`.
//
// Everything asserted here is behaviour this port did NOT have before the lift:
// there was no `can-close`, no `close-attempt`, no dismissal gate and no
// Escape/back path at all, so a locked sheet was silently dismissable and the
// drag handle closed it on tap. The vectors come from the C source, not from
// this port, which is the point.
//
// The OPEN half arrived the same way and for a sharper reason: this port had no bottom
// bar, and the bar is the only affordance libadwaita gives a user for opening a sheet, so
// an app whose GNOME original opens its sheet from the bar had no way in on Android at all.
import { describe, expect, it } from '@gjsify/unit';

import type { View } from '@nativescript/core';
import {
    BOTTOM_SHEET_BOTTOM_BAR_VECTORS,
    BOTTOM_SHEET_CLOSE_VECTORS,
    BOTTOM_SHEET_OPEN_VECTORS,
    BOTTOM_SHEET_PRESENTATION_VECTORS,
    runBottomSheetBottomBarSteps,
    runBottomSheetSteps,
} from '@gjsify/adwaita-core/conformance';
import type { BottomSheetChrome, BottomSheetCloseOutcome, BottomSheetCloseSource } from '@gjsify/adwaita-core';

import {
    CLOSE_ATTEMPT,
    INERT_CLASS,
    NOTIFY_OPEN,
    SHEET_CLOSE,
    addMarkerClass,
    applyBottomSheetChrome,
    createBottomSheetPresentation,
    removeMarkerClass,
    requestBottomSheetClose,
    sheetVisibility,
    type NsSheetVisibility,
} from './widgets/bottom-sheet-state.js';

/**
 * A stand-in for one of the sheet's views. Only `visibility` and `className` are ever
 * touched by the sheet, so this is the whole contract — not a re-implementation of anything.
 */
function fakeView(className = ''): View {
    return { visibility: 'collapse', className } as unknown as View;
}

/**
 * The widget's own wiring: a presentation, the three views it paints, and the event
 * log `notify()` would produce. Built from the SHARED functions the widget
 * calls, so a drift in either fails here.
 */
function mountSheet() {
    const state = createBottomSheetPresentation();
    const panes = { panel: fakeView(), page: fakeView(), bottomBar: fakeView() };
    const panel = panes.panel;
    const events: string[] = [];
    const notifications: boolean[] = [];
    const paint = () => applyBottomSheetChrome(panes, state.chrome);
    paint();
    state.subscribe((open) => {
        paint();
        events.push(NOTIFY_OPEN);
        notifications.push(open);
    });
    const requestClose = (source: BottomSheetCloseSource): BottomSheetCloseOutcome => {
        const { outcome, eventName } = requestBottomSheetClose(state, source);
        if (eventName) events.push(eventName);
        return outcome;
    };
    return { state, panes, panel, events, notifications, paint, requestClose };
}

/**
 * The chrome read back off the REAL views, the way a device would see it — never off the
 * state that produced them. `layer` is a question about which pane is collapsed, which is
 * the whole reason the two are one stack upstream.
 */
function chromeOf(panes: { panel: View; page: View; bottomBar: View }): BottomSheetChrome {
    return {
        layer: panes.page.visibility === 'visible' ? 'sheet' : 'bottom-bar',
        surfaceVisible: panes.panel.visibility === 'visible',
        bottomBarInert: (panes.bottomBar.className ?? '').split(' ').includes(INERT_CLASS),
    };
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

    await describe('AdwBottomSheet open gate (libadwaita conformance vectors)', async () => {
        for (const vector of BOTTOM_SHEET_OPEN_VECTORS) {
            const { source, open, canOpen, hasBottomBar, revealBottomBar, outcome, rule } = vector;
            const gates = `canOpen=${canOpen} · bar=${hasBottomBar} · revealed=${revealBottomBar}`;
            const label = `${source} · open=${open} · ${gates}`;
            await it(`${label} → ${outcome} — ${rule}`, () => {
                const sheet = mountSheet();
                sheet.state.setHasBottomBar(hasBottomBar);
                sheet.state.setCanOpen(canOpen);
                sheet.state.setRevealBottomBar(revealBottomBar);
                sheet.state.setOpen(open);
                sheet.paint();
                const before = chromeOf(sheet.panes);

                expect(sheet.state.requestOpen(source)).toBe(outcome);
                // The verdict must reach the native projection, not just the return value:
                // an accepted open morphs the bin to the sheet page, and an ignored one
                // leaves every pane exactly where it was.
                expect(sheet.state.open).toBe(outcome === 'open' ? true : open);
                expect(chromeOf(sheet.panes)).toStrictEqual(
                    outcome === 'open' ? { ...before, layer: 'sheet', surfaceVisible: true } : before,
                );
            });
        }
    });

    await describe('AdwBottomSheet bottom bar (libadwaita conformance vectors)', async () => {
        for (const vector of BOTTOM_SHEET_BOTTOM_BAR_VECTORS) {
            await it(vector.rule, () => {
                const sheet = mountSheet();

                const outcomes = runBottomSheetBottomBarSteps(
                    {
                        setBottomBar: (present) => {
                            sheet.state.setHasBottomBar(present);
                            sheet.paint();
                        },
                        setCanOpen: (canOpen) => {
                            sheet.state.setCanOpen(canOpen);
                            sheet.paint();
                        },
                        setRevealBottomBar: (reveal) => {
                            sheet.state.setRevealBottomBar(reveal);
                            sheet.paint();
                        },
                        setOpen: (open) => {
                            sheet.state.setOpen(open);
                        },
                        requestOpen: (source) => sheet.state.requestOpen(source),
                    },
                    vector.steps,
                );

                expect(outcomes).toStrictEqual([...vector.outcomes]);
                expect(sheet.notifications).toStrictEqual([...vector.notifications]);
                expect(sheet.state.open).toBe(vector.open);
                expect(chromeOf(sheet.panes)).toStrictEqual({ ...vector.chrome });
            });
        }

        await it('never shows the bar and the sheet at once', () => {
            // The two panes are ONE GtkStack upstream (adw-bottom-sheet.c:1194 + :1206), so
            // "both visible" is a state that cannot exist there and is exactly what two
            // independently toggled NS views drift into.
            const sheet = mountSheet();
            for (const hasBottomBar of [false, true]) {
                for (const open of [false, true]) {
                    sheet.state.setHasBottomBar(hasBottomBar);
                    sheet.state.setOpen(open);
                    sheet.paint();
                    const both =
                        sheet.panes.page.visibility === 'visible' && sheet.panes.bottomBar.visibility === 'visible';
                    expect(both).toBe(false);
                }
            }
        });

        await it('drops the inert marker again when can-open comes back', () => {
            // The marker is written by string surgery on `className`, the shape that already
            // left a doubled marker on this widget once — so it has to survive a round trip.
            const sheet = mountSheet();
            sheet.state.setHasBottomBar(true);
            sheet.state.setCanOpen(false);
            sheet.paint();
            sheet.paint();
            expect(sheet.panes.bottomBar.className).toBe(INERT_CLASS);
            sheet.state.setCanOpen(true);
            sheet.paint();
            expect(sheet.panes.bottomBar.className).toBe('');
        });
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

        await it('writing `open` stays ungated while a dismissal is gated', () => {
            // "Bottom sheet can still be closed using [property@BottomSheet:open]"
            // — adw-bottom-sheet.c:2071. Upstream names the PROPERTY as the way
            // past `can-close`; the drag handle and the back button are not it.
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
            // straight to the port's old `close()` method (gone — the property is
            // the whole programmatic surface). adw-bottom-sheet.c:1197-1198 makes
            // the handle untargetable, so it closes nothing.
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
