// `Gtk.Label` MARKUP vectors — the styled runs a label DRAWS, and the `<a href>` links it
// records. The sibling of `conformance/label.ts`, which answers the TEXT question
// (`get_text()`); this file answers the drawing one. Driven by `label-markup.spec.ts`
// against `label-markup.ts`, by adwaita-web's `gtk-label.spec.ts` against the rendered
// nodes and by the NativeScript suite against the `FormattedString` spans.
//
// WHAT IS MEASURED AND WHAT IS READ FROM THE C. The attributed runs behind a label are
// `PangoLayout`'s private `PangoAttrList` and a link is a private `GtkLabelLink`, so
// neither is readable from gjs — the run and offset columns are pango's documented markup
// semantics plus gtklabel.c's `parse_uri_markup`, transcribed. Each row's CONSEQUENCE is
// measured, under gjs 1.88.1 / gtk 4.22.5: `gtk_label_get_text()` for the `text` column,
// `gtk_widget_has_css_class (label, "link")` for `cssClass` and
// `gtk_widget_get_has_tooltip` for `hasTooltip`.
//
// Reference: pango's markup documentation (the eleven tags and `<span>`'s attributes)
// Reference: refs/gtk/gtk/gtklabel.c:3573-3700 (parse_uri_markup, start_element_handler,
//   end_element_handler, finish_text), :3841 (gtk_label_ensure_has_tooltip), :3896 (the
//   `link` CSS class)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** One run a label draws: the characters, and the style pango's nesting resolves to. */
export interface LabelMarkupRunExpectation {
    text: string;
    /** Every flag omitted means "not set", so a row only writes what the markup turns on. */
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strikethrough?: boolean;
    monospace?: boolean;
    /** `<big>` minus `<small>`; absent is 0. */
    sizeSteps?: number;
    script?: 'sub' | 'sup';
    /** The index into the same row's `links`, absent when the run is outside every `<a>`. */
    link?: number;
    /** The `<span>` attribute sets over the run, outermost first; absent is none. */
    spans?: ReadonlyArray<Readonly<Record<string, string>>>;
}

/** One markup string and the styled runs both ports draw for it. */
export interface LabelMarkupRunVector {
    markup: string;
    /** `gtk_label_get_text()` for the same string — the runs' text concatenated. */
    text: string;
    runs: ReadonlyArray<LabelMarkupRunExpectation>;
    rule: string;
}

/**
 * THE MERGE IS THE PART A RENDERER GETS WRONG. `<b>a</b><b>b</b>` is ONE bold run, not
 * two: pango attributes character ranges and two adjacent ranges with equal attributes are
 * one range. A port that emits one span per element draws two boxes, and a line break or a
 * selection can then fall between two characters that are typographically one word — so
 * the row with the two adjacent `<b>` elements is the row that catches it.
 *
 * `<big>`/`<small>` ARE COUNTED, NOT FLAGS, because pango multiplies one scale factor per
 * element: `<big><big>x</big></big>` is two steps up, and `<small>` inside `<big>` is back
 * to zero. The innermost-wins reading a boolean would give is wrong at both rows.
 */
