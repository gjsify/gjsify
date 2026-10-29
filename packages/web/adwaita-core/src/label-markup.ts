// `Gtk.Label`'s markup as something a renderer can DRAW — the parse tree flattened into
// styled runs, the link runs beside them, and `::activate-link`'s default rule.
//
// NO STATE MACHINE (ADR 0004, trivial behaviour). What is here is the derivation both
// label renderers would otherwise each invent: WHICH characters are bold, WHICH sit inside
// an `<a href>`, and what happens when one is activated.
//
// WHY FLAT RUNS AND NOT THE TREE. {@link parseLabelMarkup} hands back a tree, and the web
// port could draw it as one — nested elements are what the DOM is. NativeScript cannot:
// its rich-text surface is `FormattedString` holding a FLAT `spans` array, and a `Span`
// has no children. Pango is flat too, and that is the deeper reason: markup nesting is
// only a notation for a list of attributes over character RANGES
// (`pango_parse_markup` → `PangoAttrList`), so flattening is not a NativeScript
// concession, it is the shape the layout actually has. The web port renders the runs as
// siblings; the tree it could have walked would draw the same pixels.
//
// LINK OFFSETS ARE INTO THE DISPLAY TEXT, which is what GTK records
// (`GtkLabelLink.start`/`.end` are byte offsets into the label's text, set from
// `pdata->text_len` as `parse_uri_markup` walks). JavaScript has no byte offsets into a
// string, so these are UTF-16 code-unit offsets — the units `String.prototype.slice`
// takes, so a renderer can cut the text with them and get the characters GTK's layout
// would have attributed.
//
// VISITED IS INHERITED BY URI, NOT BY POSITION. Re-setting a label's markup re-parses it
// and builds new links; GTK carries `visited` across by matching the URI against the links
// the label already had (gtklabel.c:3635-3647), so a link that has been followed stays
// drawn as followed when the label around it is rewritten. {@link labelLinksInheritVisited}
// is that match, and it is a FIRST match: two `<a>` elements with the same href share one
// visited state, which is the C's behaviour and not a simplification.
//
// Reference: refs/gtk/gtk/gtklabel.c (parse_uri_markup, start_element_handler,
//   end_element_handler, finish_text, gtk_label_ensure_has_tooltip — the `link` CSS class
//   and `has-tooltip`; emit_activate_link, gtk_label_activate_link — the default handler)
// Reference: https://docs.gtk.org/gtk4/signal.Label.activate-link.html
// Copyright (c) The GTK Team. LGPLv2.1+.

import { type LabelMarkupNode, parseLabelMarkup } from './pango-markup.js';

/**
 * The style one run of text carries, with pango's nesting already resolved.
 *
 * The booleans are pango's own tags; a tag nested inside itself is still just set, which
 * is why they are booleans and not counts. `sizeSteps` IS a count, because `<big>` and
 * `<small>` are relative and compose: `<big><big>` is two steps up, and `<small>` inside
 * `<big>` cancels back to zero — pango applies one `PANGO_SCALE_*` factor per element, so
 * the steps multiply rather than the innermost winning.
 */
export interface LabelMarkupStyle {
    /** `<b>`. */
    readonly bold: boolean;
    /** `<i>`. */
    readonly italic: boolean;
    /** `<u>`. */
    readonly underline: boolean;
    /** `<s>`. */
    readonly strikethrough: boolean;
    /** `<tt>`. */
    readonly monospace: boolean;
    /** `<big>` minus `<small>`, so a negative value is smaller text. */
    readonly sizeSteps: number;
    /** `<sub>` / `<sup>`, the INNERMOST of the two — one run cannot be both. */
    readonly script: 'sub' | 'sup' | null;
    /**
     * The `<span>` attribute sets the run sits inside, OUTERMOST FIRST.
     *
     * A STACK and not one merged record, because the attribute→platform mapping is the
     * renderer's (`font_weight` is an alias of `weight` on the web, `fontWeight` on
     * NativeScript, and neither list is the other's). A renderer applies them in order and
     * the innermost therefore wins per platform property — merging here would need pango's
     * alias table in core, where no port reads it.
     */
    readonly spans: readonly Readonly<Record<string, string>>[];
}

/** No tag at all — the style a bare text run carries. */
export const LABEL_MARKUP_STYLE_PLAIN: LabelMarkupStyle = {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    monospace: false,
    sizeSteps: 0,
    script: null,
    spans: [],
};

