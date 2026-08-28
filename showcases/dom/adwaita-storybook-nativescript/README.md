# @gjsify/example-dom-adwaita-storybook-nativescript

The full **Adwaita storybook** as a real **NativeScript-Android** app — the same component browser as the native **GTK** (`@gjsify/storybook`) and **browser** (`@gjsify/adwaita-storybook`) targets, rendered with **real native** `@gjsify/adwaita-nativescript` widgets (NOT a webview) via `@gjsify/storybook-nativescript`.

All three targets share the renderer-agnostic `*.meta.ts` metadata: this app imports it from the GTK showcase's `@gjsify/example-gtk-adwaita-storybook/metas` barrel, so every story exposes identical controls on every target. What holds that together is machine-checked: `scripts/check-storybook-story-parity.mjs` fails the build when a story exists on one target and not the others, and when a target has the rendering and never registers it — `src/stories.ts` here, `src/browser/stories.ts` in the GTK showcase, and the `./metas` barrel this app imports from. There is **no screenshot-comparison harness** (#1052) — behaviour parity is held by the `@gjsify/adwaita-core/conformance` vectors both renderer suites drive their real widgets with.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

| Target | Renderer | Showcase |
|---|---|---|
| **Android (NativeScript)** | `@gjsify/storybook-nativescript` + `@gjsify/adwaita-nativescript` | this one |
| GTK 4 / GJS · Node · Bun · Deno | `@gjsify/storybook` (native `Adw.*`) | [`adwaita-storybook`](../../gtk/adwaita-storybook) |
| Browser | `@gjsify/adwaita-storybook` (`@gjsify/adwaita-web` components) | [`adwaita-storybook`](../../gtk/adwaita-storybook) (`build:web`) |

One story contract, three renderers: `@gjsify/storybook-core` holds the renderer-free logic (registry, control binding, controller) and each target is a thin adapter over it.

## Prerequisites

The Android SDK, an emulator or device, and the NativeScript CLI prerequisites — see the [NativeScript setup docs](https://docs.nativescript.org/setup/).

This project is excluded from the root `workspaces` glob (its NativeScript toolchain must not be pulled into every `gjsify install`), but its `@gjsify/*` deps are resolved from the **hoisted workspace** `node_modules` (caret ranges), so the NativeScript CLI must NOT run its own `npm install` — every script passes `--disable-npm-install`.

## Run

```bash
emulator -avd Medium_Phone_API_36 -gpu host   # boot a device first
cd showcases/dom/adwaita-storybook-nativescript
npm run run:android        # or: npm run debug:android  (serves the V8 CDP inspector)
```

`sync:theme` (run by every script) copies the current `adwaita.css` + `storybook.css` out of the bridge packages, so the app never ships a drifted theme copy.

## What it demonstrates

- A complete component browser — every story the GTK and browser targets render, sidebar navigation, live two-way controls — running as a **real native Android app**
- The SAME stories on three renderers from ONE renderer-agnostic `*.meta.ts` source, imported across package boundaries via the GTK showcase's `./metas` export — so a control added once shows up on all three
- Native Adwaita widgets on NativeScript (`@gjsify/adwaita-nativescript`), styled with the Adwaita CSS theme + Adwaita Sans, with no webview anywhere
- The narrow-width shell: a collapsed `AdwNavigationSplitView` (story list ↔ detail + back button), matching the GTK `NavigationSplitView` at phone width
- The storybook control plane over a third transport — `installStorybookDevtools` exposes `ListStories` / `OpenStory` / `SetStoryArg` plus `DumpTree` / `Screenshot` to an MCP agent over the V8 CDP inspector, the same surface the GTK target serves over DBus
- Story-set parity between the GTK, browser and Android renderings — the rendering AND its registration — enforced by `scripts/check-storybook-story-parity.mjs` (no screenshot comparison — see #1052)

## MCP / devtools

`storybook-page.ts` installs the in-app devtools agent + the storybook control surface (`installStorybookDevtools`), so an MCP agent attached over the V8 CDP inspector (`nativescript debug android`) can `ListStories` / `OpenStory` / `SetStoryArg`, `DumpTree` the native Adwaita view tree, and `Screenshot` it — the same control plane as the GTK (`@gjsify/devtools`) and browser targets.

```bash
gjsify debug --profile nativescript   # bridges the V8 inspector → MCP tools
```

## Layout

```
app/
  app.ts              entry — Application.run({ moduleName: 'app-root' })
  app-root.xml        <Frame defaultPage="storybook-page" />
  storybook-page.*    builds runStorybook(...) + installs the devtools agent
  app.css             @nativescript/theme + adwaita.css + storybook.css + fonts
  adwaita.css         widget theme (copied from @gjsify/adwaita-nativescript)
  storybook.css       storybook chrome (copied from @gjsify/storybook-nativescript)
  fonts/              Adwaita Sans TTFs
src/
  <category>/<name>.ns.ts   one native story per *.meta.ts (StoryView subclass)
  stories.ts                aggregated NsStoryModule[] (category order)
```

> This showcase is a NativeScript project (it owns `App_Resources/`, `nativescript.config.ts`)
> and declares no `build`/`check`/`test` scripts, so `gjsify foreach` skips it — it is built and
> run via the NativeScript CLI.

## Related

- [`@gjsify/storybook-nativescript`](../../../packages/nativescript-bridge/storybook) — the NativeScript story renderer
- [`@gjsify/adwaita-nativescript`](../../../packages/nativescript-bridge/adwaita) — the native Adwaita widget set
- [`@gjsify/storybook-core`](../../../packages/framework/storybook-core) — the renderer-free storybook logic all three targets share
- [`@gjsify/stories`](../../../packages/framework/stories) — the pure-TS story contract
- [`adwaita-storybook`](../../gtk/adwaita-storybook) — the GTK + browser targets and the shared `*.meta.ts` source

## License

MIT
