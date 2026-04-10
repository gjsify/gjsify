// Canvas 2D clearRect tests — verifies the Cairo.Operator.CLEAR path
// correctly clears the specified rectangle regardless of transform,
// clip, globalAlpha, and globalCompositeOperation.
//
// Ported from refs/wpt/html/canvas/element/drawing-rectangles-to-the-canvas/
//   2d.clearRect.{basic,transform,clip,globalalpha,globalcomposite,
//   negative,path,nonfinite}.html
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
    x: number,
    y: number,
    r: number, g: number, b: number, a: number,
): void {
    const data = ctx.getImageData(x, y, 1, 1).data;
    expect(data[0]).toBe(r);
    expect(data[1]).toBe(g);
    expect(data[2]).toBe(b);
    expect(data[3]).toBe(a);
}

export default async () => {
    await describe('CanvasRenderingContext2D — clearRect', async () => {

        await it('clears a red-filled canvas to transparent black', async () => {
            const ctx = makeCtx(20, 20);
            ctx.fillStyle = 'rgb(255, 0, 0)';
            ctx.fillRect(0, 0, 20, 20);
            assertPixel(ctx, 10, 10, 255, 0, 0, 255);
            ctx.clearRect(0, 0, 20, 20);
            assertPixel(ctx, 10, 10, 0, 0, 0, 0);
        });

        await it('clears only the specified sub-rectangle', async () => {
            const ctx = makeCtx(20, 20);
            ctx.fillStyle = 'rgb(0, 0, 255)';
            ctx.fillRect(0, 0, 20, 20);
            ctx.clearRect(5, 5, 10, 10);
            // Inside cleared region
            assertPixel(ctx, 10, 10, 0, 0, 0, 0);
            // Outside cleared region — still blue
            assertPixel(ctx, 2, 2, 0, 0, 255, 255);
            assertPixel(ctx, 17, 17, 0, 0, 255, 255);
        });

        await it('clearRect is transformed by the current matrix', async () => {
            const ctx = makeCtx(30, 30);
            ctx.fillStyle = 'rgb(0, 255, 0)';
            ctx.fillRect(0, 0, 30, 30);
            ctx.translate(10, 10);
            ctx.clearRect(0, 0, 5, 5);
            // The cleared region is at (10,10)-(15,15) in canvas coords
            assertPixel(ctx, 12, 12, 0, 0, 0, 0);
            // Pixel just outside the cleared region — still green
            assertPixel(ctx, 16, 16, 0, 255, 0, 255);
        });

        await it('clearRect ignores globalAlpha (spec: always 0)', async () => {
            const ctx = makeCtx(20, 20);
            ctx.fillStyle = 'red';
            ctx.fillRect(0, 0, 20, 20);
            ctx.globalAlpha = 0.5;
            ctx.clearRect(0, 0, 20, 20);
            // Spec: clearRect completely clears, globalAlpha is ignored
            assertPixel(ctx, 10, 10, 0, 0, 0, 0);
        });

        await it('clearRect ignores globalCompositeOperation (spec: always CLEAR)', async () => {
            const ctx = makeCtx(20, 20);
            ctx.fillStyle = 'red';
            ctx.fillRect(0, 0, 20, 20);
            ctx.globalCompositeOperation = 'xor';
            ctx.clearRect(0, 0, 20, 20);
            // Spec: clearRect uses CLEAR operator regardless of
            // globalCompositeOperation
            assertPixel(ctx, 10, 10, 0, 0, 0, 0);
        });

        await it('clearRect with negative width clears the normalized region', async () => {
            const ctx = makeCtx(20, 20);
            ctx.fillStyle = 'rgb(255, 255, 0)';
            ctx.fillRect(0, 0, 20, 20);
            // clearRect(15, 5, -10, 10) ≡ clearRect(5, 5, 10, 10)
            ctx.clearRect(15, 5, -10, 10);
            assertPixel(ctx, 10, 10, 0, 0, 0, 0);
            assertPixel(ctx, 2, 2, 255, 255, 0, 255);
        });

        await it('clearRect restricted by a clip region', async () => {
            const ctx = makeCtx(30, 30);
            ctx.fillStyle = 'rgb(255, 0, 255)';
            ctx.fillRect(0, 0, 30, 30);
            // Clip to a 10×10 box starting at (10,10)
            ctx.beginPath();
            ctx.rect(10, 10, 10, 10);
            ctx.clip();
            // Try to clear the full canvas — only the clipped region should
            // actually be cleared.
            ctx.clearRect(0, 0, 30, 30);
            // Inside clip → cleared
            assertPixel(ctx, 15, 15, 0, 0, 0, 0);
            // Outside clip → still filled
            assertPixel(ctx, 5, 5, 255, 0, 255, 255);
            assertPixel(ctx, 25, 25, 255, 0, 255, 255);
        });

        await it('clearRect with zero width is a no-op', async () => {
            const ctx = makeCtx(20, 20);
            ctx.fillStyle = 'rgb(128, 128, 128)';
            ctx.fillRect(0, 0, 20, 20);
            ctx.clearRect(5, 5, 0, 10);
            // Nothing cleared — pixel still grey
            assertPixel(ctx, 10, 10, 128, 128, 128, 255);
        });
    });
};
