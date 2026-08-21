# 26. HTML parsing stays in `@gjsify/domparser`, and one selector engine serves both DOM models

- Status: **Accepted** — decided before implementation; nothing of it has landed yet
- Date: 2026-08-21
- Deciders: Pascal Garber
- Related: [ADR 0003 (package tiering)](0003-package-tiering.md), [ADR 0008 (release train)](0008-release-versioning-policy.md), [ADR 0014 (`/core` subpath over a new package)](0014-utils-core-subpath-and-platform-entry-routing.md), [ADR 0015 (headless contract)](0015-headless-package-contract.md)

## Context

`@gjsify/domparser` is an XML parser wearing a Web API's name. `DOMParser.parseFromString`
takes a `mimeType` and does not read it — the parameter is spelled `_mimeType`
(`src/index.ts:298`) and every call, whatever the type argument, runs `parseXml()`.

The gap is not only in the code. `status/status.json:150` describes the package as
*"DOMParser (parseFromString XML + HTML)"*, and `website/src/data/web-standards.ts:116`
lists DOMParser as `full`. **The authored status data has claimed HTML support for as
long as it has existed, and no test could contradict it**, because the suite passes
`'application/xml'` in all 28 of its `parseFromString` calls. That is the repo's most
expensive failure class in its quietest form: a claim with nothing behind it.

### What the XML parser does to HTML, measured

Against unmodified `src/index.ts` on Node 24, on synthetic input and on a 329 KB real page:

```
<div id=a><img src=x></div><div id=b>B</div>   → div#a.children = [img, div#b]
<ul><li>one<li>two<li>three</ul>               → 3 <li>, and li[0].textContent = "onetwothree"
<script>var a = 1 < 2 && 3 > 4;</script>       → "var a = 1  2;"      (markup eaten inside raw text)
"28&#034; &amp; &nbsp;&euro;"                  → passed through raw
<input disabled>                               → hasAttribute('disabled') === false
querySelectorAll('.aditem' | '[data-adid]')    → []            (tag names are the only selector)
querySelectorAll('a > b')                      → []            (combinators are never parsed)
parseFromString(x, 'application/json')         → parses as XML
```

The `<li>` line is the one to keep in view. `querySelectorAll('li').length === 3` is
**green today** on a tree where all three list items are nested inside the first. On the
real page `querySelectorAll('article').length === 27` is likewise green while the first
article's `textContent` begins with the JSON-LD of a `<script>` block that leaked into it.
A count is not a measurement here; every assertion needs a content discriminator beside it.

### `querySelector` has a second, unrelated owner

`packages/dom/dom-elements/src/element.ts:221-235` holds four stubs — `querySelector`
returns `null`, `querySelectorAll` returns `[]`, `matches` returns `false`, `closest`
returns `null`. They are the same failure class one level up: an API that answers, always
wrongly, and never fails. Whatever selector engine gets written, these are its second
consumer, and a second engine is the shape [code-anti-patterns](../code-anti-patterns.md)
names as "the drifted copy fails in a CONSUMER while the owning package stays green".

### The one measured XML consumer

`@excaliburjs/plugin-tiled@0.32.0` parses `.tmx` through the injected global
(`showcases/dom/excalibur-jelly-jumper` builds with `--globals …,DOMParser,…`). Its
published build uses exactly seven DOM members — `getAttribute` (96 sites),
`querySelector` (52), `children` (40), `tagName` (24), `textContent` (20), `innerHTML` (4),
`attributes` (4) — and **no `childNodes` at all**. It switches on lowercase tag literals
(`case "properties"`, `case "image"`, `case "chunk"`, `case "group"`), iterates
`for (const a of el.attributes)` reading `.name`/`.value`, and calls
`parseFromString(text, "application/xml")`.

So the XML path has a real consumer, it is reachable from four runtimes at once, and its
contract is narrower and more precisely known than "the XML parser".

### There is a working oracle, and it changes what can be verified

Measured 2026-08-21: `parse5@8`, `htmlparser2@12` + `css-select@7`, and
`node-html-parser@9` all run **unmodified under gjsify/GJS** and produce byte-identical
results to their Node runs on the same 329 KB page (27 `article.aditem`, identical
`data-adid`, identical title, `3.550 € VB` — the `€` proving entity and UTF-8 handling).

