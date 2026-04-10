// parseColor tests — RGB, hex, named, and HSL formats
// Covers Excalibur's non-standard HSL output (0-1 normalized values without %)
// Reference: https://developer.mozilla.org/en-US/docs/Web/CSS/color_value/hsl

import { describe, it, expect } from '@gjsify/unit';
import { parseColor } from './color.js';

export default async () => {

    await describe('parseColor — hex and named', async () => {
        await it('parses #ffffff as white', async () => {
            const c = parseColor('#ffffff')!;
            expect(c.r).toBe(1); expect(c.g).toBe(1); expect(c.b).toBe(1); expect(c.a).toBe(1);
        });

        await it('parses named "white" as white', async () => {
            const c = parseColor('white')!;
            expect(c.r).toBe(1); expect(c.g).toBe(1); expect(c.b).toBe(1);
        });

        await it('parses "black" as black', async () => {
            const c = parseColor('black')!;
            expect(c.r).toBe(0); expect(c.g).toBe(0); expect(c.b).toBe(0);
        });
    });

    await describe('parseColor — rgb()/rgba()', async () => {
        await it('parses rgb(255,0,0) as red', async () => {
            const c = parseColor('rgb(255, 0, 0)')!;
            expect(c.r).toBe(1); expect(c.g).toBe(0); expect(c.b).toBe(0); expect(c.a).toBe(1);
        });

        await it('parses rgba(0,0,255,0.5) as semi-transparent blue', async () => {
            const c = parseColor('rgba(0, 0, 255, 0.5)')!;
            expect(c.r).toBe(0); expect(c.b).toBe(1); expect(c.a).toBe(0.5);
        });
    });

    await describe('parseColor — standard CSS hsl()/hsla()', async () => {
        await it('hsl(0, 0%, 100%) → white', async () => {
            const c = parseColor('hsl(0, 0%, 100%)')!;
            expect(c).toBeDefined();
            expect(c.r).toBeGreaterThan(0.99);
            expect(c.g).toBeGreaterThan(0.99);
            expect(c.b).toBeGreaterThan(0.99);
        });

        await it('hsl(0, 0%, 0%) → black', async () => {
            const c = parseColor('hsl(0, 0%, 0%)')!;
            expect(c).toBeDefined();
            expect(c.r).toBe(0); expect(c.g).toBe(0); expect(c.b).toBe(0);
        });

        await it('hsl(120, 100%, 50%) → green', async () => {
            const c = parseColor('hsl(120, 100%, 50%)')!;
            expect(c).toBeDefined();
            expect(c.g).toBeGreaterThan(0.99);
            expect(c.r).toBeLessThan(0.01);
            expect(c.b).toBeLessThan(0.01);
        });

        await it('hsla(0, 100%, 50%, 0.5) → semi-transparent red', async () => {
            const c = parseColor('hsla(0, 100%, 50%, 0.5)')!;
            expect(c).toBeDefined();
            expect(c.r).toBeGreaterThan(0.99);
            expect(c.a).toBe(0.5);
        });
    });

    await describe('parseColor — Excalibur non-standard HSL (0-1 normalized)', async () => {
        // Excalibur's Color.toString() → HSLColor.fromRGBA().toString()
        // uses toFixed(0) on h/s/l values stored in 0-1 range → "hsla(h, s, l, a)"
        // without % signs and with values that are 0 or 1 after rounding.

        await it('hsla(0, 0, 1, 1) → white (Color.White)', async () => {
            // Color.White = fromHex("#FFFFFF") → r=255,g=255,b=255,a=1
            // → HSLColor(h=0, s=0, l=1, a=1) → "hsla(0, 0, 1, 1)"
            const c = parseColor('hsla(0, 0, 1, 1)')!;
            expect(c).toBeDefined();
            expect(c.r).toBeGreaterThan(0.99);
            expect(c.g).toBeGreaterThan(0.99);
            expect(c.b).toBeGreaterThan(0.99);
            expect(c.a).toBe(1);
        });

        await it('hsla(0, 0, 0, 1) → black (Color.Black)', async () => {
            const c = parseColor('hsla(0, 0, 0, 1)')!;
            expect(c).toBeDefined();
            expect(c.r).toBe(0); expect(c.g).toBe(0); expect(c.b).toBe(0);
            expect(c.a).toBe(1);
        });

        await it('hsla(0, 0, 0, 0) → transparent black', async () => {
            const c = parseColor('hsla(0, 0, 0, 0)')!;
            expect(c).toBeDefined();
            expect(c.a).toBe(0);
        });
    });

    await describe('parseColor — fillStyle round-trip via Excalibur HSL', async () => {
        await it('returns non-null for Excalibur white string', async () => {
            expect(parseColor('hsla(0, 0, 1, 1)')).toBeDefined();
        });

        await it('returns non-null for Excalibur black string', async () => {
            expect(parseColor('hsla(0, 0, 0, 1)')).toBeDefined();
        });

        await it('returns null for completely invalid color string', async () => {
            expect(parseColor('not-a-color')).toBeNull();
        });
    });
};
