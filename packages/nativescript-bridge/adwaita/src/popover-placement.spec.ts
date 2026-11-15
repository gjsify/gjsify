// `popoverPlacement` — where a popover's card goes. Pure, so it runs on the plain node entry.

import { describe, expect, it } from '@gjsify/unit';

import { POPOVER_ANCHOR_GAP, POPOVER_WINDOW_MARGIN, popoverPlacement } from './widgets/popover-placement.js';

const WINDOW = { width: 400, height: 800 };
const CARD = { width: 120, height: 100 };

export default async () => {
    await describe('popoverPlacement', async () => {
        await it('centres a bottom popover under its anchor', () => {
            const anchor = { x: 140, y: 100, width: 40, height: 40 };
            const at = popoverPlacement(anchor, CARD, WINDOW, 'bottom');
            expect(at.side).toBe('bottom');
            expect(at.left).toBe(160 - 60);
            expect(at.top).toBe(140 + POPOVER_ANCHOR_GAP);
        });

        await it('puts a top popover above its anchor', () => {
            const anchor = { x: 140, y: 400, width: 40, height: 40 };
            const at = popoverPlacement(anchor, CARD, WINDOW, 'top');
            expect(at.side).toBe('top');
            expect(at.top).toBe(400 - POPOVER_ANCHOR_GAP - CARD.height);
        });

        await it('flips to the other side when the preferred one has no room', () => {
            const low = { x: 140, y: 740, width: 40, height: 40 };
            expect(popoverPlacement(low, CARD, WINDOW, 'bottom').side).toBe('top');
            const high = { x: 140, y: 10, width: 40, height: 40 };
            expect(popoverPlacement(high, CARD, WINDOW, 'top').side).toBe('bottom');
        });

        await it('slides back onto the window at the horizontal edges', () => {
            const left = popoverPlacement({ x: 0, y: 100, width: 20, height: 20 }, CARD, WINDOW, 'bottom');
            expect(left.left).toBe(POPOVER_WINDOW_MARGIN);
            const right = popoverPlacement({ x: 390, y: 100, width: 10, height: 20 }, CARD, WINDOW, 'bottom');
            expect(right.left).toBe(WINDOW.width - POPOVER_WINDOW_MARGIN - CARD.width);
        });

        await it('takes the roomier side when neither fits, and stays reachable', () => {
            const tall = { width: 120, height: 700 };
            const anchor = { x: 140, y: 380, width: 40, height: 40 };
            const at = popoverPlacement(anchor, tall, WINDOW, 'bottom');
            expect(at.top >= POPOVER_WINDOW_MARGIN).toBe(true);
            expect(at.top + tall.height <= WINDOW.height - POPOVER_WINDOW_MARGIN).toBe(true);
        });

        await it('pins a card larger than the window at the margin', () => {
            const huge = { width: 900, height: 900 };
            const at = popoverPlacement({ x: 100, y: 100, width: 20, height: 20 }, huge, WINDOW, 'bottom');
            expect(at.left).toBe(POPOVER_WINDOW_MARGIN);
            expect(at.top).toBe(POPOVER_WINDOW_MARGIN);
        });
    });
};
