// What a gallery block's own preview markup sets on one element, and the custom
// element a block's TITLE names.
//
// IT FED A PANE and no longer does. The gallery's attribute tab printed each
// observed attribute beside the value the preview writes; the tab is gone (it said
// what a reader PASSES and not what any of it MEANS — docs/code-anti-patterns.md
// § "A documentation surface written by hand, once per page"). The SCANNER stayed,
// because `scripts/check-website-attr-samples.mjs` arm 3 is what a rename breaks: it
// reads every preview fence and refuses a name the element it is set on does not
// observe. An attribute is a string and no type sees it, so a fence writing a
// retired spelling is a silently empty widget.
//
// PLAIN JS ON PURPOSE, and in its own file. `website/src/components/AdwWidget.astro`
// is the one .astro file `.oxlintrc.json` ignores (oxlint's reader takes a `<script>`
// inside a JSX comment there as a real opener and stops parsing), so a hand-rolled
// HTML scanner living in that frontmatter was the one piece of website logic no
// linter read and no gate exercised. Out here it is linted, and that gate holds it
// against fixtures for the shapes below plus every preview fence the gallery ships.
//
// IT REPORTS WHAT THE MARKUP SAYS, never what the element would do with it. "Does
// this attribute take a value" is the question an element's own source answers
// through `hasAttribute` vs `getAttribute`, and measured over
// `packages/web/adwaita-web/src` that leaves 43 of 276 attributes calling both or
// neither when each element is read in its own module, 37 of 276 when the whole
// package is (child elements like `<adw-tab-page>` are read by their PARENT, which is
// why the scope changes the answer and neither scope makes it clean). Any claim
// derived from that is a guess on one row in six or seven, so nothing here makes one.

/**
 * The character references a browser resolves while parsing an attribute value.
 *
 * The sampled value is read out of MARKUP TEXT and reported as the value the element
 * carries, so it has to be decoded exactly once, the way the parser would.
 * `<adw-shortcut-label accelerator="&lt;Control&gt;C">` is real markup on
 * /adwaita/presentation/, and undecoded it read back as `&lt;Control&gt;C` where
 * `getAttribute('accelerator')` returns `<Control>C` — which shipped on the page for
 * as long as the value had a column to sit in.
 *
 * Only these five plus numeric refs. HTML's full named-reference table is 2000-odd
 * entries and a partial one that GUESSES is worse than one that does not: an
 * unrecognised `&…;` is left exactly as written, which is at worst the old
 * behaviour on a value no gallery fence contains.
 */
const NAMED_REFS = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/** @param {string} value */
const decodeRefs = (value) =>
    value.replaceAll(/&(?:#x([0-9a-fA-F]+)|#(\d+)|([a-zA-Z][a-zA-Z0-9]*));/g, (whole, hex, dec, name) => {
        if (hex !== undefined) return String.fromCodePoint(Number.parseInt(hex, 16));
        if (dec !== undefined) return String.fromCodePoint(Number(dec));
        return Object.hasOwn(NAMED_REFS, name) ? NAMED_REFS[name] : whole;
    });

/** Half-open `[start, end)` ranges of every HTML comment, so a tag inside one is not markup. */
const commentRanges = (markup) => {
    /** @type {[number, number][]} */
    const ranges = [];
    for (let i = markup.indexOf('<!--'); i !== -1; i = markup.indexOf('<!--', i + 4)) {
        const close = markup.indexOf('-->', i + 4);
        const end = close === -1 ? markup.length : close + 3;
        ranges.push([i, end]);
        i = end - 4;
    }
    return ranges;
};

/**
 * Every attribute the preview sets on `<tag>`, name -> value, `''` where the source
 * writes the attribute with no value.
 *
 * `''` rather than a separate "bare" marker because that IS the distinction HTML
 * draws: `<x can-shrink>` and `<x can-shrink="">` produce the same DOM, and
 * `getAttribute` returns `''` for both. There is no third answer to report.
 *
 * A QUOTE-AWARE walk of the opening tags rather than `/<tag[^>]*>/`, because an
 * attribute value may contain `>` — `<adw-data-grid>`'s `columns` carries JSON.
 * Comments are skipped, the tag match is case-insensitive and anchored so
 * `<adw-button-content>` cannot match `<adw-button-content-extra>`, and an unquoted
 * value is read as a value rather than silently reported as a bare attribute.
 *
 * WHERE THE PREVIEW HAS SEVERAL of the element, the first value found wins and the
 * result is a UNION across them: /adwaita/buttons/ paints five `<gtk-button>`s, one
 * per style, so `flat`, `suggested`, `destructive`, `circular` and `pill` all come
 * back set. That is true of the FENCE and true of no single button in it — fine for
 * arm 3, which asks whether the fence writes a name the element reads, and the reason
 * a caller must not present this map as one element's own state.
 *
 * @param {string | null} markup
 * @param {string} tag
 * @returns {Map<string, string>}
 */
export const sampleAttributes = (markup, tag) => {
    /** @type {Map<string, string>} */
    const found = new Map();
    if (markup === null) return found;
    const comments = commentRanges(markup);
    const opening = new RegExp(`<${tag.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=[\\s/>]|$)`, 'gi');
    for (const start of markup.matchAll(opening)) {
        const from = start.index + start[0].length;
        if (comments.some(([a, b]) => start.index >= a && start.index < b)) continue;
        let end = from;
        let quote = '';
        while (end < markup.length && (quote !== '' || markup[end] !== '>')) {
            const c = markup[end];
            if (quote === '') {
                if (c === '"' || c === "'") quote = c;
            } else if (c === quote) quote = '';
            end += 1;
        }
        const inside = markup.slice(from, end);
        for (const m of inside.matchAll(/([a-zA-Z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
            // Lower-cased because a parser lower-cases attribute names, and the list this
            // is matched against is `observedAttributes`, which is always lower-case.
            const name = m[1].toLowerCase();
            // First wins, which is also what the parser does with a name repeated on one tag.
            if (found.has(name)) continue;
            found.set(name, decodeRefs(m[2] ?? m[3] ?? m[4] ?? ''));
        }
    }
    return found;
};

/**
 * `Gtk.MenuButton` → `gtk-menu-button`, `Adw.ActionRow` → `adw-action-row`: the custom
 * element a gallery block's TITLE names.
 *
 * THE NAMESPACE IS THE PREFIX and is read, never assumed, because a web element is named
 * after the library that owns its GType (ADR 0034 clause 1) — the same rule
 * `gtk-host/src/tags.ts` runs the other way round. A constant `adw-` was right only while
 * nine GTK widgets wore an `adw-` name; the day they took their own, it derived a tag
 * nothing registers — at which point arm 3 has no element to hold the fence against and
 * every name written in it passes.
 *
 * IT LIVES HERE BECAUSE THREE PLACES ASKED IT: the component that rendered the attribute
 * pane and the two gates that checked it. Each had spelled it out itself, and one of the
 * copies carried a comment saying a second spelling "would be the drift this file is
 * against". It was, the moment the prefix stopped being a constant. Two of the three are
 * gone with the pane; `check-website-attr-samples.mjs` still needs it, to know which
 * element a block's preview fence is a preview OF.
 *
 * @param {string} title the `<AdwWidget title="…">` value
 */
export const galleryElementTag = (title) => {
    const namespace = /^(Adw|Gtk)\./.exec(title)?.[1] ?? 'Adw';
    return `${namespace.toLowerCase()}-${title
        .replace(/^(?:Adw|Gtk)\./, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
        .toLowerCase()}`;
};
