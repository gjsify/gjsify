// TAG negatives for the REACT dialect: what must NOT be an element.
//
// Each line carries a `@ts-expect-error` and is therefore its OWN assertion:
// TypeScript reports an UNUSED `@ts-expect-error` as an error (TS2578), so the
// half reduces to "exit code 0" and no error output has to be parsed. The
// annotation grammar is
//
//     // @ts-expect-error TS<code>[ needs=<setting>] — <why>
//
// and `scripts/check-type-surfaces.mjs` reads it: it strips the directives into a
// temp copy to prove each line errors WITH THE ANNOTATED CODE, and `needs=` names
// the compiler settings whose absence makes that one negative go green — each of
// which has a probe behind it.
//
// `needs=jsxSurface` is IMPLICIT on every negative in a JSX half.
//
// WHAT THIS FILE DOES AND DOES NOT DUPLICATE. The element LIST is shared: the
// React surface's `GtkReactIntrinsicElements` is a mapped type over the same
// generated `WidgetPropsByTag`/`WidgetClassByTag` the `jsx` half already gates
// property by property, handler by handler, nick by nick. Re-stating that matrix
// here would be a second copy that drifts. What is asserted here is that the
// React runtime REACHES that list at all — the tag negatives below — plus the
// React-specific plumbing in `negative-react-plumbing.tsx`, which is what had
// never been measured.

/** A tag no widget answers to. */
// @ts-expect-error TS2339 — 'gtk-nonsuch' is not a key of JSX.IntrinsicElements
export const unknownTag = <gtk-nonsuch />;

/**
 * A DOM tag — the negative that decides the whole design, in React's version of
 * it.
 *
 * Pointing `jsxImportSource` at `"react"` takes the element list from
 * `@types/react`, and all 208 tags it pre-declares (113 HTML + 4 deprecated HTML +
 * 59 SVG + 32 MathML) become valid on a GTK renderer: `<div/>` type-checks and
 * then renders NOTHING. `needs=ownRuntime` is that measurement kept executable —
 * probe `react-namespace` repoints `jsxImportSource` at `react` and this line, and
 * only this line, goes green.
 */
// @ts-expect-error TS2339 needs=ownRuntime — 'div' must not exist on a GTK surface
export const domTag = <div />;

/** A tag that is a real GType name but not the kebab spelling JSX consults. */
// @ts-expect-error TS2304 needs=none — `GtkBox` reads as a value reference, never as an intrinsic
export const pascalTag = <GtkBox />;
