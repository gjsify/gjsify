// `Gtk.Label` vectors — what a label SHOWS, and how an authored `xalign` / `justify` /
// `yalign` / `ellipsize` / `wrap-mode` / `width-chars` / `max-width-chars` / `lines`
// becomes the property. Driven by `label.spec.ts` against the core functions and by
// adwaita-web's `gtk-label.spec.ts` against the element's attributes and rendered text.
//
// THE DISPLAY ROWS ARE GTK'S, measured under gjs 1.88.1 / gtk 4.22.4 with
// `Gtk.Label.get_text()` read back after each write — except the one row marked as the
// declared divergence: GTK RENDERS markup bold, and no port here renders markup, because
// on the web the short road to styled runs is `innerHTML`, which executes what the string
// carries. The ports show the markup's TEXT, which is what `get_text()` returns anyway.
//
// THE INT/ENUM ROWS BELOW ARE THE PSPEC'S, measured the same way — `width-chars` /
// `max-width-chars` / `lines` against `label.set_property()` on gjs 1.88.1 / gtk 4.22.5
// (the door an attribute-driven tree actually goes through, not the C setter called
// directly — see `label.ts`'s header) and the two enums against `Pango-1.0.gir`'s nicks.
//
// Reference: refs/gtk/gtk/gtklabel.c (gtk_label_set_markup, gtk_label_set_xalign,
//   gtk_label_set_yalign, gtk_label_set_justify, gtk_label_set_ellipsize,
//   gtk_label_set_wrap_mode, gtk_label_set_width_chars, gtk_label_set_max_width_chars,
//   gtk_label_set_lines)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** One `label` + flags and the text shown. */
export interface LabelDisplayTextVector {
    label: string;
    useMarkup: boolean;
    useUnderline: boolean;
    text: string;
    rule: string;
}

export const LABEL_DISPLAY_TEXT_VECTORS: ReadonlyArray<LabelDisplayTextVector> = [
    {
        label: 'a < b',
        useMarkup: false,
        useUnderline: false,
        text: 'a < b',
        rule: 'use-markup defaults to FALSE, so a `<` in prose is shown literally',
    },
    {
        label: '<b>Bold</b>',
        useMarkup: false,
        useUnderline: false,
        text: '<b>Bold</b>',
        rule: 'markup without use-markup is text, tags included',
    },
    {
        label: '<b>Bold</b> &amp; plain',
        useMarkup: true,
        useUnderline: false,
        text: 'Bold & plain',
        rule: 'use-markup shows the markup as its text — the declared divergence: GTK also draws it bold',
    },
    {
        label: 'a < b',
        useMarkup: true,
        useUnderline: false,
        text: 'a < b',
        rule: 'unparseable markup keeps the raw string, the C fallback',
    },
    {
        label: '<img src="x" onerror="alert(1)">',
        useMarkup: true,
        useUnderline: false,
        text: '<img src="x" onerror="alert(1)">',
        rule: 'a tag Pango does not know is unparseable markup, so it is shown, never built',
    },
    {
        label: '_Open',
        useMarkup: false,
        useUnderline: false,
        text: '_Open',
        rule: 'an underscore is literal unless use-underline is set',
    },
    {
        label: '_Open',
        useMarkup: false,
        useUnderline: true,
        text: 'Open',
        rule: 'use-underline removes the mnemonic marker from the shown text',
    },
    {
        label: '<span font_desc="Sans 12">Big</span>',
        useMarkup: true,
        useUnderline: true,
        text: 'Big',
        rule: 'markup is reduced BEFORE the mnemonic, so an underscore inside a tag is not one',
    },
];

/** One authored `xalign` and the value the label holds. */
export interface LabelXalignVector {
    value: number | string | null;
    xalign: number;
    rule: string;
}

/** `gtk_label_set_xalign` CLAMPs to 0…1 itself; the pspec default is 0.5. */
export const LABEL_XALIGN_VECTORS: ReadonlyArray<LabelXalignVector> = [
    { value: null, xalign: 0.5, rule: 'an absent xalign centres the text, the pspec default' },
    { value: 0, xalign: 0, rule: '0 is the start edge' },
    { value: '0.25', xalign: 0.25, rule: 'the string an attribute carries parses' },
    { value: -1, xalign: 0, rule: 'below the range clamps to 0, as the setter does' },
    { value: '3', xalign: 1, rule: 'above the range clamps to 1' },
    { value: 'left', xalign: 0.5, rule: 'an unparseable value is the default, not NaN' },
];

