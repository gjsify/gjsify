---
title: Runtimes
description: One TypeScript codebase on GJS, Node.js, Deno and Bun — how GJSify makes the runtime a build-time decision.
---

GJSify's bridge runs in **both directions**, so the runtime is a build-time
decision, not an architecture decision:

- **On GJS**, GJSify implements the Node.js and Web APIs on top of the GNOME
  platform — `node:fs` is backed by Gio, `fetch` by libsoup, Canvas by Cairo.
- **On Node.js, Bun and Deno**, GJSify implements the GJS side: `gi://` imports,
  GObject classes, signals and the GLib main loop, through the
  [`@gjsify/node-gi`](/gjsify/projects/node-gi/) native bridge.

Either way you write standard TypeScript against standard APIs.
`gjsify build --app <target>` picks the runtime — the same source file builds
for `gjs`, `node` and `browser`.

## Two bridge directions

### Node.js & Web APIs on GJS — `--app gjs`

The primary target. The build rewrites
`node:*` imports and Web globals to their `@gjsify/*` implementations, each
backed by a GNOME library. Your app runs as a single native process — GTK 4
widgets, Adwaita styling, and the npm ecosystem in one SpiderMonkey runtime.

See [How It Works](/gjsify/how-it-works/) for the build pipeline and
[Packages](/gjsify/packages/overview/) for what is implemented.

### GNOME APIs on Node.js, Bun and Deno — `--app node`

The reverse direction. `@gjsify/node-gi` is a Node-API addon (vendored from
node-gtk, retargeted to girepository-2.0) that resolves `gi://Gtk?version=4.0`
imports, `GObject.registerClass`, signals, virtual functions with chain-up,
boxed structs, Cairo drawing and the GLib main loop — on plain Node.js.
Because Node-API is also Bun's and Deno's native-addon ABI, **one prebuilt
binary serves all three runtimes**.

The injection is conditional: a `--app node` bundle that never touches GJS
APIs stays node-gi-free and runs on stock Node.js.

The [devtools](/gjsify/guides/devtools/) control plane works over this reverse
bridge too: a GTK/Adwaita app running via `@gjsify/node-gi` on Node, Bun or
Deno can be inspected, driven and **screenshotted** through the same
`org.gjsify.Devtools` DBus interface as on GJS — `DumpTree`, `GetStatus`,
`ListToplevels` and the async `Screenshot` all work, producing real PNGs.

### The browser — `--app browser`

The same source can target the browser. `@gjsify/adwaita-web` carries the
Adwaita design system over as Web Components, and the bridge widgets have
DOM-native counterparts — the [showcases](/gjsify/showcases/) embedded on this
site are exactly these builds.

### The CLI follows the host runtime too

`gjsify` itself runs on GJS, Node.js, Bun and Deno, and its defaults follow
whichever one is hosting it: `gjsify build` defaults `--app` to `gjs` under a
global GJS install and to `node` when run via `npx`/`bunx`/`deno run` (bun and
deno consume the same `--app node` bundle). `gjsify run`, `gjsify showcase`
and `gjsify storybook` apply the same host-derived default to their
`--runtime` flag — so `gjsify showcase canvas2d-fireworks --runtime bun`
picks the runtime explicitly, while omitting `--runtime` follows whatever
runtime invoked the CLI. Override any of it with `--app`/`--runtime` or
`package.json#gjsify.app`. Full flags: [CLI Reference](/gjsify/cli-reference/).

## Support matrix

Support claims name what is actually validated, not runtime-class labels:

| Runtime | Role | Validated by |
|---|---|---|
| **GJS** 1.86+ | Primary target, full framework | 10,650+ test cases run on GJS *and* Node.js in CI (Fedora 43/44); 35 integration suites of curated upstream tests |
| **Node.js** 24+ | Reverse bridge + toolchain host + CLI host | 261/261 node-gi engine tests; `@gjsify/sqlite`'s suite runs via `--app node` against real libgda; `gjsify storybook --runtime node` end-to-end; devtools (`DumpTree`/`Screenshot`/…) verified over the reverse bridge; `canvas2d-fireworks` showcase runs + screenshots via `--runtime node`; `excalibur-jelly-jumper` renders its full Excalibur.js game via node-gi |
| **Bun** 1.3+ | Reverse bridge (same binary) + CLI host | Full node-gi core parity — 215/215; devtools + `canvas2d-fireworks` showcase verified via `--runtime bun` |
| **Deno** 2.9+ | Reverse bridge (prebuild) + CLI host | Conformance subset green — no postinstall build needed; devtools + `canvas2d-fireworks` showcase verified via `--runtime deno` |
| **Browser** | Build target + design system | 12 packages tested under Playwright (Firefox/SpiderMonkey); live showcases on this site |

A golden-diff conformance harness runs the same programs on `gjs`, `node`,
`bun` and `deno` and requires **byte-identical output**; the ported GNOME
GIMarshallingTests currently pass 343 cases on all four runtimes.

## What this means in practice

- **Ship desktop apps on GJS.** It remains the primary target — the runtime
  GNOME users already have installed, with the full framework surface.
- **Use Node.js, Bun or Deno where GJS isn't available** — dev tooling, CI,
  benchmarks, or editor integrations. `gjsify storybook --runtime node` is the
  canonical example: the same GTK storybook, running on Node.js.
- **node-gi is newer than the GJS side.** It is tested and released with
  every GJSify release, but a breaking change may still ship in a minor
  version. No GJSify package depends on it at runtime, so the reverse bridge
  can never destabilize a GJS build — see
  [Versioning](/gjsify/versioning/) for the stability model.

## Mobile: NativeScript (experimental)

A fifth direction is taking shape: the Adwaita widget set, storybook renderer
and devtools agent exist as **native NativeScript components** for Android and
iOS (`@gjsify/adwaita-nativescript` — real views, not a WebView), and
`gjsify build --app nativescript` produces bundles for the NativeScript
toolchain. The runtime target itself is still experimental; the widget packages are
tested and released with the regular GJSify releases.

## Related

- [How It Works](/gjsify/how-it-works/) — auto-aliasing, `--globals auto`, prebuilds
- [node-gi](/gjsify/projects/node-gi/) — the reverse bridge in depth
- [Coverage](/gjsify/coverage/) — live dashboards of the implemented surface
- [Versioning](/gjsify/versioning/) — release train and package tiers
