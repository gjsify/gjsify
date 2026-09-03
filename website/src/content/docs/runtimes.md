---
title: Runtimes
description: "Where your gjsify code can run: GJS, Node.js, Bun, Deno and the browser, and how to choose between them."
---

gjsify targets four JavaScript runtimes, and one flag decides which build you
get:

```bash
gjsify build src/index.ts --app gjs      # GJS
gjsify build src/index.ts --app node     # Node.js, Bun and Deno
gjsify build src/index.ts --app browser  # a web build of the same source
```

Your source stays the same. What changes is which implementation each import
resolves to.

Start from the runtime you already have:

| You run | Build target | `gi://` is resolved by | Operating systems |
|---|---|---|---|
| GJS | `--app gjs` | GJS itself, no bridge | Linux, macOS in part |
| Node.js | `--app node` | `@gjsify/node-gi` | Linux, macOS, Windows |
| Bun | `--app node`, the same bundle | `@gjsify/node-gi` | Linux, macOS, Windows |
| Deno | `--app node`, the same bundle | `@gjsify/node-gi` | Linux, macOS, Windows |

Node, Bun and Deno share one bundle because Node-API is their common
native-addon ABI, so moving `--runtime` between those three changes the launcher
and nothing else. Crossing between `gjs` and any of the three is a different
build: `gjsify storybook` rebuilds with the other `--app`, and
`gjsify showcase` resolves the other artifact.

Every template `gjsify create` ships covers all four. Each one builds both
bundles and carries a start script per runtime: `start` runs the `--app gjs`
build, `start:node`, `start:bun` and `start:deno` run the `--app node` build on
the runtime they name.

:::note[Runtime is not the same as operating system]
This page is about runtimes. Which **operating systems** each one works on is a
separate question, and the answer is not the same: a package can be fully
cross-runtime and still be Linux-only, because the native library underneath it
is. [Platform Support](/gjsify/platform-support/) has that picture.
:::

## GJS

GJS is GNOME's own JavaScript runtime, SpiderMonkey plus GObject introspection.
It resolves `gi://Gtk?version=4.0` itself, so a GTK call from your code enters
libgtk with nothing bridging in between, and GNOME ships GJS, so a GNOME desktop
already has the runtime installed.

The build rewrites `node:*` imports and Web globals to gjsify's implementations,
each backed by a GNOME library: `node:fs` by Gio, `fetch` and `WebSocket` by
libsoup, `<canvas>` by Cairo, `node:sqlite` by libgda.

```bash
gjsify build src/index.ts --app gjs --outfile dist/index.gjs.js
gjsify run dist/index.gjs.js
```

You need `gjs` 1.86 or newer. Linux distributions ship it; on macOS it comes
from Homebrew, where only part of the surface is verified; there is no GJS build
for Windows.
[Packages](/gjsify/packages/overview/) lists what is implemented.

Two things are specific to this target. A `.deb` or `.rpm` built from a GJS app
depends on the distribution's own `gjs (>= 1.86)` rather than carrying an
interpreter, which is what keeps those packages small — see
[Ship your app](/gjsify/ship/). And a showcase's published artifact is its
`--app gjs` bundle (`gjsify.main`), which is why `gjsify showcase` runs on GJS
when a `gjs` binary is on PATH and follows the host runtime when there is none.

## Node.js, Bun and Deno

The same GObject code runs on all three through
[`@gjsify/node-gi`](/gjsify/projects/node-gi/), a native addon that resolves
`gi://Gtk?version=4.0` imports and supports `GObject.registerClass`, signals,
virtual functions with chain-up, boxed structs, Cairo drawing and the GLib main
loop. One prebuilt binary and one `--app node` bundle serve all three.

Add the bridge to the project that needs it, then build and run:

```bash
gjsify install @gjsify/node-gi
gjsify build src/index.ts --app node --outfile dist/index.node.mjs
gjsify run dist/index.node.mjs --runtime node   # or bun, or deno
```

These three are the runtimes that reach macOS and Windows.
`@gjsify/gtk-runtime-win32-x64`, `@gjsify/gtk-runtime-darwin-arm64` and
`@gjsify/gtk-runtime-darwin-x64` carry the GTK 4 and Adwaita closure that
`@gjsify/node-gi` loads its `gi://` namespaces from, so there is no gvsbuild or
Homebrew GTK to install first.

What differs between the three:

- **Node.js** is the one with a declared engine floor: `@gjsify/node-gi` asks for
  Node 20 or newer. It is also the widest tested of the three — on Linux it
  carries the full GTK, Adwaita, windowing, widget, GtkSourceView and template
  checks.
- **Bun** installs with `bun add` and writes its own module layout. Tracked at
  Bun's latest release, with the GTK and Adwaita checks run on every release.
- **Deno** loads the addon through the prebuild path, because it runs no
  postinstall build, and `gjsify run --runtime deno` launches with
  `--node-modules-dir=manual` so the already linked dependency is used as it
  stands. Tracked at Deno v2.x, with the same checks as Bun.

On macOS, all three are checked without a display, and the windowed proof runs
under Node. On Windows, Node is the runtime we exercise; Bun and Deno are not
verified there today.

