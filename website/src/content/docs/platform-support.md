---
title: Platform Support
description: Which operating systems GJSify actually runs on today — per runtime, per native bridge, with the known gaps named.
---

GJSify has **two independent axes**, and they are easy to confuse:

- The **runtime** axis — GJS, Node.js, Bun, Deno, the browser, NativeScript. This is
  what [Runtimes](/gjsify/runtimes/) describes, and what each package declares in
  `package.json#gjsify.runtimes`.
- The **operating system** axis — Linux, macOS, Windows. A package can be perfectly
  cross-*runtime* and still be Linux-only, because the native bridge underneath it
  only ever gets built for Linux.

This page is about the second axis. It exists because the first one used to be the
only one anybody tracked, and that is how a set of Linux-only native bridges ended
up underneath a project that described itself as platform-independent.

## The short answer

| | Linux | macOS | Windows |
|---|---|---|---|
| **Apps on GJS** (`--app gjs`) | supported | partial — see below | not available (no GJS host) |
| **Apps on Node/Bun/Deno** (`--app node`, via `@gjsify/node-gi`) | supported | supported | supported |
| **Browser builds** (`--app browser`) | supported | supported | supported |
| **The Node-free toolchain** (`gjsify build` under GJS) | supported | **not yet** | not available |

Browser builds carry no native bridge at all, so they are portable by
construction. The GJS side is where the operating system matters.

## Why Windows has no GJS host

`@gjsify/node-gi` runs on Windows because it links the portable
GObject-Introspection stack, which gvsbuild ships. Anything that needs **GJS
itself** does not, because there is no prebuilt `libgjs` for Windows: GNOME's own
gjs CI is Linux-only, and gjs must be source-built against a SpiderMonkey that
Windows package managers do not provide in a form its build system consumes.

This is a genuine upstream blocker, not a missing task. It is tracked in
`status/open-todos.md` with the exact conditions that would unblock it.

## Working on gjsify FROM Windows

No GJS host does not mean no development host. Under Node, a Windows machine
runs the toolchain: `gjsify install`, `gjsify run build:infra`, `gjsify build`
(`--app node`, `--app browser`, and `--library`), `gjsify check`, `gjsify clear`,
`gjsify copy`, the conformance audit (`node scripts/audit-runtimes.mjs --check`),
the install backend with its `.cmd`/`.ps1`/`sh` bin shims, and `@gjsify/cli`'s
own test suite. All of that is verified on win32 x64 / Node 24 with no POSIX
utilities on PATH.

Showcases run too, on the runtimes that are not GJS:

```powershell
gjsify showcase                                   # list them
gjsify showcase express-webserver                 # runs on node here
gjsify showcase express-webserver --runtime bun   # or deno
```

`gjsify showcase` picks the runtime itself — gjs when a gjs is installed,
otherwise the host runtime — so on Windows that middle line runs the showcase's
`--app node` bundle without being told to. A showcase that declares no support
for the chosen runtime says so instead of crashing.

What a Windows checkout cannot do is anything that ends in a `gjs` process:
`--app gjs` bundles, `test:gjs`, and the showcases and examples built around
them. That is the same upstream blocker as above, not a separate gap. Concretely
it means a showcase's `build:node` succeeds where its sibling `build:gjs` cannot,
so build the target you can actually run.

Two host settings matter, and both fail in ways that do not name themselves:

- **Long paths.** Set `HKLM\SYSTEM\CurrentControlSet\Control\FileSystem
  \LongPathsEnabled` to `1` (needs elevation), and keep the checkout short —
  `C:\src\…` rather than a deep home directory. A monorepo with nested
  `node_modules` exceeds `MAX_PATH` quickly.
- **Line endings.** Set `core.autocrlf=false` before you clone. The
  byte-verified artifacts are safe either way — `.gitattributes` pins the
  committed `*.gjs.mjs` bundles and `@gjsify/tsc`'s shipped libs to LF whatever
  you configure, because otherwise `verify-committed-bundles.mjs` reports them
  stale for files you never touched. The setting still matters for everything
  else: 744 files in `tests/`, `showcases/`, `website/`, `templates/` and
  `status/` are committed with CRLF, and with Git for Windows' recommended
  `core.autocrlf=true` they all show as modified the moment you clone. Tracked
  in `status/open-todos.md`; closing it needs a repo-wide renormalisation.

