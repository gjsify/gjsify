// Adwaita avatar derivation — headless.
//
// `Adw.Avatar` derives two things from the person's name, and both are pure
// string functions with no rendering in them: the INITIALS shown in the circle
// and the COLOUR the circle is painted in. Both are ported here from the C
// source so every renderer produces the same avatar for the same name (ADR 0004).
//
// Both were previously duplicated in `@gjsify/adwaita-web` and
// `@gjsify/adwaita-nativescript`, and the copies had already drifted: the web
// copy returned TWO letters for a single-word name (`"Ada"` → `"AD"`) where
// libadwaita and the NS copy return one (`"A"`). That is exactly the divergence
// class this package exists to remove — see `conformance/avatar.ts` for the
// vectors both renderers are now held to.
//
// Reference: refs/libadwaita/src/adw-avatar.c
//   (`extract_initials_from_text`, `set_class_color`, NUMBER_OF_COLORS)
// Reference: refs/libadwaita/src/stylesheet/widgets/_avatar.scss ($avatarcolorlist)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** How many colours `Adw.Avatar` picks between — libadwaita's `NUMBER_OF_COLORS`. */
export const AVATAR_COLOR_COUNT = 14;

/** One `$avatarcolorlist` entry: light `fg` text over a `start`→`stop` gradient. */
export interface AdwAvatarColor {
    /** Light tint used for the initials. */
    fg: string;
    /** Gradient start (top). */
    start: string;
    /** Gradient stop (bottom). */
    stop: string;
}

/**
 * The 14 libadwaita avatar colours, in `$avatarcolorlist` order — index `n` is
 * the CSS class `color{n+1}`.
 */
export const AVATAR_COLORS: ReadonlyArray<AdwAvatarColor> = [
    { fg: '#cfe1f5', start: '#83b6ec', stop: '#337fdc' }, // blue
    { fg: '#caeaf2', start: '#7ad9f1', stop: '#0f9ac8' }, // cyan
    { fg: '#cef8d8', start: '#8de6b1', stop: '#29ae74' }, // green
    { fg: '#e6f9d7', start: '#b5e98a', stop: '#6ab85b' }, // lime
    { fg: '#f9f4e1', start: '#f8e359', stop: '#d29d09' }, // yellow
    { fg: '#ffead1', start: '#ffcb62', stop: '#d68400' }, // gold
    { fg: '#ffe5c5', start: '#ffa95a', stop: '#ed5b00' }, // orange
    { fg: '#f8d2ce', start: '#f78773', stop: '#e62d42' }, // raspberry
    { fg: '#fac7de', start: '#e973ab', stop: '#e33b6a' }, // magenta
    { fg: '#e7c2e8', start: '#cb78d4', stop: '#9945b5' }, // purple
    { fg: '#d5d2f5', start: '#9e91e8', stop: '#7a59ca' }, // violet
    { fg: '#f2eade', start: '#e3cf9c', stop: '#b08952' }, // beige
    { fg: '#e5d6ca', start: '#be916d', stop: '#785336' }, // brown
    { fg: '#d8d7d3', start: '#c0bfbc', stop: '#6e6d71' }, // gray
];

/**
 * UTF-8 bytes of `text`, the unit `g_str_hash` actually reads.
 *
 * Hand-rolled rather than `TextEncoder` so this module keeps its no-globals,
 * no-platform-imports contract (`gjsify.headless: true`). Lone surrogates become
 * U+FFFD, matching what a WHATWG encoder would emit.
 */
function* utf8Bytes(text: string): Generator<number> {
    for (const ch of text) {
        let cp = ch.codePointAt(0) ?? 0;
        if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
        if (cp < 0x80) {
            yield cp;
        } else if (cp < 0x800) {
            yield 0xc0 | (cp >> 6);
            yield 0x80 | (cp & 0x3f);
        } else if (cp < 0x10000) {
            yield 0xe0 | (cp >> 12);
            yield 0x80 | ((cp >> 6) & 0x3f);
            yield 0x80 | (cp & 0x3f);
        } else {
            yield 0xf0 | (cp >> 18);
            yield 0x80 | ((cp >> 12) & 0x3f);
            yield 0x80 | ((cp >> 6) & 0x3f);
            yield 0x80 | (cp & 0x3f);
        }
    }
}

/**
 * GLib's `g_str_hash` — the DJB2 variant `h = h * 33 + c`, as `guint32`.
 *
 * Two details decide whether the avatar colour matches GTK, and both were wrong
 * in the renderer copies this replaces: `c` is a **`signed char` of the UTF-8
 * encoding**, not a UTF-16 code unit, so bytes ≥ 0x80 contribute NEGATIVE values
 * (`"Jörg Schröder"` picked colour 5 instead of 13); and the C loop stops at the
 * first NUL byte, so an embedded `\0` truncates the input.
 */
