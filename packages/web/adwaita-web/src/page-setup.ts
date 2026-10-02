// The PORTABLE `Gtk.PageSetup` — the value the two print dialogs read and write.
//
// `GtkPageSetup` is a GObject holding a paper size and four margins, and both
// `GtkPageSetupUnixDialog` and `GtkPrintUnixDialog` carry it as a property. An HTML
// attribute cannot hold an object, so on this renderer the object is PLAIN DATA and
// the two widgets expose it as a property (`pageSetup`), which is the shape ADR 0047
// gave `Gtk.Adjustment` and ADR 0046 gave the list models: a `get`/`set` pair where
// the setter still performs GTK's derivation instead of storing the value.
//
// WHAT IS PORTED, AND WHERE IT COMES FROM
//
//   · the twelve `common_paper_sizes` — gtkpagesetupunixdialog.c:121-134 — with each
//     one's `PaperInfo` row from gtk/paper_names.c (the `210x297mm` size string and
//     the display name), parsed the way `parse_media_size` (gtkpapersize.c:101-136)
//     parses it, `in` converted at `MM_PER_INCH`;
//   · the DEFAULT MARGINS — `gtk_paper_size_get_default_{top,bottom,left,right}_margin`
//     (gtkpapersize.c:835-900): 0.25in everywhere, and 0.56in at the BOTTOM for
//     `na_letter`, `na_legal` and `iso_a4` alone;
//   · the page `double_to_string` munges its numbers with (gtkpagesetupunixdialog.c:
//     594-628): two decimals in inch, ONE in mm, and the trailing zeros stripped so a
//     whole number prints without a decimal point at all;
//   · the two label strings `paper_size_changed` composes from them (the `W × H unit`
//     line and the four-line `Margins:` tooltip).
//
// WHAT IS NOT, and why: the printer's OWN paper list (`gtk_printer_list_papers`,
// reached through CUPS/IPP backends), which needs a print backend and therefore a
// print subsystem. Both dialogs show the twelve COMMON sizes here — which is exactly
// what GTK does for `printer == NULL` (gtkpagesetupunixdialog.c:474-491) — and the
// `Manage Custom Sizes…` row opens nothing, as the custom-paper dialog needs the same
// backends.

/** `Gtk.PageOrientation`, in enum order. Reversed orientations are separate values. */
export const PAGE_ORIENTATIONS = ['portrait', 'landscape', 'reverse-portrait', 'reverse-landscape'] as const;

/** One `Gtk.PageOrientation` — the nicks `packages/framework/gtk-host` generates. */
export type PageOrientation = (typeof PAGE_ORIENTATIONS)[number];

/** The `Gtk.Unit` the two dialogs' labels speak: millimetres or inches. */
export type PageUnit = 'mm' | 'inch';

/** One row of GTK's `paper_names` table, in millimetres. */
export interface PaperSize {
    /** The `GtkPaperSize` name — `iso_a4`, `na_letter`, … */
    readonly name: string;
    /** `gtk_paper_size_get_display_name()` — `A4`, `US Letter`, … */
    readonly displayName: string;
    /** Short edge, mm. */
    readonly width: number;
    /** Long edge, mm. */
    readonly height: number;
}

/** `MM_PER_INCH` (gtkpapersize.c) — the one conversion `parse_media_size` needs. */
const MM_PER_INCH = 25.4;

/**
 * The twelve `common_paper_sizes`, in the order `fill_paper_sizes_from_printer` appends
 * them when there is no printer (gtkpagesetupunixdialog.c:474-491): the list is
 * deliberately NOT sorted, so the order here is the one a reader sees.
 *
 * Sizes and names are the `paper_names.c` rows for those keys; `in` sizes are
 * converted once, at parse time, exactly as `parse_media_size` does.
 */
export const COMMON_PAPER_SIZES: readonly PaperSize[] = [
    { name: 'na_letter', displayName: 'US Letter', width: 8.5 * MM_PER_INCH, height: 11 * MM_PER_INCH },
    { name: 'na_legal', displayName: 'US Legal', width: 8.5 * MM_PER_INCH, height: 14 * MM_PER_INCH },
    { name: 'iso_a4', displayName: 'A4', width: 210, height: 297 },
    { name: 'iso_a5', displayName: 'A5', width: 148, height: 210 },
    { name: 'roc_16k', displayName: 'ROC 16k', width: 7.75 * MM_PER_INCH, height: 10.75 * MM_PER_INCH },
    { name: 'iso_b5', displayName: 'B5', width: 176, height: 250 },
    { name: 'jis_b5', displayName: 'JB5', width: 182, height: 257 },
    { name: 'na_number-10', displayName: '#10 Envelope', width: 4.125 * MM_PER_INCH, height: 9.5 * MM_PER_INCH },
    { name: 'iso_dl', displayName: 'DL Envelope', width: 110, height: 220 },
    { name: 'jpn_chou3', displayName: 'Choukei 3 Envelope', width: 120, height: 235 },
    { name: 'na_ledger', displayName: 'Tabloid', width: 11 * MM_PER_INCH, height: 17 * MM_PER_INCH },
    { name: 'iso_a3', displayName: 'A3', width: 297, height: 420 },
];

/** The paper sizes whose bottom margin is 0.56in rather than 0.25in. */
const TALL_BOTTOM_MARGIN = new Set(['na_letter', 'na_legal', 'iso_a4']);

/**
 * `double_to_string` (gtkpagesetupunixdialog.c:594-628).
 *
 * The comment above the C is the reason this is not `toFixed`: the author wanted no
 * decimal point at all on a whole number and at most one significant digit otherwise,
 * and `printf` offers no "max precision" — so the code prints two places in inch and
 * one in mm and then strips the zeros and the separator by hand. The stripping is
 * ASCII-only and drops a `0.0` to `0`.
 */
