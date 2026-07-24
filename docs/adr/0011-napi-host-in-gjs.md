# 11. N-API host in GJS (`@gjsify/napi`)

Date: 2026-07-24

## Status

Proposed

## Context

gjsify makes Node/Web/DOM APIs available *in* GJS at build time (the bundler
rewrites `node:fs` → `@gjsify/fs`). That covers pure-JS and GObject-backed
capability, but **npm packages that ship a compiled N-API `.node` addon**
(`better-sqlite3`, `sharp`, `bcrypt`, `node-datachannel`, `canvas`) cannot run on
GJS at all: GJS has no Node-API implementation and cannot `dlopen` a `.node`. Its
only native path is GObject-Introspection via `gi://`.

The Node-API (N-API) C ABI is **engine-agnostic by design** — the ~110 functions
of `js_native_api.h` plus the loader/version bits of `node_api.h` have nothing
V8-specific. The same `.node` already runs on Node (V8), Deno (V8-in-Rust) and
**Bun (JSC)**. Bun proves N-API over a non-V8 engine is a bounded project. GJS
embeds SpiderMonkey (mozjs-140), whose JSAPI GJS itself already drives for exactly
the mechanisms N-API needs (rooting via `JS_AddExtraGCRootsTracer`, weak-death via
`JS_UpdateWeakPointerAfterGC`, finalizers, natives-with-data via
`js::NewFunctionWithReserved`).

This is the forward mirror of Axis 5 (`@gjsify/node-gi`, "GI in Node"): here we
run N-API addons *in GJS* — "N-API in GJS". The node-gi team already owns the
ABI + marshalling + teardown expertise from the consumer side.

Full engineering plan (kept out of the repo per the werkstatt no-dev-plans rule):
maintainer's `~/.claude/plans/napi-over-gjs.md`; the working roadmap lives as a
STATUS.md strike-chain (new axis).

## Decision

Add `@gjsify/napi`, a native shim that **implements the Node-API C ABI over
mozjs-140** so GJS can load unmodified N-API addons.

- **Packaging = the `-native` template** (`@gjsify/tls-native`): meson → one
  `.so` + `.gir` + `.typelib` in `prebuilds/linux-<arch>/`, loaded from GJS via
  `imports.gi`, discovered by `detect-native-packages.ts`. Lives at
  `packages/napi/napi/` — a top-level group NOT matched by the workspace globs,
  so it is not a workspace member (same posture as `packages/node-gi/`), with its
  own build + CI workflow. Tier 3 (new axes start experimental, ADR 0003).
- **The introspectable surface is bootstrap-only**: a thin Vala class
  `GjsifyNapi` with `init()`, whose C++ body reaches the running `JSContext` via
  the public `gjs_context_get_current()` / `gjs_context_get_native_context()` and
  installs one JSNative (`js::NewFunctionWithReserved`). Thereafter
  `loadAddon(path)` is a plain JS→JSNative call: the addon's `exports` is a normal
  return value and load failures are normal JS exceptions (no per-load global
  side-channel; reentrant). The napi ABI itself is C++ compiled into the same
  `.so` (node-gi-style TU split under one `common.h`).
- **Symbol binding**: the addon is `dlopen`ed `RTLD_LOCAL`; the shim self-promotes
  its own `napi_*`/`node_api_*` into global scope (`dlopen(self,
  RTLD_NOLOAD|RTLD_GLOBAL)` + a version script exporting only the ABI), so the
  addon's undefined `napi_*` bind to ours (as Node/Bun export the ABI from the
  main binary). Consequence: **consumers need no special build** — a stock
  `node-gyp`-built `.node` (or its prebuild) loads, if it is pure N-API.
- **Consumer-driven, phased** (node-gi playbook): implement the ABI subset the
  first consumer + a golden-diff conformance oracle (reference = Node, seeded from
  `refs/node/test/js-native-api/*`) demand. Phase 0 target = essentially all of
  `js_native_api.h` + the module loader/version/fatal bits; the async/tsfn/uv
  group of `node_api.h` is stubbed to `napi_generic_failure` and deferred. First
  consumer = **`better-sqlite3`** (pure N-API, fully synchronous, NAPI v10).
  Async capstone (Phase 1) = **`@gjsify/node-gi` itself runs under the shim**,
  joining node-gi's cross-runtime golden harness as a 5th runtime — a
  differential N-API oracle against Node/Bun/Deno + native GJS.

The mozjs-140 pin is intrinsic: the *shim* links GJS's SpiderMonkey and is rebuilt
when GJS bumps (mozjs has no stable C++ ABI); the *addon* is untouched by mozjs
churn — it speaks only the stable napi C ABI. That asymmetry is the point.

## Consequences

- A new, load-bearing native package pinned to GJS's mozjs. The highest risk is
  the GC / references / finalizers layer (`napi_wrap`, `napi_ref`, finalizer
  scheduling) — the same crash class as node-gi's teardown SIGSEGVs — which gets
  adversarial review + valgrind/ASan + GC-stress + teardown-loop legs.
- SpiderMonkey's moving GC forbids the Bun trick of making `napi_value` a raw
  boxed value, and forbids `JS::Rooted` handle scopes; `napi_value` is a pointer
  into a per-env `JS::Heap<JS::Value>` slot arena traced by
  `JS_AddExtraGCRootsTracer`. Small ArrayBuffers stored inline in the movable
  cell make raw `napi_get_buffer_info` pointers a stability trap → always-external
  contents + `JS::EnsureNonInlineArrayBufferOrView`.
- New CI workflow modeled on `node-gi.yml` (fedora, mozjs140-devel + gjs-devel,
  node-gyp for the test addons, conformance + memory legs). node-gi is exempt
  from the affected-classifier; `packages/napi/**` gets the same carve-out.
- No `@gjsify/*` package gains a hard dep on it (ADR 0005 posture preserved); it
  is a devDep/test seam. node-gi becomes a *consumer* of it at the capstone, not a
  dependency of it.
- Non-goals: implementing the async/event-loop N-API surface in Phase 0; GObject
  interop bridge (`napi_value` ↔ `gi://` wrapper); Windows/macOS/arm64 in Phase 0.

## Alternatives considered

- **Per-package `gi://`-backed reimplementation** (`@gjsify/sqlite` over `gi://Gda`
  is the existing example). Kept for the handful of packages where the platform
  library is genuinely better, but rejected as the general strategy: O(packages),
  never reaches "arbitrary native addon works".
- **WASM builds** of specific packages (`refs/wa-sqlite`). Zero ABI work but
  package-specific; a per-package escape hatch, not a general answer.
- **Out-of-process sidecar** (run the addon in a real Node/node-gi host, IPC).
  Avoids the ABI project but loses synchronous APIs (the whole point of
  better-sqlite3) and adds serialization; a last-resort escape hatch only.
