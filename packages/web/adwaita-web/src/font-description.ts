// A `PangoFontDescription` as plain data — the shape `Gtk.FontDialogButton:font-desc`
// carries (gtkfontdialogbutton.c:340-345), and the only one a browser can hold.
//
// WHY A MODULE AND NOT THE ELEMENT. The description is a VALUE with a grammar: Pango's
// own string form in and out, an equality test, and a projection onto CSS. All three are
// pure and all three outlive the element — the NativeScript port needs the same parse to
// give its XML attribute the same meaning, and a copy inside `<gtk-font-dialog-button>`
// would be the second spelling the second renderer drifts from.
//
// THE GRAMMAR IS PANGO'S, and only the part the button uses is here. `from_string` reads
// a trailing number as the size and every recognised word as a style, in any order, and
// `to_string` writes them back in ITS order — weight, then slant, then width, then size
// (`pango_font_description_to_string`). Both are reproduced, including the words
// themselves, because the string is what `font-desc` carries on the wire and what the
// C's `pango_font_description_equal` compares.
//
// THE FOUR STYLE WORDS A BROWSER HAS. Pango knows twelve weights and three slants; CSS
// has numbers 1…1000 and two slants, so the projection is total in one direction and
// lossy in the other: Pango's `ULTRALIGHT` is CSS's `200` and `SEMIBOLD` is `600`, both
// exactly, because Pango's weights ARE the CSS numbers. Nothing is approximated.
//
// Reference: refs/gtk/gtk/gtkfontdialogbutton.c (font_desc, font_description_style_equal,
//   update_font_info's size format, apply_use_font)
// Reference: refs/gtk/gtk/gtkfonts.c (`pango_font_description_to_string`'s word order)
// Copyright (c) GNOME contributors (Pango). LGPLv2.1+.
// Modifications: Implemented for @gjsify/adwaita-web as plain data.

/** The horizontal slant Pango spells. CSS has `italic` and `oblique`, and so does this. */
export type FontSlant = 'normal' | 'italic' | 'oblique';

/** The four widths Pango distinguishes; CSS `font-stretch` names the same three. */
export type FontWidth = 'normal' | 'condensed' | 'expanded';

/**
 * The fields `GtkFontDialogButton` reads. `variant` and the exact family/face are
 * deliberately absent: the C compares them in `font_description_style_equal`
 * (gtkfontdialogbutton.c:586-592) to pick a face out of a font map, and a browser page
 * has no font map — see `font-button`'s header for what stands in for it.
 */
export interface PangoFontDescription {
    /** The family name, or `''` for the "unset" a fresh description carries. */
    family: string;
    slant: FontSlant;
    /** Pango's numeric weight, which is also CSS's `font-weight` number. */
    weight: number;
    width: FontWidth;
    /** The size as written. `unit` says what it is counted in. */
    size: number;
    /** `pango_font_description_set_size_is_absolute` — `true` means the size is pixels. */
    absolute: boolean;
}

/** The description `gtk_font_dialog_button_init` builds: `pango_font_description_from_string ("Sans 12")`. */
export const PANGO_FONT_DESCRIPTION_DEFAULT: PangoFontDescription = {
    family: 'Sans',
    slant: 'normal',
    weight: 400,
    width: 'normal',
    size: 12,
    absolute: false,
};

/**
 * Pango's style words, and what each one sets. `to_string` emits them in THIS order
 * (weight, then slant, then width), so a description round-trips to the same string.
 */
const STYLE_WORDS: readonly { word: string; set: Partial<Omit<PangoFontDescription, 'family' | 'size'>> }[] = [
    { word: 'Thin', set: { weight: 100 } },
    { word: 'UltraLight', set: { weight: 200 } },
    { word: 'Light', set: { weight: 300 } },
    { word: 'SemiLight', set: { weight: 350 } },
    { word: 'Book', set: { weight: 375 } },
    { word: 'Medium', set: { weight: 500 } },
    { word: 'SemiBold', set: { weight: 600 } },
    { word: 'Bold', set: { weight: 700 } },
    { word: 'UltraBold', set: { weight: 800 } },
    { word: 'Heavy', set: { weight: 900 } },
    { word: 'Black', set: { weight: 1000 } },
    { word: 'Italic', set: { slant: 'italic' } },
    { word: 'Oblique', set: { slant: 'oblique' } },
    { word: 'Condensed', set: { width: 'condensed' } },
    { word: 'Expanded', set: { width: 'expanded' } },
];

/**
 * `pango_font_description_from_string` — family, style words and a trailing size, in any
 * order.
 *
 * Total, like the C: an unrecognised word is not a style, and a family is whatever is
 * left over once the styles and the size are gone — which is why the tokens are consumed
 * from the END, where Pango reads the size, and a token that matches no style word stays
 * in the family.
 */
export function parseFontDescription(text: string): PangoFontDescription {
    const description: PangoFontDescription = { ...PANGO_FONT_DESCRIPTION_DEFAULT, family: '' };
    const tokens = text
        .trim()
        .split(/\s+/)
        .filter((token) => token !== '');
    // The size is the LAST token that parses as a number, and Pango remembers whether it
    // was written in pixels.
    for (let end = tokens.length; end > 0; end--) {
        const size = /^(-?\d+(?:\.\d+)?)(px)?$/.exec(tokens[end - 1]);
        if (size === null) continue;
        description.size = Number(size[1]);
        description.absolute = size[2] === 'px';
        tokens.length = end - 1;
        break;
    }
    const family: string[] = [];
    for (const token of tokens) {
        const word = STYLE_WORDS.find((entry) => entry.word.toLowerCase() === token.toLowerCase());
        if (word === undefined) {
            family.push(token);
            continue;
        }
        Object.assign(description, word.set);
    }
    description.family = family.join(' ');
    return description;
}

