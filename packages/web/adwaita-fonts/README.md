# @gjsify/adwaita-fonts

Adwaita **Sans** TTF font files plus `@font-face` CSS (fontsource-style) for browser builds. Carries the GNOME/Libadwaita typographic identity to the web, sourced from the upstream Adwaita fonts project.

Two faces ship: `adwaita-sans-400.ttf` (normal) and `adwaita-sans-400-italic.ttf` (italic). **No Adwaita Mono** — the upstream mono faces are 1.4–1.5 MB each and are not vendored here, so a `font-family: 'Adwaita Mono', …` stack resolves through this package only on a host where the typeface is installed system-wide (GNOME desktops, `adwaita-mono-fonts` on Fedora).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/adwaita-fonts

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/adwaita-fonts
yarn add @gjsify/adwaita-fonts
```

## Usage

```css
/* Import the full @font-face declaration (weight 400, normal) */
@import '@gjsify/adwaita-fonts';

/* Or import a specific weight variant directly */
@import '@gjsify/adwaita-fonts/400.css';
@import '@gjsify/adwaita-fonts/400-italic.css';
```

Both forms above resolve `src: url('./files/adwaita-sans-400.ttf')` through the consuming CSS pipeline, which emits the TTF as an asset and serves it. That is the default and it is correct wherever such a pipeline exists — Vite, webpack, a plain `<link>`.

### From JavaScript — use `./embedded`, never a side-effect import

```typescript
import { applyAdwaitaFonts } from '@gjsify/adwaita-fonts/embedded';

applyAdwaitaFonts(); // idempotent; injects a <style> with both faces
```

**`import '@gjsify/adwaita-fonts';` from JavaScript does not register anything under a bundler that turns CSS into a string** — which includes `gjsify build --app browser` and `--app gjs`. The module it produces is `export default "<css>"`; a side-effect import of a module with no side effect is tree-shaken, and the build exits 0. Measured on 0.41.0: a probe entry whose only statement is that import builds to a **0-byte bundle with zero `@font-face`**. And even when the string is kept (`import css from …`), its relative `url()` resolves against the document, while a `--app browser` build emits one file and no assets — so the rule parses and the face 404s.

`./embedded` is the form that survives both: every `src:` is a `data:` URI, and it is a **value** import, which a bundler cannot silently discard.

### The cost, and why it is opt-in

These are unsubsetted desktop TTFs, not web fonts. Base64 is 4/3 of the payload:

| | bytes | gzip -9 |
|---|---:|---:|
| `@gjsify/adwaita-web` stylesheet | 190 731 | 25 891 |
| `+` sans 400 inlined | 1 363 795 | 594 177 |
| `+` sans 400 + italic inlined | 2 577 599 | 1 205 683 |

So `@gjsify/adwaita-web` does **not** import `./embedded` from its root entry — ~600 KB gzip for a typeface that is installed system-wide on the platform it targets is the wrong default. Opt in per app, with the one line above. Importing only `ADWAITA_SANS_400_CSS` (and injecting it yourself) leaves the italic face tree-shakeable.

## License

OFL-1.1
