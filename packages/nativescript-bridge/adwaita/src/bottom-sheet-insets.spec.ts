// Where a bottom sheet's gesture inset lands: in the bar while closed, in the SCROLL CONTENT
// while open. The structure is the whole point — padding the viewport instead of the content is
// what clipped the quick help a gesture area above the screen edge, so the test asserts that the
// page keeps nothing back when the sheet scrolls.

import { describe, expect, it } from '@gjsify/unit';

import { SHEET_CONTENT_BOTTOM_GAP, bottomSheetInsetPadding } from './widgets/bottom-sheet-insets.js';

export default async () => {
    await describe('bottomSheetInsetPadding', async () => {
        await it('puts the inset of a scrolling sheet after the content, never around it', () => {
            const padding = bottomSheetInsetPadding(32, { sheetScrolls: true });
            expect(padding.scrollEnd).toBe(32 + SHEET_CONTENT_BOTTOM_GAP);
            // The viewport runs to the panel's bottom edge: anything here clips the text.
            expect(padding.page).toBe(0);
        });

        await it('pays the bar of a closed sheet the bare inset, with no content gap', () => {
            expect(bottomSheetInsetPadding(32, { sheetScrolls: true }).bar).toBe(32);
            expect(bottomSheetInsetPadding(32, { sheetScrolls: false }).bar).toBe(32);
        });

        await it('falls back to the page for a sheet child that does not scroll', () => {
            const padding = bottomSheetInsetPadding(32, { sheetScrolls: false });
            expect(padding.page).toBe(32 + SHEET_CONTENT_BOTTOM_GAP);
            expect(padding.scrollEnd).toBe(0);
        });

        await it('never charges the open sheet twice', () => {
            for (const sheetScrolls of [true, false]) {
                const padding = bottomSheetInsetPadding(32, { sheetScrolls });
                expect(padding.page + padding.scrollEnd).toBe(32 + SHEET_CONTENT_BOTTOM_GAP);
            }
        });

        await it('keeps the content gap where no platform charges an inset', () => {
            const padding = bottomSheetInsetPadding(0, { sheetScrolls: true });
            expect(padding.scrollEnd).toBe(SHEET_CONTENT_BOTTOM_GAP);
            expect(padding.bar).toBe(0);
        });

        await it('reads a reading that is not a number as nothing', () => {
            expect(bottomSheetInsetPadding(Number.NaN, { sheetScrolls: true }).scrollEnd).toBe(
                SHEET_CONTENT_BOTTOM_GAP,
            );
            expect(bottomSheetInsetPadding(-8, { sheetScrolls: true }).bar).toBe(0);
        });
    });
};
