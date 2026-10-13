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
   "copy the screenshot unresized" path; `src/build/image-backend.ts` is the single seam and the
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
`build/` (HTML, pages, images, QR, i18n, `image-backend.ts`), `client/` (the two web components),
`site.ts` (the `buildSite` / `syncSiteI18n` API), `cli.ts` (`runSiteCli`, argv only — no shebang,
no top-level run). The subcommand is `packages/infra/cli/src/commands/site.ts`.

Specs in `*.spec.ts` on `@gjsify/unit`. `src/test.mts` registers the GI-free suites and runs on
every runtime; `src/test.gjs.mts` adds `images.gjs.spec.ts`, which needs a real image backend and
builds its fixtures with GdkPixbuf itself rather than committing a PNG. The fixture repository is
written to a temporary directory per case, and uses the documentation IBAN
`DE89370400440532013000`.
