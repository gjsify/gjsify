// `Gtk.Label` — what a label SHOWS and how an authored value becomes the property GTK
// holds, headless.
//
// NO STATE MACHINE (ADR 0004, trivial behaviour). Two renderers draw a label, and the
// two things they must not decide separately are here: the text reduction and the
// property readings.
//
// MARKUP IS REDUCED TO ITS PLAIN TEXT, NEVER RENDERED. `use-markup` says the label is
// Pango markup; a renderer that honoured it would have to turn a string into styled
// runs, and on the web the short road there is `innerHTML` — which executes whatever the
// string carries. So both renderers show the TEXT of the markup, through the same
// `stripMarkup` that `Adw.Banner:use-markup` already goes through, and unparseable markup
// keeps the raw string, which is the C fallback (`gtk_label_set_markup` warns and shows
// the text as given). `use-markup` defaults to FALSE, as in GTK, so a `<` in ordinary
// prose is shown literally unless a caller asks otherwise.
//
// THE MNEMONIC IS STRIPPED, NOT UNDERLINED OR BOUND: neither renderer has GTK's
// accelerator layer behind a label. Same reduction `Adw.ButtonContent` makes.
//
// Reference: refs/gtk/gtk/gtklabel.c (gtk_label_set_markup, gtk_label_set_xalign,
//   gtk_label_set_justify, the `justify` → PangoAlignment switch)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { glibClamp, stripMnemonic } from './glib.js';
import { stripMarkup } from './preferences.js';

/** `Gtk.Label:xalign`'s default — `0.5` in the pspec: a label centres its text. */
export const DEFAULT_LABEL_XALIGN = 0.5;

/** `Gtk.Justification`'s four nicks, in enum order. */
export const LABEL_JUSTIFICATIONS = ['left', 'right', 'center', 'fill'] as const;

export type LabelJustification = (typeof LABEL_JUSTIFICATIONS)[number];

/**
 * The string a label shows for a given `label` and the two flags that transform it.
 *
 * ORDER FOLLOWS THE C: markup is reduced first, the mnemonic marker second.
 * `gtk_label_set_markup_with_mnemonic` parses the markup and then takes the underscore out
 * of the resulting TEXT, so an `_` inside a tag's attributes is not a mnemonic. Doing it
 * the other way round would let `<span font_desc="Sans">` lose its underscore and stop
 * parsing.
 */
export function labelDisplayText(label: string, useMarkup: boolean, useUnderline: boolean): string {
    const text = label ?? '';
    const plain = useMarkup ? (stripMarkup(text) ?? text) : text;
    return useUnderline ? stripMnemonic(plain) : plain;
}

/** Whether `label` carries markup that could not be reduced, so the raw string is shown. */
export function labelMarkupIsUnparseable(label: string, useMarkup: boolean): boolean {
    return useMarkup && stripMarkup(label ?? '') === null;
}

/**
 * `Gtk.Label:xalign` as the label holds it. `gtk_label_set_xalign` CLAMPs to 0…1 itself,
 * so an out-of-range value lands on the nearer end; only an unparseable one is the default.
 */
export function normalizeLabelXalign(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? glibClamp(parsed, 0, 1) : DEFAULT_LABEL_XALIGN;
}

/** `Gtk.Label:justify` from its nick. An unknown nick leaves the default, `left`. */
export function normalizeLabelJustify(value: unknown): LabelJustification {
    return (LABEL_JUSTIFICATIONS as readonly unknown[]).includes(value) ? (value as LabelJustification) : 'left';
}