export const LABEL_MARKUP_RUN_VECTORS: ReadonlyArray<LabelMarkupRunVector> = [
    {
        markup: 'plain',
        text: 'plain',
        runs: [{ text: 'plain' }],
        rule: 'text with no tag at all is one unstyled run',
    },
    {
        markup: '<b>Bold</b> and <i>italic</i>',
        text: 'Bold and italic',
        runs: [{ text: 'Bold', bold: true }, { text: ' and ' }, { text: 'italic', italic: true }],
        rule: 'each element is a run, and the text between them is a run of its own',
    },
    {
        markup: '<b>a</b><b>b</b>',
        text: 'ab',
        runs: [{ text: 'ab', bold: true }],
        rule: 'adjacent runs of equal style MERGE — pango attributes ranges, not elements',
    },
    {
        markup: '<b>bold <i>both</i></b>',
        text: 'bold both',
        runs: [
            { text: 'bold ', bold: true },
            { text: 'both', bold: true, italic: true },
        ],
        rule: 'nesting accumulates: the inner run carries both tags',
    },
    {
        markup: 'x<sub>2</sub> and y<sup>3</sup>',
        text: 'x2 and y3',
        runs: [{ text: 'x' }, { text: '2', script: 'sub' }, { text: ' and y' }, { text: '3', script: 'sup' }],
        rule: 'sub and sup are the vertical position of a run, the pair GTK writes formulae with',
    },
    {
        markup: '<sub><sup>inner</sup></sub>',
        text: 'inner',
        runs: [{ text: 'inner', script: 'sup' }],
        rule: 'a run cannot be both: the INNERMOST of sub/sup wins, as pango resolves it',
    },
    {
        markup: '<tt>code</tt> in prose',
        text: 'code in prose',
        runs: [{ text: 'code', monospace: true }, { text: ' in prose' }],
        rule: 'tt is the monospace run — the tag the measured tutorial corpus uses 350 times',
    },
    {
        markup: '<u>under</u><s>struck</s>',
        text: 'understruck',
        runs: [
            { text: 'under', underline: true },
            { text: 'struck', strikethrough: true },
        ],
        rule: 'u and s are separate runs: equal text, different attributes, so no merge',
    },
    {
        markup: '<big><big>huge</big></big>',
        text: 'huge',
        runs: [{ text: 'huge', sizeSteps: 2 }],
        rule: 'big COMPOSES: pango applies one scale factor per element, so two is two steps',
    },
    {
        markup: '<big><small>back</small></big>',
        text: 'back',
        runs: [{ text: 'back' }],
        rule: 'small inside big cancels to the base size, which innermost-wins would get wrong',
    },
    {
        markup: '<span foreground="red">Hot</span>',
        text: 'Hot',
        runs: [{ text: 'Hot', spans: [{ foreground: 'red' }] }],
        rule: 'a span carries its attributes to the renderer, which owns the platform mapping',
    },
    {
        markup: '<span weight="bold"><span foreground="red">both</span></span>',
        text: 'both',
        runs: [{ text: 'both', spans: [{ weight: 'bold' }, { foreground: 'red' }] }],
        rule: 'nested spans are a STACK, outermost first, so the innermost wins per property',
    },
    {
        markup: 'Tea &amp; cake',
        text: 'Tea & cake',
        runs: [{ text: 'Tea & cake' }],
        rule: 'an entity is resolved into the run, so `&amp;` is one character to draw',
    },
    {
        markup: '<markup><b>rooted</b></markup>',
        text: 'rooted',
        runs: [{ text: 'rooted', bold: true }],
        rule: "markup is pango's implicit root and styles nothing",
    },
    {
        markup: 'Read the <a href="https://gtk.org">docs</a> first',
        text: 'Read the docs first',
        runs: [{ text: 'Read the ' }, { text: 'docs', link: 0 }, { text: ' first' }],
        rule: "a link is a run like any other, pointing at the row's link by index",
    },
    {
        markup: '<a href="https://gtk.org"><b>bold link</b></a>',
        text: 'bold link',
        runs: [{ text: 'bold link', bold: true, link: 0 }],
        rule: 'a link and a tag compose — the run is inside both',
    },
    {
        markup: '<b>unclosed',
        text: '<b>unclosed',
        runs: [],
        rule: 'unparseable markup has NO runs: the caller shows the raw string, the C fallback',
    },
];

/** One `<a href>` as a label records it. */
export interface LabelMarkupLinkExpectation {
    href: string;
    title: string | null;
    cssClass: string | null;
    /** Where the link's text starts in the display text, in UTF-16 code units. */
    start: number;
    /** Where it ends, exclusive. */
    end: number;
}

/** One markup string and the links a label takes from it. */
export interface LabelMarkupLinkVector {
    markup: string;
    /** `null` when the markup does not parse at all, and the raw string stands. */
    links: ReadonlyArray<LabelMarkupLinkExpectation> | null;
    /** Whether the label gains the `link` CSS class — any link at all. */
    cssClass: boolean;
    /** Whether the label gains `has-tooltip` — any link with a `title`. */
    hasTooltip: boolean;
    rule: string;
}

/**
 * `Gtk.Label`'s `<a href>` — the one tag that is the LABEL'S and not pango's.
 *
 * THE OFFSETS ARE UTF-16 CODE UNITS, where GTK's are bytes (`pdata->text_len` as
 * `parse_uri_markup` walks). JavaScript has no byte offsets into a string, and the units
 * that matter are the ones `String.prototype.slice` takes — a renderer cutting the display
 * text with these gets the characters GTK's layout attributed. The row with a non-ASCII
 * character before the link is the one that distinguishes the two.
 *
 * THE THREE ATTRIBUTES ARE A CLOSED SET. `href` is required
 * (`G_MARKUP_ERROR_INVALID_CONTENT` without it), `title` and `class` are optional, and a
 * fourth attribute is `G_MARKUP_ERROR_UNKNOWN_ATTRIBUTE` — which means the whole string
 * fails to parse and the label shows it raw, not that the attribute is ignored.
 */
