// The stylesheet of a registered class. `<adw-bin>` is styled by a rule on the tag `adw-bin`, and a
// subclass that `GObject.registerClass` defines as `<gjsify-hexdump>` is another tag, so none of its
// base's rules (a `display: block`, the box-model reset, the `:only-child` fill) reach it: a Bin
// subclass collapsed to an inline box of zero width. GTK has no such seam because a subclass keeps
// its parent's CSS node name.
//
// So the rules of the base tag are copied to the subclass tag, once per tag, from the stylesheets
// the page has when the first instance connects: every selector that names the base tag as a type
// selector, with that name replaced. The copy is adopted last, so it sits where the base's rules do
// relative to the author's own.

const DONE = new Set<string>();

/** Splits a selector list at its top-level commas (`:is(a, b)` stays whole). */
function splitSelectorList(list: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (c === '(' || c === '[') depth++;
        else if (c === ')' || c === ']') depth--;
        else if (c === ',' && depth === 0) {
            parts.push(list.slice(start, i).trim());
            start = i + 1;
        }
    }
    parts.push(list.slice(start).trim());
    return parts;
}

function rulesOf(sheet: CSSStyleSheet): CSSRuleList | null {
    try {
        return sheet.cssRules;
    } catch {
        return null; // a cross-origin sheet is not readable
    }
}

function copyRules(rules: CSSRuleList, from: RegExp, to: string, out: string[]): void {
    for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
            const mine = splitSelectorList(rule.selectorText).filter((selector) => from.test(selector));
            if (mine.length === 0) continue;
            const selector = mine.map((s) => s.replace(new RegExp(from.source, 'g'), to)).join(', ');
            out.push(`${selector} { ${rule.style.cssText} }`);
        } else if ('cssRules' in rule) {
            // @media, @supports, @layer: copy the wrapper around what matches inside it
            const inner: string[] = [];
            copyRules((rule as CSSGroupingRule).cssRules, from, to, inner);
            if (inner.length === 0) continue;
            const head = rule.cssText.slice(0, rule.cssText.indexOf('{')).trim();
            out.push(`${head} { ${inner.join('\n')} }`);
        }
    }
}

/** Gives `tag` the rules that `base` has in the page's stylesheets. Runs once per tag. */
export function inheritStyles(tag: string, base: string | null | undefined): void {
    if (!base || DONE.has(tag)) return;
    DONE.add(tag);
    const from = new RegExp(`(?<![\\w-])${base}(?![\\w-])`);
    const css: string[] = [];
    const sheets = [...Array.from(document.styleSheets), ...document.adoptedStyleSheets];
    for (const sheet of sheets) {
        const rules = rulesOf(sheet);
        if (rules) copyRules(rules, from, tag, css);
    }
    if (css.length === 0) return;
    const copy = new CSSStyleSheet();
    copy.replaceSync(css.join('\n'));
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, copy];
}