export function gStrHash(text: string): number {
    let h = 5381;
    for (const byte of utf8Bytes(text)) {
        if (byte === 0) break; // `for (p = v; *p != '\0'; p++)`
        h = (Math.imul(h, 33) + (byte > 0x7f ? byte - 0x100 : byte)) >>> 0;
    }
    return h >>> 0;
}

// `g_strstrip` trims `g_ascii_isspace` only — space, \t, \n, \v, \f, \r. JS
// `String.trim()` also eats NBSP and the Unicode space separators, which would
// make a name starting with U+00A0 yield different initials than GTK.
const ASCII_TRIM = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;

/**
 * The initials `Adw.Avatar` shows for `text`: the first character, plus the
 * character following the LAST space if there is one.
 *
 * Mirrors `extract_initials_from_text` step for step — upcase, then strip, then
 * NFC-normalise, then take code points (never UTF-16 units, so an astral first
 * letter survives). Only a literal ASCII space separates the two initials, so
 * `"Ada\tLovelace"` yields `"A"`, exactly as GTK does.
 *
 * Returns `''` for a blank name. libadwaita instead emits a one-NUL-byte label
 * there, because its caller only guards the RAW text against being empty; an
 * empty string is the sane rendering of the same "no initials" state.
 */
export function avatarInitials(text: string): string {
    const normalized = (text ?? '').toUpperCase().replace(ASCII_TRIM, '').normalize('NFC');
    if (normalized.length === 0) return '';

    const first = firstCodePoint(normalized);
    const lastSpace = normalized.lastIndexOf(' ');
    if (lastSpace < 0) return first;

    // `g_utf8_get_char (g_utf8_next_char (q))` — the character AFTER the last
    // space, which is empty when the stripped name still ends in one.
    return first + firstCodePoint(normalized.slice(lastSpace + 1));
}

/**
 * The leading code point of `text` as a string, or `''` when empty.
 *
 * `charAt(0)` would return half of a surrogate pair — `g_utf8_get_char` reads a
 * whole character, so an astral first letter must survive intact.
 */
function firstCodePoint(text: string): string {
    const cp = text.codePointAt(0);
    return cp === undefined ? '' : String.fromCodePoint(cp);
}

/**
 * The 1-based colour class (`color1`…`color14`) `Adw.Avatar` assigns to `text`,
 * i.e. `set_class_color`'s `(g_str_hash (text) % NUMBER_OF_COLORS) + 1`.
 *
 * `null` for a blank name: libadwaita picks a RANDOM class there, so no value is
 * derivable from the name. A renderer that wants that behaviour calls
 * {@link randomAvatarColorClass}; one that paints nothing without initials — as
 * both current renderers do — can ignore the `null`.
 */
export function avatarColorClass(text: string): number | null {
    if (!text) return null;
    return (gStrHash(text) % AVATAR_COLOR_COUNT) + 1;
}

/**
 * A random colour class for a nameless avatar, matching libadwaita's
 * `g_rand_int_range (rand, 1, NUMBER_OF_COLORS)` — which is the half-open range
 * `[1, 14)`, so `color14` never comes up. Kept faithful rather than "fixed":
 * a renderer that widened it would not match GTK.
 */
export function randomAvatarColorClass(random: () => number = Math.random): number {
    return 1 + Math.floor(random() * (AVATAR_COLOR_COUNT - 1));
}

/**
 * The palette entry `Adw.Avatar` paints for `text`. Falls back to the first
 * colour for a blank name so a renderer always has something to paint; use
 * {@link avatarColorClass} directly when the nameless case must stay random.
 */
export function avatarColor(text: string): AdwAvatarColor {
    const cls = avatarColorClass(text);
    return AVATAR_COLORS[(cls ?? 1) - 1]!;
}

/**
 * The flat 50/50 blend of a palette entry's gradient, for renderers whose style
 * layer has no gradients (the NativeScript CSS subset is the one that forced
 * this). Returns a `#rrggbb` string.
 */
export function flattenAvatarGradient(color: AdwAvatarColor): string {
    const start = Number.parseInt(color.start.slice(1), 16);
    const stop = Number.parseInt(color.stop.slice(1), 16);
    const mix = (shift: number) =>
        Math.round((((start >> shift) & 0xff) + ((stop >> shift) & 0xff)) / 2)
            .toString(16)
            .padStart(2, '0');
    return `#${mix(16)}${mix(8)}${mix(0)}`;
}
