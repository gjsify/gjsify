# 109. A static site generator reads an app from its metainfo

- Status: **Accepted** (2026-10-13)
- Date: 2026-10-13
- Deciders: Pascal Garber
- Related: `packages/infra/site`; moved out of Learn6502's `@learn6502/website`; the next consumers
  are Beifahrer and Steuererklärung

## Context

Every app in this family needs the same landing page: what it is, what it looks like, where to get
it, what changed in the last release, how to support it. All of that is already written down — the
AppStream metainfo carries name, summary, description, releases, URLs, branding and age rating; the
root `package.json` carries the repository and the Flatpak id; the app's gettext catalogues carry
the translations; a screenshot directory carries the images. A hand-written page restates that, and
then disagrees with it one release later.

Learn6502 built such a generator (`packages/website`) and deliberately kept the data layer
(`src/site-data/`) free of anything Learn6502-specific, so that it could move. Two more apps now
need the same page, and copying the package a second and third time is the thing this repository
exists to avoid.

The one part of the generator that is not string handling is the screenshot pipeline: decode a PNG,
check whether it carries its own transparent margin, scale it down to three widths, encode AVIF,
WebP and PNG. Learn6502's copy did that with [sharp](https://sharp.pixelplumbing.com/), a native
Node-API addon — which would have made the page build a Node-only step, in a repository whose
entire point is that the same code runs on GJS, Node, Bun and Deno.

## Decision

1. **A new package, `@gjsify/site`, in `packages/infra/`**, tier 2. It is a build-time tool for
   repositories in this family, like `vite-plugin-gettext` beside it — not a Node or Web API, so
   neither pillar fits.
2. **The page is derived, never authored.** The input is one `gjsify.site` block in the consumer's
   root `package.json`, pointing at the metainfo; the generator reads the app from there. Where a
   value cannot be derived (Flathub id, extra download targets, support links) the config carries
   it, and where it is absent nothing is invented — no placeholder donate button, no stock
   screenshot caption.
3. **The runtime is whichever runtime `gjsify` is running on — the package names none.** The entry
   point is a `gjsify site` subcommand, not a `gjsify-site` bin, because a bin has to name an
   interpreter in its shebang and would thereby pick the runtime *for* the user. The CLI already
   embodies that choice: the Linux install script bootstraps it on GJS (`install.mjs` has no win32
   branch), Windows and macOS get it through `npm install -g @gjsify/cli` under Node
   (`.github/workflows/cli-cross-platform.yml` tests exactly that), and an install through a
   runtime's own package manager runs it on that runtime — npm/Node, Bun, Deno. Inheriting the
   host runtime is the only rule that is right in all four cases. Dispatch follows
   `gjsify storybook`: the command resolves `@gjsify/site` from the **consumer's** `node_modules`,
   generates a one-line entry importing it, bundles that `--app gjs` or `--app node`, and runs it.
   That also keeps tier-1 `@gjsify/cli` free of a hard dependency on tier-2 `@gjsify/site`.
4. **One image backend for every runtime: GdkPixbuf, through `gi://GdkPixbuf?version=2.0`.** It is
   the only image library reachable from all four runtimes — natively under GJS, and through the
   `@gjsify/node-gi` reverse bridge under Node, Bun and Deno, which the bundler substitutes when
   building `--app node`. So there are no per-runtime backends and no runtime with a degraded
   "copy the screenshot unresized" path; `src/render/image-backend.ts` is the single seam and the
   rest of the build never names a library. `sharp` is not a dependency.
5. **No bundler in a site build.** The client bundle and the stylesheet are built once, at package
   build time, into `lib/client/`. A site build content-hashes them and copies them to
   `<out>/assets/site-<hash8>.{js,css}`. A consumer therefore needs no Vite config, no plugin and no
   build step of its own, and the generator keeps a single seam (`ClientAssets { js, css[] }`)
   instead of a bundler integration.
6. **The config is a tagged union, validated at load.** `support` is either `{kind, url}` or
   `{kind: "sepa", name, iban, bic?, reference?}`; the `sepa` form carries no amount and its IBAN is
   checked on load — country length, alphabet, mod-97 checksum — because the failure mode of a
   wrong IBAN in an EPC QR code is a payment that silently goes nowhere. `downloads` entries are
   validated the same way: a target without a URL must say `available: false`, and is then listed
   as not yet available rather than recommended.
