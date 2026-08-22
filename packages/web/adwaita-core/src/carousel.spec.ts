// Carousel specs — driven by the shared conformance vectors, so this suite and
// the two renderer suites assert the SAME table.

import { describe, it, expect } from '@gjsify/unit';

import {
    CAROUSEL_SCROLL_TIMEOUT_MS,
    CarouselState,
    carouselClampPosition,
    carouselClosestSnapPoint,
    carouselNavigateTarget,
    carouselPageAllocation,
    carouselPageAtPosition,
    carouselRange,
    carouselReorderShift,
    carouselSizesFromSnapPoints,
    carouselSnapPoints,
    carouselWheelStep,
    type CarouselChangeReason,
    type CarouselScrollRequest,
    type CarouselStateOptions,
} from './carousel.js';
import {
    CAROUSEL_CLAMP_VECTORS,
    CAROUSEL_NAVIGATE_VECTORS,
    CAROUSEL_PAGE_ALLOCATION_VECTORS,
    CAROUSEL_PAGE_AT_POSITION_VECTORS,
    CAROUSEL_PAGE_LIST_VECTORS,
    CAROUSEL_PROPERTY_DEFAULT_VECTORS,
    CAROUSEL_RANGE_VECTORS,
    CAROUSEL_REORDER_SHIFT_VECTORS,
    CAROUSEL_REVEAL_VECTORS,
    CAROUSEL_SIZES_FROM_SNAP_POINTS_VECTORS,
    CAROUSEL_SNAP_POINT_VECTORS,
    CAROUSEL_WHEEL_LOCKOUT_VECTORS,
    CAROUSEL_WHEEL_VECTORS,
    type CarouselPageOp,
    type CarouselRevealOp,
    type CarouselStateSnapshot,
} from './conformance/carousel.js';

