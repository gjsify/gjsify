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
> addons, golden-diff vs Node): **13 pass / 8 Phase-0-deferred ledgered / 0 fail**.

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

## Requirements

- A C++ toolchain (`g++`/`clang`), `meson`, `vala`, `g-ir-compiler`
- Development headers for `glib-2.0`, `gobject-2.0`, `gio-2.0`, **`gjs-1.0`** and
  **`mozjs-140`** (Fedora: `gjs-devel mozjs140-devel glib2-devel
  gobject-introspection-devel vala meson gcc-c++`)
- Node.js + `node-gyp` to build the test/consumer addons (`.node` files)

## Build

```bash
meson setup build .              # or: gjsify run init:meson
meson compile -C build           # builds libgjsifynapi.so + GjsifyNapi-1.0.{gir,typelib}

# stage the prebuild the loader/gates resolve from:
gjsify run build:prebuilds       # meson build + copy into prebuilds/linux-x86_64/
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
gjsify run test:mem              # valgrind leak/UAF leg for the gates

gjsify run test:conformance      # golden-diff vs Node over node's js-native-api addons
gjsify run test:consumer         # better-sqlite3 v13.0.1 runs on GJS, byte-vs-Node
```

`gjsify run test:conformance:update` regenerates the golden files;
`conformance/ledger.json` records each Phase-0-deferred program with a precise
reason (an unlisted failure fails the harness; a listed program that starts
passing also fails — stale entry). `test:conformance:mem` / `test:consumer:mem`
are the valgrind variants.

## The mozjs-140 pin

The pin is intrinsic and by design: the **shim** links GJS's SpiderMonkey (built
`-fno-rtti -fno-exceptions`, matching GJS) and must be rebuilt when GJS bumps its
mozjs major — mozjs has no stable C++ ABI. The **addon** is untouched by mozjs
churn: it speaks only the stable napi C ABI. That asymmetry is the whole point.

## Caveat — the `.node` resolver is gate-scoped

Today an addon is loaded through an explicit `loadAddon(path)` (the gates and the
consumer harness do this). The transparent `require('./foo.node')` →
`loadAddon` rewrite is currently gate-scoped; a proper
`rolldown-plugin-gjsify` build integration is a follow-up (tracked in
`STATUS.md` `## Open TODOs`).

## License

MIT. See [ADR 0011](../../../docs/adr/0011-napi-host-in-gjs.md) for the full
rationale, alternatives, and consequences.
