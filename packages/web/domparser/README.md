# @gjsify/domparser

`DOMParser.parseFromString` for GJS, Node.js, Bun, Deno and NativeScript — an HTML5 parser, an XML scanner, a CSS Selectors 4 engine and the full WHATWG character-reference table, with no runtime dependencies. Browsers keep their native `DOMParser`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/domparser

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/domparser
yarn add @gjsify/domparser
```

## Usage

`parseFromString` reads its second argument. `text/html` runs the HTML5 tokenizer and tree builder; the four XML types run the XML scanner; anything else throws a `TypeError` naming the five accepted values, rather than returning a plausible wrong tree.

```typescript
import { DOMParser } from '@gjsify/domparser';

const doc = new DOMParser().parseFromString(await response.text(), 'text/html');

for (const ad of doc.querySelectorAll('article.aditem[data-adid]')) {
    console.log(ad.getAttribute('data-adid'), ad.querySelector('h2')?.textContent);
}
```

```typescript
// The XML path — TMX, TSX, any well-formed document.
const map = new DOMParser().parseFromString(tmx, 'application/xml');
console.log(map.documentElement?.getAttribute('width'));
console.log(map.querySelectorAll('layer > data').length);
```

### What the HTML mode gives you

- implicit `html`/`head`/`body`, the void-element set, the implied-end-tag table, table sections, `<template>` content as a fragment, EOF auto-close;
- `<script>`/`<style>` as raw text, `<textarea>`/`<title>` as RCDATA;
- character references decoded in all three contexts — element content, attribute values (`href="?a=1&copy=2"` stays a query string) and XML's five predefined names;
- `innerHTML`/`outerHTML` that re-escape, so what you read back reparses into the tree you had.

### Selectors

`querySelector`, `querySelectorAll`, `matches`, `closest`, `getElementById` and `getElementsByClassName` all run through one engine: type/`*`/`.class`/`#id`, the eight attribute operators with the `i`/`s` flags, the four combinators, selector lists, `:not() :is() :where() :has() :nth-child(an+b [of S]) :nth-of-type() :first-child :last-child :only-child :first-of-type :last-of-type :only-of-type :empty :root :scope`, and the attribute-derived form states (`:disabled :enabled :checked :required :optional :selected :any-link`).

A construct the engine will not evaluate — a pseudo-element, a user-state pseudo-class, a namespace selector, `||` — throws a `SyntaxError` naming it. It never quietly matches nothing.

### Subpaths

Each is a leaf: it imports no node classes and nothing platform-specific, so a consumer that needs one does not bundle the rest.

| Import | Contents |
|---|---|
| `@gjsify/domparser` | `DOMParser`, the node classes, `canonicalize`, `domTreeReader` |
| `@gjsify/domparser/html` | `tokenize`, `parseHtml`, `VOID_ELEMENTS`, `RAWTEXT_ELEMENTS`, `RCDATA_ELEMENTS` |
| `@gjsify/domparser/selectors` | `selectAll`, `selectOne`, `matchesSelector`, `closestSelector` over an `Adapter<TNode>` — point it at your own tree |
| `@gjsify/domparser/entities` | `decodeText`, `decodeAttributeValue`, `decodeXml`, `NAMED_REFERENCES` |
| `@gjsify/domparser/register` | side effect: installs `DOMParser` on `globalThis` if nothing else has |

## Scope

Correct for HTML, and honest about where it stops. Not implemented: the adoption agency algorithm, foster parenting, SVG/MathML foreign content and its name adjustments, the "in select" insertion mode (a `<select>` keeps markup a browser would drop), encoding sniffing, and the `innerHTML` setter. Those boundaries are not claims — `tests/integration/domparser/` parses every fixture with this parser **and** with [parse5](https://github.com/inikulin/parse5), prints both trees through the same canonicalizer and compares them, so a divergence is a test failure; the out-of-scope constructs are pinned as `divergent` fixtures that fail the day the gap closes. Selector results are compared the same way against `css-select`, and the entity table against `entities`.

## License

MIT