/** `pango_font_description_to_string` — the same words, in the same order. */
export function formatFontDescription(description: PangoFontDescription): string {
    const words: string[] = [];
    for (const { word, set } of STYLE_WORDS) {
        const matches = Object.entries(set).every(
            ([key, value]) => description[key as keyof PangoFontDescription] === value,
        );
        if (matches && !words.includes(word)) words.push(word);
    }
    const size = `${description.size}${description.absolute ? 'px' : ''}`;
    return [description.family, ...words, size].filter((part) => part !== '').join(' ');
}

/**
 * `pango_font_description_equal` — every field, as Pango's own comparison is. `font-desc`
 * is `G_PARAM_EXPLICIT_NOTIFY` (:345), so a write of the description already held must be
 * the write that changes nothing (gtkfontdialogbutton.c:869-871).
 */
export function fontDescriptionEqual(a: PangoFontDescription, b: PangoFontDescription): boolean {
    return (
        a.family === b.family &&
        a.slant === b.slant &&
        a.weight === b.weight &&
        a.width === b.width &&
        a.size === b.size &&
        a.absolute === b.absolute
    );
}

/**
 * `update_font_info`'s size format, `g_strdup_printf ("%2.4g%s", size / PANGO_SCALE, …)`
 * (gtkfontdialogbutton.c:669-673) — four significant digits with the zeros stripped, and
 * `px` when the size is absolute. `%g` is what `Number#toPrecision` computes and
 * `Number#toString` then tidies, which is the whole of the difference between `12` and
 * `12.00`.
 */
export function formatFontSize(size: number, absolute: boolean): string {
    return `${Number(size.toPrecision(4))}${absolute ? 'px' : ''}`;
}

/**
 * The CSS projection of a description — `apply_use_font`'s attribute list
 * (gtkfontdialogbutton.c:689-720), as the four LONGHANDS Pango's own attribute list sets.
 *
 * `use_size` is the one field `apply_use_font` may unset, and it is a parameter here for
 * that reason: `PANGO_FONT_MASK_SIZE` goes only when the size is not wanted.
 *
 * The longhands rather than the `font` SHORTHAND, because the shorthand is all-or-nothing:
 * one rejected token discards the family with it, and a description is half its fields.
 * `cssFontShorthand` is the same projection for the one caller that needs a string —
 * `FontFaceSet.check()`, which takes nothing else.
 *
 * THE SIZE CARRIES A UNIT, and Pango's own string does not — which is the one place this
 * projection is not a rename. A bare `12` is a size in Pango (points, because
 * `PangoFontDescription`'s size is divided by `PANGO_SCALE` and Pango's renderer reads
 * points) and a length a CSS declaration REJECTS. `pt` is the unit Pango means — one point
 * is 1/72 inch in both — so an absolute size keeps `px` and everything else becomes `pt`.
 */
export interface CssFontParts {
    fontFamily: string;
    fontWeight: string;
    fontStyle: string;
    fontStretch: string;
    fontSize: string;
}

/** An unset family is "None" as a LABEL, not a font to render in — so the generic is. */
export function cssFontParts(description: PangoFontDescription, useSize: boolean): CssFontParts {
    return {
        fontFamily: description.family === '' ? 'sans-serif' : `"${description.family}"`,
        fontWeight: String(description.weight),
        fontStyle: description.slant,
        fontStretch: description.width,
        fontSize: useSize ? `${description.size}${description.absolute ? 'px' : 'pt'}` : '',
    };
}

/** {@link cssFontParts} as one `font` shorthand, for the string-shaped caller. */
export function cssFontShorthand(description: PangoFontDescription, useSize: boolean): string {
    const parts = cssFontParts(description, useSize);
    const shorthand: string[] = [];
    if (parts.fontStyle !== 'normal') shorthand.push(parts.fontStyle);
    if (parts.fontWeight !== '400') shorthand.push(parts.fontWeight);
    if (parts.fontStretch !== 'normal') shorthand.push(parts.fontStretch);
    if (parts.fontSize !== '') shorthand.push(parts.fontSize);
    if (shorthand.length > 0) shorthand.push('');
    return `${shorthand.join(' ')}${parts.fontFamily}`.trim();
}

/**
 * Pango's feature list as the TAGS a CSS `font-feature-settings` value is built from — the
 * one place this module translates rather than renames.
 *
 * `pango_font_features_to_string` writes a comma-separated list of bare tags with `-` for
 * off, which is the same LIST and not the same SYNTAX: CSS wants each tag quoted (`"liga"`).
 *
 * The tags come back as a LIST on purpose. `font-feature-settings` is all-or-nothing, and
 * MEASURED in Firefox: the declaration `"liga", "-kern"` is DROPPED WHOLE — an unknown tag
 * invalidates the value, not just itself — while `"liga"` alone stands. A single joined
 * string would therefore lose every tag the browser does not know, which is a silent
 * difference from Pango's "keep what you recognise". The caller applies the tags one at a
 * time so a rejection costs one feature.
 *
 * `tnum=1` keeps its `=1`, which is Pango's own spelling for "on with a value".
 */
export function cssFontFeatureTags(features: string): string[] {
    return features
        .split(',')
        .map((feature) => feature.trim())
        .filter((feature) => feature !== '')
        .map((feature) => `"${feature}"`);
}
