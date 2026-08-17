// Scroll edge-indicator specs.
//
// The case that motivated the module is `draws nothing at the top edge`: every
// scroller in the storybook painted a top undershoot at rest, so a flat header bar
// sat behind a permanent hairline that native only draws once you scroll.
import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_MAX_OVERSHOOT_DISTANCE,
    ADW_UNDERSHOOT_CLASSES,
    accumulateOvershoot,
    isScrolledFromEnd,
    isScrolledFromStart,
    overshootDistance,
    type ScrollAdjustment,
    scrollMaxValue,
    scrollUndershootClasses,
} from './scrolling.js';

/** A 1000px document in a 400px port, i.e. 600px of travel. */
const adj = (value: number): ScrollAdjustment => ({ value, lower: 0, upper: 1000, pageSize: 400 });

export default async () => {
    await describe('scrolling: undershoot', async () => {
        await it('draws nothing at the top edge', () => {
            expect(isScrolledFromStart(adj(0))).toBe(false);
            expect(isScrolledFromEnd(adj(0))).toBe(true);
            expect(scrollUndershootClasses({ vertical: adj(0) })).toStrictEqual(['undershoot-bottom']);
        });

        await it('draws both edges in the middle', () => {
            expect(scrollUndershootClasses({ vertical: adj(300) })).toStrictEqual([
                'undershoot-top',
                'undershoot-bottom',
            ]);
        });

        await it('draws nothing at the bottom edge', () => {
            expect(isScrolledFromEnd(adj(600))).toBe(false);
            expect(scrollUndershootClasses({ vertical: adj(600) })).toStrictEqual(['undershoot-top']);
        });

        await it('draws nothing when the content fits', () => {
            const fits: ScrollAdjustment = { value: 0, lower: 0, upper: 400, pageSize: 400 };
            expect(scrollMaxValue(fits)).toBe(0);
            expect(scrollUndershootClasses({ vertical: fits })).toStrictEqual([]);
        });

        await it('names the horizontal pair start/end, not left/right', () => {
            expect(scrollUndershootClasses({ horizontal: adj(300) })).toStrictEqual([
                'undershoot-start',
                'undershoot-end',
            ]);
        });

        await it('omits an axis that cannot scroll rather than reporting it at rest', () => {
            expect(scrollUndershootClasses({})).toStrictEqual([]);
        });

        await it('only ever emits classes it declares', () => {
            const emitted = scrollUndershootClasses({ vertical: adj(300), horizontal: adj(300) });
            for (const cls of emitted) expect(ADW_UNDERSHOOT_CLASSES).toContain(cls);
            expect(emitted.length).toBe(ADW_UNDERSHOOT_CLASSES.length);
        });
    });

    await describe('scrolling: overshoot', async () => {
        await it('is zero anywhere in range', () => {
            expect(overshootDistance(0, adj(0))).toBe(0);
            expect(overshootDistance(300, adj(300))).toBe(0);
            expect(overshootDistance(600, adj(600))).toBe(0);
        });

        await it('is signed by the edge it passed', () => {
            expect(overshootDistance(-40, adj(0))).toBe(-40);
            expect(overshootDistance(640, adj(600))).toBe(40);
        });

        await it('accumulates past the edge instead of stopping there', () => {
            const first = accumulateOvershoot(0, -30, adj(0));
            expect(first).toBe(-30);
            expect(accumulateOvershoot(first, -30, adj(0))).toBe(-60);
        });

        await it('caps at one overshoot distance rather than damping toward it', () => {
            // No rubber band upstream: a huge delta lands exactly on the cap.
            expect(accumulateOvershoot(0, -5000, adj(0))).toBe(-ADW_MAX_OVERSHOOT_DISTANCE);
            expect(accumulateOvershoot(600, 5000, adj(600))).toBe(600 + ADW_MAX_OVERSHOOT_DISTANCE);
        });

        await it('travels back through the range on the opposite delta', () => {
            expect(accumulateOvershoot(-100, 130, adj(0))).toBe(30);
        });
    });
};
