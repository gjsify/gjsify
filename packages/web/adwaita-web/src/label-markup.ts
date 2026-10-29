// A `Gtk.Label`'s markup DRAWN — the flat styled runs of `@gjsify/adwaita-core`'s
// `labelMarkupRender` as DOM nodes, and the `<a href>` elements beside them.
//
// WHY THIS IS NOT `pango-markup.ts`. That file walks the parse TREE and builds one element
// per element, which is the obvious mapping and the right one for a surface that only
// shows markup (`<adw-banner>`, `<adw-alert-dialog>`). A label additionally has LINKS,
// whose ranges are recorded against the display TEXT and may cross the tree's shape, and
// it shares its derivation with the NativeScript port, whose `FormattedString` has no tree
// to walk. So the label draws the RUNS; core's `label-markup.ts` header carries why they
// are flat. The two files share the parts that must not drift: {@link TAG_STYLES} (which
// element draws which pango tag) and {@link applySpanAttributes} (the `<span>` attribute
// whitelist), both imported from `pango-markup.ts` rather than restated.
//
// NO `innerHTML`, SAME AS EVER (`check-adwaita-no-markup-sinks.mjs`): every node here is
// `createElement` and every character is a text node, so a string the label carries can
// never become an element the browser parses.
//
// THE `<a>` IS A REAL LINK AND STILL GOES THROUGH THE SIGNAL. `href` is set, because an
// anchor without one is not a link to the keyboard, to the accessibility tree or to the
// browser's own "copy link address" — all of which GTK's link node has. The click is then
// `preventDefault`ed and `activate-link` is dispatched instead, because GTK does NOT
// navigate the window the label sits in: `gtk_label_activate_link` hands the URI to the
// desktop, which opens it elsewhere and leaves the window standing. `<gtk-link-button>`
// answers the same question the same way (`window.open(uri, '_blank', 'noopener')`), and
// the two must not disagree about what following a link does.
//
// WHERE A `<span>` ATTRIBUTE LOSES TO A TAG — a DECLARED divergence. Pango resolves a
// collision between `<span weight="light">` and `<b>` by NESTING: the inner one wins. The
// runs cannot say which was inner, because {@link LabelMarkupStyle} records the tags as
// booleans and the `<span>`s as a separate stack, so this file picks one order and states
// it: the `<span>`s are the OUTER elements and the tags the inner ones, i.e. a tag always
// wins. It is also the better of the two for `<big>`/`<small>`, whose `font-size: larger`
// is RELATIVE: nested inside a `<span size="12pt">` it multiplies that size, which is what
// pango does with a scale attribute beside an absolute one. The corpus this was measured
// against (155 labels, `adwaita-core`'s `label.ts` header) has no `<span>` at all.
//
// Reference: packages/web/adwaita-core/src/label-markup.ts (the runs, the links, the
//   `::activate-link` rule)
// Reference: refs/gtk/gtk/gtklabel.c (the `link` CSS class, the per-link tooltip,
//   gtk_label_activate_link)
// Copyright (c) The GTK Team. LGPLv2.1+.

import {
    stripMnemonic,
    type LabelMarkupRender,
    type LabelMarkupRun,
    type LabelMarkupStyle,
} from '@gjsify/adwaita-core';

import { applySpanAttributes, TAG_STYLES } from './pango-markup.js';

/**
 * Which link an `<a>` draws, as its index into {@link LabelMarkupRender.links}.
 *
 * On the attribute and not in a JS-side map, because the element re-reads it to paint
 * `visited` and to answer a click: one link may be drawn as SEVERAL anchors (a link whose
 * text changes style mid-way is several runs), and the index is what ties them back
 * together.
 */
export const LABEL_LINK_ATTRIBUTE = 'data-gtk-link';

/** The pango tags {@link buildRun} nests inside a run's `<span>`s, innermost last. */
const STYLE_TAGS: readonly (readonly [keyof LabelMarkupStyle, string])[] = [
    ['monospace', 'tt'],
    ['underline', 'u'],
    ['strikethrough', 's'],
    ['italic', 'i'],
    ['bold', 'b'],
];

/** One element of {@link TAG_STYLES}, with the CSS that table gives it. */
function tagElement(tag: string, doc: Document): HTMLElement {
    const spec = TAG_STYLES[tag];
    // Every tag this file names is in the table — it is the same closed set pango's parser
    // accepts — so a miss is a programming error here, not an input the label can carry.
    if (spec === undefined) throw new Error(`label markup: no element draws <${tag}>`);
    const el = doc.createElement(spec.element);
    if (spec.style !== undefined)
        for (const [property, value] of Object.entries(spec.style)) el.style.setProperty(property, value);
    return el;
}

