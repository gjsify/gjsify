# @gjsify/example-dom-three-geometry-teapot

A three.js Utah Teapot showcase running on GJS/GTK (via `@gjsify/webgl`'s `WebGLBridge` over `Gtk.GLArea`) and in the browser — from a shared `start(canvas)` entry point. Ported from [`three/examples/webgl_geometry_teapot`](https://threejs.org/examples/#webgl_geometry_teapot). The GJS variant renders inside a native Adwaita window; the browser variant uses `@gjsify/adwaita-web` components.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Run

```bash
# Build first
gjsify run build

# GJS / GTK4 native window (WebGL via Gtk.GLArea)
gjsify showcase three-geometry-teapot
# or: gjsify run start

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## What it demonstrates

- WebGL rendering on GJS via `@gjsify/webgl` (Vala bridge over `Gtk.GLArea` + libepoxy)
- three.js (`THREE.WebGLRenderer`) running unmodified on GJS
- Shared `start(canvas)` pattern — identical entry for GJS and browser
- Adwaita design language in both variants
- `gjsify build --app gjs` and `--app browser` dual-target build

## License

MIT
