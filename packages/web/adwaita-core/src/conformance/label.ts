// `Gtk.Label` vectors — what a label SHOWS, and how an authored `xalign` / `justify`
// becomes the property. Driven by `label.spec.ts` against the core functions and by
// adwaita-web's `gtk-label.spec.ts` against the element's attributes and rendered text.
//
// THE DISPLAY ROWS ARE GTK'S, measured under gjs 1.88.1 / gtk 4.22.4 with
// `Gtk.Label.get_text()` read back after each write — except the one row marked as the
// declared divergence: GTK RENDERS markup bold, and no port here renders markup, because
// on the web the short road to styled runs is `innerHTML`, which executes what the string
// carries. The ports show the markup's TEXT, which is what `get_text()` returns anyway.
//
// Reference: refs/gtk/gtk/gtklabel.c (gtk_label_set_markup, gtk_label_set_xalign,
//   gtk_label_set_justify)
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
