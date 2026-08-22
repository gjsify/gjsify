// AdwCarousel conformance tests, driven by the SAME vectors the core suite and
// the `<adw-carousel>` browser suite assert against
// (`@gjsify/adwaita-core/conformance`).
//
// IMPORTANT: this imports `./widgets/carousel-state.js`, NOT the widget — a widget
// module `extends GridLayout`, which evaluates the bare `@nativescript/core` specifier
// at module-eval. `adw-carousel.ts` is a thin wrapper over exactly the surface below:
// insert/remove/reorder forward to the state, `scrollToPage` to `state.scrollTo`, every
// accessor reads the state, the subscription applies {@link applyCarouselDots} and
// notifies {@link carouselNotifyPayload}, and the `ScrollView` listener feeds offsets
// through {@link CarouselScrollSync}.
//
// Two rules easy to get wrong and covered here: an out-of-range index is REFUSED, not
// clamped (or `scrollToPage(NaN)` yields a NaN position), and the current dot comes from
// `pageAt`, which resolves a half-way position DOWN rather than by integer compare.
import { describe, expect, it } from '@gjsify/unit';

import type { CarouselState } from '@gjsify/adwaita-core';
import type { CarouselPageOp, CarouselRevealOp, CarouselStateSnapshot } from '@gjsify/adwaita-core/conformance';
import {
    CAROUSEL_NAVIGATE_VECTORS,
    CAROUSEL_PAGE_AT_POSITION_VECTORS,
    CAROUSEL_PAGE_LIST_VECTORS,
    CAROUSEL_PROPERTY_DEFAULT_VECTORS,
    CAROUSEL_REVEAL_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type { Label } from '@nativescript/core';

import {
    CarouselScrollSync,
    DEFAULT_CAROUSEL_PAGE_WIDTH,
    applyCarouselDots,
    carouselDotClasses,
    carouselNotifyPayload,
    carouselPositionAtOffset,
    carouselScrollOffset,
    createCarouselState,
    normalizeCarouselPageWidth,
    type CarouselNotifyPayload,
} from './widgets/carousel-state.js';

/**
 * A stand-in for an indicator dot. Only `className` is ever touched, so this is
 * the whole contract — not a re-implementation of anything.
 */
function fakeDot(): Label {
    return { className: 'adw-carousel-dot' } as unknown as Label;
}

/** A carousel with `pages` inserted and revealed — the widget's own `insertPage` path. */
function seeded(pages: readonly string[]): CarouselState {
    const state = createCarouselState();
    for (const id of pages) {
        state.insertPage(id);
        state.skipReveal(id);
    }
    return state;
}

/** The observable state a vector compares against. */
function snapshot(state: CarouselState): CarouselStateSnapshot {
    return {
        ids: state.ids,
        nPages: state.nPages,
        sizes: state.sizes,
        snapPoints: state.snapPoints,
        position: state.position,
        page: state.pageAt(state.position),
    };
}

/** Apply one page-list op through the surface the widget's methods forward to. */
function applyPageOp(state: CarouselState, op: CarouselPageOp): boolean {
    switch (op.kind) {
        case 'insert': {
            // `AdwCarousel.insertPage` — insert, then finish the reveal, because
            // reveal-duration is 0 and this port has no ramp.
            const inserted = state.insertPage(op.id, op.position);
            if (inserted) state.skipReveal(op.id);
            return inserted;
        }
        case 'remove': {
            const removed = state.removePage(op.id);
            if (removed) state.skipReveal(op.id);
            return removed;
        }
        case 'reorder':
            return state.reorderPage(op.id, op.position);
        case 'scrollTo':
            return state.scrollTo(op.index);
        case 'setPosition':
            return state.setPosition(op.position);
        case 'settle':
            state.settle();
            return true;
    }
}

/** Apply one reveal op — the same surface, minus the automatic reveal. */
function applyRevealOp(state: CarouselState, op: CarouselRevealOp): void {
    switch (op.kind) {
        case 'insert':
            state.insertPage(op.id, op.position);
            return;
        case 'reveal':
            state.skipReveal(op.id);
            return;
        case 'size':
            state.setPageSize(op.id, op.size);
            return;
        case 'remove':
            state.removePage(op.id);
            return;
        case 'setPosition':
            state.setPosition(op.position);
    }
}

export const AdwCarouselNsTest = async () => {
    await describe('AdwCarousel page list (libadwaita conformance vectors)', async () => {
        for (const vector of CAROUSEL_PAGE_LIST_VECTORS) {
            await it(vector.rule, () => {
                const state = seeded(vector.pages);
                const pageChanged: number[] = [];
                state.onPageChanged((index) => pageChanged.push(index));

                const results = vector.ops.map((op) => applyPageOp(state, op));

                expect(results).toStrictEqual([...vector.opResults]);
                expect(pageChanged).toStrictEqual([...vector.pageChanged]);
                expect(snapshot(state)).toStrictEqual(vector.expected);

                // The native projection must agree with the model: exactly the
                // current page is `active`, and NOTHING is when there is none.
                const expectedClasses = vector.expected.ids.map((_id, index) =>
                    index === vector.expected.page ? 'adw-carousel-dot active' : 'adw-carousel-dot',
                );
                expect(carouselDotClasses(state)).toStrictEqual(expectedClasses);

                const dots = vector.expected.ids.map(() => fakeDot());
                applyCarouselDots(state, dots);
                expect(dots.map((dot) => dot.className)).toStrictEqual(expectedClasses);
            });
        }
    });

    await describe('AdwCarousel reveal lifecycle (libadwaita conformance vectors)', async () => {
        for (const vector of CAROUSEL_REVEAL_VECTORS) {
            await it(vector.rule, () => {
                const state = seeded(vector.pages);
                for (const op of vector.ops) applyRevealOp(state, op);
                expect(snapshot(state)).toStrictEqual(vector.expected);
            });
        }
    });

    await describe('AdwCarousel page lookup (libadwaita conformance vectors)', async () => {
        for (const vector of CAROUSEL_PAGE_AT_POSITION_VECTORS) {
            // The state derives its snap points from reveal sizes, so only the
            // rows whose points are a settled page list are reachable through it;
            // the fractional-geometry rows belong to the core suite.
            const settled = vector.snapPoints.every((point, index) => point === index);
            if (!settled) continue;

            await it(`${vector.position} → page ${vector.page} — ${vector.rule}`, () => {
                const state = seeded(vector.snapPoints.map((_point, index) => `p${index}`));
                expect(state.pageAt(vector.position)).toBe(vector.page);
            });
        }

        await it('marks the LOWER page at an exact half-way position', () => {
            // The old `i === this._position` compare ran on an integer position,
            // so a swipe resting between pages could not be represented at all;
            // Math.round would have marked the later page.
            const state = seeded(['a', 'b']);
            state.setPosition(0.5);
            expect(carouselDotClasses(state)).toStrictEqual(['adw-carousel-dot active', 'adw-carousel-dot']);
        });
    });

    await describe('AdwCarousel.navigate (libadwaita conformance vectors)', async () => {
        for (const vector of CAROUSEL_NAVIGATE_VECTORS) {
            await it(`${vector.position} of ${vector.nPages} ${vector.direction} — ${vector.rule}`, () => {
                const state = seeded(Array.from({ length: vector.nPages }, (_unused, index) => `p${index}`));
                state.setPosition(vector.position);
                const before = state.position;

                expect(state.navigate(vector.direction)).toBe(vector.target !== null);
                expect(state.position).toBe(vector.target === null ? before : vector.target);
            });
        }
    });

    await describe('AdwCarousel property defaults (libadwaita conformance vectors)', async () => {
        for (const { property, value, rule } of CAROUSEL_PROPERTY_DEFAULT_VECTORS) {
            await it(`${property} defaults to ${JSON.stringify(value)} — ${rule}`, () => {
                const state = createCarouselState();
                const actual: Record<typeof property, string | number | boolean> = {
                    orientation: state.orientation,
                    interactive: state.interactive,
                    allowScrollWheel: state.allowScrollWheel,
                    // Read off the shared state, not off a NativeScript property: this
                    // port exposes `interactive` and nothing else of the four, because a
                    // phone has no scroll wheel and no mouse to drag with. What the
                    // vector pins here is the DEFAULT both renderers inherit.
                    allowMouseDrag: state.allowMouseDrag,
                    allowLongSwipes: state.allowLongSwipes,
                    spacing: state.spacing,
                    revealDuration: state.revealDuration,
                };
                expect(actual[property]).toBe(value);
            });
        }
    });

    await describe('AdwCarousel scroll offsets', async () => {
        await it('converts a position to a horizontal offset and back', () => {
            // `offset = distance * position` (adw-carousel.c:797-801).
            const state = seeded(['a', 'b', 'c']);
            const distance = state.pageDistance(440);
            expect(carouselScrollOffset(2, distance)).toBe(880);
            expect(carouselPositionAtOffset(880, distance)).toBe(2);
            expect(carouselPositionAtOffset(660, distance)).toBe(1.5);
        });

        await it('never divides by a zero distance', () => {
            // NS reports no size before the first layout pass, and an Infinity
            // position would poison every lookup downstream.
            expect(carouselPositionAtOffset(100, 0)).toBe(0);
        });

        await it('falls a nonsense page width back to the default', () => {
            expect(normalizeCarouselPageWidth(440)).toBe(440);
            expect(normalizeCarouselPageWidth(0)).toBe(DEFAULT_CAROUSEL_PAGE_WIDTH);
            expect(normalizeCarouselPageWidth(-5)).toBe(DEFAULT_CAROUSEL_PAGE_WIDTH);
            expect(normalizeCarouselPageWidth(Number.NaN)).toBe(DEFAULT_CAROUSEL_PAGE_WIDTH);
        });
    });

    await describe('AdwCarousel scroll/model sync', async () => {
        await it('ignores the frames of a scroll it started, then tracks the user again', () => {
            // Without this the ScrollView's own animation replays every
            // intermediate offset back at the model, running the dots backwards
            // to where the scroll started and emitting a second page-changed.
            const state = seeded(['a', 'b', 'c']);
            const sync = new CarouselScrollSync();
            const pageChanged: number[] = [];
            state.onPageChanged((index) => pageChanged.push(index));

            sync.expect(2);
            state.setPosition(2);
            state.settle();

            expect(sync.apply(state, 0.4)).toBe(false);
            expect(sync.apply(state, 1.3)).toBe(false);
            expect(state.position).toBe(2);
            expect(sync.apply(state, 2)).toBe(false); // arrival ends the programmatic scroll
            expect(pageChanged).toStrictEqual([2]);

            // A scroll nobody declared is a user swipe, and it drives the model.
            expect(sync.apply(state, 1.4)).toBe(true);
            expect(state.position).toBe(1.4);
            expect(pageChanged).toStrictEqual([2]);
            expect(sync.apply(state, 1)).toBe(true);
            expect(pageChanged).toStrictEqual([2, 1]);
        });

        await it('reports a settle back onto the page it started from', () => {
            // scroll_animation_done_cb fires after EVERY completed scroll
            // (adw-carousel.c:363-376); this port emitted nothing at all.
            const state = seeded(['a', 'b', 'c']);
            const sync = new CarouselScrollSync();
            const pageChanged: number[] = [];
            state.onPageChanged((index) => pageChanged.push(index));

            sync.apply(state, 0);
            sync.apply(state, 0.3);
            sync.apply(state, 0);
            expect(pageChanged).toStrictEqual([0, 0]);
        });

        await it('tags a user swipe as interactive', () => {
            const state = seeded(['a', 'b']);
            const payloads: CarouselNotifyPayload[] = [];
            state.subscribe((change) => payloads.push(carouselNotifyPayload(change)));

            new CarouselScrollSync().apply(state, 1);
            expect(payloads).toStrictEqual([{ position: 1, nPages: 2, page: 1, interactive: true }]);
        });
    });

    await describe('AdwCarousel guards', async () => {
        await it('refuses scrollToPage(NaN) instead of setting a NaN position', () => {
            // The regression that motivated the lift: Math.max(0, Math.min(n, NaN))
            // is NaN, which was scrolled to, stored and notified — after which no
            // dot matched and the carousel had no current page at all.
            const state = seeded(['a', 'b', 'c']);
            state.scrollTo(1, { interactive: true });
            expect(state.scrollTo(Number.NaN, { interactive: true })).toBe(false);
            expect(state.position).toBe(1);
            expect(carouselDotClasses(state)).toStrictEqual([
                'adw-carousel-dot',
                'adw-carousel-dot active',
                'adw-carousel-dot',
            ]);
        });

        await it('refuses an out-of-range page rather than clamping to the last one', () => {
            const state = seeded(['a', 'b', 'c']);
            expect(state.scrollTo(99)).toBe(false);
            expect(state.position).toBe(0);
            expect(state.diagnostics).toHaveLength(1);
        });

        await it('emits a payload that carries no internal discriminator', () => {
            // The event escapes into consumer code; `reason` names a C
            // notification site, not a NativeScript event.
            const state = seeded(['a', 'b']);
            const payloads: CarouselNotifyPayload[] = [];
            state.subscribe((change) => payloads.push(carouselNotifyPayload(change)));
            state.setPosition(1, true);

            expect(payloads).toStrictEqual([{ position: 1, nPages: 2, page: 1, interactive: true }]);
            expect(Object.keys(payloads[0]!).sort()).toStrictEqual(['interactive', 'nPages', 'page', 'position']);
        });
    });
};
