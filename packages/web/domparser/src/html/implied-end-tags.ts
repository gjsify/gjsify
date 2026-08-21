// The tables that decide what an unclosed element does when the next start tag
// arrives. This is the whole of the tree construction that real pages depend on:
// `htmlparser2` implements the implied-end-tag table and none of the 23-mode
// automaton, and on a 329 KB real page returns what parse5 returns (ADR 0026 § 6).
//
// Correctness of these tables is proved by the differential suite against parse5,
// not by their provenance.
//
// https://html.spec.whatwg.org/multipage/parsing.html#the-in-body-insertion-mode

/**
 * Elements that end a "scope" search. `hasElementInScope` walks up from the
 * current node and stops at one of these, which is why `<td><p>` does not let a
 * `</p>` in the next cell close it.
 */
const BASE_SCOPE: ReadonlySet<string> = new Set([
    'applet',
    'caption',
    'html',
    'marquee',
    'object',
    'table',
    'td',
    'template',
    'th',
]);

/** Button scope: base scope plus `button`. Used by `</p>` and by every element
 *  that closes an open paragraph. */
export const BUTTON_SCOPE: ReadonlySet<string> = new Set([...BASE_SCOPE, 'button']);

/** List-item scope: base scope plus the list containers, so a `<li>` in a nested
 *  list does not close its grandparent's item. */
export const LIST_ITEM_SCOPE: ReadonlySet<string> = new Set([...BASE_SCOPE, 'ol', 'ul']);

/** Table scope, for the row and cell rules. */
export const TABLE_SCOPE: ReadonlySet<string> = new Set(['html', 'table', 'template']);

export const DEFAULT_SCOPE: ReadonlySet<string> = BASE_SCOPE;

/**
 * Elements popped automatically when their parent closes. `generateImpliedEndTags`
 * pops these, which is why `<ul><li>one<li>two</ul>` yields two siblings rather
 * than a chain.
 */
export const IMPLIED_END_TAGS: ReadonlySet<string> = new Set([
    'dd',
    'dt',
    'li',
    'optgroup',
    'option',
    'p',
    'rb',
    'rp',
    'rt',
    'rtc',
]);

/**
 * Start tags that close an open `<p>` first. The list is the spec's, and it is
 * why `<p>a<div>b</div>` gives two siblings and not a nested pair.
 */
export const CLOSES_PARAGRAPH: ReadonlySet<string> = new Set([
    'address',
    'article',
    'aside',
    'blockquote',
    'center',
    'details',
    'dialog',
    'dir',
    'div',
    'dl',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'form',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'header',
    'hgroup',
    'hr',
    'listing',
    'main',
    'menu',
    'nav',
    'ol',
    'p',
    'plaintext',
    'pre',
    'search',
    'section',
    'summary',
    'table',
    'ul',
    'xmp',
]);

/**
 * The "special" category. Only used by the `li`/`dd`/`dt` rule, which walks up
 * the stack looking for a sibling item and gives up at the first special element
 * that is not `address`, `div` or `p` — so `<li><div>a<li>` still closes the item
 * while `<li><table><li>` does not.
 */
export const SPECIAL_ELEMENTS: ReadonlySet<string> = new Set([
    'address',
    'applet',
    'area',
    'article',
    'aside',
    'base',
    'basefont',
    'bgsound',
    'blockquote',
    'body',
    'br',
    'button',
    'caption',
    'center',
    'col',
    'colgroup',
    'dd',
    'details',
    'dir',
    'div',
    'dl',
    'dt',
    'embed',
    'fieldset',
    'figcaption',
    'figure',
    'footer',
    'form',
    'frame',
    'frameset',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'head',
    'header',
    'hgroup',
    'hr',
    'html',
    'iframe',
    'img',
    'input',
    'keygen',
    'li',
    'link',
    'listing',
    'main',
    'marquee',
    'menu',
    'meta',
    'nav',
    'noembed',
    'noframes',
    'noscript',
    'object',
    'ol',
    'p',
    'param',
    'plaintext',
    'pre',
    'script',
    'search',
    'section',
    'select',
    'source',
    'style',
    'summary',
    'table',
    'tbody',
    'td',
    'template',
    'textarea',
    'tfoot',
    'th',
    'thead',
    'title',
    'tr',
    'track',
    'ul',
    'wbr',
    'xmp',
]);

/** The six heading names, which close one another. */
export const HEADINGS: ReadonlySet<string> = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Elements the "in head" insertion mode owns. */
export const HEAD_ELEMENTS: ReadonlySet<string> = new Set([
    'base',
    'basefont',
    'bgsound',
    'link',
    'meta',
    'noframes',
    'script',
    'style',
    'template',
    'title',
]);

/**
 * What the "in head noscript" mode admits. `<noscript>` reaches the head only
 * when scripting is disabled — which it always is here, nothing runs scripts —
 * and a real page puts a whole `<noscript>` block of `<link>`s in its head. Head
 * elements outside this set pop the noscript instead of nesting inside it.
 */
export const IN_HEAD_NOSCRIPT: ReadonlySet<string> = new Set([
    'basefont',
    'bgsound',
    'link',
    'meta',
    'noframes',
    'style',
]);

/** Table section containers, which a new one of the same kind replaces. */
export const TABLE_SECTIONS: ReadonlySet<string> = new Set(['tbody', 'tfoot', 'thead']);

/** Table cells. */
export const TABLE_CELLS: ReadonlySet<string> = new Set(['td', 'th']);
