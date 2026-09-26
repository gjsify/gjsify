// macOS's system accent, as one of libadwaita's nine — headless (ADR 0004).
//
// macOS stores the accent the person picked in System Settings → Appearance as
// the integer `AppleAccentColor` in the global preferences domain
// (`defaults read -g AppleAccentColor`). The key is ABSENT for "Multicolor",
// where every app keeps its own accent — and an Adwaita app's own is blue.
//
// WHO NEEDS THIS. Not a GTK app: libadwaita ≥ 1.6 reads the macOS accent itself
// (`adw-settings-impl-macos.c` takes `NSColor.controlAccentColor` and snaps it
// with `adw_accent_color_nearest_from_rgba`), and `Adw.StyleManager:accent-color`
// follows it — measured on macOS 27 / libadwaita 1.10 with purple set:
// `system-supports-accent-colors` true, `accent-color` PURPLE. What does NOT see
// it is everything without libadwaita in the process: a WKWebView resolves CSS
// `AccentColor` to `rgb(0,122,255)` whatever the setting (measured in Safari 27
// with purple set), and a headless GJS process has no StyleManager at all.
// Those read the preference and map it here.
//
// The mapping is by NAME, not by nearest colour: macOS offers eight fixed
// choices, seven have an Adwaita namesake, and graphite, the grey one, is
// slate, Adwaita's only grey.
//
// PLATFORM-NEUTRAL: this only interprets the value. Reading it is a subprocess
// on GJS (`@gjsify/adwaita-app/system-accent`) — kept out of here so this
// package stays importable in a browser.

import type { AdwAccentColorName } from './accent.js';

/**
 * `AppleAccentColor`'s values → the Adwaita accent of the same name.
 * `-1` graphite, `0` red, `1` orange, `2` yellow, `3` green, `4` blue, `5` purple, `6` pink.
 */
export const APPLE_ACCENT_COLORS: Readonly<Record<number, AdwAccentColorName>> = {
    [-1]: 'slate',
    0: 'red',
    1: 'orange',
    2: 'yellow',
    3: 'green',
    4: 'blue',
    5: 'purple',
    6: 'pink',
};

/** The accent for "Multicolor" (key absent): the app's own, and an Adwaita app's own is blue. */
export const APPLE_MULTICOLOR_ACCENT: AdwAccentColorName = 'blue';

/**
 * The Adwaita accent for an `AppleAccentColor` value.
 *
 * Takes what `defaults read` prints (surrounding whitespace allowed) or the
 * number itself. `null`/`undefined` means the key is absent — Multicolor —
 * and gives {@link APPLE_MULTICOLOR_ACCENT}. Anything else macOS does not
 * define (a new value, a non-integer) gives `null`, never a guess: the caller
 * then keeps whatever it would do without a system accent.
 */
export function adwAccentFromAppleAccentColor(value: string | number | null | undefined): AdwAccentColorName | null {
    if (value === null || value === undefined) return APPLE_MULTICOLOR_ACCENT;
    const text = String(value).trim();
    if (!/^-?\d+$/.test(text)) return null;
    return APPLE_ACCENT_COLORS[Number(text)] ?? null;
}
