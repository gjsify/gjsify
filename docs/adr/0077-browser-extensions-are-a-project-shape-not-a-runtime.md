# 77. Browser extensions are a project shape gjsify builds, not a new runtime

- Status: **Accepted**
- Date: 2026-09-25
- Deciders: Pascal Garber
- Related: [ADR 0024](0024-ship-installable-artifacts.md) (the rasterizer and the ZIP writer
  this reuses), ADR 0076 in #1812 (`gjsify exec`, which moves `web-ext` off Node), `packages/infra/cli/src/commands/webext/`,
  `packages/infra/cli/src/utils/webext/`, `examples/web/webext-hello/`

## Context

A WebExtension is a folder: a `manifest.json`, some scripts, some HTML pages, icons, and
optionally `_locales/`. Each browser wants a slightly different folder (Chrome needs Manifest V3
and PNG icons, Firefox takes MV2 or MV3 and draws SVG icons, Safari wraps the folder in an Xcode
project), and each store wants that folder as a zip.

The first consumer is [beifahrer](https://github.com/JumpLink/beifahrer), a WebExtension that lets
an agent work in the person's own browser. It started on [WXT](https://wxt.dev), which runs on Vite,
which runs on Node. beifahrer's own ADR 0002 records why it left: bundling the WXT CLI for GJS
already fails at bundle time, and behind that sit Vite's native rolldown binding, jiti's runtime
TypeScript loading and a file watcher, all of which would be gjsify core work. It replaced WXT with
about 450 lines on GJS:

- `scripts/build.ts`: every script bundled once with `gjsify build --app browser --format iife`,
  the same bundle copied into each target, the manifest generated per target from
  `manifest.ts`, the pages' `<script src>` rewritten, and zips written with `fflate`.
- `scripts/icons.ts`: one SVG rendered to every PNG size Chromium wants, through librsvg on GJS.
- `scripts/dev.ts`: poll the sources, rebuild in place, and run `web-ext run` with a persistent
  profile. Rebuilding in place matters: deleting the directory `web-ext` watches makes Firefox
  unload the extension mid-rebuild.
- `scripts/sign.sh`: `web-ext sign --channel unlisted` for AMO.

None of that is specific to beifahrer except the list of entries, the manifest and the icon
variants. The owner wants the extension in every store and tested in every browser on Linux,
Windows and macOS. gjsify already runs on all three, so a second extension should not have to
copy those 450 lines.

What gjsify already has, measured against the sources before designing:

- `--app browser` routes every `@gjsify/*` slot to its browser entry. An extension's scripts run
  in a browser engine, so this is the target they need. The per-entry output format (`--format
  iife`) is already a flag.
- `utils/ship/icons.ts` has `rasterizeSvg`: librsvg through a `gjs -c` child, which works the same
  whether the CLI runs on GJS or on Node, is deterministic across hosts (one sha256 on the
  workstation and in CI), and checks every PNG's IHDR against the requested size.
- `utils/ship/zip.ts` has a deterministic STORE ZIP writer that execs nothing.
- `utils/watch-loop.ts` has the `fs.watch` → in-process rebuild loop `gjsify dev` and
  `gjsify storybook --watch` share, with the three things a supervising command owes on GJS.

## Decision

### 1. A command group, `gjsify webext`, and no new `--app` target

```
gjsify webext build [--target <t>..] [--out-dir <d>] [--define K=V..] [--mode production|development]
gjsify webext zip   [--target <t>..] [--out-dir <d>] [--define K=V..]
gjsify webext dev   [--target <t>] [--out-dir <d>] [--no-launch] [--browser-binary <path>]
                    [--profile <dir>] [--headless]
```

**No `--app webextension`.** The build target answers one question: which runtime entry each
`@gjsify/*` package resolves to. An extension's background, content scripts and pages all run in
the browser, and `--app browser` already routes every slot there. What differs from a web app is
the output format per entry and the folder around the bundles, and both are project concerns. A
fifth `--app` value would be a copy of `browser`, and the alias layer, the slot audit and every
`--app` switch in the CLI would have to learn it.

**Named `webext`, not `extension`.** gjsify's home is GNOME, and a GNOME Shell extension is the
other thing "extension" means there. `webext` is also Mozilla's word for the same thing
(`web-ext`), so someone moving from it recognises it.

### 2. Configuration lives in `package.json#gjsify.webext`

```jsonc
{
  "gjsify": {
    "webext": {
      "name": "hello",                          // zip base name; default: package name without scope
      "targets": ["chrome-mv3", "firefox-mv2"], // default: ["chrome-mv3", "firefox-mv3"]
      "manifest": "manifest.ts",                // .ts/.mts/.js/.mjs module or .json
      "scripts": { "background": "src/background.ts", "content": "src/content.ts" },
      "pages": { "popup": "src/popup/index.html" },
      "icons": {
        "sizes": [16, 32, 48, 128],
        "sources": { "icon": "icons/icon.svg", "idle": { "default": "icons/idle.svg", "32": "icons/idle-small.svg" } },
        "svg": ["firefox-mv2"]                   // targets that get the SVG files instead of PNGs
      },
      "public": "public",                       // copied verbatim into every target
      "locales": "_locales",                    // copied to _locales/ and checked against default_locale
      "outDir": ".output",
      "define": { "__API__": "\"https://example.org\"" },
      "watch": ["../shared/src"]                // extra directories `dev` watches
    }
  }
}
```

A declared `gjsify.*` key needs a conformance rule (the `field-coverage` rule fails otherwise),
so `@gjsify/manifest-conformance` gets a portable `webext` rule. It checks what can be checked
without building: the targets exist in the vocabulary, and every file the block names exists.

**Targets are `<browser>-mv<2|3>`**, with browser one of `chrome`, `edge`, `firefox`, `safari`.
`chrome-mv2` and `edge-mv2` are refused, because both browsers have removed Manifest V2. Edge is
Chromium, so `edge-mv3` exists only so a project can give Edge its own manifest (for example a
different `update_url`) and its own zip.

### 3. The manifest is a function of the target, and gjsify does not convert keys

The manifest template is either:

- a module whose default export is an object or a function
  `(ctx) => manifest`, where `ctx` is `{ target, browser, manifestVersion, mode, version, define,
  icons(name) }`. `icons(name)` returns the `{ "16": path, … }` map for that icon on this target:
  PNG paths on a PNG target and SVG paths on an SVG target, so the manifest never spells a path
  the build did not write. The module is bundled for the host the CLI runs on, the way
  `gjsify.config.js` already is.
- a `.json` file, with an optional `"$targets": { "<target>": { … } }` block that is deep-merged
  over the base for that target. A `null` value deletes a key. Arrays replace, never concatenate.

`version` is filled from `package.json` when the manifest does not set one.

**gjsify does not translate MV3 keys into MV2 keys**, and does not add any key the author did not
write. WXT does translate (`action` to `browser_action`, `host_permissions` into `permissions`, the
`web_accessible_resources` shape, and more). beifahrer's own measurement was that its two flavours
differ in five keys, and writing them out took fewer lines than learning which keys a converter
touches. A converter also has to be kept current with two vendors' manifest changes, and when it
misses one, the result is a manifest that loads and does the wrong thing. With a function and
`manifestVersion`, the author writes the difference once, where they can see it.

What the build does check in the result, because the browser would otherwise refuse the folder
with an error that points at the manifest rather than at the build:

- `manifest_version` matches the target's.
- Every file the manifest names exists in the target folder: background service worker and
  scripts, content-script `js`/`css`, action and browser-action popups and icons, options pages,
  sidebar and devtools pages, the top-level `icons`, and web-accessible resources that are not
  globs.
- `default_locale` is set if and only if `_locales/` exists. Chrome refuses to load the extension
  in both mismatched cases.

### 4. Bundling rules

- **`scripts`** (background, content scripts, anything injected by file) are bundled as **IIFE**.
  A content script injected with `scripting.executeScript({ files })` or listed in
  `content_scripts` is a classic script. An MV2 background page loads classic scripts. An MV3
  service worker is a module only when the manifest says `"type": "module"`. An IIFE loads in all
  of them without any manifest flag, so one bundle serves every target, which is beifahrer's own
  rule.
- **`pages`** are HTML files. Every `<script src>` that points at a local source file is bundled
  and the tag rewritten to the output file: a `type="module"` tag stays a module (bundled as ESM)
  and a classic tag stays classic (bundled as IIFE). A page's first script is written as
  `<page>.js`, and any further scripts as `<page>-2.js` and so on. Every local
  `<link rel="stylesheet" href>` is copied to the target root under its base name and the `href`
  rewritten. The rest of the page, inline `<style>` included, is left alone.
- Every bundle is built once, into a staging directory, and copied into each target. Only the
  manifest and the icon files differ between targets.
- `define` (from the config, then `--define`) reaches every bundle. This is how beifahrer's E2E
  build gets its pairing seed: `gjsify webext build --define __E2E_SEED__='…' --out-dir .output-e2e`.

### 5. The `browser` global: gjsify ships no shim

Chromium exposes `chrome.*` and Firefox and Safari expose `browser.*`, and since MV3 Chromium's
`chrome.*` returns promises too. What is left to bridge is the name. `@wxt-dev/browser` does that
in four lines (`globalThis.browser?.runtime?.id ? globalThis.browser : globalThis.chrome`) plus
generated types, it is MIT-licensed, it is published on its own, and beifahrer already uses it.
Mozilla's `webextension-polyfill` solves the older problem of callback-style `chrome.*`, which MV3
has removed.

So gjsify does not add an `@gjsify/webextension` package and does not alias anything for the
extension build. A gjsify shim would be a new npm name, and gjsify would then have to keep its
types current against two vendors' APIs, all for a four-line function that already exists. The
docs point to `@wxt-dev/browser`.

### 6. The dev loop: watch, rebuild in place, and let `web-ext` reload

`gjsify webext dev` builds one target (`--target`, else the first configured Firefox target, else the
first target) into `<outDir>-dev/<target>` in **development** mode (`ctx.mode` is `"development"`, and
bundles are not minified), then:

1. After the **first successful** build, it starts `web-ext run --source-dir <that folder>` with a
   persistent profile under `$XDG_CACHE_HOME/gjsify/webext/<name>/<target>/` (its parent created
   first, because web-ext only creates the last segment), `--keep-profile-changes`, and for a
   Chromium target `--target chromium` plus `--chromium-binary` when given. `web-ext` watches that
   folder and reloads the extension itself.
2. It watches the project through the shared `runWatchLoop`, rebuilding **in place**: files are
   overwritten and never deleted, because deleting the folder `web-ext` watches makes Firefox
   unload the extension mid-rebuild (measured in beifahrer). The watched set is every top-level
   directory of the project except `node_modules`, dot-directories and the output directory,
   the project root itself non-recursively (so `manifest.ts` counts), and any `watch` entries.
   The project root is not watched recursively: on GJS, `fs.watch` with `recursive` creates one
   `Gio.FileMonitor` per directory, and `node_modules` alone is thousands of them.
3. When the browser exits, the loop stops. Ctrl+C stops both.

`--no-launch` is the same loop without a browser. The e2e suite uses it, and so does anyone who
loads the folder by hand.

**web-ext is a Node program today.** `dev` runs the project's own `node_modules/.bin/web-ext`,
then one on `PATH`, and if neither exists it refuses, says how to install it and suggests
`--no-launch`. When `gjsify exec` (ADR 0076) lands, the same spawn goes through it and a GJS-only
host can run the dev loop. That is one call site in `utils/webext/launch.ts`.

### 7. Zip now, sign and submit next

`gjsify webext zip` runs the production build and writes
`<outDir>/<name>-<version>-<target>.zip` per target with the in-tree STORE writer. Entries are
sorted and stamped with `SOURCE_DATE_EPOCH`, or 1980-01-01 when that is unset, so two zips of one
build are byte-identical. A reviewer can then rebuild from source and compare checksums.

The **second slice** is `gjsify webext sign` and `gjsify webext submit`, one backend per store,
with credentials from the environment and never from the config:

| Store | Mechanism | Needs |
|---|---|---|
| AMO, unlisted | the AMO v5 API (what `web-ext sign --channel unlisted` calls); returns a signed `.xpi` | JWT issuer + secret |
| AMO, listed | the same API with `channel=listed`, plus a **sources zip**, because AMO reviewers must be able to rebuild bundled code | the same, plus a sources archive the command assembles from git |
| Chrome Web Store | the Web Store API: upload, then publish | OAuth client ID, secret and refresh token |
| Edge Add-ons | the Microsoft Edge Add-ons API: upload, then publish | client ID + API key |
| Safari | `xcrun safari-web-extension-converter` produces an Xcode project wrapping the folder; `xcodebuild`, sign, notarize, then the App Store | **macOS with Xcode**; cannot run anywhere else |

Safari is where "runs anywhere gjsify runs" stops. The folder builds on any host. Wrapping it in
an app is Apple's toolchain, and signing it needs an Apple identity, the same boundary ADR 0024's
darwin signing records. `webext build --target safari-mv3` works today. The Safari packaging step
will refuse off macOS by name, the way `ship`'s `finishOn` refuses a format on the wrong host.

### 8. Cross-OS

| Step | Linux | macOS | Windows |
|---|---|---|---|
| bundle, pages, manifest, locales, zip | GJS or Node, measured | GJS (Homebrew) or Node, not measured yet | GJS (MSYS2) or Node, not measured yet |
| icons from SVG | `gjs` + librsvg, measured | `brew install gjs librsvg gobject-introspection`, same rasterizer `ship` uses on the darwin leg | needs a `gjs` with the Rsvg typelib. Without one, ship PNGs in `public/` and leave `icons` out |
| dev | web-ext (Node) now, `gjsify exec` later | same | same |
| sign/submit (next slice) | all stores except Safari | all stores | all stores except Safari |

Nothing in the build branches on the OS. Everything that does is a child process (`gjs`,
`web-ext`), and those already go through the CLI's win32-aware `spawnToCompletion`.

### What gjsify will NOT do (compared with WXT)

| WXT | gjsify |
|---|---|
| File-based entrypoints discovered from `entrypoints/` naming conventions | Entries are **declared** in `gjsify.webext`. A convention that is misread fails silently, and a declaration that is misspelled fails the conformance rule |
| MV3 → MV2 manifest conversion | None. The manifest is a function of `ctx.manifestVersion` (§ 3) |
| Vite dev server with HMR for pages | Rebuild + `web-ext` reload. Rebuilds take seconds at extension size, and a reload also resets the background, which HMR does not |
| Auto-imports, a module system, runtime helpers (`defineBackground`, `storage` wrapper, `createShadowRootUi`) | None. An extension imports what it uses, and runtime helpers are libraries, not build tooling |
| `browser` polyfill injected | None (§ 5); use `@wxt-dev/browser` |
| Framework modules (React/Vue/Svelte) | Whatever `gjsify build` already compiles (`@gjsify/rolldown-plugin-{solid,vue}`, JSX config) applies unchanged |
| Runs on Node | Runs on GJS **and** Node, and the build needs no Node at all |

## Consequences

- beifahrer can drop `scripts/build.ts`, `scripts/dev.ts` and `scripts/icons.ts` (except the icon
  *variant* derivation, which is its own design choice: it commits the four variants as SVG files
  or generates them in a pre-step) and replace its `build`/`zip`/`dev` scripts with
  `gjsify webext build|zip|dev`. `manifest.ts` gets a default export that calls its existing
  `manifestFor`.
- The CLI gets a new command group and a new `gjsify.*` key. Both are documented in the CLI
  reference and in a guide, and held by the `webext` conformance rule, unit specs and
  `tests/e2e/webext`.
- `rasterizeSvg`'s error messages now name the calling command, because they are no longer
  `ship`'s alone.
- `runWatchLoop` learns to watch a list of paths (recursive or not) with an ignore predicate.
  `gjsify dev` and `storybook` keep passing a single directory.

## Implementation status

- **Slice 1 (this ADR's PR):** `webext build`, `webext zip` and `webext dev`; the manifest
  module/JSON with `$targets`; icons; pages; `public/` and `_locales/`; the output checks in § 3;
  the `webext` conformance rule; `examples/web/webext-hello`; the guide; e2e `tests/e2e/webext`.
- **Slice 2:** `webext sign` (AMO) and `webext submit` (AMO listed with a sources zip, Chrome Web
  Store, Edge), plus types for the manifest context exported from the CLI.
- **Slice 3:** Safari packaging on macOS, and `dev` through `gjsify exec` once ADR 0076 ships.

**Parity, measured on slice 1** against a copy of beifahrer's `extension/` (its four icon
variants committed as SVG, `manifest.ts` given a default export that calls `manifestFor`): the
same file set in both targets, a byte-identical `manifest.json` in both, and one difference in
the pages, where the page script stays `type="module"` (bundled as ESM) and beifahrer made it
classic. Both targets build in 1.8 s on the GJS-hosted CLI, against 5.4 s for beifahrer's own
script, and the GJS and Node hosts produce the same folders. `webext dev` launched Firefox
through web-ext with the extension installed as a temporary add-on.
