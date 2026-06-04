# Three.js Utah teapot on NativeScript

The [`three-geometry-teapot`](../three-geometry-teapot) showcase runs the same Utah teapot on GNOME (GJS) and the browser from one shared `start(canvas)` seam. This is the **NativeScript-Android** target of that teapot — the same three.js rendering logic, on a phone.

It is built with **[`@gjsify/nativescript-vite`](../../../packages/infra/nativescript-vite)** on **Vite 8 / Rolldown**: `@nativescript/canvas` provides the native WebGL surface, `@nativescript/canvas-polyfill` supplies the DOM shims three.js expects, and the shared `app/three-demo.ts` (a copy of the canonical teapot logic) renders unchanged.

## Standalone by design

This project is **not** a workspace member — it is excluded from the root `workspaces` glob (`!showcases/dom/three-geometry-teapot-nativescript`) so its heavy NativeScript toolchain (the `@nativescript/canvas` AARs, the `nativescript` CLI) is **not** pulled into every `gjsify install`. Install its dependencies only when you want to build it:

```bash
cd showcases/dom/three-geometry-teapot-nativescript
npm install
```

## Build & run

Requires the Android SDK + an emulator/device and the NativeScript CLI prerequisites (see the [NativeScript setup docs](https://docs.nativescript.org/setup/)).

```bash
npm run prepare:android   # bundle only (vite → bundle.mjs baked into the project)
npm run run:android       # build the APK, install + launch on an emulator/device
```

`nativescript.config.ts` selects `bundler: 'vite'`; `vite.config.ts` is `@gjsify/nativescript-vite`'s `defineNativescriptConfig()`, which makes `@nativescript/vite` build under Vite 8 / Rolldown and layers gjsify's NativeScript transforms.

## How it maps to the shared teapot

| | shared seam | platform glue |
|---|---|---|
| GNOME | `start(canvas)` | `@gjsify/webgl` → `Gtk.GLArea` |
| Browser | `start(canvas)` | a real `<canvas>` |
| **NativeScript** | `start(canvas)` | `@nativescript/canvas` (native GL) + `@nativescript/canvas-polyfill` |

`app/three-demo.ts` is copied (not referenced) so this project is self-contained. `app/home/home-page.ts` feeds the native canvas + a `file://` asset base into `start(canvas)`; everything else is identical three.js.

## Note

`@nativescript/canvas-polyfill` `require()`s `@nativescript/audio-context` / `@nativescript/canvas-media` inside a try/catch; this WebGL-only app never executes them, so `vite.config.ts` marks them `external`.