Optionally, enable **Developer Mode** so unprivileged file symlinks work. It is
not required: `gjsify install` links workspace packages with NTFS junctions,
which need no privilege. Three test rows do need real file symlinks and report
themselves as skipped with that reason when the capability is absent.

One caveat when testing, because it produces false greens: run commands the way
npm does, through `cmd.exe`. A git-bash shell puts `C:\Program Files\Git\usr\bin`
on PATH, so `chmod`, `cp`, `rm` and `which` resolve there and a script that
cannot work for a normal user appears to.

## Why macOS has no Node-free toolchain yet

`gjsify build` under GJS needs a bundler, and `@gjsify/rolldown-native` is the only
bundler engine that runs there.

The Rust-level blocker is gone: the wakeup channel that drives the plugin bridge used
to be three `eventfd(2)` descriptors — a Linux-only syscall the `libc` crate does not
expose on Apple targets, so the crate did not compile for macOS at all. It is now
three anonymous pipes, one portable implementation on every platform, and
`cargo check --target aarch64-apple-darwin` passes.

What is still missing is a *native* macOS build: nothing has linked the library,
generated its typelib, or loaded it under Homebrew's `gjs` yet. Until that leg is
green, a macOS user needs Node.js for the build step and then runs the result on GJS.

Everything else in the toolchain (`@gjsify/lightningcss-native`,
`@gjsify/oxfmt-native`) already builds for macOS.

## Native bridge matrix

Native bridges are the packages that ship a compiled artifact. Each declares the
`<os>-<arch>` targets it promises in `package.json#gjsify.platforms`, and CI is held
to that declaration in both directions — a promised target that nothing builds and a
built target that nothing promises are both hard failures.

