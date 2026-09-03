// The PROP surface, published — `@gjsify/react-native/prop-table`.
//
// `@gjsify/react-native/support-table` answers one question: may this application
// IMPORT this name? It says nothing about props, and the prop answers lived in
// `PRIMITIVES` inside `lib/esm/primitives/table.js`, which is not an entry point at
// all. So a refusal could only be discovered by RENDERING — and that is what it cost.
//
// THE INCIDENT, because the rule without it gets simplified back into the bug. A
// consumer rendered `<Text onPress={…}>`. The layer refuses `onPress` on a
// `Gtk.Label`, correctly — a label emits no `clicked` (measured), and the fix is to
// wrap it in a `<Pressable>`. But the application's tab stack mounts all five tabs
// from the start route, the uncaught `PrimitiveError` came out of a render, and React
// unmounts the whole root when a render throws with no error boundary above it. So
// ONE refused prop on one screen ended the entire tree: the home screen rendered
// nothing either. Measured as two bundles of the same host rendering the same screen —
// 92 125 bytes of widget dump clean against 12 848 bytes with the throw.
//
// AND THE THROW IS STILL RIGHT. A refusal that logged and rendered on would put a
// `<Text onPress>` on screen that never fires — the "callback bug in the application,
// forever" that `primitives/table.ts` exists to remove, delivered to a stderr stream
// that a GTK desktop application's user never sees. The layer's whole thesis is that
// GTK's failure mode is exit 0 and that a silent no-op is the expensive one.
//
// What was missing is not a softer refusal, it is a way to ASK BEFORE RENDERING. That
// is this module: `acceptsProp('Text', 'onPress')` is `false` in a consumer's own test
// suite, before a window exists, and `explainProp` returns the very sentence the
// render would have thrown — `answers.ts` is the one source both read, so the static
// answer and the runtime answer cannot drift. ADR 0039 records the decision.

import {
    answerFor,
    isAccepted,
    propNamesOf,
    unknownPrimitiveDetail,
    type PropAnswer,
    type PropStatus,
} from './primitives/answers.js';
import { PrimitiveError, primitiveErrorMessage } from './primitives/errors.js';
import { FRAMEWORK_PROPS, PRIMITIVE_NAMES, PRIMITIVES, type PrimitiveSpec } from './primitives/table.js';

export type { PropAnswer, PropStatus };

/**
 * Every primitive this layer answers for.
 *
 * The table's own constant, re-exported rather than recomputed: a second
 * `Object.keys(PRIMITIVES)` is a second thing to keep in step for no gain, and this
 * subpath exists precisely so there is one answer.
 */
export { PRIMITIVE_NAMES };

/**
 * One React Native prop that selects a DIFFERENT widget, and therefore a different
 * prop set.
 *
 * `TextInput`'s `multiline` is the only one: `false` is a `Gtk.Entry` and `true` is a
 * `Gtk.TextView`, whose content lives in a buffer rather than a property, so `value`
 * is answered on one and refused on the other. A caller that does not say which gets
 * the base variant, which is what an element with the prop absent resolves to.
 */
export const PRIMITIVE_VARIANTS: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(PRIMITIVES)
        .filter(([, spec]) => spec.switchOn !== undefined)
        .map(([name, spec]) => [name, (spec.switchOn as { prop: string }).prop]),
);

/** Which variant of a primitive to ask about — `{ multiline: true }` for a `TextInput`. */
export type PropVariant = Readonly<Record<string, boolean>>;

function specFor(primitive: string, variant: PropVariant | undefined): PrimitiveSpec {
    const base = PRIMITIVES[primitive];
    if (base === undefined) {
        // The SAME error `resolvePrimitive` throws, so a consumer's test failure reads
        // like the render's would have — and a test that catches `PrimitiveError` does
        // not have to catch a bare `Error` here as well.
        throw new PrimitiveError(primitive, '', unknownPrimitiveDetail(PRIMITIVE_NAMES));
    }
    const branch = base.switchOn;
    if (branch === undefined || variant === undefined || variant[branch.prop] !== true) return base;
    return branch.whenTrue;
}

/**
 * What this layer does about `prop` on `primitive`.
 *
 * The whole answer, not a boolean: the STATUS says which route it takes, `why` is the
 * reason for the two statuses that throw and for the declared no-ops, and `gtk` names
 * what it reaches — the properties, the signal, or nothing.
 */
export function propAnswer(primitive: string, prop: string, variant?: PropVariant): PropAnswer {
    return answerFor(primitive, specFor(primitive, variant), prop, FRAMEWORK_PROPS);
}

/**
 * Would rendering this prop on this primitive succeed?
 *
 * `true` for every prop that reaches GTK **and** for a declared no-op: `ignored` is an
 * answer, not a refusal, and a test that treated it as one would fail on
 * `autoCapitalize` — an ordinary prop that a desktop correctly does nothing with.
 */
export function acceptsProp(primitive: string, prop: string, variant?: PropVariant): boolean {
    return isAccepted(propAnswer(primitive, prop, variant).status);
}

/**
 * The sentence a render would print, for a prop that would not render.
 *
 * `null` for a prop this layer accepts, so `explainProp(…) === null` is the assertion
 * a consumer's test makes and the message is what it prints when it fails.
 */
export function explainProp(primitive: string, prop: string, variant?: PropVariant): string | null {
    const answer = propAnswer(primitive, prop, variant);
    if (isAccepted(answer.status)) return null;
    // `PrimitiveError`'s own formatter, not a second literal shaped like it: the two
    // agreeing is the claim, and a claim held by two copies of a template is the shape
    // that drifts.
    return primitiveErrorMessage(primitive, `prop "${prop}"`, answer.why);
}

/** Every prop name this primitive's table row carries, sorted. Framework props are not among them. */
export function propNames(primitive: string, variant?: PropVariant): readonly string[] {
    return propNamesOf(specFor(primitive, variant));
}

/**
 * The whole surface as plain data — one entry per primitive per prop.
 *
 * For tooling that wants to walk it rather than ask about one name: a lint rule, a
 * migration script, a dashboard. Built on demand rather than exported as a constant,
 * so a consumer that only asks `acceptsProp` never pays for it.
 */
export function propTable(variant?: PropVariant): readonly PropAnswer[] {
    return PRIMITIVE_NAMES.flatMap((primitive) =>
        propNames(primitive, variant).map((prop) => propAnswer(primitive, prop, variant)),
    );
}
