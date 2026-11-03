# @gjsify/site-highlight

Build-time syntax highlighting for the code blocks of a [@gjsify/site](../site/README.md) blog —
[Shiki](https://shiki.style) on its JavaScript regex engine, so it runs on GJS, Node, Bun and Deno.
The colours are in the HTML the build writes, and one rendered block follows the reader's light or
dark scheme through CSS variables. No client JavaScript, no second HTML copy per scheme.

Shiki carries no Blueprint grammar, so this package ships one: `.blp` fences in a widget gallery
are highlighted like every other language.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS
(GNOME JavaScript).

## Installation

```bash
gjsify install -D @gjsify/site-highlight
```

## Use

Install the hook at the site build:

```typescript
import { buildSite } from '@gjsify/site';
import { createHighlighter } from '@gjsify/site-highlight';

const highlighter = await createHighlighter();
await buildSite({
    root: process.cwd(),
    out: 'dist',
    markdown: { highlight: (code, lang) => highlighter.highlight(code, lang) },
});
```

`createHighlighter()` parses every grammar once, so create it once per build and pass the same
instance to every render. `highlight(code, lang)` answers Shiki's `<pre class="shiki …">` HTML, or
`undefined` for a language this package doesn't ship — `@gjsify/site` then falls back to its plain
`<pre><code>` block instead of pretending the fence was highlighted.

The same hook reaches the renderer directly, which is what a caller that renders a single post
needs:

```typescript
import { renderPostBody } from '@gjsify/site';

const html = renderPostBody(config, post, postsDir, posts, { highlight });
```

## The stylesheet

The HTML sets `--shiki-light*` and `--shiki-dark*` on every token and no `color`, so it needs
`highlighter.css` — **appended after the site's own stylesheet**, because a block's background is
painted by the site's `pre` rule too and the later rule wins:

```typescript
const stylesheet = `${readFileSync(siteCssPath, 'utf8')}\n${highlighter.css}`;
```

The sheet colours from `@media (prefers-color-scheme: dark)`, and additionally from
`[data-theme='dark']` / `[data-theme='light']` for a site whose toggle sets a `data-theme`
attribute on `<html>`. A site that spells the attribute differently names it:

```typescript
const highlighter = await createHighlighter({ schemeAttribute: 'data-scheme' });
```

`highlightCss(attribute)` answers the same stylesheet without loading any grammar. A toggle that
is a class rather than an attribute needs its own selectors.

## Languages

`ts`, `js`, `css`, `scss`, `json`, `sh`, `xml`, `yaml`, `md`, `diff` and `blp` — each with the
aliases its grammar declares (`typescript`, `javascript`, `bash`, `shell`, `yml`, `markdown`,
`blueprint`, …). A fence's info string may carry more than the name: ```` ```sh title=build ````
highlights as `sh`.

Extending the set means adding a `@shikijs/langs/*` import to `LANGUAGES` in
[`src/index.ts`](src/index.ts) — they are static imports so the build bundles only what is listed,
and so the browser bundle of a consumer does not grow by a grammar it never shows.

## The Blueprint grammar

[`grammars/blueprint.tmLanguage.json`](grammars/blueprint.tmLanguage.json) also feeds the
website's own `.blp` tabs, which read it as a JSON module. It is deliberately a TextMate grammar
rather than a parser: it names keywords, types, strings and comments, and leaves the structure to
the compiler. Its `_comment` header records what it covers and what it doesn't.

## License

MIT
