// Local typed shape for Cairo objects whose runtime methods are missing from
// the GIR-generated `@girs/cairo-1.0` / `@girs/gjs/cairo` typings.
//
// `setExtend()` and `setFilter()` exist at runtime on every Cairo pattern but
// are absent from the .d.ts (the GIR generator emits an empty `class Pattern`
// for "Foreign Struct" types). Rather than reach for `(pat as any).setFilter`
// at every call site, we declare a thin interface here and narrow the
// `Cairo.Pattern` returned by `Cairo.Context.getSource()` through a single
// helper.
//
// Reference: https://www.cairographics.org/manual/cairo-cairo-pattern-t.html
//
// This is a pure type-level construct; runtime behavior is unchanged.

import type Cairo from 'cairo';

/**
 * The `setExtend` / `setFilter` slice that exists at runtime on every
 * `cairo_pattern_t` but is missing from the GIR types. Combined with
 * `Cairo.Pattern` to give us a fully-typed view.
 */
export interface CairoPatternRuntime {
    setExtend(extend: Cairo.Extend): void;
    getExtend(): Cairo.Extend;
    setFilter(filter: Cairo.Filter): void;
    getFilter(): Cairo.Filter;
}

/** A `Cairo.Pattern` augmented with the runtime methods documented above. */
export type CairoPattern = Cairo.Pattern & CairoPatternRuntime;

/**
 * Narrow a `Cairo.Pattern` returned by the GIR API to the augmented type.
 * Returns `null` if the input is missing the runtime methods (e.g. a future
 * Cairo binding that reshapes the API).
 */
export function asCairoPattern(pat: Cairo.Pattern | undefined | null): CairoPattern | null {
    if (!pat) return null;
    const candidate = pat as CairoPattern;
    if (typeof candidate.setFilter !== 'function' || typeof candidate.setExtend !== 'function') {
        return null;
    }
    return candidate;
}