/** One authored `justify` and the `Gtk.Justification` nick the label holds. */
export interface LabelJustifyVector {
    value: string | null;
    justify: 'left' | 'right' | 'center' | 'fill';
    rule: string;
}

export const LABEL_JUSTIFY_VECTORS: ReadonlyArray<LabelJustifyVector> = [
    { value: null, justify: 'left', rule: 'an absent justify is the default, left' },
    { value: 'center', justify: 'center', rule: 'a nick is read as written' },
    { value: 'fill', justify: 'fill', rule: 'fill is the fourth nick' },
    { value: 'justify', justify: 'left', rule: 'a CSS keyword is no nick, so the default stays' },
];

/** One authored `yalign` and the value the label holds. Same shape as `xalign`. */
export interface LabelYalignVector {
    value: number | string | null;
    yalign: number;
    rule: string;
}

/** `gtk_label_set_yalign` CLAMPs to 0…1 itself; the pspec default is 0.5. */
export const LABEL_YALIGN_VECTORS: ReadonlyArray<LabelYalignVector> = [
    { value: null, yalign: 0.5, rule: 'an absent yalign centres the text, the pspec default' },
    { value: 0, yalign: 0, rule: '0 is the top edge' },
    { value: '0.25', yalign: 0.25, rule: 'the string an attribute carries parses' },
    { value: -1, yalign: 0, rule: 'below the range clamps to 0, as the setter does' },
    { value: '3', yalign: 1, rule: 'above the range clamps to 1' },
    { value: 'top', yalign: 0.5, rule: 'an unparseable value is the default, not NaN' },
];

/** One authored `ellipsize` and the `Pango.EllipsizeMode` nick the label holds. */
export interface LabelEllipsizeVector {
    value: string | null;
    ellipsize: 'none' | 'start' | 'middle' | 'end';
    rule: string;
}

/** `Pango-1.0.gir`'s four `EllipsizeMode` nicks, read via `gi://Pango` under gjs 1.88.1. */
export const LABEL_ELLIPSIZE_VECTORS: ReadonlyArray<LabelEllipsizeVector> = [
    { value: null, ellipsize: 'none', rule: 'an absent ellipsize is the default, none' },
    { value: 'start', ellipsize: 'start', rule: 'a nick is read as written' },
    { value: 'middle', ellipsize: 'middle', rule: 'middle is the third nick' },
    { value: 'end', ellipsize: 'end', rule: 'end is the fourth nick' },
    { value: 'both', ellipsize: 'none', rule: 'an unknown nick leaves the default, none' },
];

/** One `Pango.EllipsizeMode` nick and the ONE truncating value both renderers can draw. */
export interface LabelEllipsizeOverflowVector {
    ellipsize: 'none' | 'start' | 'middle' | 'end';
    overflow: 'clip' | 'ellipsis';
    rule: string;
}

/**
 * Neither CSS `text-overflow` nor NativeScript's `textOverflow` has a start- or
 * middle-truncating mode — see `labelEllipsizeOverflowValue`'s own comment for why every
 * non-`none` mode draws an end-ellipsis rather than a silent `clip`. `start` and `middle`
 * are the DECLARED divergence these two rows pin.
 */
export const LABEL_ELLIPSIZE_OVERFLOW_VECTORS: ReadonlyArray<LabelEllipsizeOverflowVector> = [
    { ellipsize: 'none', overflow: 'clip', rule: 'no ellipsization draws no ellipsis' },
    { ellipsize: 'end', overflow: 'ellipsis', rule: 'end is the one mode CSS/NativeScript name exactly' },
    {
        ellipsize: 'start',
        overflow: 'ellipsis',
        rule: 'declared divergence: no platform truncates from the start, so this draws an end-ellipsis rather than clipping silently',
    },
    {
        ellipsize: 'middle',
        overflow: 'ellipsis',
        rule: 'declared divergence: no platform truncates from the middle, so this draws an end-ellipsis rather than clipping silently',
    },
];

/** One authored `wrap-mode` and the `Pango.WrapMode` nick the label holds. */
export interface LabelWrapModeVector {
    value: string | null;
    wrapMode: 'word' | 'char' | 'word-char';
    rule: string;
}

