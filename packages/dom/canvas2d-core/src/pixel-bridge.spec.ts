// Contract tests for the pixel-interop seam (`./pixel-bridge.ts`).
//
// The seam exists so the headless core never imports `gi://Gdk` (see the
// module header + AGENTS.md `packages/dom/` table). These tests are the
// regression guard for that: they swap in a recording bridge and assert that
// EVERY pixel-touching Canvas 2D method routes through it. A future edit that
// reaches for `Gdk.*` directly again would leave one of these counters at 0.
//
// Original: @gjsify/canvas2d-core seam contract, written against @gjsify/unit.

import { describe, it, expect } from '@gjsify/unit';

import { CanvasRenderingContext2D } from './canvas-rendering-context-2d.js';
import {
    type CanvasImageHandle,
    type CanvasPixelBridge,
    getCanvasPixelBridge,
    hasCanvasPixelBridge,
    setCanvasPixelBridge,
} from './pixel-bridge.js';

function makeCtx(width = 20, height = 20): CanvasRenderingContext2D {
    return new CanvasRenderingContext2D({ width, height });
}

/** An HTMLCanvasElement-shaped source backed by a real 2D context. */
function makeCanvasSource(width: number, height: number, fill: string) {
    const ctx = makeCtx(width, height);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, width, height);
    return {
        width,
        height,
        getContext: (id: string) => (id === '2d' ? ctx : null),
    };
}

interface Calls {
    imageFromSurface: number;
    setSourceImage: number;
    setSourcePixels: number;
}

/**
 * Wrap the registered bridge in a counting decorator. Delegating (rather than
 * stubbing) keeps the rendering results real, so these tests assert routing
 * without weakening the pixel assertions the other suites make.
 */
function withRecordingBridge<T>(body: (calls: Calls) => T): T {
    const inner = getCanvasPixelBridge();
    const calls: Calls = { imageFromSurface: 0, setSourceImage: 0, setSourcePixels: 0 };
    const recorder: CanvasPixelBridge = {
        imageFromSurface(surface, srcX, srcY, width, height): CanvasImageHandle | null {
            calls.imageFromSurface++;
            return inner.imageFromSurface(surface, srcX, srcY, width, height);
        },
        setSourceImage(cr, image, x, y): void {
            calls.setSourceImage++;
            inner.setSourceImage(cr, image, x, y);
        },
        setSourcePixels(cr, rgba, width, height, x, y): void {
            calls.setSourcePixels++;
            inner.setSourcePixels(cr, rgba, width, height, x, y);
        },
    };

    setCanvasPixelBridge(recorder);
    try {
        return body(calls);
    } finally {
        setCanvasPixelBridge(inner);
    }
}

export default async () => {
    await describe('CanvasPixelBridge — registry', async () => {
        await it('reports a registered bridge', async () => {
            expect(hasCanvasPixelBridge()).toBe(true);
        });

        await it('setCanvasPixelBridge replaces the active implementation', async () => {
            const previous = getCanvasPixelBridge();
            withRecordingBridge(() => {
                expect(getCanvasPixelBridge() === previous).toBe(false);
            });
            expect(getCanvasPixelBridge() === previous).toBe(true);
        });
    });

    await describe('CanvasPixelBridge — every pixel op routes through the seam', async () => {
        await it('getImageData reads the surface via imageFromSurface', async () => {
            withRecordingBridge((calls) => {
                const ctx = makeCtx();
                ctx.fillStyle = 'rgb(10, 20, 30)';
                ctx.fillRect(0, 0, 20, 20);
                const data = ctx.getImageData(0, 0, 2, 2).data;

                expect(calls.imageFromSurface).toBe(1);
                // Delegation preserved the real pixels.
                expect(data[0]).toBe(10);
                expect(data[1]).toBe(20);
                expect(data[2]).toBe(30);
                expect(data[3]).toBe(255);
            });
        });

        await it('putImageData writes through setSourcePixels', async () => {
            withRecordingBridge((calls) => {
                const ctx = makeCtx();
                const image = ctx.createImageData(2, 2);
                for (let i = 0; i < image.data.length; i += 4) {
                    image.data[i] = 200;
                    image.data[i + 1] = 100;
                    image.data[i + 2] = 50;
                    image.data[i + 3] = 255;
                }
                ctx.putImageData(image, 0, 0);

                expect(calls.setSourcePixels).toBe(1);

                const roundTrip = ctx.getImageData(0, 0, 1, 1).data;
                expect(roundTrip[0]).toBe(200);
                expect(roundTrip[1]).toBe(100);
                expect(roundTrip[2]).toBe(50);
            });
        });

        await it('drawImage(canvas) snapshots the source and installs it as the Cairo source', async () => {
            withRecordingBridge((calls) => {
                const ctx = makeCtx();
                ctx.drawImage(makeCanvasSource(4, 4, 'rgb(0, 255, 0)'), 0, 0);

                // Source surface snapshot + source install.
                expect(calls.imageFromSurface).toBe(1);
                expect(calls.setSourceImage).toBe(1);
            });
        });

        await it('createPattern(canvas) stays on the pure-Cairo surface→surface path', async () => {
            withRecordingBridge((calls) => {
                const ctx = makeCtx();
                const pattern = ctx.createPattern(makeCanvasSource(4, 4, 'rgb(0, 0, 255)'), 'repeat');

                expect(pattern).toBeTruthy();
                // The canvas branch copies surface→surface with Cairo's own
                // setSourceSurface, so it needs no bridge call at all — and it
                // must not silently acquire one.
                expect(calls.imageFromSurface).toBe(0);
                expect(calls.setSourceImage).toBe(0);
                expect(calls.setSourcePixels).toBe(0);
            });
        });

        await it('createPattern(image) installs the image through setSourceImage', async () => {
            // Build a PixbufImageSource-shaped source without importing
            // `gi://GdkPixbuf`: ask the bridge for a handle over a filled
            // surface, which is exactly what an HTMLImageElement carries.
            const source = makeCanvasSource(4, 4, 'rgb(255, 0, 255)');
            const handle = getCanvasPixelBridge().imageFromSurface(source.getContext('2d')!._getSurface(), 0, 0, 4, 4);
            expect(handle).toBeTruthy();

            withRecordingBridge((calls) => {
                const ctx = makeCtx();
                const pattern = ctx.createPattern({ isPixbuf: () => true, _pixbuf: handle! }, 'repeat');

                expect(pattern).toBeTruthy();
                expect(calls.setSourceImage).toBe(1);
            });
        });
    });
};
