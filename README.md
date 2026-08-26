# gjsify

**The JavaScript ecosystem you already know — running natively on GNOME.**

**[Documentation](https://gjsify.github.io/gjsify/)** · [Project status](status/) · [Architecture & contributor guide](AGENTS.md)

---

## What is gjsify?

GNOME desktop apps can be written in JavaScript through **GJS** (GNOME's
JavaScript runtime, powered by SpiderMonkey). But GJS is not Node.js and it is
not a browser: there is no `node:fs`, no `fetch`, no `<canvas>`, no npm ecosystem
waiting for you. Whole categories of libraries — an HTTP client, a game engine,
a crypto library, a WebRTC stack — simply assume APIs that GJS doesn't have.

**gjsify fills that gap.** It reimplements the Node.js, Web, and DOM APIs *on top
of GNOME's own libraries*, so the code and packages you already know just work
when you build a native GNOME application:

| You write… | gjsify runs it on… |
|---|---|
| `node:fs`, `node:net`, `node:crypto` | `Gio`, `GLib` |
| `fetch`, `WebSocket`, `XMLHttpRequest` | `Soup 3` |
| `<canvas>` 2D / WebGL | `Cairo` / `Gtk.GLArea` (OpenGL ES) |
| `WebRTC`, `WebAudio`, `<video>` | `GStreamer` |
| `node:sqlite` | `libgda` |

No wrapper server, no bundled Chromium, no shelling out to Node — the
implementations *are* native GNOME code. The result is a real GTK 4 / Adwaita
Linux app that also speaks the language of the wider JavaScript world.

## The goal

gjsify's north star is **"write once with the APIs you already know, run where it
makes sense — natively."**

- **Native on GNOME first.** GJS is the primary, non-negotiable target. A gjsify
  app is a first-class GTK/Adwaita citizen you can ship as a Flatpak.
- **The ecosystem, unmodified.** The measure of success is *unmodified npm
  packages running on GJS*. Real proof today: the [Excalibur.js](https://excalibur.js.org/)
  game engine, WebTorrent, socket.io, three.js, axios, and the Anthropic MCP SDK
  all run on GJS through gjsify's polyfills — validated by their own upstream test
  suites.
- **One source, many runtimes.** Most polyfills are pure TypeScript and therefore
  portable. Each package declares its reach across **GJS · Node · Browser ·
  NativeScript**, and the build routes each import to the right implementation.
  Share what's shareable; be native where it counts.
- **Node-free by design.** The whole toolchain — install, build, run, test,
  publish, Flatpak — runs *on GJS itself*. You can develop and ship a GNOME
  JavaScript app on a machine that has no Node.js at all.

## See it in action

Standard Node.js code — the bundler resolves `node:*` imports to their `@gjsify/*`
implementations when you target GJS:

```typescript
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const content = readFileSync('/etc/hostname', 'utf8');
const hash = createHash('sha256').update(content).digest('hex');
writeFileSync('/tmp/hostname-hash.txt', hash);
```

Web APIs work too — this really goes out over `libsoup`:

```typescript
const zen = await (await fetch('https://api.github.com/zen')).text();
console.log(zen);
```

And the bridges let a browser-shaped library drive real GTK widgets. A `<canvas>`
becomes a `Gtk.DrawingArea` (2D) or `Gtk.GLArea` (WebGL); an `<iframe>` becomes a
`WebKit.WebView` — so an engine written for the browser renders inside your
Adwaita window, unchanged.

## Quick start

**Install the CLI** (Node-free bootstrap — needs only `gjs` ≥ 1.86 and `curl`):

```bash
curl -fsSL https://github.com/gjsify/gjsify/releases/latest/download/install.mjs \
  -o /tmp/g.mjs && gjs -m /tmp/g.mjs && rm /tmp/g.mjs
```

This lays down `@gjsify/cli` under `~/.local/share/gjsify/global/` and a launcher
at `~/.local/bin/gjsify` — no `npm` / `node` required on the machine. Run
`gjsify self-update` to refresh in place, or `gjsify uninstall -g @gjsify/cli` to
remove. Already manage CLIs through Node? `npm install -g @gjsify/cli` works too.

**Create and run a project:**

```bash
gjsify create my-app --template gtk-minimal
cd my-app
gjsify install      # resolves npm deps via the Node-free CLI bundle
gjsify run build    # the template's own build script — Rolldown, GJS + Node bundles
gjsify run start    # launch the GJS bundle
```

`gjsify create` scaffolds a ready-to-run GTK 4 + TypeScript application, build
scripts included. `run build` emits a GJS bundle and a Node/Bun/Deno one from the
same `src/index.ts`; `gjsify run dev` builds only the GJS half and launches it,
which is the loop you want while editing. Leave `--template` off and the CLI asks
which template you want. Once you commit the `gjsify-lock.json` that `install`
writes, CI can use `gjsify install --immutable` for a reproducible tree — it fails
when the lockfile is missing or has drifted from `package.json`.

### Using the CLI directly

```bash
gjsify build src/index.ts --app gjs --outfile dist/app.js  # build a TS file for GJS
gjsify run dist/app.js                                     # run it (prebuild paths auto-set)
gjsify dlx <pkg>                                           # try a published app, no install
```

`--app` is spelled out because it has no fixed default: it follows the runtime the CLI
itself is running on — `gjs` via the bootstrap above, `node` via `npm install -g`. Omit it
on a Node-installed CLI and you get a Node bundle, not a GJS one.

### Prerequisites

The runtime requirement is **GJS ≥ 1.86** (SpiderMonkey 140 / ES2024 — ships with
Fedora 43+ and Ubuntu 25.10+), plus the GNOME development libraries for the
features you use:

```bash
# Fedora
sudo dnf install gjs glib2-devel gobject-introspection-devel gtk4-devel \
  libsoup3-devel webkitgtk6.0-devel libadwaita-devel gdk-pixbuf2-devel \
  libepoxy-devel libgda libgda-sqlite meson vala gcc pkgconf

# Ubuntu
sudo apt install gjs libglib2.0-dev libgirepository1.0-dev libgtk-4-dev \
  libsoup-3.0-dev libwebkitgtk-6.0-dev libadwaita-1-dev libgdk-pixbuf-2.0-dev \
  libepoxy-dev libgda-6.0-dev meson valac gcc pkg-config
```

Node.js 24+ is **optional** — needed only to run the cross-validation test track
(every unit test is mirrored on Node + GJS) or to manage the CLI via npm.

### Ship your own app

- **A `.deb` and an `.rpm`:** `gjsify ship` runs your project's `build` script,
  stages one payload and wraps it per format — no packaging manifest in your repo,
  and no `dpkg-deb` / `rpmbuild` on the machine. The package depends on the
  distribution's own `gjs`, GTK and typelibs, worked out by reading your bundle.
  Linux and `--app gjs` today; see [Ship your app](https://gjsify.github.io/gjsify/ship/).
- **A Flatpak:** `gjsify flatpak init` generates the full Flathub asset set
  (manifest + MetaInfo + `.desktop` + `flathub.json`) from one `package.json`
  block; `gjsify flatpak check` runs `appstreamcli` + `flatpak-builder-lint`
  locally; `gjsify flatpak build` wraps `flatpak-builder`. See the
  [Flatpak app](https://gjsify.github.io/gjsify/guides/flatpak-app/) and
  [Flatpak CLI](https://gjsify.github.io/gjsify/guides/flatpak-cli-tool/) guides.
- **A one-line installer:** `gjsify generate-installer` scaffolds an `install.mjs`
  parameterised to your package, so your users install with a single
  `curl … | gjs -m -` — no npm / Node on their machine.
- **A single executable file:** `gjsify build --shebang` marks the bundle
  executable with a target-appropriate shebang, to download and run as-is.

## Package status

> The **always-current** package matrix, per-package implementation notes, test
> counts and metrics are generated on demand from the authored data in
> **[`status/`](status/)** plus the package manifests — run
> `npm run status:generate` to render the full snapshot into a (gitignored)
> `STATUS.md`. The tables below are a high-level snapshot.

gjsify is a monorepo of `@gjsify/*` packages, organised as four pillars plus the
toolchain. How many there are is derived, not typed — `npm run status:generate`
counts them; the note above says where from.

### Node.js modules (`packages/node/`)

| Status | Packages |
|--------|----------|
| **Full** | assert, async_hooks, buffer, child_process, console, constants, crypto, dgram, diagnostics_channel, dns, events, fs, globals, http, http2, https, module, net, os, path, perf_hooks, process, querystring, readline, stream, string_decoder, sys, timers, tls, tty, url, util, zlib — plus native bridges: terminal-native, sab-native, tls-native, http-soup-bridge, http2-native |
| **Partial** | sqlite (libgda-backed subset), ws (no perMessageDeflate/ping-pong events), worker_threads (subprocess-based + cross-process SAB), vm (eval-based, no realm isolation), v8 (stub) |
| **Stub** | cluster, domain, inspector |

### Web APIs (`packages/web/`)

`fetch`, `xmlhttprequest`, `websocket`, `webcrypto`, `webrtc` (+ `webrtc-native`
Vala prebuild), `webaudio`, `web-streams`, `compression-streams`, `eventsource`,
`abort-controller`, `dom-events`, `dom-exception`, `domparser`, `formdata`,
`gamepad`, `webstorage`, `web-globals`. Design identity for browser targets:
`adwaita-web` (Web Components), `adwaita-fonts`, `adwaita-icons`, plus the headless
`adwaita-core` and the browser `adwaita-storybook`.

### DOM & framework bridges (`packages/dom/`, `packages/framework/`)

| Package | Backed by | Provides |
|---------|-----------|----------|
| canvas2d-core | Cairo, PangoCairo | Headless `CanvasRenderingContext2D`, gradients, patterns, `Path2D`, `ImageData` |
| canvas2d | canvas2d-core, Gtk 4 | Re-exports canvas2d-core + `FontFace` + `Canvas2DBridge` → `Gtk.DrawingArea` |
| dom-elements | GdkPixbuf, canvas2d-core | `Node`, `Element`, `HTMLCanvasElement` (auto-registers `'2d'`), `HTMLImageElement`, `Document` |
| gtk-host | Adw, Gtk 4, Gdk 4, GObject | Framework-agnostic element model (`createElement`/`insert`/`setProp`) that UI-framework renderers bind to; 26 GTK 4 + libadwaita descriptors carry each container's adoption rule |
| react-native | Adw, Gtk 4, gtk-host | React Native's export surface on GTK4 — the package a bundler aliases `react-native` to. A support table carries a status and a reason for all 92 names react-native exports, and an unimplemented one refuses with that reason instead of being absent |
| event-bridge | Gtk 4, Gdk 4 | GTK → DOM event mapping (Mouse, Pointer, Keyboard, Wheel, Focus) |
| iframe | WebKit 6.0 | `HTMLIFrameElement`, `IFrameBridge` → `WebKit.WebView` |
| video | Gst 1.0, Gtk 4 | `HTMLVideoElement`, `VideoBridge` → `Gtk.Picture` (gtk4paintablesink) |
| webgl | gwebgl (Vala) | WebGL 1.0/2.0, `WebGLBridge` → `Gtk.GLArea` |

The framework pillar also ships the **GTK host** — the element model
Vue/React/Solid/Angular renderers bind to, where each container's adoption rule is
data in a descriptor table — plus composition helpers, a GTK **Storybook**, and
**devtools** you can drive over D-Bus to screenshot and inspect a running GJS app.

### GNOME library mappings

| Node.js / Web / DOM | GNOME |
|---|-------|
| fs · net · child_process · dns · tls | Gio (File, Socket, Subprocess, Resolver, TLS) |
| http · https · fetch · XHR · WebSocket · EventSource | Soup 3.0 |
| crypto | GLib.Checksum, GLib.Hmac |
| process · url | GLib (env, pid, cwd, Uri) |
| sqlite | libgda (SQLite provider) |
| WebRTC · WebAudio · Video | GStreamer (`webrtcbin`, `decodebin`, gtk4paintablesink) + Vala bridges |
| Canvas 2D | Cairo + PangoCairo |
| WebGL | Gtk.GLArea + libepoxy (via `gwebgl` Vala) |
| Iframe | WebKit.WebView |
| Gamepad | libmanette |

## Versioning & compatibility

All `@gjsify/*` packages ship as one coherent **release train**: every release
publishes the whole set at a single version, tested against each other at exactly
that version. Compatibility is guaranteed **only within the same release** — don't
mix versions. Upgrade them together:

```bash
gjsify upgrade --latest --filter @gjsify   # bump every @gjsify/* dep to the latest train
gjsify upgrade --align                     # monorepos: re-align deps drifted across workspaces
gjsify upgrade --check                     # CI gate: fail on drifted ranges
```

Rationale: [ADR 0008 — Release-train versioning policy](docs/adr/0008-release-versioning-policy.md).

## Project structure

```
packages/
  node/       # Node.js API packages (@gjsify/<name>) + polyfill metas
  web/        # Web API packages (fetch, XHR, WebSocket, WebRTC, WebAudio, …) + adwaita-*
  dom/        # DOM spec impls (canvas2d-core, dom-elements)
  framework/  # GTK bridges, Storybook, devtools, app shell
  gjs/        # GJS utilities, types, the @gjsify/unit test framework
  infra/      # CLI, Rolldown/Vite plugins, native engine bridges, create-app
  nativescript-bridge/   # native mobile widgets + bridges (NativeScript axis)
examples/     # dev/test examples (Express, Hono, socket.io, three.js, WebGL, …)
showcases/    # polished, published examples run via `gjsify showcase`
tests/
  e2e/          # end-to-end CLI / build / run tests
  integration/  # curated upstream suites (webtorrent, socket.io, streamx, Autobahn, …)
refs/         # read-only reference submodules (Node.js, Deno, Bun, WebKit, GStreamer, …)
```

## Development

```bash
gjsify install --immutable      # reproducible workspace install from gjsify-lock.json
gjsify foreach -A -t build      # build every package in topological order
gjsify check                    # type-check all packages (self-hosted gjsify tsc)
gjsify foreach -A test          # run every package's tests on GJS + Node
```

Per-package: `cd packages/node/fs && gjsify test` builds and runs `src/test.mts`
on both runtimes and aggregates the result (`--runtime gjs|node` to scope,
`--rebuild` / `--no-build` to control the build).

**Testing philosophy:** every test runs on both Node.js and GJS — Node validates
that the *test* is correct, GJS validates that the *implementation* is. Node is
therefore needed to develop the polyfills, but never to consume them. The full
contributor guide starts at [AGENTS.md](AGENTS.md), which holds the repo-wide rules
and routes to a per-subtree `AGENTS.md` (`packages/*/`, `tests/`) plus reference
material under [docs/](docs/) — read the root, then the one for what you are
touching. Cross-cutting decisions are recorded as [ADRs](docs/adr/).

## Target environment

- **GJS 1.86+** (SpiderMonkey 140 / ES2024) — runtime
- **Node.js 24.x** — optional, only for the cross-validation test track
- Rolldown target `firefox140`, ESM-only, TypeScript 6.x

## License

See individual package licenses; most packages are MIT.
