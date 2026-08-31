// The paint half of the style partition: utility classes → properties → GTK CSS.
//
// ADR 0032 § 4 puts ONE normalised property set between the two front ends. A class
// list and a `style={{…}}` object are the same information arriving by different
// routes, so both resolve into the same record and exactly one partition runs
// behind it. Two partitions would be two truths about one question.
//
// The property spelling is React Native's (`backgroundColor`, `borderTopLeftRadius`)
// rather than CSS's, because that is the shape the style objects already have and
// the classes have to be translated either way.
//
// WHAT THIS FILE REFUSES TO DO. It does not touch the layout half — `flex`, `items`,
// `justify`, `gap`, spacing, positioning. Those become widget selection and widget
// properties, and the interesting one (`flex-1` resolving to `hexpand` or `vexpand`
// depending on the PARENT) cannot be answered here at all.
//
// It says so by returning `null`, NOT by throwing. The distinction is the whole
// dispatch in `resolve.ts`: a family this half does not own is somebody else's
// question, while a family it DOES own with a token no scale carries is an error
// here and nowhere else. Collapsing the two would make `mt-2xs` and `bg-nonsuch`
// the same diagnostic, and only one of them is a typo. What must never happen is
// the third option — a silent drop — because a styling layer that quietly ignores
// part of its input is invisible in CI and obvious on screen.

import { UnknownUtilityError } from './errors.js';
import { GTK_CSS_PROPERTIES } from './gtk-css.js';
import { lookupToken, requireToken, tailwindDefaultHint, type StyleTokens } from './tokens.js';

/** The properties the paint half understands, in React Native's spelling. */
export interface PaintProps {
    backgroundColor?: string;
    color?: string;
    opacity?: string;
    borderRadius?: string;
    borderTopLeftRadius?: string;
    borderTopRightRadius?: string;
    borderBottomLeftRadius?: string;
    borderBottomRightRadius?: string;
    borderWidth?: string;
    borderTopWidth?: string;
    borderRightWidth?: string;
    borderBottomWidth?: string;
    borderLeftWidth?: string;
    borderColor?: string;
    fontSize?: string;
    fontWeight?: string;
    fontFamily?: string;
    fontStyle?: string;
    letterSpacing?: string;
    lineHeight?: string;
    textDecorationLine?: string;
    textTransform?: string;
}

/**
 * React Native property name → the GTK CSS property it becomes.
 *
 * Exported so `paint.spec.ts` can assert the invariant this table rests on — that
 * every value is a property GTK measurably accepts — directly, rather than through
 * `partition`'s per-call guard, which no input can reach while the table is right.
 */
export const CSS_NAME: Readonly<Record<keyof PaintProps, string>> = {
    backgroundColor: 'background-color',
    color: 'color',
    opacity: 'opacity',
    borderRadius: 'border-radius',
    borderTopLeftRadius: 'border-top-left-radius',
    borderTopRightRadius: 'border-top-right-radius',
    borderBottomLeftRadius: 'border-bottom-left-radius',
    borderBottomRightRadius: 'border-bottom-right-radius',
    borderWidth: 'border-width',
    borderTopWidth: 'border-top-width',
    borderRightWidth: 'border-right-width',
    borderBottomWidth: 'border-bottom-width',
    borderLeftWidth: 'border-left-width',
    borderColor: 'border-color',
    fontSize: 'font-size',
    fontWeight: 'font-weight',
    fontFamily: 'font-family',
    fontStyle: 'font-style',
    letterSpacing: 'letter-spacing',
    lineHeight: 'line-height',
    textDecorationLine: 'text-decoration-line',
    textTransform: 'text-transform',
};

/**
 * Apply an `/alpha` modifier to a colour value.
 *
 * `bg-always-dark/70` is ordinary in a real vocabulary and cannot be pre-resolved:
 * the base colour is a token and the alpha is per use site. GTK CSS has `alpha()`,
 * which takes any colour expression — including the `rgb(var(--…))` shape a token
 * file emits — so this composes rather than parsing the colour apart.
 */
const withAlpha = (value: string, alpha: string): string => {
    const percent = Number(alpha);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
        throw new UnknownUtilityError(`${value}/${alpha}`, `the alpha modifier must be 0–100, got "${alpha}"`);
    }
    return `alpha(${value}, ${percent / 100})`;
};

/**
 * One utility class → the paint properties it sets, or `null` for "not mine".
 *
 * Returns a partial record rather than mutating, so a caller can see what a single
 * class contributed — which is what makes the last-wins rule testable.
 */
