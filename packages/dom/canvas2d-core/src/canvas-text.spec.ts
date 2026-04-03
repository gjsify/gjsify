// Canvas 2D text rendering tests — baseline positioning and alignment
// Reference: refs/wpt/html/canvas/element/text/2d.text.draw.baseline.*.html
// Ported from W3C WPT canvas text tests (3-Clause BSD, web-platform-tests contributors)
// Reimplemented for GJS using PangoCairo (no DOM, no font face loading)

import { describe, it, expect } from '@gjsify/unit';
import { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';

// --- Helpers ---

/**
 * Create a minimal canvas mock + context for testing.
 * CanvasRenderingContext2D only needs canvas.width / canvas.height.
 */
function makeCtx(width: number, height: number): CanvasRenderingContext2D {
    const canvas = { width, height };
    return new CanvasRenderingContext2D(canvas);
}

/**
 * Find the first and last row (y-coordinate) that contains at least one
 * "green" pixel (G > 128, R < 64, B < 64) in the given ImageData.
 * Returns { first: -1, last: -1 } when no green pixel is found.
 */
function findGreenRowBounds(data: Uint8ClampedArray, width: number, height: number) {
    let first = -1;
    let last = -1;
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const i = (y * width + x) * 4;
            if (data[i + 1] > 128 && data[i] < 64 && data[i + 2] < 64) {
                if (first === -1) first = y;
                last = y;
                break;
            }
        }
    }
    return { first, last };
}

/**
 * Draw text on a background-filled canvas and return the bounding rows of the
 * rendered text pixels.
 *
 * @param baseline CSS textBaseline value
 * @param yCoord   The y argument passed to fillText
 * @param width    Canvas width
 * @param height   Canvas height
 */
function drawAndMeasure(
    baseline: CanvasTextBaseline,
    yCoord: number,
    width = 300,
    height = 100,
) {
    const ctx = makeCtx(width, height);

    // Red background
    ctx.fillStyle = '#f00';
    ctx.fillRect(0, 0, width, height);

    // Green text — use a wide string to guarantee pixels across multiple columns
    ctx.fillStyle = '#0f0';
    ctx.font = '24px sans-serif';
    ctx.textBaseline = baseline;
    ctx.textAlign = 'left';
    ctx.fillText('XXXXXXX', 0, yCoord);

    const imageData = ctx.getImageData(0, 0, width, height);
    return findGreenRowBounds(imageData.data, width, height);
}

// --- Tests ---

