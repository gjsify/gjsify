# gjsify

**The JavaScript ecosystem you already know — running natively on GNOME.**

**[Documentation](https://gjsify.github.io/gjsify/)** · [Package status & metrics](STATUS.md) · [Architecture & contributor guide](AGENTS.md)

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

This installs `@gjsify/cli` under `~/.local/share/gjsify/` with a launcher at
`~/.local/bin/gjsify` — no `npm` / `node` required. (`gjsify self-update` refreshes
it; `gjsify uninstall -g @gjsify/cli` removes it. Already manage CLIs through
Node? `npm install -g @gjsify/cli` works too.)

**Create and run a project:**

```bash
gjsify create my-app
cd my-app
gjsify install --immutable   # resolves npm deps via the Node-free CLI bundle
gjsify build                 # Rolldown-based, GJS target by default
gjsify run start
```

`gjsify create` scaffolds a ready-to-run GTK 4 + TypeScript application.

### Prerequisites

The runtime requirement is **GJS ≥ 1.86** (SpiderMonkey 140 / ES2024 — Fedora 43+,
Ubuntu 25.10+), plus the GNOME development libraries for the features you use:

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

## What's inside

gjsify is a monorepo of ~130 `@gjsify/*` packages, organised as four pillars plus
the toolchain:

- **Node.js** — `fs`, `net`, `http`/`http2`, `crypto`, `streams`, `child_process`,
  `sqlite`, `worker_threads`, `tls`, `ws`, and more, with optional native Vala
  bridges (cross-process `SharedBuffer`, terminal control, HTTP/2).
- **Web** — `fetch`, `WebSocket`, `WebCrypto`, `WebRTC`, `WebAudio`, Streams,
  `EventSource`, `XMLHttpRequest`, `AbortController`, and friends.
- **DOM & bridges** — a headless `CanvasRenderingContext2D` (Cairo), WebGL,
  DOM elements, a GTK→DOM event bridge, `<iframe>`/`<video>` bridges.
- **Framework** — composition helpers, a Storybook, and in-app devtools you can
  drive over D-Bus to screenshot and inspect a running GJS app.
- **Toolchain** (`@gjsify/cli`) — Node-free `install` / `build` / `run` / `test` /
  `publish` / `flatpak`, a self-hosted TypeScript checker (`gjsify tsc`), and a
  Rolldown-based bundler with GJS / Node / Browser / NativeScript targets.

> The **always-current package matrix, implementation status, test counts, and
> metrics live in [STATUS.md](STATUS.md)** — kept in lockstep with the code so
> this README doesn't drift. For how it all fits together and how to contribute,
> see **[AGENTS.md](AGENTS.md)** and the [Architecture Decision Records](docs/adr/).

### Ship it

- **A one-line installer for your own app:** `gjsify generate-installer` scaffolds
  an `install.mjs` so your users install with a single `curl … | gjs -m -` — no
  npm / Node on their machine.
- **A Flatpak:** `gjsify flatpak init` generates the full Flathub asset set
  (manifest + MetaInfo + `.desktop` + `flathub.json`) from one `package.json`
  block; `gjsify flatpak check` runs the Flathub linters locally. See the
  [Flatpak app](https://gjsify.github.io/gjsify/guides/flatpak-app/) and
  [Flatpak CLI](https://gjsify.github.io/gjsify/guides/flatpak-cli-tool/) guides.

## Versioning & compatibility

All `@gjsify/*` packages ship as one coherent **release train**: every release
publishes the whole set at a single version, tested against each other at exactly
that version. Compatibility is guaranteed **only within the same release** — don't
mix versions. Upgrade them together:

```bash
gjsify upgrade --latest --filter @gjsify   # bump every @gjsify/* dep to the latest train
gjsify upgrade --check                     # CI gate: fail on drifted ranges
```

Rationale: [ADR 0008 — Release-train versioning policy](docs/adr/0008-release-versioning-policy.md).

## Development

```bash
gjsify install --immutable      # reproducible workspace install from gjsify-lock.json
gjsify foreach -A -t build      # build every package in topological order
gjsify check                    # type-check all packages (self-hosted gjsify tsc)
gjsify foreach -A test          # run every package's tests on GJS + Node
```

**Testing philosophy:** every test runs on both Node.js and GJS — Node validates
that the *test* is correct, GJS validates that the *implementation* is. Node is
therefore needed to develop the polyfills, but never to consume them. The full
contributor guide (conventions, package layout, the tree-shakeable-globals rules,
the `refs/` reference submodules) is in [AGENTS.md](AGENTS.md).

## License

See individual package licenses; most packages are MIT.
