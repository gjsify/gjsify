# @gjsify/napi

**Node-API (N-API) host for GJS** — implements the Node-API C ABI over GJS's
SpiderMonkey (mozjs-140) so GJS can load unmodified compiled `.node` addons.

It is the forward mirror of [`@gjsify/node-gi`](../../node-gi/node-gi) ("GI in
Node"): where node-gi runs GObject-Introspection code IN Node via Node's N-API,
this runs Node's **N-API `.node` addons IN GJS** ("N-API in GJS"). A consumer
addon built with stock `node-gyp` — including its bundled native code — loads and
runs inside GJS byte-identically to Node (see the gjsify `AGENTS.md`
`### N-API host in GJS`).

> **Status: experimental (Tier 3 — [ADR 0011](../../../docs/adr/0011-napi-host-in-gjs.md)).**
> No stability promise; new axes start here. **Phase 0 is complete:** the full
> `js_native_api.h` surface + the module loader/version/fatal bits are
> implemented; the async / threadsafe-function / event-loop group of
> `node_api.h` is intentionally loud-stubbed and deferred. First consumer:
> **better-sqlite3 v13.0.1 (incl. its bundled SQLite) runs unmodified, byte-identical
> to Node**, valgrind-clean. Conformance oracle (node's own `js-native-api`
> addons, golden-diff vs Node): every program either byte-identical to Node or carrying its Phase-0 reason in `conformance/ledger.json`.

## How it works

Packaged like the `@gjsify/*-native` bridges (`@gjsify/tls-native`): meson builds
a thin Vala GI surface (`GjsifyNapi.init()`) plus the C++ napi-over-mozjs-140
implementation into ONE `.so` + `.gir` + `.typelib`, loaded from GJS via
`imports.gi`. `init()` reaches the running `JSContext`
(`gjs_context_get_current` / `gjs_context_get_native_context`) and installs one
JSNative, `loadAddon(path)`; thereafter the addon's `exports` is a normal JS
return value and load failures are normal JS exceptions. `napi_value` is a
GC-traced `JS::Heap<JS::Value>` arena slot (SpiderMonkey's moving GC forbids the
raw-boxed-value trick and `JS::Rooted` scopes). The shim `dlopen`s the addon
`RTLD_LOCAL` and self-promotes its own `napi_*` / `node_api_*` into global scope,
so an addon's undefined napi symbols bind to ours — exactly as Node/Bun export
the ABI from the main binary, which is why **consumers need no special build**.

## Install

```bash
gjsify install @gjsify/napi
```

Published on the `@gjsify/*` release train. The tarball ships the shim
**prebuilt** for the platforms in [Platforms](#platforms) below —
`prebuilds/linux-x64/` and `prebuilds/darwin-arm64/`, each a `.so`/`.dylib`
plus its `.gir` and `.typelib`, rebuilt from the released source by the
`napi-prebuild-*` jobs in `.github/workflows/release.yml` — so an install brings
the shim itself, not just a build recipe. Installing through the `gjsify` CLI
puts the prebuild dir on `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` for you.

The tarball ALSO ships the build inputs (`meson.build`, `src/vala`, `src/cc`,
`src/napi-headers`), so on a platform with no prebuild — or against a GJS built
on a different SpiderMonkey major (see [the mozjs-140 pin](#the-mozjs-140-pin))
— you can rebuild in place: `cd node_modules/@gjsify/napi && meson setup build .
&& meson compile -C build`, then point `GI_TYPELIB_PATH` (plus
`LD_LIBRARY_PATH`, or `DYLD_LIBRARY_PATH` on macOS) at `build/`. See
[Requirements](#requirements) for the toolchain that needs.

## Usage — transparent (primary)

After `gjsify install @gjsify/napi`, a normal native-addon import **just works**
in a `gjsify build --app gjs` build — no wrapper, no manual `loadAddon`:

```ts
import Database from 'better-sqlite3'; // require('bufferutil') / etc.

const db = new Database(':memory:');
db.exec('CREATE TABLE t (n INT)');
```

The `napiNodeAddonPlugin` in `@gjsify/rolldown-plugin-gjsify` (the forward mirror
of the `gjsGiNodePlugin` `gi://`→`requireGi` rewrite) intercepts the addon's own
acquisition helper — `bindings`, `node-gyp-build`, a direct `.node` import, a
napi-rs `@scope/pkg-<triple>` platform sibling, or a napi-rs **generated loader
entry** (`@node-rs/*`) — and rewrites it to `loadAddon('<abs .node>')`. For the
node-gyp-build/bindings case it locates the compiled `.node` using
node-gyp-build's own probe order (`build/Release` → `build/Debug` →
`prebuilds/<platform>-<arch>`), so the GJS build routes the SAME binary Node
loads; for a napi-rs package it detects the generated loader (package.json
`napi`/optionalDependencies signal + native-`main` match) and replaces the whole
module with `module.exports = loadAddon(<current-platform sibling .node>)`, so the
generated `createRequire` loader body never reaches the bundle. Always-on for
`--app gjs`, inert when no native addon is in the graph.

**Escape hatch — explicit `loadAddon`.** When you want to load a `.node` by an
arbitrary runtime path (not a static import), call it directly:

```ts
import { loadAddon, hasNapi } from '@gjsify/napi';

if (hasNapi()) {
    const addon = loadAddon('/abs/path/to/build/Release/addon.node');
}
```

All four addon conventions — node-gyp-build, bindings, a direct `.node`, and
napi-rs generated loaders (`@node-rs/*`) — are transparent; the explicit
`loadAddon` escape hatch remains for loading a `.node` by an arbitrary runtime
path.

## Requirements

- A C++ toolchain (`g++`/`clang`), `meson`, `vala`, `g-ir-compiler`
- Development headers for `glib-2.0`, `gobject-2.0`, `gio-2.0`, **`gjs-1.0`** and
  **`mozjs-140`**
  - Fedora: `gjs-devel mozjs140-devel glib2-devel gobject-introspection-devel
    vala meson gcc-c++`
  - macOS (Homebrew): `brew install gjs gobject-introspection vala meson ninja
    pkgconf` — `gjs` pulls `spidermonkey` (mozjs-140) transitively, the SAME
    pairing Fedora pins (gjs 1.88.x ↔ mozjs-140)
- Node.js + `node-gyp` to build the test/consumer addons (`.node` files)

## Platforms

Ships as a prebuilt `.dylib`/`.so` + `.gir` + `.typelib` per platform. Both
supported triples are rebuilt on their own native runner for every release
(`napi-prebuild-linux` / `napi-prebuild-darwin-arm64` in `release.yml`) and
staged into the one published tarball, so a single `@gjsify/napi` version serves
both:

| Platform | Prebuild dir | Status |
| --- | --- | --- |
| Linux x64 | `prebuilds/linux-x64/` | Supported (full gate + conformance + consumer CI) |
| macOS arm64 | `prebuilds/darwin-arm64/` | Supported (build + load + P0.x value-model + **P1 tsfn** gates); the earlier tsfn exit-segfault (a UAF — the tsfn was freed while foreign claimants still held claims) is **fixed** (join-before-free, both abort + teardown paths); conformance/consumer/valgrind widening deferred |
| Windows x64 | — | **Attempted, blocked at gjs-on-Windows** (shim-side portability done; see below) |

**Windows is attempted, blocked at gjs-on-Windows.** The shim-side portability
is complete and Linux-verified: `meson.build` has a `windows` branch (a `.def`
EXPORTS file — MSVC `link.exe` takes no globs — plus the `gjsifynapi.dll` leaf
and MSVC-syntax cpp_args), and `src/cc/module.cc`'s POSIX `dlfcn` loader is
`#ifdef _WIN32`-ported to `LoadLibraryEx`/`GetProcAddress`/`GetModuleHandleEx`.
A manual-dispatch (`workflow_dispatch`) `windows` job in `napi.yml` drives the
from-source attempt. **Re-checking the blocker harder overturned one half:** a
prebuilt MSVC-ABI **mozjs-140 now exists** — `servo/mozjs` ships
`libmozjs-x86_64-pc-windows-msvc` at `mozjs-sys-v140.13.0-0` (SpiderMonkey ESR
140.13). **The remaining wall is `libgjs` itself:** no prebuilt libgjs exists for
Windows (gvsbuild has no gjs/spidermonkey module, GNOME/gjs CI is Linux-only),
and the servo prebuilt is a patched Rust static-lib layout, not the pkg-config
`mozjs-140` gjs's meson wants — so gjs must still be source-built with clang-cl.
A **second wall** waits behind it: an unmodified node-gyp `.node` on Windows
binds `napi_*` via a delay-load hook against the host `.exe`, which `gjs.exe`
does not export (there is no POSIX global-namespace self-promotion analog). See
`status/open-todos.md` → *N-API host in GJS* → cross-platform prebuilds. This is the key
difference from [`@gjsify/node-gi`](../../node-gi/node-gi), which links the
portable girepository stack and so runs on all three OSes.

## Build

```bash
meson setup build .              # or: gjsify run init:meson
meson compile -C build           # builds libgjsifynapi.so + GjsifyNapi-1.0.{gir,typelib}

# stage the prebuild the loader/gates resolve from:
gjsify run build:prebuilds       # meson build + copy into prebuilds/linux-x64/
```

## Test

The gates, conformance oracle and consumer proof all load the addon through the
staged shim, with `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` pointed at `build/`. Build
the addons first, then run the legs:

```bash
gjsify run build:test-addons     # node-gyp rebuild of test/*-addon/*.node

gjsify run test:gate             # smoke: load a minimal addon under gjs
gjsify run test:gate:p01         # env + value model + scopes
gjsify run test:gate:p02         # js_native_api core
gjsify run test:gate:p03         # wrap + lifetime
gjsify run test:gate:p1          # threadsafe functions from real foreign pthreads
gjsify run test:gate:tsfn-teardown  # tsfn env-teardown claim attribution (measured)
gjsify run test:mem              # valgrind leak/UAF leg for the gates

gjsify run test:conformance      # golden-diff vs Node over node's js-native-api addons
gjsify run test:consumer         # better-sqlite3 v13.0.1 runs on GJS, byte-vs-Node

gjsify run test:addons:setup     # vendor + source-build the real-addon matrix
gjsify run test:addons           # pinned baseline: loadAddon({addonPath}), byte-vs-Node
gjsify run test:addons:transparent  # transparent: napiNodeAddonPlugin auto-resolves, byte-vs-Node
```

`test:addons:transparent` is the end-to-end proof of the transparent path: it
builds each real addon `--app gjs` through `napiNodeAddonPlugin`'s
auto-resolution (no hand-pinned addonPath) and requires byte-identical output vs
Node. All four pass byte-identical: bufferutil + utf-8-validate (node-gyp-build),
sqlite3 (bindings), and `@node-rs/argon2` (napi-rs generated-loader
entry-replacement).

`gjsify run test:conformance:update` regenerates the golden files;
`conformance/ledger.json` records each Phase-0-deferred program with a precise
reason (an unlisted failure fails the harness; a listed program that starts
passing also fails — stale entry). `test:conformance:mem` / `test:consumer:mem`
are the valgrind variants.

## Diagnostics

Loading an addon prints **nothing**. The shim's internal diagnostics — the
symbol-promotion notes and the §3d P0.0 teardown probe (`GjsContext weak notify
fired…` / `N env(s) torn down before JS_DestroyContext`) — are `g_debug()`
messages on GLib's standard debug channel, so they are silent unless you ask for
them:

```bash
G_MESSAGES_DEBUG=all GI_TYPELIB_PATH=build LD_LIBRARY_PATH=build gjs your-script.js
```

Note GLib writes `DEBUG`-level records to **stdout** (only `WARNING` and above
go to stderr), so capture with `2>&1` — which is why `test:gate:p03`, the one
leg that asserts the teardown-ordering probe, both sets `G_MESSAGES_DEBUG=all`
and merges the streams.

Anything the shim reports **unconditionally** is a real problem, not a trace: a
`g_warning`, or the `napi_fatal_error` / unhandled-exception reports. Do not
silence those.

### Threadsafe functions still holding claims at env teardown

The warnings an addon can provoke. Both come from `finalize_env_tsfns`
(`src/cc/tsfn.cc`) and both mean the same contract violation — **a claim that was
never handed back** — differing only in what the shim could establish about who
holds it.

At env teardown the shim closes every still-registered threadsafe function, runs
its JS-side finalization (thread finalizer, `env == NULL` queue drain, function
ref) and then frees it — but **only if no claim is outstanding**. It never frees
under a live claim: that is the use-after-free that crashed macOS at exit (#809).
When claims remain it does what Node's own `MaybeDelete()` does — releases what
it can and hands the control block to whichever thread returns the last claim,
which then frees it. If no thread ever does, the control block (a few hundred
bytes) leaks for the process lifetime. Node behaves identically.

To decide what is worth waiting for, each claim is attributed to an owner from
facts the shim can observe (`napi_acquire_threadsafe_function` takes a claim on a
known thread; a `napi_call_threadsafe_function` proves — per the ABI contract —
that its caller holds one). `initial_thread_count` claims start unattributed,
because the addon hands them out through memory the shim never sees.

* **`teardown join timed out after 2s with N claim(s) still held by foreign
  thread(s)`** — a thread other than the JS thread demonstrably holds a claim and
  then neither called again (a `napi_closing` return consumes the claim) nor
  released for a full 2 s.
* **`closed at env teardown with N claim(s) outstanding that nothing can hand
  back`** — the remainder: claims held by the JS thread itself (which is the
  thread running the teardown, so they cannot drop) plus claims no thread was
  ever observed to hold. The message reports the two counts separately rather
  than guessing; an unattributed claim is named as unattributed.

**Release every claim before teardown** and neither fires (an
`napi_add_env_cleanup_hook` that calls `napi_release_threadsafe_function(…,
napi_tsfn_abort)` is the standard shape; it is what `@gjsify/node-gi` does, and
why it never trips this).

The 2 s deadline is not the problem, and only the first case can reach it: a
genuinely slow drain — eight producer threads each dropping their claim on the
next push — measures **tens of µs**, four orders of magnitude inside it. A claim
nothing can hand back is not joined at all, so it costs nothing.
`test/tsfn-teardown-gate.mjs` (`gjsify run test:gate:tsfn-teardown`) measures the
teardown of every claim-owner shape on each run and is the regression guard for
exactly that; `G_MESSAGES_DEBUG=all` prints the measured join time and the
disposition on every teardown that had claims to deal with.

## The mozjs-140 pin

The pin is intrinsic and by design: the **shim** links GJS's SpiderMonkey (built
`-fno-rtti -fno-exceptions`, matching GJS) and must be rebuilt when GJS bumps its
mozjs major — mozjs has no stable C++ ABI. The **addon** is untouched by mozjs
churn: it speaks only the stable napi C ABI. That asymmetry is the whole point.

## License

MIT. See [ADR 0011](../../../docs/adr/0011-napi-host-in-gjs.md) for the full
rationale, alternatives, and consequences.
