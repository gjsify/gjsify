# @gjsify/example-dom-canvas2d-fireworks

A polished Canvas 2D fireworks animation running on GJS/GTK (via `@gjsify/canvas2d`'s `Canvas2DBridge` over Cairo) and in the browser — from a shared `start(canvas)` entry point. Adapted from [juliangarnier's fireworks pen](https://codepen.io/juliangarnier/pen/gmOwJX). The GJS variant renders inside a native Adwaita window with GTK controls; the browser variant runs the same animation code behind `@gjsify/adwaita-web` components.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Targets

| Target | Bundle | Platform glue |
|---|---|---|
| GJS / GTK 4 | `dist/gjs.js` (`--app gjs`) | `@gjsify/canvas2d` `Canvas2DBridge` → Cairo + PangoCairo |
| Node · Bun · Deno | `dist/gjs.node.mjs` (`--app node`) | the same GTK window through the `@gjsify/node-gi` reverse bridge |
| Browser | `dist/browser.js` (`--app browser`) | a real `<canvas>` + `@gjsify/adwaita-web` |

Every target enters the same `start(canvas)` seam in `src/fireworks.ts` — only the shell around the canvas differs.

## Prerequisites

GJS ≥ 1.86 with GTK 4. `gjsify system-check` reports what is missing.

## Run

```bash
# Build first (gjs + node + browser bundles and the assets)
gjsify run build

# GJS / GTK4 native window
gjsify showcase canvas2d-fireworks
# or: gjsify run start

# The same --app node bundle on Node.js / Bun / Deno
gjsify showcase canvas2d-fireworks --runtime node   # or: bun | deno

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## What it demonstrates

- Canvas 2D rendering on GJS via `@gjsify/canvas2d` (Cairo + PangoCairo backend) — gradients, composite operations and per-particle fills at animation rates
- `requestAnimationFrame` + pointer events on GJS, identical to the browser code path
- Shared `start(canvas)` pattern — identical entry for GJS, Node and browser
- Adwaita design language in both variants (`@gjsify/adwaita-web` for browser, native `Adw.*` widgets for GJS)
- Live two-way controls over the running animation: particle count, auto-fire interval, maximum burst radius, auto-fireworks toggle
- `gjsify build --app gjs`, `--app node` and `--app browser` from one source tree

## Layout

```
src/
  fireworks.ts         shared start(canvas) — the whole animation, platform-agnostic
  gjs/                 Adw.Application + fireworks-window.blp (Blueprint UI)
  browser/             adwaita-web shell + index.html + canvas2d.css
```

## Related

- [`@gjsify/canvas2d`](../../../packages/framework/canvas2d) — the `Canvas2DBridge` implementation this exercises
- [`@gjsify/canvas2d-core`](../../../packages/dom/canvas2d-core) — the toolkit-free Canvas 2D core behind it
- [`@gjsify/adwaita-web`](../../../packages/web/adwaita-web) — the Adwaita web components of the browser variant
- [`excalibur-jelly-jumper`](../excalibur-jelly-jumper) — a game engine on the same bridges, with a WebGL2 → Canvas 2D fallback

## License

MIT
