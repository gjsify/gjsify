// GLib primitives that Adwaita's own arithmetic is written in terms of.
//
// Small on purpose: these live here rather than inside whichever widget module
// happened to need one first, because two of them already did. `glibClamp`
// was written twice — once for the avatar's font-size cap, once for the split
// views' sidebar bounds — and a second copy of a primitive is exactly the shape
// this package exists to remove.
//
// Reference: refs/glib/glib/gmacros.h (CLAMP)
// Copyright (c) GNOME contributors (GLib). LGPLv2.1+.

/**
 * GLib's `CLAMP`, which tests the HIGH bound FIRST:
 * `x > high ? high : (x < low ? low : x)`.
 *
 * NOT interchangeable with `Math.min(high, Math.max(low, x))` — the two disagree
 * whenever the bounds are inverted, and Adwaita reaches inverted bounds for
 * real: a split view's sidebar caps invert whenever the content minimum exceeds
 * what is left of the width.
 */
export function glibClamp(x: number, low: number, high: number): number {
    return x > high ? high : x < low ? low : x;
}
