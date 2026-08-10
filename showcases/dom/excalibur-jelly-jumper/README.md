# @gjsify/example-dom-excalibur-jelly-jumper

A full 2D platformer — [Excalibur.js](https://excaliburjs.com/) 0.32.0 with Tiled tilemaps — running natively on GJS/GTK4 and in the browser from one shared game source. The GJS variant renders inside a native Adwaita window (WebGL2 via `@gjsify/webgl`, with a Cairo `Canvas2DBridge` fallback); the browser variant runs the same `startGame(canvas)` entry on a real `<canvas>`.

Based on the original [sample-jelly-jumper](https://github.com/excaliburjs/sample-jelly-jumper) by the Excalibur.js team; physics settings inspired by Super Mario World.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

<img width="1573" height="989" alt="Jelly Jumper running in a native Adwaita window" src="https://github.com/user-attachments/assets/4a18214c-5944-43b4-be48-571141b502ce" />

## Targets

| Target | Bundle | Platform glue |
|---|---|---|
| GJS / GTK 4 | `dist/gjs.js` (`--app gjs`) | `@gjsify/webgl` `WebGLBridge` → `Gtk.GLArea`, falling back to `@gjsify/canvas2d` `Canvas2DBridge` (Cairo) |
| Node · Bun · Deno | `dist/gjs.node.mjs` (`--app node`) | the same GTK window through the `@gjsify/node-gi` reverse bridge |
| Browser | `dist/browser.js` (`--app browser`) | a real `<canvas>` + `@gjsify/adwaita-web` |

Every target enters the same `startGame(canvas, options)` seam in `src/game.ts` — only the shell around the canvas differs. Both bridge widgets expose the identical `onReady` / `onResize` / `installGlobals` surface, so the fallback path differs from the WebGL path only in the constructor.

## Prerequisites

GJS ≥ 1.86 with GTK 4 and a GL/GLES driver for the WebGL2 renderer (without one the window starts on the Cairo fallback). `gjsify system-check` reports what is missing.

## Run

```bash
# Build first (gjs + node + browser bundles and the assets)
gjsify install
gjsify run build

# GJS / GTK4 native window
gjsify showcase excalibur-jelly-jumper
# or: gjsify run start

# The same --app node bundle on Node.js / Bun / Deno
gjsify showcase excalibur-jelly-jumper --runtime node   # or: bun | deno

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## Controls

| Action | Keyboard | Gamepad |
|--------|----------|---------|
| Move   | Arrow keys | Left stick |
| Run    | S | B button |
| Jump   | A | A button |
| Perf HUD | F1 | — |

The header bar adds pause/resume and mute/unmute buttons in the GJS variant.

## What it demonstrates

- A complete third-party game engine (Excalibur 0.32, WebGL2-only renderer) running **unmodified** on GJS
- WebGL2 rendering via `@gjsify/webgl` with a runtime fallback to Canvas 2D over Cairo (`@gjsify/canvas2d`) when no GL2 context is available — mirroring the browser's own fallback path
- The DOM/Web API surface a real game needs on GJS: `requestAnimationFrame`, keyboard/pointer events, `fetch` + `XMLHttpRequest` asset loading, `Audio`/`AudioContext`, gamepad events
- Tiled map loading through `@excaliburjs/plugin-tiled`, with `/res/...` paths rewritten via the `assetBase` option so the same resource table serves both targets
- Shared `startGame(canvas, options)` seam — identical entry for GJS, Node and browser, with per-platform tuning (`pixelRatio`, `fixedUpdateFps`, `enablePerf`) instead of forked code
- Audio degraded gracefully: a sound the host cannot decode or play is tolerated rather than failing scene init
- The opt-in `@gjsify/devtools` control plane (`GJSIFY_DEVTOOLS=1`), so the running game is screenshot- and MCP-debuggable via `gjsify debug`
- `gjsify build --app gjs`, `--app node` and `--app browser` from one source tree

## Layout

```
src/
  game.ts              shared startGame(canvas, options) seam
  main.ts              scene/engine wiring
  resources.ts         asset table (assetBase rewrite, audio failure tolerance)
  actors/ scenes/ physics/ components/ classes/ state/ ui/ perf/ util/
  gjs/                 Adw.Application + jelly-jumper-window.blp (Blueprint UI)
  browser/             adwaita-web shell + index.html
  assets/              images, tilemaps, music, sfx, fonts
scripts/perf-compare.mjs   frame-time comparison between targets
```

## Related

- [`@gjsify/webgl`](../../../packages/framework/webgl) — the WebGL2 bridge over `Gtk.GLArea`
- [`@gjsify/canvas2d`](../../../packages/framework/canvas2d) — the Cairo fallback renderer
- [`@gjsify/devtools`](../../../packages/framework/devtools) — the DBus + MCP control plane used by `gjsify debug`
- [`canvas2d-fireworks`](../canvas2d-fireworks) — the same Canvas 2D bridge without a game engine on top

## Credits

Super Mango asset pack by [JuhoSprite](https://juhosprite.itch.io/super-mango-2d-pixelart-platformer-asset-pack16x16)

Smoke FX by [@nyk_nck](https://nyknck.itch.io/fx062)

Music & SFX by [Subspace Audio](https://opengameart.org/users/subspaceaudio)

## License

MIT — see [LICENSE](./LICENSE)
