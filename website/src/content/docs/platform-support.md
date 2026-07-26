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
`STATUS.md` with the exact conditions that would unblock it.

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
`<os>-<arch>` targets it promises in `package.json#gjsify.platforms`, and CI is
held to that declaration in both directions — a promised target that nothing builds
and a built target that nothing promises are both hard failures.

<!-- Regenerate with: node scripts/audit-runtimes.mjs --platforms --markdown -->

| package | tier | darwin-aarch64 | linux-aarch64 | linux-ppc64 | linux-riscv64 | linux-s390x | linux-x86_64 | win32-x86_64 |
|---|---|---|---|---|---|---|---|---|
| `@gjsify/http-soup-bridge` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/http2-native` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/lightningcss-native` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/napi` | 3 | ✓ | · | · | · | · | ✓ | · |
| `@gjsify/node-gi` | 2 | ✓ | ✓ | · | · | · | ✓ | ✓ |
| `@gjsify/oxfmt-native` | 1 | ✓ | ✓ | · | · | · | ✓ | · |
| `@gjsify/rolldown-native` | 1 | · | ✓ | · | · | · | ✓ | · |
| `@gjsify/sab-native` | 1 | · | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/terminal-native` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/tls-native` | 1 | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/webgl` | 1 | · | ✓ | ✓ | ✓ | ✓ | ✓ | · |
| `@gjsify/webrtc-native` | 1 | · | ✓ | ✓ | ✓ | ✓ | ✓ | · |

`✓` declared + built by CI · `·` not supported

Check the matrix against reality at any time:

```bash
node scripts/audit-runtimes.mjs --platforms            # human-readable
node scripts/audit-runtimes.mjs --platforms --markdown # this table
node scripts/audit-runtimes.mjs --check                # CI gate, all three audits
```

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
