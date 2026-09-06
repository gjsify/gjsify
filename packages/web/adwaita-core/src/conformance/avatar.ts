// Avatar conformance vectors — the spec both renderers are held to.
//
// Every row is derived from a named function in the libadwaita C source, and the
// `gStrHash`/`colorClass` columns were VERIFIED against real GLib by compiling
// `g_str_hash` and comparing (not by trusting the port). A renderer that
// re-implements the derivation instead of calling `@gjsify/adwaita-core` fails
// these the moment it drifts.
//
// Reference: refs/libadwaita/src/adw-avatar.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** One `avatarInitials` expectation. */
export interface AvatarInitialsVector {
    /** The `Adw.Avatar:text` value. */
    text: string;
    /** What `extract_initials_from_text` produces for it. */
    initials: string;
    rule: string;
}

/**
 * `extract_initials_from_text` — the first character, plus the
 * character after the LAST ASCII space when there is one.
 */
export const AVATAR_INITIALS_VECTORS: ReadonlyArray<AvatarInitialsVector> = [
    { text: 'Ada Lovelace', initials: 'AL', rule: 'first char + char after the last space' },
    { text: 'Ada', initials: 'A', rule: 'ONE letter for a single word — never the first two' },
    { text: 'GNOME', initials: 'G', rule: 'single word, already uppercase' },
    { text: 'ada lovelace', initials: 'AL', rule: 'g_utf8_strup upcases both initials' },
    { text: 'Jean-Luc Picard', initials: 'JP', rule: 'a hyphen is not a separator' },
    { text: '  Ada Lovelace  ', initials: 'AL', rule: 'g_strstrip removes surrounding ASCII space' },
    { text: 'Ada  Lovelace', initials: 'AL', rule: 'g_utf8_strrchr finds the LAST of a run of spaces' },
    { text: 'Ada\tLovelace', initials: 'A', rule: 'only a literal space separates — a tab does not' },
    { text: 'Ada Lovelace King', initials: 'AK', rule: 'the LAST space wins, not the second word' },
    { text: 'Jörg Schröder', initials: 'JS', rule: 'non-ASCII name, ASCII initials' },
    { text: 'Müller', initials: 'M', rule: 'single non-ASCII word' },
    { text: 'Ł ódź', initials: 'ŁÓ', rule: 'both initials stay non-ASCII and are upcased' },
    { text: '日本語', initials: '日', rule: 'a script without case is passed through' },
    { text: 'A', initials: 'A', rule: 'one character' },
    { text: '', initials: '', rule: 'empty name renders no initials' },
    { text: '   ', initials: '', rule: 'blank-only name strips to empty' },
];

/** One colour-derivation expectation. */
export interface AvatarColorVector {
    /** The `Adw.Avatar:text` value. */
    text: string;
    /** `g_str_hash(text)` as `guint32` — verified against the real GLib symbol. */
    hash: number;
    /** `set_class_color`'s `(g_str_hash (text) % 14) + 1`, i.e. the `color{n}` CSS class. */
    colorClass: number;
}

/** One `avatarMaxFontSize` expectation. */
export interface AvatarFontSizeVector {
    /** `Adw.Avatar:size`, the circle diameter. */
    size: number;
    /** `sqr_size - padding` for that diameter, rounded to 2dp for the table. */
    maxFontSize: number;
    /** The pre-lift browser heuristic, kept as the counter-example. */
    legacyWebGuess: number;
}

/**
 * `update_font_size`'s cap — the inscribed square
 * `size / 1.4142` less `max(size * 0.4 - 5, 0)`.
 *
 * `legacyWebGuess` is kept in the table on purpose: `size * (size < 32 ? 0.5 : 0.4)`
 * OVERFLOWS the cap at 28, 30, 31 and every size from 64 up (the initials spill out of the
 * circle), and is not even monotonic — 16px at size 31, 13px at size 32.
 */
