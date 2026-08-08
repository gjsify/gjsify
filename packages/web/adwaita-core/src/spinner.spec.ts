// Spinner animation specs — the arithmetic both renderers draw from.
//
// Written against PROPERTIES of the curve rather than against copied radians: a
// vector that restates `adwLerp(MIN, MAX, easeInOutSine(t)) - drift` would be the
// same reading as the implementation and could only catch a typo. What is worth
// asserting is what the C's constants were CHOSEN to make true — the arc never
// leaves its declared range, the animation loops without a jump, the resting
// pose is the documented one — because those are the things a port gets wrong.

import { describe, expect, it } from '@gjsify/unit';

import { adwLerp, easeInOutSine, easeOutCubic, inverseLerp } from './easing.js';
import {
    ADW_SPINNER_CYCLE_LENGTH,
    ADW_SPINNER_CYCLES_PER_LOOP,
    ADW_SPINNER_MAX_ARC_LENGTH,
    ADW_SPINNER_MIN_ARC_LENGTH,
    ADW_SPINNER_N_CYCLES,
    ADW_SPINNER_SPIN_DURATION_MS,
    ADW_SPINNER_START_ANGLE,
    ADW_SPINNER_STILL_PROGRESS,
    ADW_SPINNER_TRACK_OPACITY,
    normalizeSpinnerAngle,
    spinnerArc,
    spinnerProgressAt,
} from './spinner.js';
import { ADW_SPINNER_MIN_SIZE } from './chrome.js';
import {
    SPINNER_ARC_ENVELOPE,
    SPINNER_ARC_PHASE_VECTORS,
    SPINNER_ARC_TOLERANCE,
    SPINNER_CONSTANT_VECTORS,
} from './conformance/spinner.js';

/** The constants by their C name, so a vector row can look one up. */
const CONSTANTS: Record<string, number> = {
    SPIN_DURATION_MS: ADW_SPINNER_SPIN_DURATION_MS,
    START_ANGLE: ADW_SPINNER_START_ANGLE,
    CIRCLE_OPACITY: ADW_SPINNER_TRACK_OPACITY,
    MIN_ARC_LENGTH: ADW_SPINNER_MIN_ARC_LENGTH,
    MAX_ARC_LENGTH: ADW_SPINNER_MAX_ARC_LENGTH,
    N_CYCLES: ADW_SPINNER_N_CYCLES,
    MIN_SIZE: ADW_SPINNER_MIN_SIZE,
};

