---
title: Architecture
description: Monorepo structure and GNOME library mappings
---

GJSify is an npm-workspaces monorepo, bootstrapped by its own CLI. `gjsify install` is the supported install path (no Yarn, no Node-only npm CLI required; see [Development Setup](/gjsify/contributing/development-setup/)).

## Monorepo structure

```
gjsify/
├── packages/
│   ├── node/                # Node.js API implementations (@gjsify/<name>)
│   ├── web/                 # Web API implementations + Adwaita design identity
│   ├── dom/                 # DOM element classes (dom-elements, canvas2d-core)
│   ├── framework/           # GTK host, bridges, storybook, devtools, adwaita-app shell
│   ├── nativescript-bridge/ # NativeScript (Android/iOS) native wrappers
│   ├── node-gi/             # GObject-Introspection runtime for Node/Bun/Deno
│   ├── napi/                # N-API host: native .node addons under GJS
│   ├── gjs/                 # GJS runtime, shared utils, @gjsify/unit test framework
│   └── infra/               # CLI, Rolldown / Vite plugins, build tools
├── showcases/       # Curated, published example applications
├── examples/        # Private dev/test examples
├── refs/            # Read-only reference submodules (Node.js, Deno, etc.)
└── website/         # This documentation site
```

## Build system

GJSify uses **Rolldown** (Vite 8's production bundler) with platform-specific plugins to produce different bundles from the same source:

- **GJS build** (`gjsify build --app gjs`): Aliases `node:*` and Web API imports to `@gjsify/*`, externalises `gi://*`, `cairo`, `system` and `gettext`. Target: `firefox140`.
- **Node build** (`gjsify build --app node`): Aliases `@gjsify/process` → `process`, maps aliased Web packages to their Node equivalents, and rewrites `gi://` imports to the [node-gi](/gjsify/projects/node-gi/) reverse bridge when the bundle uses them. Target: `node24`.
- **Browser build** (`gjsify build --app browser`): Standard browser target. Target: `esnext`.
- **NativeScript build** (`gjsify build --app nativescript`): Bundles for the NativeScript toolchain, where the Adwaita widget set renders as real Android and iOS views.

The alias table lives in `packages/infra/resolve-npm/lib/index.mjs`; the Rolldown plugins live in `packages/infra/rolldown-plugin-gjsify/`.

## GNOME library mapping

Each `@gjsify/*` package maps Node.js or Web APIs to native GNOME libraries:

| Node.js / Web API | GNOME Library |
|---|---|
| `fs` | `Gio.File`, `Gio.FileIOStream` |
| `net` | `Gio.SocketClient`, `Gio.SocketService` |
| `http` | `Soup.Server` |
| `crypto` | `GLib.Checksum`, `GLib.Hmac` |
| `process.env` | `GLib.getenv` / `GLib.setenv` |
| `url.URL` | `GLib.Uri` |
| `fetch` | `Soup.Session` |
| `WebSocket` | `Soup.WebsocketConnection` |
| Canvas 2D | `Cairo.ImageSurface`, `PangoCairo` |
| WebGL | `Gtk.GLArea`, OpenGL ES via `libepoxy` (Vala extension) |

## Five equal-priority pillars

GJSify treats the **Node.js API**, the **Web API**, the **DOM API**, the **Framework** layer and the **NativeScript bridge** as five equal pillars:

- `packages/node/`: Node.js builtins (`fs`, `http`, `crypto`, …)
- `packages/web/`: Web platform APIs (`fetch`, `WebSocket`, `ReadableStream`, Web Crypto, …)
- `packages/dom/`: DOM element classes (`HTMLCanvasElement`, `HTMLImageElement`, …) with headless Canvas 2D
- `packages/framework/`: everything that glues DOM and GTK together without being a spec implementation: the [GTK host](/gjsify/frameworks/) (`@gjsify/gtk-host`) that UI-framework renderers target, its [style partition](/gjsify/frameworks/styling/) (`@gjsify/gtk-host/style`), the [React Native layer](/gjsify/frameworks/react-native/) (`@gjsify/react-native`) over both, the [bridge widgets](/gjsify/patterns/bridges/), the [storybook](/gjsify/guides/storybook/), the [devtools control plane](/gjsify/guides/devtools/) and the [Adwaita app shell](/gjsify/guides/native-adwaita-app/)
- `packages/nativescript-bridge/`: the Adwaita widget set, storybook renderer and devtools agent as real Android and iOS views, plus the `node:fs` and platform bridges behind them

The DOM-element ↔ GTK-widget pairings are documented in [Bridge Widgets](/gjsify/patterns/bridges/).

## What the platform audit verifies

The `<os>-<arch>` marks on [Platform Support](/gjsify/platform-support/) come from `scripts/audit-runtimes.mjs --check`, the same rule the CI gate runs. [How It Works](/gjsify/how-it-works/#what-the-platform-marks-prove) says what each mark means to someone installing a package; this section is the audit behind them.

`✓` requires the binary to be committed in the bridge's per-target package (`@gjsify/<bridge>-<os>-<arch>`), not in the bridge's own tarball. Since that split the bridge itself carries no `prebuilds/` directory at all, so a cell that asked the bridge alone answered "declared and built" and printed `✓` for two bridges that commit nothing anywhere. The glyphs are now machine-checked against the directories on disk (`tests/e2e/ci-runner-arch`).

Every `○` target is held to a `release.yml` job that builds, load-tests and uploads it, because a release cannot download another workflow's artifact and that tarball is the only route by which one reaches a consumer. Two packages are in that state:

- **`@gjsify/napi`, both targets.** `napi.yml` rebuilds and gates on the linux-x64 prebuild, and its macOS job builds, load-tests and uploads the darwin-arm64 one. No job commits either back, and each per-target package says so in `package.json#gjsify.platformsUncommitted`, printed on every `--check` run. The linux-x64 directory used to be committed while its darwin sibling was exempt: one bridge running two policies, where every job that touched the path overwrote the checked-out bytes before reading them, and the declaration checks stayed green across a week of source drift. Deleting it made freshness real by removal, since the only linux-x64 artifact anyone can load is now the one CI produced in that same run.
- **`@gjsify/node-gi`, every declared target.** It builds with node-gyp at install time, or installs a prebuild straight from a release artifact, so there is no committed directory anywhere and no exemption entry to key the cell on: the absence *is* the state. `release.yml` carries a prebuild leg per target, which is what the audit checks.

The audit runs wherever CI runs it, today an `ubuntu-latest` x64 Node runner, and a prebuild for another architecture cannot be loaded there. Rather than skip those, it splits what it verifies and reports which half it did:

- **Structurally, on every committed artifact regardless of target.** The image's own machine field must match the directory it sits in (an ELF/Mach-O/PE header read, no `readelf` or `otool`); every `libgjsify*` sibling it records must be staged beside it and reachable through `$ORIGIN` or `@loader_path`; and every library leaf the typelib records must be present, because that leaf is what GObject-Introspection hands to the loader the moment a consumer resolves a class. This half caught both a missing macOS sibling cdylib and an emulated prebuild leg that compiled **x86-64** and staged it into `prebuilds/linux-{ppc64,s390x,riscv64}/`: `uraimo/run-on-arch-action` ignores its `arch` input whenever a custom `base_image` is supplied, so every other check passed and the artifact even loaded on the runner. Only reading the machine field against the directory name catches that.
- **Functionally, only for the checking host's own target.** The library is `dlopen`ed with every library-path environment variable stripped, which proves the self-relative sibling hop for real instead of inferring it from the headers. A bridge whose *system* dependencies the runner lacks (libsoup, GStreamer, libgda) is reported as not-load-tested, never as broken, because that would be a fact about the runner rather than the artifact.

So `✓` means "declared, targeted by a CI job, and committed with a structurally sound artifact". It does not mean anyone has run that artifact on that architecture. The per-run summary states both numbers separately.

Every column name is a real directory name, spelled the one way a running process can compute about itself, `${process.platform}-${process.arch}`, so `gjsify.platforms`, the committed `prebuilds/<target>/`, the CI job that builds it and the resolver that loads it all use the same string.

## How the cross-runtime claims are checked

A golden-diff conformance harness runs the same programs on `gjs`, `node`, `bun` and `deno` and requires **byte-identical output**. A diff needs one side to diff against, and that side is the `gjs` output, itself checked against a committed golden file wherever the scenario has one. That makes gjs the yardstick for the comparison, which is a fact about the test rig and not advice about which runtime to build on. The ported GNOME GIMarshallingTests currently stand at 370 passing and none failing.

Linux is the CI baseline: the full suite (10,000+ cases across Node and GJS), every e2e suite and every integration suite run on Fedora. The other two operating systems are covered by named jobs rather than by a runtime-class claim:

- **macOS** runs `@gjsify/node-gi`'s own CI (build, conformance, a real GTK/Adwaita window, the full Adwaita storybook), `@gjsify/napi`'s build and gates, and the native-bridge prebuild job. Two jobs run the `@gjsify/*` suites themselves: `main.yml`'s `macos` job executes a curated subset of `--app gjs` bundles on arm64 under Homebrew `gjs` 1.88, and `macos-suites.yml` runs the Node-pillar suites on both `test:node` and `test:gjs`, on darwin-arm64 and darwin-x64, on every pull request as well as on `main` and the nightly. macOS is the only one of the three where both legs can run at all, which is the point of running them: `test:node` says the spec is right, `test:gjs` says the port is.
- **Windows** runs `@gjsify/node-gi`'s CI including a real GTK window and the storybook, using a bundled GTK runtime rather than a system install, plus the Node-pillar `@gjsify/*` suites in `windows-suites.yml`, on every pull request as well as on `main` and the nightly. Those run under **cmd.exe with the git-bash utilities stripped from `PATH`**, because Git for Windows supplies a real `rm`, `cp` and `sh` that npm's `%COMSPEC%` scripts do not have, and testing from git-bash reports false greens.

The macOS `--app gjs` bundles are built on the Fedora leg and executed on macOS. That split is a cost decision rather than a capability one. `@gjsify/rolldown-native`, the bundler engine `gjsify build` uses under GJS, is built, staged and load-tested under Homebrew `gjs` on both darwin arches by `prebuilds.yml`, and its `darwin-arm64` and `darwin-x64` artifacts are committed. What no job does yet is drive `gjsify build` under GJS on macOS end to end, and standing that up would mean a full `gjsify install` on a runner billed at 10x. A `--app gjs` bundle is a single self-contained file whose only unbundled imports are `gi://GLib`, `gi://Gio` and `gi://GioUnix`, so building it on Linux and running it on macOS is sound. It verifies **runtime** behaviour on macOS, not the build toolchain there.

Bun and Deno share the `node` runtime slot through the Node-API common ABI, and `main.yml`'s `cross-runtime` job tests that rather than assuming it: one engine-agnostic `--app node` bundle per package, run on all three runtimes. The selection rule matters. A spec that imports `node:path` gets the *host runtime's* builtin, because the `--app node` bundle externalises it, so such a leg would test Bun rather than the polyfill. Every covered package either imports its own package by name, imports a bare Web specifier that the alias table routes to the polyfill, or is infra code that is nobody's builtin.

The four defects that first darwin run found are recorded in [ADR 0018](https://github.com/gjsify/gjsify/blob/main/docs/adr/0018-os-axis-declaration.md) § *darwin re-measured*. `macos-suites.yml` re-measures on every run the macOS loader fact that invalidates the obvious fix for a `dyld` problem: SIP strips every `DYLD_*` variable at the first `/bin/sh` boundary, so a wrapper cannot hand the loader a path ([ADR 0024](https://github.com/gjsify/gjsify/blob/main/docs/adr/0024-ship-installable-artifacts.md) § 3).
