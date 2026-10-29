// Pango markup → DOM NODES. Never markup, never a string the browser parses.
//
// WHY THIS FILE EXISTS. `use-markup` used to be implemented as `element.innerHTML =
// markup`, in three elements: `<adw-banner>`'s title, `<adw-alert-dialog>`'s heading and
// body. That is an INJECTION SINK dressed as a renderer, and it is also wrong on the
// merits: Pango markup and HTML are different languages (eleven tags, `<span>`
// attributes, five entities, no scripting — versus the whole of HTML). Mozilla's add-on
// reviewer flagged it, correctly.
//
// THE THREE STEPS, and why they are in this order:
//
//   1. `parsePangoMarkup` (`@gjsify/adwaita-core`, headless) — the STRING becomes a tree
//      of plain data, or `null`. It is shared with the search pipeline, so the two can
//      never disagree about what pango accepts.
//   2. Anything the tree does not name becomes NOTHING. A tag outside pango's set is not
//      markup at all: the parse fails, and {@link renderPangoMarkup} writes the RAW
//      STRING as a text node — the same fallback `gtk_label_set_markup` takes. There is
//      no branch anywhere below that creates an element from an unrecognised name, so
//      `<img src=x onerror=…>` and `<script>` cannot become nodes at all.
//   3. `<span>` attributes become CSS DECLARATIONS, never HTML attributes. Each is matched
//      against a whitelist below and written with `style.setProperty`, which REJECTS an
//      invalid value outright — so an attribute pango accepts but CSS does not (an unknown
//      `weight`, a `font_family` with a quote in it) leaves the run unstyled rather than
//      smuggling a declaration past the parser. Nothing here reads an attribute name off
//      the element.
//
// WHY ELEMENTS AND NOT THE TAG NAMES VERBATIM. Six of pango's eleven tags map onto an
// HTML element of the SAME name with the SAME meaning (`b`, `i`, `u`, `s`, `sub`, `sup`),
// and the remaining four (`tt`, `big`, `small`, and `<span>` itself) are all
// {@link TAG_STYLES} entries: a style declaration on a `<span>`, because a semantic
// element is a thing an author's CSS can then reach, and because `<b>`/`<i>` are what a
// reader of the DOM expects. `<markup>` is pango's IMPLICIT root and draws nothing, so it
// becomes a `display: contents` span: its children land where the root was, with no box of
// its own for a stylesheet to trip over.
//
// `<tt>`/`<big>`/`<small>` are real HTML elements but OBSOLETE ones: they carry no
// presentational meaning in a modern UA stylesheet, which is exactly why their styles are
// spelled out here.
//
// Reference: packages/web/adwaita-core/src/pango-markup.ts (the parse, and why it is
//   shared with the search pipeline)
// Reference: refs/gtk/gtk/gtklabel.c (gtk_label_set_markup's warn-and-keep-the-string
//   fallback, which is what the `null` branch reproduces)
// Reference: Mozilla add-on reviewer guidance on innerHTML (the report this answers)
// Copyright (c) 2025 gjsify contributors. MIT License.

import { parsePangoMarkup, type PangoMarkupNode } from '@gjsify/adwaita-core';

/**
 * Pango tag → the HTML element that draws it, with the CSS it needs because no
 * presentational UA rule covers it. Every entry is a CLOSED set: a tag missing here is a
 * parse error, so there is no default branch to fall through.
 */
export const TAG_STYLES: Readonly<Record<string, { element: string; style?: Readonly<Record<string, string>> }>> = {
    b: { element: 'b' },
    i: { element: 'i' },
    u: { element: 'u' },
    s: { element: 's' },
    tt: { element: 'span', style: { 'font-family': 'monospace' } },
    big: { element: 'span', style: { 'font-size': 'larger' } },
    small: { element: 'span', style: { 'font-size': 'smaller' } },
    sub: { element: 'sub' },
    sup: { element: 'sup' },
    markup: { element: 'span', style: { display: 'contents' } },
    span: { element: 'span' },
};

