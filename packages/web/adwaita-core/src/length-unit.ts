// `AdwLengthUnit` — the scale-aware length vocabulary, headless (ADR 0004).
//
// libadwaita gives it its own compilation unit because three unrelated widget
// families write lengths in it: the split views' `sidebar-width-unit`, the wrap
// box's `child-spacing-unit` / `line-spacing-unit` /
// `natural-line-length-unit`, and `AdwClamp`'s `unit`. It lives in its own
// module here for the same reason — it arrived inside `split-view.ts`, and the
// second consumer is where a shared helper gets lifted rather than imported
// across a boundary that means nothing to it.
//
// Reference: refs/libadwaita/src/adw-length-unit.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** `AdwLengthUnit` — the unit a scale-aware length is written in. */
export type AdwLengthUnit = 'px' | 'pt' | 'sp';

/** The three units, for validating an attribute against the C enum. */
export const ADW_LENGTH_UNITS: readonly AdwLengthUnit[] = ['px', 'pt', 'sp'];

/** The dpi `adw_length_unit_to_px` falls back to when `gtk-xft-dpi` is unset. */
export const DEFAULT_DPI = 96;

/**
 * `adw_length_unit_to_px` (adw-length-unit.c:57-82) — convert `value` to pixels.
 *
 * `pt` and `sp` both scale with the text-scale factor, which GTK reads from
 * `gtk-xft-dpi`; a renderer that has no such setting passes the default 96, where
 * `sp` is a pixel passthrough and `pt` is the familiar 4/3 ratio.
 */
export function adwLengthToPx(unit: AdwLengthUnit, value: number, dpi: number = DEFAULT_DPI): number {
    switch (unit) {
        case 'pt':
            return (value * dpi) / 72;
        case 'sp':
            return (value * dpi) / 96;
        default:
            return value;
    }
}

/**
 * An authored unit → the enum value, or the caller's default.
 *
 * A GObject enum property REJECTS an out-of-range value and keeps what it had;
 * a renderer reading an HTML attribute or an XML layout has no such gate, so the
 * unusable value has to land somewhere deliberate. `fallback` is the property's
 * own default, which differs between the widgets that use this vocabulary — the
 * split views default to `sp`, the wrap box to `px`.
 */
export function normalizeLengthUnit(value: unknown, fallback: AdwLengthUnit): AdwLengthUnit {
    return ADW_LENGTH_UNITS.includes(value as AdwLengthUnit) ? (value as AdwLengthUnit) : fallback;
}