That is the decisive fact for this ADR. A hand-written HTML parser normally has to be
argued about; this one can be *differentially tested* against a full WHATWG implementation
on both runtimes. Divergence is a finding, not an opinion. It also means the reference
material for the tree-construction shortcuts does not have to be adapted line-for-line
from any one project: the oracle proves the table right or wrong.

## Decision

### 1. Everything lands in `@gjsify/domparser`, split across leaf subpaths

Not a new package: *"a `/core` subpath beats a new `-core` package — a new published name
needs the manual first-publish bootstrap"* (root AGENTS.md § Don't patch; the v0.4.20
incident in [publishing](../publishing.md) is the cost of forgetting it).

Not `@gjsify/dom-elements`, and this one is forced by the runtime axis rather than by
taste. `domparser` is `node: "polyfill"` with **zero** runtime dependencies and runs
`test:node`/`test:bun`/`test:deno`; `dom-elements` is `node: "none"`, declares no
`test:node` script, and pulls GdkPixbuf, Cairo/Pango and Soup through its dependency set. A
tokenizer placed there would have no Node run — and the Node run *is* the differential
test. Root AGENTS.md § Testing: *"Node tests prove the TEST is correct"*. A parser in
`dom-elements` is a parser whose verification method does not exist.

```
packages/web/domparser/src/
  index.ts          barrel — re-exports only
  dom/              DOMNode · DOMElement · DOMDocument · DOMText · DOMComment · DOMDocumentType
  xml/parse-xml.ts  today's scanner
  html/             tokenizer · TreeSink interface · tree builder
  entities/         generated table + the three-context decoder
  selectors/        grammar → AST → compiled predicate chain, over Adapter<TNode>
  dom-adapter.ts    the Adapter for our own nodes
```

`exports` gains `./html`, `./selectors`, `./entities`. All three are **leaves** — they
import no node classes and no `@girs/*`, the same shape that lets `@gjsify/crypto` consume
`@gjsify/webcrypto/random` cycle-free. `files: ["lib", "globals.mjs"]` already covers them,
so `verify-tarball-outputs.mjs` needs no change; `sideEffects` stays register-only, because
none of the three has any.

No new `gjsify.*` field is declared, so `field-coverage` is unaffected.

### 2. `dom-elements` consumes `@gjsify/domparser/selectors`; the edge never reverses

`dom-elements` gains `"@gjsify/domparser": "workspace:^"` and implements an `Adapter` over
its own `Element`. One engine, two adapters. The edge is legal on every axis that checks
one: tier 1 → tier 1 (ADR 0003), direction dom → web (which already exists via
`dom-events` and `fetch`), and the subpath is pure TS so nothing new becomes reachable.

The reverse edge — `domparser` importing `dom-elements` to return "real" DOM nodes — is
**closed**, and not as a matter of preference: it would drag GdkPixbuf, Cairo and Soup into
a `node: "polyfill"` package and end the Node/Bun/Deno runs. `domparser` therefore keeps
its own node classes, and unifying the two node models is a separate track (§ Deferred).

### 3. `parseFromString` reads its second argument

| `mimeType` | path |
|---|---|
| `text/html` | HTML5 tokenizer + tree builder |
| `text/xml`, `application/xml`, `application/xhtml+xml`, `image/svg+xml` | today's `parseXml` |
| anything else | `TypeError` naming the five accepted values |

The throw is the WebIDL enum behaviour, and it is chosen over the silent XML fallback for
the same reason the pixel bridge in `@gjsify/canvas2d-core` throws a `TypeError` naming its
subpath instead of returning blank pixels: a caller who passes the wrong type is told, once,
at the call. No consumer in the tree passes a sixth value — the suite passes
`'application/xml'` 28 times out of 28, tiled passes `'application/xml'`, and the four
showcases that pass `'image/svg+xml'` build `--app browser`, where the `native` slot routes
`DOMParser` to `globals.mjs` and this code never runs.

### 4. The XML tree shape is frozen, and frozen by a test rather than by a note

The HTML mode follows the spec: `tagName` UPPERCASE, `localName` lowercase, attribute names
lowercased, selector matching case-insensitive for type and attribute names.

