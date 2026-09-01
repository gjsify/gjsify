// `Easing` — React Native's curves, held against `AdwEasing`'s and measured.
//
// THIS IS NOT ARITHMETIC, WHICH IS WHAT THE PLANNING ENTRY USED TO SAY. React
// Native's easings are FUNCTIONS `(t) => number` that its `TimingAnimation` calls per
// frame; `Adw.TimedAnimation:easing` is an ENUM of 35 members with no callback form
// at all (measured: `AdwTimedAnimation` installs `widget target value state
// follow-enable-animations-setting value-from value-to duration easing repeat-count
// reverse alternate` — nothing takes a closure). So honouring `Easing` is a
// NAME-TO-ENUM mapping, and every pair in it is either the same curve or an
// approximation. An approximation in a styling layer is invisible until someone looks
// at the window, which is the failure mode ADR 0032 § 6 refuses `justify-between`
// over — so each pair is measured, and the ones that do not match are refused by name
// WITH their deviation.
//
// THE MEASUREMENT, and it is reproducible: React Native 0.87.1's own formulas
// (`Libraries/Animated/Easing.js` and `Libraries/Animated/bezier.js`, MIT) sampled
// against `Adw.easing_ease(member, t)` for every one of the 35 members at 1 001
// points, libadwaita 1.9.3. `easing.spec.ts` re-derives it from a transcription of
// those formulas, so the table below is a machine-checked claim rather than a note.
//
//   RN family        in                     out                    inOut
//   linear           LINEAR         0       LINEAR      5.6e-17    LINEAR          0
//   ease             EASE_IN   1.6e-6       EASE_OUT     1.6e-6    — 1.20e-2
//   quad             EASE_IN_QUAD   0       EASE_OUT_QUAD 1.7e-16  EASE_IN_OUT_QUAD  1.1e-16
//   cubic            EASE_IN_CUBIC  0       EASE_OUT_CUBIC     0   EASE_IN_OUT_CUBIC       0
//   poly(4)          EASE_IN_QUART  1.1e-16 EASE_OUT_QUART 1.1e-16 EASE_IN_OUT_QUART 1.1e-16
//   poly(5)          EASE_IN_QUINT  1.1e-16 EASE_OUT_QUINT 1.1e-16 EASE_IN_OUT_QUINT 1.1e-16
//   sin              EASE_IN_SINE 1.1e-16   EASE_OUT_SINE 2.4e-16  EASE_IN_OUT_SINE  2.2e-16
//   circle           EASE_IN_CIRC   0       EASE_OUT_CIRC 5.6e-17  EASE_IN_OUT_CIRC  1.1e-16
//   exp              EASE_IN_EXPO 9.8e-4    EASE_OUT_EXPO 9.8e-4   EASE_IN_OUT_EXPO  4.9e-4
//   back (default s) EASE_IN_BACK   0       EASE_OUT_BACK      0   — 6.62e-2
//   bounce           EASE_OUT_BOUNCE 0      EASE_IN_BOUNCE     0   — 4.06e-1
//   elastic          — 1.99e-1              — 2.05e-1              — 2.50e-1
//
// TWO ROWS IN THERE ARE NOT WHAT A READER WOULD WRITE FROM THE NAMES:
//
//   * **`bounce` is INVERTED.** React Native's `Easing.bounce` is the standard
//     *easeOutBounce* curve, so `Easing.in(Easing.bounce)` is `AdwEasing`'s
//     EASE_OUT_BOUNCE (deviation exactly 0) and `Easing.out(Easing.bounce)` is
//     EASE_IN_BOUNCE. Mapping the names to each other instead is off by 8.1e-1 —
//     a visibly different animation, and the kind of wrong that looks right in a
//     table.
//   * **`exp` is off by 1/1024, entirely at one endpoint.** RN's is
//     `2^(10·(t−1))`, which is 0.0009765625 at t = 0 where CSS's expo is 0. Nothing
//     in between deviates. Accepted with the number stated rather than refused: it is
//     a 0.1 % error on one frame of an animation nobody can see the start of.
//
// AND THE DEFAULT CANNOT BE REPRODUCED AT ALL. React Native's `timing` defaults to
// `Easing.inOut(Easing.ease)` (measured, `animations/TimingAnimation.js`:
// `config.easing ?? easeInOut()`), a composed cubic bezier that no member matches:
// nearest of all 35 is EASE_IN_OUT_SINE at 1.20e-2, and the CSS-named EASE_IN_OUT is
// 2.86e-2. `timing.ts` uses EASE_IN_OUT and says so — see its own comment for why the
// named curve wins over the numerically nearer one.