A declaration is not enough on its own, so `scripts/audit-runtimes.mjs --check` also
holds the promise to a **body**: every declared target of a package that names a
committed `prebuilds/` directory must have that directory, holding a shared library
in that OS's format plus the GI typelib that names it. Those artifacts are then
verified as far as the checking host allows — see
[What the checks actually prove](#what-the-checks-actually-prove) below.

<!-- Regenerate with: node scripts/audit-runtimes.mjs --platforms --markdown -->

| package | tier | darwin-arm64 | darwin-x64 | linux-arm64 | linux-ppc64 | linux-riscv64 | linux-s390x | linux-x64 | win32-x64 |
|---|---|---|---|---|---|---|---|---|---|
| `@gjsify/http-soup-bridge` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/http2-native` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/lightningcss-native` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/napi` | 3 | ○ | · | · | · | · | · | ○ | · |
| `@gjsify/node-gi` | 2 | ○ | ○ | ○ | · | · | · | ○ | ○ |
| `@gjsify/oxfmt-native` | 1 | ✓ | ✓ | ✓ | · | · | · | ✓ | · |
| `@gjsify/rolldown-native` | 1 | ✓ | ✓ | ✓ | · | · | · | ✓ | · |
| `@gjsify/sab-native` | 1 | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/terminal-native` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/tls-native` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/webgl` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/webrtc-native` | 1 | · | · | ✓ | ✓ | ✓ | ✓ | ✓ | · |

`✓` declared, a CI job targets it, artifact committed ·
`○` declared, a CI job targets it, artifact NOT committed here ·
`⚠` committed artifact, no CI job targets it · `!` declared, no CI job targets it ·
`?` produced, undeclared · `·` unsupported

The marks are read out of the workflow YAML, so "a CI job targets it" is exactly
what they claim — not that a green run of that job exists. `○` in particular says
nothing about whether the job currently succeeds.

One row per bridge, and `✓` means the binary is committed **in this repository** —
in the bridge's per-target package (`@gjsify/<bridge>-<os>-<arch>`, an
`optionalDependencies` entry a package manager installs or silently skips), not in
the bridge's own tarball. Since that split the bridge itself carries no
`prebuilds/` directory at all, so a cell that asked the bridge alone answered
"declared and built" and printed `✓` for two bridges that commit nothing anywhere;
the glyphs are now machine-checked against the directories on disk
(`tests/e2e/ci-runner-arch`).

Every column above is a real directory name. Targets are spelled the one way a running
process can compute about itself — `${process.platform}-${process.arch}` — so
`gjsify.platforms`, the committed `prebuilds/<target>/`, the CI job that builds it and
the resolver that loads it all use the same string, with nothing to translate between them.

### `○` — declared and built, artifact not in this repository

`○` is the one state that needs reading carefully: CI produces the artifact, but
this repository does not carry it, so a `git clone` has nothing to load and an
`npm install` gets whatever the last publish shipped. It is never a gap the audit
overlooked — every `○` target is held to a `release.yml` job that builds,
load-tests and uploads it, because a release cannot download another workflow's
artifact and that tarball is the only route by which one reaches a consumer. The
two current causes:

- **`@gjsify/napi`, both targets** — `napi.yml` rebuilds and gates on the
  linux-x64 prebuild, and its macOS job builds, load-tests and uploads the
  darwin-arm64 one; no job commits either back, and each per-target package states
  exactly that in `package.json#gjsify.platformsUncommitted`, printed on every
  `--check` run. The linux-x64 directory used to be committed while its darwin
  sibling was exempt — one bridge running two policies, where every job that
  touched the path overwrote the checked-out bytes before reading them and the
  declaration checks stayed green across a week of source drift. Deleting it made
  freshness real by removal: the only linux-x64 artifact anyone can load is now one
  CI just built.
- **`@gjsify/node-gi`, every declared target** — it builds with node-gyp at install
  time, or installs a prebuild straight from a release artifact, so there is no
  committed directory anywhere and no exemption entry to key the cell on: the
  absence *is* the state. `release.yml` carries a prebuild leg per target, which is
  what the audit checks.

Check the matrix against reality at any time:

```bash
node scripts/audit-runtimes.mjs --platforms            # human-readable
node scripts/audit-runtimes.mjs --platforms --markdown # this table
node scripts/audit-runtimes.mjs --check                # CI gate, every audit
```

### What the checks actually prove

The audit runs wherever CI runs it — today an `ubuntu-latest` x64 Node runner — and a
prebuild for another architecture cannot be loaded there. Rather than skip those, the
audit splits what it verifies and says which it did:

- **Structurally, on every committed artifact regardless of target.** The image's own
  machine must match the directory it sits in (an ELF/Mach-O/PE header read, no
  `readelf`/`otool`); every `libgjsify*` sibling it records must be staged beside it
  and reachable through `$ORIGIN`/`@loader_path`; and every library leaf the typelib
  records must be present, because that leaf is what GObject-Introspection hands to
  the loader the moment a consumer resolves a class. This is the half that caught
  both the missing macOS sibling cdylib and an emulated prebuild leg that compiled
  **x86-64** and staged it into `prebuilds/linux-{ppc64,s390x,riscv64}/`:
  `uraimo/run-on-arch-action` ignores its `arch` input whenever a custom
  `base_image` is supplied, so every other check passed and the artifact even
  loaded on the runner. Only reading the image's own machine field against its
  directory name catches that.
- **Functionally, only for the checking host's own target.** The library is
  `dlopen`ed with every library-path environment variable stripped, which proves the
  self-relative sibling hop for real instead of inferring it from the headers. A
  bridge whose *system* dependencies the runner lacks (libsoup, GStreamer, libgda)
  is reported as not-load-tested, never as broken — that would be a fact about the
  runner, not the artifact.

So a `✓` means "declared, targeted by a CI job, and committed with a structurally
sound artifact"; it does not mean anyone has run that artifact on that architecture.
The per-run summary states both numbers separately.

## What a missing bridge actually costs you

A native bridge is always optional at runtime — every one of them is loaded through
a guarded `imports.gi` probe with a predicate (`hasNativeSab()`, `hasNativeTls()`,
…), so a missing prebuild degrades rather than crashes. What you lose:

| bridge | without it |
|---|---|
| `@gjsify/http-soup-bridge` | `@gjsify/http`'s server loses its GC-safe Soup message wrapper |
| `@gjsify/http2-native` | no raw h2c; `createServer()` stays HTTP/1.1 |
| `@gjsify/tls-native` | no OCSP parsing, no TLS session resumption or channel binding |
| `@gjsify/terminal-native` | `isatty`/window size/raw mode fall back to env heuristics |
| `@gjsify/sab-native` | no cross-process `SharedBuffer`; the rest of `worker_threads` is unaffected |
| `@gjsify/webgl`, `@gjsify/webrtc-native` | WebGL / WebRTC unavailable |

`@gjsify/sab-native` is the one bridge that is Linux-only **by design** rather than
by missing CI: it is built on `memfd_create`, Linux `futex` syscalls and
`SCM_RIGHTS`. The reasoning, including why the obvious "portable" rewrite is a worse
contract, is written up in
[ADR 0013](https://github.com/gjsify/gjsify/blob/main/docs/adr/0013-sab-native-platform-scope.md).

## What is verified, and where

Following the project's own rule — describe what is actually validated, by name,
rather than making a runtime-class claim:

- **Linux** is the CI baseline. The full test suite (10,000+ cases across Node and
  GJS), every e2e suite and every integration suite run on Fedora.
- **macOS** is covered by `@gjsify/node-gi`'s own CI (build, conformance, a real
  GTK/Adwaita window, the full Adwaita storybook), by `@gjsify/napi`'s build and
  gates, and by the native-bridge prebuild job. Since the `macos` job in
  `main.yml`, a **named subset** of the `@gjsify/*` GJS suites also runs on
  macOS/arm64 under Homebrew `gjs` 1.88 — see below. The rest of the suite still
  does not.
- **Windows** is covered by `@gjsify/node-gi`'s CI, including a real GTK window and
  the storybook, using a bundled GTK runtime rather than a system install.

### The `@gjsify/*` GJS suites on macOS

`main.yml`'s `macos` job runs these bundles under `gjs` on `macos-latest`
(arm64). It is a curated subset, not the whole suite, and it is deliberately
split into packages that dispatch on the host OS and pure-TS controls that must
behave identically:

| package | why it is in the set |
|---|---|
| `@gjsify/v8` | `src/heap/darwin.ts` reads process memory with `ps -o rss=,vsz=` (macOS has no procfs); the suite asserts `used_heap_size > 0`, so the reader is really exercised |
| `@gjsify/child_process` | `src/platform/darwin.ts` — the BSD signal table (`SIGUSR1` is 30 on Darwin, 10 on Linux), `detached` without `setsid(1)`, and the in-process `communicate.ts` timeout that replaced GNU `timeout(1)` |
| `@gjsify/path` | POSIX/Win32 dispatch plus the largest pure-logic suite in the set |
| `@gjsify/querystring`, `@gjsify/string_decoder` | pure-logic controls |
| `@gjsify/buffer` | control for macOS SpiderMonkey itself (`Blob`/`atob`/`btoa`) |

The bundles are produced on the Fedora leg and executed on macOS. That split is
forced, not incidental: `@gjsify/rolldown-native` has no Apple target (see
above), so a build on macOS would have to run under Node — which means a full
`gjsify install` on a runner billed at 10×. A `--app gjs` bundle is a single
self-contained file whose only unbundled imports are `gi://GLib`, `gi://Gio` and
`gi://GioUnix`, so building it on Linux and running it on macOS is sound. What
this verifies is **runtime** behaviour on macOS; it does not verify the gjsify
build toolchain there.

The job runs on push-to-main and on the nightly sweep. On a pull request it is
skipped unless the PR carries the `ci:macos` label.

`@gjsify/os` is **not** in the gated set. Its `getOs()` shells out to `uname -o`,
a GNU extension Darwin's `uname` rejects, and `@gjsify/utils`' `cli()` throws on
any stderr output — so `src/darwin.ts` is currently unreachable on macOS. It runs
as a non-gating probe until it adopts the same capability detection
`@gjsify/v8` and `@gjsify/child_process` use.

### The `@gjsify/*` suites on Bun and Deno

Bun and Deno share the `node` runtime slot with Node through the Node-API common
ABI. `main.yml`'s `cross-runtime` job tests that rather than assuming it: it
builds one engine-agnostic `--app node` bundle per package and runs it on all
three runtimes.

Covered today: `@gjsify/cli`, `@gjsify/unit`, `@gjsify/adwaita-core`,
`@gjsify/storybook-core`, `@gjsify/domparser`, `@gjsify/webstorage`,
`@gjsify/semver`, `@gjsify/workspace`, `@gjsify/npm-registry`, `@gjsify/tar`.

The selection rule matters. A spec that imports `node:path` gets the *host
runtime's* builtin, because the `--app node` bundle externalises it — such a leg
would test Bun, not the polyfill. Every package above either imports its own
package by name, or imports a bare Web specifier that `ALIASES_WEB_FOR_NODE`
routes to the polyfill, or is infra code that is nobody's builtin. Running the
`node:`-backed polyfill suites against their own implementation on Bun/Deno needs
the `--alias node:<name>=@gjsify/<name>` retarget that
`scripts/node-gi-consumer-harness.mjs` performs; that is not wired into CI yet.
