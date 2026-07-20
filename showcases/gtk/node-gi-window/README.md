# @gjsify/example-gtk-node-gi-window

A **minimal Libadwaita window** whose single `gi://` source builds and runs on
**both GJS and Node.js** — the GTK-GUI capstone of the [`@gjsify/node-gi`](../../../packages/node-gi/node-gi)
reverse bridge. One unchanged `Adw.Application` + `Adw.ApplicationWindow`
(HeaderBar / WindowTitle / StatusPage) realizes and renders a real top-level window
through the platform GDK backend (GdkWayland/GdkX11 on Linux, GdkWin32 on Windows)
under Node.js exactly as under GJS — beyond the display-free conformance.

It is `private` + versioned (a dev-tooling showcase, like `adwaita-storybook`): it
depends on `@gjsify/node-gi` via a `file:` link, so it is not published to npm.

## Build + run

```bash
# GJS (native gi://)
gjsify run build:gjs && gjsify run start:gjs

# Node.js (via @gjsify/node-gi — build with a gi://→requireGi-capable @gjsify/cli)
gjsify run build:node && gjsify run start:node
```

Both builds produce the same window. `src/app.ts` runs the app via
`Adw.Application.runAsync()` (NOT sync `run()` — sync view loads hang on their
spinner under node-gi/gjsify) and references the GJS ambient `print` global, which
triggers the reverse bridge's `@girs/*`-body resolution so `@gjsify/devtools` keeps
its real code under `--app node`.

## Self-verify over DBus (screenshot)

`src/app.ts` embeds the [`@gjsify/devtools`](../../../packages/framework/devtools)
control plane via `installDevtools(app)` (a no-op unless `GJSIFY_DEVTOOLS` is
truthy). With it enabled, the LIVE window is inspectable and screenshottable over
the session bus (`org.gjsify.Devtools`) — proving devtools' in-process GSK-renderer
capture (`Gtk.WidgetPaintable` → `Gsk.Renderer.render_texture` → `Gdk.Texture` PNG)
works on node-gi against a real toplevel:

```bash
# 1. launch the Node build with devtools enabled (backgrounded)
GJSIFY_DEVTOOLS=1 node dist/app.node.mjs &

# 2. screenshot it over DBus (gdbus can't save the binary `ay`, so a GJS caller does)
gjs -m tools/shoot.js eu.jumplink.NodeGiWindow dist/window.png
```

`tools/shoot.js` calls `GetStatus` → `DumpTree` → `Screenshot` and writes the PNG.
The same window can be driven from an MCP client via `gjsify debug`.

## What it proves

- `@gjsify/node-gi` marshals the full GTK4/Adwaita windowing + GSK render path
  (window realize/present, `Gtk.Snapshot.to_node()` → `Gsk.RenderNode` fundamental,
  `Gsk.Renderer.render_texture`, `Gdk.Texture.save_to_png_bytes`).
- `@gjsify/devtools`' live DBus `Screenshot`/`DumpTree` run under node-gi, not just
  on GJS.

The self-contained, workspace-free windowing smoke (no bundler, no `@gjsify/devtools`)
lives as `packages/node-gi/node-gi/test/windowing.test.mjs` and is what the Linux
`gtk-smoke` + Windows batteries-included CI jobs run.