/** A carousel with `pages` already inserted and revealed — the settled starting point every script assumes. */
function seeded(pages: readonly string[], options: CarouselStateOptions = {}): CarouselState {
    const state = new CarouselState(options);
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

/**
 * Apply one page-list op. `insert`/`remove` finish the reveal immediately,
 * because the vectors are written for the default `reveal-duration` of 0 — which
 * is what both renderers' page APIs do.
 */
function applyPageOp(state: CarouselState, op: CarouselPageOp): boolean {
    switch (op.kind) {
        case 'insert': {
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

export default async () => {
    await describe('carouselSnapPoints (adw_carousel_size_allocate)', async () => {
        for (const { sizes, snapPoints, rule } of CAROUSEL_SNAP_POINT_VECTORS) {
            await it(`${JSON.stringify(sizes)} → ${JSON.stringify(snapPoints)} — ${rule}`, () => {
                expect(carouselSnapPoints(sizes)).toStrictEqual([...snapPoints]);
            });
        }

        await it('round-trips through the indicator inverse', () => {
            // Opposite ends of the same wire: the carousel publishes snap points, the
            // indicator reconstructs sizes from them.
            for (const { sizes } of CAROUSEL_SNAP_POINT_VECTORS) {
                const recovered = carouselSizesFromSnapPoints(carouselSnapPoints(sizes));
                recovered.forEach((size, index) => expect(size).toBeCloseTo(sizes[index]!, 12));
                expect(recovered).toHaveLength(sizes.length);
            }
        });
    });

    await describe('carouselPageAllocation (adw_carousel_size_allocate:748-767, :796-806)', async () => {
        for (const { available, pages, pageSize, leadingInset, rule } of CAROUSEL_PAGE_ALLOCATION_VECTORS) {
            await it(`${JSON.stringify(pages)} in ${available} → page ${pageSize}, inset ${leadingInset} — ${rule}`, () => {
                expect(carouselPageAllocation(available, pages)).toStrictEqual({ pageSize, leadingInset });
            });
        }

        await it('leaves the neighbours a peek of leadingInset minus spacing', () => {
            // The composed quantity the reported defect was about: with the strip
            // centred, the next page's left edge sits `distance` from the current
            // page's, so what shows past the carousel edge is the inset less the gap.
            const state = new CarouselState({ spacing: 8 });
            const { pageSize, leadingInset } = carouselPageAllocation(480, [{ natural: 440 }]);
            const distance = state.pageDistance(pageSize);
            expect(distance).toBe(448);
            // Next page starts at leadingInset + distance, and the carousel ends at 480.
            expect(480 - (leadingInset + distance)).toBe(leadingInset - 8);
        });
    });

    await describe('carouselSizesFromSnapPoints (adw-carousel-indicator-dots.c:189-191)', async () => {
        for (const { snapPoints, sizes, rule } of CAROUSEL_SIZES_FROM_SNAP_POINTS_VECTORS) {
            await it(`${JSON.stringify(snapPoints)} → ${JSON.stringify(sizes)} — ${rule}`, () => {
                expect(carouselSizesFromSnapPoints(snapPoints)).toStrictEqual([...sizes]);
            });
        }
    });

    await describe('carouselRange / carouselClampPosition (get_range, set_position)', async () => {
        for (const { snapPoints, positionShift, lower, upper, rule } of CAROUSEL_RANGE_VECTORS) {
            await it(`${JSON.stringify(snapPoints)} shift ${positionShift} → [${lower}, ${upper}] — ${rule}`, () => {
                expect(carouselRange(snapPoints, positionShift)).toStrictEqual({ lower, upper });
            });
        }

        for (const { position, snapPoints, clamped, rule } of CAROUSEL_CLAMP_VECTORS) {
            await it(`clamp ${position} into ${JSON.stringify(snapPoints)} → ${clamped} — ${rule}`, () => {
                expect(carouselClampPosition(position, snapPoints)).toBe(clamped);
            });
        }

        await it('folds a pending position_shift into the bound it clamps against', () => {
            // `get_range` adds the shift, so the clamp a mid-animation `set_position` sees
            // is not the settled one.
            expect(carouselClampPosition(3, [0, 1, 2], 1)).toBe(3);
            expect(carouselClampPosition(3, [0, 1, 2], -1)).toBe(1);
        });
    });

    await describe('carouselPageAtPosition (get_page_at_position)', async () => {
        for (const { position, snapPoints, page, rule } of CAROUSEL_PAGE_AT_POSITION_VECTORS) {
            await it(`${position} in ${JSON.stringify(snapPoints)} → page ${page} — ${rule}`, () => {
                expect(carouselPageAtPosition(position, snapPoints)).toBe(page);
            });
        }

        await it('resolves every tie DOWNWARDS, where Math.round resolves up', () => {
            // One assertion instead of a row per boundary: every position where the two
            // rules disagree, so a "simplification" to Math.round fails naming the input.
            const points = [0, 1, 2, 3];
            const disagreements: number[] = [];
            for (let half = 0; half < 3; half++) {
                const position = half + 0.5;
                if (carouselPageAtPosition(position, points) !== Math.round(position)) disagreements.push(position);
            }
            expect(disagreements).toStrictEqual([0.5, 1.5, 2.5]);
        });

        await it('keeps the earlier page when two pages share a snap point', () => {
            // A trailing size-0 page duplicates its predecessor's point; the
            // strict `>` means the earlier one still wins.
            expect(carouselClosestSnapPoint(1, [0, 1, 1])).toBe(1);
        });
    });

    await describe('carouselNavigateTarget (navigate_to_direction)', async () => {
        for (const { position, nPages, direction, target, rule } of CAROUSEL_NAVIGATE_VECTORS) {
            await it(`${position} of ${nPages} ${direction} → ${String(target)} — ${rule}`, () => {
                expect(carouselNavigateTarget(position, nPages, direction)).toBe(target);
            });
        }

        await it('does NOT share a rounding rule with the page lookup', () => {
            // `adw-carousel.c` uses C round() (half away from zero) where the lookup
            // resolves a tie DOWNWARDS: merging the two would silently change one, so this
            // asserts they differ.
            const points = [0, 1, 2];
            expect(carouselPageAtPosition(0.5, points)).toBe(0);
            expect(carouselNavigateTarget(0.5, 3, 'back')).toBe(0);
            expect(carouselNavigateTarget(0.5, 3, 'forward')).toBe(2);
        });
    });

    await describe('carouselWheelStep (scroll_cb)', async () => {
        for (const vector of CAROUSEL_WHEEL_VECTORS) {
            const { deltaX, deltaY, orientation, source, step, rule } = vector;
            await it(`dx ${deltaX} dy ${deltaY} ${orientation}/${source} → ${step} — ${rule}`, () => {
                expect(carouselWheelStep({ deltaX, deltaY, orientation, source })).toBe(step);
            });
        }
    });

    await describe('carouselReorderShift (adw_carousel_reorder)', async () => {
        for (const vector of CAROUSEL_REORDER_SHIFT_VECTORS) {
            const { closestPoint, oldPoint, newPoint, size, shift, rule } = vector;
            await it(`${oldPoint} → ${newPoint} around ${closestPoint} → ${shift} — ${rule}`, () => {
                expect(carouselReorderShift({ closestPoint, oldPoint, newPoint, size })).toBe(shift);
            });
        }

        await it('compares snap points with an epsilon, not with ===', () => {
            // G_APPROX_VALUE: snap points are accumulated
            // sums, so "the same point" differs in the last bit for real.
            const drifted = 0.1 + 0.2 - 0.3; // ~5.5e-17, below DBL_EPSILON
            expect(carouselReorderShift({ closestPoint: drifted, oldPoint: 0, newPoint: 2, size: 1 })).toBe(2);
        });
    });

    await describe('CarouselState page list (libadwaita conformance vectors)', async () => {
        for (const vector of CAROUSEL_PAGE_LIST_VECTORS) {
            await it(vector.rule, () => {
                const state = seeded(vector.pages);
                const pageChanged: number[] = [];
                state.onPageChanged((index) => pageChanged.push(index));

                const results = vector.ops.map((op) => applyPageOp(state, op));

                expect(results).toStrictEqual([...vector.opResults]);
                expect(pageChanged).toStrictEqual([...vector.pageChanged]);
                expect(snapshot(state)).toStrictEqual(vector.expected);
            });
        }
    });

    await describe('CarouselState reveal lifecycle (libadwaita conformance vectors)', async () => {
        for (const vector of CAROUSEL_REVEAL_VECTORS) {
            await it(vector.rule, () => {
                const state = seeded(vector.pages);
                for (const op of vector.ops) applyRevealOp(state, op);
                expect(snapshot(state)).toStrictEqual(vector.expected);
            });
        }
    });

    await describe('CarouselState wheel lockout (SCROLL_TIMEOUT_DURATION)', async () => {
        for (const vector of CAROUSEL_WHEEL_LOCKOUT_VECTORS) {
            await it(vector.rule, () => {
                let clock = 0;
                const pages = Array.from({ length: vector.pages }, (_unused, index) => `p${index}`);
                const state = seeded(pages, { now: () => clock });

                const steps: Array<-1 | 0 | 1> = [];
                const positions: number[] = [];
                for (const step of vector.steps) {
                    clock = step.at;
                    steps.push(state.handleWheel({ deltaX: 0, deltaY: step.deltaY, source: 'mouse' }));
                    positions.push(state.position);
                }

                expect(steps).toStrictEqual(vector.steps.map((step) => step.step));
                expect(positions).toStrictEqual(vector.steps.map((step) => step.position));
            });
        }

        await it('runs entirely off the injected clock, never a real timer', () => {
            // The lockout is a plain arithmetic comparison, so a suite can step
            // past it without waiting 150 ms — the ToastScheduler seam style.
            let clock = 0;
            const state = seeded(['a', 'b', 'c'], { now: () => clock });
            expect(state.handleWheel({ deltaX: 0, deltaY: 1, source: 'mouse' })).toBe(1);
            clock = CAROUSEL_SCROLL_TIMEOUT_MS - 1;
            expect(state.handleWheel({ deltaX: 0, deltaY: 1, source: 'mouse' })).toBe(0);
            clock = CAROUSEL_SCROLL_TIMEOUT_MS;
            expect(state.handleWheel({ deltaX: 0, deltaY: 1, source: 'mouse' })).toBe(1);
        });

        await it('propagates when the wheel is off, non-interactive, or there are no pages', () => {
            expect(
                seeded(['a', 'b'], { allowScrollWheel: false }).handleWheel({ deltaX: 0, deltaY: 1, source: 'mouse' }),
            ).toBe(0);
            expect(
                seeded(['a', 'b'], { interactive: false }).handleWheel({ deltaX: 0, deltaY: 1, source: 'mouse' }),
            ).toBe(0);
            expect(new CarouselState().handleWheel({ deltaX: 0, deltaY: 1, source: 'mouse' })).toBe(0);
        });

        await it('reads the orientation off the carousel, not off the event', () => {
            const vertical = seeded(['a', 'b', 'c'], { orientation: 'vertical' });
            expect(vertical.handleWheel({ deltaX: 53, deltaY: 0, source: 'mouse' })).toBe(0);
            expect(vertical.handleWheel({ deltaX: 0, deltaY: 53, source: 'other' })).toBe(1);
        });
    });

    await describe('CarouselState property defaults (libadwaita conformance vectors)', async () => {
        for (const { property, value, rule } of CAROUSEL_PROPERTY_DEFAULT_VECTORS) {
            await it(`${property} defaults to ${JSON.stringify(value)} — ${rule}`, () => {
                const state = new CarouselState();
                const actual: Record<typeof property, string | number | boolean> = {
                    orientation: state.orientation,
                    interactive: state.interactive,
                    allowScrollWheel: state.allowScrollWheel,
                    allowMouseDrag: state.allowMouseDrag,
                    allowLongSwipes: state.allowLongSwipes,
                    spacing: state.spacing,
                    revealDuration: state.revealDuration,
                };
                expect(actual[property]).toBe(value);
            });
        }

        await it('starts empty, at position 0, with no current page', () => {
            const state = new CarouselState();
            expect(state.nPages).toBe(0);
            expect(state.position).toBe(0);
            expect(state.pageAt(0)).toBe(-1);
            expect(state.range).toStrictEqual({ lower: 0, upper: 0 });
        });

        await it('reports whether a property setter changed anything', () => {
            const state = new CarouselState();
            expect(state.setInteractive(true)).toBe(false);
            expect(state.setInteractive(false)).toBe(true);
            expect(state.setAllowScrollWheel(false)).toBe(true);
            expect(state.setAllowLongSwipes(true)).toBe(true);
            expect(state.setSpacing(12)).toBe(true);
            expect(state.setRevealDuration(200)).toBe(true);
            expect(state.setOrientation('vertical')).toBe(true);
            expect(state.setOrientation('vertical')).toBe(false);
        });

        await it('derives the page distance from spacing (self->distance)', () => {
            const state = new CarouselState({ spacing: 12 });
            expect(state.pageDistance(300)).toBe(312);
        });
    });

    await describe('CarouselState notifications', async () => {
        await it('tags each change with the C notification site it corresponds to', () => {
            const state = new CarouselState();
            const reasons: CarouselChangeReason[] = [];
            state.subscribe((change) => reasons.push(change.reason));

            state.insertPage('a');
            state.skipReveal('a');
            state.insertPage('b');
            state.skipReveal('b');
            state.setPosition(1);
            state.removePage('b');

            // insert -> notify::n-pages, reveal -> queue_allocate only,
            // set_position -> notify::position, remove -> notify::n-pages.
            expect(reasons).toStrictEqual(['n-pages', 'geometry', 'n-pages', 'geometry', 'position', 'n-pages']);
        });

        await it('notifies on a position write that changed nothing', () => {
            // g_object_notify_by_pspec is unconditional;
            // the NS port suppressed the no-op and a bound indicator went stale.
            const state = seeded(['a', 'b']);
            let notifications = 0;
            state.subscribe(() => notifications++);
            expect(state.setPosition(0)).toBe(false);
            expect(notifications).toBe(1);
        });

        await it('carries the interactive flag through to the listener', () => {
            const state = seeded(['a', 'b']);
            const flags: boolean[] = [];
            state.subscribe((change) => flags.push(change.interactive));
            state.setPosition(1, true);
            state.setPosition(0);
            expect(flags).toStrictEqual([true, false]);
        });

        await it('cannot skip a listener when one unsubscribes mid-fan-out', () => {
            const state = new CarouselState();
            const hits: number[] = [];
            const first = state.subscribe(() => {
                hits.push(1);
                first();
            });
            state.subscribe(() => hits.push(2));
            state.insertPage('a');
            expect(hits).toStrictEqual([1, 2]);
        });

        await it('unsubscribes from page-changed too', () => {
            const state = seeded(['a', 'b']);
            let calls = 0;
            const unsubscribe = state.onPageChanged(() => calls++);
            state.settle();
            unsubscribe();
            state.settle();
            expect(calls).toBe(1);
        });
    });

    await describe('CarouselState.scrollTo', async () => {
        await it('hands the renderer the target page AND its snap point', () => {
            const requests: CarouselScrollRequest[] = [];
            const state = seeded(['a', 'b', 'c'], { onScrollTo: (request) => requests.push(request) });
            state.scrollTo(2, { interactive: true });
            expect(requests).toStrictEqual([{ index: 2, position: 2, interactive: true, animate: false }]);
        });

        await it('leaves the position to the renderer when it animates', () => {
            // The core has no animator: with animate the renderer feeds the ramp
            // back through setPosition and finishes with settle().
            const state = seeded(['a', 'b', 'c'], { animateScroll: true });
            const pageChanged: number[] = [];
            state.onPageChanged((index) => pageChanged.push(index));

            expect(state.scrollTo(2)).toBe(true);
            expect(state.position).toBe(0);
            expect(pageChanged).toStrictEqual([]);

            state.setPosition(2);
            state.settle();
            expect(pageChanged).toStrictEqual([2]);
        });

        await it('skips a removing page when it resolves an index', () => {
            // get_nth_link walks past removing children,
            // so index 1 is `c` while `b` is still shrinking.
            const state = seeded(['a', 'b', 'c']);
            state.removePage('b');
            expect(state.indexOf('b')).toBe(-1);
            expect(state.indexOf('c')).toBe(1);
            state.scrollTo(1);
            expect(state.position).toBe(2);
        });

        await it('records the warning C would have printed for a refused target', () => {
            const state = seeded(['a', 'b']);
            state.scrollTo(5);
            expect([...state.diagnostics]).toStrictEqual([
                "adw_carousel_get_nth_page: assertion 'n < adw_carousel_get_n_pages (self)' failed (n = 5, n_pages = 2)",
            ]);
        });
    });

    await describe('CarouselState guards', async () => {
        await it('refuses a non-finite position instead of poisoning every lookup', () => {
            // The NS port's scrollToPage(NaN) set position to NaN, after which no
            // dot matched and the carousel had no current page at all.
            const state = seeded(['a', 'b', 'c']);
            state.setPosition(1);
            expect(state.setPosition(Number.NaN)).toBe(false);
            expect(state.setPosition(Number.POSITIVE_INFINITY)).toBe(false);
            expect(state.position).toBe(1);
            expect(state.pageAt(state.position)).toBe(1);
        });

        await it('refuses a non-finite page size', () => {
            const state = seeded(['a', 'b']);
            expect(state.setPageSize('a', Number.NaN)).toBe(false);
            expect(state.sizes).toStrictEqual([1, 1]);
        });

        await it('records an unknown page id rather than silently doing nothing', () => {
            const state = seeded(['a']);
            expect(state.setPageSize('zz', 1)).toBe(false);
            expect(state.removePage('zz')).toBe(false);
            expect(state.reorderPage('zz', 0)).toBe(false);
            expect(state.diagnostics).toHaveLength(3);
        });

        await it('treats a finished reveal as nothing to skip, not as an error', () => {
            // Removing a page mid-reveal frees it on the spot, so a renderer that
            // finishes what it just removed legitimately finds nothing.
            const state = seeded(['a', 'b']);
            state.insertPage('c');
            state.removePage('c');
            expect(state.skipReveal('c')).toBe(false);
            expect(state.skipReveal('a')).toBe(false);
            expect(state.diagnostics).toHaveLength(0);
        });
    });

    await describe('CarouselState.navigate', async () => {
        await it('steps one page and refuses at the bounds', () => {
            const state = seeded(['a', 'b', 'c']);
            expect(state.navigate('back')).toBe(false);
            expect(state.navigate('forward')).toBe(true);
            expect(state.position).toBe(1);
            expect(state.navigate('forward')).toBe(true);
            expect(state.navigate('forward')).toBe(false);
            expect(state.position).toBe(2);
        });

        await it('is gated on interactive, as keynav_cb is (adw-carousel.c:588)', () => {
            const state = seeded(['a', 'b', 'c'], { interactive: false });
            expect(state.navigate('forward')).toBe(false);
            state.setInteractive(true);
            expect(state.navigate('forward')).toBe(true);
        });

        await it('tags the resulting change as a user navigation', () => {
            const state = seeded(['a', 'b']);
            const flags: boolean[] = [];
            state.subscribe((change) => flags.push(change.interactive));
            state.navigate('forward');
            expect(flags).toStrictEqual([true]);
        });
    });
};
