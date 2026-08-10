# @gjsify/example-dom-three-geometry-teapot-nativescript

The three.js Utah teapot on **NativeScript-Android** — the same shared `start(canvas)` seam as the GNOME and browser teapot, on a phone. `@nativescript/canvas` provides the native WebGL surface, `@nativescript/canvas-polyfill` supplies the DOM shims three.js expects, and the shared demo logic renders unchanged.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

The [`three-geometry-teapot`](../three-geometry-teapot) showcase runs the same teapot on GNOME (GJS) and in the browser from one shared `start(canvas)` seam. This is the NativeScript-Android target of that teapot:

| Target | Shared seam | Platform glue |
|---|---|---|
| GNOME (GJS / GTK 4) | `start(canvas)` | `@gjsify/webgl` → `Gtk.GLArea` |
| Browser | `start(canvas)` | a real `<canvas>` |
| **NativeScript (Android)** | `start(canvas)` | `@nativescript/canvas` (native GL) + `@nativescript/canvas-polyfill` |

`app/three-demo.ts` is copied (not referenced) so this project is self-contained. `app/home/home-page.ts` feeds the native canvas + a `file://` asset base into `start(canvas)`; everything else is identical three.js.

## Standalone by design

This project is **not** a workspace member — it is excluded from the root `workspaces` glob (`!showcases/dom/three-geometry-teapot-nativescript`) so its heavy NativeScript toolchain (the `@nativescript/canvas` AARs, the `nativescript` CLI) is **not** pulled into every `gjsify install`. Install its dependencies only when you want to build it:

```bash
cd showcases/dom/three-geometry-teapot-nativescript
npm install
```

## Prerequisites

The Android SDK, an emulator or device, and the NativeScript CLI prerequisites — see the [NativeScript setup docs](https://docs.nativescript.org/setup/).

## Run

```bash
npm run prepare:android   # bundle only (vite → bundle.mjs baked into the project)
npm run run:android       # build the APK, install + launch on an emulator/device
```

`nativescript.config.ts` selects `bundler: 'vite'`; `vite.config.ts` is `@gjsify/nativescript-vite`'s `defineNativescriptConfig()`, which makes `@nativescript/vite` build under Vite 8 / Rolldown and layers gjsify's NativeScript transforms. This showcase targets the 9.0.x / `@nativescript/vite@2` line.

## What it demonstrates

- Unmodified three.js (`THREE.WebGLRenderer`, `TeapotGeometry`, `OrbitControls`) rendering on a **native Android GL surface**
- The `start(canvas)` seam holding across a *third* platform: one demo module, three canvas providers (GTK `Gtk.GLArea`, the browser's `<canvas>`, `@nativescript/canvas`)
- `@nativescript/canvas-polyfill` supplying the DOM globals three.js reaches for, in place of gjsify's own DOM layer
- `@gjsify/nativescript-vite` building a NativeScript app with Vite 8 / Rolldown, auto-detecting the `@nativescript/vite` major
- Asset loading from a `file://` base — the same cube map and texture files as the GNOME/browser teapot
- A NativeScript showcase kept out of the workspace install so its toolchain cost is opt-in

## Layout

```
app/
  app.ts               entry — Application.run({ moduleName: 'app-root' })
  app-root.xml         <Frame defaultPage="home/home-page" />
  home/home-page.*     native canvas + file:// asset base → start(canvas)
  three-demo.ts        copy of the canonical teapot logic (self-contained)
  assets/              uv_grid_opengl.jpg + pisa/ cube map
App_Resources/         Android + iOS platform resources
nativescript.config.ts bundler: 'vite'
vite.config.ts         @gjsify/nativescript-vite defineNativescriptConfig()
```

## Note

`@nativescript/canvas-polyfill` `require()`s `@nativescript/audio-context` / `@nativescript/canvas-media` inside a try/catch; this WebGL-only app never executes them, so `vite.config.ts` marks them `external`.

## Related

- [`three-geometry-teapot`](../three-geometry-teapot) — the GNOME + browser teapot and the canonical `start(canvas)` logic
- [`@gjsify/nativescript-vite`](../../../packages/infra/nativescript-vite) — the Vite 8 / Rolldown NativeScript build
- [`adwaita-widgets-nativescript`](../adwaita-widgets-nativescript) — the native Adwaita widget path on NativeScript
- [`adwaita-storybook-nativescript`](../adwaita-storybook-nativescript) — the full Adwaita storybook on NativeScript

## License

MIT
