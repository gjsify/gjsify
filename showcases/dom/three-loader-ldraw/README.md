# @gjsify/example-dom-three-loader-ldraw

A three.js LDraw showcase running on GJS/GTK (via `@gjsify/webgl`'s `WebGLBridge` over `Gtk.GLArea`) and in the browser — from a shared `start(canvas)` entry point. Ported from [`three/examples/webgl_loader_ldraw`](https://threejs.org/examples/#webgl_loader_ldraw). The GJS variant renders inside a native Adwaita window; the browser variant uses `@gjsify/adwaita-web` components.

Sixteen LDraw models ship with the package; pick one from the sidebar and step through its building instructions.

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
gjsify showcase three-loader-ldraw
# or: gjsify run start

# The same --app node bundle on Node.js / Bun / Deno
gjsify showcase three-loader-ldraw --runtime node   # or: bun | deno
# or: gjsify run start:node

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## What it demonstrates

- WebGL rendering on GJS via `@gjsify/webgl` (Vala bridge over `Gtk.GLArea` + libepoxy)
- three.js (`THREE.WebGLRenderer`) running unmodified on GJS — `LDrawLoader`, `LDrawUtils`, `OrbitControls` and `LDrawConditionalLineMaterial` straight from `three/addons`
- **A scene that arrives from disk, not from code** — the first showcase here whose
  geometry is fetched: `LDrawLoader` streams a packed `.mpd` through `fetch` and
  `Response.body`, then parses ~250 KB of LDraw commands into 62 meshes and 124
  line objects before the first frame
- Instanced drawing (`drawElementsInstanced`) and WebGL2 sized internal formats
- Shared `start(canvas)` pattern — identical entry for GJS, Node and browser
- Adwaita design language in both variants (native `Adw.*` widgets on GJS, `@gjsify/adwaita-web` in the browser)
- Live two-way controls over the running scene: model, flat colours, geometry merging, smooth normals, building step and the two line layers — `Adw.ComboRow` / `Adw.SwitchRow` / `Adw.SpinRow` in a sidebar on GJS, the same set as web components in the browser
- `gjsify build --app gjs`, `--app node` and `--app browser` from one source tree

## Layout

```
src/
  three-demo.ts        shared start(canvas) — the whole demo, platform-agnostic
  models.ts            the model catalog both shells read
  gjs/                 Adw.Application + ldraw-window.blp (Blueprint UI)
  browser/             adwaita-web shell + index.html + webgl.css
  assets/              packed LDraw models (LDraw Parts Library, CC BY 2.0)
```

`src/assets/models/ldraw/officialLibrary/` carries the models' own `CAlicense.txt`
and `CAreadme.txt`; they are shipped as npm assets via `exports['./assets/*']`.

## Related

- [`@gjsify/webgl`](../../../packages/framework/webgl) — the `WebGLBridge` implementation this exercises
- [`@gjsify/fetch`](../../../packages/web/fetch) — where the model bytes come from
- [`@gjsify/adwaita-web`](../../../packages/web/adwaita-web) — the Adwaita web components of the browser variant
- [`three-geometry-teapot`](../three-geometry-teapot) — the same seam with geometry built in code instead of loaded

## License

MIT