/** `Pango-1.0.gir`'s three `WrapMode` nicks, read via `gi://Pango` under gjs 1.88.1. */
export const LABEL_WRAP_MODE_VECTORS: ReadonlyArray<LabelWrapModeVector> = [
    { value: null, wrapMode: 'word', rule: 'an absent wrap-mode is the default, word' },
    { value: 'char', wrapMode: 'char', rule: 'a nick is read as written' },
    { value: 'word-char', wrapMode: 'word-char', rule: 'word-char is the third nick' },
    { value: 'wordchar', wrapMode: 'word', rule: 'a nick with the dash dropped is unknown, so the default stays' },
];

/** One authored value and the int `width-chars` / `max-width-chars` / `lines` all hold. */
export interface LabelCharCountVector {
    value: number | string | null;
    count: number;
    rule: string;
}

/**
 * `width-chars`, `max-width-chars` and `lines` share one pspec shape — floor `-1`, default
 * `-1` — so one table drives all three normalizers in `label.spec.ts`. Measured through
 * `label.set_property()`, the door an attribute-driven tree uses (`label.ts`'s header).
 */
export const LABEL_CHAR_COUNT_VECTORS: ReadonlyArray<LabelCharCountVector> = [
    { value: null, count: -1, rule: 'an absent value is the default, -1 ("auto"/unlimited)' },
    { value: 0, count: 0, rule: '0 is a real, held value — an empty label, not "unset"' },
    { value: '12', count: 12, rule: 'the string an attribute carries parses' },
    { value: '3.7', count: 3, rule: 'a fractional string truncates, as an int property would' },
    { value: -5, count: -1, rule: 'below the floor clamps to -1, as the property system does' },
    { value: 'auto', count: -1, rule: 'an unparseable value is the default, not NaN' },
];

/** One `lines` / `wrap` / `ellipsize` combination and the line count a renderer applies. */
export interface LabelEffectiveLinesVector {
    lines: number;
    wrap: boolean;
    ellipsize: 'none' | 'start' | 'middle' | 'end';
    effective: number | null;
    rule: string;
}

/**
 * "This property has no effect if the label is not wrapping or ellipsized" — the pspec's
 * own words for `lines`, pinned here rather than left for each renderer to re-derive.
 */
export const LABEL_EFFECTIVE_LINES_VECTORS: ReadonlyArray<LabelEffectiveLinesVector> = [
    { lines: -1, wrap: true, ellipsize: 'end', effective: null, rule: 'no lines limit is no effective limit' },
    { lines: 2, wrap: false, ellipsize: 'none', effective: null, rule: 'neither wrapping nor ellipsized: no effect' },
    { lines: 2, wrap: true, ellipsize: 'none', effective: 2, rule: 'wrapping alone is enough' },
    { lines: 2, wrap: false, ellipsize: 'end', effective: 2, rule: 'ellipsized alone is enough, even without wrap' },
    { lines: 3, wrap: true, ellipsize: 'end', effective: 3, rule: 'wrapping and ellipsized together still applies' },
    { lines: 0, wrap: true, ellipsize: 'none', effective: 0, rule: '0 is a real, held limit — zero lines' },
];

/** One `width-chars` + `max-width-chars` pair and the `ch`-unit extent it derives. */
export interface LabelWidthCharsExtentVector {
    widthChars: number;
    maxWidthChars: number;
    minCh: number | null;
    maxCh: number | null;
    rule: string;
}

/** `get_default_widths` (gtklabel.c): minimum is `width-chars`, natural is their MAX. */
export const LABEL_WIDTH_CHARS_EXTENT_VECTORS: ReadonlyArray<LabelWidthCharsExtentVector> = [
    { widthChars: -1, maxWidthChars: -1, minCh: null, maxCh: null, rule: 'both unset: no extent either way' },
    { widthChars: 10, maxWidthChars: -1, minCh: 10, maxCh: null, rule: 'width-chars alone sets a minimum only' },
    { widthChars: -1, maxWidthChars: 20, minCh: null, maxCh: 20, rule: 'max-width-chars alone sets a natural width' },
    { widthChars: 10, maxWidthChars: 20, minCh: 10, maxCh: 20, rule: 'both set: minimum and the wider natural' },
    {
        widthChars: 15,
        maxWidthChars: 5,
        minCh: 15,
        maxCh: 15,
        rule: 'max-width-chars narrower than width-chars: natural is still the MAX of the two, per the C',
    },
];
