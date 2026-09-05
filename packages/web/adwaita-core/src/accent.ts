// Adwaita accent colours — headless (ADR 0004).
//
// libadwaita 1.6 turned the accent from a single stylesheet constant into a
// CHOICE: nine named colours (`AdwAccentColor`), each with a background colour
// and a contrast-adjusted STANDALONE colour used for text and other things drawn
// directly on the window. The standalone one is not a second constant — it is a
// derivation of the background:
//
//   --accent-color: oklab(from var(--accent-bg-color) var(--standalone-color-oklab))
//   --standalone-color-oklab: min(l, 0.5) a b        (light)
//                             max(l, 0.85) a b       (dark)
//
// (`_colors.scss:146-170`), which is `adw_rgba_to_standalone` in the C
// (`adw-accent-color.c:130-157`): convert to OkLab, clamp L, convert back.
//
// WHY THE CORE OWNS THIS. A renderer that can express the CSS relative-colour
// form gets the derivation for free, and one that cannot has to compute it — the
// NativeScript CSS subset has no `oklab()` and no `var()`, so it needs real
// numbers. Two renderers computing the same clamp two ways is the drift this
// package exists to prevent, and the answer is checkable: the vectors in
// `conformance/accent.ts` were READ OUT OF libadwaita 1.9.2 through
// introspection rather than derived from a reading of the C.
//
// PLATFORM-NEUTRAL: applying an accent is the renderer's job — GTK has
// `Adw.StyleManager:accent-color`, a browser sets the two custom properties, and
// NativeScript has to generate a stylesheet.
//
// Reference: refs/libadwaita/src/adw-accent-color.c
// Reference: refs/libadwaita/src/adw-color-utils.c (rgb↔oklab)
// Reference: refs/libadwaita/src/stylesheet/_colors.scss:146-170#--accent-bg-color
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** The nine accent colours `AdwAccentColor` offers, in its own order. */
export type AdwAccentColorName = 'blue' | 'teal' | 'green' | 'yellow' | 'orange' | 'red' | 'pink' | 'purple' | 'slate';

/** Every accent name, in `AdwAccentColor`'s declaration order (blue first — it is the default). */
export const ADW_ACCENT_COLOR_NAMES: readonly AdwAccentColorName[] = [
    'blue',
    'teal',
    'green',
    'yellow',
    'orange',
    'red',
    'pink',
    'purple',
    'slate',
];

/**
 * `--accent-fg-color` — what goes ON TOP of an accent fill.
 *
 * `adw_style_manager` defines it as plain `white`, unconditionally: not per
 * accent, and not per colour scheme (adw-style-manager.c:161). Named here
 * because a port that has to write the colour out — a bitmap fill, a
 * stylesheet without custom properties — otherwise spells `#ffffff` inline and
 * reads as a light-mode assumption someone will later "fix" for dark.
 */
export const ADW_ACCENT_FG_COLOR = '#ffffff';

/**
 * `adw_accent_color_to_rgba` — the BACKGROUND colour of each accent
 * (adw-accent-color.c:52-84). The matching foreground is {@link ADW_ACCENT_FG_COLOR}.
 */
export const ADW_ACCENT_BG_COLORS: Readonly<Record<AdwAccentColorName, string>> = {
    blue: '#3584e4',
    teal: '#2190a4',
    green: '#3a944a',
    yellow: '#c88800',
    orange: '#ed5b00',
    red: '#e62d42',
    pink: '#d56199',
    purple: '#9141ac',
    slate: '#6f8396',
};

/** libadwaita's default accent (`ADW_ACCENT_COLOR_BLUE`). */
export const ADW_DEFAULT_ACCENT_COLOR: AdwAccentColorName = 'blue';

/** Whether `value` is one of the nine accent names. */
export function isAdwAccentColorName(value: string): value is AdwAccentColorName {
    return (ADW_ACCENT_COLOR_NAMES as readonly string[]).includes(value);
}

/** `#rrggbb` → the three sRGB channels in 0…1. Returns `null` for anything else. */
function parseHex(hex: string): [number, number, number] | null {
    const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
    if (!match) return null;
    const value = Number.parseInt(match[1], 16);
    return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

function toHex(red: number, green: number, blue: number): string {
    const channel = (value: number) =>
        Math.round(Math.min(1, Math.max(0, value)) * 255)
            .toString(16)
            .padStart(2, '0');
    return `#${channel(red)}${channel(green)}${channel(blue)}`;
}

/** `rgb_to_linear_srgb` (adw-color-utils.c) — the sRGB transfer function, undone. */
const toLinear = (value: number): number => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);

