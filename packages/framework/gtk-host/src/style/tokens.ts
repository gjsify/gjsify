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
    throw new UnknownUtilityError(utility, `"${token}" is not in the ${scaleName} scale. Known: ${known}`);
}
