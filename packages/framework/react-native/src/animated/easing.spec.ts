// Every pair in `easing.ts`' mapping table, re-derived rather than trusted.
//
// The table claims that eleven React Native easing families are the SAME CURVE as an
// `AdwEasing` member, and that three combinations and six names are not. A comment
// cannot hold that: a mapping row is exactly as right as the last person who read the
// two names next to each other, and `bounce` proves it — React Native's `bounce` is
// the standard easeOutBounce, so matching the names to each other is off by 8.1e-1.
//
// So React Native 0.87.1's own formulas are TRANSCRIBED below (its
// `Libraries/Animated/Easing.js` and `Libraries/Animated/bezier.js`, MIT, © Meta
// Platforms) and each declared pair is sampled against `Adw.easing_ease`. That is a
// differential test: it fails if a row is wrong in either direction, and it needs no
// `react-native` on disk — which the surface snapshot deliberately does not have
// either.
//
// Transcription and not an import: those files are Flow-typed source and this suite
// runs under GJS. The cost is that the transcription can drift from upstream, and what
// bounds it is that a drift makes the assertion FAIL rather than pass — an easing that
// stops matching is exactly the signal to re-read the file.

import Adw from 'gi://Adw?version=1';
import { describe, expect, it, on, type Runtime } from '@gjsify/unit';

import { PrimitiveError } from '../primitives/errors.js';
import { adwEasing, Easing, EASING_FAMILIES, easingTriple, type EasingFunction } from './easing.js';

/** Named identities, not a capability — the same list `widgets.spec.ts` stands down on. */
const ADW_HOSTS: Runtime[] = ['Gjs', 'Node.js', 'Bun', 'Deno'];

// --- React Native's own formulas, transcribed ---------------------------------

const A = (a1: number, a2: number): number => 1 - 3 * a2 + 3 * a1;
const B = (a1: number, a2: number): number => 3 * a2 - 6 * a1;
const C = (a1: number): number => 3 * a1;
const calcBezier = (t: number, a1: number, a2: number): number => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
const slopeAt = (t: number, a1: number, a2: number): number => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);

/** `bezier.js`' Newton-plus-subdivision solver, at its own constants. */
function bezier(mX1: number, mY1: number, mX2: number, mY2: number): EasingFunction {
    const size = 11;
    const step = 1 / (size - 1);
    const samples = new Float64Array(size);
    if (mX1 !== mY1 || mX2 !== mY2) {
        for (let i = 0; i < size; i++) samples[i] = calcBezier(i * step, mX1, mX2);
    }
    const newton = (aX: number, guess: number): number => {
        let t = guess;
        for (let i = 0; i < 4; i++) {
            const slope = slopeAt(t, mX1, mX2);
            if (slope === 0) return t;
            t -= (calcBezier(t, mX1, mX2) - aX) / slope;
        }
        return t;
    };
    const subdivide = (aX: number, low: number, high: number): number => {
        let a = low;
        let b = high;
        let t = 0;
        let x = 0;
        let i = 0;
        do {
            t = a + (b - a) / 2;
            x = calcBezier(t, mX1, mX2) - aX;
            if (x > 0) b = t;
            else a = t;
        } while (Math.abs(x) > 1e-7 && ++i < 10);
        return t;
    };
    const tForX = (aX: number): number => {
        let start = 0;
        let current = 1;
        const last = size - 1;
        for (; current !== last && (samples[current] as number) <= aX; ++current) start += step;
        --current;
        const span = (samples[current + 1] as number) - (samples[current] as number);
        const guess = start + ((aX - (samples[current] as number)) / span) * step;
        const slope = slopeAt(guess, mX1, mX2);
        if (slope >= 0.001) return newton(aX, guess);
        if (slope === 0) return guess;
        return subdivide(aX, start, start + step);
    };
    return (x: number): number => {
        if (mX1 === mY1 && mX2 === mY2) return x;
        if (x === 0) return 0;
        if (x === 1) return 1;
        return calcBezier(tForX(x), mY1, mY2);
    };
}

const rnEase = bezier(0.42, 0, 1, 1);

/** The `in` direction of each family, exactly as React Native writes it. */
const RN_IN: Readonly<Record<string, EasingFunction>> = {
    linear: (t) => t,
    ease: (t) => rnEase(t),
    quad: (t) => t * t,
    cubic: (t) => t * t * t,
    quart: (t) => Math.pow(t, 4),
    quint: (t) => Math.pow(t, 5),
    sin: (t) => 1 - Math.cos((t * Math.PI) / 2),
    circle: (t) => 1 - Math.sqrt(1 - t * t),
    exp: (t) => Math.pow(2, 10 * (t - 1)),
    back: (t) => t * t * ((1.70158 + 1) * t - 1.70158),
    bounce: (t) => {
        if (t < 1 / 2.75) return 7.5625 * t * t;
        if (t < 2 / 2.75) {
            const t2 = t - 1.5 / 2.75;
            return 7.5625 * t2 * t2 + 0.75;
        }
        if (t < 2.5 / 2.75) {
            const t2 = t - 2.25 / 2.75;
            return 7.5625 * t2 * t2 + 0.9375;
        }
        const t2 = t - 2.625 / 2.75;
        return 7.5625 * t2 * t2 + 0.984375;
    },
};

