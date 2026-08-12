// Accent-colour conformance vectors — the spec every renderer is held to.
//
// HOW THESE WERE OBTAINED, WHICH IS THE POINT. Every value below was read out of
// libadwaita 1.9.2 at runtime through GObject introspection —
// `Adw.AccentColor.to_rgba` and `Adw.AccentColor.to_standalone_rgba(color,
// dark)` — and not derived from a reading of `adw-accent-color.c`. A vector
// derived from the same misreading as the code cannot catch it, and the
// standalone colours are an OkLab round-trip: exactly the kind of arithmetic
// where a transcription error produces plausible-looking numbers.
//
// The generator, for whoever needs to refresh this against a newer libadwaita:
//
//   const Adw = imports.gi.Adw; Adw.init();
//   const rgba = Adw.AccentColor.to_standalone_rgba(Adw.AccentColor.BLUE, false);
//
// The browser suite drives this table through `getComputedStyle` on a real
// element (`adwaita-web/src/adw-accent.spec.ts`), so the arithmetic below is held
// against what actually reaches a cascade — not only against itself.
//
// Reference: refs/libadwaita/src/adw-accent-color.c
// Reference: refs/libadwaita/src/stylesheet/_colors.scss:146-170
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { AdwAccentColorName } from '../accent.js';

/** One accent → its background and both standalone colours. */
export interface AccentColorVector {
    /** The `AdwAccentColor` member, lowercased. */
    name: AdwAccentColorName;
    /** `adw_accent_color_to_rgba` — the background colour. */
    background: string;
    /** `adw_accent_color_to_standalone_rgba (…, FALSE)` — for a light surface. */
    standaloneLight: string;
    /** `adw_accent_color_to_standalone_rgba (…, TRUE)` — for a dark surface. */
    standaloneDark: string;
}

/**
 * The nine accents of `AdwAccentColor`, measured against libadwaita 1.9.2.
 *
 * The background colours also appear in the C as literals; the standalone ones
 * appear NOWHERE as literals — they are what `min(l, 0.5)` / `max(l, 0.85)`
 * produce, which is why this table is the only place they are written down.
 */
export const ACCENT_COLOR_VECTORS: ReadonlyArray<AccentColorVector> = [
    { name: 'blue', background: '#3584e4', standaloneLight: '#0461be', standaloneDark: '#81d0ff' },
    { name: 'teal', background: '#2190a4', standaloneLight: '#007184', standaloneDark: '#7bdff4' },
    { name: 'green', background: '#3a944a', standaloneLight: '#15772e', standaloneDark: '#8de698' },
    { name: 'yellow', background: '#c88800', standaloneLight: '#905300', standaloneDark: '#ffc057' },
    { name: 'orange', background: '#ed5b00', standaloneLight: '#b62200', standaloneDark: '#ff9c5b' },
    { name: 'red', background: '#e62d42', standaloneLight: '#c00023', standaloneDark: '#ff888c' },
    { name: 'pink', background: '#d56199', standaloneLight: '#a2326c', standaloneDark: '#ffa0d8' },
    { name: 'purple', background: '#9141ac', standaloneLight: '#8939a4', standaloneDark: '#fba7ff' },
    { name: 'slate', background: '#6f8396', standaloneLight: '#526678', standaloneDark: '#bbd1e5' },
];
