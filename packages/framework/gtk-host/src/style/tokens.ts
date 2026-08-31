// The design-token scales a utility class resolves against.
//
// ADR 0032 § 3: the FAMILIES are enumerable and declared here; the VALUES are not,
// because they belong to the project. `mt-2xs` and `bg-emphasis` are not Tailwind
// defaults — they are a generated token file, and a compiler that hard-coded the
// scales would cover one application and refuse the next one's vocabulary as a typo.
//
// So this module declares the SHAPE of the scales and how a token is READ out of
// one, and nothing else. Where the scales come from is the consumer's business: a
// Tailwind config, a token JSON, or a literal written by hand. Nothing here reads
// a file.

import { UnknownUtilityError } from './errors.js';

/** A scale: token name → the CSS value it stands for. */
export type Scale = Readonly<Record<string, string>>;

/**
 * Every scale the partition consults.
 *
 * All optional: a project that has no `letterSpacing` scale simply has no
 * `tracking-*` utilities, and asking for one is an error naming the empty scale
 * rather than a silent no-op.
 */
export interface StyleTokens {
    /**
     * The one scale `m-*`, `p-*`, `gap-*`, `inset-*` and the edge utilities read.
     *
     * ONE scale for all of them because that is what a token file actually holds —
     * `mt-2xs` and `gap-2xs` name the same 2xs — and splitting it would ask a
     * project to repeat itself once per family.
     *
     * A value only reaches the WIDGET-PROPERTY channel if it is a pixel length:
     * `margin-top` is a `gint` of device pixels (measured, `gtk-props.ts`) and GTK
     * exposes no unit conversion there. A scale spelled in `rem` therefore still
     * works for padding, which is CSS-only, and is a named error on a margin rather
     * than a silently rounded one.
     */
    readonly spacing?: Scale;
    /** `w-<token>`, falling back to {@link StyleTokens.spacing} — Tailwind's own layering. */
    readonly width?: Scale;
    /** `h-<token>`, falling back to {@link StyleTokens.spacing}. */
    readonly height?: Scale;
    readonly colors?: Scale;
    readonly borderRadius?: Scale;
    readonly borderWidth?: Scale;
    readonly fontSize?: Scale;
    readonly fontWeight?: Scale;
    readonly fontFamily?: Scale;
    readonly letterSpacing?: Scale;
    readonly lineHeight?: Scale;
    readonly opacity?: Scale;
}

/**
 * A minimal set, for tests and for a consumer who has no token file yet.
 *
 * Deliberately SMALL rather than a copy of Tailwind's defaults. A large default
 * scale would let a project's typo resolve against a value nobody chose, which is
 * the failure the declared-vocabulary rule exists to prevent — and it would make
 * "the values come from the project" false in the common case.
 *
 * That decision stands, and {@link TAILWIND_DEFAULT_TOKENS} is not a retreat from
 * it: the measured gap is that a project REPLACING this default with its own
 * generated scales loses `0` and `full`, which nothing in its `@theme` was ever
 * going to declare. The answer is an opt-in a reader can see in their own code, not
 * a wider default nobody chose. This constant stays as small as it is.
 */
export const MINIMAL_TOKENS: StyleTokens = {
    // Two entries, and both earn their place: `0` is what `inset-0` needs and `px`
    // is what a hairline needs. Everything between them is the project's to name.
    spacing: { '0': '0px', px: '1px' },
    colors: { transparent: 'transparent', black: 'rgb(0 0 0)', white: 'rgb(255 255 255)' },
    borderRadius: { none: '0', sm: '2px', DEFAULT: '4px', md: '6px', lg: '8px', full: '9999px' },
    borderWidth: { DEFAULT: '1px', '0': '0', '2': '2px', '4': '4px' },
    fontSize: { sm: '12px', base: '14px', lg: '18px', xl: '24px' },
    fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    opacity: { '0': '0', '50': '0.5', '60': '0.6', '70': '0.7', '80': '0.8', '90': '0.9', '100': '1' },
};

