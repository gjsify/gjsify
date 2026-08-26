// The dispatch: one utility vocabulary over two halves that do not know each other.
//
// `paint.ts` and `layout.ts` each answer for the families they own and return
// `null` for everything else. Neither imports the other, and neither has a list of
// the other's families — which is the point. The first version of this seam had
// exactly that list (`LAYOUT_FAMILIES`, in the paint half) so that a layout utility
// could get a better error than "unknown". It worked, and it was a second copy of
// the layout vocabulary living in the file least likely to be edited when the
// layout vocabulary changed.
//
// So the error moves here instead: a utility neither half claims is the only thing
// this module throws, and it can say so because it is the only module that knows
// both answers were `null`.

import { UnknownUtilityError } from './errors.js';
import {
    LAYOUT_PROPERTIES,
    type LayoutIntent,
    type LayoutProps,
    partitionLayout,
    resolveLayoutUtility,
} from './layout.js';
import { PAINT_PROPERTIES, type PaintProps, partitionPaint, resolvePaintUtility } from './paint.js';
import type { StyleTokens } from './tokens.js';

/** One normalised property set, in React Native's spelling (ADR 0032 § 4). */
export type StyleProps = PaintProps & LayoutProps;

/** What the partition hands back — GTK's three destinations, all of them. */
export interface Partitioned {
    /** GTK CSS declarations, `property: value`, without the braces. */
    readonly css: readonly string[];
    /**
     * Widget properties in GTK's own spelling, with values the host will apply.
     *
     * The values are what `applyProps` coerces through the ParamSpec — a nick for
     * an enum, a boolean for a boolean, an integer for a `gint`. NOT what a raw
     * GJS setter accepts: `box.orientation = 'vertical'` keeps HORIZONTAL with no
     * diagnostic at all (measured, gjs 1.88.1), which is the whole reason the host
     * has a coercion step.
     */
    readonly props: Readonly<Record<string, unknown>>;
    /** What only the shadow tree can answer, for L2 at attach time. */
    readonly intent: LayoutIntent;
}

/**
 * One utility class → the properties it sets.
 *
 * Paint runs first, and the order is not arbitrary: the paint families are closed
 * sets of scale names, so its `null` is a cheap "no such family here", while the
 * layout half owns the open-ended spellings (`gap-x-4`, `w-1/2`) whose parsing is
 * where a wrong claim would be expensive.
 */
export function resolveUtility(utility: string, tokens: StyleTokens): StyleProps {
    const paint = resolvePaintUtility(utility, tokens);
    if (paint !== null) return paint;
    const layout = resolveLayoutUtility(utility, tokens);
    if (layout !== null) return layout;
    throw new UnknownUtilityError(utility, 'is not a utility this vocabulary declares');
}

/**
 * A class list → the properties it sets, later classes winning.
 *
 * Last-wins is CSS's own rule for equal specificity and the one authors expect from
 * a utility vocabulary. It is done HERE, on the property record, rather than by
 * emitting two declarations and letting GTK resolve them — GTK resolves equal
 * specificity by SHEET ORDER, not by the order of names in `css-classes`, so
 * "the later class wins" would be false the moment two generated classes met.
 *
 * It is also why `m-*` puts its horizontal half in the same KEYS as `mx-*`: two
 * spellings of one edge only resolve by last-wins while they are one key.
 */
export function resolveUtilities(utilities: readonly string[], tokens: StyleTokens): StyleProps {
    const out: StyleProps = {};
    for (const utility of utilities) Object.assign(out, resolveUtility(utility, tokens));
    return out;
}

/**
 * Properties → `{ css, props, intent }`.
 *
 * Splits the record by ownership and hands each half to its own partition, because
 * the layout half's refusals are CROSS-KEY (a physical and a logical margin
 * together, two gap spellings at once) and it can only see them with its whole
 * share in hand.
 *
 * A property NEITHER half routes throws rather than being skipped. That is the same
 * rule as an unknown utility, one layer down, and it is the one that catches a
 * `style={{…}}` object carrying a React Native property nobody has mapped yet —
 * the front end with no class name to check.
 */
export function partition(props: StyleProps): Partitioned {
    const paint: PaintProps = {};
    const layout: LayoutProps = {};
    for (const [key, value] of Object.entries(props)) {
        if (value === undefined) continue;
        const half = PAINT_PROPERTIES.has(key) ? paint : LAYOUT_PROPERTIES.has(key) ? layout : null;
        if (half === null) {
            throw new UnknownUtilityError(key, 'is not a property the style partition routes');
        }
        (half as Record<string, unknown>)[key] = value;
    }

    const laidOut = partitionLayout(layout);
    return {
        css: [...partitionPaint(paint), ...laidOut.css],
        props: laidOut.props,
        intent: laidOut.intent,
    };
}