import Adw from 'gi://Adw?version=1';

import { PrimitiveError } from '../primitives/errors.js';

/** React Native's easing shape: progress in, progress out. */
export type EasingFunction = (t: number) => number;

/** The three directions React Native's combinators produce. */
export type EasingDirection = 'in' | 'out' | 'inOut';

/**
 * One `AdwEasing` member name.
 *
 * `$gtype` is excluded because `@girs`' enum object carries it alongside the 35
 * members, so a bare `keyof` makes every indexed read `Easing | GType<Easing>`.
 */
export type AdwEasingName = Exclude<keyof typeof Adw.Easing, '$gtype'>;

/** `Adw.Easing[name]`, narrowed past the `$gtype` key the type above excludes. */
export const adwEasing = (name: AdwEasingName): Adw.Easing => Adw.Easing[name] as Adw.Easing;

/**
 * A family's three directions, `null` where `AdwEasing` has no matching curve.
 *
 * `null` is a REFUSAL and not "use the nearest": the deviations for the three holes
 * are 1.20e-2, 6.62e-2 and 4.06e-1, and a styling layer that silently substituted
 * the last one would animate a bounce as something else entirely.
 */
interface FamilyTriple {
    readonly in: AdwEasingName | null;
    readonly out: AdwEasingName | null;
    readonly inOut: AdwEasingName | null;
    /** What the refusal says when a direction is `null`. */
    readonly hole: string;
}

const FAMILIES: Readonly<Record<string, FamilyTriple>> = {
    linear: { in: 'LINEAR', out: 'LINEAR', inOut: 'LINEAR', hole: '' },
    ease: {
        in: 'EASE_IN',
        out: 'EASE_OUT',
        inOut: null,
        hole: 'inOut(ease) composes React Native’s own cubic bezier(0.42, 0, 1, 1) with itself, and no AdwEasing member reproduces it — measured against all 35, the nearest is EASE_IN_OUT_SINE at 1.20e-2 and the CSS-named EASE_IN_OUT at 2.86e-2. Write inOut(quad) or inOut(cubic), both of which map exactly',
    },
    quad: { in: 'EASE_IN_QUAD', out: 'EASE_OUT_QUAD', inOut: 'EASE_IN_OUT_QUAD', hole: '' },
    cubic: { in: 'EASE_IN_CUBIC', out: 'EASE_OUT_CUBIC', inOut: 'EASE_IN_OUT_CUBIC', hole: '' },
    quart: { in: 'EASE_IN_QUART', out: 'EASE_OUT_QUART', inOut: 'EASE_IN_OUT_QUART', hole: '' },
    quint: { in: 'EASE_IN_QUINT', out: 'EASE_OUT_QUINT', inOut: 'EASE_IN_OUT_QUINT', hole: '' },
    sin: { in: 'EASE_IN_SINE', out: 'EASE_OUT_SINE', inOut: 'EASE_IN_OUT_SINE', hole: '' },
    circle: { in: 'EASE_IN_CIRC', out: 'EASE_OUT_CIRC', inOut: 'EASE_IN_OUT_CIRC', hole: '' },
    exp: { in: 'EASE_IN_EXPO', out: 'EASE_OUT_EXPO', inOut: 'EASE_IN_OUT_EXPO', hole: '' },
    back: {
        in: 'EASE_IN_BACK',
        out: 'EASE_OUT_BACK',
        inOut: null,
        hole: 'inOut(back) is 6.62e-2 away from EASE_IN_OUT_BACK — measured, so the two are not the same curve. AdwEasing’s back has a fixed overshoot and React Native composes its own halves',
    },
    // THE INVERTED ROW. React Native's `bounce` is easeOutBounce, so its `in`
    // direction IS AdwEasing's EASE_OUT_BOUNCE. See the module comment.
    bounce: {
        in: 'EASE_OUT_BOUNCE',
        out: 'EASE_IN_BOUNCE',
        inOut: null,
        hole: 'inOut(bounce) is 4.06e-1 away from EASE_IN_OUT_BOUNCE — measured, and that is a different animation rather than a rounding difference',
    },
};

