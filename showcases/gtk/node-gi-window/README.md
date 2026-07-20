# @gjsify/example-gtk-node-gi-window

An **interactive Libadwaita window** whose single `gi://` source builds and runs on
**both GJS and Node.js** — a GTK-GUI capstone of the [`@gjsify/node-gi`](../../../packages/node-gi/node-gi)
reverse bridge. One unchanged `Adw.Application` + `Adw.ApplicationWindow`
(HeaderBar / WindowTitle / Clamp / PreferencesGroup / ActionRow + `Gtk.Button`s)
realizes, renders **and responds to input** through the platform GDK backend
(GdkWayland/GdkX11 on Linux, GdkWin32 on Windows) under Node.js exactly as under GJS.

The window keeps a click counter. A `Gtk.Button::clicked` signal AND a
`Gio.SimpleAction` added to the window (`win.add_action`, with `<primary>plus` /
`<primary>r` keyboard accelerators) both dispatch into JS, mutate the counter, and
the visible state changes — the window title, the `Adw.WindowTitle` subtitle and the
`Adw.ActionRow` subtitle. The button and every accelerator funnel through the SAME
action, so there is **one** state-mutation path: GTK signal/action → node-gi signal
dispatch → JS handler → widget setter.

It is `private` + versioned (a dev-tooling showcase, like `adwaita-storybook`): it
depends on `@gjsify/node-gi` via a `file:` link, so it is not published to npm.

## Build + run

```bash
# GJS (native gi://)
gjsify run build:gjs && gjsify run start:gjs

# Node.js (via @gjsify/node-gi — build with a gi://→requireGi-capable @gjsify/cli)
gjsify run build:node && gjsify run start:node
```

Both builds produce the same interactive window. `src/app.ts` runs the app via
`Adw.Application.runAsync()` (NOT sync `run()` — sync view loads hang on their
spinner under node-gi/gjsify) and references the GJS ambient `print` global, which
triggers the reverse bridge's `@girs/*`-body resolution so `@gjsify/devtools` keeps
its real code under `--app node`.

## Self-verify the event chain over DBus

`src/app.ts` embeds the [`@gjsify/devtools`](../../../packages/framework/devtools)
control plane via `installDevtools(app)` (a no-op unless `GJSIFY_DEVTOOLS` is
truthy). With it enabled, the LIVE window is drivable, inspectable and screenshottable
over the session bus (`org.gjsify.Devtools`) — so the interactivity is provable
without a human clicking. `Adw.ApplicationWindow` implements `Gio.ActionGroup`, and
node-gi's `instanceof` now spans the whole GObject hierarchy, so devtools resolves the
`win.*` action group off the active window:

```bash
# 1. launch the Node build with devtools enabled (backgrounded)
GJSIFY_DEVTOOLS=1 node dist/app.node.mjs &

# 2. drive the window action + read the changed state over DBus
gdbus call --session --dest eu.jumplink.NodeGiWindow \
  --object-path /eu/jumplink/NodeGiWindow/devtools \
  --method org.gjsify.Devtools.ActivateAction win increment null
gdbus call --session --dest eu.jumplink.NodeGiWindow \
  --object-path /eu/jumplink/NodeGiWindow/devtools \
  --method org.gjsify.Devtools.GetProperty "" title      # → "node-gi — 1 clicks"

# 3. screenshot it (gdbus can't save the binary `ay`, so a GJS caller does)
gjs -m tools/shoot.js eu.jumplink.NodeGiWindow dist/window.png
```

`tools/shoot.js` calls `GetStatus` → `DumpTree` → `Screenshot` and writes the PNG.
The same window can be driven from an MCP client via `gjsify debug`.

## What it proves

- `@gjsify/node-gi` dispatches the GTK signal/action/event chain into JS: a
  `Gtk.Button::clicked` signal, a `Gio.SimpleAction::activate` on the window, and
  `win.activate_action()` all run their JS handlers and update Adwaita widgets.
- `@gjsify/node-gi` marshals the full GTK4/Adwaita windowing + GSK render path
  (window realize/present, `Gtk.Snapshot.to_node()` → `Gsk.RenderNode` fundamental,
  `Gsk.Renderer.render_texture`, `Gdk.Texture.save_to_png_bytes`).
- `@gjsify/devtools`' live DBus `ActivateAction` / `GetProperty` / `DumpTree` /
  `Screenshot` run under node-gi, not just on GJS.

The self-contained, workspace-free proofs (no bundler, no `@gjsify/devtools`) live as
`packages/node-gi/node-gi/test/windowing.test.mjs` (static render) and
`packages/node-gi/node-gi/test/windowing-interactive.test.mjs` (the interactivity
chain + render) — what the Linux `gtk-smoke` + Windows windowing CI jobs run.
