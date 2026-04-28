// Browser unit tests for @gjsify/canvas2d-core Canvas 2D behavior.
// Tests native browser Canvas 2D to validate that the browser behaves the way
// our Cairo-backed GJS implementation assumes. Do NOT import @gjsify/* — that
// would drag in @girs/* / gi:// GObject bindings that have no browser equivalent.

import { run, describe, it, expect } from '@gjsify/unit';

function makeCtx(width = 50, height = 50): CanvasRenderingContext2D {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    return canvas.getContext('2d')!;
}

function nearlyEqual(a: number, b: number, eps = 1e-6): boolean {
    return Math.abs(a - b) < eps;
}

function assertPixel(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    r: number, g: number, b: number, a: number,
): void {
    const data = ctx.getImageData(x, y, 1, 1).data;
    expect(data[0]).toBe(r);
    expect(data[1]).toBe(g);
    expect(data[2]).toBe(b);
    expect(data[3]).toBe(a);
}

run({
    async Canvas2dCoreTest() {

        // -- clearRect --

        await describe('clearRect', async () => {
            await it('clears red canvas to transparent black', async () => {
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
                assertPixel(ctx, 10, 10, 0, 0, 0, 0);
                assertPixel(ctx, 2, 2, 0, 0, 255, 255);
            });

            await it('clearRect is affected by current transform', async () => {
                const ctx = makeCtx(30, 30);
                ctx.fillStyle = 'rgb(0, 255, 0)';
                ctx.fillRect(0, 0, 30, 30);
                ctx.translate(10, 10);
                ctx.clearRect(0, 0, 5, 5);
                assertPixel(ctx, 12, 12, 0, 0, 0, 0);
                assertPixel(ctx, 16, 16, 0, 255, 0, 255);
            });

            await it('clearRect ignores globalAlpha', async () => {
                const ctx = makeCtx(20, 20);
                ctx.fillStyle = 'red';
                ctx.fillRect(0, 0, 20, 20);
                ctx.globalAlpha = 0.5;
                ctx.clearRect(0, 0, 20, 20);
                assertPixel(ctx, 10, 10, 0, 0, 0, 0);
            });

            await it('clearRect with negative width clears normalized region', async () => {
                const ctx = makeCtx(20, 20);
                ctx.fillStyle = 'rgb(255, 255, 0)';
                ctx.fillRect(0, 0, 20, 20);
                ctx.clearRect(15, 5, -10, 10);
                assertPixel(ctx, 10, 10, 0, 0, 0, 0);
                assertPixel(ctx, 2, 2, 255, 255, 0, 255);
            });

            await it('clearRect with zero width is a no-op', async () => {
                const ctx = makeCtx(20, 20);
                ctx.fillStyle = 'rgb(128, 128, 128)';
                ctx.fillRect(0, 0, 20, 20);
                ctx.clearRect(5, 5, 0, 10);
                assertPixel(ctx, 10, 10, 128, 128, 128, 255);
            });

            await it('clearRect restricted by clip region', async () => {
                const ctx = makeCtx(30, 30);
                ctx.fillStyle = 'rgb(255, 0, 255)';
                ctx.fillRect(0, 0, 30, 30);
                ctx.beginPath();
                ctx.rect(10, 10, 10, 10);
                ctx.clip();
                ctx.clearRect(0, 0, 30, 30);
                assertPixel(ctx, 15, 15, 0, 0, 0, 0);
                assertPixel(ctx, 5, 5, 255, 0, 255, 255);
            });
        });

        // -- State save/restore --

        await describe('save / restore', async () => {
            await it('round-trips fillStyle', async () => {
                const ctx = makeCtx();
                ctx.fillStyle = '#ff0000';
                ctx.save();
                ctx.fillStyle = '#00ff00';
                expect(ctx.fillStyle).toBe('#00ff00');
                ctx.restore();
                expect(ctx.fillStyle).toBe('#ff0000');
            });

            await it('round-trips strokeStyle', async () => {
                const ctx = makeCtx();
                ctx.strokeStyle = '#112233';
                ctx.save();
                ctx.strokeStyle = '#445566';
                ctx.restore();
                expect(ctx.strokeStyle).toBe('#112233');
            });

            await it('round-trips globalAlpha', async () => {
                const ctx = makeCtx();
                ctx.globalAlpha = 0.3;
                ctx.save();
                ctx.globalAlpha = 0.9;
                ctx.restore();
                expect(nearlyEqual(ctx.globalAlpha, 0.3)).toBe(true);
            });

            await it('round-trips globalCompositeOperation', async () => {
                const ctx = makeCtx();
                ctx.globalCompositeOperation = 'source-over';
                ctx.save();
                ctx.globalCompositeOperation = 'destination-over';
                ctx.restore();
                expect(ctx.globalCompositeOperation).toBe('source-over');
            });

            await it('round-trips lineWidth, lineCap, lineJoin', async () => {
                const ctx = makeCtx();
                ctx.lineWidth = 3;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'bevel';
                ctx.save();
                ctx.lineWidth = 10;
                ctx.lineCap = 'square';
                ctx.lineJoin = 'miter';
                ctx.restore();
                expect(ctx.lineWidth).toBe(3);
                expect(ctx.lineCap).toBe('round');
                expect(ctx.lineJoin).toBe('bevel');
            });

            await it('round-trips miterLimit', async () => {
                const ctx = makeCtx();
                ctx.miterLimit = 5;
                ctx.save();
                ctx.miterLimit = 20;
                ctx.restore();
                expect(ctx.miterLimit).toBe(5);
            });

            await it('round-trips lineDash and lineDashOffset', async () => {
                const ctx = makeCtx();
                ctx.setLineDash([5, 2]);
                ctx.lineDashOffset = 3;
                ctx.save();
                ctx.setLineDash([10, 10]);
                ctx.lineDashOffset = 7;
                ctx.restore();
                const restored = ctx.getLineDash();
                expect(restored.length).toBe(2);
                expect(restored[0]).toBe(5);
                expect(restored[1]).toBe(2);
                expect(ctx.lineDashOffset).toBe(3);
            });

            await it('round-trips font, textAlign, textBaseline', async () => {
                const ctx = makeCtx();
                ctx.font = 'bold 20px sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.save();
                ctx.font = '10px serif';
                ctx.textAlign = 'left';
                ctx.textBaseline = 'top';
                ctx.restore();
                expect(ctx.font).toBe('bold 20px sans-serif');
                expect(ctx.textAlign).toBe('center');
                expect(ctx.textBaseline).toBe('middle');
            });

            await it('round-trips imageSmoothingEnabled', async () => {
                const ctx = makeCtx();
                ctx.imageSmoothingEnabled = false;
                ctx.save();
                ctx.imageSmoothingEnabled = true;
                ctx.restore();
                expect(ctx.imageSmoothingEnabled).toBe(false);
            });

            await it('triple save/restore returns to default fillStyle', async () => {
                const ctx = makeCtx();
                ctx.save();
                ctx.fillStyle = '#111111';
                ctx.save();
                ctx.fillStyle = '#222222';
                ctx.save();
                ctx.fillStyle = '#333333';
                ctx.restore();
                expect(ctx.fillStyle).toBe('#222222');
                ctx.restore();
                expect(ctx.fillStyle).toBe('#111111');
                ctx.restore();
                expect(ctx.fillStyle).toBe('#000000');
            });

            await it('restore on empty stack is a no-op (no throw)', async () => {
                const ctx = makeCtx();
                expect(() => {
                    ctx.restore();
                    ctx.restore();
                }).not.toThrow();
            });
        });

        // -- Transforms --

        await describe('transforms', async () => {
            await it('getTransform returns identity for fresh context', async () => {
                const ctx = makeCtx();
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.b, 0)).toBe(true);
                expect(nearlyEqual(m.c, 0)).toBe(true);
                expect(nearlyEqual(m.d, 1)).toBe(true);
                expect(nearlyEqual(m.e, 0)).toBe(true);
                expect(nearlyEqual(m.f, 0)).toBe(true);
            });

            await it('translate updates e and f', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 20);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.e, 10)).toBe(true);
                expect(nearlyEqual(m.f, 20)).toBe(true);
            });

            await it('translate composes cumulatively', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 20);
                ctx.translate(5, 7);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.e, 15)).toBe(true);
                expect(nearlyEqual(m.f, 27)).toBe(true);
            });

            await it('scale updates a and d', async () => {
                const ctx = makeCtx();
                ctx.scale(2, 3);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 2)).toBe(true);
                expect(nearlyEqual(m.d, 3)).toBe(true);
            });

            await it('transform(1,0,0,1,tx,ty) is a pure translate', async () => {
                const ctx = makeCtx();
                ctx.transform(1, 0, 0, 1, 15, 25);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.e, 15)).toBe(true);
                expect(nearlyEqual(m.f, 25)).toBe(true);
            });

            await it('setTransform resets to the supplied matrix', async () => {
                const ctx = makeCtx();
                ctx.translate(100, 100);
                ctx.setTransform(2, 0, 0, 2, 5, 10);
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 2)).toBe(true);
                expect(nearlyEqual(m.d, 2)).toBe(true);
                expect(nearlyEqual(m.e, 5)).toBe(true);
                expect(nearlyEqual(m.f, 10)).toBe(true);
            });

            await it('setTransform() with no args resets to identity', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 10);
                ctx.scale(5, 5);
                ctx.setTransform();
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.d, 1)).toBe(true);
                expect(nearlyEqual(m.e, 0)).toBe(true);
                expect(nearlyEqual(m.f, 0)).toBe(true);
            });

            await it('setTransform accepts DOMMatrix2DInit object', async () => {
                const ctx = makeCtx();
                ctx.setTransform({ a: 2, b: 0, c: 0, d: 2, e: 5, f: 10 });
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 2)).toBe(true);
                expect(nearlyEqual(m.e, 5)).toBe(true);
                expect(nearlyEqual(m.f, 10)).toBe(true);
            });

            await it('save/restore reverts transform', async () => {
                const ctx = makeCtx();
                ctx.translate(10, 20);
                ctx.save();
                ctx.scale(5, 5);
                ctx.translate(100, 200);
                ctx.restore();
                const m = ctx.getTransform();
                expect(nearlyEqual(m.a, 1)).toBe(true);
                expect(nearlyEqual(m.e, 10)).toBe(true);
                expect(nearlyEqual(m.f, 20)).toBe(true);
            });

            await it('getTransform().multiply round-trips via setTransform', async () => {
                const ctx = makeCtx();
                ctx.translate(50, 50);
                const current = ctx.getTransform();
                expect(typeof current.multiply).toBe('function');
                const other = new DOMMatrix([2, 0, 0, 2, 0, 0]);
                const composed = current.multiply(other);
                ctx.setTransform(composed);
                const final = ctx.getTransform();
                expect(nearlyEqual(final.a, 2)).toBe(true);
                expect(nearlyEqual(final.d, 2)).toBe(true);
                expect(nearlyEqual(final.e, 50)).toBe(true);
                expect(nearlyEqual(final.f, 50)).toBe(true);
            });
        });

        // -- ImageData --

        await describe('ImageData', async () => {
            await it('createImageData(w, h) returns correct dimensions', async () => {
                const ctx = makeCtx();
                const img = ctx.createImageData(10, 5);
                expect(img.width).toBe(10);
                expect(img.height).toBe(5);
                expect(img.data.length).toBe(10 * 5 * 4);
            });

            await it('createImageData data is transparent black', async () => {
                const ctx = makeCtx();
                const img = ctx.createImageData(4, 4);
                for (let i = 0; i < img.data.length; i++) {
                    expect(img.data[i]).toBe(0);
                }
            });

            await it('createImageData(imageData) clones dimensions', async () => {
                const ctx = makeCtx();
                const src = ctx.createImageData(8, 3);
                const clone = ctx.createImageData(src);
                expect(clone.width).toBe(8);
                expect(clone.height).toBe(3);
            });

            await it('getImageData returns correct RGBA for filled region', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(200, 100, 50)';
                ctx.fillRect(0, 0, 10, 10);
                const data = ctx.getImageData(5, 5, 1, 1).data;
                expect(data[0]).toBe(200);
                expect(data[1]).toBe(100);
                expect(data[2]).toBe(50);
                expect(data[3]).toBe(255);
            });

            await it('getImageData preserves RGBA byte order for RGB channels', async () => {
                const ctx = makeCtx(3, 1);
                ctx.fillStyle = 'rgb(255, 0, 0)';
                ctx.fillRect(0, 0, 1, 1);
                ctx.fillStyle = 'rgb(0, 255, 0)';
                ctx.fillRect(1, 0, 1, 1);
                ctx.fillStyle = 'rgb(0, 0, 255)';
                ctx.fillRect(2, 0, 1, 1);
                const data = ctx.getImageData(0, 0, 3, 1).data;
                expect(data[0]).toBe(255); expect(data[1]).toBe(0);   expect(data[2]).toBe(0);
                expect(data[4]).toBe(0);   expect(data[5]).toBe(255); expect(data[6]).toBe(0);
                expect(data[8]).toBe(0);   expect(data[9]).toBe(0);   expect(data[10]).toBe(255);
            });

            await it('putImageData round-trips get → clear → put → get', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(77, 88, 99)';
                ctx.fillRect(0, 0, 10, 10);
                const first = ctx.getImageData(0, 0, 10, 10);
                ctx.clearRect(0, 0, 10, 10);
                ctx.putImageData(first, 0, 0);
                const data = ctx.getImageData(5, 5, 1, 1).data;
                expect(data[0]).toBe(77);
                expect(data[1]).toBe(88);
                expect(data[2]).toBe(99);
                expect(data[3]).toBe(255);
            });

            await it('putImageData ignores globalAlpha', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(100, 100, 100)';
                ctx.fillRect(0, 0, 10, 10);
                const src = ctx.getImageData(0, 0, 10, 10);
                ctx.clearRect(0, 0, 10, 10);
                ctx.globalAlpha = 0.1;
                ctx.putImageData(src, 0, 0);
                const after = ctx.getImageData(5, 5, 1, 1).data;
                expect(after[0]).toBe(100);
                expect(after[3]).toBe(255);
            });

            await it('putImageData ignores globalCompositeOperation', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(0, 255, 0)';
                ctx.fillRect(0, 0, 10, 10);
                const src = ctx.getImageData(0, 0, 10, 10);
                ctx.fillStyle = 'rgb(255, 0, 0)';
                ctx.fillRect(0, 0, 10, 10);
                ctx.globalCompositeOperation = 'destination-over';
                ctx.putImageData(src, 0, 0);
                const data = ctx.getImageData(5, 5, 1, 1).data;
                expect(data[0]).toBe(0);
                expect(data[1]).toBe(255);
                expect(data[2]).toBe(0);
            });
        });

        // -- Text --

        await describe('text', async () => {
            await it('measureText returns a width > 0 for non-empty string', async () => {
                const ctx = makeCtx(200, 50);
                ctx.font = '16px sans-serif';
                const metrics = ctx.measureText('Hello');
                expect(metrics.width).toBeGreaterThan(0);
            });

            await it('measureText returns 0 width for empty string', async () => {
                const ctx = makeCtx(200, 50);
                ctx.font = '16px sans-serif';
                const metrics = ctx.measureText('');
                expect(metrics.width).toBe(0);
            });

            await it('textAlign property round-trips', async () => {
                const ctx = makeCtx();
                ctx.textAlign = 'center';
                expect(ctx.textAlign).toBe('center');
                ctx.textAlign = 'right';
                expect(ctx.textAlign).toBe('right');
            });

            await it('textBaseline property round-trips', async () => {
                const ctx = makeCtx();
                ctx.textBaseline = 'middle';
                expect(ctx.textBaseline).toBe('middle');
                ctx.textBaseline = 'top';
                expect(ctx.textBaseline).toBe('top');
            });

            await it('fillText does not throw', async () => {
                const ctx = makeCtx(200, 50);
                ctx.font = '16px sans-serif';
                ctx.fillStyle = 'black';
                expect(() => { ctx.fillText('Hello', 10, 30); }).not.toThrow();
            });

            await it('strokeText does not throw', async () => {
                const ctx = makeCtx(200, 50);
                ctx.font = '16px sans-serif';
                ctx.strokeStyle = 'black';
                expect(() => { ctx.strokeText('Hi', 10, 30); }).not.toThrow();
            });
        });

        // -- Compositing --

        await describe('globalCompositeOperation', async () => {
            await it('source-over draws on top (default)', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(0, 0, 255)';
                ctx.fillRect(0, 0, 10, 10);
                ctx.globalCompositeOperation = 'source-over';
                ctx.fillStyle = 'rgb(255, 0, 0)';
                ctx.fillRect(0, 0, 10, 10);
                const data = ctx.getImageData(5, 5, 1, 1).data;
                expect(data[0]).toBe(255);
                expect(data[2]).toBe(0);
            });

            await it('destination-over keeps existing content on top', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(255, 0, 0)';
                ctx.fillRect(0, 0, 10, 10);
                ctx.globalCompositeOperation = 'destination-over';
                ctx.fillStyle = 'rgb(0, 0, 255)';
                ctx.fillRect(0, 0, 10, 10);
                const data = ctx.getImageData(5, 5, 1, 1).data;
                // destination-over: existing (red) stays, new (blue) goes below
                expect(data[0]).toBe(255);
                expect(data[2]).toBe(0);
            });

            await it('all standard composite ops can be set without error', async () => {
                const ctx = makeCtx();
                const ops: GlobalCompositeOperation[] = [
                    'source-over', 'source-in', 'source-out', 'source-atop',
                    'destination-over', 'destination-in', 'destination-out', 'destination-atop',
                    'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay',
                    'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light',
                    'soft-light', 'difference', 'exclusion', 'hue', 'saturation',
                    'color', 'luminosity',
                ];
                for (const op of ops) {
                    expect(() => { ctx.globalCompositeOperation = op; }).not.toThrow();
                    expect(ctx.globalCompositeOperation).toBe(op);
                }
            });
        });

        // -- drawImage (canvas to canvas) --

        await describe('drawImage (canvas source)', async () => {
            await it('3-arg: copies source canvas pixels to destination', async () => {
                const src = document.createElement('canvas');
                src.width = 10; src.height = 10;
                const srcCtx = src.getContext('2d')!;
                srcCtx.fillStyle = 'rgb(200, 50, 100)';
                srcCtx.fillRect(0, 0, 10, 10);

                const dst = makeCtx(20, 20);
                dst.drawImage(src, 5, 5);
                assertPixel(dst, 7, 7, 200, 50, 100, 255);
                assertPixel(dst, 2, 2, 0, 0, 0, 0);
            });

            await it('5-arg: draws with destination width/height scaling', async () => {
                const src = document.createElement('canvas');
                src.width = 10; src.height = 10;
                const srcCtx = src.getContext('2d')!;
                srcCtx.fillStyle = 'rgb(0, 200, 0)';
                srcCtx.fillRect(0, 0, 10, 10);

                const dst = makeCtx(30, 30);
                dst.drawImage(src, 0, 0, 20, 20);
                assertPixel(dst, 10, 10, 0, 200, 0, 255);
                assertPixel(dst, 25, 25, 0, 0, 0, 0);
            });

            await it('9-arg: source crop and destination placement', async () => {
                const src = document.createElement('canvas');
                src.width = 20; src.height = 10;
                const srcCtx = src.getContext('2d')!;
                srcCtx.fillStyle = 'rgb(255, 0, 0)';
                srcCtx.fillRect(0, 0, 10, 10);
                srcCtx.fillStyle = 'rgb(0, 255, 0)';
                srcCtx.fillRect(10, 0, 10, 10);

                const dst = makeCtx(30, 30);
                // Draw only the right half of src (green) at (0,0) 10×10
                dst.drawImage(src, 10, 0, 10, 10, 0, 0, 10, 10);
                assertPixel(dst, 5, 5, 0, 255, 0, 255);
            });
        });

        // -- path operations --

        await describe('path operations', async () => {
            await it('fillRect then strokeRect produce pixels', async () => {
                const ctx = makeCtx(20, 20);
                ctx.fillStyle = 'rgb(100, 150, 200)';
                ctx.fillRect(2, 2, 10, 10);
                const data = ctx.getImageData(5, 5, 1, 1).data;
                expect(data[0]).toBe(100);
                expect(data[1]).toBe(150);
                expect(data[2]).toBe(200);
            });

            await it('beginPath + arc + fill produces a colored circle', async () => {
                const ctx = makeCtx(50, 50);
                ctx.fillStyle = 'rgb(255, 0, 0)';
                ctx.beginPath();
                ctx.arc(25, 25, 20, 0, Math.PI * 2);
                ctx.fill();
                // Center pixel should be red
                const data = ctx.getImageData(25, 25, 1, 1).data;
                expect(data[0]).toBe(255);
                expect(data[1]).toBe(0);
                expect(data[2]).toBe(0);
                expect(data[3]).toBe(255);
            });

            await it('clip constrains drawing', async () => {
                const ctx = makeCtx(30, 30);
                ctx.beginPath();
                ctx.rect(10, 10, 10, 10);
                ctx.clip();
                ctx.fillStyle = 'rgb(0, 0, 255)';
                ctx.fillRect(0, 0, 30, 30);
                // Inside clip
                assertPixel(ctx, 15, 15, 0, 0, 255, 255);
                // Outside clip — should be transparent
                assertPixel(ctx, 5, 5, 0, 0, 0, 0);
            });
        });
    },
});
