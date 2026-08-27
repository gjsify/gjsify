// React Native's `StyleSheet`, which is smaller than it looks and says so.
//
// FOUR OF THE FIVE MEMBERS ARE PURE DATA, and the fifth is the only interesting one.
//
// `create` IS IDENTITY, AND THAT IS THE HONEST ANSWER RATHER THAN A SHORTCUT. React
// Native's `create` once registered each style and returned NUMERIC IDS, which the
// native side resolved; since the ids were removed it returns the object it was
// given (its own implementation is `__DEV__ ? freeze : identity`). So there is
// nothing here to register with.
//
// ADR 0032 § 4 also forbids the alternative. A style object is the SAME normalised
// property set as a class list arriving by a different route, and `create` must feed
// the ONE partition that already exists — which it does, exactly and only, by handing
// the object on: `normalise()` reads it at element-resolution time, through
// `resolveUtilities`' own record, and `partition()` splits it. Validating here would
// be a SECOND partition. And it could not be the same one even if that were wanted:
// half the vocabulary resolves against the parent (`flex-1` is `hexpand` on a row and
// `vexpand` on a column — ADR 0032 § 6), and `create` has no tree.
//
// What `create` does buy is the TYPE: a named style set whose keys a component reads,
// which is what stops `styles.titlee` from being an undefined that renders as nothing.
//
// The object is NOT frozen. React Native freezes in development, and freezing a
// caller's object here would mutate the caller's data — a package that silently made
// an application's own record immutable would be the kind of side effect this
// repository refuses in a getter.

import { flattenStyle, type StyleInput, type StyleObject } from './primitives/style.js';
import { hairlineWidth } from './apis/display.js';
import { PrimitiveError } from './primitives/errors.js';

/** React Native's own shape: a name per style, each a property record. */
export type NamedStyles<T> = { readonly [K in keyof T]: StyleObject };

/**
 * `{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }`.
 *
 * React Native's own object, value for value — and every one of the five properties
 * is routed by L1 (`position` and the four edges), so it needs no special case here.
 * The numeric zeros are what React Native writes and `normalise()` turns each into
 * `"0px"`, which is what the partition reads.
 *
 * On GTK it resolves to the overlay intent with all four edges at 0, which L2 answers
 * as `halign: fill, valign: fill` on an overlay child — the one case where React
 * Native's four offsets and GTK's two alignments agree exactly, because filling both
 * axes is the only inset an overlay child can express without a coordinate pair.
 */
export const absoluteFillObject: StyleObject = {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
};

export const StyleSheet = {
    /**
     * The style set, unchanged — see the header for why that is the honest answer.
     *
     * The signature is React Native's: the generic keeps each key's type, so
     * `styles.title` is a style and `styles.titlee` is a type error.
     */
    create<T extends NamedStyles<T>>(styles: T): T {
        return styles;
    },

    /**
     * A `style` prop → one flat object, later entries winning.
     *
     * L2's `flattenStyle`, exported under React Native's name rather than
     * reimplemented: the resolver has to flatten the same prop with the same
     * precedence, and two functions answering "what does `[a, cond && b]` mean" is
     * the second truth this package keeps lifting out.
     */
    flatten(style: StyleInput): StyleObject {
        return flattenStyle(style);
    },

    /**
     * Two styles into one, React Native's own semantics.
     *
     * `b` wins where both set a property, `null`/`undefined` fall away, and the result
     * is an ARRAY when both are present — because that is what React Native returns
     * and code downstream compares identities. `flatten` is what collapses it.
     */
    compose(a: StyleInput, b: StyleInput): StyleInput {
        if (a === null || a === undefined || a === false) return b;
        if (b === null || b === undefined || b === false) return a;
        return [a, b];
    },

    /**
     * One device pixel, in logical pixels — read fresh, never cached.
     *
     * A GETTER because `Gdk.Display.get_default()` is null until `Gtk.init()`
     * (measured) and real code reads this at module scope: before the display exists
     * the answer is 1, and the same read once the application is running answers from
     * the monitors. A constant would freeze the first of those for the process.
     * `apis/display.ts` holds the measurement and the reason it takes the SMALLEST
     * monitor scale.
     */
    get hairlineWidth(): number {
        return hairlineWidth();
    },

    /**
     * React Native's `absoluteFill`, which is the same object as `absoluteFillObject`.
     *
     * It was a registered style id and is now the object itself, so the two members
     * differ in name only. Both are exported because ported code uses both spellings
     * and an absent one is a `MISSING_EXPORT` rather than a value that behaves.
     */
    absoluteFill: absoluteFillObject,
    absoluteFillObject,

    /**
     * Refused by name: it installs a GLOBAL transform on every style in the process.
     *
     * React Native uses it to let a platform rewrite style values before they reach
     * the native side. Here the equivalent hook already exists and is scoped:
     * `configureStyle({ tokens })` is where a project's own values enter, and a
     * process-wide preprocessor would be a second, invisible one that no element
     * could opt out of.
     */
    setStyleAttributePreprocessor(): never {
        throw new PrimitiveError(
            'StyleSheet',
            'setStyleAttributePreprocessor',
            'installs a process-wide transform on every style value, which this layer answers with a scoped one: `configureStyle({ tokens })` is where a project’s own values enter the vocabulary (ADR 0032 § 3). A global preprocessor beside it would be a second source of truth that no element could opt out of',
        );
    },
} as const;
