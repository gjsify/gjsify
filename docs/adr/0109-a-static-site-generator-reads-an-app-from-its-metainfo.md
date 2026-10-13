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

The package also has a property no other `packages/infra` package has: it needs
[sharp](https://sharp.pixelplumbing.com/) for the AVIF/WebP renditions, a native Node addon with no
GJS path.

## Decision

1. **A new package, `@gjsify/site`, in `packages/infra/`**, tier 2. It is a build-time tool for
   repositories in this family, like `vite-plugin-gettext` beside it — not a Node or Web API, so
   neither pillar fits.
2. **The page is derived, never authored.** The input is one `gjsify.site` block in the consumer's
   root `package.json`, pointing at the metainfo; the generator reads the app from there. Where a
   value cannot be derived (Flathub id, extra download targets, support links) the config carries
   it, and where it is absent nothing is invented — no placeholder donate button, no stock
   screenshot caption.
3. **Its own `bin` (`gjsify-site`), not a `gjsify site` subcommand.** `@gjsify/cli`'s dependencies
   all land in the GJS bundle `dist/cli.gjs.mjs`; `sharp` cannot. Making this a subcommand would
   either break that bundle or force a lazy-require escape hatch into the one package whose job is
   to be bundleable. The site build is a Node-only step in a Node-only toolchain, so it gets a
   Node-only entry point.
4. **No bundler in a site build.** The client bundle and the stylesheet are built once, at package
   build time, into `lib/client/`. A site build content-hashes them and copies them to
   `<out>/assets/site-<hash8>.{js,css}`. A consumer therefore needs no Vite config, no plugin and no
   build step of its own, and the generator keeps a single seam (`ClientAssets { js, css[] }`)
   instead of a bundler integration.
5. **The config is a tagged union, validated at load.** `support` is either `{kind, url}` or
   `{kind: "sepa", name, iban, bic?, reference?}`; the `sepa` form carries no amount and its IBAN is
   checked on load — country length, alphabet, mod-97 checksum — because the failure mode of a
   wrong IBAN in an EPC QR code is a payment that silently goes nowhere. `downloads` entries are
   validated the same way: a target without a URL must say `available: false`, and is then listed
   as not yet available rather than recommended.
6. **Two catalogue layers.** The page's own strings ship in the package's `po/`. A consumer that
   needs different wording, or that configures screenshot captions of its own, points
   `gjsify.site.pageTranslations` at a directory of `<lang>.po` that overlays them. App text (name,
   summary, description, release notes) is looked up in the metainfo's `xml:lang` element first,
   then in the app's own `translations/` catalogues, then falls back to the source text.
7. **The output works without JavaScript.** Downloads, screenshots and release notes are in the
   HTML; the two web components enhance them. `/` picks a language from `navigator.languages` and,
   without JavaScript, renders a list of links.
8. **The cache is not in the package.** `cacheDir` defaults to
   `<root>/node_modules/.cache/gjsify-site` — a published package must not write into its own
   install directory, which is what the Learn6502 version's `.cache/http` did.

## Consequences

- Beifahrer and Steuererklärung get a landing page by adding a `gjsify.site` block and one
  `gjsify-site build`, with no page code of their own.
- A release API outage warns and degrades (links to the releases page, omits the counts) instead of
  failing the build.
- `sharp` enters the repository's dependency set. It is a prebuilt binary for the common platforms,
  build-time only, and no runtime package depends on it.
- Learn6502 keeps its page but will consume this package instead of its own copy; that migration is
  its own change in its own repository.
- The config schema is now a published contract: a breaking change to `gjsify.site` is a breaking
  change of `@gjsify/site`.

## Alternatives rejected

- **A `gjsify site` subcommand.** Puts `sharp` into the bundle that must not have it.
- **Keep Vite.** A consumer would need a Vite config and this package's plugin set to render a page
  that contains one script and one stylesheet.
- **A template repository to copy.** Three copies that drift, which is the state this replaces.
- **Read the app from the config alone, metainfo optional.** The metainfo is the file that is
  already correct because Flathub validates it; making it one input among many invites the page and
  the store listing to disagree.

## Implementation

`packages/infra/site/src/`: `site-data/` (config validation, metainfo, GitHub/Flathub, SEPA),
`build/` (HTML, pages, images, QR, i18n), `client/` (the two web components), `site.ts` (the
`buildSite` / `syncSiteI18n` API), `cli.ts` (argv only). Specs in `*.spec.ts` on `@gjsify/unit`,
registered through `src/test.mts`; the fixture repository is written to a temporary directory per
case, and uses the documentation IBAN `DE89370400440532013000`.
