# @gjsify/example-dom-three-postprocessing-pixel

A three.js pixel post-processing showcase running on GJS/GTK (via `@gjsify/webgl`'s `WebGLBridge` over `Gtk.GLArea`) and in the browser — from a shared `start(canvas)` entry point. Ported from [`three/examples/webgl_postprocessing_pixel`](https://threejs.org/examples/#webgl_postprocessing_pixel). Demonstrates a three.js `EffectComposer` chain (`RenderPixelatedPass` + `OutputPass`) running on native GJS WebGL.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

| Target | Bundle | Platform glue |
|---|---|---|
| GJS / GTK 4 | `dist/gjs.js` (`--app gjs`) | `@gjsify/webgl` `WebGLBridge` → `Gtk.GLArea` + libepoxy |
| Node · Bun · Deno | `dist/gjs.node.mjs` (`--app node`) | the same GTK window through the `@gjsify/node-gi` reverse bridge |
| Browser | `dist/browser.js` (`--app browser`) | a real `<canvas>` + `@gjsify/adwaita-web` |

Every target enters the same `start(canvas)` seam in `src/three-demo.ts` — only the shell around the canvas differs.

## Prerequisites

GJS ≥ 1.86 with GTK 4 and a working GL/GLES driver. `gjsify system-check` reports what is missing.

## Run

```bash
# Build first (gjs + node + browser bundles and the assets)
gjsify run build

# GJS / GTK4 native window (WebGL via Gtk.GLArea)
gjsify showcase three-postprocessing-pixel
# or: gjsify run start

# The same --app node bundle on Node.js / Bun / Deno
gjsify showcase three-postprocessing-pixel --runtime node   # or: bun | deno
# or: gjsify run start:node

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## What it demonstrates

- three.js post-processing on GJS: `EffectComposer` with `RenderPixelatedPass` + `OutputPass`, rendering to and resolving from off-screen render targets
- WebGL rendering via `@gjsify/webgl` (Vala bridge over `Gtk.GLArea` + libepoxy)
- Shared `start(canvas)` pattern — identical entry for GJS, Node and browser
- Adwaita design language in both variants (native `Adw.*` widgets on GJS, `@gjsify/adwaita-web` in the browser)
- Live two-way controls over the running scene: pixel size, normal-edge and depth-edge strength, pixel-aligned panning
- `gjsify build --app gjs`, `--app node` and `--app browser` from one source tree

## Layout

```
src/
  three-demo.ts        shared start(canvas) — the whole demo, platform-agnostic
  gjs/                 Adw.Application + pixel-window.blp (Blueprint UI)
  browser/             adwaita-web shell + index.html + webgl.css
  assets/              checker.png
```

## Related

- [`@gjsify/webgl`](../../../packages/framework/webgl) — the `WebGLBridge` implementation this exercises
- [`@gjsify/adwaita-web`](../../../packages/web/adwaita-web) — the Adwaita web components of the browser variant
- [`three-geometry-teapot`](../three-geometry-teapot) — the same seam without a post-processing chain

## License

MIT
