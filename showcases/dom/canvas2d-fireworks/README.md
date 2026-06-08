# @gjsify/example-dom-canvas2d-fireworks

A polished Canvas 2D fireworks animation running on both GJS/GTK (via `@gjsify/canvas2d`'s `Canvas2DBridge` over Cairo) and in the browser — from the same shared source. Adapted from [juliangarnier's fireworks pen](https://codepen.io/juliangarnier/pen/gmOwJX). The GJS variant renders inside a native Adwaita window with GTK controls; the browser variant uses the same animation code with `@gjsify/adwaita-web` components.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Run

```bash
# Build first
gjsify run build

# GJS / GTK4 native window
gjsify showcase canvas2d-fireworks
# or: gjsify run start

# Browser (serves dist/ on localhost:8080)
gjsify run start:browser
```

## What it demonstrates

- Canvas 2D rendering on GJS via `@gjsify/canvas2d` (Cairo + PangoCairo backend)
- Shared animation logic between GJS and browser targets
- Adwaita design language in both variants (`@gjsify/adwaita-web` for browser, native Adw widgets for GJS)
- `gjsify build --app gjs` and `--app browser` dual-target build

## License

MIT