/**
 * One run as a chain of elements around its text, outermost returned.
 *
 * The chain is `<span>`s (outermost first, so the innermost attribute set wins per CSS
 * property) and then the pango tags — see the header for why that order and not the
 * reverse. A run with no style at all is a bare text node: a plain label keeps the "one
 * text node, no elements" DOM shape `gtk-label.spec.ts` asserts for the XSS answer.
 *
 * `mnemonics` is `use-underline`, and it is applied to the run's TEXT rather than to the
 * markup string: `gtk_label_set_markup_with_mnemonic` parses first and strips the marker
 * out of the result, so an `_` inside a tag's attributes is not a mnemonic — the same
 * order `labelDisplayText` follows for the text reading.
 */
function buildRun(run: LabelMarkupRun, doc: Document, mnemonics: boolean): Node {
    const chain: HTMLElement[] = [];

    for (const attributes of run.style.spans) {
        const el = doc.createElement('span');
        applySpanAttributes(el, attributes);
        chain.push(el);
    }

    // `<big>`/`<small>` are a COUNT, so they are that many nested elements: `font-size:
    // larger` is relative, and two of them is pango's two scale factors multiplied.
    const steps = run.style.sizeSteps;
    for (let index = 0; index < Math.abs(steps); index += 1) chain.push(tagElement(steps > 0 ? 'big' : 'small', doc));

    for (const [flag, tag] of STYLE_TAGS) if (run.style[flag]) chain.push(tagElement(tag, doc));
    if (run.style.script !== null) chain.push(tagElement(run.style.script, doc));

    const text = doc.createTextNode(mnemonics ? stripMnemonic(run.text) : run.text);
    if (chain.length === 0) return text;

    for (let index = 0; index < chain.length - 1; index += 1) chain[index]!.append(chain[index + 1]!);
    chain[chain.length - 1]!.append(text);
    return chain[0]!;
}

/**
 * The `<a>` for the link at `index`, empty.
 *
 * `link` is GTK's own CSS class on the link node (gtklabel.c, `_link.scss` here);
 * `<a class>`'s value rides beside it, which is what that attribute is FOR — GTK puts it
 * on the same node. `title` is the per-link tooltip, and only when the markup gave one:
 * an empty `title` attribute is a tooltip in some browsers.
 */
function buildAnchor(render: LabelMarkupRender, index: number, doc: Document): HTMLAnchorElement {
    const link = render.links[index]!;
    const anchor = doc.createElement('a');
    anchor.setAttribute(LABEL_LINK_ATTRIBUTE, String(index));
    anchor.href = link.href;
    anchor.classList.add('link');
    if (link.cssClass !== null && link.cssClass !== '') anchor.classList.add(link.cssClass);
    anchor.classList.toggle('visited', link.visited);
    if (link.title !== null) anchor.title = link.title;
    return anchor;
}

/**
 * `render` as nodes, ready to be put into a label.
 *
 * CONSECUTIVE RUNS OF ONE LINK SHARE ONE `<a>`, so a link is one navigable element to the
 * keyboard and one entry in the accessibility tree even when its text changes style
 * part-way through — which is what GTK's single link node is. Runs of DIFFERENT links, or
 * a run with none between them, close the anchor.
 */
export function labelMarkupNodes(render: LabelMarkupRender, doc: Document, mnemonics = false): Node[] {
    const nodes: Node[] = [];
    let anchor: HTMLAnchorElement | null = null;
    let anchored: number | null = null;

    for (const run of render.runs) {
        if (run.link !== anchored) {
            anchor = run.link === null ? null : buildAnchor(render, run.link, doc);
            anchored = run.link;
            if (anchor !== null) nodes.push(anchor);
        }
        (anchor ?? { append: (node: Node) => nodes.push(node) }).append(buildRun(run, doc, mnemonics));
    }

    // A LINK WITH NO TEXT still has a node: `<a href="…"></a>` is a link GTK records and
    // gives a range of zero length, and dropping it here would lose the only trace of it.
    for (let index = 0; index < render.links.length; index += 1)
        if (!render.runs.some((run) => run.link === index)) nodes.push(buildAnchor(render, index, doc));

    return nodes;
}

/** Write `render` into `target`, replacing what was there. */
export function renderLabelMarkup(target: HTMLElement, render: LabelMarkupRender, mnemonics = false): void {
    const doc = target.ownerDocument ?? document;
    target.replaceChildren(...labelMarkupNodes(render, doc, mnemonics));
}

/** The `<a>` elements {@link labelMarkupNodes} put under `target`, in reading order. */
export function labelMarkupAnchors(target: HTMLElement): HTMLAnchorElement[] {
    return [...target.querySelectorAll<HTMLAnchorElement>(`a[${LABEL_LINK_ATTRIBUTE}]`)];
}

/**
 * The link index `anchor` draws, or `null` when it is not one of ours.
 *
 * Read back from the attribute rather than closed over, because a click arrives at an
 * element and the handler has only the DOM to go on.
 */
export function labelMarkupAnchorIndex(anchor: Element): number | null {
    const raw = anchor.getAttribute(LABEL_LINK_ATTRIBUTE);
    if (raw === null) return null;
    const index = Number(raw);
    return Number.isInteger(index) && index >= 0 ? index : null;
}
