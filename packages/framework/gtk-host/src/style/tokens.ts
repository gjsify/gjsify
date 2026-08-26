// The design-token scales a utility class resolves against.
//
// ADR 0032 § 3: the FAMILIES are enumerable and declared here; the VALUES are not,
// because they belong to the project. `mt-2xs` and `bg-emphasis` are not Tailwind
// defaults — they are a generated token file, and a compiler that hard-coded the
// scales would cover one application and refuse the next one's vocabulary as a typo.
//
// So this module declares the SHAPE of the scales and nothing else. Where they come
// from is the consumer's business: a Tailwind config, a token JSON, or a literal
// written by hand. Nothing here reads a file.

/** A scale: token name → the CSS value it stands for. */
export type Scale = Readonly<Record<string, string>>;

/**
 * Every scale the paint half consults.
 *
 * All optional: a project that has no `letterSpacing` scale simply has no
 * `tracking-*` utilities, and asking for one is an error naming the empty scale
 * rather than a silent no-op.
 */
export interface StyleTokens {
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
    colors: { transparent: 'transparent', black: 'rgb(0 0 0)', white: 'rgb(255 255 255)' },
    borderRadius: { none: '0', sm: '2px', DEFAULT: '4px', md: '6px', lg: '8px', full: '9999px' },
    borderWidth: { DEFAULT: '1px', '0': '0', '2': '2px', '4': '4px' },
    fontSize: { sm: '12px', base: '14px', lg: '18px', xl: '24px' },
    fontWeight: { normal: '400', medium: '500', semibold: '600', bold: '700' },
    opacity: { '0': '0', '50': '0.5', '60': '0.6', '70': '0.7', '80': '0.8', '90': '0.9', '100': '1' },
};
