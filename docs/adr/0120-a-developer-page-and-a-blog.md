# 120. `@gjsify/site` renders a developer page and a blog, from files the developer already keeps

- Status: **Accepted** (2026-10-26)
- Date: 2026-10-26
- Deciders: Pascal Garber
- Amends: [ADR 0109 (a static site generator reads an app from its metainfo)](0109-a-static-site-generator-reads-an-app-from-its-metainfo.md)
  — `gjsify.site` becomes a union of an app site and a developer site; the `--overview` build of
  its 2026-10-14 amendment is removed
- Related: `packages/infra/site`; the first consumer is the developer site of the Beifahrer and
  Steuererklärung author, which links both app sites

## Context

ADR 0109 gave every app a landing page generated from its metainfo. Two needs sit one level above
a single app and are shared by every developer who publishes more than one:

1. **A page about the person**: who they are, what they built, where to support them, a CV. Today
   that is a hand-written site per developer, which drifts from the app pages in look and in
   content — the app list on it is a second copy of what each app's `app.json` already says.
2. **A blog**: release notes say *what* changed; a post says *why*. A post also is the unit that
   aggregators (Planet GNOME, This Week in GNOME, the fediverse) pick up — an app page is not.
   Both an app and a developer want one, and both want it in git next to the code, not in a CMS.

The 2026-10-14 amendment of 0109 added `--overview`, a support page over several apps. It never got
a consumer: what it renders is a strict subset of the developer page below.

## Decision

### 1. `gjsify.site` is a tagged union: App | Developer

Tagged by key presence — exactly one of `metainfo` (an app site, unchanged) or `developer` (a
developer site). Both, or neither, is a config error naming the key. Every key that is not about
an app (`url`, `base`, `languages`, `sourceLanguage`, `support`, `privacy`, `legalNotice`, `blog`,
`theme`) means the same on both sides; the parser shares that code.

```jsonc
"gjsify": { "site": {
  "url": "https://example.org/",
  "languages": ["en", "de"],
  "developer": {
    "resume": { "en": "resume.en.json", "de": "resume.de.json" },
    "apps": ["https://example.org/my-app/", { "name": "…", "url": "…" }]
  },
  "blog": { "posts": "blog" },
  "theme": { "accent": "#3584e4", "displayFont": "fonts/display.woff2", "imageRendering": "pixelated" }
} }
```

`developer.apps` has exactly the format of `relatedApps` and is loaded by the same code
(`site-data/related.ts`): a site URL whose `app.json` is fetched, or an inline entry. The app list
on the developer page is therefore the apps' own data, never a copy.

### 2. The developer data is a JSON Resume, read narrowly

The person is described by a [JSON Resume](https://jsonresume.org/schema) file per language — an
existing, tool-supported format the developer may already have. The reader takes only what it
renders: `basics` (name, label, image, email, url, summary, location, profiles), `work`,
`education`, `skills`, `languages`, `projects`. Unknown keys are ignored; a known key of the wrong
type fails with its path (`resume.de.json: work[2].startDate must be a string`). `skills[].level`
is not rendered: a self-assessed level is noise to a reader and a bar chart of it is worse.

Two pages: the hub `/<lang>/` (masthead, about, apps, projects, latest posts, support) and the CV
`/<lang>/cv/` (work, education, skills, languages) with a print stylesheet.

### 3. The blog is Markdown files in git

`blog.posts` names a directory. A post is `<slug>.<lang>.md`, or any `.md` whose frontmatter sets
`slug` and `lang`. Frontmatter: `title`, `date` (required), `lang`, `summary`, `tags`, `draft`,
`slug`. It is parsed by a small YAML subset (scalars, quoted strings, inline and dash lists) that
rejects everything else by name — not a YAML dependency for six keys.

- URLs: index `/<lang>/blog/`, post `/<lang>/blog/<slug>/`, Atom feed `/<lang>/blog/feed.xml`, and
  one Atom feed per tag at `/<lang>/blog/tags/<tag>.xml` — an aggregator such as Planet GNOME
  subscribes to one topic, not the whole blog.
- **A post may exist in one language only.** Each language's index lists that language's posts;
  `hreflang` alternates are emitted only between real translations, and the language switch on an
  untranslated post leads to the other language's blog index.
- `draft: true` posts are left out unless the build runs with `--drafts`.
- Images next to a post are copied into the output and their relative URLs rewritten, so a post
  previews correctly in any Markdown viewer and on the site.
- The same blog works on an app site: its landing page gains a "latest posts" section and the top
  bar a Blog link.

The Markdown subset of `render/markdown.ts` grows by what a post needs and a legal text did not:
fenced code, images, blockquotes, emphasis. Still no syntax highlighting and no raw HTML.

### 4. SEO and syndication

`Person` JSON-LD on the developer hub, `BlogPosting` JSON-LD and a generated Open Graph card per
post, the feeds linked from `<head>`, blog index and posts in the sitemap — all through the same
`seo.ts`/`og-card.ts` as the app pages.

### 5. A theme, so a site can look like its author

`theme.accent` (a hex colour, or `{ light, dark }`) sets the accent; `theme.displayFont` is a
woff2 file **from the consumer's repo**, copied content-hashed into the assets and used for
headings — the package ships no fonts and loads none from a CDN; `theme.imageRendering:
"pixelated"` keeps pixel art crisp in CSS and makes the build scale with nearest-neighbour instead
of a smoothing filter. Without a theme a site looks exactly as before.

### 6. One layout for every page kind

Head, top bar and footer move out of `render/pages.ts` into one layout module driven by a small
"shell" (languages, brand, colours, legal links). App pages, blog pages and developer pages render
through it, so a fix to the head or the footer lands on all of them.

### 7. `--overview` is removed

Not deprecated: it has no consumer, and the developer page renders everything it did (the apps,
the support entries) from the same sources. `buildOverview`, `OverviewConfig`,
`render/overview.ts` and the CLI flag go.

## Consequences

- One developer site and N app sites share a look, a footer and a support path, and cross-link
  through `app.json` — adding an app to the hub is adding its URL.
- Blog posts are reviewed, versioned and deployed like code; there is no editor UI, by design.
- The JSON Resume subset is a published contract: a field read today cannot silently change
  meaning later.
- `SiteConfig` consumers that read `metainfo` must narrow on the union first.

## Alternatives rejected

- **A separate package for the developer page.** It would need the head, the layout, the SEO,
  the i18n sync and the related-app loader — all of `@gjsify/site` but the metainfo reader.
- **A hand-rolled CV schema.** JSON Resume already exists, has themes and exporters, and a
  developer can reuse the file elsewhere.
- **A general static-site generator (Astro, Eleventy) for the developer site.** Then the developer
  page and the app pages are two designs again — the drift ADR 0109 exists to remove.
- **Tag pages in HTML.** Per-tag feeds serve the aggregator use case; tag pages add URLs nobody
  asked for. Easy to add later from the same index.

## Implementation

`packages/infra/site`: `site-data/config.ts` (union), `site-data/resume.ts`, `site-data/blog.ts`
(+ frontmatter), `render/layout.ts`, `render/developer.ts`, `render/blog.ts`, `render/feed.ts`,
`render/markdown.ts` (extension), `render/seo.ts`, `render/image-backend.ts` (nearest-neighbour),
`styles/site.css`, `cli.ts` (`--drafts`, no `--overview`).