/**
 * The Tailwind defaults a project's own `@theme` does not replace — OPT-IN.
 *
 * MEASURED, and this is the highest-frequency finding of the whole exercise. Running
 * one production-shaped application's real class vocabulary — 87 distinct utilities,
 * 826 occurrences — through this partition with tokens generated mechanically from
 * its Tailwind v4 `@theme` resolves **81 of 87 distinct and 803 of 826 occurrences**.
 * Five of the six failures are one thing: `rounded-full` (11 uses) and
 * `inset-0`/`left-0`/`right-0`/`top-0` (9 between them). The project's declared
 * scales simply have no `full` and no `0`.
 *
 * They have no reason to. **`0` and `full` are not design decisions.** A token source
 * emits the values a designer chose; `inset-0` means "flush" and `rounded-full` means
 * "a pill", and neither is a number anybody picked. A project that declares its whole
 * palette still leans on Tailwind for the STRUCTURAL tokens, and finds out one class
 * at a time.
 *
 * So this set is deliberately NOT a copy of Tailwind's default theme, and the name
 * would be a lie if it carried the numeric ladder: shipping `spacing-4` … `spacing-96`
 * would be shipping a design decision the project has already made differently, which
 * is the opposite of the point. It carries the structural tokens and the keyword sets
 * — the ones a `@theme` has no reason to name — and nothing that is a value someone
 * chose.
 *
 * THREE DIVERGENCES FROM TAILWIND'S OWN NUMBERS, each forced and each measured:
 *
 *   - **Every length is px, not rem.** Tailwind v4's spacing is rem-based. A `rem`
 *     token reaches CSS padding unchanged and is a NAMED ERROR the moment the same
 *     token is asked to become a margin, because `Gtk.Widget:margin-top` is a `gint`
 *     of device pixels with no unit conversion behind it. A rem scale here would
 *     therefore trade "the token is missing" for "the token throws on half the
 *     families", which is worse.
 *   - **`full` is `9999px`, not `calc(infinity * 1px)`.** GTK's parser has no
 *     infinity, and a border radius larger than the box is clamped anyway.
 *   - **`inherit` is absent from the colours.** `color: inherit` parses, but
 *     `alpha(inherit, 0.5)` does not (measured: *"inherit" is not a valid color
 *     name*), so `bg-inherit/50` would be a refusal rather than a colour. The other
 *     four keywords survive the alpha modifier and are carried.
 *
 * Opting in is a VISIBLE LINE in the consumer's code, which is the whole design:
 *
 * ```ts
 * configureStyle({ tokens: mergeTokens(TAILWIND_DEFAULT_TOKENS, projectTokens) });
 * ```
 *
 * Use {@link mergeTokens} and not a spread. `{ ...TAILWIND_DEFAULT_TOKENS,
 * ...projectTokens }` replaces whole SCALES, so a project declaring any `spacing` at
 * all loses `0` again — which is the exact bug this constant exists to answer.
 */
export const TAILWIND_DEFAULT_TOKENS: StyleTokens = {
    // The two structural lengths. Everything between them is the project's.
    spacing: { '0': '0px', px: '1px' },
    colors: {
        transparent: 'transparent',
        current: 'currentColor',
        black: 'rgb(0 0 0)',
        white: 'rgb(255 255 255)',
    },
    borderRadius: { none: '0', DEFAULT: '4px', full: '9999px' },
    borderWidth: { DEFAULT: '1px', '0': '0', '2': '2px', '4': '4px', '8': '8px' },
    // Named weights rather than numbers, which is what a `font-*` utility spells and
    // what a type scale in a `@theme` leaves alone.
    fontWeight: {
        thin: '100',
        extralight: '200',
        light: '300',
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
        extrabold: '800',
        black: '900',
    },
    // Tailwind's documented ladder. It accepts any integer and a SCALE cannot, so
    // this is the set the docs promise rather than the set the generator accepts —
    // an `opacity-63` is a named error listing these, which is the right outcome for
    // a value nobody put in a design system.
    opacity: Object.fromEntries(Array.from({ length: 21 }, (_, step) => [`${step * 5}`, `${step / 20}`])) as Readonly<
        Record<string, string>
    >,
};

/**
 * Several token sets into one, merging PER TOKEN and not per scale.
 *
 * The distinction is the whole function. `{ ...defaults, ...project }` is an object
 * spread over the SCALE names, so a project that declares any `spacing` replaces the
 * default `spacing` wholesale and loses `0` — silently, and visible only as
 * `inset-0` throwing much later. Later sets win token by token, which is what a
 * reader means by "my values on top of the defaults".
 */
export function mergeTokens(...sets: readonly StyleTokens[]): StyleTokens {
    const out: Record<string, Record<string, string>> = {};
    for (const set of sets) {
        for (const [scale, values] of Object.entries(set)) {
            if (values === undefined) continue;
            out[scale] = { ...out[scale], ...values };
        }
    }
    return out as StyleTokens;
}

/**
 * The sentence a scale-miss error adds when Tailwind's defaults DO define the token.
 *
 * The measured six failures each become a one-line fix with this and stay a search
 * without it: "not in the borderRadius scale. Known: l, m, s" sends a reader to
 * invent a radius, where naming the opt-in sends them to the line that was missing.
 * Empty for a token nothing would have answered, so an ordinary typo is not offered
 * a remedy that would not have helped.
 */
export function tailwindDefaultHint(scaleName: string, token: string): string {
    const scale = (TAILWIND_DEFAULT_TOKENS as Readonly<Record<string, Scale | undefined>>)[scaleName];
    if (scale?.[token] === undefined) return '';
    return `. Tailwind's own default scale defines "${token}" (${scale[token]}) — a project's \`@theme\` has no reason to declare it, so spread TAILWIND_DEFAULT_TOKENS into your tokens with mergeTokens() if you rely on it`;
}

/** A token's value, or `undefined` when the scale is absent or does not carry it. */
export const lookupToken = (scale: Scale | undefined, token: string): string | undefined => scale?.[token];

/**
 * A token's value, or a named error that lists what the scale DOES hold.
 *
 * Both halves of the partition read scales, so the reader lives with the scales
 * rather than in whichever half needed it first. Listing the known keys is the
 * whole value of the message: "not in the borderRadius scale" turns a typo into a
 * search, "Known: full, lg, md, none, sm" turns it into a one-line fix.
 */
export function requireToken(scale: Scale | undefined, token: string, utility: string, scaleName: string): string {
    const value = lookupToken(scale, token);
    if (value !== undefined) return value;
    const known = scale === undefined ? '(the scale is not configured)' : Object.keys(scale).sort().join(', ');
    throw new UnknownUtilityError(
        utility,
        `"${token}" is not in the ${scaleName} scale. Known: ${known}${tailwindDefaultHint(scaleName, token)}`,
    );
}
