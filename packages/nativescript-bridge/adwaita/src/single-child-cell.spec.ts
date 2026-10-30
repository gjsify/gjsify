// When a one-child container's single cell is `star` and when it is `auto` — driven off-device.
//
// The widget class cannot be imported here: `extends GridLayout` evaluates the bare
// `@nativescript/core` specifier at module eval and the workspace install has none
// (AGENTS.md). So this drives `widgets/single-child-cell.ts`, the SHIPPING pure half
// `single-child-base.ts` calls, the same split `box-layout.spec.ts` uses one widget over.
//
// THE REGRESSION THIS PINS is the `Adw.Clamp { Adw.Bin { … } }` of Learn6502's tutorial page:
// the clamp writes BOTH `child.width` and `child.horizontalAlignment = 'center'`, and reading
// only the alignment made the Bin measure its subtree unconstrained — 17900px of wrapped
// labels inside a 1216px Bin, so every paragraph drew as one clipped line on Android.
// `widgets/single-child-cell.ts` carries the full account.

import { describe, expect, it } from '@gjsify/unit';

import { singleChildCellIsStar } from './widgets/single-child-cell.js';

export default async () => {
    await describe("a one-child container's single cell", async () => {
        await it('is star when the container stretches, which is the untouched default', () => {
            expect(singleChildCellIsStar('stretch', 'auto')).toBe(true);
        });

        await it('is auto when the container is aligned and nothing settled its width', () => {
            expect(singleChildCellIsStar('center', 'auto')).toBe(false);
            expect(singleChildCellIsStar('left', 'auto')).toBe(false);
            expect(singleChildCellIsStar('right', 'auto')).toBe(false);
        });

        await it('is star when a clamp wrote a definite width, centred though the child is', () => {
            expect(singleChildCellIsStar('center', 600)).toBe(true);
        });

        await it('reads a Length object the way NativeScript hands one over', () => {
            expect(singleChildCellIsStar('center', { value: 600, unit: 'dip' })).toBe(true);
            expect(singleChildCellIsStar('center', { value: 100, unit: '%' })).toBe(true);
        });

        await it('leaves a width of nothing to give as auto, which is the honest answer', () => {
            expect(singleChildCellIsStar('center', 0)).toBe(false);
            expect(singleChildCellIsStar('center', -1)).toBe(false);
            expect(singleChildCellIsStar('center', { value: 0, unit: 'dip' })).toBe(false);
        });

        await it('takes an unwritten width — undefined, as the double reports one — as auto', () => {
            expect(singleChildCellIsStar('center', undefined)).toBe(false);
            expect(singleChildCellIsStar('center', null)).toBe(false);
        });

        await it('still says star for a stretching container whose width is unwritten', () => {
            expect(singleChildCellIsStar('stretch', undefined)).toBe(true);
        });
    });

    // The ROW asks the same question of `verticalAlignment` + `height`, and for a long while
    // nothing asked it: `single-child-base.ts` synced only the column, so a `valign: start`
    // Bin kept a star row and took the whole height it was offered. Learn6502's gamepad is
    // exactly that Bin, and its d-pad drew as a column of separated buttons spread down
    // 1060px instead of a cross.
    await describe('the same cell read down the other axis', async () => {
        await it('is star when the container stretches vertically', () => {
            expect(singleChildCellIsStar('stretch', 'auto')).toBe(true);
        });

        await it('is auto for the vertical alignments, which GTK sizes to the child', () => {
            expect(singleChildCellIsStar('top', 'auto')).toBe(false);
            expect(singleChildCellIsStar('middle', 'auto')).toBe(false);
            expect(singleChildCellIsStar('bottom', 'auto')).toBe(false);
        });

        await it('is star when a definite height was written, aligned though the container is', () => {
            expect(singleChildCellIsStar('top', 300)).toBe(true);
            expect(singleChildCellIsStar('bottom', { value: 300, unit: 'dip' })).toBe(true);
        });

        await it('leaves a height of nothing to give as auto', () => {
            expect(singleChildCellIsStar('top', 0)).toBe(false);
            expect(singleChildCellIsStar('top', undefined)).toBe(false);
        });
    });
};
