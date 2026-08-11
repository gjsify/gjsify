// Typed view of the pattern methods that are unreachable through `Cairo.Context.getSource()`:
// it is declared to return the base `Cairo.Pattern`, which carries no methods at all
// (`@girs/cairo-1.0` emits Foreign Structs as empty classes, `@girs/gjs` adds only `getType()`).
// Narrowing once here beats `(pat as any).setFilter` at every call site.
// Reference: https://www.cairographics.org/manual/cairo-cairo-pattern-t.html

import type Cairo from 'cairo';

/**
 * The `setExtend` / `setFilter` slice of `cairo_pattern_t`. Measured on GJS 1.88 these exist at
 * runtime on `SurfacePattern` only — solid patterns and gradients have neither.
 */
export interface CairoPatternRuntime {
    setExtend(extend: Cairo.Extend): void;
    getExtend(): Cairo.Extend;
    setFilter(filter: Cairo.Filter): void;
    getFilter(): Cairo.Filter;
}

export type CairoPattern = Cairo.Pattern & CairoPatternRuntime;

/**
 * Narrow a `Cairo.Pattern` to the augmented type, or `null` when the runtime methods are absent.
 * `null` is the ordinary answer for a solid pattern or a gradient, not an exotic-binding case.
 */
export function asCairoPattern(pat: Cairo.Pattern | undefined | null): CairoPattern | null {
    if (!pat) return null;
    const candidate = pat as CairoPattern;
    if (typeof candidate.setFilter !== 'function' || typeof candidate.setExtend !== 'function') {
        return null;
    }
    return candidate;
}