/**
 * `<span>` attribute → the CSS property it becomes, and the values accepted for it. An
 * attribute NOT listed here is dropped — pango accepts more of them than a stylesheet can
 * express (`rise`, `letter_spacing`, `lang`, `variant`, `stretch`, …), and dropping one is
 * what keeps this from becoming a general-purpose attribute→style bridge.
 */
const SPAN_STYLES: Readonly<Record<string, string>> = {
    weight: 'font-weight',
    style: 'font-style',
    underline: 'text-decoration-line',
    strikethrough: 'text-decoration-line',
    font_family: 'font-family',
    size: 'font-size',
};

/**
 * pango's alternative spellings for the attributes above, which `<span>` documents as
 * equivalent (`pango_markup.html`: "the `font_weight` attribute is an alias for `weight`",
 * and so on). Resolved BEFORE {@link SPAN_STYLES}, so an alias reaches the same whitelist
 * as the name it aliases — reading them as separate properties would let one of the pair
 * through as an unstyled run while the other worked.
 */
const SPAN_ALIASES: Readonly<Record<string, string>> = {
    font_weight: 'weight',
    font_style: 'style',
    face: 'font_family',
    font_size: 'size',
};

/**
 * The pango attribute values each property accepts, by NAME. `font-weight` takes pango's
 * weight names and, beside them, pango's own numbers — CSS numbers weights on the same
 * 1–1000 scale, so `weight="600"` is the one value that needs no translation. `weight`
 * and `style` are the only two with a table; `text-decoration-line` takes CSS keywords,
 * which are NOT pango's underline / strikethrough booleans — `underline="single"` has to
 * become `underline`, and that mapping is one line per attribute, not a parser.
 */
const ATTRIBUTE_VALUES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
    weight: {
        ultralight: '100',
        light: '300',
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: 'bold',
        ultrabold: '700',
        heavy: '900',
    },
    style: { normal: 'normal', oblique: 'oblique', italic: 'italic' },
};

/**
 * One node of the parsed tree, built. Returns `null` for a tag this file does not draw —
 * the fail-closed half: an unrecognised tag DROPS its element (and pango's parser would
 * have refused the string entirely anyway), rather than falling back to some catch-all
 * that would put an arbitrary element into the tree.
 */
function buildNode(node: PangoMarkupNode, doc: Document): Node | null {
    if (node.kind === 'text') return doc.createTextNode(node.text);

    const spec = TAG_STYLES[node.tag];
    if (spec === undefined) return null;

    const el = doc.createElement(spec.element);
    if (spec.style !== undefined)
        for (const [property, value] of Object.entries(spec.style)) el.style.setProperty(property, value);
    if (node.tag === 'span') applySpanAttributes(el, node.attributes);

    for (const child of node.children) {
        const built = buildNode(child, doc);
        if (built !== null) el.append(built);
    }
    return el;
}

/**
 * Write the recognised `<span>` attributes onto `el` as style declarations.
 *
 * Exported for `label-markup.ts`, which draws a `Gtk.Label`'s markup from flat RUNS rather
 * than from this file's tree: the whitelist and its value tables are the part the two must
 * share, so an attribute is added once and both renderers gain it.
 */
export function applySpanAttributes(el: HTMLElement, attributes: Readonly<Record<string, string>>): void {
    // Additive, so `<span underline="single" strikethrough="true">` draws BOTH —
    // `text-decoration` is a shorthand that would drop the first one.
    const decorations: string[] = [];
    for (const [name, value] of Object.entries(attributes)) {
        const attribute = SPAN_ALIASES[name] ?? name;
        const property = SPAN_STYLES[attribute];
        if (property === undefined) continue;

        if (attribute === 'underline') {
            // pango: any value but `none` underlines.
            if (value !== 'none') decorations.push('underline');
            continue;
        }
        if (attribute === 'strikethrough') {
            if (value !== 'false' && value !== 'none') decorations.push('line-through');
            continue;
        }
        if (attribute === 'font_family') {
            const family = sanitizeFontFamily(value);
            if (family !== null) el.style.setProperty(property, family);
            continue;
        }
        if (attribute === 'size') {
            const size = sanitizeFontSize(value);
            if (size !== null) el.style.setProperty(property, size);
            continue;
        }

        // pango also takes a numeric weight; CSS reads the same integers from 1 to 1000.
        if (attribute === 'weight' && /^[0-9]{1,4}$/.test(value) && +value >= 1 && +value <= 1000) {
            el.style.setProperty(property, value);
            continue;
        }

        const named = ATTRIBUTE_VALUES[attribute]?.[value];
        // An unmapped value is DROPPED rather than passed through: `setProperty` would
        // reject an invalid declaration anyway, but an unvalidated string reaching CSS is
        // the shape of bug this file exists to end, so it never gets there.
        if (named !== undefined) el.style.setProperty(property, named);
    }
    if (decorations.length > 0) el.style.setProperty('text-decoration-line', decorations.join(' '));
}

