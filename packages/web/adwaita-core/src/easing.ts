// `AdwEasing` + `adw_lerp` — the interpolation vocabulary, headless (ADR 0004).
//
// Only the curves something in this package actually uses are ported; the rest of
// `AdwEasing` would be functions no widget calls, which ADR 0004 exists to prevent.
//
// Reference: refs/libadwaita/src/adw-animation-util.c (adw_lerp)
// Reference: refs/libadwaita/src/adw-easing.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** `adw_lerp` — `a * (1 - t) + b * t`. */
export function adwLerp(a: number, b: number, t: number): number {
    return a * (1 - t) + b * t;
}

/**
 * The inverse: where `r` sits between `a` and `b`, as a 0..1 fraction. Not a
 * libadwaita function — C writes the division inline at each call site.
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
 * `ease_in_out_sine` — `-0.5 * (cos(pi * t) - 1)`, with the duration argument at its
 * only used value, 1. The curve the spinner's arc breathes on at BOTH ends:
 * `get_arc_start` eases the extend phase, `get_arc_end` the contract phase.
 */
export function easeInOutSine(t: number): number {
    return -0.5 * (Math.cos(Math.PI * t) - 1);
}
