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
    type ValueVocabulary,
} from './primitives/answers.js';
import {
    describeValue,
    PrimitiveError,
    primitiveErrorMessage,
    unknownAccessibleKeyDetail,
    unknownMappedValueDetail,
} from './primitives/errors.js';
import { FRAMEWORK_PROPS, PRIMITIVE_NAMES, PRIMITIVES, type PrimitiveSpec } from './primitives/table.js';

export type { PropAnswer, PropStatus, ValueVocabulary };

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

/**
 * The values (or record keys) this prop refuses by name, each with its reason.
 *
 * Empty for most props. `accessibilityRole` is the one that made this necessary: it is
 * an ACCEPTED property route and a handful of React Native's role names have no GTK
 * member, each answered with its own sentence — and until #1555 not one of them was
 * reachable except by rendering it and catching the throw.
 */
export function propRefusedValues(primitive: string, prop: string, variant?: PropVariant): readonly string[] {
    return Object.keys(propAnswer(primitive, prop, variant).refuses).sort();
}

/**
 * Would `<Primitive prop={value}>` render?
 *
 * `false` when the PROP is refused and when this particular VALUE is, which are two
 * different fixes and therefore two different sentences — see {@link explainPropValue}.
 */
export function acceptsPropValue(primitive: string, prop: string, value: unknown, variant?: PropVariant): boolean {
    return explainPropValue(primitive, prop, value, variant) === null;
}

/** Does this prop's declared vocabulary contain this value? */
function vocabularyAccepts(vocabulary: ValueVocabulary, value: unknown): boolean {
    if (vocabulary.numbers && typeof value === 'number' && Number.isFinite(value)) return true;
    // `String(value)` because the table keys a boolean prop's two answers as `'true'`
    // and `'false'` — an object literal cannot be keyed by `true`, and `lookup` in
    // `resolve.ts` reads the map exactly this way.
    return vocabulary.values.includes(String(value));
}

/**
 * The sentence a render would print for this prop with THIS value.
 *
 * `null` when it renders. The subject is built here rather than in `answers.ts`, which
 * may hold no relative value import (ADR 0039 § 2, and the generator that imports it
 * under Node type stripping is why) — so the formatter the throw uses lives in
 * `errors.ts` and both call it.
 *
 * TWO GRAINS OF REFUSAL, AND THE SECOND ONE WAS MISSING (#1648). A prop can refuse a
 * value by NAME — `answer.refuses`, a deny-list with a reason per entry — and it can
 * refuse one by OMISSION from the list its route maps: `pointerEvents` is
 * `{ auto, none }`, `box-none` is a real React Native spelling with no GTK
 * expression, and a render throws on it. Reading only the deny-list answered ACCEPTED
 * for the second kind on every mapped property, every `announce` route and every
 * accessible record — and a consumer deleted a working `box-none` mapping of their
 * own because a green test said the layer had caught up.
 *
 * What is still NOT answered here is the TYPE grain: `coerce` refuses a non-boolean
 * for `editable` and a non-function for `onPress`, and neither is a list this table
 * can publish. `acceptsPropValue` is an oracle for the vocabulary, not for the type.
 */
export function explainPropValue(
    primitive: string,
    prop: string,
    value: unknown,
    variant?: PropVariant,
): string | null {
    const answer = propAnswer(primitive, prop, variant);
    if (!isAccepted(answer.status)) return explainProp(primitive, prop, variant);
    const reason = answer.refuses[String(value)];
    // Two subjects, because the two grains throw differently and this has to be the
    // same string as the throw: a mapped property names the value, an accessible record
    // names the KEY it carries. `resolve.ts` and `accessibility.ts` are the two throws.
    if (reason !== undefined) {
        return answer.status === 'accessible'
            ? primitiveErrorMessage(primitive, `prop "${prop}"`, `carries "${String(value)}", which ${reason}`)
            : primitiveErrorMessage(primitive, `prop "${prop}" = ${describeValue(value)}`, reason);
    }
    // AFTER the deny-list, the same order `lookup` reads them in: a value the table
    // refuses BY NAME must answer with its own reason rather than with "Known: …".
    if (answer.allows !== null && !vocabularyAccepts(answer.allows, value)) {
        return answer.status === 'accessible'
            ? primitiveErrorMessage(
                  primitive,
                  `prop "${prop}"`,
                  unknownAccessibleKeyDetail(String(value), answer.allows.values),
              )
            : primitiveErrorMessage(
                  primitive,
                  `prop "${prop}"`,
                  unknownMappedValueDetail(describeValue(value), answer.allows.values),
              );
    }
    return null;
}

/**
 * The values this prop accepts by name, or `null` when the table enumerates none.
 *
 * The reader for {@link PropAnswer.allows}, beside `propRefusedValues` because they
 * are the two halves of one question and a consumer holding a ledger of "which props
 * has the layer caught up on" needs both: a deny-list says which spellings have a
 * reason, an allow-list says which ones exist at all.
 */
export function propAllowedValues(primitive: string, prop: string, variant?: PropVariant): readonly string[] | null {
    const allows = propAnswer(primitive, prop, variant).allows;
    return allows === null ? null : [...allows.values].sort();
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