7. **Two catalogue layers.** The page's own strings ship in the package's `po/`. A consumer that
   needs different wording, or that configures screenshot captions of its own, points
   `gjsify.site.pageTranslations` at a directory of `<lang>.po` that overlays them. App text (name,
   summary, description, release notes) is looked up in the metainfo's `xml:lang` element first,
   then in the app's own `translations/` catalogues, then falls back to the source text.
8. **The output works without JavaScript.** Downloads, screenshots and release notes are in the
   HTML; the two web components enhance them. `/` picks a language from `navigator.languages` and,
   without JavaScript, renders a list of links.
9. **The cache is not in the package.** `cacheDir` defaults to
   `<root>/node_modules/.cache/gjsify-site` — a published package must not write into its own
   install directory, which is what the Learn6502 version's `.cache/http` did.

## Consequences

- Beifahrer and Steuererklärung get a landing page by adding a `gjsify.site` block and one
  `gjsify site build`, with no page code of their own.
- A release API outage warns and degrades (links to the releases page, omits the counts) instead of
  failing the build.
- No native addon enters the repository's dependency set, and the one GI dependency is a library
  every GNOME system already has.
- A site build needs gdk-pixbuf loaders for AVIF and WebP. Current GNOME supplies them through
  glycin; where they are missing, `assertEncodable` names the format and lists what the system can
  write, instead of writing an empty file.
