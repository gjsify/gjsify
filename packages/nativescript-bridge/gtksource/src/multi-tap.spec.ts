import { describe, expect, it } from '@gjsify/unit';

import { MultiTap } from './multi-tap.js';

export const MultiTapTest = async () => {
    await describe('MultiTap', async () => {
        await it('counts presses inside the timeout and slop', () => {
            const taps = new MultiTap(300, 10);
            expect(taps.press(0, 50, 50)).toBe(1);
            expect(taps.press(200, 54, 48)).toBe(2);
            expect(taps.press(400, 50, 50)).toBe(3);
        });

        await it('starts over after a triple, a pause or a move', () => {
            const taps = new MultiTap(300, 10);
            taps.press(0, 0, 0);
            taps.press(100, 0, 0);
            taps.press(200, 0, 0);
            expect(taps.press(300, 0, 0)).toBe(1);
            expect(taps.press(900, 0, 0)).toBe(1);
            expect(taps.press(1000, 40, 0)).toBe(1);
        });
    });
};