export const LABEL_MARKUP_LINK_VECTORS: ReadonlyArray<LabelMarkupLinkVector> = [
    {
        markup: 'no links here',
        links: [],
        cssClass: false,
        hasTooltip: false,
        rule: 'markup without an `<a>` has no links, and the label stays unstyled',
    },
    {
        markup: 'Read the <a href="https://gtk.org">docs</a> first',
        links: [{ href: 'https://gtk.org', title: null, cssClass: null, start: 9, end: 13 }],
        cssClass: true,
        hasTooltip: false,
        rule: 'the offsets are into the DISPLAY text, so `Read the ` is nine units',
    },
    {
        markup: '<a href="https://gtk.org" title="The GTK docs">docs</a>',
        links: [{ href: 'https://gtk.org', title: 'The GTK docs', cssClass: null, start: 0, end: 4 }],
        cssClass: true,
        hasTooltip: true,
        rule: "a title is the label's tooltip over that link, so the widget opts in",
    },
    {
        markup: '<a href="https://gtk.org" class="accent">docs</a>',
        links: [{ href: 'https://gtk.org', title: null, cssClass: 'accent', start: 0, end: 4 }],
        cssClass: true,
        hasTooltip: false,
        rule: "class goes on the link's own node, and is not a tooltip",
    },
    {
        markup: '<a href="a">one</a> and <a href="b">two</a>',
        links: [
            { href: 'a', title: null, cssClass: null, start: 0, end: 3 },
            { href: 'b', title: null, cssClass: null, start: 8, end: 11 },
        ],
        cssClass: true,
        hasTooltip: false,
        rule: 'two links are two entries in reading order, each over its own range',
    },
    {
        markup: '<a href="a">one</a><a href="b" title="t">two</a>',
        links: [
            { href: 'a', title: null, cssClass: null, start: 0, end: 3 },
            { href: 'b', title: 't', cssClass: null, start: 3, end: 6 },
        ],
        cssClass: true,
        hasTooltip: true,
        rule: 'ONE link with a title is enough for has-tooltip — the tooltip is per-link',
    },
    {
        markup: 'Tee &amp; <a href="https://gtk.org">Kuchen</a>',
        links: [{ href: 'https://gtk.org', title: null, cssClass: null, start: 6, end: 12 }],
        cssClass: true,
        hasTooltip: false,
        rule: 'the offset counts the RESOLVED entity as one unit, not `&amp;` as five',
    },
    {
        markup: 'Über <a href="https://gtk.org">uns</a>',
        links: [{ href: 'https://gtk.org', title: null, cssClass: null, start: 5, end: 8 }],
        cssClass: true,
        hasTooltip: false,
        rule: 'UTF-16 code units, not bytes: `Über ` is five units where GTK counts six',
    },
    {
        markup: '<a href="https://gtk.org"><b>bold</b> link</a>',
        links: [{ href: 'https://gtk.org', title: null, cssClass: null, start: 0, end: 9 }],
        cssClass: true,
        hasTooltip: false,
        rule: "a link's range covers all its text, however many runs the tags inside make",
    },
    {
        markup: '<a href="https://gtk.org"></a>',
        links: [{ href: 'https://gtk.org', title: null, cssClass: null, start: 0, end: 0 }],
        cssClass: true,
        hasTooltip: false,
        rule: 'an empty link is a link with nothing to click — recorded, not dropped',
    },
    {
        markup: '<a href="outer">out <a href="inner">in</a></a>',
        links: [
            { href: 'outer', title: null, cssClass: null, start: 0, end: 6 },
            { href: 'inner', title: null, cssClass: null, start: 4, end: 6 },
        ],
        cssClass: true,
        hasTooltip: false,
        rule: 'GMarkup has no content model, so nested `<a>` parses and the INNER one owns its text',
    },
    {
        markup: '<a>no href</a>',
        links: null,
        cssClass: false,
        hasTooltip: false,
        rule: 'href is required (G_MARKUP_ERROR_INVALID_CONTENT), so the whole string is raw text',
    },
    {
        markup: '<a href="x" target="_blank">docs</a>',
        links: null,
        cssClass: false,
        hasTooltip: false,
        rule: 'a fourth attribute is UNKNOWN_ATTRIBUTE: the parse fails, the attribute is not ignored',
    },
    {
        markup: '<a href="x">unclosed',
        links: null,
        cssClass: false,
        hasTooltip: false,
        rule: 'an unclosed link is unparseable markup like any other',
    },
];
