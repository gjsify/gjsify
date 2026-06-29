# @gjsify/node-gi — one Adwaita source, two runtimes (GTK capstone)

The GTK analog of the headless [`../example`](../example) capstone: a single,
**unchanged** GJS / Libadwaita application ([`src/app.ts`](src/app.ts)) that
builds and runs **identically** on both GJS and Node.js.

```
gjsify build src/app.ts --app gjs   → gjs  -m dist/app.gjs.mjs   (native gi://)
gjsify build src/app.ts --app node  → node    dist/app.node.mjs  (@gjsify/node-gi)
```

The `gjsify` bundler keeps the `gi://` imports native for the GJS target and
rewrites them onto the node-gi L1 runtime (`requireGi`) for the Node target. The
GJS ambient `print` global is injected for the Node build by `--globals auto`
(the `@gjsify/node-gi/globals` shim) — no `/register` import in the source.

Both builds print the same fixed sequence of lines (the GOLDEN output asserted by
[`dual.e2e.mjs`](dual.e2e.mjs)):

```
gtk-dual: start
activated
child: template
title: hello
css: applied
action: hello
quit
done
```

## What the shared source exercises

| GTK / Adwaita feature | API in `src/app.ts` |
|---|---|
| Adw.Application + the libuv↔GLib loop bridge | `new Adw.Application({ application_id, flags: NON_UNIQUE })`, `app.run([])`, quit from a `GLib.timeout_add` |
| Composite template (window subclass) | `GObject.registerClass({ GTypeName, Template: <inline UI-XML bytes>, Children: ['heading'] }, class extends Adw.ApplicationWindow {})` |
| Adwaita chrome (in the template) | `Adw.ToolbarView` + `Adw.HeaderBar` + `Adw.WindowTitle` over a `Gtk.Label` content |
| Bound template child | `win.heading` (the labelled child), read + write its `label` |
| CSS | `Gtk.CssProvider.load_from_string` → `Gdk.Display.get_default` → `Gtk.StyleContext.add_provider_for_display(display, provider, STYLE_PROVIDER_PRIORITY_APPLICATION)` → `add_css_class` / `has_css_class` |
| Gio.SimpleAction | `new Gio.SimpleAction({ name })`, `app.add_action(action)`, `action.connect('activate', …)`, `action.activate(null)` |

Every value is **deterministic** — no hostname, no machine paths — and never
depends on a signal callback's arguments (the Node runtime omits the emitter as
the first callback arg, so the example only ever prints closure-captured
constants). That is what lets the two runtimes produce byte-identical output.

### Dual-safety findings (gjs vs node)

Two genuine cross-runtime constraints surfaced while building this capstone — both
are reasons the source is shaped the way it is:

1. **A composite-template child id must not collide with a GObject property of the
   widget.** A child id `title` on this `Adw.ApplicationWindow` (which has a
   `title` string property) crashes **both** runtimes — GJS with an uncatchable
   exception, node-gi with a fatal abort — because the bound-child accessor
   clashes with the property. The child is therefore named `heading`. (This is a
   GTK/GJS-level footgun, identical on native GJS — not a node-gi-specific defect.)
2. **There is no dual-safe way to read an introspected instance's GType name.**
   `constructor.$gtype` is undefined on node-gi, `GObject.type_name_from_instance`
   is not marshallable, and `constructor.name` differs (`Object` vs
   `Gio_SimpleAction`). The bound child is therefore proved via property
   round-trips (`child: <template label>` then `title: <value we set>`), not by
   printing its type.

## Run it

```bash
npm install      # builds @gjsify/node-gi's native addon via the file: dependency
npm run build    # builds both the gjs and node bundles
npm run start:gjs
npm run start:node
npm test         # node --test dual.e2e.mjs — asserts gjs === node === GOLDEN
```

GTK needs a display. On a headless machine run the build + start + test under a
virtual display with the software render env:

```bash
xvfb-run -a dbus-run-session -- \
  env GSK_RENDERER=cairo GDK_BACKEND=x11 LIBGL_ALWAYS_SOFTWARE=1 GTK_A11Y=none \
  npm test
```

`dual.e2e.mjs` self-skips when no display is present, so a plain headless
`node --test` stays green; the dedicated `gtk-smoke` CI job runs it under Xvfb.

> The dependency here is `"@gjsify/node-gi": "file:../node-gi"` so the example
> validates the in-tree runtime. The real consumer form is the published package:
> `"@gjsify/node-gi": "^0.13.0"`.

> **CLI note.** `npm run build:node` (the `gjsify build --app node` rewrite of
> `gi://` → `requireGi` + the `@gjsify/node-gi/globals` injection) needs a
> `gjsify` CLI that carries the node-gi bundler integration. That ships on the
> gjsify `main` branch; it may be newer than the `@gjsify/cli` on npm's `latest`
> tag. With an older CLI the node bundle is produced but stubs `gi://`, so
> `npm run start:node` would not run. `dual.e2e.mjs` handles this automatically:
> it runs the real `--app node` bundle when the CLI supports the rewrite, and
> otherwise runs the same source through the `@gjsify/node-gi` runtime — either
> way asserting byte-identical output. `npm run build:gjs` / `start:gjs` work with
> any CLI (`gi://` stays native under GJS).

## Requirements

- Node.js ≥ 20 and the `gjs` binary on `PATH`.
- A C++ toolchain + the GLib ≥ 2.80 / `girepository-2.0` development headers (so
  `npm install` can build the node-gi native addon) — see the
  [`@gjsify/node-gi` README](../node-gi/README.md#requirements).
- The GTK stack + typelibs: `gtk4` / `gtk4-devel`, `libadwaita` /
  `libadwaita-devel` (these provide the `Gtk-4.0` / `Gdk-4.0` / `Adw-1`
  typelibs), and a display (real, or `Xvfb`).