The XML mode keeps every observable it has today, including the two that are *wrong* by the
XML spec: `tagName` is lowercased (XML is case-sensitive) and `nodeName` is uppercased. The
reason is measured, not conservative-by-default — the one known consumer dispatches on
lowercase tag literals across 24 sites, and case preservation buys nothing for TMX/TSX,
whose grammar is lowercase throughout. Changing it is risk with no measured benefit.

What makes this a decision rather than a landmine: the freeze is expressed as a **golden
canonical serialization** of a TMX-shaped fixture, committed and compared with `toBe`. A
note saying "careful, XML lowercases" is read by nobody; a test that fails is read by
whoever changed it. Case preservation gets its own `status/open-todos.md` section
(§ Deferred), where a `### ` heading is deleted when it is done rather than ticked.

Three things do change in the XML path, all of them strict additions that cannot move an
element or alter a `textContent` the consumer reads:

- **entities are decoded** — the five XML predefined references plus numeric ones. Today
  `&amp;` reaches a TMX property value as `&amp;`, which is simply wrong output;
- **Comment and DocumentType nodes appear in `childNodes`** — `children` is element-only
  and `textContent` excludes comments by spec, so both stay identical, and the measured
  consumer reads no `childNodes`;
- **`querySelector`/`querySelectorAll` get the real engine** — a strict superset of the
  tag-name comparison they do today, and a fix for `querySelectorAll('a > b')`, which
  currently returns `[]` for every combinator.

`attributes` keeps returning plain `{name, value}` records. A `NamedNodeMap` would be
better, and `dom-elements` already has one — writing a second is exactly the duplication
this ADR exists to avoid, so it waits for the shared node model.

### 5. The full entity table, generated — not a popular subset

The 329 KB page contains four distinct named references (`&nbsp;` ×52, `&amp;` ×12,
`&uuml;`, `&ouml;`) plus two numeric forms. A ~110-entry table would cover it in ~2 KB
against the complete set's **36,279 bytes, measured** — half again the ~24 KB estimated
here before it was built.

The full table wins anyway, because the subset fails **silently**: `&hellip;` would stay
raw in the text, nothing throws, no test reddens, and the scraper returns a wrong string.
That is the failure class this whole ADR is about. 36 KB is the honest price of "decodes
correctly or not at all". The table is generated by a committed script from the spec's own
named-character-reference data and committed as generated source; the decoder implements
three contexts — text (legacy, semicolon optional), attribute, and strict — because the
attribute rule is a live scraping trap: without it `href="?a=1&copy=2"` decodes to
`?a=1©=2` and produces URLs that look parsed and point nowhere.

### 6. What is in, and what is deliberately out

**In:** the tokenizer states real pages need (data, tag, attribute in four forms,
RAWTEXT for `script`/`style`, RCDATA for `textarea`/`title`, comments incl. the bogus
forms, doctype); the void-element set; the implied-end-tag table; implicit
`html`/`head`/`body`; `<template>` content as a fragment; EOF auto-close; entity decoding;
a serializer that emits valid HTML (today `outerHTML` writes `<div/>` for an empty div);
and a selector engine covering type/`*`/`.class`/`#id`, all eight attribute operators with
the `i`/`s` flags, the four combinators, selector lists, and `:not() :is() :where() :has()
:nth-child(an+b [of S]) :nth-of-type() :first-child :last-child :only-child :first-of-type
:last-of-type :only-of-type :empty :root :scope`, plus the attribute-derived form states.

**Out, and each with its reason:**

- **the 23-insertion-mode automaton** — the adoption agency algorithm, the active
  formatting elements list, foster parenting. `htmlparser2` implements none of it, carries
  only the implied-end-tag table, and on the 329 KB page returns exactly what `parse5`
  returns with the full automaton. ~8000 lines that measured as worth nothing on real HTML.
  Constructs that need it (`<b><i></b></i>`, stray table content) are declared divergent
  in the differential suite rather than left undiscovered;
- **SVG/MathML foreign content** and its tag-name adjustments — only needed to select
  *into* SVG;
- **encoding sniffing and `<meta charset>` reparse** — `parseFromString` receives a JS
  string;
- **quirks mode** — its only observable here is selector case-sensitivity, which the
  document mode already answers;
