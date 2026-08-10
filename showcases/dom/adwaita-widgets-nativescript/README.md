# @gjsify/example-dom-adwaita-widgets-nativescript

Native **Adwaita widgets on NativeScript-Android** — a real NativeScript app that renders Libadwaita-styled components as **real native views** (no webview), and is **MCP-drivable** by an LLM agent over the V8 CDP inspector.

It is the de-risking spike for bringing GNOME/Adwaita apps to Android (and later iOS) via NativeScript, the true-native path.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

| Target | Renderer | Showcase |
|---|---|---|
| **Android (NativeScript)** | `@gjsify/adwaita-nativescript` — real native NS views | this one |
| GTK 4 / GJS | native `Adw.*` widgets | [`adwaita-storybook`](../../gtk/adwaita-storybook) |
| Browser | `@gjsify/adwaita-web` web components | [`adwaita-storybook`](../../gtk/adwaita-storybook) (`build:web`) |

The stack it exercises:

- **`@gjsify/adwaita-nativescript`** — `AdwPreferencesGroup` / `AdwActionRow` / `AdwSwitchRow` built on native NS `StackLayout` / `GridLayout` / `Switch` / `Label`, styled with the Adwaita CSS theme + Adwaita Sans font. The agent's introspection sees the actual Adwaita widget tree (`AdwSwitchRow`), not a DOM.
- **`@gjsify/devtools-nativescript`** — an in-app agent (`globalThis.__adwDevtools`) reusing the transport-agnostic `@gjsify/devtools-protocol` method registry; the host-side `@gjsify/devtools-mcp` `nativescriptProfile` reaches it over the V8 CDP inspector (`Runtime.evaluate`) to `dump_tree` / `screenshot` / `get_property`.

The widget tree is built **programmatically** in `app/home/home-page.ts` (the spike validates native rendering + native-tree introspection without the XML `registerElement` path).

## Version line

Targets the **`@nativescript/vite` 8.x** line (Vite 8 / Rolldown / HMR) with the NS **9.1.0-alpha** runtime — `@gjsify/nativescript-vite` auto-detects the major and skips its Vite-8 compatibility patches (upstream handles Vite 8 / Rolldown natively on 8.x). Falls back cleanly to the 9.0.x / `@nativescript/vite@2` line.

## Prerequisites

The Android SDK, an emulator or device, and the NativeScript CLI prerequisites — see the [NativeScript setup docs](https://docs.nativescript.org/setup/). This project is excluded from the root `workspaces` glob (its NativeScript toolchain must not be pulled into every `gjsify install`); the `@gjsify/*` packages resolve from the hoisted workspace `node_modules`.

## Run

```bash
# Boot an Android emulator / connect a device first, then:
nativescript run android            # build + deploy + run (Vite 8 / Rolldown)
nativescript debug android          # same + serve the V8 CDP inspector for the MCP agent
```

## Drive it with an agent

With `nativescript debug android` running (the in-app devtools agent is force-enabled in `app/app.ts`), point the gjsify MCP bridge at the inspector:

```bash
gjsify debug --profile nativescript   # bridges the V8 inspector → MCP tools
# agent tools: get_status · list_toplevels · dump_tree · get_property · screenshot
```

## What it demonstrates

- Libadwaita-styled widgets rendering as **real native Android views** — the same design language as GTK/Adwaita, no webview and no DOM
- One shared widget vocabulary across renderers: an `AdwSwitchRow` on NativeScript is the same contract as the GTK and web ones
- The Adwaita CSS theme + Adwaita Sans fonts applied to native NS views
- The gjsify devtools protocol reaching a **third** transport: DBus on GJS, the V8 CDP inspector on NativeScript — one `@gjsify/devtools-protocol` method registry behind both
- An LLM agent inspecting and screenshotting a running Android app over MCP (`dump_tree` sees `AdwSwitchRow`, not a view-hierarchy dump)
- `@gjsify/nativescript-vite` building an NS app on the Vite 8 / Rolldown line, with version auto-detection across the 8.x and 9.0.x lines

## Layout

```
app/
  app.ts               entry — Application.run({ moduleName: 'app-root' }) + devtools agent
  app-root.xml         <Frame defaultPage="home/home-page" />
  home/home-page.*     the Adwaita widget tree, built programmatically
  app.css              @nativescript/theme + adwaita.css + fonts
  adwaita.css          widget theme (from @gjsify/adwaita-nativescript)
  fonts/               Adwaita Sans TTFs
App_Resources/         Android + iOS platform resources
nativescript.config.ts bundler: 'vite'
vite.config.ts         @gjsify/nativescript-vite defineNativescriptConfig()
```

## Related

- [`@gjsify/adwaita-nativescript`](../../../packages/nativescript-bridge/adwaita) — the native Adwaita widget set
- [`@gjsify/devtools-nativescript`](../../../packages/nativescript-bridge/devtools) — the in-app devtools agent
- [`@gjsify/devtools-protocol`](../../../packages/framework/devtools-protocol) — the transport-agnostic method registry both bridges share
- [`@gjsify/nativescript-vite`](../../../packages/infra/nativescript-vite) — the Vite 8 / Rolldown NativeScript build
- [`adwaita-storybook-nativescript`](../adwaita-storybook-nativescript) — the full 35-story storybook on this widget set
- [`three-geometry-teapot-nativescript`](../three-geometry-teapot-nativescript) — the WebGL/three.js NativeScript target

## License

MIT
