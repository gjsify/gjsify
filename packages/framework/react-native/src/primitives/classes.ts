// `className` → variant groups, before anything is resolved.
//
// A variant selects WHEN a declaration applies; the utility says WHAT it declares.
// `@gjsify/gtk-host/style` refuses a utility that still carries a `:` on purpose
// (`resolvePaintUtility`: "strip the variant prefix before resolving"), because a
// resolver that also parsed variants would have to answer for a vocabulary GTK
// expresses through a completely different mechanism — pseudo-classes on a
// generated selector, which is `StyleSheet`'s business, not the partition's.
//
// So this module is the whole of that split, and it is deliberately the ONLY place
// a `:` in a class list is interpreted.
//
// WHY A COMPOUND VARIANT IS A REFUSAL AND NOT A NESTED SELECTOR. Tailwind stacks
// variants (`dark:hover:bg-x`) and each one narrows the previous. GTK CSS can
// stack pseudo-classes too (`.x:hover:active`), so a mechanical translation looks
// available — but the measured vocabulary this layer targets contains exactly ONE
// variant (`active:`, 38 uses across four opacities; ADR 0032 § 3) and NO `dark:`
// at all, because dark mode runs through CSS variables a root class redefines. A
// stacking implementation would therefore ship untested against every input that
// exercises it, and the failure mode of a wrong selector is a style that quietly
// does not apply. One colon, or a named refusal.

import { PrimitiveError } from './errors.js';

/** A class list split into the base group and one group per variant. */
export interface ClassGroups {
    /** Utilities with no variant prefix, in author order — last wins downstream. */
    readonly base: readonly string[];
    /** Variant name → its utilities, in author order. */
    readonly variants: Readonly<Record<string, readonly string[]>>;
}

/** What React Native / NativeWind accept as a `className`. */
export type ClassNameInput = string | readonly (string | false | null | undefined)[] | null | undefined;

/**
 * A class list → `{ base, variants }`.
 *
 * `primitive` is carried only so a refusal can name the element the author wrote;
 * nothing about the split depends on it.
 *
 * WHITESPACE, NOT A SINGLE SPACE: 24 of the measured application's `className=`
 * sites are computed rather than literal (ADR 0032 § 3), and a template literal
 * across lines produces newlines and runs of spaces. Splitting on `' '` left empty
 * tokens, and an empty token reaching `resolveUtility` is an "unknown utility"
 * naming the empty string — a diagnostic that describes the splitter rather than
 * the input.
 */
export function splitVariants(className: ClassNameInput, primitive: string): ClassGroups {
    const base: string[] = [];
    const variants: Record<string, string[]> = {};

    for (const token of tokenise(className)) {
        const colon = token.indexOf(':');
        if (colon === -1) {
            base.push(token);
            continue;
        }
        const variant = token.slice(0, colon);
        const utility = token.slice(colon + 1);
        if (variant === '' || utility === '') {
            throw new PrimitiveError(
                primitive,
                `className "${token}"`,
                'is not a variant: the shape is `<variant>:<utility>`, and one half of this one is empty',
            );
        }
        if (utility.includes(':')) {
            throw new PrimitiveError(
                primitive,
                `className "${token}"`,
                'stacks variants. A variant becomes ONE GTK CSS pseudo-class on the generated selector, and this layer does not compose them — the measured vocabulary it targets has a single variant and no `dark:` at all, so a stacking implementation would ship untested and a wrong selector is a style that silently does not apply',
            );
        }
        (variants[variant] ??= []).push(utility);
    }

    return { base, variants };
}

const tokenise = (className: ClassNameInput): string[] => {
    if (className === null || className === undefined) return [];
    // An ARRAY is accepted because `className={[a, cond && b]}` is ordinary
    // authoring and `false` is what a short-circuit leaves behind. Joining first
    // and splitting once keeps one tokeniser instead of two.
    const text =
        typeof className === 'string' ? className : className.filter((part) => typeof part === 'string').join(' ');
    return text.split(/\s+/).filter((token) => token !== '');
};
