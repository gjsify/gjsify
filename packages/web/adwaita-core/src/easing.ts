// `AdwEasing` + `adw_lerp` — the interpolation vocabulary, headless (ADR 0004).
//
// `chrome.ts` opened with a note that `adwLerp`, `easeOutCubic` and
// `inverseLerp` were "module-private on purpose: they belong to whichever module
// lifts the animation family, and putting the canonical copy here would put it
// in the wrong place". `spinner.ts` is that module, so this is that place.
//
// Only the curves something in this package actually uses are ported. `AdwEasing`
// has 30 of them; porting the other 27 would be 27 functions no test drives and
// no widget calls, which is the shape ADR 0004 exists to prevent.
//
// Reference: refs/libadwaita/src/adw-animation-util.c (adw_lerp)
// Reference: refs/libadwaita/src/adw-easing.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** `adw_lerp` (adw-animation-util.c:23-27) — `a * (1 - t) + b * t`. */
export function adwLerp(a: number, b: number, t: number): number {
    return a * (1 - t) + b * t;
}

/**
 * The inverse: where `r` sits between `a` and `b`, as a 0..1 fraction.
 *
 * Not a libadwaita function — C writes the division inline — but it is the same
 * expression at every call site, and naming it is what keeps the two directions
 * from drifting apart.
 */
export function inverseLerp(a: number, b: number, r: number): number {
    return (r - a) / (b - a);
}

/** `ease_out_cubic` (adw-easing.c) — `(t - 1)^3 + 1`. */
export function easeOutCubic(t: number): number {
    const p = t - 1;
    return p * p * p + 1;
}

/**
 * `ease_in_out_sine` (adw-easing.c:276-281) — `-0.5 * (cos(pi * t) - 1)`, with
 * the duration argument at its only used value, 1.
 *
 * This is the curve the spinner's arc breathes on, at BOTH ends: `get_arc_start`
 * eases the extend phase and `get_arc_end` the contract phase
 * (adw-spinner-paintable.c:121, :141).
 */
export function easeInOutSine(t: number): number {
    return -0.5 * (Math.cos(Math.PI * t) - 1);
}
