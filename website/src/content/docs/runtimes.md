---
title: Runtimes
description: "Where your gjsify code can run: GJS, Node.js, Bun, Deno and the browser, and how to choose between them."
---

One flag decides where your code runs:

```bash
gjsify build src/index.ts --app gjs      # a native GNOME app
gjsify build src/index.ts --app node     # Node.js, Bun and Deno
gjsify build src/index.ts --app browser  # a web build of the same source
```

Your source stays the same. What changes is which implementation each import
resolves to.

:::note[Runtime is not the same as operating system]
This page is about runtimes. Which **operating systems** each one works on is a
separate question, and the answer is not the same: a package can be fully
cross-runtime and still be Linux-only, because the native library underneath it
is. [Platform Support](/gjsify/platform-support/) has that picture.
:::

## Ship a desktop app: `--app gjs`

This is the main target and what `gjsify create` scaffolds. Your app runs as a
single native process on GJS, the JavaScript runtime GNOME users already have
installed: GTK 4 widgets, Adwaita styling and npm packages in one SpiderMonkey
runtime, with no second process and no bundled browser.

The build rewrites `node:*` imports and Web globals to gjsify's implementations,
each backed by a GNOME library: `node:fs` by Gio, `fetch` and `WebSocket` by
libsoup, `<canvas>` by Cairo, `node:sqlite` by libgda.

You need `gjs` 1.86 or newer. [Packages](/gjsify/packages/overview/) lists what
is implemented.

## Run GTK on Node.js, Bun or Deno: `--app node`

The same GObject code runs on Node.js, Bun and Deno through
[`@gjsify/node-gi`](/gjsify/projects/node-gi/), a native addon that resolves
`gi://Gtk?version=4.0` imports and supports `GObject.registerClass`, signals,
virtual functions with chain-up, boxed structs, Cairo drawing and the GLib main
loop. Node-API is the native-addon ABI for all three runtimes, so one prebuilt
binary serves them all.

Reach for this when GJS is not an option: build tooling, CI, editor integrations,
or a machine that has no GJS installed. It is also the path that reaches macOS
and Windows.

Add the bridge to the project that needs it, then build and run:

```bash
gjsify install @gjsify/node-gi
gjsify build src/index.ts --app node --outfile dist/index.node.mjs
gjsify run dist/index.node.mjs --runtime node
```

A `--app node` bundle that never touches a `gi://` import stays free of node-gi
and runs on stock Node.js, so you are not paying for the bridge unless you use
it. [Devtools](/gjsify/guides/devtools/) works over this path as well: you can
inspect, drive and screenshot a GTK app that is running on Node, Bun or Deno, and
`gjsify storybook --runtime node` hosts the whole GTK storybook there.

`@gjsify/node-gi` asks for Node.js 20 or newer; Bun and Deno are tracked at their
current releases. CI builds one engine-agnostic `--app node` bundle per package
and runs it on all three, so they do not drift apart.

## Run it in the browser: `--app browser`

The same source can be built as a web app. `@gjsify/adwaita-web` carries the
Adwaita design system over as Web Components, and the bridge widgets have
DOM-native counterparts, so a `<canvas>` that was a `Gtk.DrawingArea` on GJS is
an ordinary canvas here. The [showcases](/gjsify/showcases/) embedded on this site
are exactly these builds.

Browser builds carry no native code, so they run wherever a browser does.

## Mobile with NativeScript (experimental)

`gjsify build --app nativescript` produces bundles for the NativeScript
toolchain, and `@gjsify/adwaita-nativescript` implements the Adwaita widget set,
the storybook renderer and the devtools agent as real native Android and iOS
views (not a WebView). The widget packages ship with every gjsify release; the
runtime target itself is still experimental, so treat it as something to try
rather than something to ship.

## Pick a runtime for a single command

`gjsify build` defaults `--app` to whatever runtime is running the CLI, and
`gjsify run`, `gjsify showcase` and `gjsify storybook` apply the same default to
their `--runtime` flag. Set it explicitly whenever you want something else:

```bash
gjsify run dist/index.node.mjs --runtime bun
gjsify showcase canvas2d-fireworks --runtime deno
```

Or fix it per project with `gjsify.app` in `package.json`. The full flag list is
in the [CLI Reference](/gjsify/cli-reference/); which runtime hosts the CLI itself
is covered on [Install & Update](/gjsify/guides/install/).

## Choosing, in one paragraph

Ship on GJS. It is the primary target, it is what GNOME users have, and it is
where the framework surface is complete. Use `--app node` for the places GJS
cannot go, and `--app browser` when you want the same app on the web. Keep in
mind that node-gi is younger than the GJS side: it is tested and released with
every gjsify release, but a breaking change can still land in a minor version.
No gjsify package depends on it at runtime, so it can never destabilise a GJS
build. See [Versioning](/gjsify/versioning/) for the stability model.

## Related

- [Platform Support](/gjsify/platform-support/): Linux, macOS and Windows, per target
- [Packages](/gjsify/packages/overview/): what is implemented on each runtime
- [Coverage](/gjsify/coverage/): live dashboards of the implemented surface
- [node-gi](/gjsify/projects/node-gi/): the bridge that puts GObject on Node.js
- [napi](/gjsify/projects/napi/): the other direction, native `.node` addons inside GJS
- [How It Works](/gjsify/how-it-works/): the build pipeline behind the `--app` flag
