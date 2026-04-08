// Canvas 2D ImageData tests — createImageData, getImageData, putImageData
// round-trip. Verifies pixel extraction from Cairo surfaces and the
// RGBA byte order expected by consumers.
//
// Ported from refs/wpt/html/canvas/element/pixel-manipulation/
//   2d.imageData.{create1.basic,create2.{basic,initial},get.{order.rgb,
//   source.negative,source.outside},put.basic.rgba,put.alpha,put.dirty*}.html
// Original: Copyright (c) Web Platform Tests contributors. 3-Clause BSD.
// Reimplemented for GJS using @gjsify/canvas2d-core + @gjsify/unit.

import { describe, it, expect } from '@gjsify/unit';
import { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';

function makeCtx(width = 20, height = 20): CanvasRenderingContext2D {
    const canvas = { width, height };
    return new CanvasRenderingContext2D(canvas);
}

export default async () => {
    await describe('CanvasRenderingContext2D — ImageData', async () => {

        await describe('createImageData', async () => {
            await it('createImageData(w, h) returns an RGBA Uint8ClampedArray of w*h*4 bytes', async () => {
                const ctx = makeCtx();
                const img = ctx.createImageData(10, 5);
                expect(img.width).toBe(10);
                expect(img.height).toBe(5);
                expect(img.data.length).toBe(10 * 5 * 4);
            });

            await it('createImageData data is initialized to transparent black', async () => {
                const ctx = makeCtx();
                const img = ctx.createImageData(4, 4);
                for (let i = 0; i < img.data.length; i++) {
                    expect(img.data[i]).toBe(0);
                }
            });

            await it('createImageData(imageData) returns a clone with matching dimensions', async () => {
                const ctx = makeCtx();
                const src = ctx.createImageData(8, 3);
                const clone = ctx.createImageData(src);
                expect(clone.width).toBe(8);
                expect(clone.height).toBe(3);
                expect(clone.data.length).toBe(8 * 3 * 4);
            });
        });

        await describe('getImageData', async () => {
            await it('returns correct RGBA for a filled region', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(200, 100, 50)';
                ctx.fillRect(0, 0, 10, 10);
                const data = ctx.getImageData(5, 5, 1, 1).data;
                expect(data[0]).toBe(200);
                expect(data[1]).toBe(100);
                expect(data[2]).toBe(50);
                expect(data[3]).toBe(255);
            });

            await it('returns a full RGBA grid for a multi-pixel region', async () => {
                const ctx = makeCtx(4, 4);
                ctx.fillStyle = 'rgb(10, 20, 30)';
                ctx.fillRect(0, 0, 4, 4);
                const img = ctx.getImageData(0, 0, 4, 4);
                expect(img.width).toBe(4);
                expect(img.height).toBe(4);
                expect(img.data.length).toBe(4 * 4 * 4);
                // All 16 pixels should be (10, 20, 30, 255)
                for (let i = 0; i < 16; i++) {
                    expect(img.data[i * 4 + 0]).toBe(10);
                    expect(img.data[i * 4 + 1]).toBe(20);
                    expect(img.data[i * 4 + 2]).toBe(30);
                    expect(img.data[i * 4 + 3]).toBe(255);
                }
            });

            await it('preserves byte order across fillStyle color channels', async () => {
                const ctx = makeCtx(3, 1);
                ctx.fillStyle = 'rgb(255, 0, 0)';
                ctx.fillRect(0, 0, 1, 1);
                ctx.fillStyle = 'rgb(0, 255, 0)';
                ctx.fillRect(1, 0, 1, 1);
                ctx.fillStyle = 'rgb(0, 0, 255)';
                ctx.fillRect(2, 0, 1, 1);
                const data = ctx.getImageData(0, 0, 3, 1).data;
                // Pixel 0: red
                expect(data[0]).toBe(255);
                expect(data[1]).toBe(0);
                expect(data[2]).toBe(0);
                // Pixel 1: green
                expect(data[4]).toBe(0);
                expect(data[5]).toBe(255);
                expect(data[6]).toBe(0);
                // Pixel 2: blue
                expect(data[8]).toBe(0);
                expect(data[9]).toBe(0);
                expect(data[10]).toBe(255);
            });
        });

        await describe('putImageData', async () => {
            await it('roundtrips get → put → get unchanged', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(77, 88, 99)';
                ctx.fillRect(0, 0, 10, 10);
                const first = ctx.getImageData(0, 0, 10, 10);
                ctx.clearRect(0, 0, 10, 10);
                ctx.putImageData(first, 0, 0);
                const second = ctx.getImageData(5, 5, 1, 1).data;
                expect(second[0]).toBe(77);
                expect(second[1]).toBe(88);
                expect(second[2]).toBe(99);
                expect(second[3]).toBe(255);
            });

            await it('putImageData ignores globalAlpha (spec)', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(100, 100, 100)';
                ctx.fillRect(0, 0, 10, 10);
                const src = ctx.getImageData(0, 0, 10, 10);
                ctx.clearRect(0, 0, 10, 10);
                ctx.globalAlpha = 0.1;
                ctx.putImageData(src, 0, 0);
                // putImageData writes raw pixels — globalAlpha has no effect.
                const after = ctx.getImageData(5, 5, 1, 1).data;
                expect(after[0]).toBe(100);
                expect(after[3]).toBe(255);
            });

            await it('putImageData ignores globalCompositeOperation (spec: always SOURCE)', async () => {
                const ctx = makeCtx(10, 10);
                ctx.fillStyle = 'rgb(0, 255, 0)';
                ctx.fillRect(0, 0, 10, 10);
                const src = ctx.getImageData(0, 0, 10, 10);
                // Re-fill the canvas with red, then putImageData the green data
                // under a non-default composite.
                ctx.fillStyle = 'rgb(255, 0, 0)';
                ctx.fillRect(0, 0, 10, 10);
                ctx.globalCompositeOperation = 'destination-over';
                ctx.putImageData(src, 0, 0);
                // Spec: putImageData uses SOURCE → green replaces red.
                const data = ctx.getImageData(5, 5, 1, 1).data;
                expect(data[0]).toBe(0);
                expect(data[1]).toBe(255);
                expect(data[2]).toBe(0);
            });
        });
    });
};