/** The generic families CSS parses unquoted; everything else must be a plain name. */
const CSS_GENERIC_FAMILIES: ReadonlySet<string> = new Set([
    'serif',
    'sans-serif',
    'monospace',
    'cursive',
    'fantasy',
    'system-ui',
    'ui-serif',
    'ui-sans-serif',
    'ui-monospace',
    'ui-rounded',
]);

/**
 * A pango `font_family` list as a CSS `font-family`, or `null` when any entry cannot be
 * one. Pango takes a bare comma-separated list; CSS additionally parses quotes and
 * escapes, so an entry holding either is refused as a WHOLE list rather than escaped —
 * refusing is the answer that cannot produce a family name CSS reads differently.
 */
function sanitizeFontFamily(value: string): string | null {
    const families: string[] = [];
    for (const raw of value.split(',')) {
        const family = raw.trim();
        if (family === '') continue;
        const generic = CSS_GENERIC_FAMILIES.has(family.toLowerCase());
        // A quoted CSS identifier is the general form; a bare one is safe only when it is
        // a plain name, so anything carrying a quote, backslash or semicolon is refused.
        if (!generic && !/^["']?[A-Za-z0-9 _-]+["']?$/.test(family)) return null;
        families.push(family);
    }
    return families.length > 0 ? families.join(', ') : null;
}

/** A pango `size` as a CSS `font-size`, or `null` when it cannot be one. */
function sanitizeFontSize(value: string): string | null {
    const trimmed = value.trim();
    // pango's named sizes, which CSS ALSO names — the same absolute ladder, plus pango's
    // two relative steps, so the whole set needs no conversion at all.
    const named: Readonly<Record<string, string>> = {
        'xx-small': 'xx-small',
        'x-small': 'x-small',
        small: 'small',
        medium: 'medium',
        large: 'large',
        'x-large': 'x-large',
        'xx-large': 'xx-large',
        smaller: 'smaller',
        larger: 'larger',
    };
    const namedSize = named[trimmed];
    if (namedSize !== undefined) return namedSize;
    // A bare pango size is in 1024ths of a point (`size="12288"` is 12pt), so it is scaled,
    // never passed on: CSS would read a bare number as no length at all.
    if (/^[0-9]+$/.test(trimmed)) return `${+trimmed / 1024}pt`;
    // Since pango 1.50: points with their unit, and a percentage of the parent.
    if (/^[0-9]+(\.[0-9]+)?pt$/.test(trimmed)) return trimmed;
    if (/^[0-9]+(\.[0-9]+)?%$/.test(trimmed)) return trimmed;
    return null;
}

/**
 * Render Pango markup into `target`, replacing its content — the one door every
 * `use-markup` surface in this package goes through.
 *
 * The `null` branch is the C fallback and is the SECURITY property: markup that does not
 * parse is written as TEXT, so an unrecognised tag can never become an element. Callers
 * that want markup only when a caller has asked for it read that from their own flag and
 * pass plain text here — this function never decides whether markup is meant.
 */
export function renderPangoMarkup(target: HTMLElement, markup: string): void {
    const nodes = parsePangoMarkup(markup);
    if (nodes === null) {
        target.textContent = markup;
        return;
    }
    const doc = target.ownerDocument ?? document;
    target.replaceChildren(...nodes.map((node) => buildNode(node, doc)).filter((node): node is Node => node !== null));
}