export const AVATAR_FONT_SIZE_VECTORS: ReadonlyArray<AvatarFontSizeVector> = [
    { size: 12, maxFontSize: 8.49, legacyWebGuess: 6 },
    { size: 16, maxFontSize: 9.91, legacyWebGuess: 8 },
    { size: 24, maxFontSize: 12.37, legacyWebGuess: 12 },
    { size: 28, maxFontSize: 13.6, legacyWebGuess: 14 },
    { size: 31, maxFontSize: 14.52, legacyWebGuess: 16 },
    { size: 32, maxFontSize: 14.83, legacyWebGuess: 13 },
    { size: 48, maxFontSize: 19.74, legacyWebGuess: 19 },
    { size: 64, maxFontSize: 24.66, legacyWebGuess: 26 },
    { size: 128, maxFontSize: 44.31, legacyWebGuess: 51 },
];

/** One `avatarIconSize` expectation. */
export interface AvatarIconSizeVector {
    /** `Adw.Avatar:size`, the circle diameter. */
    size: number;
    /** `gtk_image_set_pixel_size (self->icon, size / 2)` — C integer division. */
    iconSize: number;
}

/**
 * `adw_avatar_set_size`'s icon extent (adw-avatar.c:756).
 *
 * The table exists because the number was invented once: both renderers drew the
 * fallback glyph at `round(size * 0.55)`, agreeing with each other and with nothing
 * else, on the written grounds that libadwaita had no number to port. Odd sizes are
 * here because `size` is an `int` in the C and `/` truncates.
 */
export const AVATAR_ICON_SIZE_VECTORS: ReadonlyArray<AvatarIconSizeVector> = [
    { size: 16, iconSize: 8 },
    { size: 24, iconSize: 12 },
    { size: 31, iconSize: 15 },
    { size: 32, iconSize: 16 },
    { size: 48, iconSize: 24 },
    { size: 96, iconSize: 48 },
    { size: 128, iconSize: 64 },
];

/** One `avatarMode` expectation. */
export interface AvatarModeVector {
    hasCustomImage: boolean;
    showInitials: boolean;
    text: string;
    mode: 'image' | 'initials' | 'icon';
    rule: string;
}

/** `update_visibility`. */
export const AVATAR_MODE_VECTORS: ReadonlyArray<AvatarModeVector> = [
    { hasCustomImage: true, showInitials: true, text: 'Ada', mode: 'image', rule: 'a custom image wins outright' },
    {
        hasCustomImage: false,
        showInitials: true,
        text: 'Ada',
        mode: 'initials',
        rule: 'asked for, and a name to derive from',
    },
    { hasCustomImage: false, showInitials: false, text: 'Ada', mode: 'icon', rule: 'a name alone is not enough' },
    {
        hasCustomImage: false,
        showInitials: true,
        text: '   ',
        mode: 'initials',
        rule: 'the gate is TEXT length, so a blank name still shows an (empty) label',
    },
    { hasCustomImage: false, showInitials: true, text: '', mode: 'icon', rule: 'an empty name falls back to the icon' },
];

/**
 * `g_str_hash` + `set_class_color`.
 *
 * The non-ASCII rows are the ones that matter: GLib hashes the UTF-8 bytes as
 * `signed char`, so a port reading UTF-16 code units picks a different colour
 * for every accented name. `"Jörg Schröder"` is the canary — it landed on
 * `color6` before this table existed, where GTK paints `color14`.
 */
export const AVATAR_COLOR_VECTORS: ReadonlyArray<AvatarColorVector> = [
    { text: 'Ada Lovelace', hash: 2497722230, colorClass: 11 },
    { text: 'Ada', hash: 193451179, colorClass: 6 },
    { text: 'GNOME', hash: 221244347, colorClass: 10 },
    { text: 'A', hash: 177638, colorClass: 7 },
    { text: '   ', hash: 193412933, colorClass: 8 },
    { text: 'Jörg Schröder', hash: 518987909, colorClass: 14 },
    { text: 'Müller', hash: 2552743072, colorClass: 13 },
    { text: 'Ł ódź', hash: 512736292, colorClass: 13 },
    { text: '日本語', hash: 2510222213, colorClass: 10 },
];
