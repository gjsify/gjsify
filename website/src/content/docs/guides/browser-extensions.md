---
title: Browser Extensions
description: Build one WebExtension for Chrome, Edge, Firefox and Safari with `gjsify webext`. You get a manifest per target, icons rendered from one SVG, locales, store zips, and a dev loop that reloads the extension in a real browser. No Node or Vite is needed for the build.
---

`gjsify webext` turns one extension source into one folder per browser. Each folder gets its
own `manifest.json`, the same bundles, your pages, icons rendered from SVG, and `_locales/`.
`gjsify webext zip` writes a zip per target for the stores. `gjsify webext dev` opens the
extension in Firefox or Chromium and rebuilds it while you edit.

The build runs wherever gjsify runs: on GJS, so a machine without Node can build an extension,
and on Node, Bun or Deno. The decision record behind the design is
[ADR 0077](https://github.com/gjsify/gjsify/blob/main/docs/adr/0077-browser-extensions-are-a-project-shape-not-a-runtime.md).

## A minimal extension

```text
my-extension/
├── package.json
├── manifest.ts
├── icons/icon.svg
├── _locales/en/messages.json
└── src/
    ├── background.ts
    ├── content.ts
    └── popup/
        ├── index.html
        ├── main.ts
        └── popup.css
```

Declare it in `package.json`:

```jsonc
{
  "name": "my-extension",
  "version": "1.0.0",
  "scripts": {
    "build": "gjsify webext build",
    "zip": "gjsify webext zip",
    "dev": "gjsify webext dev"
  },
  "gjsify": {
    "webext": {
      "targets": ["chrome-mv3", "firefox-mv2"],
      "manifest": "manifest.ts",
      "scripts": {
        "background": "src/background.ts",
        "content": "src/content.ts"
      },
      "pages": { "popup": "src/popup/index.html" },
      "icons": {
        "sources": { "icon": "icons/icon.svg" },
        "svg": ["firefox-mv2"]
      }
    }
  },
  "dependencies": { "@wxt-dev/browser": "^0.3.0" },
  "devDependencies": { "@gjsify/cli": "^0.53.0", "web-ext": "^10.0.0" }
}
```

`gjsify webext build` writes `.output/chrome-mv3/` and `.output/firefox-mv2/`:

```text
.output/chrome-mv3/                   .output/firefox-mv2/
├── manifest.json   (Manifest V3)     ├── manifest.json   (Manifest V2)
├── background.js                     ├── background.js
├── content.js                        ├── content.js
├── popup.html  popup.js  popup.css   ├── popup.html  popup.js  popup.css
├── icons/icon-16.png … icon-128.png  ├── icons/icon.svg
└── _locales/en/messages.json         └── _locales/en/messages.json
```

The example in the repository,
[`examples/web/webext-hello`](https://github.com/gjsify/gjsify/tree/main/examples/web/webext-hello),
has all of these pieces.

## The manifest is a function of the target

The manifest template is a module whose default export returns the manifest for one target:

```ts
// manifest.ts
export default (ctx) => ({
  manifest_version: ctx.manifestVersion,
  name: '__MSG_extensionName__',
  default_locale: 'en',
  icons: ctx.icons('icon'),
  ...(ctx.manifestVersion === 3
    ? { action: { default_popup: 'popup.html', default_icon: ctx.icons('icon') } }
    : { browser_action: { default_popup: 'popup.html', default_icon: ctx.icons('icon') } }),
  background:
    ctx.manifestVersion === 3 && ctx.browser !== 'firefox'
      ? { service_worker: 'background.js' }
      : { scripts: ['background.js'] },
  content_scripts: [{ matches: ['https://*/*'], js: ['content.js'] }],
});
```

`ctx` holds:

| Field | Value |
|---|---|
| `target` | The target name, e.g. `firefox-mv2` |
| `browser` | `chrome`, `edge`, `firefox` or `safari` |
| `manifestVersion` | `2` or `3` |
| `mode` | `production`, or `development` under `webext dev` |
| `version` | `package.json#version`. It is also filled in when the manifest sets none |
| `define` | The effective `define` map |
| `icons(name)` | The `{ "16": path, … }` map for a declared icon, as this target receives it |

A plain `manifest.json` works too. Per-target differences then go in a `$targets` block. Objects
there are merged into the base, arrays replace the base value, and `null` deletes a key:

```jsonc
{
  "manifest_version": 3,
  "action": { "default_popup": "popup.html" },
  "background": { "service_worker": "background.js" },
  "$targets": {
    "firefox-mv2": {
      "manifest_version": 2,
      "action": null,
      "browser_action": { "default_popup": "popup.html" },
      "background": { "service_worker": null, "scripts": ["background.js"] }
    }
  }
}
```

**gjsify converts no keys between Manifest V2 and V3.** WXT does. Here the difference is written
where you can read it. The build checks the result for each target before it writes a zip, and
stops naming the target when:

- `manifest_version` does not match the target,
- the manifest names a file the build did not write (a background script, a content script, a
  popup, an options page, an icon, a web-accessible resource), or
- `default_locale` and `_locales/` do not come together. Chrome refuses to load an extension
  with only one of the two.

## What goes where

| Key | Meaning |
|---|---|
| `targets` | `<browser>-mv<2\|3>`. Default `["chrome-mv3", "firefox-mv3"]`. `chrome-mv2` and `edge-mv2` do not exist any more |
| `manifest` | `.ts`/`.mts`/`.js`/`.mjs` module or `.json`. Default: the first `manifest.*` at the package root |
| `scripts` | Output name → entry. Each is bundled as a classic **IIFE** script, `<name>.js`. An IIFE runs as a content script, an injected file, an MV2 background script and an MV3 service worker |
| `pages` | Output name → HTML file. Each local `<script src>` is bundled: a `type="module"` script as ESM and a classic one as IIFE. The first becomes `<name>.js`. Each local `<link rel="stylesheet">` is copied by its file name. The rest of the page stays as written |
| `icons.sources` | Icon name → SVG, or `{ "default": "big.svg", "32": "small.svg" }` to draw sizes up to 32 px from a simpler SVG |
| `icons.sizes` | PNG sizes. Default `[16, 32, 48, 128]` |
| `icons.svg` | Targets that get the SVG files instead of PNGs. Firefox draws SVG sharply at every size, and Chromium does not accept SVG in these keys |
| `public` | Copied into every target unchanged. Default `public/` if it exists |
| `locales` | Copied to `_locales/`. Default `_locales/` if it exists |
| `outDir` | Default `.output`. `dev` writes to `<outDir>-dev` |
| `name` | Zip base name: `<name>-<version>-<target>.zip`. Default: the package name without its scope |
| `define` | Compile-time constants for every bundle; `--define` adds to them |
| `watch` | Extra directories `dev` watches, for example a shared package outside this one |
| `minify` | `false` keeps production bundles readable. Store reviewers read them |

Icons render through librsvg in a `gjs` child process, the same renderer `gjsify ship` uses for app
icons. You need `gjs` with the Rsvg typelib: `dnf install gjs librsvg2`,
`apt install gjs gir1.2-rsvg-2.0`, or `brew install gjs librsvg gobject-introspection`. A host
without it can ship ready-made PNGs from `public/` and leave `icons` out.

`gjsify.webext` is checked by the `webext` conformance rule too: an unknown target or a path
that does not exist fails there before anything is built.

## The `browser` global

Firefox and Safari expose `browser.*` and Chromium exposes `chrome.*`. With Manifest V3 both
return promises. [`@wxt-dev/browser`](https://www.npmjs.com/package/@wxt-dev/browser) picks
whichever exists and brings the types:

```ts
import { browser } from '@wxt-dev/browser';

browser.runtime.onMessage.addListener((message) => { /* … */ });
```

gjsify ships no shim of its own and adds nothing to your bundles.

## The dev loop

```bash
gjsify webext dev                          # first Firefox target
gjsify webext dev --target chrome-mv3 --browser-binary /path/to/chrome-for-testing/chrome
```

`dev` builds one target in development mode, starts the browser with the extension through
[`web-ext run`](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-run),
and rebuilds when you save. web-ext notices the new files and reloads the extension.

- The rebuild overwrites files in place. Deleting the folder web-ext watches would make Firefox
  unload the extension halfway through.
- The browser profile persists under `$XDG_CACHE_HOME/gjsify/webext/<name>/<target>`, so logins and
  granted permissions survive a restart. `--profile` picks another one.
- The loop watches the package's top-level directories (except `node_modules`, dot-directories
  and the output) and the files at the package root, `manifest.ts` among them.
- Closing the browser ends the loop.

web-ext is a Node program. Add it as a dev dependency, or pass `--no-launch` and load the dev
folder yourself: in Firefox from `about:debugging` → *Load Temporary Add-on*, and in Chromium from
`chrome://extensions` → *Load unpacked*. Branded Chrome 137 and later ignore
`--load-extension`, so use Chromium or Chrome for Testing with `--browser-binary`.

## Stores

`gjsify webext zip` writes one zip per target. The entries are sorted and share one timestamp
(`SOURCE_DATE_EPOCH`, else 1980-01-01), so two zips of one build are identical and a reviewer
who rebuilds from source gets the same checksum.

| Store | Upload |
|---|---|
| Chrome Web Store, Edge Add-ons | the `chrome-mv3` (or `edge-mv3`) zip |
| addons.mozilla.org | the Firefox zip. Bundled code needs a sources archive for review |
| Safari | the Safari folder, wrapped by Xcode's `safari-web-extension-converter` on macOS |

Signing and submitting from the command line (`gjsify webext sign` for AMO, `gjsify webext
submit` for AMO, the Chrome Web Store and Edge) is the next step on the roadmap. Until then,
`web-ext sign` signs a Firefox build, and the other stores take the zip through their dashboards.
Safari packaging needs a Mac with Xcode, and no other host can do it.

## Compared with WXT

gjsify builds the extension. It adds no framework on top of it:

- Entrypoints are declared in `package.json`, not discovered from file names.
- No MV2/MV3 key conversion, no auto-imports, no runtime helpers, no injected polyfill.
- No dev server with hot module replacement. You get a rebuild and a reload.
- The UI frameworks and JSX setups `gjsify build` already handles work in extension pages
  unchanged.
