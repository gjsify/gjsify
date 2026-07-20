# @gjsify/example-gtk-node-gi-window

An **interactive Libadwaita application** whose single `gi://` source builds and runs
on **both GJS and Node.js** — a GTK-GUI capstone of the [`@gjsify/node-gi`](../../../packages/node-gi/node-gi)
reverse bridge. One unchanged `Adw.Application` + `Adw.ApplicationWindow` realizes,
renders **and responds to input** through the platform GDK backend (GdkWayland/GdkX11
on Linux, GdkWin32 on Windows) under Node.js exactly as under GJS.

Two views live in an `Adw.ViewStack`, switched by a bottom `Adw.ViewSwitcherBar`, with
the whole content under an `Adw.ToastOverlay`:

- **Counter** — a click counter. A `Gtk.Button::clicked` signal AND `Gio.SimpleAction`s
  added to the window (`win.add_action`, with `<primary>plus` / `<primary>r` keyboard
  accelerators) both dispatch into JS, mutate the counter, and the visible state
  changes: the window title, the `Adw.WindowTitle` subtitle and an `Adw.ActionRow`
  subtitle. The button and every accelerator funnel through the SAME action, so there
  is **one** state-mutation path: GTK signal/action → node-gi signal dispatch → JS
  handler → widget setter.
- **Settings** — a representative slice of the REAL Libadwaita widget set proving broad
  breadth constructs, renders and reacts via node-gi: an `Adw.PreferencesPage` /
  `Adw.PreferencesGroup` with `Adw.ActionRow`, `Adw.SwitchRow`, `Adw.EntryRow`,
  `Adw.ComboRow` (a `Gtk.StringList` model), `Adw.SpinRow` (a `Gtk.Adjustment`) and
  `Adw.ExpanderRow`, plus a `Gtk.ListBox` in the boxed-list idiom. Toggling the switch
  and a `win.toast` action both raise a dismissible `Adw.Toast` through the overlay —
  interactions dispatched through the node-gi `notify::` signal chain.

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

# 2. drive a window action + read the changed state over DBus
gdbus call --session --dest eu.jumplink.NodeGiWindow \
  --object-path /eu/jumplink/NodeGiWindow/devtools \
  --method org.gjsify.Devtools.ActivateAction win increment null
gdbus call --session --dest eu.jumplink.NodeGiWindow \
  --object-path /eu/jumplink/NodeGiWindow/devtools \
  --method org.gjsify.Devtools.GetProperty "" title      # → "node-gi — 1 clicks"
# (the `toast` action raises a toast the same way)

# 3. screenshot it (gdbus can't save the binary `ay`, so a GJS caller does)
gjs -m tools/shoot.js eu.jumplink.NodeGiWindow dist/window.png
```

`tools/shoot.js` calls `GetStatus` → `DumpTree` → `Screenshot` and writes the PNG.
The same window can be driven from an MCP client via `gjsify debug`.

## What it proves

- `@gjsify/node-gi` dispatches the GTK signal/action/event chain into JS: a
  `Gtk.Button::clicked` signal, a `Gio.SimpleAction::activate` on the window,
  `win.activate_action()` and `notify::<prop>` on the preferences widgets all run
  their JS handlers and update Adwaita widgets.
- A BROAD slice of Libadwaita constructs + renders through node-gi:
  `Adw.PreferencesPage`/`Group`, `Adw.SwitchRow`/`EntryRow`/`ComboRow`/`SpinRow`/
  `ExpanderRow`, `Gtk.StringList` + `Gtk.Adjustment` models, `Gtk.ListBox`,
  `Adw.ViewStack`/`ViewSwitcherBar` and `Adw.ToastOverlay`/`Toast`.
- `@gjsify/node-gi` marshals the full GTK4/Adwaita windowing + GSK render path
  (window realize/present, `Gtk.Snapshot.to_node()` → `Gsk.RenderNode` fundamental,
  `Gsk.Renderer.render_texture`, `Gdk.Texture.save_to_png_bytes`).
- `@gjsify/devtools`' live DBus `ActivateAction` / `GetProperty` / `DumpTree` /
  `Screenshot` run under node-gi, not just on GJS.

The self-contained, workspace-free proofs (no bundler, no `@gjsify/devtools`) live as
`packages/node-gi/node-gi/test/windowing.test.mjs` (static render),
`packages/node-gi/node-gi/test/windowing-interactive.test.mjs` (the interactivity
chain + render) and `packages/node-gi/node-gi/test/widgets.test.mjs` (the Adwaita
widget breadth) — what the Linux `gtk-smoke` + Windows windowing CI jobs run.
