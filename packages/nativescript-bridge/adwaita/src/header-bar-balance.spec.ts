// What a header bar needs to centre its title on the window rather than between its buttons.
//
// `Adw.HeaderBar` gives its start and end boxes one width, the wider of the two. The widget reads
// its children back after a layout and writes the padding; the decision is pure and checked here.

import { describe, expect, it } from '@gjsify/unit';

import { balancedSideWidth, sideNaturalWidth } from './widgets/header-bar-balance.js';

const button = (width: number, margin = 0, visible = true) => ({
    visible,
    width,
    marginStart: margin,
    marginEnd: margin,
});

export default async () => {
    await describe('sideNaturalWidth', async () => {
        await it('adds up the visible children with their margins, and the padding', () => {
            expect(sideNaturalWidth([button(40, 2), button(40, 2)], 6)).toBe(94);
        });

        await it('gives a collapsed child no room', () => {
            expect(sideNaturalWidth([button(40), button(40, 0, false)], 0)).toBe(40);
        });

        await it('is the padding alone for an empty side', () => {
            expect(sideNaturalWidth([], 0)).toBe(0);
        });
    });

    await describe('balancedSideWidth', async () => {
        await it('gives both sides the width of the wider one', () => {
            // Two buttons on the left, one on the right: the title stays on the window's middle.
            expect(balancedSideWidth(88, 44)).toBe(88);
            expect(balancedSideWidth(44, 88)).toBe(88);
        });

        await it('rounds a fractional width up so the sides never come out narrower than the content', () => {
            expect(balancedSideWidth(43.2, 10)).toBe(44);
        });

        await it('is nothing for a bar with no buttons', () => {
            expect(balancedSideWidth(0, 0)).toBe(0);
        });
    });
};