- **the `innerHTML` setter / fragment parsing with a context element** — it needs the
  insertion-mode machinery declared out above;
- **`Attr` / `NamedNodeMap` / `NodeList` / `classList` / `dataset`** — `dom-elements` has
  all of them; a second copy is the drift;
- **pseudo-elements, user-state pseudos, namespace selectors, `||`** — meaningless without
  rendering or without a live document. These **throw a `SyntaxError` naming the
  construct**; they never quietly match nothing.

### 7. Verification is differential, and the oracle lives in `tests/integration/`

No published package in this tree carries an npm devDependency other than build and type
tooling, and `parse5` will not be the first. The oracle goes where every other upstream
suite goes: `tests/integration/domparser/` (`@gjsify/integration-domparser`, private), on
the template of `tests/integration/streamx/`, running on **node and gjs** — which is only
possible because parse5 was measured green on GJS.

Three properties make it a measurement rather than a ritual:

1. **One canonicalizer, instantiated twice.** A single `canonicalize()` walks a
   `TreeReader` and prints an indented text form; one instance reads parse5's tree, the
   other reads ours, and the two strings are compared with `toBe`. Two canonicalizers would
   be two chances to agree on the same mistake.
2. **Every fixture carries its discriminator.** A fixture declares `minElements` and a
   `mustContain` list; the suite asserts the element count exceeds the minimum and that the
   canonical string contains the named decoded content *before* it compares. `27 === 27`
   and `3 === 3` are both green today against broken trees — a comparison of nothing with
   nothing must not be able to pass.
3. **Declared divergence is self-retiring.** A fixture marked `divergent` asserts both that
   our output equals its committed golden **and that parse5 differs from it**. On the day
   the missing algorithm is implemented, that assertion fails and forces the ledger to be
   updated — the same self-retiring shape as `it.failing`, applied to a scope boundary
   instead of to an upstream defect.

The named entity table gets its **own** oracle in the same suite: `entities`, the decoder
parse5 itself uses, declared as a devDependency rather than taken from the one parse5 drags
in — an oracle that arrives transitively stops arriving on the day the dependency that
carried it changes, and nothing says so. All 2,231 names are swept in text and attribute
context, plus ~25,000 numeric forms and 20,000 seeded-random ampersand runs, and each sweep
counts how many inputs it actually changed so two no-ops cannot agree. One divergence is
deliberate and pinned as an exact set: `entities` applies the Windows-1252 remap in XML
mode, we do not, and expat — neither implementation — agrees with us that `&#128;` is
U+0080 in XML.

That sweep taught its own lesson, and it is the reason the table's size is asserted
**exactly**: a sweep driven by `Object.keys(NAMED_REFERENCES)` can only try names the table
already has, so deleting `hellip;`, `euro;` and `uuml;` left every one of those sweeps
green. Completeness needs a list the test carries itself plus an exact count; correctness
needs the oracle. Neither half is sufficient alone.

Fixtures are authored `.ts` modules exporting raw strings, not `.html` files behind
`gjsify.loaders`: no package in the tree declares that key today, so introducing it would
fail `field-coverage` until a conformance rule claimed it — a real cost for a cosmetic gain.
The real 329 KB page stays a local measurement and is never committed (third-party
listings, personal data).

Beneath the oracle, the per-package specs keep proving behaviour we own, because the
affected-classifier runs `<workspace>/src/**/*.spec.ts` on every PR while integration
suites are opt-in: tokenizer token streams, the entity contexts, the selector grammar
against a hand-built tree (proving the engine independent of the parser), the serializer
round-trip, and the XML golden.

## Consequences

- **Bundles that reference `DOMParser` get materially larger — measured, not estimated.**
  The same probe (`parseFromString(…, 'application/xml')`, bundled `--app node`, minified)
  is **4,215 bytes before this ADR and 61,291 bytes after**: ×14.5. The named entity table
  is **36,279 of those bytes — 59 % of the whole parser**, more than the tokenizer, the
  tree builder and the node classes together. For comparison, the npm stack this replaces
  (`htmlparser2 + css-select + domutils + entities`) is 107,071 bytes. Only bundles that
  actually name the global pay it (`--globals auto` injects on a detected identifier).
