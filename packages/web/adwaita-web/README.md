# @gjsify/adwaita-web

Browser Adwaita UI components as Custom Elements, bringing the Libadwaita look (light/dark) to the web with no GJS dependencies. Provides `AdwWindow`, `AdwHeaderBar`, `AdwButton`, `AdwEntry`, `AdwPreferencesGroup`, `AdwCard`, `AdwSwitchRow`, `AdwComboRow`, `AdwSpinRow`, `AdwToastOverlay`, and `AdwOverlaySplitView` (plus a `.adw-linked` button-group helper), backed by SCSS that mirrors the upstream `refs/adwaita-web` and `refs/libadwaita` color/sizing tokens.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/adwaita-web

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/adwaita-web
yarn add @gjsify/adwaita-web
```

## Usage

```typescript
// Registers all custom elements, loads Adwaita fonts, and self-applies the
// compiled stylesheet — this one import is all you need.
import '@gjsify/adwaita-web';
```

> The stylesheet is injected on import, so a separate `import '@gjsify/adwaita-web/style.css'` is not required (and under a bundler with its own CSS pipeline it injects the same rules twice). The compiled CSS is still exported at `@gjsify/adwaita-web/style.css` if you prefer a static `<link>` with no JS injection.

```html
<adw-window>
  <adw-header-bar slot="header">
    <span slot="title">My App</span>
  </adw-header-bar>
  <adw-preferences-group title="Settings">
    <adw-switch-row title="Dark mode"></adw-switch-row>
  </adw-preferences-group>
</adw-window>
```

The package entry is TypeScript (`src/index.ts`), consumed via a
TypeScript-compiling build — `gjsify build --app browser` / the `gjsifyBrowser()`
Vite preset (or any Vite/bundler setup). Type declarations are shipped
pre-built at `lib/types/index.d.ts`, so `gjsify tsc` consumers resolve the
package's types without compiling its source.

## Theming a page without `<adw-window>`

The components read their colours from the `--window-*` CSS custom properties,
but only `<adw-window>` paints the window surface. A page that lays out rows or
cards directly on `<body>` (no window chrome) therefore renders on the browser
default and its native controls ignore the dark scheme. Opt into the Adwaita
surface + light/dark `color-scheme` by adding the `adw-root` class to `<body>`
(or the `:root`/`<html>` element):

```html
<body class="adw-root">
  <adw-preferences-group title="Settings">
    <adw-switch-row title="Dark mode"></adw-switch-row>
  </adw-preferences-group>
</body>
```

`adw-root` is opt-in and additive — it binds `--window-bg-color` /
`--window-fg-color` + `color-scheme: light dark` to the page and changes nothing
about the individual components.

## Source-code editor (`adw-source-view`)

An Adwaita-styled source editor — the web twin of GtkSourceView — is available as
an **opt-in subpath** so its CodeMirror dependency never bloats the core bundle:

```typescript
import '@gjsify/adwaita-web';              // app chrome (theme variables, fonts)
import '@gjsify/adwaita-web/source-view';  // registers <adw-source-view>
```

```html
<!-- Editable 6502 editor with a line-number gutter and a copy button -->
<adw-source-view line-numbers editable copyable style="height: 260px"></adw-source-view>

<!-- Read-only hex monitor: the gutter renders 4-digit hex addresses -->
<adw-source-view
  line-numbers hex-addresses line-number-start="1536"
  readonly copyable language=""></adw-source-view>
```

Backed by CodeMirror 6, it maps 1:1 onto the `common-ui` `SourceViewWidget`
interface: `code`, `editable`/`readonly`, `selectable`, `lineNumbers`,
`lineNumberStart`, `copyable`, `copyButtonIcon`, `copyButtonTooltip`, plus a
`hexAddresses` gutter mode (hex-address line numbers for the monitor / hexdump /
disassembled panes) and a `language` toggle (`6502` enables 6502-assembly syntax
highlighting; empty = plain text). It ships an Adwaita CodeMirror theme mapped to
the same CSS variables, so it follows light + dark automatically. Edits emit a
`code-changed` `CustomEvent` (programmatic `.code =` is suppressed for two-way
binding), the copy button copies the buffer (whitespace-stripped in hex mode),
and the widget is pinned LTR regardless of page direction.

## License

MIT
