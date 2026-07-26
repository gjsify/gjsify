# node-gi consumer survey — running `@gjsify/*` GJS test suites on Node/Bun/Deno

**Generated:** 2026-07-18 (P3/P4/P7/P8 re-measured 2026-07-26) · **Harness:** [`scripts/node-gi-consumer-harness.mjs`](../../scripts/node-gi-consumer-harness.mjs) · **Raw data:** [`node-gi-consumer-survey.json`](node-gi-consumer-survey.json)

This report generalizes the proven `@gjsify/sqlite` "run its own GJS test suite on Node via `@gjsify/node-gi`" leg (the [`consumer-sqlite`](../../.github/workflows/node-gi.yml) CI job / ADR-0005 second-consumer gate) into a **reusable cross-runtime harness**, then runs it across the GJS-only packages plus a sample of dual (cross-runtime) packages to produce a concrete PASS/FAIL gap report. The goal is to prioritize the remaining Axis-5 (`gi://` reverse bridge) work: **which real consumers already run unchanged on Node, and exactly what blocks the rest.**

The full 22-package rollout as committed `test:gjs-on-node` legs + a full CI matrix are deliberately **out of scope** here (see [Follow-ups](#follow-ups)); this survey + a first `consumer-suites` CI proof job are the deliverable.

## How the harness works

For each package the harness ([`scripts/node-gi-consumer-harness.mjs`](../../scripts/node-gi-consumer-harness.mjs)):

1. Picks a node-gi test **entry** — a committed `src/test.node-gi.mts` (a hand-written proof leg, like sqlite's) if present, else **generates** one from the package's existing `src/test.mts` by prepending a bare `print(...)` call. That bare GJS ambient global is the genuine-GJS-source signal `detectNodeGiGlobals` looks for: it flips `nodeGiGlobalsInject`, so `@gjsify/node-gi/globals` is auto-injected **and** `@girs/*` value imports resolve to their real bodies whose inner `gi://Ns?version=X` are rewritten to `requireGi('Ns','X')`. (Same mechanism sqlite's `test.node-gi.mts` uses.)
2. Builds that entry `gjsify build --app node --alias node:<name>=@gjsify/<name>` (the sqlite `--alias` pattern — the specs' `node:<name>` import is retargeted onto the GNOME-backed polyfill under test, not Node's own builtin), under Node via a Node-runnable `@gjsify/cli` (npm `rolldown`). Since 2026-07-26 the build additionally forces every `runtimes.node === "native"` `@gjsify/*` package in the target's transitive workspace-dep closure onto its polyfill body (the P4/P7 fix — reproduces the gjs graph the suite actually exercises) and stages the package's on-disk test fixtures next to the bundle (`prebuild:test:fixtures` + a `dist/fixtures → ../fixtures` symlink).
3. Runs the ONE `--app node` bundle on **node**, and — reusing `packages/node-gi/example/harness.mjs`'s runtime map + PATH-skip — on **bun** and **deno** too (Node-API is their common ABI).
4. Captures build ok/fail, run exit code, the `@gjsify/unit` summary counts, and representative failure lines, then **groups the failure reason**.

It **tolerates** failures and captures them; `--require-pass` turns it into a CI gate (exit non-zero unless every listed package passes on node).

### Environment

Fedora 43 (host) · GJS 1.88.0 · Node 24.15.0 · Bun 1.3.13 · Deno 2.9.2 · girepository-2.0 = 2.88.1 · `@gjsify/node-gi` built from this tree (node-gyp + staged prebuild for the Deno load path). Per-test timeout 5000 ms (`@gjsify/unit` default); per-package harness timeout 40 s (a genuine wall-clock kill ⇒ `timeout` status).

## Results

37 `@gjsify/*` packages: 26 GJS-only (`gi://` value imports, `runtimes.node: "none"`) + 5 already-proven synchronous ones + a 6-package pure-TS **dual** sample (`path`/`buffer`/`querystring`/`string_decoder`/`events`/`assert`) run to check the polyfills are cross-runtime.

Legend: ✅ pass · 🟡 partial (some tests fail) · ❌ fail (exit non-zero / no clean summary) · ⏱ wall-clock timeout · ▶ ran but emitted no `@gjsify/unit` summary.

| pkg | build | node | bun | deno | dominant gap |
|---|---|---|---|---|---|
| `sqlite` | ok | ✅ 105/105 | ✅ 105/105 | ✅ 105/105 |  |
| `crypto` | ok | ✅ 626/626 | ✅ 626/626 | ✅ 626/626 | (was 🟡 526/570 — P4, RESOLVED) |
| `os` | ok | ✅ 276/276 | ✅ 276/276 | ✅ 276/276 | (was 🟡 11/41 — P3 `imports.byteArray`, RESOLVED) |
| `module` | ok | ❌ fail | ❌ fail | ❌ fail | CLI alias-scoping bug (P9, reclassified from P3) |
| `zlib` | ok | ✅ 53376/53376 | ✅ 53376/53376 | 🟡 53374/53375 | (deno: 1 flake) |
| `child_process` | ok | ❌ fail | ❌ fail | ❌ fail | (was `ByteArray.fromGBytes` — P3 part RESOLVED, stdout reads work; residual = a polyfill fidelity bug, see P3) |
| `dgram` | ok | 🟡 123/129 | 🟡 123/129 | ✅ 118/118 | async mainloop (UDP recv) |
| `dns` | ok | 🟡 79/85 | 🟡 78/85 | 🟡 79/85 | async mainloop |
| `fs` | ok | ❌ fail | ❌ fail | ❌ fail | async mainloop (Gio async) |
| `node-globals` | ok | ✅ 221/221 | 🟡 218/221 | ✅ 221/221 | (bun: 3) |
| `http` | ok | ❌ fail | ❌ fail | ❌ fail | Vala typelib not on GI path |
| `http2` | ok | ✅ 102/102 | ✅ 102/102 | ✅ 102/102 |  |
| `net` | ok | ❌ fail | ❌ fail | ❌ fail | async mainloop |
| `tls` | ok | ✅ 158/158 | ✅ 158/158 | ✅ 158/158 |  |
| `tty` | ok | ✅ 29/29 | ✅ 29/29 | 🟡 40/55 | (deno: terminal probe) |
| `v8` | ok | 🟡 56/60 | ✅ 72/72 | ✅ 72/72 | (node-only: Buffer.copy range) |
| `worker_threads` | ok | ✅ 282/282 | 🟡 258/268 | 🟡 262/270 | (was 🟡 0/82 — P7, RESOLVED on node; bun/deno residuals = worker-subprocess/SAB runtime quirks) |
| `ws` | ok | ✅ 19/19 | ✅ 19/19 | ✅ 19/19 |  |
| `webaudio` | ok | ▶ no-summary | ▶ no-summary | ▶ no-summary | GStreamer + bespoke entry |
| `webrtc` | ok | ❌ fail | ❌ fail | ❌ fail | Vala typelib not on GI path |
| `canvas2d-core` | ok | ✅ 578/578 | ✅ 578/578 | ✅ 578/578 | (was: bare `cairo` → P2; then 529/543 → caller-alloc struct OUT + Uint8Array→GBytes, both RESOLVED) |
| `dom-elements` | ok | ✅ 441/441 | ✅ 441/441 | ✅ 441/441 |  |
| `adwaita-app` | ok | ✅ 28/28 | ✅ 28/28 | ✅ 28/28 |  |
| `canvas2d` | ok | ✅ 191/191 | — | — | (was: bare `cairo` → P2 + the P2½ engine gaps; re-measured on node) |
| `devtools` | ok | ✅ 20/20 | ✅ 20/20 | ✅ 20/20 |  |
| `devtools-browser` | ok | ✅ 40/40 | ✅ 40/40 | ✅ 40/40 |  |
| `devtools-mcp` | ok | ✅ 7/7 | ✅ 7/7 | ✅ 7/7 | (was ❌ build module-not-found ×6 — P8, RESOLVED upstream) |
| `event-bridge` | ok | ✅ 0/0 | ✅ 0/0 | ✅ 0/0 | (vacuous — 0 runnable specs) |
| `iframe` | ok | 🟡 275/276 | ✅ 277/277 | 🟡 270/273 | (1 WebKit `toStringTag`) |
| `storybook` | ok | ✅ 9/9 | ✅ 9/9 | ✅ 9/9 |  |
| `path` | ok | ✅ 432/432 | ✅ 432/432 | ✅ 432/432 |  |
| `buffer` | ok | ✅ 317/317 | ✅ 317/317 | ✅ 317/317 |  |
| `querystring` | ok | ✅ 471/471 | ✅ 471/471 | ✅ 471/471 |  |
| `string_decoder` | ok | ✅ 103/103 | ✅ 103/103 | ✅ 103/103 | (was 🟡 0/0 — P4, RESOLVED) |
| `events` | ok | ✅ 266/266 | ✅ 266/266 | ✅ 266/266 |  |
| `stream` | ok | ❌ fail | ❌ fail | ❌ fail | async mainloop (data events) |
| `assert` | ok | ✅ 117/117 | ✅ 117/117 | ✅ 117/117 |  |

*(2026-07-18: `worker_threads`/`string_decoder` showed `0/…` because `@gjsify/unit` counted more failing assertions than `it()`s — leaked/stray — so `passed` was clamped to 0; both were genuine fails, since resolved.)*

### Genuine passes — 21 packages run unchanged on node-gi

**`gi://` reverse-bridge consumers (real GNOME libs on Node/Bun/Deno):** `sqlite` (Gda), `http2` (Soup 3.0 + ALPN), `tls` (Gio/glib-networking), `ws` (Soup), `dom-elements` (GdkPixbuf), `node-globals` (GLib), `tty` (node/bun), `canvas2d-core` (cairo + PangoCairo + GdkPixbuf — headless Canvas 2D incl. text metrics + putImageData, 578/578 ×3 runtimes), `canvas2d` (the GTK-bridge package, 191/191 on node), **`os` (GLib spawn + `imports.byteArray`, 276/276 ×3 — P3 fix)**, **`crypto` (GLib.Checksum/Hmac, 626/626 ×3 — P4 fix)**, **`worker_threads` (Gio.Subprocess workers + sab-native, 282/282 on node — P7 fix; bun/deno carry a handful of worker-subprocess/SAB runtime quirks)**, and the pure-logic layers of `devtools` / `devtools-browser` / `storybook` / `adwaita-app` / **`devtools-mcp` (7/7 ×3 — P8 resolved)**.

> Note on `devtools`/`storybook`/`adwaita-app`: they build against `gi://Gtk`/`Adw` and pass **headless** because their unit specs exercise pure logic (`LoadToken`, the story registry, nav-model, mock widget-trees), not live widgets. Live-GTK-on-Node is separately proven by the existing `gtk-smoke` job. `event-bridge`'s `0/0` is **not** a real pass — its `test.mts` has no runnable specs on this path (they need live GTK controllers).

**Pure-TS dual sample (validates the polyfills are cross-runtime):** `path`, `buffer`, `querystring`, `events`, `assert`, **`string_decoder` (103/103 ×3 — P4 fix)** — all ✅ on node/bun/deno.

## Gaps, grouped by root cause (prioritized)

These directly prioritize the remaining Axis-5 work — each root cause is fixed once and unblocks all its consumers.

### P1 — Async Gio callbacks + timers don't drain in a bare `node bundle.mjs` run — **RESOLVED (2026-07-18)**
**Blocked:** `fs`, `net`, `dns`, `dgram`, `stream` (and contributed to `worker_threads`; masked the true score of `crypto`/`os`). **Signature:** every failure was `Timeout: "…" exceeded 5000ms` — **nothing pumped the default GLib main context** in a plain Node script that never calls `Gtk.Application.run()`/`GLib.MainLoop.run()`.

**Fixed by the uv-driven auto-pump** (node-gi `src/loop.cc`, armed by `startMainLoop`): pending GLib sources now dispatch from Node's own libuv loop (a uv_prepare/uv_check drain + mirrored uv_timer/uv_poll wake-ups on the context's queried fds, a `beforeExit` kick for the empty-loop bootstrap, and Node-conventional keep-alive — an in-flight scope=async callback / an armed GLib timeout hold the process). Harness A/B on this branch (`--runtimes node`):

| pkg | before | after |
|---|---|---|
| `dns` | 🟡 79/85 (timeouts) | ✅ **118/118** |
| `dgram` | 🟡 123/129 (timeouts) | ✅ **146/146** |
| `stream` | ❌ fail (all timeouts) | 🟡 **520/521** (1 error-ordering mismatch, `promises.finished` on an insta-destroyed readable) |
| `fs` | ❌ fail (all timeouts) | ❌ fail — but **no more timeouts**: the residual is a URL-path stringification gap (`ENOENT … /[object …`), a P3-family marshalling issue |
| `net` | ❌ fail (all timeouts) | ❌ fail — but **no more mainloop hangs**: the residual is the known **P3** `ByteArray.fromGBytes` gap (now surfaced in the socket read path) |

Conformance program `async-gio-await` (top-level awaits on a GLib timeout, an idle and a Gio async read — no loop anywhere) runs **byte-identical to `gjs -m`** on node; ledgered for bun/deno (no libuv there — they keep `startMainContextPump`).

### P2 — Bare GJS built-ins (`cairo`, `system`, `gettext`) not externalised for `--app node` — RESOLVED
**Was blocking:** `canvas2d-core`, `canvas2d`. **Signature:** `ERR_MODULE_NOT_FOUND: Cannot find package 'cairo'`. node-gi already **ships** `@gjsify/node-gi/cairo`. The real gap was NOT the alias map (`ALIASES_GJS_FOR_NODE` was already filled) but `app/node.ts`'s `NODE_GI_BARE_MODULE_SPECIFIERS` `exactExternal` array, which listed only `system`/`gettext` — under `@gjsify/rolldown-native` (the GJS bundler) the resolveId `{external:true}` flag is dropped at the JSON options boundary, so ONLY the string array keeps a target external; cairo missing there left the bare `cairo` unresolved. **Fixed** by deriving the array from `ALIASES_GJS_FOR_NODE`'s values (`NODE_GI_BARE_MODULE_SPECIFIERS = Object.values(...)`) so it can't drift again — cairo/system/gettext all externalise + resolve on the GJS bundler now. unit `packages/infra/cli/src/node-gi-externals.spec.ts`; e2e `tests/e2e/node-gi-build`. (npm rolldown honoured the flag, so the gap was invisible until a Cairo consumer was built on the GJS bundler.)

### P2½ — caller-allocates OUT structs + Uint8Array→GBytes IN — RESOLVED
**Was blocking:** `canvas2d-core` at 529/543 after P2 (the 14 residual failures were node-gi ENGINE marshalling gaps, not cairo): 11× `PangoLayout.get_pixel_extents: caller-allocates OUT parameter type is not yet supported` (text metrics / `measureText`) + 3× `Unsupported interface IN argument` (a `Uint8Array` passed to `GdkPixbuf.Pixbuf.new_from_bytes`'s `GLib.Bytes` param in `putImageData`). **Fixed at the engine:** (a) caller-allocates OUT now covers PLAIN non-boxed structs — the engine g_malloc0's the struct, the callee fills it in place, JS gets a field-readable handle that owns the storage (`BoxedHandle.rawOwned` → g_free on GC), gjs's `CallerAllocatesOut`; (b) a JS `Uint8Array`/`Buffer`/`DataView`/`ArrayBuffer` at a `GLib.Bytes` IN-arg is copied into a fresh GBytes and released per transfer after the invoke, gjs's `GBytesIn::in` (the byte slice is read via `napi_get_typedarray_info`'s data pointer — Bun misreports the byte offset relative to its arraybuffer pointer for subarray views). **Result: `canvas2d-core` 578/578 on node, bun AND deno** (the suite even completes 35 more tests than the 543 it could register before — the aborting text suites now run to the end). Conformance programs `caller-alloc-struct-out` + `bytes-in` are byte-identical to gjs on all four runtimes; the gimarshalling `gbytes_none_in(Uint8Array)` skip is live.

### P3 — GLib/GObject marshalling-helper gaps — **RESOLVED (2026-07-26)**
**Was blocking:** `child_process` (`ByteArray.fromGBytes` undefined ⇒ couldn't read subprocess stdout), `os` (`imports.byteArray.toString` undefined ⇒ `.toString()` of undefined threw inside `@gjsify/utils`' `cli()`; stuck at 11/41), `module` (attributed here, but reclassified — see P9).

The empirical root cause was ONE gap, not many: node-gi's globals shim seeded `imports.{gi,system,gettext,cairo,signals,mainloop,package,searchPath}` but **not the legacy `imports.byteArray` module** — the seam `@gjsify/utils`' `gbytesToUint8Array()`/`cli()` (and through them `os` + `child_process`) read GLib subprocess output with. The suspected GLib marshalling gaps do NOT exist: `GLib.filename_from_uri` / `spawn_command_line_sync` (guint8[] OUT) / `file_get_contents` all marshal correctly (probed directly), `imports.searchPath` was already seeded, and `globalThis.exports` is a plain global write that needs no seeding.

**Fixed** in `packages/node-gi/node-gi/overrides/byte-array.js` (wired into `globals.js` `makeImports`): the full gjs `imports.byteArray` surface — `fromString`/`toString` (ZERO-TERMINATED + fatal decode, per gjs/gjs/byteArray.cpp + text-encoding.cpp), `fromGBytes`/`toGBytes` (GLib.Bytes round-trip over the engine's boxed-GBytes `toArray()`/ctor), `fromArray` + the legacy `ByteArray` wrapper class, the legacy own `toString(encoding)` on returned arrays, and gjs-matching error classes (Error for arg parsing, TypeError for the GBytes typecheck + fatal decode). Pinned byte-identical to gjs by `conformance/programs/byte-array.conf.mjs` (gjs=node golden) + `test/byte-array.test.mjs`. Harness A/B: `os` 🟡 11/41 → ✅ **276/276** on node/bun/deno; `child_process` fail-at-first-stdout-read → runs deep into its suite (all output/cwd/env reads pass) but still exits non-zero: the residual is a **`@gjsify/child_process` fidelity bug, not a node-gi gap** — `_execImpl` emits `'error'` on the ChildProcess with no listener attached (real Node's `execFile` wires an internal `errorhandler`, refs/node lib/child_process.js), which is fatal under Node's unhandled-`'error'` rule but invisible under gjs (an exception leaving a GLib source callback is logged, not fatal). Fix belongs in `packages/node/child_process`.

### P4 — `normalizeEncoding`/`checkEncoding` unresolved when a polyfill is force-aliased onto Node — **RESOLVED (2026-07-26, harness artifact)**
**Was blocking:** `crypto` (the encoding path of hash/hmac — 44 of 570), `string_decoder` (all). **Determination: a harness/test-setup artifact, NOT an engine gap** — and Node-target-specific as suspected (`--app gjs` resolves `@gjsify/buffer` to the full polyfill; nothing bites there). The `--alias node:<self>=@gjsify/<self>` retarget bundles the polyfill under test, but its SIBLING `@gjsify/*` imports still got the standard node-target routing: `@gjsify/buffer` declares `runtimes.node: "native"`, so the derived alias map rewrote it to `@gjsify/buffer/globals` = `export * from 'node:buffer'` — which does not export the polyfill-only pure-TS helpers `normalizeEncoding`/`checkEncoding`/`base64Encode` ⇒ `(0, ye.normalizeEncoding) is not a function` at runtime. A mixed polyfill/native graph is not the graph the suite exercises on gjs.

**Fixed in the harness** (`collectForcedPolyfillAliases` in `scripts/node-gi-consumer-harness.mjs`): the build now walks the target's transitive workspace-dep closure and forces every `runtimes.node === "native"` `@gjsify/*` member onto its polyfill entry (`--alias @gjsify/<dep>=<abs lib/esm/index.js>` — user aliases override the derived map), reproducing the gjs graph. A/B: `crypto` 🟡 526/570 → ✅ **626/626** on node/bun/deno (the aborting encoding suites register 56 more tests); `string_decoder` 🟡 0/… → ✅ **103/103** ×3. The proof set is unregressed (sqlite/http2/zlib byte-same results). Out-of-band recommendation for the `packages/node/buffer` owner: `@gjsify/buffer/globals.mjs` could additionally re-export its pure-TS extension helpers (they are part of the package's public API that native `node:buffer` can never provide), which would also fix any real-world `--app node` bundle importing them.

### P5 — Package-own Vala-bridge typelib not on the GI search path — RESOLVED
**Was blocking:** `http` (`GjsifyHttpSoupBridge`), `webrtc` (`GjsifyWebrtc`). **Not an engine gap** — `scripts/node-gi-consumer-harness.mjs` now prepends each consumed package's `prebuilds/linux-<arch>/` to `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` at the run step, reusing the CLI's `detectNativePackages`+`buildNativeEnv` (so the transitive case works — `@gjsify/http`'s typelib lives in `@gjsify/http-soup-bridge`, `@gjsify/webrtc`'s in `@gjsify/webrtc-native`). The `gjsify run/showcase --runtime node` launcher path was already covered by `runRuntimeBundle`→`computeNativeEnvForBundle`. **Proof:** `webrtc`'s failure moved from missing-typelib to a downstream marshalling error (`TypeError: expected an array for the array argument`, a P3-family gap) — the `GjsifyWebrtc` typelib now loads; `http` likewise loads its bridge. `http2`/`tls`/`ws` never needed this (system Soup/Gio).

### P6 — GStreamer / display-bound
`webaudio` (GStreamer AudioContext; bespoke `test.mts` with no `run()` summary), `webrtc` (also needs its Vala bridge, P5). Need GStreamer typelibs; low priority.

> The **GL/display gate itself is PROVEN on node-gi**: a `Gtk.GLArea` realizes with a live, CURRENT
> OpenGL ES 3.2 context under headless software GL (Xvfb/X11 + mesa llvmpipe, `GSK_RENDERER=cairo`
> + `LIBGL_ALWAYS_SOFTWARE=1`), the `gwebgl` Vala bridge draws + reads pixels back through it, and
> the FULL `@gjsify/webgl` `WebGLBridge` (TS `WebGLRenderingContext`) clears + reads back through
> the same stack — all byte-identical to `gjs -m`. See
> `packages/node-gi/node-gi/test/webgl-glarea.test.mjs` + the node-gi README
> `### WebGL / Gtk.GLArea`. The remaining WebGL-on-node work is breadth
> (shader/buffer/texture — a three.js consumer), not the GL context.

### P7 — Constructor / registerClass — **RESOLVED (2026-07-26, harness artifact — NOT an engine gap)**
`worker_threads`: `MessagePort … Constructor cannot be called`. **Determination: no node-gi native-constructor gap exists.** The wrapper's `_inner = new SharedMessagePort()` field initializer imports `MessagePort` from `@gjsify/message-channel`, whose `runtimes.node: "native"` slot routed it to `@gjsify/message-channel/globals` = `globalThis.MessagePort` — and **Node's global `MessagePort` is deliberately non-constructible** (`new MessagePort()` throws `TypeError: Constructor cannot be called` in Node itself). The polyfill needs the CONSTRUCTIBLE, transport-pluggable `@gjsify/message-channel` polyfill body, i.e. the same P4 mixed-graph artifact. A second, independent artifact hid behind it: the suite's on-disk worker fixtures (`fixtures/echo-worker.mjs`) are staged by the package's `prebuild:test:fixtures` script and resolved RELATIVE TO THE BUNDLE, which the harness put in `dist/` (the package's own test bundles live at the package root).

**Fixed in the harness**: the P4 `collectForcedPolyfillAliases` closure covers the message-channel routing, and `stageFixtures` now runs the package's `prebuild:test:fixtures` script + symlinks `dist/fixtures → ../fixtures`. A/B: 🟡 0/82 → ✅ **282/282 on node** (bun 258/268, deno 262/270 — the residuals are worker-subprocess/SAB runtime quirks of the same family as the documented dgram/tty ones, not engine gaps).

### P8 — `--app node` build resolution — **RESOLVED (2026-07-26, fixed upstream since the survey)**
`devtools-mcp`: `--app node: Module not found` ×6 at build time. Re-measured on the current tree: the build succeeds and the suite passes — ✅ **7/7 on node/bun/deno** (A: ❌ build → B: ✅ 7/7 ×3). The resolution gap was closed by CLI/bundler work that landed between 2026-07-18 and 2026-07-26; no node-gi action was needed.

### P9 — `module`: user `--alias` leaks into the CLI's virtual gi modules (reclassified from P3)
`module` still fails, but NOT for the reasons P3 guessed (`GLib.filename_from_uri` marshals fine, `imports.searchPath` is seeded, `globalThis.exports` needs no seeding). The real blocker: the harness's `--alias node:module=@gjsify/module` retarget is applied IMPORTER-BLIND, so the `\0gjsify-gi-node:*` virtual modules the CLI's `gjsGiNodePlugin` emits — whose source is `import { createRequire } from 'node:module'` (`packages/infra/rolldown-plugin-gjsify/src/plugins/gjs-gi-node.ts`) — get their `node:module` import rewritten onto the polyfill UNDER TEST. The bundle then calls `@gjsify/module`'s own `createRequire` at top level, before the polyfill's lazy GLib namespace proxy (`var o = new Proxy(...)`) is initialized ⇒ `TypeError: Cannot read properties of undefined (reading 'filename_from_uri')` in `fileUrlToPath` — and even past the TDZ, the polyfill's Gio-based CJS loader cannot bootstrap `@gjsify/node-gi/gi` (it needs GLib, which needs the loader — a genuine cycle). The virtual gi modules MUST always get the RUNTIME's real `createRequire`. **Fix belongs in the CLI, not the harness/engine** (out of scope here): either skip user-alias rewriting when the importer is a gjsify virtual module (`importer?.startsWith('\0gjsify-')` in the alias plugin's resolveId), or have `gjs-gi-node.ts` obtain `createRequire` alias-proof via `process.getBuiltinModule('node:module')` (Node ≥ 22.3 / Bun / Deno 2). After that CLI fix, re-measure `module` — its remaining failures (if any) are expected to be ordinary suite-level ones.

### Near-passes / runtime-specific quirks (not blockers)
`iframe` (1 WebKit `Symbol.toStringTag ===`; deno 3), `v8` (4 `Buffer.copy` range errors on **node only** — bun/deno 72/72), `zlib` (1 deno flake), `tty` (deno 40/55 vs node 29/29 — terminal probing differs), `node-globals` (3 bun), `dgram` (node/bun 6 UDP-recv timeouts, deno clean).

## Proof legs (wired in CI)

The `consumer-suites` job in [`node-gi.yml`](../../.github/workflows/node-gi.yml) runs the harness `--require-pass` over **ten** packages on node/bun/deno: `sqlite` (Gda), `http2` (Soup), `zlib` (Gio), `tls` (Gio/glib-networking), `ws` (Soup), `dom-elements` (GdkPixbuf + the '2d' factory), `node-globals` (GLib), `canvas2d-core` (cairo/PangoCairo/GdkPixbuf), `crypto` (GLib.Checksum/Hmac) and `string_decoder` (pure TS) — every survey-green package whose system deps fit the job's minimal container (dnf adds `glib-networking gdk-pixbuf2 pango dejavu-sans-fonts` for the expansion). `crypto` + `string_decoder` additionally pin the P3 `imports.byteArray` seeding and the P4 forced-polyfill-closure harness fix. A regression in the reverse bridge fails that job. The existing `consumer-sqlite` job stays as-is. Still-green candidates NOT wired (deps too heavy for the container): `devtools`/`devtools-browser`/`storybook`/`adwaita-app` (gtk4/libadwaita/webkitgtk stack), `os` (spawns `ps`/`renice`), `worker_threads` (sab-native host surface).

## Follow-ups

Enumerated, prioritized by the survey above:

1. ~~**P1 fix (node-gi auto main-context co-pump under Node)** — unblocks `fs`/`net`/`dns`/`dgram`/`stream`. Highest leverage.~~ ✓ DONE (uv-driven auto-pump; see the P1 section above for the A/B numbers).
2. **P2 (bare `cairo`/`system`/`gettext` externalisation) — DONE**: `app/node.ts` derives the `exactExternal` set from `ALIASES_GJS_FOR_NODE`'s values, so canvas2d-core/canvas2d resolve `@gjsify/node-gi/cairo` on the GJS bundler now.
2½. **P2½ (caller-allocates OUT structs + Uint8Array→GBytes IN) — DONE**: `canvas2d-core` 529/543 → **578/578 on node/bun/deno** (see the P2½ section above).
3. **P3 marshalling-helper seeding — DONE**: `imports.byteArray` seeded in node-gi's globals shim (`overrides/byte-array.js`, gjs semantics, conformance-pinned). `os` ✅ 276/276 ×3; `child_process`'s residual is a `@gjsify/child_process` fidelity bug (unlistened `'error'` emit in `_execImpl` — see the P3 section), `module`'s is the P9 CLI alias-scoping bug.
4. **P5 (harness prepends each package's `prebuilds/` to `GI_TYPELIB_PATH`) — DONE**: `http`/`webrtc` and other Vala-bridge consumers now load their typelib on node-gi (residual failures are downstream marshalling gaps, not typelib-not-found).
5. **Full rollout — CI proof set widened to 10** (`sqlite`/`http2`/`zlib` + `tls`/`ws`/`dom-elements`/`node-globals`/`canvas2d-core`/`crypto`/`string_decoder`, see Proof legs). Remaining: committed `src/test.node-gi.mts` + `test:gjs-on-node` legs per package, and the GTK-stack candidates (`devtools`/`devtools-browser`/`storybook`/`adwaita-app`) once the job (or a sibling job) carries gtk4/libadwaita/webkitgtk.
6. **Full CI matrix:** run the whole survey (not just the proof set) as a non-gating `continue-on-error` job that publishes this table, so regressions/improvements surface per PR.
7. **P4 — DONE** (harness forced-polyfill closure; see P4). **P7 — DONE** (same closure + fixture staging; see P7). **P8 — DONE** (resolved upstream; see P8). Open: **P9** (CLI alias-scoping for virtual gi modules — unblocks `module`), the `@gjsify/child_process` `'error'`-listener fidelity fix, and optionally exporting `@gjsify/buffer`'s pure-TS helpers from its `globals.mjs` (see P4).
