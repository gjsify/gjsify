# @gjsify/site

Static landing page generator for a GNOME-style app. Everything on the page comes from files the
project already has — the AppStream metainfo, the root `package.json`, the app's gettext
catalogues, a screenshot directory — plus, at build time, the GitHub release and Flathub APIs.
Nothing about any particular app is compiled in: all app-specific values come from a
`gjsify.site` block.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS
(GNOME JavaScript).

The output works without JavaScript. Two small web components (`<app-download>`,
`<screenshot-carousel>`) only enhance what is already in the HTML.

## Installation

```bash
gjsify install -D @gjsify/site

# npm or yarn also work:
npm install -D @gjsify/site
```

Runs on whichever runtime your `gjsify` runs on — GJS, Node, Bun or Deno. The screenshot
renditions go through GdkPixbuf, reached natively under GJS and through
[`@gjsify/node-gi`](../../node-gi/node-gi) otherwise, so add that package if you build the page on
Node, Bun or Deno. A site build also needs the gdk-pixbuf AVIF and WebP loaders, which current
GNOME ships; if one is missing the build says so and names the format.

## Use

```sh
gjsify site build                       # render ./dist from ./package.json's gjsify.site
gjsify site build --root <repo> --out <dir>
gjsify site i18n                        # update the page catalogues of <root>
gjsify site i18n --check                # fail instead of writing
gjsify site build --runtime node        # build and run on a specific runtime
```

| Option | Meaning |
| --- | --- |
| `--root <path>` | Repository to work on — a checkout whose root `package.json` has `gjsify.site`. Default: the working directory. |
| `--out <dir>` | Output directory, emptied first. Default: `<root>/dist`. |
| `--offline` | Skip every network call. The page then links to the releases page and omits the counts. |
| `--no-cache` | Ignore the one-hour HTTP response cache. |
| `--cache-dir <dir>` | Where the response cache and the image renditions live. Default: `<root>/node_modules/.cache/gjsify-site`. |
| `--check` | `i18n`: report what is out of date instead of writing it. |
| `--runtime <r>` | `gjs` \| `node` \| `bun` \| `deno`. Default: the runtime the CLI itself is on. |

`GITHUB_TOKEN` is optional and only raises the API rate limit. When a lookup fails the build
warns rather than failing: a release API outage is not a reason to have no page.

The same thing from a script:

```ts
import { buildSite, syncSiteI18n } from '@gjsify/site';

const { languages, screenshots } = await buildSite({ root, out, warn: console.warn });
```

## `gjsify.site`

Lives in the root `package.json`, next to `ship` and `flatpak`.

| Key | Meaning |
| --- | --- |
| `metainfo` | AppStream file, relative to the repo root. Source of name, summary, description, releases, URLs, branding, keywords, age rating. |
| `base` / `url` | URL path the site is served under, and its absolute origin + path (canonical, `hreflang`, `og:image`). |
| `languages` / `defaultLanguage` / `sourceLanguage` | Languages to render (`/en/`, `/de/`). `defaultLanguage` is where `/` lands when the visitor's languages match none (default: the first). `sourceLanguage` is the language of the metainfo's untranslated text (default `en`); the others are looked up in `translations`. |
| `repository` | `owner/name`; release assets and counts come from its latest GitHub release. |
| `flathub` | Flathub app id: adds the Flathub download and install count. Optional. |
| `webApp` | Path of a web app below `base`; adds "Try in browser". Optional. |
| `translations` | Directory of the app's `<lang>.po` catalogues, used when the metainfo lacks a translation. Optional. |
| `pageTranslations` | Directory of `<lang>.po` catalogues for the *page's own* strings, overlaying this package's `po/`. Optional, see below. |
| `icon` | Icon (SVG or PNG) for the header, hero and favicon; overrides the Flatpak/ship icon. Optional. |
| `downloads` | `[{platform, format, url?, label?, available?}]`: targets the release assets do not cover, e.g. browser stores or a source install. `platform` is an OS or `firefox` / `chromium`; `format` adds `store`, `xpi`, `source`. `url` is required unless `available` is `false`, which lists the target as "Not yet available" and never recommends it. |
| `releaseAssets` | `false` ignores the GitHub release assets, so `downloads` is the whole list. Default `true`. |
| `support`, `legal` | `support`: `{kind, url}` links, or `{kind: "sepa", name, iban, bic?, reference?}`, a bank transfer shown as IBAN plus an EPC QR code. `legal`: `{label, url}` links. Both empty by default: nothing is invented. |
| `screenshots` | `{source, items}`, see below. |

