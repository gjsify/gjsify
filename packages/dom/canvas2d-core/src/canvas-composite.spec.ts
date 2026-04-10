// Canvas 2D composite operation tests — verifies the Cairo operator
// mapping for the globalCompositeOperation modes that 2D games commonly
// use (source-over, destination-over, source-in, destination-in,
// lighter, xor, copy).
//
// Ported from refs/wpt/html/canvas/element/compositing/
//   2d.composite.canvas.{source-over,destination-over,source-in,
//   destination-in,lighter,xor}.html
// Original: Copyright (c) Web Platform Tests contributors. 3-Clause BSD.
// Reimplemented for GJS using @gjsify/canvas2d-core + @gjsify/unit.

import { describe, it, expect } from '@gjsify/unit';
import { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';

function makeCtx(width = 30, height = 30): CanvasRenderingContext2D {
    const canvas = { width, height };
    return new CanvasRenderingContext2D(canvas);
}

function assertPixel(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    r: number, g: number, b: number, a: number,
    tol = 2,
): void {
    const data = ctx.getImageData(x, y, 1, 1).data;
    expect(Math.abs(data[0] - r) <= tol).toBe(true);
    expect(Math.abs(data[1] - g) <= tol).toBe(true);
    expect(Math.abs(data[2] - b) <= tol).toBe(true);
    expect(Math.abs(data[3] - a) <= tol).toBe(true);
}

/**
 * Common setup: draws a red rect on the left half, then configures the
 * composite operator, then draws a green rect that overlaps on the right half.
 * The test asserts the result in four zones: pure red, overlap, pure green,
 * empty.
 */
function setupAndDraw(ctx: CanvasRenderingContext2D, mode: GlobalCompositeOperation): void {
    ctx.fillStyle = 'rgb(255, 0, 0)';
    ctx.fillRect(5, 5, 15, 15);
    ctx.globalCompositeOperation = mode;
    ctx.fillStyle = 'rgb(0, 255, 0)';
    ctx.fillRect(10, 10, 15, 15);
}

export default async () => {
    await describe('CanvasRenderingContext2D — globalCompositeOperation', async () => {

        await describe('source-over (default)', async () => {
            await it('green overlay replaces red in the overlap region', async () => {
                const ctx = makeCtx();
                setupAndDraw(ctx, 'source-over');
                // Red-only zone (7,7)
                assertPixel(ctx, 7, 7, 255, 0, 0, 255);
                // Overlap zone (15,15) — green on top
                assertPixel(ctx, 15, 15, 0, 255, 0, 255);
                // Green-only zone (22,22)
                assertPixel(ctx, 22, 22, 0, 255, 0, 255);
                // Empty zone (2,2)
                assertPixel(ctx, 2, 2, 0, 0, 0, 0);
            });
        });

        await describe('destination-over', async () => {
            await it('green is drawn BEHIND the existing red', async () => {
                const ctx = makeCtx();
                setupAndDraw(ctx, 'destination-over');
                // Overlap region — red in front
                assertPixel(ctx, 15, 15, 255, 0, 0, 255);
                // Red-only zone unchanged
                assertPixel(ctx, 7, 7, 255, 0, 0, 255);
                // Green-only zone
                assertPixel(ctx, 22, 22, 0, 255, 0, 255);
            });
        });

        await describe('destination-in', async () => {
            await it('keeps only red pixels where green overlaps', async () => {
                const ctx = makeCtx();
                setupAndDraw(ctx, 'destination-in');
                // Overlap region — red stays (destination-in keeps destination
                // where source exists)
                assertPixel(ctx, 15, 15, 255, 0, 0, 255);
                // Red-only zone — cleared (no source → destination discarded)
                assertPixel(ctx, 7, 7, 0, 0, 0, 0);
                // Green-only zone — transparent (no destination)
                assertPixel(ctx, 22, 22, 0, 0, 0, 0);
            });
        });

        await describe('xor', async () => {
            await it('overlap region becomes transparent', async () => {
                const ctx = makeCtx();
                setupAndDraw(ctx, 'xor');
                // Overlap → transparent
                assertPixel(ctx, 15, 15, 0, 0, 0, 0);
                // Red-only zone
                assertPixel(ctx, 7, 7, 255, 0, 0, 255);
                // Green-only zone
                assertPixel(ctx, 22, 22, 0, 255, 0, 255);
            });
        });

        await describe('lighter (additive)', async () => {
            await it('overlap region sums red + green → yellow', async () => {
                const ctx = makeCtx();
                setupAndDraw(ctx, 'lighter');
                // Overlap: red 255 + green 255 = (255, 255, 0, 255) yellow
                assertPixel(ctx, 15, 15, 255, 255, 0, 255);
            });
        });
    });
};