- **The `entities` subpath is not yet a leaf in the sense its header claims.** Importing
  `decodeXml` alone bundles to **38,030 bytes**: it reaches `NAMED_REFERENCES` through the
  matcher it shares with the HTML contexts, so an XML-only consumer carries all 2,231 HTML
  names it can never resolve. No consumer pays this today — `DOMParser` references both
  paths, so the table is live regardless — which is why it is recorded here rather than
  fixed in passing. Splitting the shared matcher so the table is a parameter is what makes
  the claim true.
- **`@gjsify/dom-elements` gains its first Web-pillar dependency that is pure TS**, and
  loses four methods that answered without looking.
- **The status data becomes true.** `status/status.json` and
  `website/src/data/web-standards.ts` have described HTML support since before it existed;
  after this they describe what runs.
- **`@gjsify/domparser` stops being "sized for excalibur-tiled".** The pillar table row in
  `packages/web/AGENTS.md`, the `packages/dom/AGENTS.md` row, and the package README are
  part of the same PR (root AGENTS.md § Governance → doc).
- **Two long-standing test gaps close in passing**: there is no `register.spec.ts` today
  (tests/AGENTS.md rule 7), and `src/test.browser.mts:31` asserts `p.className`, a property
  the polyfill class does not have — the browser suite has been measuring a different
  surface than the GJS/Node suite.
- **Release-train exposure is one version wide** (ADR 0008): every in-workspace consumer
  moves in the same PR, and an external consumer sees the change as a `feat` in
  `CHANGELOG.md`, not as a silent behaviour swap.

## Implementation

Ordered so that each step is independently committable and the step that freezes the XML
contract lands *before* anything can move it. The working plan with per-step proofs is kept
outside the repo; the sequence is:

1. barrel split (`src/index.ts` → `src/dom/`, `src/xml/`), no behaviour change
2. the XML golden — canonical serialization of a TMX-shaped fixture, committed
3. entities: generated table, three-context decoder, `./entities`; XML wired to the five
   predefined plus numeric
4. HTML tokenizer + the `TreeSink` interface
5. HTML tree builder: void set, implied end tags, `html`/`head`/`body`, `<template>`;
   `./html`
6. `parseFromString` branches on `mimeType`
7. the selector engine over `Adapter<TNode>`; `./selectors`
8. `querySelector`/`matches`/`closest` wired through the adapter, both modes
9. a serializer that emits valid HTML
10. `tests/integration/domparser/` — the differential suite
11. CI: the suite into `main.yml`'s `integration` allowlist + its `status/integration-coverage.md` section
12. docs + status data + `status/open-todos.md` sections + the agent-context ledger
13. `dom-elements`: the adapter, the four stubs replaced
14. `register.gjs.spec.ts` and the `test.browser.mts` surface mismatch
15. measure the showcase bundle delta; run `scripts/showcase-smoke.mjs`
16. full gate: `gjsify install --immutable && gjsify run clear && gjsify run build && gjsify run check && gjsify run test`, plus `audit-runtimes --check --strict` and both output verifiers

## Deferred

Each gets a `### ` section in `status/open-todos.md` in the PR that lands the work above —
the ADR records the *why*, the ledger records what is left.

**One node model.** `domparser` and `dom-elements` describe the same world and disagree
about it: `tagName` casing, attribute-name case sensitivity, `attributes` as records versus
a `NamedNodeMap`. The fix is not a dependency in either direction but lifting the
platform-free node classes out of `dom-elements` into a leaf both consume — which changes
what `@gjsify/dom-elements` *is*, and needs its own ADR. Until then this ADR's `Adapter`
seam is what keeps the disagreement from multiplying: one selector engine, two trees.

**Case-preserving XML.** The XML mode lowercases `tagName` and uppercases `nodeName`; both
are wrong for XML. Frozen here for the reason in Decision 4, and pinned by the golden, so
changing it is a visible edit rather than a surprise.

**Fragment parsing.** The `innerHTML` setter and `DOMParser`-adjacent fragment APIs need
the insertion-mode machinery this ADR scopes out.

**`@gjsify/devtools-cdp` parses HTML with a regex.** `src/target-discovery.ts:10` says so
in a comment and explains that DOMParser was not usable. It becomes usable here; collecting
it is a separate change against a different pillar.
