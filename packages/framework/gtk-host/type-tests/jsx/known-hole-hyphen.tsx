// THE HOLE THIS GATE DOES NOT CLOSE, kept as an executable fixture.
//
// TypeScript exempts every HYPHEN-CONTAINING JSX attribute from excess-property
// checking — on intrinsics and on components alike — so an attribute name that
// exists nowhere in the surface is accepted in silence as long as it carries a
// hyphen. There is deliberately NO `@ts-expect-error` on the lines below: they
// compile clean, and that is the measurement.
//
// What was tried, from the `jsx-runtime.ts` header: three index-signature shapes
// (`` `${string}-${string}` `` mapped to `unknown`, to `never`, and to a
// subtracted union). All three either changed nothing or collided with the
// declared kebab keys (TS2411).
//
// What IS still checked, and why both spellings are generated:
//
//   - the camelCase spelling of every property (`negative-props.tsx` §unknownProp)
//   - the VALUE type of a DECLARED kebab key — `baseline-child="0"` is an error
//     (`negative-props.tsx` §kebabWrongType). The exemption is from EXCESS-property
//     checking only; a key the surface declares is still assignability-checked.
//
// So the rule for consumers is: prefer the camelCase spelling, because it is the
// one a typo cannot hide in. This file exists so that a future TypeScript which
// closes the hole turns this fixture RED and someone deletes it — a hole recorded
// only in prose is a hole nobody re-measures.

/** Accepted, and should not be: no widget carries `no-such`. */
export const unknownHyphenated = <gtk-box no-such={1} />;

/** Accepted, and should not be: not even the value type is looked at. */
export const unknownHyphenatedAnyValue = <gtk-box also-no-such={{ deeply: 'wrong' }} />;

/** Accepted, and should not be: a MISSPELLED kebab key is just another hyphen. */
export const misspelledKebab = <gtk-box basline-child={0} />;