[Devtools](/gjsify/guides/devtools/) works over this path as well: you can
inspect, drive and screenshot a GTK app that is running on Node, Bun or Deno, and
`gjsify storybook --runtime node` hosts the whole GTK storybook there.

A `--app node` bundle that never touches a `gi://` import stays free of node-gi
and runs on stock Node.js, so you are not paying for the bridge unless you use
it.

## The browser

The same source can be built as a web app. `@gjsify/adwaita-web` carries the
Adwaita design system over as Web Components, and the bridge widgets have
DOM-native counterparts, so a `<canvas>` that was a `Gtk.DrawingArea` on GJS is
an ordinary canvas here. The [showcases](/gjsify/showcases/) embedded on this site
are exactly these builds.

```bash
gjsify build src/index.ts --app browser --outfile dist/browser.js
```

Browser builds carry no native code, so they run wherever a browser does, and
there is no bridge and no engine floor to check. Every package declares what it
provides here in its `gjsify.runtimes.browser` slot, the same way it declares its
`gjs`, `node` and `nativescript` slots, and that declaration is held against what
the source actually imports rather than taken on trust. The bundles themselves
are driven on Firefox, which shares the SpiderMonkey engine with GJS; what that
checks is our implementation claims against the real browser platform, not our
GJS packages inside a browser.

## Mobile with NativeScript (experimental)

`gjsify build --app nativescript` produces bundles for the NativeScript
toolchain, and `@gjsify/adwaita-nativescript` implements the Adwaita widget set,
the storybook renderer and the devtools agent as real native Android and iOS
views (not a WebView). The widget packages ship with every gjsify release; the
runtime target itself is still experimental, so treat it as something to try
rather than something to ship.

## What keeps the four in step

The same small `gi://` programs are run unchanged on gjs, node, bun and deno, and
every runtime's output has to match GJS's byte for byte. GJS is the reference
because it is the one implementation we did not write: a drift on either side
fails the release, whether it came from the bridge or from a GJS change. Nothing
is quietly excluded — the combinations known not to match are written down,
by name, with the reason.

Above that, each package's own test bundle is built once, engine-agnostic, and
run as that same file on Node, Bun and Deno. The three cannot drift apart without
the release stopping.

## Pick a runtime for a single command

`gjsify build` defaults `--app` to the target of the runtime hosting the CLI:
`gjs` under GJS, `node` under Node, Bun or Deno. `gjsify storybook` follows the
host the same way. `gjsify run` follows the host too, except that an `--app gjs`
bundle is always launched on GJS, since its `gi://` imports are externalised and
there is no bridge to stand in. `gjsify showcase` uses GJS when a `gjs` binary is
on PATH and the host runtime otherwise, because the `--app gjs` bundle is the
artifact every showcase publishes.

Set it explicitly whenever you want something else:

```bash
gjsify run dist/index.node.mjs --runtime bun
gjsify showcase canvas2d-fireworks --runtime deno
```

Or fix it per project with `gjsify.app` in `package.json`. The full flag list is
in the [CLI Reference](/gjsify/cli-reference/); which runtime hosts the CLI itself
is covered on [Install & Update](/gjsify/guides/install/).

## Choosing between them

The four are not interchangeable in every direction. These are the differences
that usually decide it:

- **Operating system.** There is no GJS for Windows, and on macOS the GJS side is
  partial. Node, Bun and Deno reach all three, taking GTK and Adwaita from the
  system on Linux and from the platform runtime packages on macOS and Windows.
  [Platform Support](/gjsify/platform-support/) has the per-target matrix.
- **What the target machine already has.** GNOME ships GJS, so a GNOME desktop
  needs no extra runtime. A machine already set up for npm-based tooling has one
  of the other three.
- **The bridge.** On GJS, `gi://` is the runtime's own import path. On Node, Bun
  and Deno it goes through `@gjsify/node-gi`, which means a native addon in your
  dependency tree and a prebuilt binary per platform.
- **Distribution.** `gjsify ship` turns a built app into an installable artifact
  with no packaging files in your repo — Linux packages from a GJS build, and
  macOS and Windows artifacts from a `--app node` one, since those two carry
  their own interpreter and GTK. [Ship your app](/gjsify/ship/) has the formats.
- **The web.** `--app browser` drops native code entirely, which is what makes it
  portable and also what rules out the GNOME libraries: anything backed by GTK,
  Gio or libsoup needs a DOM counterpart, and `@gjsify/adwaita-web` is where the
  widget set comes from.
- **Stability.** node-gi is younger than the GJS side. It is tested and released
  with every gjsify release, but a breaking change can still land in a minor
  version. No gjsify package depends on it at runtime, so it cannot destabilise a
  build that does not use it. See [Versioning](/gjsify/versioning/) for the
  stability model.

## Related

- [Platform Support](/gjsify/platform-support/): Linux, macOS and Windows, per target
- [Packages](/gjsify/packages/overview/): what is implemented on each runtime
- [Coverage](/gjsify/coverage/): live dashboards of the implemented surface
- [node-gi](/gjsify/projects/node-gi/): the bridge that puts GObject on Node.js
- [napi](/gjsify/projects/napi/): the other direction, native `.node` addons inside GJS
- [How It Works](/gjsify/how-it-works/): the build pipeline behind the `--app` flag