export function doubleToString(value: number, unit: PageUnit): string {
    // Two decimals in inch, ONE in mm — the two `g_strdup_printf` formats.
    let text = unit === 'inch' ? value.toFixed(2) : value.toFixed(1);
    // `strstr (val, decimal_point)` — the value HAS a fractional part.
    if (text.includes('.')) {
        // Drop the trailing zeros, then a separator left dangling by them.
        text = text.replace(/0+$/, '');
        if (text.endsWith('.')) text = text.slice(0, -1);
    }
    return text;
}

/** The four margins of a `Gtk.PageSetup`, in millimetres. */
export interface PageMargins {
    readonly top: number;
    readonly bottom: number;
    readonly left: number;
    readonly right: number;
}

/**
 * `gtk_page_setup_set_paper_size_and_default_margins` (gtkpagesetup.c:248-258) —
 * every margin `gtk_paper_size_get_default_*_margin` returns, for one paper size.
 */
export function defaultMargins(size: PaperSize): PageMargins {
    return {
        top: 0.25 * MM_PER_INCH,
        bottom: (TALL_BOTTOM_MARGIN.has(size.name) ? 0.56 : 0.25) * MM_PER_INCH,
        left: 0.25 * MM_PER_INCH,
        right: 0.25 * MM_PER_INCH,
    };
}

/** A plain-data `Gtk.PageSetup`: which paper, which way up, and the four margins. */
export interface PageSetup {
    /** The `GtkPaperSize` name. */
    readonly paperSize: string;
    /** `GtkPageOrientation`. */
    readonly orientation: PageOrientation;
    /** Margins in millimetres, which is what `GtkPageSetup` stores internally. */
    readonly margins: PageMargins;
}

/**
 * `gtk_page_setup_new()` — the default setup GTK hands a dialog that has been given
 * none: ISO A4, portrait, the default margins for it.
 */
export function defaultPageSetup(): PageSetup {
    const size = COMMON_PAPER_SIZES.find((candidate) => candidate.name === 'iso_a4')!;
    return { paperSize: size.name, orientation: 'portrait', margins: defaultMargins(size) };
}

/**
 * `gtk_paper_size_new (name)` + the margins, for one of the twelve common sizes, or
 * `null` for a name the table does not have — which is what `set_paper_size` sees
 * when no row matches (it returns FALSE rather than inventing one).
 */
export function paperSizeByName(name: string): PaperSize | null {
    return COMMON_PAPER_SIZES.find((candidate) => candidate.name === name) ?? null;
}

/** The paper size a setup names, or the default one when the name is unknown. */
export function paperSizeOf(setup: PageSetup): PaperSize {
    return paperSizeByName(setup.paperSize) ?? COMMON_PAPER_SIZES[2]!;
}

/**
 * `page_setup_is_equal` (gtkpagesetupunixdialog.c:410-418): same paper AND the same
 * four margins. `page_setup_is_same_size` is the first half of it, which
 * `set_paper_size` asks for when a new printer brings its own sizes along.
 */
export function pageSetupEquals(a: PageSetup, b: PageSetup): boolean {
    return (
        a.paperSize === b.paperSize &&
        a.margins.top === b.margins.top &&
        a.margins.bottom === b.margins.bottom &&
        a.margins.left === b.margins.left &&
        a.margins.right === b.margins.right
    );
}

/** `page_setup_is_same_size` — the paper alone, margins ignored. */
export function pageSetupSameSize(a: PageSetup, b: PageSetup): boolean {
    return a.paperSize === b.paperSize;
}

/**
 * The width and height a `GtkPageSetup` reports for an orientation: landscape and
 * reverse-landscape SWAP the two edges, which is the whole of
 * `gtk_page_setup_get_orientation`-aware geometry in GTK (there is no separate
 * landscape size).
 */
export function orientedSize(setup: PageSetup, unit: PageUnit = 'mm'): { width: number; height: number } {
    const size = paperSizeOf(setup);
    const landscape = setup.orientation === 'landscape' || setup.orientation === 'reverse-landscape';
    const width = landscape ? size.height : size.width;
    const height = landscape ? size.width : size.height;
    if (unit === 'mm') return { width, height };
    return { width: width / MM_PER_INCH, height: height / MM_PER_INCH };
}

/** The `unit_str` of `paper_size_changed`: `_("mm")` or `_("inch")`. */
export function unitLabel(unit: PageUnit): string {
    return unit === 'mm' ? 'mm' : 'inch';
}

/**
 * The label under the paper-size combo: `W × H unit`, both numbers through
 * {@link doubleToString} and in the dialog's user unit.
 */
export function paperSizeLabel(setup: PageSetup, unit: PageUnit = 'mm'): string {
    const { width, height } = orientedSize(setup, unit);
    return `${doubleToString(width, unit)} × ${doubleToString(height, unit)} ${unitLabel(unit)}`;
}

/**
 * The tooltip `paper_size_changed` puts on the same label — the margins alone, in its
 * order: left, right, top, bottom. The sizes live in the label text, not here.
 */
export function paperMarginsTooltip(setup: PageSetup, unit: PageUnit = 'mm'): string {
    // A `GtkPageSetup` stores its margins in mm whatever the display unit is.
    const inUnit = (value: number) => (unit === 'mm' ? value : value / MM_PER_INCH);
    const shown = (value: number) => `${doubleToString(inUnit(value), unit)} ${unitLabel(unit)}`;
    const { margins } = setup;
    return [
        'Margins:',
        ` Left: ${shown(margins.left)}`,
        ` Right: ${shown(margins.right)}`,
        ` Top: ${shown(margins.top)}`,
        ` Bottom: ${shown(margins.bottom)}`,
    ].join('\n');
}