/** React Native's own combinators. `in` is its identity. */
const rnOut =
    (f: EasingFunction): EasingFunction =>
    (t) =>
        1 - f(1 - t);
const rnInOut =
    (f: EasingFunction): EasingFunction =>
    (t) =>
        t < 0.5 ? f(t * 2) / 2 : 1 - f((1 - t) * 2) / 2;

const SAMPLES = 1001;
const deviation = (mine: EasingFunction, theirs: EasingFunction): number => {
    let worst = 0;
    for (let i = 0; i < SAMPLES; i++) {
        const t = i / (SAMPLES - 1);
        worst = Math.max(worst, Math.abs(mine(t) - theirs(t)));
    }
    return worst;
};

/**
 * Float noise, not a tolerance.
 *
 * The largest deviation in the exactly-mapped set is 2.4e-16, which is a handful of
 * ULPs on values in [0, 1]. A looser bound here would let a genuinely different curve
 * through, which is the whole failure this file exists against.
 */
const NOISE = 1e-15;

/**
 * The two families whose bound is NOT float noise, at the numbers `easing.ts` states.
 *
 * `ease` is the bezier SOLVER's tolerance rather than a different curve: React
 * Native's `bezier.js` stops after four Newton iterations or a 1e-7 subdivision, and
 * the residual shows up at t = 0.999. `exp` is a real difference of 1/1024, entirely
 * at one endpoint, where RN's `2^(10(t−1))` is 0.0009765625 and CSS's expo is 0.
 *
 * Per-family and never a global loosening: a 1e-3 bound applied to `cubic` would let
 * a visibly wrong curve through, and the point of this file is that each pair carries
 * its own measured number.
 */
const TOLERANCE: Readonly<Record<string, number>> = { ease: 2e-6, exp: 9.8e-4 };

const threw = (run: () => unknown): Error => {
    try {
        run();
    } catch (error) {
        return error as Error;
    }
    throw new Error('expected a refusal, and nothing was thrown');
};