export function resolvePaintUtility(utility: string, tokens: StyleTokens): PaintProps | null {
    // Variants (`active:opacity-70`, `dark:bg-x`) are not this function's business:
    // they select WHEN a declaration applies, which is a CSS pseudo-class or a
    // scheme, and the caller strips them before asking what the utility means.
    if (utility.includes(':')) {
        throw new UnknownUtilityError(
            utility,
            'strip the variant prefix before resolving; this resolves the utility itself',
        );
    }

    const slash = utility.lastIndexOf('/');
    const alpha = slash === -1 ? undefined : utility.slice(slash + 1);
    const bare = slash === -1 ? utility : utility.slice(0, slash);

    const colour = (value: string): string => (alpha === undefined ? value : withAlpha(value, alpha));
    const noAlpha = (): void => {
        if (alpha !== undefined)
            throw new UnknownUtilityError(utility, 'an alpha modifier only applies to a colour utility');
    };

    // Bare families first: `border`, `rounded`, `underline` and friends carry no
    // token and mean the scale's DEFAULT — Tailwind's own convention, and the one
    // a token file already spells `DEFAULT`.
    switch (bare) {
        case 'underline':
            noAlpha();
            return { textDecorationLine: 'underline' };
        case 'line-through':
            noAlpha();
            return { textDecorationLine: 'line-through' };
        case 'no-underline':
            noAlpha();
            return { textDecorationLine: 'none' };
        case 'uppercase':
            noAlpha();
            return { textTransform: 'uppercase' };
        case 'lowercase':
            noAlpha();
            return { textTransform: 'lowercase' };
        case 'capitalize':
            noAlpha();
            return { textTransform: 'capitalize' };
        case 'normal-case':
            noAlpha();
            return { textTransform: 'none' };
        case 'italic':
            noAlpha();
            return { fontStyle: 'italic' };
        case 'not-italic':
            noAlpha();
            return { fontStyle: 'normal' };
        case 'rounded':
            noAlpha();
            return { borderRadius: requireToken(tokens.borderRadius, 'DEFAULT', utility, 'borderRadius') };
        case 'border':
            noAlpha();
            return { borderWidth: requireToken(tokens.borderWidth, 'DEFAULT', utility, 'borderWidth') };
    }

    const dash = bare.indexOf('-');
    const family = dash === -1 ? bare : bare.slice(0, dash);
    const token = dash === -1 ? '' : bare.slice(dash + 1);

    switch (family) {
        case 'bg': {
            return { backgroundColor: colour(requireToken(tokens.colors, token, utility, 'colors')) };
        }
        case 'opacity': {
            noAlpha();
            return { opacity: requireToken(tokens.opacity, token, utility, 'opacity') };
        }
        case 'rounded': {
            noAlpha();
            const corner = CORNERS[token];
            if (corner !== undefined) {
                return {
                    [corner]: requireToken(tokens.borderRadius, 'DEFAULT', utility, 'borderRadius'),
                } as PaintProps;
            }
            return { borderRadius: requireToken(tokens.borderRadius, token, utility, 'borderRadius') };
        }
        case 'border': {
            const side = BORDER_SIDES[token];
            if (side !== undefined) {
                noAlpha();
                return { [side]: requireToken(tokens.borderWidth, 'DEFAULT', utility, 'borderWidth') } as PaintProps;
            }
            // `border-<n>` is a width, `border-<colour>` is a colour, and the scales
            // decide which — not a hard-coded list of colour names. A token in both
            // scales is a project's own ambiguity and is reported as one.
            const width = lookupToken(tokens.borderWidth, token);
            const tint = lookupToken(tokens.colors, token);
            if (width !== undefined && tint !== undefined) {
                throw new UnknownUtilityError(
                    utility,
                    `"${token}" is in both the borderWidth and colors scales, so this utility is ambiguous`,
                );
            }
            if (width !== undefined) {
                noAlpha();
                return { borderWidth: width };
            }
            if (tint !== undefined) return { borderColor: colour(tint) };
            throw new UnknownUtilityError(
                utility,
                `"${token}" is in neither the borderWidth nor the colors scale` +
                    (tailwindDefaultHint('borderWidth', token) || tailwindDefaultHint('colors', token)),
            );
        }
        case 'text': {
            // The genuinely ambiguous family, and the scales settle it: `text-sm` is
            // a size, `text-grey-700` a colour — and `text-center` is NEITHER. It is
            // alignment, which is not GTK CSS at all (measured: `No property named
            // "text-align"`), so it is the layout half's and is handed back
            // UNCLAIMED. It used to throw a bespoke "belongs to the layout half"
            // here, which was right while that half did not exist and is now a
            // refusal of a utility the partition supports.
            if (ALIGNMENTS.has(token)) return null;
            const size = lookupToken(tokens.fontSize, token);
            const tint = lookupToken(tokens.colors, token);
            if (size !== undefined && tint !== undefined) {
                throw new UnknownUtilityError(
                    utility,
                    `"${token}" is in both the fontSize and colors scales, so this utility is ambiguous`,
                );
            }
            if (size !== undefined) {
                noAlpha();
                return { fontSize: size };
            }
            if (tint !== undefined) return { color: colour(tint) };
            throw new UnknownUtilityError(
                utility,
                `"${token}" is in neither the fontSize nor the colors scale` +
                    (tailwindDefaultHint('fontSize', token) || tailwindDefaultHint('colors', token)),
            );
        }
        case 'font': {
            noAlpha();
            const weight = lookupToken(tokens.fontWeight, token);
            const familyValue = lookupToken(tokens.fontFamily, token);
            if (weight !== undefined && familyValue !== undefined) {
                throw new UnknownUtilityError(
                    utility,
                    `"${token}" is in both the fontWeight and fontFamily scales, so this utility is ambiguous`,
                );
            }
            if (weight !== undefined) return { fontWeight: weight };
            if (familyValue !== undefined) return { fontFamily: familyValue };
            throw new UnknownUtilityError(utility, `"${token}" is in neither the fontWeight nor the fontFamily scale`);
        }
        case 'tracking': {
            noAlpha();
            return { letterSpacing: requireToken(tokens.letterSpacing, token, utility, 'letterSpacing') };
        }
        case 'leading': {
            noAlpha();
            return { lineHeight: requireToken(tokens.lineHeight, token, utility, 'lineHeight') };
        }
    }

    return null;
}

