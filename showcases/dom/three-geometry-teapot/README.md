# @gjsify/example-dom-three-geometry-teapot

A three.js Utah Teapot showcase running on GJS/GTK (via `@gjsify/webgl`'s `WebGLBridge` over `Gtk.GLArea`) and in the browser — from a shared `start(canvas)` entry point. Ported from [`three/examples/webgl_geometry_teapot`](https://threejs.org/examples/#webgl_geometry_teapot). The GJS variant renders inside a native Adwaita window; the browser variant uses `@gjsify/adwaita-web` components.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

| Target | Bundle | Platform glue |
|---|---|---|
| GJS / GTK 4 | `dist/gjs.js` (`--app gjs`) | `@gjsify/webgl` `WebGLBridge` → `Gtk.GLArea` + libepoxy |
| Node · Bun · Deno | `dist/gjs.node.mjs` (`--app node`) | the same GTK window through the `@gjsify/node-gi` reverse bridge |
| Browser | `dist/browser.js` (`--app browser`) | a real `<canvas>` + `@gjsify/adwaita-web` |
| Android | [`three-geometry-teapot-nativescript`](../three-geometry-teapot-nativescript) | `@nativescript/canvas` (native GL) |

Every target enters the same `start(canvas)` seam in `src/three-demo.ts` — only the shell around the canvas differs.

## Prerequisites

GJS ≥ 1.86 with GTK 4 and a working GL/GLES driver. `gjsify system-check` reports what is missing.

## Run

```bash
# Build first (gjs + node + browser bundles and the assets)
gjsify run build

# GJS / GTK4 native window (WebGL via Gtk.GLArea)
gjsify showcase three-geometry-teapot
# or: gjsify run start

# The same --app node bundle on Node.js / Bun / Deno
gjsify showcase three-geometry-teapot --runtime node   # or: bun | deno
# or: gjsify run start:node

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## What it demonstrates

- WebGL rendering on GJS via `@gjsify/webgl` (Vala bridge over `Gtk.GLArea` + libepoxy)
- three.js (`THREE.WebGLRenderer`) running unmodified on GJS — `TeapotGeometry`, `OrbitControls` and a pisa cube-map environment straight from `three/addons`
- Shared `start(canvas)` pattern — identical entry for GJS, Node and browser
- Adwaita design language in both variants (native `Adw.*` widgets on GJS, `@gjsify/adwaita-web` in the browser)
- Live two-way controls over the running scene: tessellation level, lid/body/bottom visibility, snug lid, shading and material — `Adw.ComboRow` / `Adw.SwitchRow` in a sidebar on GJS, the same set as web components in the browser
- `gjsify build --app gjs`, `--app node` and `--app browser` from one source tree

## Layout

```
src/
  three-demo.ts        shared start(canvas) — the whole demo, platform-agnostic
  gjs/                 Adw.Application + teapot-window.blp (Blueprint UI)
  browser/             adwaita-web shell + index.html + webgl.css
  assets/              uv_grid_opengl.jpg + pisa/ cube map
```

## Related

- [`@gjsify/webgl`](../../../packages/framework/webgl) — the `WebGLBridge` implementation this exercises
- [`@gjsify/adwaita-web`](../../../packages/web/adwaita-web) — the Adwaita web components of the browser variant
- [`three-postprocessing-pixel`](../three-postprocessing-pixel) — the same seam driving a three.js `EffectComposer` chain
- [`three-geometry-teapot-nativescript`](../three-geometry-teapot-nativescript) — the Android/NativeScript target of this teapot

## License

MIT
