// TAG negatives: what must NOT be an element.
//
// Each line below carries a `@ts-expect-error` and is therefore its OWN
// assertion: TypeScript reports an UNUSED `@ts-expect-error` as an error
// (TS2578), so the whole half reduces to "exit code 0" and no error output has to
// be parsed. The annotation grammar is
//
//     // @ts-expect-error TS<code>[ needs=<setting>] — <why>
//
// and `scripts/check-type-surfaces.mjs` reads it: it strips the directives into a
// temp copy to prove each line errors WITH THE ANNOTATED CODE (a directive
// suppresses any error, so the code itself is only checkable with the directive
// gone), and `needs=` names the compiler settings whose absence makes that one
// negative go green — each of which has a probe behind it.
//
// `needs=jsxSurface` is IMPLICIT: every negative here depends on the surface being
// wired at all, and spelling it on all of them only invites the copy that forgets
// it. `needs=none` is the escape for a negative that is not a surface check.
//
// One negative per LINE, and the directive on the line before it — the stripped
// run maps a directive on line N to the error it must produce on line N+1.

/** A tag no widget answers to. */
// @ts-expect-error TS2339 — 'gtk-nonsuch' is not a key of JSX.IntrinsicElements
export const unknownTag = <gtk-nonsuch />;

/**
 * A DOM tag — the negative that decides the whole design.
 *
 * Augmenting Solid's own `JSX` namespace instead of shipping our own runtime
 * leaves all 208 tags Solid pre-declares (113 HTML + 4 deprecated HTML + 59 SVG +
 * 32 MathML) valid on a GTK renderer: `<div/>` type-checks and then renders
 * NOTHING, silently. `needs=ownRuntime` is that measurement, kept executable —
 * probe `solid-namespace` repoints `jsxImportSource` at `solid-js` and this line,
 * and only this line, goes green.
 */
// @ts-expect-error TS2339 needs=ownRuntime — 'div' must not exist on a GTK surface
export const domTag = <div />;

/** A tag that is a real GType name but not the kebab spelling JSX consults. */
// @ts-expect-error TS2304 needs=none — `GtkBox` reads as a value reference, never as an intrinsic
export const pascalTag = <GtkBox />;
