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
| `--overview <file>` | `build`: render the support overview listed in this JSON file instead of one app (see below). |
| `--root <path>` | Repository to work on — a checkout whose root `package.json` has `gjsify.site`. Default: the working directory. |
| `--out <dir>` | Output directory, emptied first. Default: `<root>/dist`. |
| `--offline` | Skip every network call. The page then links to the releases page and omits the counts. |
| `--no-cache` | Ignore the one-hour HTTP response cache. |
| `--cache-dir <dir>` | Where the response cache and the image renditions live. Default: `<root>/node_modules/.cache/gjsify-site`. |
| `--check` | `i18n`: report what is out of date instead of writing it. |
| `--runtime <r>` | `gjs` \| `node` \| `bun` \| `deno`. Default: the runtime the CLI itself is on. |

## Support pages and SEO

With `gjsify.site.support` set, a build also writes `/<base><lang>/support/index.html` (title
"Support" / "Unterstützen"; the landing page's support section links to it). It needs no script:
the GiroCode, the bank details and the link cards (GitHub Sponsors, Liberapay, PayPal) are plain
markup. The transfer reference defaults to `Support <app name>`, so every app's income is
recognisable on the statement; `reference` in the `sepa` entry overrides it.

Every build also writes a 1200×630 link-preview card per language (`og-<lang>.png`, drawn as SVG
and rasterised by GdkPixbuf), `SoftwareApplication` JSON-LD, `hreflang` alternates with an
`x-default` that points at the default-language page, a valid `og:locale` (`de_DE`), and a
`sitemap.xml`. `robots.txt` is written only when `gjsify.site.base` is `/`; below a path the host
root owns it and must list this sitemap. A page title or meta description that is too short
(or only the app name) is reported as a build warning.

## Privacy pages

With `gjsify.site.privacy` set, a build also writes `/<base><lang>/privacy/index.html` and links it
from the footer of every page (title "Privacy" / "Datenschutz"). It opens with one built-in
paragraph — about visiting THIS page, which sets no cookie, runs no analytics and loads nothing
from a third-party domain, because this package adds none of those — then the consumer's own
statement of what the APP does with data, read verbatim from the file `statements[lang]` names and
rendered through a small Markdown subset (headings, paragraphs, lists, GFM tables, links, bold,
inline code; `#`/`##`/`###` render as `h2`/`h3`/`h4`, one level up, since the page already has its
own `h1`).

```json
"privacy": {
  "statements": { "en": "docs/privacy.md", "de": "docs/privacy.de.md" },
  "hostingPolicyUrl": "https://docs.github.com/en/site-policy/privacy-policies/github-privacy-statement"
}
```

**The statement is never generated**, and every configured language needs its own entry — a
missing one fails the build rather than silently showing English where a translation was promised.
This is deliberate, not a gap to close: what the APP does with data is a claim about its own code,
checked the same way `docs/store/privacy.md` already is in a consumer like Beifahrer (every
substantive line cited to a `file:line`), and an app that talks to no data only because the page
*says* so is exactly the "inaccurate privacy policy" app stores remove listings for. `@gjsify/site`
can derive the hosting paragraph because it is a fact about what THIS package ships, not about the
product — see [ADR 0109](../../../docs/adr/0109-a-static-site-generator-reads-an-app-from-its-metainfo.md)'s
amendment on why that line is drawn there. `hostingPolicyUrl` is the one hosting fact that is a
per-deployment choice rather than a package guarantee, so it is config, named only when given.

`gjsify site build --overview <file> --out <dir>` renders one page that lists several apps, each
linking to its own support page, for a host such as `jumplink.eu/support/`:

```json
{
  "url": "https://jumplink.eu/",
  "base": "/support/",
  "languages": ["en", "de"],
  "apps": ["../learn6502", "../beifahrer"]
}
```

Each `apps` entry is a repository root (relative to the file) with its own `gjsify.site` block;
its name and published address are read from there.

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
| `components` | `[{id, name, summary?, match?}]`: the separately installed parts of the product, in install order, see below. Optional — without it the dialog is one undivided list. |
| `downloads` | `[{platform, format, url?, label?, available?, component?}]`: targets the release assets do not cover, e.g. browser stores or a source install. `platform` is an OS or `firefox` / `chromium`; `format` adds `store`, `xpi`, `source`. `url` is required unless `available` is `false`, which lists the target as "Not yet available" and never recommends it. `component` is a `components[].id`. |
| `releaseAssets` | `false` ignores the GitHub release assets, so `downloads` is the whole list. Default `true`. |
| `relatedApps` | `[url \| {url, name, summary, icon}]`: sites of other apps, listed in order under "More apps by <developer>" on the landing page, see below. Optional — without it there is no section and nothing is fetched. |
| `support`, `legal` | `support`: `{kind, url}` links, or `{kind: "sepa", name, iban, bic?, reference?}`, a bank transfer shown as IBAN plus an EPC QR code. `legal`: `{label, url}` links. Both empty by default: nothing is invented. |
| `privacy` | `{statements: {<lang>: <path>}, hostingPolicyUrl?}`: a privacy page at `/<lang>/privacy/`, see below. Absent: no such page. |

A `sepa` entry carries no amount, and its IBAN is checked when the config loads — length per
country, alphabet, and the mod-97 checksum — so a typo fails the build instead of printing a QR
code that moves money nowhere.

### Components

Some products are not one download. A desktop app plus the browser extension that talks to it are
two things a person installs one after the other, and a single flat list of files does not say
which goes first. `components` names those parts:

```json
"components": [
  { "id": "app", "name": "App", "summary": "Install and start it once.", "match": "^beifahrer[-_]" },
  { "id": "extension", "name": "Browser extension", "summary": "Then add it to your browser." }
]
```

Each part becomes its own block in the download dialog, in declared order, with its own operating
system tabs — numbered "Step 1", "Step 2", … as soon as there is more than one. The tab strip is
labelled `Browser` when every target in that block is a browser, otherwise `Operating system`.

`match` is a regular expression on the asset's file name, matched case-insensitively; the first
component whose `match` hits owns the asset. A component without `match` is the catch-all and
takes everything left over, which is what a release without a naming scheme for every file needs.
Entries in `downloads` pick their block by `component` instead, naming a `components[].id` — an
unknown id fails the build with the known ids listed.

The recommendation ("Recommended for your system") is made once per part, so each block
highlights its own best match, and the big button at the top of the dialog offers the first
declared component: the thing to install first. On Linux the order is Flathub, the Flatpak
bundle, the AppImage, then deb and rpm: the Flatpak runs sandboxed on the shared GNOME runtime
and updates with it, where an AppImage trusts the host's typelibs and needs FUSE.

### Related apps

Every build also writes `app.json` next to `index.html` — `{schema: 1, id, name, summary, icon, url,
languages, developer}`, names and summaries per language from the metainfo, `icon` and `url`
absolute. `relatedApps` reads those of other sites:

```json
"relatedApps": [
  "https://example.org/notes/",
  { "url": "https://example.org/plain/", "name": "Plain", "summary": "No app.json here", "icon": "https://example.org/plain/icon.png" }
]
```

A string is a site address: the build fetches `<url>app.json` and renders a card (icon, name,
summary in the page's language, else English) linking to the app's page in that language. An
object is an inline entry for an app that publishes no `app.json`; nothing is fetched for it.
The site's own address and app id are dropped, so all apps can share one list.

The section is plain HTML rendered at build time. A site that cannot be reached, or whose
`app.json` is invalid, is served from the last good copy in the build cache; with none, that card
is skipped with a warning. The build never fails because of it.

### Screenshots

Nothing to configure: the page shows the metainfo `<screenshots>`, in document order, with their
captions — the same artwork Flathub shows, so the page doubles as a preview of the store listing.

Each `<image>` is located before it is processed. A `raw.githubusercontent.com` URL into
`repository` is read from the checkout being built, so a metainfo pinned to a tag still shows the
artwork of the working tree. Anything else is downloaded once into the build cache, which is what
makes a later `--offline` build find it again. A screenshot whose file cannot be found or fetched
is skipped with a warning naming it — one image missing beats no page.

Two things happen to the artwork:

- **Fully transparent rows and columns are cropped away.** A window shot is saved on a canvas
  large enough for the window's own shadow, and how much empty space is left around it is up to
  whoever took the shot; the page would otherwise frame that emptiness. The threshold is "not one
  pixel painted at all", so the shadow itself survives.
- **Renditions go up to 2560px and the display width is capped at 1280.** That settles what a "2×"
  source is without asking the metainfo: a 2560px screenshot fills a 1280 CSS px box at
  device-pixel-ratio 2 and stays crisp, a narrower one is shown at its natural width. Nothing is
  ever upscaled.

The `<picture>` carries AVIF, WebP and PNG, each with a `srcset` of 640px, 1280px and 2560px
renditions up to the source's own width.

### Colour

Also nothing to configure: the metainfo's `<branding>` colour for the page's scheme paints the
masthead — the bar, the icon and title, the install button, the facts row and the screenshots, all
one surface. The text on it is not assumed to be white; the build measures the brand colour's
relative luminance and writes near-black or white into `--band-fg`, whichever the eye can read.
Everything below the masthead keeps the site's own neutral palette, so a pale brand colour cannot
make the description unreadable. An app without `<branding>` gets the default blue.

## Translations

Two catalogue sets meet on the page, and they have different owners.

- **Page strings** — "Download", "Release notes", the download labels — are gettext msgids in
  English and ship with this package, in `po/`. Nothing to do to get them.
- **App text** — name, summary, description, release notes — is looked up per language: the
  metainfo's own `xml:lang` element, then `translations/<lang>.po` (msgid = the source text), then
  the source text.
- **Consumer page strings** — any page string a consumer wants to word differently — live in
  `pageTranslations`. That directory
  overlays `po/`: an entry there wins, everything else falls back. `gjsify site i18n` regenerates
  it from the strings the build can emit and warns about each one still untranslated; `--check`
  turns that into a failure for CI.

`gjsify site i18n --package` is the other mode: it syncs *this package's* `po/site.pot` and
`po/<lang>.po` from `src/render`, and is what `gjsify workspace @gjsify/site run i18n` calls. No
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
builds it `--app node`, so the same `src/render/image-backend.ts` encodes under Node through
`@gjsify/node-gi` — which is what proves the one image backend really is one.

## Design

[ADR 0109](../../../docs/adr/0109-a-static-site-generator-reads-an-app-from-its-metainfo.md) —
why the page is derived from the metainfo, why the config is a union rather than a template, why
the entry point is a `gjsify` subcommand rather than a `bin` with a shebang, and why GdkPixbuf is
the only image backend.

## License

MIT
