// Swipe-tracker specs. NO conformance vector table, deliberately: a table exists so a
// RENDERER that re-implements a derivation fails a test naming the input, and exactly one
// renderer drives this today. It earns a table the day the NativeScript port grows a
// swipe — until then a table would be the derivation asserted against itself, which
// `scripts/check-adwaita-conformance-drivers.mjs` was written to stop counting as
// coverage. Tracked with the other core-only modules in `status/open-todos.md`.
//
// The numbers below are the C's arithmetic, worked out by hand from the constants rather
// than copied off a run: `slope` is 0.499 for touch, so a 1 unit/ms flick projects 0.499
// pages and a 2 unit/ms one projects 0.998 — just under a page, which is exactly why
// `find_point_for_projection` has to step.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_SWIPE_VELOCITY_THRESHOLD_TOUCH,
    ADW_SWIPE_VELOCITY_THRESHOLD_TOUCHPAD,
    SwipeTracker,
    swipeBounds,
    swipeClosestPointIndex,
    swipeEndProgress,
    swipeNextPointIndex,
    swipePreviousPointIndex,
    swipeProjectedPointIndex,
    swipeSlope,
} from './swipe.js';

/** Three pages, the shape every carousel story uses. */
const POINTS = [0, 1, 2];

export default async () => {
    await describe('swipe point lookup', async () => {
        await it('finds the closest, the next and the previous point', () => {
            expect(swipeClosestPointIndex(POINTS, 0.4)).toBe(0);
            expect(swipeClosestPointIndex(POINTS, 0.6)).toBe(1);
            // A tie takes the FIRST, because the scan only replaces on a strict `<` —
            // the C's `find_closest_point` does the same, and a half-page drag settling
            // backwards rather than forwards is a visible consequence of it.
            expect(swipeClosestPointIndex(POINTS, 0.5)).toBe(0);
            expect(swipeNextPointIndex(POINTS, 0.5)).toBe(1);
            expect(swipePreviousPointIndex(POINTS, 0.5)).toBe(0);
            expect(swipeNextPointIndex(POINTS, 2.5)).toBe(-1);
            expect(swipePreviousPointIndex(POINTS, -0.5)).toBe(-1);
        });

        await it('treats a position ON a point as both its own next and previous', () => {
            expect(swipeNextPointIndex(POINTS, 1)).toBe(1);
            expect(swipePreviousPointIndex(POINTS, 1)).toBe(1);
        });
    });

    await describe('swipeBounds is what allow-long-swipes means', async () => {
        await it('reaches one point either side without long swipes', () => {
            // Starting ON page 1: `prev` and `next` collapse to it, so the reach is 0..2.
            expect(swipeBounds(POINTS, 1, false)).toStrictEqual({ lower: 0, upper: 2 });
            // Starting ON page 0: `lower` clamps at the first point rather than wrapping.
            expect(swipeBounds(POINTS, 0, false)).toStrictEqual({ lower: 0, upper: 1 });
        });

        await it('reaches one point past each NEIGHBOUR when it starts between them', () => {
            // Not on a point: prev=0, next=1, so the reach is points[-1→0]..points[2].
            expect(swipeBounds([0, 1, 2, 3], 0.5, false)).toStrictEqual({ lower: 0, upper: 2 });
            expect(swipeBounds([0, 1, 2, 3], 1.5, false)).toStrictEqual({ lower: 0, upper: 3 });
        });

        await it('reaches the whole strip with long swipes', () => {
            expect(swipeBounds([0, 1, 2, 3], 1, true)).toStrictEqual({ lower: 0, upper: 3 });
        });

        await it('answers for an empty strip instead of reading past the array', () => {
            expect(swipeBounds([], 0, false)).toStrictEqual({ lower: 0, upper: 0 });
        });
    });

    await describe('swipeEndProgress', async () => {
        const end = (over: Partial<Parameters<typeof swipeEndProgress>[0]>) =>
            swipeEndProgress({
                points: POINTS,
                initialProgress: 0,
                progress: 0,
                velocity: 0,
                allowLongSwipes: false,
                source: 'touch',
                ...over,
            });

        await it('settles on the nearest point below the velocity threshold', () => {
            // A slow drag: 0.29 is under 0.3, so the projection is not consulted at all.
            expect(end({ progress: 0.4, velocity: ADW_SWIPE_VELOCITY_THRESHOLD_TOUCH - 0.01 })).toBe(0);
            expect(end({ progress: 0.6, velocity: 0.1 })).toBe(1);
        });

        await it('holds the touchpad to a higher bar than touch', () => {
            const velocity = (ADW_SWIPE_VELOCITY_THRESHOLD_TOUCH + ADW_SWIPE_VELOCITY_THRESHOLD_TOUCHPAD) / 2;
            // The same velocity is a flick on touch and a nudge on a touchpad.
            expect(end({ progress: 0.1, velocity, source: 'touch' })).toBe(1);
            expect(end({ progress: 0.1, velocity, source: 'touchpad' })).toBe(0);
        });

        await it('projects a flick forward even when it did not clear a page', () => {
            // 1 unit/ms * 0.499 = 0.499 of a page from 0.1 → 0.599, whose nearest point
            // is 1 anyway. The interesting case is the one below.
            expect(end({ progress: 0.1, velocity: 1 })).toBe(1);
            // From 0 at 1 unit/ms the projection lands on 0.499, nearest 0 — and
            // `find_point_for_projection` steps it, because the point BEHIND the
            // projection is the one the gesture started on. A deliberate flick moves.
            expect(end({ progress: 0, velocity: 1 })).toBe(1);
        });

        await it('steps backwards the same way', () => {
            expect(end({ initialProgress: 2, progress: 2, velocity: -1 })).toBe(1);
        });

        await it('cannot leave the bound allow-long-swipes sets', () => {
            // A very fast flick from page 0: the parabola projects far past page 2, and
            // the bound is one point past the start.
            expect(end({ points: [0, 1, 2, 3, 4], progress: 0, velocity: 12 })).toBe(1);
            expect(end({ points: [0, 1, 2, 3, 4], progress: 0, velocity: 12, allowLongSwipes: true })).toBeGreaterThan(
                1,
            );
        });

        await it('returns the cancel progress for a cancelled gesture', () => {
            expect(end({ progress: 0.9, velocity: 5, cancelled: true, cancelProgress: 0 })).toBe(0);
            // No cancel progress given: the C reads it off the swipeable, and the
            // tracker's own fallback is where the gesture began.
            expect(end({ progress: 0.9, velocity: 5, cancelled: true })).toBe(0.9);
        });

        await it('leaves an empty strip where it is', () => {
            expect(end({ points: [], progress: 0.5, velocity: 5 })).toBe(0.5);
        });
    });

    await describe('swipeProjectedPointIndex', async () => {
        await it('steps off the starting point rather than rounding back onto it', () => {
            expect(swipeProjectedPointIndex(POINTS, 0.4, 0, 1)).toBe(1);
            expect(swipeProjectedPointIndex(POINTS, 1.6, 2, -1)).toBe(1);
        });

        await it('rounds normally once the projection has cleared a page', () => {
            expect(swipeProjectedPointIndex(POINTS, 1.4, 0, 1)).toBe(1);
            expect(swipeProjectedPointIndex(POINTS, 1.6, 0, 1)).toBe(2);
        });

        await it('clamps instead of indexing past the ends', () => {
            // The C indexes `points[-1]` here and reads out of bounds. Every projection
            // `swipeEndProgress` produces is clamped first, so the two agree in range.
            expect(swipeProjectedPointIndex(POINTS, 2, 2, 1)).toBe(2);
            expect(swipeProjectedPointIndex(POINTS, 0, 0, -1)).toBe(0);
        });
    });

    await describe('SwipeTracker', async () => {
        const make = (allowLongSwipes = false, points: readonly number[] = POINTS) =>
            new SwipeTracker({ points: () => points, allowLongSwipes: () => allowLongSwipes });

        await it('follows the drag in progress units and clamps to the bound', () => {
            const tracker = make();
            tracker.begin(0);
            // 440 px page, 220 px of drag = half a page.
            expect(tracker.update(220, 440, 0)).toBe(0.5);
            expect(tracker.update(220, 440, 16)).toBe(1);
            // Past the bound one point beyond the start: clamped, not accumulated.
            expect(tracker.update(440, 440, 32)).toBe(1);
        });

        await it('drops the first delta, which only starts the clock', () => {
            const tracker = make(true);
            tracker.begin(0);
            // Two records 100 ms apart, second delta 200: velocity = 200 / 100 = 2.
            tracker.update(50, 440, 0);
            tracker.update(200, 440, 100);
            expect(tracker.end(100).velocity).toBe(2);
        });

        await it('has no velocity from a single move', () => {
            const tracker = make();
            tracker.begin(0);
            tracker.update(300, 440, 0);
            expect(tracker.end(0).velocity).toBe(0);
        });

        await it('forgets moves older than the history window', () => {
            const tracker = make(true);
            tracker.begin(0);
            tracker.update(10, 440, 0);
            // 200 ms later, so the first record is outside the 150 ms window and the
            // second becomes the clock-starter — leaving one record and no velocity.
            tracker.update(10, 440, 200);
            expect(tracker.end(200).velocity).toBe(0);
        });

        await it('zeroes a velocity pushing past a bound it is already on', () => {
            const tracker = make();
            tracker.begin(2);
            // Already at the last point, still dragging forward: without overshoot there
            // is nowhere for the velocity to project to.
            tracker.update(400, 440, 0);
            tracker.update(400, 440, 20);
            const { velocity, to } = tracker.end(20);
            expect(velocity).toBe(0);
            expect(to).toBe(2);
        });

        await it('lands where the projection says, through the same math', () => {
            const tracker = make();
            tracker.begin(0);
            tracker.update(20, 440, 0);
            tracker.update(200, 440, 100);
            const { velocity, to } = tracker.end(100);
            expect(velocity).toBe(2);
            expect(to).toBe(1);
        });

        await it('goes back where it started when cancelled', () => {
            const tracker = make();
            tracker.begin(0);
            tracker.update(200, 440, 0);
            tracker.update(200, 440, 20);
            tracker.cancel();
            expect(tracker.end(20).to).toBe(0);
        });

        await it('clears the history between gestures', () => {
            const tracker = make(true);
            tracker.begin(0);
            tracker.update(20, 440, 0);
            tracker.update(400, 440, 100);
            expect(tracker.end(100).velocity).toBe(4);
            // A second gesture must not inherit the first one's speed.
            tracker.begin(1);
            tracker.update(20, 440, 200);
            expect(tracker.end(200).velocity).toBe(0);
            expect(tracker.initialProgress).toBe(1);
        });

        await it('reads the slope the C computes, not a rounded copy of it', () => {
            expect(swipeSlope('touch')).toBeCloseTo(0.499, 10);
            expect(swipeSlope('touchpad')).toBeCloseTo(0.332, 3);
        });
    });
};