A `sepa` entry carries no amount, and its IBAN is checked when the config loads — length per
country, alphabet, and the mod-97 checksum — so a typo fails the build instead of printing a QR
code that moves money nowhere.

### Screenshots

`screenshots.source` is `metainfo` (only the metainfo list), `site` (only `items`) or `merge`
(`items`, where `from` borrows the caption of that metainfo screenshot and `caption` is a msgid of
the page catalogue). Each item has `variants`: files for `desktop-light`, `desktop-dark`,
`mobile-light`, `mobile-dark`, at least one. A missing file fails the build.

A missing variant falls back to the nearest one:

| Wanted | Order tried |
| --- | --- |
| `mobile-dark` | mobile-dark, mobile-light, desktop-dark, desktop-light |
| `mobile-light` | mobile-light, mobile-dark, desktop-light, desktop-dark |
| `desktop-dark` | desktop-dark, desktop-light, mobile-dark, mobile-light |
| `desktop-light` | desktop-light, desktop-dark, mobile-light, mobile-dark |

The `<picture>` carries one `<source>` per differing variant (`max-width: 600px` and
`prefers-color-scheme`), each as AVIF, WebP and PNG at up to three widths.

## Translations

Two catalogue sets meet on the page, and they have different owners.

- **Page strings** — "Download", "Release notes", the download labels — are gettext msgids in
  English and ship with this package, in `po/`. Nothing to do to get them.
- **App text** — name, summary, description, release notes — is looked up per language: the
  metainfo's own `xml:lang` element, then `translations/<lang>.po` (msgid = the source text), then
  the source text.
- **Consumer page strings** — the captions configured under `screenshots.items`, and any page
  string a consumer wants to word differently — live in `pageTranslations`. That directory
  overlays `po/`: an entry there wins, everything else falls back. `gjsify site i18n` regenerates
  it from the strings the build can emit and warns about each one still untranslated; `--check`
  turns that into a failure for CI.

`gjsify site i18n --package` is the other mode: it syncs *this package's* `po/site.pot` and
`po/<lang>.po` from `src/build`, and is what `gjsify workspace @gjsify/site run i18n` calls. No
`xgettext` needed in either mode — the msgids are read from the sources directly.

## Development

```sh
gjsify workspace @gjsify/site build
gjsify workspace @gjsify/site check       # typecheck + catalogues in sync
gjsify workspace @gjsify/site test             # the node leg, then the gjs leg
gjsify workspace @gjsify/site test:cross-runtime  # the GI-free suites on node + bun + deno
gjsify workspace @gjsify/site test:gjs-on-node    # the image suite via @gjsify/node-gi
```

The client bundle and the stylesheet are built once, here, into `lib/client/`. A site build only
content-hashes them and copies them to `<out>/assets/site-<hash>.{js,css}`, so a consumer needs no
bundler of its own.

`src/test.mts` holds the suites that need no GI and runs anywhere — `test:cross-runtime` runs that
one bundle on node, bun and deno. `src/test.gjs.mts` adds the image suites, which need GdkPixbuf,
and is the gjs leg. `src/test.node-gi.mts` registers the image suite alone and `test:gjs-on-node`
builds it `--app node`, so the same `src/build/image-backend.ts` encodes under Node through
`@gjsify/node-gi` — which is what proves the one image backend really is one.

## Design

[ADR 0109](../../../docs/adr/0109-a-static-site-generator-reads-an-app-from-its-metainfo.md) —
why the page is derived from the metainfo, why the config is a union rather than a template, why
the entry point is a `gjsify` subcommand rather than a `bin` with a shebang, and why GdkPixbuf is
the only image backend.

## License

MIT