- The format set is AVIF, WebP and PNG — JPEG is deliberately absent. `save_to_bufferv('jpeg', …)`
  fails on an RGBA pixbuf ("the encoder or decoder for Jpeg does not support the color type
  `Rgba8`"), and a window screenshot is RGBA. The three formats that are there cover every browser
  the page targets, so this costs nothing.
- Running the site build on Node, Bun or Deno requires `@gjsify/node-gi` in the consuming project,
  because that is what the `gi://` import becomes there. On GJS nothing extra is needed.
- Learn6502 keeps its page but will consume this package instead of its own copy; that migration is
  its own change in its own repository.
- The config schema is now a published contract: a breaking change to `gjsify.site` is a breaking
  change of `@gjsify/site`.

## Alternatives rejected

- **A `gjsify-site` bin with a `#!/usr/bin/env node` shebang.** The first version of this ADR chose
  it, on the reasoning that `sharp` could not enter `dist/cli.gjs.mjs`. That was solving the wrong
  problem: the right move was to drop `sharp`, not to accept a Node-only tool. A shebang is a
  runtime decision taken away from the person running the command.
- **A backend per runtime** — `sharp` on Node, GdkPixbuf on GJS, behind one interface. Two
  encoders mean two sets of output bytes for the same screenshot, and the AVIF cache would depend on
  which runtime last built the page. One backend that works everywhere is strictly better than two
  that each work somewhere.
- **A pure-JS encoder.** Would run everywhere, but AVIF in JavaScript is a WASM build of the same
  C library with worse performance and an extra megabyte in the package, to replace something
  already installed on the target systems.
- **Keep Vite.** A consumer would need a Vite config and this package's plugin set to render a page
  that contains one script and one stylesheet.
- **A template repository to copy.** Three copies that drift, which is the state this replaces.
- **Read the app from the config alone, metainfo optional.** The metainfo is the file that is
  already correct because Flathub validates it; making it one input among many invites the page and
  the store listing to disagree.

## Implementation

`packages/infra/site/src/`: `site-data/` (config validation, metainfo, GitHub/Flathub, SEPA),
`render/` (HTML, pages, images, colour, QR, i18n, `image-backend.ts`), `client/` (the two web
components),
`site.ts` (the `buildSite` / `syncSiteI18n` API), `cli.ts` (`runSiteCli`, argv only — no shebang,
no top-level run). The subcommand is `packages/infra/cli/src/commands/site.ts`.

Specs in `*.spec.ts` on `@gjsify/unit`. `src/test.mts` registers the GI-free suites and runs on
every runtime; `src/test.gjs.mts` adds `images.gjs.spec.ts`, which needs a real image backend and
builds its fixtures with GdkPixbuf itself rather than committing a PNG. The fixture repository is
written to a temporary directory per case, and uses the documentation IBAN
`DE89370400440532013000`.

## Amendment (2026-10-13) — the metainfo is the only screenshot source, and `<branding>` paints the page

§2 said the page is derived and nothing is invented, but the first implementation still carried a
`gjsify.site.screenshots` block: a `source` of `metainfo` / `site` / `merge`, per-item captions, and
four variant files per screenshot (`desktop-light`, `desktop-dark`, `mobile-light`, `mobile-dark`).
That is four ways for the page to disagree with the store listing, and in practice every consumer
either shipped one image per screenshot or shipped four that differed only in window chrome.

**The config key is gone.** The screenshots are the metainfo's `<screenshots>`, in that order, with
its captions — the same images Flathub shows, so the page is also a preview of the listing. An
`<image>` whose URL points into the app's own repository
(`raw.githubusercontent.com/<repository>/<ref>/<path>`) is read from the checkout at `<path>`; any
other is downloaded and kept in the cache directory, so a later `--offline` build still finds it.
A screenshot that resolves to nothing is skipped with a warning — one unreachable image does not
fail a release build.

Three things follow, and each fixes something the old model got wrong:

1. **No viewport or scheme variants.** One image per screenshot, so `data-frame` collapsed to
   `none | undefined` and the image map is keyed by a slug derived from the URL rather than by a
   repo-relative path.
2. **Transparent margins are trimmed at build time** (`trimTransparentMargin`, alpha ≤ 1 counts as
   empty) instead of being drawn around. A GNOME window screenshot carries its shadow as
   transparent padding; the page's own frame and shadow then sat around empty space. Trimming is
   the fix that also makes `drop-shadow` unnecessary — the frame follows the window again.
3. **Nothing is ever upscaled.** Renditions are 640/1280/2560 wide, capped at the source width, and
   emitted as `srcset` with a per-picture `--shot-w` display width (max 1280 CSS px). A 2560 px
   capture is therefore sharp on a HiDPI screen and on a phone, and a 400 px one is not blown up.

**`<branding>` is now the page's colour.** The app's `<color type="primary" scheme_preference="…">`
paints the whole masthead — bar, icon, title, install button, facts row and screenshots — not just
the screenshot band, and the top bar is drawn in that same colour so that sticking is a CSS
`position: sticky` plus a scroll-driven shadow, with no script deciding when the bar detached. CSS
cannot measure a colour, so the generator does: `render/color.ts` computes WCAG 2 relative
luminance and picks near-black or white as the text colour, writing both into custom properties.
An app with no `<branding>` keeps the stylesheet's own palette; nothing is hardcoded white.

**Migration:** delete `gjsify.site.screenshots`. It is no longer read, so a leftover block is dead
config rather than an error, and the screenshots come from the metainfo either way. An app that
wants its own colour on the page adds `<branding>` to its metainfo, which Flathub reads too.

## Amendment (2026-10-14) — a support page per app, and one overview

**Support pages are generated, not a dialog.** `gjsify.site.support` now renders
`/<lang>/support/` next to the landing page: plain markup that works without JavaScript, titled
"Support" (never "Donate", because the income is business income and implies no tax deduction).
The landing page keeps its section and links to it. The bank-transfer reference defaults to
`Support <app>` so each app is told apart on the statement.

> Superseded in part by [ADR 0120](0120-a-developer-page-and-a-blog.md): `--overview` is removed;
> the developer page renders the same apps and support entries.

**The overview takes the smallest input that fits this ADR.** `gjsify site build --overview
<file>` reads a small JSON file (`url`, `base`, `languages`, `apps`), where each app is a
repository root whose own `gjsify.site` already holds its address, languages and metainfo. No
app's data is duplicated into a central list and the apps stay the source of truth.

**SEO output belongs to the build.** Open Graph cards (SVG rasterised by GdkPixbuf, no extra
dependency), `SoftwareApplication` JSON-LD, a sitemap with `hreflang` alternates and a
`robots.txt` only where the site owns the host root.

## Amendment (2026-10-23) — a privacy page, and why the website/software line it draws matters

Browser extensions and desktop apps built on this platform (Beifahrer first) need a privacy policy
URL to submit to their stores — Chrome, Edge and AMO all ask for one, and Chrome's policy is
explicit that an inaccurate one is grounds for removal. The first draft of this amendment modelled
the page on a marketing website's Datenschutzerklärung (data controller, legal basis, server logs,
cookie notice, contact form) — reasonable material for a WEBSITE that is itself the product, wrong
for a page that is only the download point for a product running somewhere else entirely. A person
reviewing it caught the category error: for an app that phones home to nobody, this package is not
a GDPR "controller" for anything the app does, and dressing an audit-style statement like
Beifahrer's `docs/store/privacy.md` (claims cited to `file:line`, no legal boilerplate because
there is no data flow to describe) in website clothing would make it say more than is true.

