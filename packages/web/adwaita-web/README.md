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

## License

MIT
