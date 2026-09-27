<!-- Authored Open-TODO sections — area: DOM parsing (@gjsify/domparser, dom-elements, dom-bridge).
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### Universal DOM Container (`@gjsify/dom-bridge`)

Architectural vision for unified DOM-in-GTK: `document.createElement("canvas")` + `getContext("2d")` automatically creates the right GTK widget behind the scenes; `document.body` maps to a real GTK container hierarchy; each child element gets its own bridge transparently — making browser code "just work" in GTK without explicit bridge creation. Deferred from the initial bridge architecture — requires deeper integration between `Document`, `Element.appendChild`, and the GTK widget tree.


### `@gjsify/domparser` has no "in select" insertion mode

A `<select>` may contain only `option`, `optgroup`, `hr`, `script` and `template`;
the HTML spec's "in select" insertion mode IGNORES every other start tag and keeps
the text. This parser has no such mode — it only pops `option`/`optgroup` against
one another — so `<select><div>d</div></select>` keeps the `div` where a browser
drops it and keeps `d`.

Found by ablation, not by reading the spec: the seeded fuzz in
`tests/integration/domparser/src/fuzz.spec.ts` diffs generated markup against
parse5, and with the three algorithms ADR 0026 § 6 already scopes out excluded
from its generator, `<select>` was the last construct still diverging — 451 of
4000 cases. Zero of the 47 real pages in the local corpus hit it, which is why it
survived the authored fixture corpus: real markup does not put a `<div>` in a
`<select>`.

What it costs to close: a `MODE_IN_SELECT` plus the spec's "reset the insertion
mode appropriately" algorithm, which this tree builder does not have — its modes
are a flat enum with `MODE_IN_BODY` as the workhorse. The `in select in table`
variant needs table awareness on top.

Pinned rather than noted: `select-with-foreign-markup` is a `divergent` fixture,
so it asserts BOTH our committed golden AND that parse5 differs from it. The day
the mode lands, that assertion fails and this entry has to be deleted.


### `@gjsify/domparser` does not parse SVG/MathML foreign content

ADR 0026 § 6 scopes out the foreign-content insertion mode and the
adjusted-attribute tables, on the reasoning that they are "only needed to select
*into* SVG". Measured against parse5 over 47 real pages (~91,400 canonical tree
lines) that boundary is exactly where the ADR says it is — **every** divergence is
inside an `<svg>`/`<math>` subtree and there are **none** outside one — but it is
wider than the sentence suggests, because inline SVG icons are on most pages:

- attribute and element names are lowercased, so `viewBox` becomes `viewbox`,
  `clipPath` becomes `clippath`, `xlink:href` becomes `href`, and a selector
  naming any of them finds nothing;
- a self-closing child (`<path/>`, `<circle/>`) is honoured in foreign content and
  ignored in HTML, so `<circle/><rect/>` NESTS here where a browser makes them
  siblings — which moves the subtree a document-wide `*` or `[class]` walks.

On the corpus that costs 90 of 940 selector comparisons, all of them on pages with
inline SVG. The parser is correct for HTML and wrong inside SVG, and nothing in
the output says which one a caller is looking at.

Pinned rather than noted: `tests/integration/domparser/src/fixtures.ts` carries
`svg-foreign-content` as a `divergent` fixture, which asserts BOTH our committed
golden AND that parse5 differs from it — so the day this lands, the assertion
fails and this entry has to be deleted rather than quietly outlived.


### `@gjsify/domparser` walks a tree recursively, so depth is bounded by the stack

The tokenizer and the tree builder are iterative — a 10,000-deep document PARSES
fine. Everything that READS the resulting tree is not: `textContent` overflows at
about 2,000 levels, `innerHTML`/`outerHTML` at about 4,000, and
`querySelectorAll`/`canonicalize` at about 10,000, each with a bare
`RangeError: Maximum call stack size exceeded`. parse5 handles all of them.
`closest()` and `matches()` are iterative and unaffected.

Not a regression and not urgent, which is why it is here rather than fixed in the
PR that measured it: `origin/main` has the same limit and a WORSE one for
`innerHTML` (it threw at 2,000 where the current serializer survives to 4,000),
and the deepest tree in the 47-page real corpus is **29 levels** — a margin of
about seventy. The shape that reaches it is a page with thousands of unclosed
`<div>`s, which a hostile or generated page can produce.

The fix is mechanical (an explicit stack in `DOMNode.textContent`,
`dom/serialize.ts` and `selectors/query.ts`), and it is worth doing the day
anything here runs on untrusted input without a depth cap in front of it.


### One node model for `@gjsify/domparser` and `@gjsify/dom-elements`

The two describe the same world and disagree about it: `tagName` casing,
attribute-name case sensitivity, `attributes` as plain records versus a
`NamedNodeMap`. The fix is not a dependency in either direction but lifting the
platform-free node classes out of `dom-elements` into a leaf both consume — which
changes what `@gjsify/dom-elements` *is* and needs its own ADR (0026 § Deferred).
Until then the `Adapter` seam is what keeps the disagreement from multiplying:
one selector engine, two trees.


### Case-preserving XML in `@gjsify/domparser`

The XML mode lowercases `tagName` and uppercases `nodeName`; both are wrong for
XML and both are frozen, because `@excaliburjs/plugin-tiled` dispatches on
lowercase tag literals at 24 sites and TMX/TSX grammar is lowercase throughout
(ADR 0026 § Decision 4). Pinned by the golden in
`packages/web/domparser/src/xml-shape.spec.ts`, so changing it is a visible edit
rather than a surprise. Doing it properly means giving the XML path its own
casing rule and moving the one measured consumer at the same time.


### Fragment parsing — the `innerHTML` setter and a context element

`@gjsify/domparser` serializes a tree to markup but cannot parse markup INTO an
existing element: the `innerHTML` setter and the `DOMParser`-adjacent fragment
APIs need the insertion-mode machinery ADR 0026 § 6 scopes out (a fragment is
parsed with a context element that selects the initial mode). The getter side
landed with the serializer; only the setter is missing.