export default async () => {

    await describe('CanvasRenderingContext2D.fillText — textBaseline positioning', async () => {

        // textBaseline='top': text top edge is at the provided y coordinate.
        // With y=5, the first green row must appear near y=5 (within ±8px).
        await it("textBaseline='top': text starts near y", async () => {
            const { first, last } = drawAndMeasure('top', 5);
            expect(first).toBeGreaterThan(-1); // text was rendered
            expect(first).toBeLessThan(15);    // top edge close to y=5
            expect(last).toBeGreaterThan(first); // text has height
        });

        // textBaseline='bottom': text bottom edge is at y. With y=95 on a 100px canvas,
        // the last green row must appear near y=95 (within ±8px).
        await it("textBaseline='bottom': text ends near y", async () => {
            const { first, last } = drawAndMeasure('bottom', 95, 300, 100);
            expect(last).toBeGreaterThan(-1);  // text was rendered
            expect(last).toBeGreaterThan(85);  // bottom edge close to y=95
            expect(first).toBeLessThan(last);  // text has height
        });

        // textBaseline='middle': the vertical midpoint of the text is at y.
        // With y=50 on a 100px canvas, text must span across the center:
        // first green row < 50 AND last green row > 50.
        await it("textBaseline='middle': text is centered on y", async () => {
            const { first, last } = drawAndMeasure('middle', 50, 300, 100);
            expect(first).toBeGreaterThan(-1);
            expect(first).toBeLessThan(50);    // text extends above center
            expect(last).toBeGreaterThan(50);  // text extends below center
        });

        // textBaseline='alphabetic': the baseline (a reference Latin line) is at y.
        // Ascent extends above y, descent extends below.
        // With y=50 on a 100px canvas:
        //   - first green row < 50 (ascent above baseline)
        //   - last green row > 50  (descent below baseline — use 'g' which has a descender)
        await it("textBaseline='alphabetic': baseline is at y, ascent above, descent below", async () => {
            // Use text with descenders (g, p, q, y) so pixels extend below the baseline.
            const canvas = { width: 300, height: 100 };
            const ctx = new CanvasRenderingContext2D(canvas);
            ctx.fillStyle = '#f00';
            ctx.fillRect(0, 0, 300, 100);
            ctx.fillStyle = '#0f0';
            ctx.font = '24px sans-serif';
            ctx.textBaseline = 'alphabetic';
            ctx.textAlign = 'left';
            ctx.fillText('Xgpqy', 0, 50); // descenders ensure pixels below baseline
            const imageData = ctx.getImageData(0, 0, 300, 100);
            const { first, last } = findGreenRowBounds(imageData.data, 300, 100);
            expect(first).toBeGreaterThan(-1);
            expect(first).toBeLessThan(50);    // text extends above y
            expect(last).toBeGreaterThan(50);  // descent below y
        });

        // textBaseline='hanging': the hanging baseline is at y (used for Devanagari etc.).
        // Approximates the top of the cap height (~0.8 * ascent below the em-square top).
        // Most of the text should extend BELOW y, with very little above.
        await it("textBaseline='hanging': text mostly extends below y", async () => {
            const { first, last } = drawAndMeasure('hanging', 5, 300, 100);
            expect(first).toBeGreaterThan(-1);
            // Text should start near y=5; because hanging ≈ 0.2*ascent from top,
            // first green row should be within 10px of y=5.
            expect(first).toBeLessThan(20);
            expect(last).toBeGreaterThan(first);
        });

        // textBaseline='ideographic': ideographic baseline is at y.
        // Below the alphabetic baseline; the bulk of text is ABOVE y.
        await it("textBaseline='ideographic': most text is above y", async () => {
            const { first, last } = drawAndMeasure('ideographic', 70, 300, 100);
            expect(first).toBeGreaterThan(-1);
            expect(first).toBeLessThan(70);  // text extends above y
            // last may be ≥ 70 (descent below ideographic line) or ≤ 70
            expect(last).toBeGreaterThan(first);
        });

        // Regression: 'top' at y=0 should NOT be far below y=0.
        // Before fix, yOff = +ascent pushed text ~20px too low (wrong).
        await it("textBaseline='top' regression: first pixel is near y=0, not shifted down by ascent", async () => {
            const { first } = drawAndMeasure('top', 0, 300, 80);
            // Before fix: first ≈ 18+ (shifted by ascent). After fix: first ≈ 0-3.
            expect(first).toBeLessThan(8);
        });

        // Regression: 'alphabetic' at y=40 should put text above AND below y=40.
        // Before fix, yOff=0 put the layout TOP at y=40, so all text was below y=40.
        await it("textBaseline='alphabetic' regression: text extends above y, not only below", async () => {
            const { first } = drawAndMeasure('alphabetic', 40, 300, 80);
            expect(first).toBeLessThan(40);  // ascent extends above y=40
        });

        // Regression: 'middle' at y=40 with 24px font → text spans ~28..52
        // Before fix: yOff = ascent - height/2 ≈ +10, so layout top at ~50, text at 50..74
        //             → first ≈ 50, which is NOT less than 40.
        await it("textBaseline='middle' regression: text straddles y, not shifted below y", async () => {
            const { first } = drawAndMeasure('middle', 40, 300, 80);
            expect(first).toBeLessThan(40);
        });
    });

    await describe('CanvasRenderingContext2D.fillText — textAlign positioning', async () => {

        await it("textAlign='center': text is centered on x", async () => {
            const width = 200;
            const height = 60;
            const ctx = makeCtx(width, height);
            ctx.fillStyle = '#f00';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#0f0';
            ctx.font = '20px sans-serif';
            ctx.textBaseline = 'top';
            ctx.textAlign = 'center';
            ctx.fillText('XX', width / 2, 0);

            const imageData = ctx.getImageData(0, 0, width, height);
            // Find leftmost and rightmost green column
            let leftCol = -1, rightCol = -1;
            for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    const i = (y * width + x) * 4;
                    if (imageData.data[i + 1] > 128 && imageData.data[i] < 64 && imageData.data[i + 2] < 64) {
                        if (leftCol === -1) leftCol = x;
                        rightCol = x;
                        break;
                    }
                }
            }
            expect(leftCol).toBeGreaterThan(-1);
            // Text should be roughly centered: left and right distances from center should be similar
            const distLeft = width / 2 - leftCol;
            const distRight = rightCol - width / 2;
            // Both sides should have roughly equal extent (within 20px)
            expect(Math.abs(distLeft - distRight)).toBeLessThan(20);
        });

        await it("textAlign='left': text starts at x", async () => {
            const width = 200;
            const height = 60;
            const ctx = makeCtx(width, height);
            ctx.fillStyle = '#f00';
            ctx.fillRect(0, 0, width, height);
            ctx.fillStyle = '#0f0';
            ctx.font = '20px sans-serif';
            ctx.textBaseline = 'top';
            ctx.textAlign = 'left';
            ctx.fillText('XX', 20, 0);

            const imageData = ctx.getImageData(0, 0, width, height);
            let leftCol = -1;
            outer: for (let x = 0; x < width; x++) {
                for (let y = 0; y < height; y++) {
                    const i = (y * width + x) * 4;
                    if (imageData.data[i + 1] > 128 && imageData.data[i] < 64 && imageData.data[i + 2] < 64) {
                        leftCol = x;
                        break outer;
                    }
                }
            }
            // leftmost green pixel should be near x=20
            expect(leftCol).toBeGreaterThan(-1);
            expect(leftCol).toBeGreaterThan(14);
            expect(leftCol).toBeLessThan(30);
        });
    });
};
