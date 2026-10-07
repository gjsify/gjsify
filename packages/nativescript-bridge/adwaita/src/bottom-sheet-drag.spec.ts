// Dragging an `AdwBottomSheet`: how tall it opens, where a finger puts it, where it comes to rest.
//
// The widget extends `GridLayout` and cannot be imported off-device, so its drag arithmetic is a
// pure sibling and is pinned here. The numbers are the ones a user feels on a tablet: the sheet
// opens to under half of the editor, a short drag falls back, a fling decides by itself.

import { describe, expect, it } from '@gjsify/unit';

import {
    FLING_VELOCITY,
    SHEET_MIN_HEIGHT,
    dragOffset,
    dragProgress,
    releaseVelocity,
    settle,
    sheetHeight,
    sheetTravel,
} from './widgets/bottom-sheet-drag.js';

export default async () => {
    await describe('sheetHeight', async () => {
        await it('opens to under half of the container, leaving the content above it visible', () => {
            expect(sheetHeight(800)).toBe(360);
            expect(sheetHeight(1000)).toBe(450);
        });

        await it('never goes below the minimum a readable sheet needs', () => {
            expect(sheetHeight(400)).toBe(SHEET_MIN_HEIGHT);
        });

        await it('always leaves a strip of the content to tap out on', () => {
            expect(sheetHeight(260)).toBe(212);
            expect(sheetHeight(30)).toBe(0);
        });

        await it('is nothing for a container that is not laid out yet', () => {
            expect(sheetHeight(0)).toBe(0);
            expect(sheetHeight(Number.NaN)).toBe(0);
        });
    });

    await describe('dragOffset and dragProgress', async () => {
        const travel = sheetTravel(360, 60);

        await it('measures the travel from the bar to the open sheet', () => {
            expect(travel).toBe(300);
            expect(sheetTravel(40, 60)).toBe(0);
        });

        await it('follows the finger up from the bar and stops at open', () => {
            expect(dragOffset('closed', 0, travel)).toBe(300);
            expect(dragOffset('closed', -100, travel)).toBe(200);
            expect(dragOffset('closed', -900, travel)).toBe(0);
        });

        await it('follows the finger down from the open sheet and stops at closed', () => {
            expect(dragOffset('open', 80, travel)).toBe(80);
            expect(dragOffset('open', 900, travel)).toBe(300);
        });

        await it('does not move against its own end: a drag down on a closed bar, up on an open sheet', () => {
            expect(dragOffset('closed', 50, travel)).toBe(300);
            expect(dragOffset('open', -50, travel)).toBe(0);
        });

        await it('reports how far open it is, the strength of the dimming', () => {
            expect(dragProgress(300, travel)).toBe(0);
            expect(dragProgress(150, travel)).toBe(0.5);
            expect(dragProgress(0, travel)).toBe(1);
            expect(dragProgress(0, 0)).toBe(0);
        });
    });

    await describe('releaseVelocity', async () => {
        await it('is zero without a drag', () => {
            expect(releaseVelocity([])).toBe(0);
            expect(releaseVelocity([{ dy: -10, time: 100 }])).toBe(0);
        });

        await it('reads the speed of the last moments, downward positive', () => {
            expect(
                releaseVelocity([
                    { dy: 0, time: 0 },
                    { dy: -50, time: 50 },
                    { dy: -100, time: 100 },
                ]),
            ).toBe(-1000);
        });

        await it('ignores the slow approach before a quick flick', () => {
            const v = releaseVelocity([
                { dy: 0, time: 0 },
                { dy: -10, time: 500 },
                { dy: -20, time: 900 },
                { dy: -80, time: 960 },
                { dy: -140, time: 1000 },
            ]);
            expect(v < -FLING_VELOCITY).toBe(true);
        });
    });

    await describe('settle', async () => {
        const travel = 300;

        await it('comes to rest on the nearer end when let go slowly', () => {
            expect(settle(100, travel, 0)).toBe('open');
            expect(settle(200, travel, 0)).toBe('closed');
            expect(settle(150, travel, 0)).toBe('open');
        });

        await it('lets a fling decide, whichever way the sheet was dragged', () => {
            expect(settle(290, travel, -FLING_VELOCITY)).toBe('open');
            expect(settle(10, travel, FLING_VELOCITY)).toBe('closed');
        });

        await it('does not treat a gentle release as a fling', () => {
            expect(settle(280, travel, -(FLING_VELOCITY - 1))).toBe('closed');
        });
    });
};
