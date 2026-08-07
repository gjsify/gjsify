// The half of the iOS icon backend that CAN be tested off-device.
//
// Rasterising needs a device; turning path data into geometry — and a hex string
// into UIKit colour components — does not, and that is where the complexity
// lives. These run on GJS and Node in CI, including a sweep over every real
// Adwaita symbolic icon the workspace ships.

import { describe, expect, it } from '@gjsify/unit';

// A namespace import: the package exports one const per icon, not a map.
import * as actionIcons from '@gjsify/adwaita-icons/actions';

import { extractIconPaths, parseHexColor } from './widgets/icon-path.js';
import { parseSvgPath, type SvgPathCommand } from './widgets/svg-path.js';

/** Sample a cubic Bézier at `t`. */
function cubicAt(t: number, p0: number, p1: number, p2: number, p3: number): number {
    const u = 1 - t;
    return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

/** Sample a quadratic Bézier at `t`. */
function quadraticAt(t: number, p0: number, p1: number, p2: number): number {
    const u = 1 - t;
    return u * u * p0 + 2 * u * t * p1 + t * t * p2;
}

export default async () => {
    await describe('parseSvgPath — absolute output', async () => {
        await it('passes through an absolute move/line/close', () => {
            expect(parseSvgPath('M10 10 L20 20 Z')).toStrictEqual([
                { type: 'M', x: 10, y: 10 },
                { type: 'L', x: 20, y: 20 },
                { type: 'Z' },
            ] as SvgPathCommand[]);
        });

        await it('resolves relative commands against the current point', () => {
            expect(parseSvgPath('m1 1 l2 2 l2 2')).toStrictEqual([
                { type: 'M', x: 1, y: 1 },
                { type: 'L', x: 3, y: 3 },
                { type: 'L', x: 5, y: 5 },
            ] as SvgPathCommand[]);
        });

        await it('expands H and V into lines', () => {
            expect(parseSvgPath('M0 0H5V5h-5v-5')).toStrictEqual([
                { type: 'M', x: 0, y: 0 },
                { type: 'L', x: 5, y: 0 },
                { type: 'L', x: 5, y: 5 },
                { type: 'L', x: 0, y: 5 },
                { type: 'L', x: 0, y: 0 },
            ] as SvgPathCommand[]);
        });

        await it('repeats an implicit command without repeating the letter', () => {
            // "L20 20 30 30" is two linetos; "M0 0 5 5" is a moveto then a lineto.
            expect(parseSvgPath('M0 0 L20 20 30 30')).toHaveLength(3);
        });

        await it('returns the current point to the subpath start after Z', () => {
            const commands = parseSvgPath('M4 4 L8 4 Z l1 1');
            expect(commands[commands.length - 1]).toStrictEqual({ type: 'L', x: 5, y: 5 });
        });
    });

    await describe('parseSvgPath — the number grammar', async () => {
        await it('splits numbers that run together', () => {
            // "1.5.5" is 1.5 and .5 — the classic minifier output.
            expect(parseSvgPath('M1.5.5L2-3')).toStrictEqual([
                { type: 'M', x: 1.5, y: 0.5 },
                { type: 'L', x: 2, y: -3 },
            ] as SvgPathCommand[]);
        });

        await it('reads exponents, and does not mistake a stray letter for one', () => {
            expect(parseSvgPath('M1e2 1E-1')).toStrictEqual([{ type: 'M', x: 100, y: 0.1 }]);
        });

        await it('reads glued arc flags positionally', () => {
            // `a3 3 0 001 1` packs large-arc=0, sweep=0, then x=1 y=1.
            const commands = parseSvgPath('M0 0 a3 3 0 001 1');
            expect(commands.length > 1).toBe(true);
            const last = commands[commands.length - 1]!;
            expect(last.type).toBe('C');
            if (last.type === 'C') {
                expect(last.x).toBeCloseTo(1, 9);
                expect(last.y).toBeCloseTo(1, 9);
            }
        });

        await it('keeps what it parsed when the data is truncated', () => {
            // A malformed icon must not take down the view rendering it.
            expect(parseSvgPath('M1 1 L2')).toStrictEqual([{ type: 'M', x: 1, y: 1 }]);
        });
    });

    await describe('parseSvgPath — curves', async () => {
        await it('converts a quadratic to the exactly equivalent cubic', () => {
            const [, curve] = parseSvgPath('M0 0 Q10 20 20 0');
            expect(curve!.type).toBe('C');
            if (curve!.type !== 'C') return;
            let worst = 0;
            for (let t = 0; t <= 1; t += 0.01) {
                worst = Math.max(
                    worst,
                    Math.abs(quadraticAt(t, 0, 10, 20) - cubicAt(t, 0, curve.x1, curve.x2, curve.x)),
                    Math.abs(quadraticAt(t, 0, 20, 0) - cubicAt(t, 0, curve.y1, curve.y2, curve.y)),
                );
            }
            // Exact in theory; only floating point separates them.
            expect(worst < 1e-12).toBe(true);
        });

        await it('reflects the previous control point for S', () => {
            const [, first, second] = parseSvgPath('M0 0 C1 1 2 2 3 3 S5 5 6 6');
            expect(first!.type === 'C' && second!.type === 'C').toBe(true);
            if (second!.type !== 'C') return;
            // Reflection of (2,2) through (3,3).
            expect(second.x1).toBeCloseTo(4, 9);
            expect(second.y1).toBeCloseTo(4, 9);
        });

        await it('treats S after a non-curve as having its control at the current point', () => {
            const [, , curve] = parseSvgPath('M0 0 L1 1 S3 3 4 4');
            if (curve!.type !== 'C') throw new Error('expected a cubic');
            expect(curve.x1).toBeCloseTo(1, 9);
            expect(curve.y1).toBeCloseTo(1, 9);
        });

        await it('reflects the previous quadratic control point for T', () => {
            const [, , second] = parseSvgPath('M0 0 Q2 4 4 0 T8 0');
            if (second!.type !== 'C') throw new Error('expected a cubic');
            // The reflected quadratic control is (6,-4); as a cubic its first
            // control sits two thirds of the way there.
            expect(second.x1).toBeCloseTo(4 + (2 / 3) * 2, 9);
            expect(second.y1).toBeCloseTo(0 + (2 / 3) * -4, 9);
        });
    });

    await describe('parseSvgPath — elliptical arcs (SVG F.6.5)', async () => {
        await it('lands every segment endpoint exactly on the circle', () => {
            const commands = parseSvgPath('M0 5 A5 5 0 1 0 10 5 A5 5 0 1 0 0 5');
            const curves = commands.filter((c) => c.type === 'C');
            // A full turn needs four quarter-turn cubics per half.
            expect(curves).toHaveLength(4);
            for (const curve of curves) {
                if (curve.type !== 'C') continue;
                expect(Math.hypot(curve.x - 5, curve.y - 5)).toBeCloseTo(5, 9);
            }
        });

        await it('honours the sweep flag by curving the other way', () => {
            const cw = parseSvgPath('M0 0 A5 5 0 0 1 10 0');
            const ccw = parseSvgPath('M0 0 A5 5 0 0 0 10 0');
            const midY = (commands: SvgPathCommand[]) => {
                const curve = commands.find((c) => c.type === 'C');
                return curve && curve.type === 'C' ? curve.y1 : 0;
            };
            // Same endpoints, opposite bulge.
            expect(Math.sign(midY(cw)) === -Math.sign(midY(ccw))).toBe(true);
        });

        await it('scales radii up when they cannot span the endpoints (F.6.6)', () => {
            // r=1 cannot reach from (0,0) to (10,0); the arc must still end there.
            const commands = parseSvgPath('M0 0 A1 1 0 0 1 10 0');
            const last = commands[commands.length - 1]!;
            if (last.type !== 'C') throw new Error('expected a cubic');
            expect(last.x).toBeCloseTo(10, 9);
            expect(last.y).toBeCloseTo(0, 9);
        });

        await it('degenerates to a line on a zero radius, and to nothing on a zero-length arc', () => {
            expect(parseSvgPath('M0 0 A0 5 0 0 1 10 0')).toStrictEqual([
                { type: 'M', x: 0, y: 0 },
                { type: 'L', x: 10, y: 0 },
            ] as SvgPathCommand[]);
            expect(parseSvgPath('M3 3 A5 5 0 0 1 3 3')).toStrictEqual([{ type: 'M', x: 3, y: 3 }]);
        });

        await it('applies the x-axis rotation', () => {
            const upright = parseSvgPath('M0 0 A6 3 0 0 1 12 0');
            const rotated = parseSvgPath('M0 0 A6 3 90 0 1 12 0');
            expect(JSON.stringify(upright) === JSON.stringify(rotated)).toBe(false);
        });
    });

    await describe('every shipped Adwaita symbolic icon parses', async () => {
        await it('produces finite geometry for all of them, starting from a move', () => {
            const problems: string[] = [];
            let icons = 0;
            let commands = 0;
            for (const [name, svg] of Object.entries(actionIcons)) {
                if (typeof svg !== 'string' || !svg.includes('<path')) continue;
                icons++;
                for (const { d } of extractIconPaths(svg)) {
                    const parsed = parseSvgPath(d);
                    commands += parsed.length;
                    if (parsed.length === 0) {
                        problems.push(`${name}: no geometry`);
                        continue;
                    }
                    if (parsed[0]!.type !== 'M') problems.push(`${name}: does not start with a move`);
                    for (const command of parsed) {
                        for (const [key, value] of Object.entries(command)) {
                            if (key !== 'type' && !Number.isFinite(value)) problems.push(`${name}: ${key} is ${value}`);
                        }
                    }
                }
            }
            expect(problems).toStrictEqual([]);
            // Guard against the sweep silently becoming a no-op.
            expect(icons > 100).toBe(true);
            expect(commands > 1000).toBe(true);
        });
    });
    await describe('parseHexColor (UIKit has no hex constructor)', async () => {
        await it('reads the #RRGGBB form', () => {
            expect(parseHexColor('#33333A')).toStrictEqual({
                red: 0x33 / 255,
                green: 0x33 / 255,
                blue: 0x3a / 255,
                alpha: 1,
            });
        });

        await it('reads the ALPHA-FIRST #AARRGGBB form Android documents', () => {
            const { alpha, red } = parseHexColor('#80FF0000');
            expect(alpha).toBeCloseTo(0x80 / 255, 9);
            expect(red).toBe(1);
        });

        await it('expands the #RGB shorthand', () => {
            expect(parseHexColor('#f00')).toStrictEqual({ red: 1, green: 0, blue: 0, alpha: 1 });
        });

        await it('tolerates a missing hash and surrounding space', () => {
            expect(parseHexColor('  ffffff ')).toStrictEqual({ red: 1, green: 1, blue: 1, alpha: 1 });
        });

        await it('falls back to opaque black rather than to invisible', () => {
            // A typo must yield a visible icon, not a transparent one.
            for (const bad of ['', '#', '#12', '#12345', 'rebeccapurple', '#gggggg']) {
                expect(parseHexColor(bad)).toStrictEqual({ red: 0, green: 0, blue: 0, alpha: 1 });
            }
        });
    });
};
