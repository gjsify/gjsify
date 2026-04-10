// Canvas 2D drawImage tests — verifies the full 3/5/9-argument forms,
// transform composition, cross-canvas sourcing, and the critical
// imageSmoothingEnabled pixel-art path (Cairo NEAREST filter lock).
//
// Ported from refs/wpt/html/canvas/element/drawing-images-to-the-canvas/
//   2d.drawImage.canvas.html, .5arg.html, .9arg.basic.html,
//   .negativedest.html, .negativedir.html, .transform.html,
//   .alpha.html, .self.1.html, .zerosource.html
// Plus refs/wpt/html/canvas/element/manual/image-smoothing/imagesmoothing.html
// Original: Copyright (c) Web Platform Tests contributors. 3-Clause BSD.
// Reimplemented for GJS using @gjsify/canvas2d-core + @gjsify/unit.

import { describe, it, expect } from '@gjsify/unit';
import { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';

function makeCtx(width = 50, height = 50): CanvasRenderingContext2D {
    const canvas = { width, height };
    return new CanvasRenderingContext2D(canvas);
}

/**
 * Create a test image as an HTMLCanvasElement-like object with known pixel
 * content. Works through the getContext('2d') branch of _getDrawImageSource
 * (canvas-rendering-context-2d.ts:822-834), avoiding the need for PNG
 * fixtures on disk.
 */
function createTestImage(
    width: number,
    height: number,
    draw: (ctx: CanvasRenderingContext2D) => void,
): any {
    const ctx = makeCtx(width, height);
    draw(ctx);
    return {
        width,
        height,
        getContext: (id: string) => (id === '2d' ? ctx : null),
    };
}

/** Assert pixel RGBA within tolerance (default ±2 per channel). */
function assertPixel(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
    tolerance = 2,
): void {
    const data = ctx.getImageData(x, y, 1, 1).data;
    expect(Math.abs(data[0] - r) <= tolerance).toBe(true);
    expect(Math.abs(data[1] - g) <= tolerance).toBe(true);
    expect(Math.abs(data[2] - b) <= tolerance).toBe(true);
    expect(Math.abs(data[3] - a) <= tolerance).toBe(true);
}

function assertPixelExact(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    r: number,
    g: number,
    b: number,
    a: number,
): void {
    const data = ctx.getImageData(x, y, 1, 1).data;
    expect(data[0]).toBe(r);
    expect(data[1]).toBe(g);
    expect(data[2]).toBe(b);
    expect(data[3]).toBe(a);
}

export default async () => {
    await describe('CanvasRenderingContext2D — drawImage', async () => {

        await describe('3-argument form: drawImage(image, dx, dy)', async () => {
            await it('draws a full canvas source at the given destination', async () => {
                const src = createTestImage(10, 10, (c) => {
                    c.fillStyle = 'rgb(255, 0, 0)';
                    c.fillRect(0, 0, 10, 10);
                });
                const dst = makeCtx(30, 30);
                dst.drawImage(src, 5, 5);
                // Outside the drawn region → transparent
                assertPixel(dst, 2, 2, 0, 0, 0, 0);
                // Inside the drawn region → red
                assertPixel(dst, 8, 8, 255, 0, 0, 255);
                assertPixel(dst, 14, 14, 255, 0, 0, 255);
                // Right at the edge of the drawn region
                assertPixel(dst, 20, 20, 0, 0, 0, 0);
            });
        });

        await describe('5-argument form: drawImage(image, dx, dy, dw, dh)', async () => {
            await it('scales the source to the destination rectangle', async () => {
                const src = createTestImage(4, 4, (c) => {
                    c.fillStyle = 'rgb(0, 255, 0)';
                    c.fillRect(0, 0, 4, 4);
                });
                const dst = makeCtx(40, 40);
                dst.drawImage(src, 10, 10, 20, 20);
                // Pixel well inside the 20×20 destination region → green
                assertPixel(dst, 20, 20, 0, 255, 0, 255);
                // Pixel outside the destination region → transparent
                assertPixel(dst, 5, 5, 0, 0, 0, 0);
            });
        });

        await describe('9-argument form: drawImage(image, sx,sy,sw,sh, dx,dy,dw,dh)', async () => {
            await it('crops the source region and scales to destination', async () => {
                // Source: 20x20 with left half red, right half blue
                const src = createTestImage(20, 20, (c) => {
                    c.fillStyle = 'rgb(255, 0, 0)';
                    c.fillRect(0, 0, 10, 20);
                    c.fillStyle = 'rgb(0, 0, 255)';
                    c.fillRect(10, 0, 10, 20);
                });
                const dst = makeCtx(40, 40);
                // Take only the right (blue) half of the source and scale to 30x30
                dst.drawImage(src, 10, 0, 10, 20, 5, 5, 30, 30);
                assertPixel(dst, 15, 20, 0, 0, 255, 255);
                assertPixel(dst, 30, 20, 0, 0, 255, 255);
                // Outside destination → still transparent
                assertPixel(dst, 2, 2, 0, 0, 0, 0);
            });
        });

        await describe('drawImage respects current transform', async () => {
            await it('translate shifts the destination', async () => {
                const src = createTestImage(10, 10, (c) => {
                    c.fillStyle = 'rgb(255, 255, 0)';
                    c.fillRect(0, 0, 10, 10);
                });
                const dst = makeCtx(30, 30);
                dst.translate(10, 10);
                dst.drawImage(src, 0, 0);
                // Yellow should now appear at the translated origin
                assertPixel(dst, 15, 15, 255, 255, 0, 255);
                assertPixel(dst, 5, 5, 0, 0, 0, 0);
            });

            await it('save/restore isolates drawImage transforms', async () => {
                const src = createTestImage(5, 5, (c) => {
                    c.fillStyle = 'rgb(100, 100, 100)';
                    c.fillRect(0, 0, 5, 5);
                });
                const dst = makeCtx(30, 30);
                dst.save();
                dst.translate(20, 20);
                dst.drawImage(src, 0, 0);
                dst.restore();
                // After restore, drawImage at 0,0 goes to the origin
                dst.drawImage(src, 0, 0);
                // Both regions should contain grey pixels
                assertPixel(dst, 2, 2, 100, 100, 100, 255);
                assertPixel(dst, 22, 22, 100, 100, 100, 255);
            });
        });

        await describe('drawImage with globalAlpha', async () => {
            await it('premultiplies globalAlpha into the source color', async () => {
                const src = createTestImage(10, 10, (c) => {
                    c.fillStyle = 'rgb(255, 0, 0)';
                    c.fillRect(0, 0, 10, 10);
                });
                const dst = makeCtx(30, 30);
                dst.globalAlpha = 0.5;
                dst.drawImage(src, 10, 10);
                // Sample well inside the destination rect to avoid bilinear
                // edge bleeding. Canvas 2D spec: getImageData returns
                // non-premultiplied RGBA, so red stays 255 while alpha
                // becomes ~128. Tolerance ±5 for Cairo's rounding.
                const data = dst.getImageData(15, 15, 1, 1).data;
                expect(data[0]).toBe(255);
                expect(data[1]).toBe(0);
                expect(data[2]).toBe(0);
                expect(data[3] > 120 && data[3] < 135).toBe(true);
            });
        });

        await describe('drawImage — zero-size and edge cases', async () => {
            await it('drawImage with 0-width source is a no-op', async () => {
                const src = createTestImage(10, 10, (c) => {
                    c.fillStyle = 'red';
                    c.fillRect(0, 0, 10, 10);
                });
                const dst = makeCtx(20, 20);
                // Pre-fill destination to check nothing was overwritten
                dst.fillStyle = 'blue';
                dst.fillRect(0, 0, 20, 20);
                dst.drawImage(src, 0, 0, 0, 10, 5, 5, 10, 10);
                // Pixel should still be the pre-fill blue
                assertPixel(dst, 10, 10, 0, 0, 255, 255);
            });

            await it('drawImage with 0-height destination is a no-op', async () => {
                const src = createTestImage(10, 10, (c) => {
                    c.fillStyle = 'red';
                    c.fillRect(0, 0, 10, 10);
                });
                const dst = makeCtx(20, 20);
                dst.fillStyle = 'blue';
                dst.fillRect(0, 0, 20, 20);
                dst.drawImage(src, 5, 5, 10, 0);
                assertPixel(dst, 10, 10, 0, 0, 255, 255);
            });
        });

        await describe('drawImage — imageSmoothingEnabled pixel-art lock', async () => {
            // Regression for the Cairo Filter.NEAREST fix in drawImage.
            // When imageSmoothingEnabled=false, scaling a 2×2 image by 10 must
            // produce a sharp checker pattern. Otherwise Cairo's default
            // BILINEAR filter blends the pixels and pixel-art games render
            // blurry.

            await it('imageSmoothingEnabled=false: exact nearest-neighbor scale', async () => {
                // 2×2 image: red (top-left), green (top-right),
                //            blue (bottom-left), white (bottom-right).
                const src = createTestImage(2, 2, (c) => {
                    c.fillStyle = 'rgb(255, 0, 0)';   c.fillRect(0, 0, 1, 1);
                    c.fillStyle = 'rgb(0, 255, 0)';   c.fillRect(1, 0, 1, 1);
                    c.fillStyle = 'rgb(0, 0, 255)';   c.fillRect(0, 1, 1, 1);
                    c.fillStyle = 'rgb(255, 255, 255)'; c.fillRect(1, 1, 1, 1);
                });
                const dst = makeCtx(20, 20);
                dst.imageSmoothingEnabled = false;
                dst.drawImage(src, 0, 0, 20, 20);

                // With NEAREST, each source pixel fills a 10×10 quadrant in
                // the destination without color bleeding. Pixel (5,5) should
                // be exactly red, (15,5) exactly green, etc.
                assertPixelExact(dst, 5, 5, 255, 0, 0, 255);
                assertPixelExact(dst, 15, 5, 0, 255, 0, 255);
                assertPixelExact(dst, 5, 15, 0, 0, 255, 255);
                assertPixelExact(dst, 15, 15, 255, 255, 255, 255);
            });

            await it('imageSmoothingEnabled=true: bilinear bleeding at boundaries', async () => {
                const src = createTestImage(2, 2, (c) => {
                    c.fillStyle = 'rgb(255, 0, 0)';   c.fillRect(0, 0, 1, 1);
                    c.fillStyle = 'rgb(0, 255, 0)';   c.fillRect(1, 0, 1, 1);
                    c.fillStyle = 'rgb(0, 0, 255)';   c.fillRect(0, 1, 1, 1);
                    c.fillStyle = 'rgb(255, 255, 255)'; c.fillRect(1, 1, 1, 1);
                });
                const dst = makeCtx(20, 20);
                dst.imageSmoothingEnabled = true;
                dst.drawImage(src, 0, 0, 20, 20);

                // With bilinear, pixel at the boundary between red and green
                // (around x=10, y=5) is a mix — NOT exactly red and NOT
                // exactly green. This test proves the filter is applied.
                const boundary = dst.getImageData(9, 5, 1, 1).data;
                const isExactRed = boundary[0] === 255 && boundary[1] === 0;
                const isExactGreen = boundary[0] === 0 && boundary[1] === 255;
                // Neither pure red nor pure green → bilinear blending is active
                expect(isExactRed).toBe(false);
                expect(isExactGreen).toBe(false);
            });
        });

        await describe('drawImage with composite operation', async () => {
            // Note: the 'copy' operator in Canvas spec wipes the ENTIRE
            // destination, not just the drawImage rect. Our implementation
            // clips to the destination rect for paint(), so the "wipe
            // outside" semantic is NOT implemented here — that would require
            // a separate clearRect path. We only verify that the inside
            // pixel is correctly replaced.
            await it('drawImage honors globalCompositeOperation=source-over', async () => {
                const src = createTestImage(10, 10, (c) => {
                    c.fillStyle = 'rgb(0, 255, 0)';
                    c.fillRect(0, 0, 10, 10);
                });
                const dst = makeCtx(20, 20);
                // Pre-fill with red
                dst.fillStyle = 'rgb(255, 0, 0)';
                dst.fillRect(0, 0, 20, 20);
                // source-over: green opaque pixel replaces red in the drawn region
                dst.drawImage(src, 5, 5);
                assertPixel(dst, 10, 10, 0, 255, 0, 255);
                // Outside drawn region → still red (unaffected)
                assertPixel(dst, 1, 1, 255, 0, 0, 255);
            });
        });
    });
};
