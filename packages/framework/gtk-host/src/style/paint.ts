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
// depending on the PARENT) cannot be answered here at all. Reaching a layout utility
// is therefore an ERROR naming the milestone, never a silent drop: a styling layer
// that quietly ignores half its input is invisible in CI and obvious on screen.

import { GTK_CSS_PROPERTIES } from './gtk-css.js';
import type { Scale, StyleTokens } from './tokens.js';

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
 * The utility families the LAYOUT half owns, so this one can name them.
 *
 * Without this list a layout class is indistinguishable from a typo, and the error
 * a user gets says "unknown utility `flex-1`" — which sends them looking for a
 * spelling mistake that is not there. The distinction costs one array.
 */
const LAYOUT_FAMILIES: ReadonlySet<string> = new Set([
    'flex',
    'items',
    'justify',
    'self',
    'gap',
    'm',
    'mt',
    'mr',
    'mb',
    'ml',
    'mx',
    'my',
    'p',
    'pt',
    'pr',
    'pb',
    'pl',
    'px',
    'py',
    'w',
    'h',
    'absolute',
    'relative',
    'top',
    'right',
    'bottom',
    'left',
    'inset',
    'overflow',
    'hidden',
    'grow',
    'shrink',
    'basis',
]);

/** A utility class this vocabulary cannot answer for, and why. */
export class UnknownUtilityError extends Error {
    override readonly name = 'UnknownUtilityError';
    readonly utility: string;
    constructor(utility: string, detail: string) {
        super(`@gjsify/gtk-host/style: "${utility}" — ${detail}`);
        this.utility = utility;
    }
}

const lookup = (scale: Scale | undefined, token: string): string | undefined => scale?.[token];

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
 * One utility class → the properties it sets.
 *
 * Returns a partial record rather than mutating, so a caller can see what a single
 * class contributed — which is what makes the conflict rule below testable.
 */
export function resolveUtility(utility: string, tokens: StyleTokens): PaintProps {
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
            return { borderRadius: required(tokens.borderRadius, 'DEFAULT', utility, 'borderRadius') };
        case 'border':
            noAlpha();
            return { borderWidth: required(tokens.borderWidth, 'DEFAULT', utility, 'borderWidth') };
    }

    const dash = bare.indexOf('-');
    const family = dash === -1 ? bare : bare.slice(0, dash);
    const token = dash === -1 ? '' : bare.slice(dash + 1);

    switch (family) {
        case 'bg': {
            return { backgroundColor: colour(required(tokens.colors, token, utility, 'colors')) };
        }
        case 'opacity': {
            noAlpha();
            return { opacity: required(tokens.opacity, token, utility, 'opacity') };
        }
        case 'rounded': {
            noAlpha();
            const corner = CORNERS[token];
            if (corner !== undefined) {
                return { [corner]: required(tokens.borderRadius, 'DEFAULT', utility, 'borderRadius') } as PaintProps;
            }
            return { borderRadius: required(tokens.borderRadius, token, utility, 'borderRadius') };
        }
        case 'border': {
            const side = BORDER_SIDES[token];
            if (side !== undefined) {
                noAlpha();
                return { [side]: required(tokens.borderWidth, 'DEFAULT', utility, 'borderWidth') } as PaintProps;
            }
            // `border-<n>` is a width, `border-<colour>` is a colour, and the scales
            // decide which — not a hard-coded list of colour names. A token in both
            // scales is a project's own ambiguity and is reported as one.
            const width = lookup(tokens.borderWidth, token);
            const tint = lookup(tokens.colors, token);
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
            throw new UnknownUtilityError(utility, `"${token}" is in neither the borderWidth nor the colors scale`);
        }
        case 'text': {
            // The genuinely ambiguous family, and the scales settle it: `text-sm` is
            // a size, `text-grey-700` a colour — and `text-center` is NEITHER. It is
            // alignment, which is not GTK CSS at all (measured: `No property named
            // "text-align"`), so it belongs to the layout half.
            if (ALIGNMENTS.has(token)) {
                throw new UnknownUtilityError(
                    utility,
                    'text alignment is not GTK CSS — it becomes a widget property (Gtk.Label:xalign) and belongs to the layout half',
                );
            }
            const size = lookup(tokens.fontSize, token);
            const tint = lookup(tokens.colors, token);
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
            throw new UnknownUtilityError(utility, `"${token}" is in neither the fontSize nor the colors scale`);
        }
        case 'font': {
            noAlpha();
            const weight = lookup(tokens.fontWeight, token);
            const familyValue = lookup(tokens.fontFamily, token);
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
            return { letterSpacing: required(tokens.letterSpacing, token, utility, 'letterSpacing') };
        }
        case 'leading': {
            noAlpha();
            return { lineHeight: required(tokens.lineHeight, token, utility, 'lineHeight') };
        }
    }

    if (LAYOUT_FAMILIES.has(family) || LAYOUT_FAMILIES.has(bare)) {
        throw new UnknownUtilityError(
            utility,
            'belongs to the layout half of the partition, which is not implemented yet',
        );
    }
    throw new UnknownUtilityError(utility, 'is not a utility this vocabulary declares');
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

function required(scale: Scale | undefined, token: string, utility: string, scaleName: string): string {
    const value = lookup(scale, token);
    if (value !== undefined) return value;
    const known = scale === undefined ? '(the scale is not configured)' : Object.keys(scale).sort().join(', ');
    throw new UnknownUtilityError(utility, `"${token}" is not in the ${scaleName} scale. Known: ${known}`);
}

/**
 * A class list → the properties it sets, later classes winning.
 *
 * Last-wins is CSS's own rule for equal specificity and the one authors expect from
 * a utility vocabulary. It is done HERE, on the property record, rather than by
 * emitting two declarations and letting GTK resolve them — GTK resolves equal
 * specificity by SHEET ORDER, not by the order of names in `css-classes`, so
 * "the later class wins" would be false the moment two generated classes met.
 */
export function resolveUtilities(utilities: readonly string[], tokens: StyleTokens): PaintProps {
    const out: PaintProps = {};
    for (const utility of utilities) Object.assign(out, resolveUtility(utility, tokens));
    return out;
}

/** What the partition hands back. `props` and `intent` are the layout half's. */
export interface Partitioned {
    /** GTK CSS declarations, `property: value`, without the braces. */
    readonly css: readonly string[];
    /** Widget properties. Empty until the layout half exists. */
    readonly props: Readonly<Record<string, unknown>>;
    /** Placement intents L2 resolves against the parent. Empty until the layout half exists. */
    readonly intent: Readonly<Record<string, unknown>>;
}

/**
 * Properties → GTK CSS.
 *
 * Every emitted name is checked against the MEASURED accepted set rather than
 * trusted: a property this table maps but GTK does not accept would be dropped by
 * GTK's parser with no diagnostic, which is the exact silence the whole partition
 * exists to avoid. The check is cheap and it has caught the one property that looks
 * like paint and is not.
 */
export function partition(props: PaintProps): Partitioned {
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
    return { css, props: {}, intent: {} };
}