/** …and applied again. */
const fromLinear = (value: number): number =>
    value <= 0.003_130_8 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055;

/** `linear_srgb_to_oklab` — Ottosson's matrices, as libadwaita carries them. */
function linearToOklab(red: number, green: number, blue: number): [number, number, number] {
    const l = Math.cbrt(0.412_221_470_8 * red + 0.536_332_536_3 * green + 0.051_445_992_9 * blue);
    const m = Math.cbrt(0.211_903_498_2 * red + 0.680_699_545_1 * green + 0.107_396_956_6 * blue);
    const s = Math.cbrt(0.088_302_461_9 * red + 0.281_718_837_6 * green + 0.629_978_700_5 * blue);

    return [
        0.210_454_255_3 * l + 0.793_617_785 * m - 0.004_072_046_8 * s,
        1.977_998_495_1 * l - 2.428_592_205 * m + 0.450_593_709_9 * s,
        0.025_904_037_1 * l + 0.782_771_766_2 * m - 0.808_675_766 * s,
    ];
}

/** `oklab_to_linear_srgb` — the inverse. */
function oklabToLinear(lightness: number, aStar: number, bStar: number): [number, number, number] {
    const l = (lightness + 0.396_337_777_4 * aStar + 0.215_803_757_3 * bStar) ** 3;
    const m = (lightness - 0.105_561_345_8 * aStar - 0.063_854_172_8 * bStar) ** 3;
    const s = (lightness - 0.089_484_177_5 * aStar - 1.291_485_548 * bStar) ** 3;

    return [
        4.076_741_662_1 * l - 3.307_711_591_3 * m + 0.230_969_929_2 * s,
        -1.268_438_004_6 * l + 2.609_757_401_1 * m - 0.341_319_396_5 * s,
        -0.004_196_086_3 * l - 0.703_418_614_7 * m + 1.707_614_701 * s,
    ];
}

/**
 * `adw_rgba_to_standalone` — a background colour adjusted to stand alone on a
 * light or dark surface: darker on light, lighter on dark.
 *
 * The clamp is on OkLab's L only; `a` and `b` are carried through, which is why
 * the result keeps the accent's hue instead of washing towards grey.
 */
export function adwaitaStandaloneColor(background: string, dark: boolean): string {
    const rgb = parseHex(background);
    if (!rgb) return background;

    const [lightness, aStar, bStar] = linearToOklab(toLinear(rgb[0]), toLinear(rgb[1]), toLinear(rgb[2]));
    const clamped = dark ? Math.max(lightness, 0.85) : Math.min(lightness, 0.5);
    const [red, green, blue] = oklabToLinear(clamped, aStar, bStar);

    return toHex(fromLinear(red), fromLinear(green), fromLinear(blue));
}

/** The `--accent-bg-color` for an accent name. */
export function adwaitaAccentBgColor(name: AdwAccentColorName): string {
    return ADW_ACCENT_BG_COLORS[name];
}

/** The `--accent-color` for an accent name in the given scheme. */
export function adwaitaAccentColor(name: AdwAccentColorName, dark: boolean): string {
    return adwaitaStandaloneColor(ADW_ACCENT_BG_COLORS[name], dark);
}

let currentAccent: AdwAccentColorName = ADW_DEFAULT_ACCENT_COLOR;
const listeners = new Set<() => void>();

/** The active accent (default `'blue'`). */
export function adwaitaAccent(): AdwAccentColorName {
    return currentAccent;
}

/**
 * Set the active accent. A no-op when unchanged; otherwise notifies every
 * subscriber. The renderer must also apply its platform half — the two custom
 * properties in a browser, `Adw.StyleManager:accent-color` on GTK, a generated
 * stylesheet on NativeScript.
 */
export function setAdwaitaAccent(name: AdwAccentColorName): void {
    if (name === currentAccent || !isAdwAccentColorName(name)) return;
    currentAccent = name;
    // Snapshot so a listener that unsubscribes mid-iteration can't skip another —
    // the same rule as the colour-scheme fan-out.
    // oxlint-disable-next-line unicorn/no-useless-spread -- the copy IS the snapshot: a Set iterator is live, so an unsubscribe mid-fan-out would skip the next listener
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch {
            // A misbehaving subscriber must not break the rest of the fan-out.
        }
    }
}

/** Subscribe to accent changes. Returns an unsubscribe function. */
export function onAdwaitaAccentChanged(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
