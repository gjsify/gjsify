// The differential corpus.
//
// Authored `.ts` string constants rather than `.html` files behind
// `gjsify.loaders`: no package in the tree declares that key, so introducing it
// would fail `field-coverage` until a conformance rule claimed it (ADR 0026 § 7).
// The 329 KB real page these shapes were taken from stays a LOCAL measurement and
// is never committed — third-party listings, personal data.
//
// Every fixture carries its own discriminators. `minElements` and `mustContain`
// are asserted BEFORE the trees are compared, because two empty strings compare
// equal and `27 === 27` is green today against a tree that is wrong.

export interface Fixture {
    name: string;
    html: string;
    /**
     * `identical` — our tree must equal parse5's, line for line.
     * `divergent` — a construct ADR 0026 § 6 scopes out. It asserts BOTH that we
     * match our committed golden AND that parse5 differs from it, so the day the
     * missing algorithm lands the assertion fails and forces the ledger to move.
     */
    expect: 'identical' | 'divergent';
    /**
     * One below the element count this fixture really has: the tightest value
     * that is still a lower bound, so a tree that lost a node does not reach the
     * comparison at all.
     */
    minElements: number;
    /** Decoded content that must appear in the canonical form. */
    mustContain: string[];
}

export const FIXTURES: Fixture[] = [
    {
        name: 'nested-articles',
        html:
            '<section><article class="aditem" data-adid="1"><h2>One</h2>' +
            '<p class="price">10 &euro;</p></article>' +
            '<article class="aditem" data-adid="2"><h2>Two</h2>' +
            '<p class="price">28&#034; &amp; more</p></article></section>',
        expect: 'identical',
        minElements: 9,
        mustContain: ['data-adid="2"', '10 €', '28\\" & more'],
    },
    {
        name: 'void-elements-mid-tree',
        html: '<div id="a"><img src="x"><br>text</div><div id="b">B</div>',
        expect: 'identical',
        minElements: 6,
        mustContain: ['img src="x"', 'div id="b"'],
    },
    {
        name: 'implied-list-items',
        html: '<ul><li>one<li>two<li>three</ul>',
        expect: 'identical',
        minElements: 6,
        mustContain: ['#text "one"', '#text "two"', '#text "three"'],
    },
    {
        name: 'nested-lists',
        html: '<ul><li>a<ul><li>b<li>c</ul><li>d</ul>',
        expect: 'identical',
        minElements: 8,
        mustContain: ['#text "d"'],
    },
    {
        name: 'implied-paragraphs',
        html: '<p>a<div>b</div><p>c<p>d',
        expect: 'identical',
        minElements: 6,
        mustContain: ['#text "c"', '#text "d"'],
    },
    {
        name: 'implied-table-cells',
        html: '<table><tr><td>1<td>2</tr><tr><td>3</table>',
        expect: 'identical',
        minElements: 9,
        mustContain: ['tbody', '#text "3"'],
    },
    {
        name: 'explicit-table',
        html: '<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
        expect: 'identical',
        minElements: 9,
        mustContain: ['thead', '#text "H"'],
    },
    {
        name: 'definition-list',
        html: '<dl><dt>t1<dd>d1<dt>t2<dd>d2</dl>',
        expect: 'identical',
        minElements: 7,
        mustContain: ['#text "t2"', '#text "d2"'],
    },
    {
        name: 'headings',
        html: '<h1>a<h2>b</h2><h1>c',
        expect: 'identical',
        minElements: 5,
        mustContain: ['#text "c"'],
    },
    {
        name: 'json-ld-script',
        html: '<article><script type="application/ld+json">{"a":"<b> & c"}</script><h2>T</h2></article>',
        expect: 'identical',
        minElements: 5,
        mustContain: ['{\\"a\\":\\"<b> & c\\"}', '#text "T"'],
    },
    {
        name: 'script-escape-levels',
        html: '<script>document.write("<!--<script></script>-->");var a = 1 < 2 && 3 > 4;</script><p>after</p>',
        expect: 'identical',
        minElements: 4,
        mustContain: ['1 < 2 && 3 > 4', '#text "after"'],
    },
    {
        name: 'rawtext-vs-rcdata',
        html: '<style>a{content:"&amp;"}</style><textarea>&amp;</textarea>',
        expect: 'identical',
        minElements: 4,
        mustContain: ['&amp;', '#text "&"'],
    },
    {
        name: 'entities',
        html: '<p>3.550&nbsp;&euro; VB &uuml;ber 28&#034; &#x2F; &hellip;</p>',
        expect: 'identical',
        minElements: 3,
        mustContain: ['€', 'über', '28\\"', '…'],
    },
    {
        name: 'attribute-query-string',
        html: '<a href="?a=1&copy=2">x</a><a href="?a=1&copy;=2">y</a>',
        expect: 'identical',
        minElements: 4,
        mustContain: ['href="?a=1&copy=2"', 'href="?a=1©=2"'],
    },
    {
        name: 'hyphenated-attributes',
        html: '<div data-adid="1" data-x-y="2" aria-label="z"><input disabled value=q><a HREF="u" href="v">l</a></div>',
        expect: 'identical',
        minElements: 5,
        mustContain: ['aria-label="z"', 'disabled=""', 'href="u"'],
    },
    {
        name: 'full-document',
        html:
            '<!DOCTYPE html><html lang="de"><head><meta charset="utf-8"><title>T &amp; T</title>' +
            '<link rel="x" href="y"></head><body><h1>H</h1><p>P</p></body></html>',
        expect: 'identical',
        minElements: 7,
        mustContain: ['#doctype "html"', '#text "T & T"', 'lang="de"'],
    },
    {
        name: 'whitespace-document',
        html: '<!DOCTYPE html>\n<html>\n<head>\n<title>x</title>\n</head>\n<body>\n<p>y</p>\n</body>\n</html>\n',
        expect: 'identical',
        minElements: 4,
        mustContain: ['#text "\\n"', '#text "y"'],
    },
    {
        name: 'bare-fragment',
        html: 'hello <b>world</b>',
        expect: 'identical',
        minElements: 3,
        mustContain: ['#text "hello "', '#text "world"'],
    },
    {
        name: 'head-noscript',
        html: '<!DOCTYPE html><html><head><noscript><link rel="s" href="n.css"></noscript><title>t</title></head><body>b</body></html>',
        expect: 'identical',
        minElements: 5,
        mustContain: ['noscript', 'href="n.css"', '#text "b"'],
    },
    {
        name: 'template',
        html: '<template><span>t</span></template><span>s</span>',
        expect: 'identical',
        minElements: 5,
        mustContain: ['#document-fragment', '#text "t"', '#text "s"'],
    },
    {
        name: 'unclosed-at-eof',
        html: '<div><span>x',
        expect: 'identical',
        minElements: 4,
        mustContain: ['#text "x"'],
    },
    {
        name: 'stray-end-tags',
        html: '<div>a</span>b</div></div>c',
        expect: 'identical',
        minElements: 3,
        mustContain: ['#text "ab"', '#text "c"'],
    },
    {
        name: 'stray-paragraph-close',
        html: '<div></p>x</div>',
        expect: 'identical',
        minElements: 4,
        mustContain: ['#text "x"'],
    },
    {
        name: 'comment-and-doctype',
        html: '<!DOCTYPE html><!-- c --><p>x',
        expect: 'identical',
        minElements: 3,
        mustContain: ['#comment " c "', '#doctype "html"'],
    },
    {
        name: 'pre-leading-newline',
        html: '<pre>\nline1\nline2</pre>',
        expect: 'identical',
        minElements: 3,
        mustContain: ['line1\\nline2'],
    },
    {
        name: 'select-options',
        html: '<select><option>a<option>b<optgroup><option>c</select>',
        expect: 'identical',
        minElements: 7,
        mustContain: ['optgroup', '#text "c"'],
    },
    // --- declared divergent, ADR 0026 § 6 --------------------------------
    {
        name: 'misnested-formatting',
        html: '<b><i>x</b>y</i>',
        expect: 'divergent',
        minElements: 4,
        mustContain: ['#text "x"', '#text "y"'],
    },
    {
        name: 'foster-parented-table-text',
        html: '<table>text<tr><td>1</table>',
        expect: 'divergent',
        minElements: 6,
        mustContain: ['#text "text"', '#text "1"'],
    },
    {
        name: 'svg-foreign-content',
        html: '<div><svg viewBox="0 0 1 1"><circle cx="1"/><rect x="2"/></svg></div>',
        expect: 'divergent',
        minElements: 6,
        mustContain: ['circle', 'rect'],
    },
];