export default async () => {
    await describe('easing (adw_lerp, AdwEasing)', async () => {
        await it('adwLerp and inverseLerp invert each other', () => {
            expect(adwLerp(10, 20, 0)).toBe(10);
            expect(adwLerp(10, 20, 1)).toBe(20);
            expect(adwLerp(10, 20, 0.25)).toBe(12.5);
            expect(inverseLerp(10, 20, 12.5)).toBe(0.25);
        });

        await it('easeOutCubic is the clamp layout curve, pinned at its ends', () => {
            expect(easeOutCubic(0)).toBe(0);
            expect(easeOutCubic(1)).toBe(1);
            // Its whole point is that it is fast first: half the time, most of
            // the distance.
            expect(easeOutCubic(0.5)).toBeGreaterThan(0.8);
        });

        await it('easeInOutSine is -0.5 * (cos(pi t) - 1), symmetric about 0.5', () => {
            expect(easeInOutSine(0)).toBe(0);
            expect(Math.abs(easeInOutSine(0.5) - 0.5)).toBeLessThan(SPINNER_ARC_TOLERANCE);
            expect(Math.abs(easeInOutSine(1) - 1)).toBeLessThan(SPINNER_ARC_TOLERANCE);
            for (const t of [0.1, 0.25, 0.4]) {
                expect(Math.abs(easeInOutSine(t) + easeInOutSine(1 - t) - 1)).toBeLessThan(SPINNER_ARC_TOLERANCE);
            }
        });
    });

    await describe('spinner constants (the #defines, five of which a port got wrong)', async () => {
        for (const { name, value, rule } of SPINNER_CONSTANT_VECTORS) {
            await it(`${name} = ${value} — ${rule}`, () => {
                expect(CONSTANTS[name]).toBe(value);
            });
        }

        await it('the cycle length is IDLE + EXTEND + CONTRACT - OVERLAP', () => {
            expect(Math.abs(ADW_SPINNER_CYCLE_LENGTH - Math.PI * 2.65)).toBeLessThan(SPINNER_ARC_TOLERANCE);
        });

        await it('N_CYCLES satisfies the constraint the C states in a comment', () => {
            // "(IDLE + EXTEND + CONTRACT - OVERLAP) * k, where k is an integer"
            // — 53 turns is exactly 40 arc cycles, which is why the loop can
            // restart without the arc jumping.
            expect(Math.abs(ADW_SPINNER_CYCLES_PER_LOOP - 40)).toBeLessThan(1e-9);
            expect(Math.abs(ADW_SPINNER_CYCLES_PER_LOOP - Math.round(ADW_SPINNER_CYCLES_PER_LOOP))).toBeLessThan(1e-9);
        });

        await it('the still pose is pi * 0.75 (adw-spinner-paintable.c:375-376)', () => {
            expect(Math.abs(ADW_SPINNER_STILL_PROGRESS - Math.PI * 0.75)).toBeLessThan(SPINNER_ARC_TOLERANCE);
        });
    });

    await describe('normalizeSpinnerAngle (the C loops, it does not modulo)', async () => {
        await it('folds into [0, 2pi]', () => {
            expect(normalizeSpinnerAngle(0)).toBe(0);
            expect(Math.abs(normalizeSpinnerAngle(Math.PI * 3) - Math.PI)).toBeLessThan(SPINNER_ARC_TOLERANCE);
            expect(Math.abs(normalizeSpinnerAngle(-Math.PI * 0.5) - Math.PI * 1.5)).toBeLessThan(SPINNER_ARC_TOLERANCE);
        });

        await it('leaves EXACTLY 2pi alone — the loop tests `> 2pi`, a modulo would give 0', () => {
            expect(normalizeSpinnerAngle(Math.PI * 2)).toBe(Math.PI * 2);
        });
    });

    await describe('spinnerArc (the breathing arc, not a rotating quarter-circle)', async () => {
        for (const { phase, rule } of SPINNER_ARC_PHASE_VECTORS) {
            await it(`phase ${phase} — ${rule}`, () => {
                const { start, end, length } = spinnerArc(phase * ADW_SPINNER_CYCLE_LENGTH);
                // Both ends are on the circle, and the drawn segment is a real
                // arc rather than a degenerate point.
                expect(start).toBeGreaterThanOrEqual(0);
                expect(start).toBeLessThanOrEqual(Math.PI * 2);
                expect(end).toBeGreaterThanOrEqual(0);
                expect(end).toBeLessThanOrEqual(Math.PI * 2);
                expect(length).toBeGreaterThan(0);
                expect(length).toBeLessThanOrEqual(Math.PI * 2);
            });
        }

        await it('BREATHES between 2.7 and 102.8 degrees — the drawn envelope, not the constants', () => {
            // The browser port drew a FIXED 90 degrees, i.e. an envelope of one
            // value. And the upper end is NOT `MAX_ARC_LENGTH`: both arc ends
            // lerp towards it and then subtract the same drift term, so 162
            // degrees is the lerp target and 102.8 is what reaches the screen.
            const lengths: number[] = [];
            for (let i = 0; i < 20_000; i++) lengths.push(spinnerArc((i / 20_000) * ADW_SPINNER_CYCLE_LENGTH).length);
            expect(Math.abs(Math.min(...lengths) - SPINNER_ARC_ENVELOPE.min)).toBeLessThan(
                SPINNER_ARC_ENVELOPE.tolerance,
            );
            expect(Math.abs(Math.max(...lengths) - SPINNER_ARC_ENVELOPE.max)).toBeLessThan(
                SPINNER_ARC_ENVELOPE.tolerance,
            );
        });

        await it('never leaves that envelope over a whole LOOP, not just one cycle', () => {
            // Sampled across the loop: if the cycle length were wrong, the two
            // would disagree here and nowhere else.
            for (let i = 0; i < 4000; i++) {
                const { length } = spinnerArc((i / 4000) * ADW_SPINNER_N_CYCLES * Math.PI * 2);
                expect(length).toBeGreaterThanOrEqual(ADW_SPINNER_MIN_ARC_LENGTH - 1e-6);
                expect(length).toBeLessThanOrEqual(SPINNER_ARC_ENVELOPE.max + 1e-4);
            }
        });

        await it('carries START_ANGLE, which neither port had', () => {
            // At progress 0 the arc's trailing end is MIN_ARC_LENGTH past the
            // start angle, so the whole figure is rotated rather than beginning
            // at 3 o'clock.
            const { start } = spinnerArc(0);
            expect(Math.abs(start - (ADW_SPINNER_START_ANGLE + ADW_SPINNER_MIN_ARC_LENGTH))).toBeLessThan(1e-9);
        });
    });

    await describe('spinnerProgressAt (a linear ramp, repeating without a jump)', async () => {
        await it('one full turn per SPIN_DURATION_MS', () => {
            expect(spinnerProgressAt(0)).toBe(0);
            expect(Math.abs(spinnerProgressAt(ADW_SPINNER_SPIN_DURATION_MS) - Math.PI * 2)).toBeLessThan(1e-9);
            expect(Math.abs(spinnerProgressAt(ADW_SPINNER_SPIN_DURATION_MS / 2) - Math.PI)).toBeLessThan(1e-9);
        });

        await it('the loop boundary draws the same arc as the start — that is what N_CYCLES buys', () => {
            const loopMs = ADW_SPINNER_SPIN_DURATION_MS * ADW_SPINNER_N_CYCLES;
            const atStart = spinnerArc(spinnerProgressAt(0));
            const justBefore = spinnerArc(spinnerProgressAt(loopMs - 1e-6));
            expect(Math.abs(justBefore.length - atStart.length)).toBeLessThan(1e-3);
        });

        await it('a negative elapsed time is still on the ramp, not off it', () => {
            // Clocks can hand back a negative delta across a suspend; the C's
            // frame clock never does, but a renderer's `performance.now()` origin
            // can move, and a NaN reaching an SVG attribute is a blank spinner.
            expect(Number.isFinite(spinnerProgressAt(-1))).toBe(true);
            expect(spinnerProgressAt(-1)).toBeGreaterThanOrEqual(0);
        });
    });
};