/** `Easing.poly(n)` for the exponents `AdwEasing` has a curve for. */
const POLY: Readonly<Record<number, string>> = { 1: 'linear', 2: 'quad', 3: 'cubic', 4: 'quart', 5: 'quint' };

/** React Native's own default overshoot for `Easing.back`, and the only one that maps. */
const BACK_DEFAULT_S = 1.70158;

/** What a token IS, once minted. Not on the function, so it cannot be forged by a shape. */
const TOKENS = new WeakMap<EasingFunction, { readonly family: string; readonly direction: EasingDirection }>();

/**
 * The `AdwEasing` member a token names, or a refusal.
 *
 * `timing.ts`'s only entry point into this module. A function this module did not
 * mint is refused BY NAME rather than sampled: sampling a caller's closure to guess
 * which of the 35 members it resembles is exactly the approximation the table above
 * exists to avoid, and it would silently pick a curve for a `bezier` nobody can
 * express.
 */
export function easingMember(easing: unknown, subject: string): AdwEasingName {
    if (typeof easing !== 'function') {
        throw new PrimitiveError(
            'Animated.timing',
            subject,
            `takes one of Easing's own values, and received ${easing === null ? 'null' : typeof easing}`,
        );
    }
    const token = TOKENS.get(easing as EasingFunction);
    if (token === undefined) {
        throw new PrimitiveError(
            'Animated.timing',
            subject,
            'is a function this layer did not mint. `Adw.TimedAnimation:easing` is an ENUM with no callback form (measured), so an arbitrary easing function cannot drive an animation at all — only a value from this package’s `Easing` can, and each one carries the AdwEasing member it was measured equal to. Sampling the function to guess the nearest member is what this refusal exists instead of',
        );
    }
    const member = FAMILIES[token.family]?.[token.direction] ?? null;
    if (member === null) {
        throw new PrimitiveError(
            'Animated.timing',
            `${subject} Easing.${token.direction}(Easing.${token.family})`,
            FAMILIES[token.family]?.hole ?? 'has no AdwEasing counterpart',
        );
    }
    return member;
}

/**
 * Mint a callable token for one (family, direction).
 *
 * CALLABLE, with `Adw.easing_ease` behind it, because that is what makes the table
 * above checkable from outside: `easing.spec.ts` samples the token and compares it
 * with a transcription of React Native's own formula. A branded opaque object would
 * have made the equivalence an assertion in a comment.
 */
function mint(family: string, direction: EasingDirection): EasingFunction {
    const token: EasingFunction = (t: number): number => {
        const member = FAMILIES[family]?.[direction] ?? null;
        if (member === null) {
            throw new PrimitiveError('Animated.Easing', `${direction}(${family})`, FAMILIES[family]?.hole ?? '');
        }
        return Adw.easing_ease(adwEasing(member), t);
    };
    TOKENS.set(token, { family, direction });
    return token;
}

const family = (name: string): EasingFunction => mint(name, 'in');

const REFUSED = (name: string, detail: string): never => {
    throw new PrimitiveError('Animated.Easing', name, detail);
};

