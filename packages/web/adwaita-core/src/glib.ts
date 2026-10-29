// GLib/GTK primitives that Adwaita's own code is written in terms of.
//
// Reference: GLib's glib/gmacros.h (CLAMP) — there is no refs/glib pool
// Reference: refs/libadwaita/src/adw-action-row.c (string_is_not_empty)
// Copyright (c) GNOME contributors (GLib, libadwaita). LGPLv2.1+.

// `g_strstrip` is `g_strchomp (g_strchug (s))`, and both test `g_ascii_isspace`
// — space, \t, \n, \v, \f, \r and nothing else.
const ASCII_SPACE_TRIM = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;

/**
 * GLib's `g_strstrip` — trim ASCII whitespace from both ends, and ONLY ASCII
 * whitespace.
 *
 * NOT `String.prototype.trim()`, which also eats U+00A0 NBSP, U+FEFF and the Unicode
 * space separators. Two widgets depend on the difference: `Adw.Avatar` derives its
 * initials from the stripped name, so a name starting with U+00A0 keeps the NBSP as its
 * initial in GTK where a `trim()`-based port yields the first LETTER; and
 * `Adw.AboutDialog`'s `parse_person` strips credit names the same way.
 */
export function gStrStrip(value: string): string {
    return value.replace(ASCII_SPACE_TRIM, '');
}

/**
 * libadwaita's `string_is_not_empty` template closure — the predicate every
 * Adwaita label binds its `visible` property to.
 *
 * `return string && string[0];` — declared privately, verbatim, in six widgets
 * (`adw-action-row.c`, `adw-button-row.c`, `adw-sidebar.c`, `adw-shortcut-row.c`,
 * `adw-status-page.c`, `adw-toast-widget.c`) and bound from the matching `.ui`.
 *
 * Two traps: only the EXACT empty string (and NULL) is false — one space is a visible
 * label, because the C never trims — and the rule governs the TITLE as much as the
 * subtitle.
 */
export function stringIsNotEmpty(value: string | null | undefined): boolean {
    return value !== null && value !== undefined && value.length > 0;
}

/**
 * How a `GtkButton` reads an icon name BACK: `''` becomes `NULL`.
 *
 * `gtk_button_set_icon_name` holds the name on an internal `GtkImage`, and an empty name
 * leaves that image EMPTY — so `gtk_button_get_icon_name` answers `NULL` for a button
 * whose icon name was set to `''`. Only the readback normalises; the write itself is
 * accepted and does replace the content widget.
 *
 * WHY A PORT NEEDS IT. C's idempotence guard is `g_strcmp0 (icon_name, get_icon_name
 * (self))` — the incoming value against the READBACK, not against what is stored. The
 * two differ exactly here, so `g_strcmp0 ('', NULL)` is non-zero and EVERY
 * `icon_name = ''` write passes the guard, rebuilds the internal image and notifies,
 * for as long as it is repeated. A port that compares against its own field instead
 * swallows the second write and goes silent where GTK is loud.
 *
 * Measured on GJS 1.88.1 / libadwaita 1.9.4 / GTK 4.22.5: `set_icon_name('')` on a fresh
 * `Adw.SplitButton` emits `notify::icon-name` and reads `null` back; repeating it emits
 * `notify::icon-name` and `notify::child` again. An `''` LABEL does not behave this way —
 * `gtk_button_get_label` reads `''` straight back — which is why this is one function
 * about one property and not a general "empty means unset" rule.
 */
export function gtkButtonIconNameReadback(stored: string | null): string | null {
    return stored === '' ? null : stored;
}

/**
 * Whether `adw_action_row_set_subtitle` passes its guard (adw-action-row.c:571):
 * `g_strcmp0 (gtk_label_get_text (priv->subtitle), subtitle) == 0` returns early.
 *
 * `g_strcmp0` orders `NULL` before every string, `''` included, so a `NULL` write is NEVER
 * equal to the label text — which always reads `''`, never `NULL`. A `null` subtitle therefore
 * passes the guard, relabels with `""` and notifies on EVERY write, held value unmoved. A
 * `''` write against `''` is the ordinary idempotent case.
 *
 * Measured on GJS 1.88.1 / libadwaita 1.9.4: `subtitle = null` on a fresh `Adw.ActionRow` and
 * `Adw.ExpanderRow` emits `notify::subtitle` each time and reads `""` back; `subtitle = ''`
 * emits nothing. `title` was measured on the same rows and does NOT behave this way, so this is one
 * property's rule, not a general one.
 *
 * @param held     The label text now, never `null`.
 * @param written  What the caller passed.
 */
export function adwSubtitleWriteNotifies(held: string, written: string | null | undefined): boolean {
    return written === null || written === undefined || written !== held;
}

/**
 * GLib's `CLAMP`, which tests the HIGH bound FIRST:
 * `x > high ? high : (x < low ? low : x)`.
 *
 * NOT interchangeable with `Math.min(high, Math.max(low, x))` — the two disagree on
 * inverted bounds, which Adwaita reaches for real: a split view's sidebar caps invert
 * whenever the content minimum exceeds what is left of the width.
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