export default async () => {
    await on(ADW_HOSTS, async () => {
        await describe('the AdwEasing mapping, against React Native’s own formulas', async () => {
            await it('is the SAME curve for every pair the table declares', async () => {
                const wrong: string[] = [];
                for (const family of EASING_FAMILIES) {
                    const rnIn = RN_IN[family];
                    if (rnIn === undefined) {
                        wrong.push(`${family}: declared in easing.ts with no transcribed formula here`);
                        continue;
                    }
                    const triple = easingTriple(family);
                    const theirs = { in: rnIn, out: rnOut(rnIn), inOut: rnInOut(rnIn) } as const;
                    for (const direction of ['in', 'out', 'inOut'] as const) {
                        const member = triple?.[direction];
                        if (member === null || member === undefined) continue;
                        const mine: EasingFunction = (t) => Adw.easing_ease(adwEasing(member), t);
                        const found = deviation(mine, theirs[direction]);
                        const allowed = TOLERANCE[family] ?? NOISE;
                        if (found > allowed) {
                            wrong.push(`${direction}(${family}) → ${member}: deviation ${found.toExponential(3)}`);
                        }
                    }
                }
                expect(wrong).toStrictEqual([]);
                // Not vacuous: an empty family list would satisfy an empty problem list.
                expect(EASING_FAMILIES.length).toBe(11);
            });

            await it('holds the bounce INVERSION, which is the row a reader would get wrong', async () => {
                // The measurement that makes the swap a fact rather than a preference:
                // React Native's `bounce` IS easeOutBounce, so its `in` direction is
                // AdwEasing's EASE_OUT_BOUNCE at deviation 0, and pairing the names
                // instead is off by 8.1e-1 — a visibly different animation.
                const rnBounce = RN_IN.bounce as EasingFunction;
                const adwOut: EasingFunction = (t) => Adw.easing_ease(Adw.Easing.EASE_OUT_BOUNCE, t);
                const adwIn: EasingFunction = (t) => Adw.easing_ease(Adw.Easing.EASE_IN_BOUNCE, t);
                expect(deviation(adwOut, rnBounce) <= NOISE).toBe(true);
                expect(deviation(adwIn, rnBounce) > 0.8).toBe(true);
                expect(easingTriple('bounce')?.in).toBe('EASE_OUT_BOUNCE');
                expect(easingTriple('bounce')?.out).toBe('EASE_IN_BOUNCE');
            });

            await it('leaves the three holes empty because NOTHING matches them', async () => {
                // The converse of the vector above, and the half that keeps a refusal
                // honest: a hole has to be a missing curve, not a missing row. Each is
                // held against EVERY one of AdwEasing's members.
                const members = Object.keys(Adw.Easing).filter((key) => key === key.toUpperCase());
                expect(members.length).toBe(35);
                const holes: readonly [string, number][] = [
                    ['ease', 1e-2],
                    ['back', 5e-2],
                    ['bounce', 3e-1],
                ];
                for (const [familyName, floor] of holes) {
                    expect(easingTriple(familyName)?.inOut).toBe(null);
                    const theirs = rnInOut(RN_IN[familyName] as EasingFunction);
                    let best = Number.POSITIVE_INFINITY;
                    for (const member of members) {
                        const mine: EasingFunction = (t) => Adw.easing_ease(adwEasing(member as never), t);
                        best = Math.min(best, deviation(mine, theirs));
                    }
                    // Not "no exact match" but "not even close", which is what makes
                    // substituting the nearest the wrong answer.
                    expect(best > floor).toBe(true);
                }
            });
        });

        await describe('Easing’s own surface', async () => {
            await it('mints a token whose value is the AdwEasing member’s', async () => {
                expect(Easing.linear(0.25)).toBe(0.25);
                expect(Easing.cubic(0.5)).toBe(Adw.easing_ease(Adw.Easing.EASE_IN_CUBIC, 0.5));
                expect(Easing.out(Easing.cubic)(0.5)).toBe(Adw.easing_ease(Adw.Easing.EASE_OUT_CUBIC, 0.5));
                expect(Easing.inOut(Easing.quad)(0.25)).toBe(Adw.easing_ease(Adw.Easing.EASE_IN_OUT_QUAD, 0.25));
            });

            await it('keeps `in` as React Native’s identity', async () => {
                // `in(easing) { return easing; }` upstream — so the token has to survive
                // it unchanged, or `in(quad)` would mint a second object and a caller
                // comparing the two would see a difference React Native does not have.
                expect(Easing.in(Easing.quad)).toBe(Easing.quad);
            });

            await it('answers poly for the exponents AdwEasing HAS, and refuses the rest by name', async () => {
                expect(Easing.poly(2)(0.5)).toBe(Adw.easing_ease(Adw.Easing.EASE_IN_QUAD, 0.5));
                expect(Easing.poly(5)(0.5)).toBe(Adw.easing_ease(Adw.Easing.EASE_IN_QUINT, 0.5));
                const error = threw(() => Easing.poly(6));
                expect(error instanceof PrimitiveError).toBe(true);
                expect(error.message).toContain('poly(6)');
                expect(error.message).toContain('quint');
            });

            await it('answers back at its DEFAULT overshoot only', async () => {
                expect(Easing.back()(0.5)).toBe(Adw.easing_ease(Adw.Easing.EASE_IN_BACK, 0.5));
                expect(Easing.back(1.70158)(0.5)).toBe(Adw.easing_ease(Adw.Easing.EASE_IN_BACK, 0.5));
                expect(threw(() => Easing.back(3)).message).toContain('back(3)');
            });

            await it('refuses every name with no member, saying which and by how much', async () => {
                expect(threw(() => Easing.elastic()).message).toContain('1.99e-1');
                expect(threw(() => Easing.bezier(0.1, 0.2, 0.3, 0.4)).message).toContain('bezier(0.1, 0.2, 0.3, 0.4)');
                expect(threw(() => Easing.step0(0.5)).message).toContain('step0');
                expect(threw(() => Easing.step1(0.5)).message).toContain('step1');
                expect(threw(() => Easing.inOut(Easing.ease)).message).toContain('1.20e-2');
                expect(threw(() => Easing.inOut(Easing.bounce)).message).toContain('4.06e-1');
                expect(threw(() => Easing.inOut(Easing.back())).message).toContain('6.62e-2');
            });

            await it('refuses a function it did not mint, rather than sampling it', async () => {
                const stranger: EasingFunction = (t) => t * t;
                const error = threw(() => Easing.out(stranger));
                expect(error.message).toContain('Easing’s own values');
                // And the same refusal from the OTHER reader, so a stranger cannot
                // reach an animation by skipping the combinators.
                expect(threw(() => Easing.inOut(stranger)).message).toContain('Easing’s own values');
            });

            await it('refuses a twice-reflected token, because AdwEasing has three per family', async () => {
                const once = Easing.out(Easing.quad);
                expect(threw(() => Easing.out(once)).message).toContain('out(out(quad))');
            });
        });
    });
};
