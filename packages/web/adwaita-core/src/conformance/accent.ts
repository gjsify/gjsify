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

/** One colour a desktop may report → the accent libadwaita snaps it to. */
export interface NearestAccentVector {
    /** The system colour, `#rrggbb`. */
    color: string;
    /** `adw_accent_color_nearest_from_rgba (color)`, lowercased. */
    expected: AdwAccentColorName;
    /** Which palette the colour comes from, as libadwaita's test groups it. */
    source: string;
}

/**
 * `adw_accent_color_nearest_from_rgba` reference cases, transcribed verbatim
 * from libadwaita's own test (`tests/test-accent-color.c` at the pinned
 * `refs/libadwaita` commit): the GNOME icon palette and the accent sets of
 * elementary, KDE, Ubuntu, Cinnamon, COSMIC and macOS. Unlike the table above
 * these are upstream's EXPECTATIONS, not a runtime read-out: the function is
 * private in libadwaita, so introspection cannot reach it.
 *
 * The test's first loop, each of the nine palette colours mapping to itself,
 * is asserted from `ACCENT_COLOR_VECTORS` rather than repeated here.
 */
export const NEAREST_ACCENT_VECTORS: ReadonlyArray<NearestAccentVector> = [
    { color: '#99c1f1', expected: 'blue', source: 'Icon palette — blue 1' },
    { color: '#62a0ea', expected: 'blue', source: 'Icon palette — blue 2' },
    { color: '#3584e4', expected: 'blue', source: 'Icon palette — blue 3' },
    { color: '#1c71d8', expected: 'blue', source: 'Icon palette — blue 4' },
    { color: '#1a5fb4', expected: 'blue', source: 'Icon palette — blue 5' },
    { color: '#8ff0a4', expected: 'green', source: 'Icon palette — green 1' },
    { color: '#57e389', expected: 'green', source: 'Icon palette — green 2' },
    { color: '#33d17a', expected: 'green', source: 'Icon palette — green 3' },
    { color: '#2ec27e', expected: 'green', source: 'Icon palette — green 4' },
    { color: '#26a269', expected: 'green', source: 'Icon palette — green 5' },
    { color: '#f9f06b', expected: 'yellow', source: 'Icon palette — yellow 1' },
    { color: '#f8e45c', expected: 'yellow', source: 'Icon palette — yellow 2' },
    { color: '#f6d32d', expected: 'yellow', source: 'Icon palette — yellow 3' },
    { color: '#f5c211', expected: 'yellow', source: 'Icon palette — yellow 4' },
    { color: '#e5a50a', expected: 'yellow', source: 'Icon palette — yellow 5' },
    { color: '#ffbe6f', expected: 'orange', source: 'Icon palette — orange 1' },
    { color: '#ffa348', expected: 'orange', source: 'Icon palette — orange 2' },
    { color: '#ff7800', expected: 'orange', source: 'Icon palette — orange 3' },
    { color: '#e66100', expected: 'orange', source: 'Icon palette — orange 4' },
    { color: '#c64600', expected: 'orange', source: 'Icon palette — orange 5' },
    { color: '#f66151', expected: 'red', source: 'Icon palette — red 1' },
    { color: '#ed333b', expected: 'red', source: 'Icon palette — red 2' },
    { color: '#e01b24', expected: 'red', source: 'Icon palette — red 3' },
    { color: '#c01c28', expected: 'red', source: 'Icon palette — red 4' },
    { color: '#a51d2d', expected: 'red', source: 'Icon palette — red 5' },
    { color: '#dc8add', expected: 'purple', source: 'Icon palette — purple 1' },
    { color: '#c061cb', expected: 'purple', source: 'Icon palette — purple 2' },
    { color: '#9141ac', expected: 'purple', source: 'Icon palette — purple 3' },
    { color: '#813d9c', expected: 'purple', source: 'Icon palette — purple 4' },
    { color: '#613583', expected: 'purple', source: 'Icon palette — purple 5' },
    { color: '#cdab8f', expected: 'orange', source: 'Icon palette — brown 1' },
    { color: '#b5835a', expected: 'orange', source: 'Icon palette — brown 2' },
    { color: '#986a44', expected: 'orange', source: 'Icon palette — brown 3' },
    { color: '#865e3c', expected: 'orange', source: 'Icon palette — brown 4' },
    { color: '#63452c', expected: 'orange', source: 'Icon palette — brown 5' },
    { color: '#ffffff', expected: 'slate', source: 'Icon palette — light 1' },
    { color: '#f6f5f4', expected: 'slate', source: 'Icon palette — light 2' },
    { color: '#deddda', expected: 'slate', source: 'Icon palette — light 3' },
    { color: '#c0bfbc', expected: 'slate', source: 'Icon palette — light 4' },
    { color: '#9a9996', expected: 'slate', source: 'Icon palette — light 5' },
    { color: '#77767b', expected: 'slate', source: 'Icon palette — dark 1' },
    { color: '#5e5c64', expected: 'slate', source: 'Icon palette — dark 2' },
    { color: '#3d3846', expected: 'slate', source: 'Icon palette — dark 3' },
    { color: '#241f31', expected: 'slate', source: 'Icon palette — dark 4' },
    { color: '#000000', expected: 'slate', source: 'Icon palette — dark 5' },
    { color: '#3689e6', expected: 'blue', source: 'elementary — blueberry' },
    { color: '#28bca3', expected: 'teal', source: 'elementary — mint' },
    { color: '#68b723', expected: 'green', source: 'elementary — lime' },
    { color: '#f9c440', expected: 'yellow', source: 'elementary — banana' },
    { color: '#ffa154', expected: 'orange', source: 'elementary — orange' },
    { color: '#ed5353', expected: 'red', source: 'elementary — strawberry' },
    { color: '#de3e80', expected: 'pink', source: 'elementary — bubblegum' },
    { color: '#a56de2', expected: 'purple', source: 'elementary — grape' },
    { color: '#8a715e', expected: 'orange', source: 'elementary — cocoa' },
    { color: '#667885', expected: 'slate', source: 'elementary — slate' },
    { color: '#ef75b8', expected: 'pink', source: 'KDE (light)' },
    { color: '#ef778a', expected: 'red', source: 'KDE (light)' },
    { color: '#ef9275', expected: 'orange', source: 'KDE (light)' },
    { color: '#eeda6b', expected: 'yellow', source: 'KDE (light)' },
    { color: '#77e066', expected: 'green', source: 'KDE (light)' },
    { color: '#4ce0cd', expected: 'teal', source: 'KDE (light)' },
    { color: '#77c6ef', expected: 'blue', source: 'KDE (light)' },
    { color: '#cd9ee6', expected: 'purple', source: 'KDE (light)' },
    { color: '#b299ec', expected: 'purple', source: 'KDE (light)' },
    { color: '#95979a', expected: 'slate', source: 'KDE (light)' },
    { color: '#ab3175', expected: 'pink', source: 'KDE (dark)' },
    { color: '#ab3347', expected: 'red', source: 'KDE (dark)' },
    { color: '#ab4f32', expected: 'orange', source: 'KDE (dark)' },
    { color: '#aa9729', expected: 'yellow', source: 'KDE (dark)' },
    { color: '#329d23', expected: 'green', source: 'KDE (dark)' },
    { color: '#089c8a', expected: 'teal', source: 'KDE (dark)' },
    { color: '#3282ac', expected: 'blue', source: 'KDE (dark)' },
    { color: '#885aa3', expected: 'purple', source: 'KDE (dark)' },
    { color: '#6e56a9', expected: 'purple', source: 'KDE (dark)' },
    { color: '#505357', expected: 'slate', source: 'KDE (dark)' },
    { color: '#e95420', expected: 'orange', source: 'Ubuntu' },
    { color: '#787859', expected: 'yellow', source: 'Ubuntu — bark' },
    { color: '#657b69', expected: 'slate', source: 'Ubuntu — sage' },
    { color: '#4b8501', expected: 'green', source: 'Ubuntu — olive' },
    { color: '#03875b', expected: 'green', source: 'Ubuntu — viridian' },
    { color: '#308280', expected: 'teal', source: 'Ubuntu — prussian green' },
    { color: '#0073e5', expected: 'blue', source: 'Ubuntu' },
    { color: '#7764d8', expected: 'purple', source: 'Ubuntu' },
    { color: '#b34cb3', expected: 'purple', source: 'Ubuntu — magenta' },
    { color: '#da3450', expected: 'red', source: 'Ubuntu' },
    { color: '#0c75de', expected: 'blue', source: 'Cinnamon' },
    { color: '#1f9ede', expected: 'blue', source: 'Cinnamon' },
    { color: '#199ca8', expected: 'teal', source: 'Cinnamon' },
    { color: '#35a854', expected: 'green', source: 'Cinnamon' },
    { color: '#c5a07c', expected: 'orange', source: 'Cinnamon' },
    { color: '#70737a', expected: 'slate', source: 'Cinnamon' },
    { color: '#ff7139', expected: 'orange', source: 'Cinnamon' },
    { color: '#e82127', expected: 'red', source: 'Cinnamon' },
    { color: '#e54980', expected: 'pink', source: 'Cinnamon' },
    { color: '#8c5dd9', expected: 'purple', source: 'Cinnamon' },
    { color: '#63d0df', expected: 'teal', source: 'COSMIC (light)' },
    { color: '#a1c0eb', expected: 'blue', source: 'COSMIC (light)' },
    { color: '#e79cfe', expected: 'purple', source: 'COSMIC (light)' },
    { color: '#ff9cb1', expected: 'pink', source: 'COSMIC (light)' },
    { color: '#fda1a0', expected: 'red', source: 'COSMIC (light)' },
    { color: '#ffad00', expected: 'orange', source: 'COSMIC (light)' },
    { color: '#f7e062', expected: 'yellow', source: 'COSMIC (light)' },
    { color: '#92cf9c', expected: 'green', source: 'COSMIC (light)' },
    { color: '#cabab4', expected: 'slate', source: 'COSMIC (light)' },
    { color: '#00525a', expected: 'teal', source: 'COSMIC (dark)' },
    { color: '#2e496d', expected: 'blue', source: 'COSMIC (dark)' },
    { color: '#68217c', expected: 'purple', source: 'COSMIC (dark)' },
    { color: '#86043a', expected: 'pink', source: 'COSMIC (dark)' },
    { color: '#78292e', expected: 'red', source: 'COSMIC (dark)' },
    { color: '#624000', expected: 'orange', source: 'COSMIC (dark)' },
    { color: '#534800', expected: 'yellow', source: 'COSMIC (dark)' },
    { color: '#185529', expected: 'green', source: 'COSMIC (dark)' },
    { color: '#554742', expected: 'slate', source: 'COSMIC (dark)' },
    { color: '#017bff', expected: 'blue', source: 'macOS' },
    { color: '#a550a7', expected: 'purple', source: 'macOS' },
    { color: '#f8509e', expected: 'pink', source: 'macOS' },
    { color: '#ff5257', expected: 'red', source: 'macOS' },
    { color: '#f7821a', expected: 'orange', source: 'macOS' },
    { color: '#ffc602', expected: 'yellow', source: 'macOS' },
    { color: '#62ba46', expected: 'green', source: 'macOS' },
    { color: '#8c8c8c', expected: 'slate', source: 'macOS' },
    { color: '#dbb861', expected: 'yellow', source: 'macOS M1 iMac colors' },
    { color: '#537d82', expected: 'teal', source: 'macOS M1 iMac colors' },
    { color: '#4e7189', expected: 'blue', source: 'macOS M1 iMac colors' },
    { color: '#b15358', expected: 'red', source: 'macOS M1 iMac colors' },
    { color: '#606289', expected: 'purple', source: 'macOS M1 iMac colors' },
    { color: '#d87d5b', expected: 'orange', source: 'macOS M1 iMac colors' },
];