/** One `<a href>` of a label's markup, over a range of its display text. */
export interface LabelLink {
    /** `<a href>`. */
    readonly href: string;
    /** `<a title>` — what GTK shows as the label's tooltip over this link. */
    readonly title: string | null;
    /** `<a class>` — the CSS class GTK adds to the link's own node. */
    readonly cssClass: string | null;
    /** Where the link's text starts in the display text, in UTF-16 code units. */
    readonly start: number;
    /** Where it ends, exclusive. `start === end` is a link with nothing to click. */
    readonly end: number;
    /** Whether this link has been followed — see {@link labelLinksInheritVisited}. */
    readonly visited: boolean;
}

/** One run of a label's markup: text, the style over it, and the link it sits in. */
export interface LabelMarkupRun {
    readonly text: string;
    readonly style: LabelMarkupStyle;
    /**
     * The index into {@link LabelMarkupRender.links} of the link this run is inside, or
     * `null`. An INDEX rather than the link itself, so a renderer that updates `visited`
     * replaces one array entry instead of rewriting every run that points at it.
     */
    readonly link: number | null;
}

/** A label's markup, ready to draw. */
export interface LabelMarkupRender {
    /** `gtk_label_get_text()` — the runs' text concatenated. */
    readonly text: string;
    /** The styled runs, in reading order. Empty when the markup has no text at all. */
    readonly runs: readonly LabelMarkupRun[];
    /** The `<a href>` elements, in reading order. */
    readonly links: readonly LabelLink[];
}

/** An element being descended into, as the style it adds. */
interface StyleFrame {
    style: LabelMarkupStyle;
    link: number | null;
}

/** `style` with `tag` applied — one element's contribution, and nothing else's. */
function withTag(style: LabelMarkupStyle, tag: string, attributes: Readonly<Record<string, string>>): LabelMarkupStyle {
    switch (tag) {
        case 'b':
            return { ...style, bold: true };
        case 'i':
            return { ...style, italic: true };
        case 'u':
            return { ...style, underline: true };
        case 's':
            return { ...style, strikethrough: true };
        case 'tt':
            return { ...style, monospace: true };
        case 'big':
            return { ...style, sizeSteps: style.sizeSteps + 1 };
        case 'small':
            return { ...style, sizeSteps: style.sizeSteps - 1 };
        case 'sub':
            return { ...style, script: 'sub' };
        case 'sup':
            return { ...style, script: 'sup' };
        case 'span':
            return { ...style, spans: [...style.spans, attributes] };
        // `<markup>` is pango's implicit root and styles nothing.
        default:
            return style;
    }
}

/** Whether two runs carry the same style and link, so they can be ONE run. */
function sameStyle(a: LabelMarkupRun, b: StyleFrame): boolean {
    const style = a.style;
    return (
        a.link === b.link &&
        style.bold === b.style.bold &&
        style.italic === b.style.italic &&
        style.underline === b.style.underline &&
        style.strikethrough === b.style.strikethrough &&
        style.monospace === b.style.monospace &&
        style.sizeSteps === b.style.sizeSteps &&
        style.script === b.style.script &&
        // Reference equality is enough and is the POINT: two `<span>` elements are two
        // frames even with identical attributes, so a deep compare would merge runs pango
        // keeps apart — and it would cost a walk per run to do it.
        style.spans.length === b.style.spans.length &&
        style.spans.every((attributes, index) => attributes === b.style.spans[index])
    );
}

/**
 * A label's `label` as the runs and links a renderer draws, or `null` when the markup does
 * not parse — the same `null` {@link parseLabelMarkup} returns, so a caller takes the C
 * fallback (show the raw string) on exactly the strings GTK takes it on.
 *
 * `previous` is the links the label held BEFORE this value, and only `visited` is read from
 * it: see {@link labelLinksInheritVisited}.
 */
