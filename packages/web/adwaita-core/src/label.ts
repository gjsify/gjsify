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
// THE INT PROPERTIES (`width-chars`, `max-width-chars`, `lines`) FOLLOW THE
// PROPERTY-SYSTEM PATH, NOT THE C SETTER. Measured on gjs 1.88.1 / gtk 4.22.5:
// `label.width_chars = -5` (the C setter, called directly) holds `-5` verbatim, but
// `label.set_property('width-chars', -5)` — the path `GtkBuilder`, and therefore any
// attribute-driven tree, actually takes — validates against the pspec's `-1` floor, warns,
// and clamps to `-1`. An HTML attribute is always a string reaching this module through
// that second door, so `normalizeLabelWidthChars`/`normalizeLabelMaxWidthChars`/
// `normalizeLabelLines` clamp to `-1`, same as `gtk_label_set_yalign`'s CLAMP for `yalign`.
//
// `ELLIPSIZE`'S START AND MIDDLE MODES ARE A DECLARED DIVERGENCE ON BOTH RENDERERS. CSS
// `text-overflow` and NativeScript's `textOverflow` each hold exactly one truncating value
// ("ellipsis", end-of-string), so `labelEllipsizeOverflowValue` below is the one place that
// decision is made, shared rather than let each renderer pick its own fallback — see the
// function's own comment for why an end-ellipsis, not a silent `clip`, is what every
// non-`none` mode draws.
//
// Reference: refs/gtk/gtk/gtklabel.c (gtk_label_set_markup, gtk_label_set_xalign,
//   gtk_label_set_yalign, gtk_label_set_justify, gtk_label_set_ellipsize,
//   gtk_label_set_wrap_mode, gtk_label_set_lines, gtk_label_set_width_chars,
//   gtk_label_set_max_width_chars, the `justify` → PangoAlignment switch,
//   get_default_widths, "This has no effect if the label is not wrapping or ellipsized")
// Reference: Pango-1.0.gir (EllipsizeMode, WrapMode nicks — no `refs/pango` pool; read via
//   `gi://Pango` under gjs, and confirmed against `@girs/pango-1.0`'s enum member order)
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

/** `Gtk.Label:yalign`'s default — `0.5`, the same pspec shape as `xalign`. */
export const DEFAULT_LABEL_YALIGN = 0.5;

/**
 * `Gtk.Label:yalign` as the label holds it. `gtk_label_set_yalign` CLAMPs to 0…1 itself,
 * the same shape `normalizeLabelXalign` already carries for `xalign`.
 */
export function normalizeLabelYalign(value: unknown): number {
    const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
    return Number.isFinite(parsed) ? glibClamp(parsed, 0, 1) : DEFAULT_LABEL_YALIGN;
}

/** `Pango.EllipsizeMode`'s four nicks, in enum order. */
export const LABEL_ELLIPSIZE_MODES = ['none', 'start', 'middle', 'end'] as const;

export type LabelEllipsizeMode = (typeof LABEL_ELLIPSIZE_MODES)[number];

/** `Gtk.Label:ellipsize`'s default — `none`, no ellipsization. */
export const DEFAULT_LABEL_ELLIPSIZE: LabelEllipsizeMode = 'none';

/** `Gtk.Label:ellipsize` from its nick. An unknown nick leaves the default, `none`. */
export function normalizeLabelEllipsize(value: unknown): LabelEllipsizeMode {
    return (LABEL_ELLIPSIZE_MODES as readonly unknown[]).includes(value)
        ? (value as LabelEllipsizeMode)
        : DEFAULT_LABEL_ELLIPSIZE;
}

/**
 * `Gtk.Label:ellipsize` as the ONE truncating value CSS `text-overflow` and
 * NativeScript's `textOverflow` can both hold — each accepts only `clip` or `ellipsis`,
 * neither has a start- or middle-truncating mode of its own.
 *
 * `start` and `middle` are held on the PROPERTY faithfully: `normalizeLabelEllipsize`
 * never lies about what was asked for, and a consumer reading `label.ellipsize` back gets
 * exactly that nick. What a renderer can DRAW is a different question, answered here once
 * for both renderers so neither invents its own fallback: every non-`none` mode draws an
 * END ellipsis, the nearer of the two values a platform actually has — never a silent
 * `clip`, which would drop the same characters with no indication at all that anything is
 * missing. A DECLARED divergence, not a guessed one: `LABEL_ELLIPSIZE_OVERFLOW_VECTORS`
 * pins this fallback, the same way `LABEL_DISPLAY_TEXT_VECTORS` pins use-markup's.
 */
export function labelEllipsizeOverflowValue(ellipsize: LabelEllipsizeMode): 'clip' | 'ellipsis' {
    return ellipsize === 'none' ? 'clip' : 'ellipsis';
}

/** `Pango.WrapMode`'s three nicks, in enum order. */
export const LABEL_WRAP_MODES = ['word', 'char', 'word-char'] as const;

export type LabelWrapMode = (typeof LABEL_WRAP_MODES)[number];

