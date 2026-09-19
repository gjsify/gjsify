// The surface, asserted at COMPILE time, through the package's own name.
//
// WHY THIS IS A FILE AND NOT A PARAGRAPH IN A PULL REQUEST
//
// `scripts/check-blueprint-corpus.mjs` holds the eight runtime names on every run, and that is
// the half a type cannot do: it proves the values exist. This is the other half, and nothing
// held it. A consumer narrowing a `Value` or an `Expression` must be able to NAME the arm it
// handles; one dropped re-export and it writes that arm as a structural literal, which keeps
// compiling and stops matching the day the node grows a field. Measured once in a review, an
// exhaustive `switch` over all nine expression arms compiled with no `default` — but a
// measurement that ran once is a dated claim, and a new arm added to `ast.d.mts` would not have
// disturbed it. Here it is a gate: `gjsify run check` compiles this, in CI, on every run.
//
// NEGATIVE FIRST — because a positive-only type gate cannot detect a compiler that read nothing
//
// Every assertion below is satisfied vacuously by a `tsc` that never opened this file: an
// `include` glob that stops matching, a `noEmit` run whose program is empty, a rename that takes
// the file out of the project. That is the repository's most expensive shape, and
// `scripts/check-type-surfaces.mjs` § WHY NEGATIVE-FIRST names the same trap one package over.
// So the last assertion is a FAILURE that must happen: `@ts-expect-error` is reported as an
// unused directive (TS2578) when the line below it compiles, so the file asserts its own
// reading. It is written on `Same`, the helper every assertion above actually runs on, and not
// on some other one. A sentinel exercising a helper the work does NOT use guards nothing:
// measured, with the sentinel written on an `IsNever` that only it used, weakening `Same` to
// `type Same<Union, Named> = true` made all five substantive assertions vacuous and the file
// still compiled, exit 0. That `IsNever` is gone; its only reader was the guard for it. Delete the sentinel and the rest of this file proves nothing. The file's own ABSENCE
// is the one thing it cannot assert, so `tsconfig.json` names it under `files` rather than
// matching it with a glob: renamed or deleted, the project fails to load (TS6053).
//
// WHAT THIS DOES NOT PROVE
//
// Nothing about the IMPLEMENTATION. It reads the `types` condition of `exports`, so it holds
// what `index.d.mts` DECLARES; `index.mjs` is not in the program, and dropping an `export` from
// it leaves this file green — measured. That half belongs to `check-blueprint-corpus.mjs`,
// which imports the package at run time and names any of the eight that stops being a
// function. Two lists, in two files, held by two mechanisms, because neither can see what the
// other does.

import type * as Surface from '@gjsify/blueprint';
import type {
    BindingValue,
    BoolValue,
    CastExpression,
    ClosureExpression,
    Expression,
    IdentExpression,
    IdentValue,
    ItemExpression,
    ListValue,
    LiteralExpression,
    LookupExpression,
    MenuNode,
    NumberValue,
    ObjectNode,
    ObjectValue,
    ParenExpression,
    StringValue,
    TemplateNode,
    TopLevel,
    TryExpression,
    TypeExpression,
    TypeRef,
    TypeValue,
    Value,
} from '@gjsify/blueprint';

/** The module's VALUE exports — the eight names, not the types beside them. */
type SurfaceModule = typeof Surface;

/** Compiles only for `true`; every assertion below is one of these. */
type Assert<T extends true> = T;
/**
 * Both directions: nothing in the union is unnameable, and nothing named has left the union.
 *
 * The two `Exclude`s are compared as a TUPLE rather than checked one at a time, because
 * `[X] extends [never]` is the only spelling that does not distribute — and because a
 * constraint written inside a generic is checked against the unresolved parameter, which is
 * `boolean` and satisfies nothing. `Assert` is applied at each use site instead.
 */
type Same<Union, Named> = [Exclude<Union, Named>, Exclude<Named, Union>] extends [never, never] ? true : false;

/** The eight the flip consumes. `check-blueprint-corpus.mjs` holds the same list at run time. */
export type SurfaceIsExactlyThese = Assert<
    Same<
        keyof SurfaceModule,
        | 'BlueprintSyntaxError'
        | 'accessibilityElement'
        | 'accessibilityValue'
        | 'emitGtkBuilderXml'
        | 'enumOrFlagsTypeOf'
        | 'gtypeName'
        | 'parseBlueprint'
        | 'resolveIdent'
    >
>;

export type EveryValueArmIsNamed = Assert<
    Same<Value, BindingValue | BoolValue | IdentValue | ListValue | NumberValue | ObjectValue | StringValue | TypeValue>
>;

export type EveryExpressionArmIsNamed = Assert<
    Same<
        Expression,
        | CastExpression
        | ClosureExpression
        | IdentExpression
        | ItemExpression
        | LiteralExpression
        | LookupExpression
        | ParenExpression
        | TryExpression
        | TypeExpression
    >
>;

export type EveryRootArmIsNamed = Assert<Same<TopLevel, MenuNode | ObjectNode | TemplateNode>>;

/**
 * A cast names exactly one target, so the `else` of `builtin !== undefined` is a `TypeRef` and
 * not a `TypeRef | undefined` — the branch for an absence the parser cannot construct.
 *
 * Written with `Same` and not `IsNever<Exclude<…>>`, and the difference is the whole assertion.
 * Against the loose spelling this exists to refuse — two independent optionals — the `Extract`
 * matches NOTHING, because `string | undefined` is not assignable to `undefined`; indexing
 * `never` gives `never`, and `IsNever` of an empty extraction is `true`. Measured: that version
 * of this line passed against the very shape it names. `Same` fails it, because the second
 * direction asks whether `TypeRef` is still in there and an empty extraction does not hold it.
 * An assertion that cannot tell "the answer is right" from "there was no question" is the shape
 * the sentinel below guards against, one scope smaller.
 */
export type CastWithoutABuiltinHasAType = Assert<
    Same<Extract<CastExpression, { builtin?: undefined }>['type'], TypeRef>
>;

/** The other arm, for the same reason and by the same measurement. */
export type CastWithoutATypeHasABuiltin = Assert<
    Same<Extract<CastExpression, { type?: undefined }>['builtin'], string>
>;

// THE SENTINEL. `Value` holds more than a string, so `Same` is `false`, `Assert` refuses it and
// TypeScript reports it — which is what makes the unused-directive error impossible and every
// assertion above load-bearing. It runs through BOTH helpers the assertions run through, so
// weakening either one turns this line green and TS2578 fails the check.
// @ts-expect-error
export type SentinelMustFail = Assert<Same<Value, StringValue>>;
