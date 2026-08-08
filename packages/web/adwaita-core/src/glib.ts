// GLib/GTK primitives that Adwaita's own code is written in terms of.
//
// Small on purpose: these live here rather than inside whichever widget module
// happened to need one first, because two of them already did. `glibClamp`
// was written twice — once for the avatar's font-size cap, once for the split
// views' sidebar bounds — and a second copy of a primitive is exactly the shape
// this package exists to remove. `stringIsNotEmpty` arrived the same way: core
// already carried it twice (the preferences header's `displayedLabelText`, the
// sidebar's `titleVisible`) before a third widget family needed it.
//
// Reference: refs/glib/glib/gmacros.h (CLAMP)
// Reference: refs/libadwaita/src/adw-action-row.c:112-117 (string_is_not_empty)
// Copyright (c) GNOME contributors (GLib, libadwaita). LGPLv2.1+.

/**
 * libadwaita's `string_is_not_empty` template closure — the predicate EVERY
 * Adwaita label binds its `visible` property to.
 *
 * `return string && string[0];` — verbatim in six widgets that each declare
 * their own private copy (`adw-action-row.c:112-117`, `adw-button-row.c:92-97`,
 * `adw-sidebar.c`, `adw-shortcut-row.c`, `adw-status-page.c`,
 * `adw-toast-widget.c`), bound from the matching `.ui`
 * (`adw-action-row.ui:49-53` for the title, `:71-75` for the subtitle).
 *
 * Two properties of it are load-bearing and are what a hand-rolled copy gets
 * wrong: only the EXACT empty string (and NULL) is false — one space is a
 * visible label, because the C never trims — and the rule applies to the TITLE
 * as much as to the subtitle. Every port so far hid an empty subtitle and left
 * an empty title occupying a line.
 */
export function stringIsNotEmpty(value: string | null | undefined): boolean {
    return value !== null && value !== undefined && value.length > 0;
}

/**
 * GLib's `CLAMP`, which tests the HIGH bound FIRST:
 * `x > high ? high : (x < low ? low : x)`.
 *
 * NOT interchangeable with `Math.min(high, Math.max(low, x))` — the two disagree
 * whenever the bounds are inverted, and Adwaita reaches inverted bounds for
 * real: a split view's sidebar caps invert whenever the content minimum exceeds
 * what is left of the width.
 */
export function glibClamp(x: number, low: number, high: number): number {
    return x > high ? high : x < low ? low : x;
}

/**
 * Drop GTK mnemonic markers from a label (`gtk_label_new_with_mnemonic`).
 *
 * A single `_` marks the character after it and is itself removed; `__` is an
 * escaped literal underscore. A renderer with no accelerator layer wants the
 * plain text, which is what this returns — GTK would underline the marked
 * character instead.
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
