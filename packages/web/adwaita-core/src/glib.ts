// GLib/GTK primitives that Adwaita's own code is written in terms of.
//
// Reference: refs/glib/glib/gmacros.h (CLAMP)
// Reference: refs/libadwaita/src/adw-action-row.c:112-117 (string_is_not_empty)
// Copyright (c) GNOME contributors (GLib, libadwaita). LGPLv2.1+.

// `g_strstrip` is `g_strchomp (g_strchug (s))`, and both test `g_ascii_isspace`
// — space, \t, \n, \v, \f, \r and nothing else.
const ASCII_SPACE_TRIM = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;

/**
 * GLib's `g_strstrip` — trim ASCII whitespace from both ends, and ONLY ASCII
 * whitespace.
 *
 * NOT `String.prototype.trim()`, which also eats U+00A0 NBSP, U+FEFF and the
 * Unicode space separators. Two widgets depend on the difference: `Adw.Avatar`
 * derives its initials from the stripped name, so a name starting with U+00A0
 * keeps the NBSP as its initial in GTK where a `trim()`-based port yields the
 * first LETTER; and `Adw.AboutDialog`'s `parse_person` (adw-about-dialog.c:533)
 * strips credit names the same way.
 */
export function gStrStrip(value: string): string {
    return value.replace(ASCII_SPACE_TRIM, '');
}

/**
 * libadwaita's `string_is_not_empty` template closure — the predicate every
 * Adwaita label binds its `visible` property to.
 *
 * `return string && string[0];` — verbatim in six widgets that each declare their
 * own private copy (`adw-action-row.c:112-117`, `adw-button-row.c:92-97`,
 * `adw-sidebar.c`, `adw-shortcut-row.c`, `adw-status-page.c`,
 * `adw-toast-widget.c`), bound from the matching `.ui` (`adw-action-row.ui:49-53`
 * title, `:71-75` subtitle).
 *
 * Two traps: only the EXACT empty string (and NULL) is false — one space is a
 * visible label, because the C never trims — and the rule governs the TITLE as
 * much as the subtitle.
 */
export function stringIsNotEmpty(value: string | null | undefined): boolean {
    return value !== null && value !== undefined && value.length > 0;
}

/**
 * GLib's `CLAMP`, which tests the HIGH bound FIRST:
 * `x > high ? high : (x < low ? low : x)`.
 *
 * NOT interchangeable with `Math.min(high, Math.max(low, x))` — the two disagree
 * on inverted bounds, which Adwaita reaches for real: a split view's sidebar caps
 * invert whenever the content minimum exceeds what is left of the width.
 */
export function glibClamp(x: number, low: number, high: number): number {
    return x > high ? high : x < low ? low : x;
}

/**
 * Drop GTK mnemonic markers from a label (`gtk_label_new_with_mnemonic`).
 *
 * A single `_` marks the character after it and is itself removed; `__` is an
 * escaped literal underscore. GTK underlines the marked character; a renderer with
 * no accelerator layer wants this plain text instead.
 */
export function stripMnemonic(text: string): string {
    const characters = [...text];
    let stripped = '';
    let index = 0;

    while (index < characters.length) {
        if (characters[index] !== '_') {
            stripped += characters[index];
            index += 1;
            continue;
        }
        const next = characters[index + 1];
        if (next === undefined) return stripped; // trailing marker: nothing to mark
        stripped += next === '_' ? '_' : next;
        index += 2;
    }
    return stripped;
}
