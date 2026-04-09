// Font rendering tests targeting the coin-counter bug in the Jelly Jumper showcase.
// Excalibur uses canvas2D fillText() + FontFace/FontFaceSet for custom fonts.
// These tests isolate whether the Canvas2D text pipeline works on GJS/Cairo+PangoCairo.
//
// Reference: showcases/dom/excalibur-jelly-jumper/src/ui/level-overlay.ts
// Reference: packages/dom/canvas2d/src/canvas-rendering-context-2d.ts (fillText, font setter)

import { describe, it, expect, on } from '@gjsify/unit';
import '@gjsify/dom-elements/register';
import '@gjsify/canvas2d';
import { HTMLCanvasElement } from '@gjsify/dom-elements';

function createCanvas(width = 200, height = 50) {
    const canvas = new HTMLCanvasElement();
    canvas.width = width;
    canvas.height = height;
    return canvas;
}

function getPixel(ctx: CanvasRenderingContext2D, x: number, y: number): [number, number, number, number] {
    const d = ctx.getImageData(x, y, 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
}

export default async () => {
    await on('Gjs', async () => {
        await describe('fillText', async () => {
            await it('renders non-transparent pixels for text "42"', async () => {
                const canvas = createCanvas();
                const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
                // White background, black text
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = 'black';
                ctx.font = '20px sans-serif';
                ctx.fillText('42', 5, 30);
                // Sample a region where the glyph should be — at least one pixel must differ from white
                const data = ctx.getImageData(5, 10, 30, 25).data;
                const hasNonWhite = Array.from({ length: data.length / 4 }, (_, i) =>
                    data[i * 4] < 200 || data[i * 4 + 1] < 200 || data[i * 4 + 2] < 200
                ).some(Boolean);
                expect(hasNonWhite).toBe(true);
            });

            await it('different font sizes produce different text widths', async () => {
                const canvas = createCanvas();
                const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
                ctx.font = '12px sans-serif';
                const small = ctx.measureText('Hello').width;
                ctx.font = '24px sans-serif';
                const large = ctx.measureText('Hello').width;
                expect(large).toBeGreaterThan(small);
            });

            await it('fillText with rgba color alpha is respected', async () => {
                const canvas = createCanvas(100, 100);
                const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, 100, 100);
                ctx.fillStyle = 'rgba(255, 0, 0, 1.0)';
                ctx.font = '30px sans-serif';
                ctx.fillText('X', 10, 60);
                // Sample center — should have red channel > blue channel somewhere
                const data = ctx.getImageData(10, 30, 50, 40).data;
                const hasReddish = Array.from({ length: data.length / 4 }, (_, i) =>
                    data[i * 4] > 200 && data[i * 4 + 2] < 100
                ).some(Boolean);
                expect(hasReddish).toBe(true);
            });
        });

        await describe('FontFace / FontFaceSet', async () => {
            await it('FontFace constructor is available on globalThis', async () => {
                expect(typeof (globalThis as any).FontFace).toBe('function');
            });

            await it('document.fonts is a FontFaceSet', async () => {
                const fonts = (globalThis as any).document?.fonts;
                expect(fonts).toBeDefined();
                expect(typeof fonts.add).toBe('function');
            });

            await it('new FontFace() creates an object with family and status', async () => {
                const FF = (globalThis as any).FontFace;
                const face = new FF('TestFont', 'url(data:,)');
                expect(face.family).toBe('TestFont');
                // status is 'unloaded' before load() is called
                expect(typeof face.status).toBe('string');
            });

            await it('FontFace.load() resolves with the face and status=loaded', async () => {
                // Regression: load() must return a Promise that resolves.
                // Excalibur's FontSource.load() awaits face.load() before rendering.
                const FF = (globalThis as any).FontFace;
                const face = new FF('Round9x13', 'url(/res/fonts/Round9x13.ttf)');
                expect(face.status).toBe('unloaded');
                const resolved = await face.load();
                expect(resolved).toBe(face);
                expect(face.status).toBe('loaded');
            });

            await it('document.fonts.add() and document.fonts.ready do not throw', async () => {
                // Excalibur calls document.fonts.add(face) after load().
                // The stub must not throw, and .ready must still resolve.
                const FF = (globalThis as any).FontFace;
                const face = new FF('Round9x13', 'url(/res/fonts/Round9x13.ttf)');
                await face.load();
                const fonts = (globalThis as any).document.fonts;
                let threw = false;
                try {
                    fonts.add(face);
                    await fonts.ready;
                } catch {
                    threw = true;
                }
                expect(threw).toBe(false);
            });

            await it('fillText with unknown font name falls back and still renders pixels', async () => {
                // Key regression: when Excalibur uses a custom font (Round9x13) that is
                // not registered in PangoCairo, the system must fall back to a default
                // font and still render visible pixels — not silently skip the draw call.
                // If this test fails, the coin counter is blank due to font-not-found
                // causing PangoCairo to render nothing.
                const canvas = createCanvas(200, 50);
                const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
                ctx.fillStyle = 'white';
                ctx.fillRect(0, 0, 200, 50);
                ctx.fillStyle = 'black';
                // Use a font name that will not be found in the system
                ctx.font = '20px Round9x13';
                ctx.fillText('42', 5, 35);
                const data = ctx.getImageData(5, 10, 50, 30).data;
                const hasNonWhite = Array.from({ length: data.length / 4 }, (_, i) =>
                    data[i * 4] < 200 || data[i * 4 + 1] < 200 || data[i * 4 + 2] < 200
                ).some(Boolean);
                // If this assertion fails: PangoCairo does NOT fall back when font is missing
                // → root cause of the coin-counter bug. Fix: register font with Pango or
                //   implement real FontFace loading that installs the TTF into the Pango font map.
                expect(hasNonWhite).toBe(true);
            });
        });
    });
};