const CORNERS: Readonly<Record<string, keyof PaintProps>> = {
    tl: 'borderTopLeftRadius',
    tr: 'borderTopRightRadius',
    bl: 'borderBottomLeftRadius',
    br: 'borderBottomRightRadius',
};

const BORDER_SIDES: Readonly<Record<string, keyof PaintProps>> = {
    t: 'borderTopWidth',
    r: 'borderRightWidth',
    b: 'borderBottomWidth',
    l: 'borderLeftWidth',
};

const ALIGNMENTS: ReadonlySet<string> = new Set(['left', 'center', 'right', 'justify', 'start', 'end']);

/** The {@link PaintProps} keys, for the dispatch's ownership test. */
export const PAINT_PROPERTIES: ReadonlySet<string> = new Set(Object.keys(CSS_NAME));

/**
 * Paint properties → GTK CSS declarations.
 *
 * Every emitted name is checked against the MEASURED accepted set rather than
 * trusted: a property this table maps but GTK does not accept would be dropped by
 * GTK's parser with no diagnostic, which is the exact silence the whole partition
 * exists to avoid. The check is cheap and it has caught the one property that looks
 * like paint and is not.
 */
export function partitionPaint(props: PaintProps): readonly string[] {
    const css: string[] = [];
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined) continue;
        const name = CSS_NAME[key as keyof PaintProps];
        if (name === undefined) {
            throw new UnknownUtilityError(key, 'is not a property the paint partition routes');
        }
        if (!GTK_CSS_PROPERTIES.has(name)) {
            throw new UnknownUtilityError(key, `maps to "${name}", which GTK does not accept — see gtk-css.ts`);
        }
        css.push(`${name}: ${value}`);
    }

    // A WIDTH WITHOUT A STYLE PAINTS NOTHING, and it occupies nothing either. CSS's
    // initial `border-style` is `none`, and `none` zeroes the width.
    //
    // MEASURED on GTK 4.22.4, a Gtk.Box carrying the class and rooted in a window,
    // for no border / width only / width plus `solid`. The SHAPE is part of the
    // measurement, because a box's minimum size is its children's: empty it goes
    // 0x0 -> 0x0 -> 8x8, holding a Label('x') it goes 9x18 -> 9x18 -> 17x26. The
    // invariant is the first two columns being EQUAL on both — a width alone is a
    // class that does absolutely nothing, silently, which is the failure this whole
    // partition exists against. Quoting the 9x18 pair without its shape is how the
    // website came to state a size a reader measuring an empty box gets 0x0 for, and
    // concludes the doc is wrong about the part that is right.
    //
    // Tailwind solves it in its preflight, globally. There is no preflight here — a
    // generated class must be self-sufficient — so the style travels with the width.
    // The `setsStyle` half of the condition has no route through `PaintProps` today:
    // there is no `borderStyle` key and an unrouted property throws, so it guards
    // the day one arrives rather than any input that can reach it now.
    const setsWidth = css.some((declaration) => /^border(-(top|right|bottom|left))?-width:/.test(declaration));
    const setsStyle = css.some((declaration) => /^border(-(top|right|bottom|left))?-style:/.test(declaration));
    if (setsWidth && !setsStyle) css.push('border-style: solid');

    return css;
}
