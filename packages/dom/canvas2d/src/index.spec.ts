// Canvas 2D context tests for GJS
// Ported from refs/node-canvas/test/ and refs/headless-gl/test/
// Original: BSD-2-Clause (headless-gl), MIT (node-canvas)
// Tests use @gjsify/unit and verify pixel output via getImageData.

import { describe, it, expect } from '@gjsify/unit';
import { HTMLCanvasElement } from '@gjsify/dom-elements';

// Import canvas2d to register the '2d' context factory
import '@gjsify/canvas2d';
import { CanvasRenderingContext2D, Path2D, ImageData, parseColor } from '@gjsify/canvas2d';

/** Helper: create a canvas with a 2D context. */
function createCanvas(width = 100, height = 100) {
    const canvas = new HTMLCanvasElement();
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
    return { canvas, ctx };
}

/** Helper: get pixel RGBA at (x, y). */
function getPixel(ctx: CanvasRenderingContext2D, x: number, y: number): [number, number, number, number] {
    const data = ctx.getImageData(x, y, 1, 1);
    return [data.data[0], data.data[1], data.data[2], data.data[3]];
}

export default async () => {

    // ---- Color parser ----

    await describe('parseColor', async () => {
        await it('should parse hex colors', async () => {
            const c = parseColor('#ff0000')!;
            expect(c.r).toBe(1);
            expect(c.g).toBe(0);
            expect(c.b).toBe(0);
            expect(c.a).toBe(1);
        });

        await it('should parse short hex', async () => {
            const c = parseColor('#f00')!;
            expect(c.r).toBe(1);
            expect(c.g).toBe(0);
            expect(c.b).toBe(0);
        });

        await it('should parse hex with alpha', async () => {
            const c = parseColor('#ff000080')!;
            expect(c.r).toBe(1);
            expect(c.a).toBeGreaterThan(0.49);
            expect(c.a).toBeLessThan(0.51);
        });

        await it('should parse rgb()', async () => {
            const c = parseColor('rgb(0, 128, 255)')!;
            expect(c.r).toBe(0);
            expect(c.g).toBeGreaterThan(0.49);
            expect(c.g).toBeLessThan(0.51);
            expect(c.b).toBe(1);
        });

        await it('should parse rgba()', async () => {
            const c = parseColor('rgba(255, 0, 0, 0.5)')!;
            expect(c.r).toBe(1);
            expect(c.a).toBe(0.5);
        });

        await it('should parse named colors', async () => {
            const c = parseColor('red')!;
            expect(c.r).toBe(1);
            expect(c.g).toBe(0);
            expect(c.b).toBe(0);
        });

        await it('should parse transparent', async () => {
            const c = parseColor('transparent')!;
            expect(c.a).toBe(0);
        });

        await it('should return null for invalid colors', async () => {
            expect(parseColor('notacolor')).toBeNull();
            expect(parseColor('')).toBeNull();
        });
    });

    // ---- Context creation ----

    await describe('Context creation', async () => {
        await it('should return a CanvasRenderingContext2D for "2d"', async () => {
            const { ctx } = createCanvas();
            expect(ctx).not.toBeNull();
            expect(ctx).toBeDefined();
        });

        await it('should return the same context on repeated calls', async () => {
            const canvas = new HTMLCanvasElement();
            canvas.width = 50;
            canvas.height = 50;
            const ctx1 = canvas.getContext('2d');
            const ctx2 = canvas.getContext('2d');
            expect(ctx1).toBe(ctx2);
        });

        await it('should have canvas reference', async () => {
            const { canvas, ctx } = createCanvas();
            expect(ctx.canvas).toBe(canvas);
        });
    });

    // ---- ImageData ----

    await describe('ImageData', async () => {
        await it('should create with width and height', async () => {
            const img = new ImageData(10, 20);
            expect(img.width).toBe(10);
            expect(img.height).toBe(20);
            expect(img.data.length).toBe(10 * 20 * 4);
        });

        await it('should create from existing data', async () => {
            const data = new Uint8ClampedArray(4 * 2 * 2);
            data[0] = 255; // first pixel R
            const img = new ImageData(data, 2, 2);
            expect(img.width).toBe(2);
            expect(img.height).toBe(2);
            expect(img.data[0]).toBe(255);
        });

        await it('should throw on mismatched data length', async () => {
            const data = new Uint8ClampedArray(10); // not a multiple of 4*width
            let threw = false;
            try {
                new ImageData(data, 3, 1);
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
        });
    });

    // ---- fillRect + getImageData pixel verification ----

    await describe('fillRect', async () => {
        await it('should fill a rectangle with solid color', async () => {
            const { ctx } = createCanvas(10, 10);
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 10, 10);
            const [r, g, b, a] = getPixel(ctx, 5, 5);
            expect(r).toBe(255);
            expect(g).toBe(0);
            expect(b).toBe(0);
            expect(a).toBe(255);
        });

        await it('should fill partial rectangle', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(5, 5, 10, 10);
            // Inside the rect
            const [, g1, , a1] = getPixel(ctx, 10, 10);
            expect(g1).toBe(255);
            expect(a1).toBe(255);
            // Outside the rect (should be transparent)
            const [, , , a2] = getPixel(ctx, 0, 0);
            expect(a2).toBe(0);
        });

        await it('should fill with rgba color', async () => {
            const { ctx } = createCanvas(10, 10);
            ctx.fillStyle = 'rgba(0, 0, 255, 0.5)';
            ctx.fillRect(0, 0, 10, 10);
            const [, g, , a] = getPixel(ctx, 5, 5);
            expect(g).toBe(0);
            // Alpha should be approximately 128 (0.5 * 255)
            expect(a).toBeGreaterThan(120);
            expect(a).toBeLessThan(140);
        });

        await it('should not affect the current path', async () => {
            // Regression: fillRect added a rectangle to the existing path.
            // Since fill() uses fillPreserve(), the preserved path was
            // repainted with fillRect's color.
            const { ctx } = createCanvas(40, 40);
            // Draw a red circle
            ctx.beginPath();
            ctx.arc(10, 10, 8, 0, Math.PI * 2);
            ctx.fillStyle = '#ff0000';
            ctx.fill();
            // fillRect with green in a different area — must not repaint the circle
            ctx.fillStyle = '#00ff00';
            ctx.fillRect(25, 25, 10, 10);
            // Circle should still be red, not green
            const [r, g, _b, a] = getPixel(ctx, 10, 10);
            expect(r).toBe(255);
            expect(g).toBe(0);
            expect(a).toBe(255);
            // Rectangle should be green
            const [r2, g2, _b2, a2] = getPixel(ctx, 30, 30);
            expect(r2).toBe(0);
            expect(g2).toBe(255);
            expect(a2).toBe(255);
        });
    });

    // ---- clearRect ----

    await describe('clearRect', async () => {
        await it('should clear a region to transparent', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 20, 20);
            ctx.clearRect(5, 5, 10, 10);
            // Inside cleared region
            const [_r, _g, _b, a] = getPixel(ctx, 10, 10);
            expect(a).toBe(0);
            // Outside cleared region (still red)
            const [r2, _g2, _b2, a2] = getPixel(ctx, 0, 0);
            expect(r2).toBe(255);
            expect(a2).toBe(255);
        });

        await it('should not affect the current path', async () => {
            // Regression: clearRect added a rectangle to the current path.
            // Per spec, clearRect must not affect the current path.
            const { ctx } = createCanvas(40, 40);
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(20, 20, 10, 0, Math.PI * 2);
            ctx.fill();
            // clearRect a different region — path should survive
            ctx.clearRect(0, 0, 5, 5);
            // Fill again with the preserved path — should still be a circle
            ctx.fillStyle = '#0000ff';
            ctx.fill();
            // Center of circle should now be blue
            const [r, _g, b, a] = getPixel(ctx, 20, 20);
            expect(r).toBe(0);
            expect(b).toBe(255);
            expect(a).toBe(255);
        });
    });

    // ---- strokeRect ----

    await describe('strokeRect', async () => {
        await it('should stroke a rectangle outline', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.strokeStyle = '#0000ff';
            ctx.lineWidth = 2;
            ctx.strokeRect(2, 2, 16, 16);
            // On the stroke border (top edge around y=2)
            const [_r, _g, b, a] = getPixel(ctx, 10, 2);
            expect(b).toBe(255);
            expect(a).toBe(255);
            // Center should be empty
            const [_r2, _g2, _b2, a2] = getPixel(ctx, 10, 10);
            expect(a2).toBe(0);
        });
    });

    // ---- Path operations ----

    await describe('Path operations', async () => {
        await it('should fill a triangle', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.fillStyle = '#00ff00';
            ctx.beginPath();
            ctx.moveTo(10, 0);
            ctx.lineTo(20, 20);
            ctx.lineTo(0, 20);
            ctx.closePath();
            ctx.fill();
            // Bottom center should be filled
            const [_r, g, _b, a] = getPixel(ctx, 10, 15);
            expect(g).toBe(255);
            expect(a).toBe(255);
        });

        await it('should fill a circle (arc)', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(10, 10, 8, 0, Math.PI * 2);
            ctx.fill();
            // Center should be filled
            const [r, _g, _b, a] = getPixel(ctx, 10, 10);
            expect(r).toBe(255);
            expect(a).toBe(255);
            // Corner should be empty
            const [_r2, _g2, _b2, a2] = getPixel(ctx, 0, 0);
            expect(a2).toBe(0);
        });

        await it('should fill a full circle with counterclockwise=true', async () => {
            // Regression: Cairo arcNegative(x,y,r,0,2π) normalizes endAngle to
            // startAngle, producing a zero-length arc. Browsers draw a full circle.
            const { ctx } = createCanvas(20, 20);
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.arc(10, 10, 8, 0, Math.PI * 2, true);
            ctx.fill();
            const [r, _g, _b, a] = getPixel(ctx, 10, 10);
            expect(r).toBe(255);
            expect(a).toBe(255);
        });

        await it('should fill a rectangle path', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.fillStyle = '#0000ff';
            ctx.beginPath();
            ctx.rect(2, 2, 16, 16);
            ctx.fill();
            const [_r, _g, b, a] = getPixel(ctx, 10, 10);
            expect(b).toBe(255);
            expect(a).toBe(255);
        });
    });

    // ---- Transforms ----

    await describe('Transforms', async () => {
        await it('should translate', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.fillStyle = '#ff0000';
            ctx.translate(5, 5);
            ctx.fillRect(0, 0, 5, 5);
            // The rect is drawn at (5,5) in device space
            const [r, _g, _b, a] = getPixel(ctx, 7, 7);
            expect(r).toBe(255);
            expect(a).toBe(255);
            // Origin should be empty
            const [_r2, _g2, _b2, a2] = getPixel(ctx, 0, 0);
            expect(a2).toBe(0);
        });

        await it('should scale', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.fillStyle = '#00ff00';
            ctx.scale(2, 2);
            ctx.fillRect(0, 0, 5, 5);
            // The rect is 10x10 in device space
            const [_r, g, _b, a] = getPixel(ctx, 9, 9);
            expect(g).toBe(255);
            expect(a).toBe(255);
        });

        await it('should resetTransform', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.translate(100, 100);
            ctx.resetTransform();
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 5, 5);
            const [r, _g, _b, a] = getPixel(ctx, 2, 2);
            expect(r).toBe(255);
            expect(a).toBe(255);
        });

        await it('should getTransform return identity by default', async () => {
            const { ctx } = createCanvas();
            const m = ctx.getTransform();
            expect(m.a).toBe(1);
            expect(m.b).toBe(0);
            expect(m.c).toBe(0);
            expect(m.d).toBe(1);
            expect(m.e).toBe(0);
            expect(m.f).toBe(0);
        });
    });

    // ---- save/restore ----

    await describe('save/restore', async () => {
        await it('should save and restore fillStyle', async () => {
            const { ctx } = createCanvas();
            ctx.fillStyle = '#ff0000';
            ctx.save();
            ctx.fillStyle = '#00ff00';
            expect(ctx.fillStyle).toBe('#00ff00');
            ctx.restore();
            expect(ctx.fillStyle).toBe('#ff0000');
        });

        await it('should save and restore lineWidth', async () => {
            const { ctx } = createCanvas();
            ctx.lineWidth = 5;
            ctx.save();
            ctx.lineWidth = 10;
            ctx.restore();
            expect(ctx.lineWidth).toBe(5);
        });

        await it('should save and restore globalAlpha', async () => {
            const { ctx } = createCanvas();
            ctx.globalAlpha = 0.5;
            ctx.save();
            ctx.globalAlpha = 1.0;
            ctx.restore();
            expect(ctx.globalAlpha).toBe(0.5);
        });

        await it('should save and restore transforms', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.translate(5, 5);
            ctx.save();
            ctx.translate(100, 100);
            ctx.restore();
            // After restore, translate(5,5) should still be in effect
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 5, 5);
            const [r, _g, _b, a] = getPixel(ctx, 7, 7);
            expect(r).toBe(255);
            expect(a).toBe(255);
        });
    });

    // ---- Line properties ----

    await describe('Line properties', async () => {
        await it('should set and get lineWidth', async () => {
            const { ctx } = createCanvas();
            ctx.lineWidth = 5;
            expect(ctx.lineWidth).toBe(5);
        });

        await it('should ignore invalid lineWidth', async () => {
            const { ctx } = createCanvas();
            ctx.lineWidth = 5;
            ctx.lineWidth = -1;
            expect(ctx.lineWidth).toBe(5);
            ctx.lineWidth = 0;
            expect(ctx.lineWidth).toBe(5);
            ctx.lineWidth = Infinity;
            expect(ctx.lineWidth).toBe(5);
        });

        await it('should set and get lineCap', async () => {
            const { ctx } = createCanvas();
            ctx.lineCap = 'round';
            expect(ctx.lineCap).toBe('round');
            ctx.lineCap = 'square';
            expect(ctx.lineCap).toBe('square');
            ctx.lineCap = 'butt';
            expect(ctx.lineCap).toBe('butt');
        });

        await it('should set and get lineJoin', async () => {
            const { ctx } = createCanvas();
            ctx.lineJoin = 'round';
            expect(ctx.lineJoin).toBe('round');
            ctx.lineJoin = 'bevel';
            expect(ctx.lineJoin).toBe('bevel');
        });

        await it('should set and get lineDash', async () => {
            const { ctx } = createCanvas();
            ctx.setLineDash([5, 10]);
            expect(ctx.getLineDash().length).toBe(2);
            expect(ctx.getLineDash()[0]).toBe(5);
            expect(ctx.getLineDash()[1]).toBe(10);
        });

        await it('should ignore negative lineDash values', async () => {
            const { ctx } = createCanvas();
            ctx.setLineDash([5, 10]);
            ctx.setLineDash([-1, 5]);
            // Should not have changed
            expect(ctx.getLineDash()[0]).toBe(5);
        });
    });

    // ---- globalAlpha ----

    await describe('globalAlpha', async () => {
        await it('should affect fill opacity', async () => {
            const { ctx } = createCanvas(10, 10);
            ctx.globalAlpha = 0.5;
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 10, 10);
            const [, , , a] = getPixel(ctx, 5, 5);
            // Alpha should be approximately 128
            expect(a).toBeGreaterThan(120);
            expect(a).toBeLessThan(140);
        });

        await it('should reject invalid values', async () => {
            const { ctx } = createCanvas();
            ctx.globalAlpha = 0.5;
            ctx.globalAlpha = -0.1;
            expect(ctx.globalAlpha).toBe(0.5);
            ctx.globalAlpha = 1.1;
            expect(ctx.globalAlpha).toBe(0.5);
        });
    });

    // ---- globalCompositeOperation ----

    await describe('globalCompositeOperation', async () => {
        await it('should default to source-over', async () => {
            const { ctx } = createCanvas();
            expect(ctx.globalCompositeOperation).toBe('source-over');
        });

        await it('should accept valid operations', async () => {
            const { ctx } = createCanvas();
            const ops = ['source-over', 'source-in', 'source-out', 'source-atop',
                'destination-over', 'destination-in', 'destination-out', 'destination-atop',
                'lighter', 'copy', 'xor', 'multiply', 'screen', 'overlay',
                'darken', 'lighten', 'color-dodge', 'color-burn',
                'hard-light', 'soft-light', 'difference', 'exclusion',
                'hue', 'saturation', 'color', 'luminosity'];
            for (const op of ops) {
                ctx.globalCompositeOperation = op as GlobalCompositeOperation;
                expect(ctx.globalCompositeOperation).toBe(op);
            }
        });

        await it('copy should replace destination', async () => {
            const { ctx } = createCanvas(10, 10);
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 10, 10);
            ctx.globalCompositeOperation = 'copy';
            ctx.fillStyle = 'rgba(0, 255, 0, 0.5)';
            ctx.fillRect(0, 0, 10, 10);
            const [r, g, _b, a] = getPixel(ctx, 5, 5);
            // Red should be gone (copy replaces)
            expect(r).toBe(0);
            expect(g).toBeGreaterThan(0);
            expect(a).toBeGreaterThan(120);
            expect(a).toBeLessThan(140);
        });
    });

    // ---- Gradients ----

    await describe('Gradients', async () => {
        await it('should create a linear gradient', async () => {
            const { ctx } = createCanvas(20, 10);
            const grad = ctx.createLinearGradient(0, 0, 20, 0);
            grad.addColorStop(0, '#ff0000');
            grad.addColorStop(1, '#0000ff');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 20, 10);
            // Left should be red-ish
            const [r1, _g1, b1] = getPixel(ctx, 1, 5);
            expect(r1).toBeGreaterThan(200);
            expect(b1).toBeLessThan(50);
            // Right should be blue-ish
            const [r2, _g2, b2] = getPixel(ctx, 18, 5);
            expect(r2).toBeLessThan(50);
            expect(b2).toBeGreaterThan(200);
        });

        await it('should create a radial gradient', async () => {
            const { ctx } = createCanvas(20, 20);
            const grad = ctx.createRadialGradient(10, 10, 0, 10, 10, 10);
            grad.addColorStop(0, '#ffffff');
            grad.addColorStop(1, '#000000');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, 20, 20);
            // Center should be bright
            const [r1] = getPixel(ctx, 10, 10);
            expect(r1).toBeGreaterThan(200);
            // Edge should be dark
            const [r2] = getPixel(ctx, 19, 10);
            expect(r2).toBeLessThan(50);
        });
    });

    // ---- getImageData / putImageData round-trip ----

    await describe('getImageData / putImageData', async () => {
        await it('should round-trip pixel data', async () => {
            const { ctx } = createCanvas(10, 10);
            ctx.fillStyle = '#ff8000';
            ctx.fillRect(0, 0, 10, 10);
            const imageData = ctx.getImageData(0, 0, 10, 10);
            expect(imageData.width).toBe(10);
            expect(imageData.height).toBe(10);
            // Check orange pixel
            expect(imageData.data[0]).toBe(255); // R
            expect(imageData.data[1]).toBeGreaterThan(120); // G (~128)
            expect(imageData.data[2]).toBe(0);   // B
            expect(imageData.data[3]).toBe(255);  // A

            // Clear and put it back
            ctx.clearRect(0, 0, 10, 10);
            ctx.putImageData(imageData, 0, 0);
            const [r, , , a] = getPixel(ctx, 5, 5);
            expect(r).toBe(255);
            expect(a).toBe(255);
        });

        await it('should createImageData with correct dimensions', async () => {
            const { ctx } = createCanvas();
            const img = ctx.createImageData(5, 3);
            expect(img.width).toBe(5);
            expect(img.height).toBe(3);
            expect(img.data.length).toBe(5 * 3 * 4);
            // Should be all zeros (transparent black)
            expect(img.data[0]).toBe(0);
        });
    });

    // ---- Path2D ----

    await describe('Path2D', async () => {
        await it('should create and fill a Path2D rectangle', async () => {
            const { ctx } = createCanvas(20, 20);
            const path = new Path2D();
            path.rect(2, 2, 16, 16);
            ctx.fillStyle = '#ff0000';
            ctx.fill(path);
            const [r, _g, _b, a] = getPixel(ctx, 10, 10);
            expect(r).toBe(255);
            expect(a).toBe(255);
        });

        await it('should stroke a Path2D', async () => {
            const { ctx } = createCanvas(20, 20);
            const path = new Path2D();
            path.moveTo(0, 10);
            path.lineTo(20, 10);
            ctx.strokeStyle = '#00ff00';
            ctx.lineWidth = 2;
            ctx.stroke(path);
            const [_r, g, _b, a] = getPixel(ctx, 10, 10);
            expect(g).toBe(255);
            expect(a).toBe(255);
        });

        await it('should copy a Path2D', async () => {
            const path1 = new Path2D();
            path1.rect(0, 0, 10, 10);
            const path2 = new Path2D(path1);
            // path2 should have the same ops
            expect(path2._ops.length).toBe(path1._ops.length);
        });

        await it('should addPath', async () => {
            const path1 = new Path2D();
            path1.rect(0, 0, 5, 5);
            const path2 = new Path2D();
            path2.rect(10, 10, 5, 5);
            path1.addPath(path2);
            expect(path1._ops.length).toBe(2);
        });
    });

    // ---- Clipping ----

    await describe('Clipping', async () => {
        await it('should clip to a rectangular region', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.beginPath();
            ctx.rect(5, 5, 10, 10);
            ctx.clip();
            ctx.fillStyle = '#ff0000';
            ctx.fillRect(0, 0, 20, 20);
            // Inside clip → filled
            const [r, _g, _b, a] = getPixel(ctx, 10, 10);
            expect(r).toBe(255);
            expect(a).toBe(255);
            // Outside clip → transparent
            const [_r2, _g2, _b2, a2] = getPixel(ctx, 0, 0);
            expect(a2).toBe(0);
        });
    });

    // ---- Text ----

    await describe('Text', async () => {
        await it('should measureText return non-zero width', async () => {
            const { ctx } = createCanvas();
            ctx.font = '16px sans-serif';
            const m = ctx.measureText('Hello World');
            expect(m.width).toBeGreaterThan(0);
        });

        await it('should measureText empty string return 0 width', async () => {
            const { ctx } = createCanvas();
            const m = ctx.measureText('');
            expect(m.width).toBe(0);
        });

        await it('should fillText produce visible pixels', async () => {
            const { ctx } = createCanvas(100, 30);
            ctx.fillStyle = '#000000';
            ctx.font = '20px sans-serif';
            ctx.fillText('X', 10, 20);
            // Check around the area where the text should be
            const imageData = ctx.getImageData(0, 0, 100, 30);
            let nonZeroPixels = 0;
            for (let i = 3; i < imageData.data.length; i += 4) {
                if (imageData.data[i] > 0) nonZeroPixels++;
            }
            expect(nonZeroPixels).toBeGreaterThan(0);
        });

        await it('should set and get font', async () => {
            const { ctx } = createCanvas();
            ctx.font = 'bold 20px Arial';
            expect(ctx.font).toBe('bold 20px Arial');
        });

        await it('should set and get textAlign', async () => {
            const { ctx } = createCanvas();
            ctx.textAlign = 'center';
            expect(ctx.textAlign).toBe('center');
            ctx.textAlign = 'right';
            expect(ctx.textAlign).toBe('right');
        });

        await it('should set and get textBaseline', async () => {
            const { ctx } = createCanvas();
            ctx.textBaseline = 'top';
            expect(ctx.textBaseline).toBe('top');
            ctx.textBaseline = 'middle';
            expect(ctx.textBaseline).toBe('middle');
        });
    });

    // ---- Hit testing ----

    await describe('Hit testing', async () => {
        await it('should detect point in rectangular path', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.beginPath();
            ctx.rect(5, 5, 10, 10);
            expect(ctx.isPointInPath(10, 10)).toBe(true);
            expect(ctx.isPointInPath(0, 0)).toBe(false);
        });

        await it('should detect point in stroke', async () => {
            const { ctx } = createCanvas(20, 20);
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(0, 10);
            ctx.lineTo(20, 10);
            expect(ctx.isPointInStroke(10, 10)).toBe(true);
            expect(ctx.isPointInStroke(10, 0)).toBe(false);
        });

        await it('should detect point in Path2D', async () => {
            const { ctx } = createCanvas(20, 20);
            const path = new Path2D();
            path.rect(5, 5, 10, 10);
            expect(ctx.isPointInPath(path, 10, 10)).toBe(true);
            expect(ctx.isPointInPath(path, 0, 0)).toBe(false);
        });
    });

    // ---- Shadow properties ----

    await describe('Shadow properties', async () => {
        await it('should set and get shadow properties', async () => {
            const { ctx } = createCanvas();
            ctx.shadowColor = 'rgba(0, 0, 0, 0.5)';
            expect(ctx.shadowColor).toBe('rgba(0, 0, 0, 0.5)');
            ctx.shadowBlur = 10;
            expect(ctx.shadowBlur).toBe(10);
            ctx.shadowOffsetX = 5;
            expect(ctx.shadowOffsetX).toBe(5);
            ctx.shadowOffsetY = 3;
            expect(ctx.shadowOffsetY).toBe(3);
        });

        await it('should reject negative shadowBlur', async () => {
            const { ctx } = createCanvas();
            ctx.shadowBlur = 5;
            ctx.shadowBlur = -1;
            expect(ctx.shadowBlur).toBe(5);
        });
    });

    // ---- Ellipse and roundRect ----

    await describe('Ellipse and roundRect', async () => {
        await it('should fill an ellipse', async () => {
            const { ctx } = createCanvas(30, 20);
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.ellipse(15, 10, 12, 8, 0, 0, Math.PI * 2);
            ctx.fill();
            const [r, _g, _b, a] = getPixel(ctx, 15, 10);
            expect(r).toBe(255);
            expect(a).toBe(255);
        });

        await it('should throw on negative ellipse radii', async () => {
            const { ctx } = createCanvas();
            let threw = false;
            try {
                ctx.ellipse(10, 10, -5, 5, 0, 0, Math.PI * 2);
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
        });

        await it('should fill a roundRect', async () => {
            const { ctx } = createCanvas(30, 30);
            ctx.fillStyle = '#0000ff';
            ctx.beginPath();
            ctx.roundRect(2, 2, 26, 26, 5);
            ctx.fill();
            const [_r, _g, b, a] = getPixel(ctx, 15, 15);
            expect(b).toBe(255);
            expect(a).toBe(255);
        });
    });

    // ---- imageSmoothingEnabled ----

    await describe('imageSmoothingEnabled', async () => {
        await it('should default to true', async () => {
            const { ctx } = createCanvas();
            expect(ctx.imageSmoothingEnabled).toBe(true);
        });

        await it('should be settable', async () => {
            const { ctx } = createCanvas();
            ctx.imageSmoothingEnabled = false;
            expect(ctx.imageSmoothingEnabled).toBe(false);
        });
    });
};
