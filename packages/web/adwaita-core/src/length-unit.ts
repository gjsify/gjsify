// `AdwLengthUnit` — the scale-aware length vocabulary, headless (ADR 0004).
//
// Its own module because three unrelated widget families write lengths in it: the
// split views' `sidebar-width-unit`, the wrap box's `child-spacing-unit` /
// `line-spacing-unit` / `natural-line-length-unit`, and `AdwClamp`'s `unit`.
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
 * `adw_length_unit_to_px` — convert `value` to pixels. `pt` and `sp` both scale with the
 * text-scale factor, which GTK reads from `gtk-xft-dpi`; a renderer with no such setting
 * passes the default 96, where `sp` is a pixel passthrough and `pt` the 4/3 ratio.
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
 * An authored unit → the enum value, or the caller's default. A GObject enum property
 * rejects an out-of-range value and keeps what it had; a renderer reading an HTML
 * attribute or an XML layout has no such gate, so `fallback` is the property's own
 * default — `sp` for the split views, `px` for the wrap box.
 */
export function normalizeLengthUnit(value: unknown, fallback: AdwLengthUnit): AdwLengthUnit {
    return ADW_LENGTH_UNITS.includes(value as AdwLengthUnit) ? (value as AdwLengthUnit) : fallback;
}