/** The direction combinators, over the family a token already names. */
function redirect(easing: unknown, direction: EasingDirection): EasingFunction {
    if (typeof easing !== 'function') {
        return REFUSED(direction, `takes an easing function, and received ${easing === null ? 'null' : typeof easing}`);
    }
    const token = TOKENS.get(easing as EasingFunction);
    if (token === undefined) {
        return REFUSED(
            direction,
            'takes one of Easing’s own values. Reflecting an arbitrary function is arithmetic React Native can do and `Adw.TimedAnimation` cannot use: its `easing` is an enum, so the result has to name a member, and only a token this module minted does',
        );
    }
    if (token.direction !== 'in') {
        return REFUSED(
            `${direction}(${token.direction}(${token.family}))`,
            'composes two directions, and AdwEasing has exactly three per family — there is no member for a twice-reflected curve. Apply the combinator to the family itself',
        );
    }
    // The refusal for a family with no member in this direction fires HERE rather
    // than at `timing()`, because this is where the request becomes unsatisfiable and
    // a stack at this line names the call the author wrote.
    if (FAMILIES[token.family]?.[direction] === null) {
        return REFUSED(`${direction}(${token.family})`, FAMILIES[token.family]?.hole ?? '');
    }
    return mint(token.family, direction);
}

/**
 * React Native's `Easing`, as far as `AdwEasing` can answer for it.
 *
 * `in` is React Native's own identity (`in(easing) { return easing; }`), so it is
 * spelled that way here too and a token keeps its family through it.
 */
export const Easing = {
    linear: family('linear'),
    ease: family('ease'),
    quad: family('quad'),
    cubic: family('cubic'),
    sin: family('sin'),
    circle: family('circle'),
    exp: family('exp'),
    bounce: family('bounce'),

    /** `poly(2)` is `quad`, `poly(3)` is `cubic`; AdwEasing stops at quint. */
    poly(n: number): EasingFunction {
        const name = POLY[n];
        if (name === undefined) {
            return REFUSED(
                `poly(${n})`,
                'has no AdwEasing member. The enum carries quad, cubic, quart and quint — exponents 2 to 5 — plus linear for 1, and nothing beyond',
            );
        }
        return family(name);
    },

    /** The DEFAULT overshoot only: AdwEasing's back curve has a fixed one. */
    back(s: number = BACK_DEFAULT_S): EasingFunction {
        if (s !== BACK_DEFAULT_S) {
            return REFUSED(
                `back(${s})`,
                `parameterises the overshoot, and AdwEasing's EASE_IN_BACK has a fixed one — measured equal to React Native's back() at its own default ${BACK_DEFAULT_S} and to nothing else. Drop the argument, or animate the overshoot yourself with a second timing`,
            );
        }
        return family('back');
    },

    elastic(bounciness: number = 1): EasingFunction {
        return REFUSED(
            `elastic(${bounciness})`,
            'is a cos³·cos oscillation, and no AdwEasing member is within 1.99e-1 of it — measured against all 35, so this is a missing curve rather than a rounding difference. `Adw.SpringAnimation` is the honest counterpart and it is a different animation class, not an easing',
        );
    },

    bezier(x1: number, y1: number, x2: number, y2: number): EasingFunction {
        return REFUSED(
            `bezier(${x1}, ${y1}, ${x2}, ${y2})`,
            '`Adw.TimedAnimation:easing` is an enum, so a curve it has no member for cannot be expressed at all. `Easing.ease` is the one bezier with a member (0.42, 0, 1, 1 — measured equal to EASE_IN at 1.6e-6)',
        );
    },

    step0(_n: number): number {
        return REFUSED(
            'step0',
            'is a step function, and every AdwEasing member is continuous. A step is an assignment rather than an animation — write the value with `setValue`',
        );
    },

    step1(_n: number): number {
        return REFUSED(
            'step1',
            'is a step function, and every AdwEasing member is continuous. A step is an assignment rather than an animation — write the value with `setValue`',
        );
    },

    in: (easing: EasingFunction): EasingFunction => easing,
    out: (easing: EasingFunction): EasingFunction => redirect(easing, 'out'),
    inOut: (easing: EasingFunction): EasingFunction => redirect(easing, 'inOut'),
} as const;

/** The family names this module mints tokens for. Read by `easing.spec.ts`. */
export const EASING_FAMILIES: readonly string[] = Object.keys(FAMILIES);

/** One family's measured triple, for the spec that re-derives it. */
export const easingTriple = (name: string): FamilyTriple | undefined => FAMILIES[name];