/** `Gtk.Label:wrap-mode`'s default — `word`, wrap on word boundaries. */
export const DEFAULT_LABEL_WRAP_MODE: LabelWrapMode = 'word';

/** `Gtk.Label:wrap-mode` from its nick. An unknown nick leaves the default, `word`. */
export function normalizeLabelWrapMode(value: unknown): LabelWrapMode {
    return (LABEL_WRAP_MODES as readonly unknown[]).includes(value)
        ? (value as LabelWrapMode)
        : DEFAULT_LABEL_WRAP_MODE;
}

/**
 * `width-chars` / `max-width-chars` / `lines` share one pspec shape: an int with a floor
 * of `-1` ("auto"/"unlimited") GTK enforces through the PROPERTY SYSTEM, not through the C
 * setter called directly. Measured on gjs 1.88.1 / gtk 4.22.5: `label.width_chars = -5`
 * (the C setter) holds `-5` verbatim, while `label.set_property('width-chars', -5)` — the
 * door `GtkBuilder`, and therefore any attribute-driven tree, actually uses — validates
 * against the pspec, warns, and clamps to `-1`. An HTML/XML attribute is always a STRING
 * reaching this module through that second door, so unparseable is the default and a
 * parsed value below the floor clamps to it, the same rule `normalizeLabelXalign` already
 * follows for a continuous property.
 */
function normalizeLabelCharCount(value: unknown, fallback: number): number {
    const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10);
    return Number.isFinite(parsed) ? Math.max(fallback, Math.trunc(parsed)) : fallback;
}

/** `Gtk.Label:width-chars`'s default — `-1`, the width is calculated automatically. */
export const DEFAULT_LABEL_WIDTH_CHARS = -1;

/** `Gtk.Label:width-chars` as the label holds it. See {@link normalizeLabelCharCount}. */
export function normalizeLabelWidthChars(value: unknown): number {
    return normalizeLabelCharCount(value, DEFAULT_LABEL_WIDTH_CHARS);
}

/** `Gtk.Label:max-width-chars`'s default — `-1`, the width is calculated automatically. */
export const DEFAULT_LABEL_MAX_WIDTH_CHARS = -1;

/** `Gtk.Label:max-width-chars` as the label holds it. See {@link normalizeLabelCharCount}. */
export function normalizeLabelMaxWidthChars(value: unknown): number {
    return normalizeLabelCharCount(value, DEFAULT_LABEL_MAX_WIDTH_CHARS);
}

/** `Gtk.Label:lines`'s default — `-1`, no line limit. */
export const DEFAULT_LABEL_LINES = -1;

/** `Gtk.Label:lines` as the label holds it. See {@link normalizeLabelCharCount}. */
export function normalizeLabelLines(value: unknown): number {
    return normalizeLabelCharCount(value, DEFAULT_LABEL_LINES);
}

/**
 * `Gtk.Label:lines` "has no effect if the label is not wrapping or ellipsized" (the
 * pspec's own doc comment) — `gtk_label_ensure_layout` only calls
 * `pango_layout_set_height(layout, -self->lines)` there, and only a WRAPPING or
 * ELLIPSIZING layout ever needs a height cap at all; a single-line, non-ellipsized label
 * is already exactly one line tall. Returns the line count a renderer should actually
 * apply, or `null` when there is none, so a renderer never re-derives this guard from the
 * three raw properties itself — the mistake `lines` on its own invites, since `-1` is also
 * "no limit" and reads the same as "not applicable" until you ask why.
 */
export function labelEffectiveLines(lines: number, wrap: boolean, ellipsize: LabelEllipsizeMode): number | null {
    if (lines < 0) return null;
    return wrap || ellipsize !== 'none' ? lines : null;
}

/** One `width-chars` + `max-width-chars` pair and the `ch`-unit extent a renderer draws. */
export interface LabelWidthCharsExtent {
    /** `width-chars`, in `ch` — the MINIMUM width — or `null` while it is unset (`-1`). */
    minCh: number | null;
    /**
     * `MAX(width-chars, max-width-chars)`, in `ch` — the NATURAL/maximum width — or `null`
     * while `max-width-chars` is unset. `width-chars` alone sets no maximum: GTK reads it
     * only as a floor under `max-width-chars`, never as a ceiling by itself.
     */
    maxCh: number | null;
}

/**
 * `get_default_widths` (gtklabel.c): the label's MINIMUM width is `width-chars` alone; its
 * NATURAL width is `MAX(width-chars, max-width-chars)`, and that MAX is read only while
 * `max-width-chars` is set — `width-chars` without a maximum has nothing to be a floor
 * under. Either property at its default (`-1`) drops out of the pair it belongs to, the
 * same "negative means auto" rule both share.
 */
export function labelWidthCharsExtent(widthChars: number, maxWidthChars: number): LabelWidthCharsExtent {
    return {
        minCh: widthChars >= 0 ? widthChars : null,
        maxCh: maxWidthChars >= 0 ? Math.max(widthChars, maxWidthChars) : null,
    };
}