**Two paragraphs, two different subjects, drawn at the line §2 already names — derived vs.
invented:**

1. **Visiting this static page** is a fact about what `@gjsify/site` itself ships: no cookie, no
   analytics, no third-party resource, for every consumer, because the renderer adds none. This
   much is DERIVED from the package's own guarantee and safe to generate once, in English and
   German, in `po/`. `hostingPolicyUrl` names the one fact that still varies by deployment — which
   host's own access-log policy applies — and is config, left out rather than guessed.
2. **What the app does with data** is a claim about the APP's own code and is never generated. A
   consumer points `gjsify.site.privacy.statements[lang]` at a file it wrote and verified itself,
   one per configured language — a missing language fails the build, because a legal page quietly
   short of a promised translation is worse than no page.

**Decision.** `gjsify.site.privacy` adds `/<lang>/privacy/`: the hosting paragraph above, then the
statement file rendered through a small Markdown subset (`src/render/markdown.ts` — headings,
paragraphs, lists, GFM tables, links, bold, inline code; heading levels shift up by one, since the
page already owns an `h1`). The footer links to it automatically wherever `privacy` is configured,
the same way the support section is automatic — a second, hand-listed `legal` entry would be a
second place for the two to drift apart.

**Alternative rejected: restructure the statement into GDPR sections (Verantwortlicher,
Rechtsgrundlage, Betroffenenrechte) the way the website templates the first draft drew from do.**
Those sections answer "what does THIS WEBSITE do with a visitor's data", which is a question about
`@gjsify/site`'s own hosting, already covered by paragraph 1 — forcing an app's "nothing leaves the
device" into that shape would invent a controller relationship that does not exist, for data this
package never sees.

## Amendment (2026-10-23) — a Legal Notice / Impressum page, same shape, different question

German law raises a second, separate requirement for any site tied to a business: § 5 DDG (the
Digitale-Dienste-Gesetz, formerly § 5 TMG) requires an "Impressum" — name, address, contact —
reachable directly from the site itself, not merely linked from another domain. This is NOT the
privacy page's question. Privacy asks "what does the software do with data"; a Legal Notice asks
"who is legally responsible for this page", and the two have different authors in general (the
privacy statement is about the APP's code; the Legal Notice is about the PUBLISHER) even though
for a single-developer publisher like this project's own consumers they name the same person.

**Decision.** `gjsify.site.legalNotice` adds `/<lang>/legal-notice/`, structurally identical to
`privacy` — one statement file per configured language, read verbatim, rendered through the same
Markdown subset, linked from the footer automatically. The one deliberate difference: **no
built-in paragraph is prepended.** Privacy's hosting paragraph exists because this package can
truthfully say something about ITS OWN behaviour (no cookie, no analytics); for a Legal Notice
there is no equivalent fact this package can derive — who is legally responsible for a site is
entirely the consumer's to state, so the whole page is the consumer's own text.

**Alternative rejected: one combined "Legal" page for both privacy and the Legal Notice.** They
answer unrelated legal questions under unrelated statutes (data protection vs. telemedia
operator disclosure), are typically authored by different reasoning (code audit vs. publisher
identity) and — per the actual rollout this amendment was written for — are not even always
authored by the same amount of care at the same time: a publisher may have a verified Legal
Notice ready before a fully audited privacy statement exists for every app. Separate pages let
each ship on its own schedule.

**Alternative rejected: derive the Legal Notice content once, centrally, and inject it into every
consumer.** Tempting because the content is usually byte-identical across one publisher's apps —
same legal entity, same address. Rejected for the same reason `privacy` never generates its
statement: identical-across-apps is a fact about THIS publisher, not a guarantee `@gjsify/site` can
make for every consumer (a publisher could legitimately run several legal entities, one per app).
The package stays ignorant of that question; a consumer that wants one canonical text copies the
same file into each app's `legalNotice.statements`, same as any other cross-repo content it owns.