export function labelMarkupRender(markup: string, previous: readonly LabelLink[] = []): LabelMarkupRender | null {
    const nodes = parseLabelMarkup(markup ?? '');
    if (nodes === null) return null;

    const runs: LabelMarkupRun[] = [];
    const links: LabelLink[] = [];
    let text = '';

    const walk = (children: readonly LabelMarkupNode[], frame: StyleFrame): void => {
        for (const node of children) {
            if (node.kind === 'text') {
                if (node.text === '') continue;
                const last = runs[runs.length - 1];
                // ADJACENT RUNS OF THE SAME STYLE MERGE, because the tree's shape is not
                // the layout's: `<b>a</b><b>b</b>` and `<b>ab</b>` are one bold run in
                // pango, and a renderer handed two spans would draw two boxes a selection
                // and a line break could fall between.
                if (last !== undefined && sameStyle(last, frame))
                    runs[runs.length - 1] = { ...last, text: last.text + node.text };
                else runs.push({ text: node.text, style: frame.style, link: frame.link });
                text += node.text;
                continue;
            }

            if (node.kind === 'link') {
                const index = links.length;
                const start = text.length;
                // PUSHED BEFORE THE DESCENT so the runs inside can point at it, and
                // REPLACED after, once `end` is known. A link's own range is where its
                // text landed, which only the walk can say.
                links.push({
                    href: node.href,
                    title: node.title,
                    cssClass: node.cssClass,
                    start,
                    end: start,
                    visited: false,
                });
                // NESTED `<a>` IS THE INNERMOST ONE, the same way pango's own attributes
                // resolve. GTK's parser accepts the nesting (GMarkup has no content model)
                // and its `finish_text` attributes the text to the link whose element is
                // open, which is the inner one.
                walk(node.children, { style: frame.style, link: index });
                links[index] = { ...links[index]!, end: text.length };
                continue;
            }

            walk(node.children, {
                style: withTag(frame.style, node.tag, node.attributes),
                link: frame.link,
            });
        }
    };

    walk(nodes, { style: LABEL_MARKUP_STYLE_PLAIN, link: null });
    return { text, runs, links: labelLinksInheritVisited(links, previous) };
}

/**
 * `visited` carried across a re-parse by URI (gtklabel.c:3635-3647): a link whose `href`
 * matches one the label already had keeps that link's `visited`, because following a link
 * and then rewriting the text around it has not un-followed it.
 *
 * FIRST match, as in the C: two links to the same URI are one visited state.
 */
export function labelLinksInheritVisited(
    links: readonly LabelLink[],
    previous: readonly LabelLink[],
): readonly LabelLink[] {
    if (previous.length === 0) return links;
    return links.map((link) => {
        const seen = previous.find((candidate) => candidate.href === link.href);
        return seen === undefined || !seen.visited ? link : { ...link, visited: true };
    });
}

/**
 * `gtk_label_ensure_has_tooltip` — a label gets `has-tooltip` when ANY of its links
 * carries a `title`, because the tooltip is per-link and the widget has to opt in before
 * `query-tooltip` is ever asked.
 */
export function labelLinksHaveTooltip(links: readonly LabelLink[]): boolean {
    return links.some((link) => link.title !== null);
}

/**
 * The `link` CSS class `gtk_label_set_markup` adds to the WIDGET (gtklabel.c:3896) when its
 * markup carried at least one `<a href>` — libadwaita's stylesheet selects on it, so a
 * port that draws the link colour without it is styling by its own rule and not GTK's.
 */
export function labelHasLinks(links: readonly LabelLink[]): boolean {
    return links.length > 0;
}

/** What one port supplies to one `::activate-link` emission. */
export interface LabelActivateLinkSteps {
    /**
     * `GTK_IS_WINDOW (gtk_widget_get_root (widget))` — the default handler returns FALSE
     * for a label with no window above it, and then NOTHING is launched. A port answers
     * this with whatever "is in a presented window" means for it.
     */
    readonly rooted: boolean;
    /** Emit `activate-link` to the USER's handlers and answer whether one handled it. */
    emit(): boolean;
    /** `Gio.AppInfo.launch_default_for_uri` — the port's door, ADR 0101. */
    launch(uri: string): void;
}

/**
 * `emit_activate_link` — `::activate-link` is RUN_LAST with the boolean handled
 * accumulator (`HandledAccumulator`, `window-members.ts`), so the order is: the user's
 * handlers, then — only if none handled it — the class handler, which launches the URI and
 * counts that as handled.
 *
 * Returns whether the link becomes VISITED, which is what GTK does with the signal's
 * result: a handler that returns TRUE has followed the link its own way, and the default
 * returning TRUE means the URI went to the host. A label with no window above it returns
 * FALSE and the link stays unvisited — `gtk_label_activate_link`'s first branch, and the
 * reason it is not simply "launch and say yes".
 */
export function labelActivateLink(uri: string, steps: LabelActivateLinkSteps): boolean {
    if (steps.emit()) return true;
    if (!steps.rooted) return false;
    steps.launch(uri);
    return true;
}

/** The links of `links` with the one at `index` marked visited; the others untouched. */
export function labelLinkVisited(links: readonly LabelLink[], index: number): readonly LabelLink[] {
    const link = links[index];
    if (link === undefined || link.visited) return links;
    // BY URI, not by index: `gtk_label_set_markup`'s inheritance already says two links to
    // the same place share one state, so following either marks both.
    return links.map((candidate) => (candidate.href === link.href ? { ...candidate, visited: true } : candidate));
}
