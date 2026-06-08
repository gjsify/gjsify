# @gjsify/example-dom-three-postprocessing-pixel

A three.js pixel post-processing showcase running on GJS/GTK (via `@gjsify/webgl`'s `WebGLBridge` over `Gtk.GLArea`) and in the browser — from a shared `start(canvas)` entry point. Ported from [`three/examples/webgl_postprocessing_pixel`](https://threejs.org/examples/#webgl_postprocessing_pixel). Demonstrates three.js `EffectComposer` with a custom pixel/posterize shader running on native GJS WebGL.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Run

```bash
# Build first
gjsify run build

# GJS / GTK4 native window (WebGL via Gtk.GLArea)
gjsify showcase three-postprocessing-pixel
# or: gjsify run start

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## What it demonstrates

- three.js post-processing (`EffectComposer` + pixel shader) on GJS
- WebGL rendering via `@gjsify/webgl` (Vala bridge over `Gtk.GLArea` + libepoxy)
- Shared `start(canvas)` pattern — identical entry for GJS and browser
- Adwaita design language in both variants
- `gjsify build --app gjs` and `--app browser` dual-target build

## License

MIT
