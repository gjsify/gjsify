// Dragging an `AdwBottomSheet`: how tall it opens, where a finger puts it, where it comes to rest.
//
// The widget extends `GridLayout` and cannot be imported off-device, so its drag arithmetic is a
// pure sibling and is pinned here. The numbers are the ones a user feels on a tablet: the sheet
// opens to under half of the editor, a short drag falls back, a fling decides by itself.

import { describe, expect, it } from '@gjsify/unit';

import {
    FLING_VELOCITY,
    GRIP_HEIGHT,
    NestedDragTracker,
    OVERSCROLL_SLOP,
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

    await describe('NestedDragTracker', async () => {
        await it('lets content that is not at its start scroll without pulling the sheet', () => {
            const t = new NestedDragTracker();
            t.down(100);
            expect(t.move(160, 40).kind).toBe('none');
            expect(t.move(260, 20).kind).toBe('none');
            expect(t.dragging).toBe(false);
            expect(t.up().kind).toBe('none');
        });

        await it('pulls the sheet once the finger keeps going down from the start', () => {
            const t = new NestedDragTracker();
            t.down(100);
            expect(t.move(100 + OVERSCROLL_SLOP - 1, 0).kind).toBe('none');
            expect(t.move(100 + OVERSCROLL_SLOP, 0).kind).toBe('begin');
            const step = t.move(180, 0);
            expect(step.kind).toBe('move');
            expect(step.kind === 'move' ? step.dy : -1).toBe(80 - OVERSCROLL_SLOP);
        });

        await it('picks the pull up where the content comes back to its start', () => {
            const t = new NestedDragTracker();
            t.down(100);
            expect(t.move(200, 30).kind).toBe('none');
            expect(t.move(260, 0).kind).toBe('none');
            expect(t.move(260 + OVERSCROLL_SLOP, 0).kind).toBe('begin');
        });

        await it('does not pull on an upward move, and never past its start', () => {
            const t = new NestedDragTracker();
            t.down(300);
            expect(t.move(200, 0).kind).toBe('none');
            t.move(200 + OVERSCROLL_SLOP, 0);
            const back = t.move(150, 0);
            expect(back.kind === 'move' ? back.dy : -1).toBe(0);
        });

        await it('ends where it was let go, or at its start when cancelled', () => {
            const t = new NestedDragTracker();
            t.down(0);
            t.move(20, 0);
            t.move(120, 0);
            const end = t.up();
            expect(end.kind === 'end' ? end.dy : -1).toBe(100);
            t.down(0);
            t.move(20, 0);
            t.move(120, 0);
            const cancel = t.up(true);
            expect(cancel.kind === 'end' ? cancel.dy : -1).toBe(0);
        });
    });

    await describe('NestedDragTracker.ignorePan', async () => {
        await it('leaves a pan alone that began outside scrolling content', () => {
            const t = new NestedDragTracker();
            expect(t.ignorePan(1)).toBe(false);
            expect(t.ignorePan(2)).toBe(false);
            expect(t.ignorePan(3)).toBe(false);
        });

        await it('ignores the whole pan of a touch that went down in scrolling content', () => {
            const t = new NestedDragTracker();
            t.down(100);
            expect(t.ignorePan(1)).toBe(true);
            t.move(160, 40);
            expect(t.ignorePan(2)).toBe(true);
            t.up();
            // The touch is over, but the pan still ends: that end is ignored too, then it is reset.
            expect(t.ignorePan(3)).toBe(true);
            expect(t.ignorePan(1)).toBe(false);
        });

        await it('does not let mid-content scrolling move the sheet, whatever the distance', () => {
            const t = new NestedDragTracker();
            t.down(100);
            t.ignorePan(1);
            for (let y = 110; y < 500; y += 10) {
                expect(t.move(y, 300).kind).toBe('none');
                expect(t.ignorePan(2)).toBe(true);
            }
        });

        await it('takes a touch whose down was never delivered to begin at its first move', () => {
            const t = new NestedDragTracker();
            expect(t.move(100, 300).kind).toBe('none');
            expect(t.ignorePan(1)).toBe(true);
            for (let y = 110; y < 400; y += 10) expect(t.move(y, 300).kind).toBe('none');
            expect(t.dragging).toBe(false);
        });
    });

    await describe('grip', async () => {
        await it('is at least a 48 dip touch target', () => {
            expect(GRIP_HEIGHT >= 48).toBe(true);
        });
    });
};
