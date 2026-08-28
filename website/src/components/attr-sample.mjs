// What a gallery block's own preview markup sets on one element, so the attribute
// table can show a REAL value beside each name instead of asserting a type.
//
// PLAIN JS ON PURPOSE, and in its own file. `website/src/components/AdwWidget.astro`
// is the one .astro file `.oxlintrc.json` ignores (oxlint's reader takes a `<script>`
// inside a JSX comment there as a real opener and stops parsing), so a hand-rolled
// HTML scanner living in that frontmatter was the one piece of website logic no
// linter read and no gate exercised. Out here it is linted, and
// `scripts/check-website-attr-samples.mjs` holds it against fixtures for the shapes
// below plus every preview fence the gallery actually ships.
//
// THE HONEST COLUMN would be "does this attribute take a value", and it is not
// available: an element's own source answers it through `hasAttribute` vs
// `getAttribute`, and measured over `packages/web/adwaita-web/src` that leaves
// 43 of 276 attributes calling both or neither when each element is read in its own
// module, 37 of 276 when the whole package is (child elements like `<adw-tab-page>`
// are read by their PARENT, which is why the scope changes the answer and neither
// scope makes it clean). A column derived from that is a guess on one row in six or
// seven. The fence one tab to the left is not a guess, and it is already on screen.

/**
 * The character references a browser resolves while parsing an attribute value.
 *
 * The sampled value is read out of MARKUP TEXT, and the table presents it as the
 * value the element carries — so it has to be decoded exactly once, the way the
 * parser would. `<adw-shortcut-label accelerator="&lt;Control&gt;C">` is real markup
 * on /adwaita/presentation/, and undecoded the cell printed `&lt;Control&gt;C` where
 * `getAttribute('accelerator')` returns `<Control>C`.
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
 * `getAttribute` returns `''` for both. The table says "set" for either.
 *
 * A QUOTE-AWARE walk of the opening tags rather than `/<tag[^>]*>/`, because an
 * attribute value may contain `>` — `<adw-data-grid>`'s `columns` carries JSON.
 * Comments are skipped, the tag match is case-insensitive and anchored so
 * `<adw-button-content>` cannot match `<adw-button-content-extra>`, and an unquoted
 * value is read as a value rather than silently reported as a bare attribute.
 *
 * WHERE THE PREVIEW HAS SEVERAL of the element, the first value found wins and the
 * result is a UNION across them: /adwaita/buttons/ paints five `<adw-button>`s, one
 * per style, and the pane reports `flat`, `suggested`, `destructive`, `circular` and
 * `pill` all set. That is true of the preview and true of no single button in it, so
 * the caption says which of the two the column means.
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
 * One table cell per observed attribute: the text to print and the class that styles it.
 *
 * Resolved to a STRING here rather than with a conditional in the markup so the table
 * body stays one level deep and the monospace can travel by class. It sits beside the
 * scan rather than in the component so that ONE file decides what an empty value means,
 * and so the gate can assert the cell a reader sees rather than the map behind it.
 *
 * @param {readonly string[]} names
 * @param {Map<string, string>} sample
 */
export const attributeCells = (names, sample) =>
    names.map((name) => {
        const value = sample.get(name);
        if (value === undefined) return { name, text: 'not used', kind: 'absent' };
        return value === '' ? { name, text: 'set', kind: 'bare' } : { name, text: value, kind: 'value' };
    });
