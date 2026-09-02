# node-gi consumer survey — running `@gjsify/*` GJS test suites on Node/Bun/Deno

**Generated:** 2026-07-26 (harness run 18:09Z) · **Harness:** [`scripts/node-gi-consumer-harness.mjs`](../../scripts/node-gi-consumer-harness.mjs) · **Raw data:** [`node-gi-consumer-survey.json`](node-gi-consumer-survey.json)

This report generalizes the `@gjsify/sqlite` "run its own GJS test suite on Node via `@gjsify/node-gi`" leg (the [`consumer-sqlite`](../../.github/workflows/node-gi.yml) CI job / ADR-0005 second-consumer gate) into a **reusable cross-runtime harness**, then runs it across every GJS-only package with a test entry to produce a concrete PASS/FAIL gap report. The goal is to prioritize the remaining Axis-5 (`gi://` reverse bridge) work: **which real consumers already run unchanged on Node/Bun/Deno, and exactly what blocks the rest.**

Committed per-package `test:gjs-on-node` legs and a full CI matrix are deliberately **out of scope** here (see [Follow-ups](#follow-ups)); this survey plus the `consumer-suites` CI proof job are the deliverable.

## How the harness works

For each package the harness ([`scripts/node-gi-consumer-harness.mjs`](../../scripts/node-gi-consumer-harness.mjs)):

1. Picks a node-gi test **entry** — a committed `src/test.node-gi.mts` (a hand-written proof leg, like sqlite's) if present, else **generates** one from the package's existing `src/test.mts` by prepending a bare `print(...)` call. That bare GJS ambient global is the genuine-GJS-source signal `detectNodeGiGlobals` looks for: it flips `nodeGiGlobalsInject`, so `@gjsify/node-gi/globals` is auto-injected **and** `@girs/*` value imports resolve to their real bodies whose inner `gi://Ns?version=X` are rewritten to `requireGi('Ns','X')`. (Same mechanism sqlite's `test.node-gi.mts` uses.) In this run only `sqlite` used a committed entry; the other 32 were generated.
2. Builds that entry `gjsify build --app node --alias node:<name>=@gjsify/<name>` (the sqlite `--alias` pattern — the specs' `node:<name>` import is retargeted onto the GNOME-backed polyfill under test, not Node's own builtin), under Node via a Node-runnable `@gjsify/cli` (npm `rolldown`). The build additionally forces every `runtimes.node === "native"` `@gjsify/*` package in the target's transitive workspace-dep closure onto its polyfill body — a mixed polyfill/native graph is not the graph the suite exercises on gjs — and stages the package's on-disk test fixtures next to the bundle (`prebuild:test:fixtures` + a `dist/fixtures → ../fixtures` symlink).
3. Runs the ONE `--app node` bundle on **node**, and — reusing `packages/node-gi/example/harness.mjs`'s runtime map + PATH-skip — on **bun** and **deno** too (Node-API is their common ABI). Each consumed package's `prebuilds/<os>-<arch>/` is prepended to `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` (the CLI's own `detectNativePackages` + `buildNativeEnv`), so Vala-bridge consumers can load their typelib.
4. Captures build ok/fail, run exit code, the `@gjsify/unit` summary counts and representative failure lines, then **groups the failure reason** from the **failure region only** — the messages of the tests that actually failed, or the error lines of a build/load failure when a run produced no per-test markers. A green suite's hundreds of passing test names never decide the bucket, so the group attributions below are checkable against the samples stored beside them in the JSON.

It **tolerates** failures and captures them; `--require-pass` turns it into a CI gate (exit non-zero unless every listed package passes on node).

Statuses in the table: `pass` (clean summary, 0 failed) · `partial` (summary with failures) · `ran-no-summary` (clean exit code, but the suite never printed its `@gjsify/unit` summary) · `fail` (non-zero exit with no clean summary) · `timeout` (outlived the per-package budget and was killed). A wall-clock kill is reported under one of two reasons, because they are different diseases: `mainloop-hang-or-timeout` when the suite never got to report, and `no-exit-after-pass` when it reported cleanly and then refused to exit — the latter keeps its summary counts, so a green-but-hung run is visibly green.

### Environment

Fedora 44 (host desktop, full GTK stack) · GJS 1.88.0 · Node 24.15.0 · Bun 1.3.14 · Deno 2.9.3 · girepository-2.0 = 2.88.1 · `@gjsify/node-gi` built from this tree (node-gyp + staged prebuild for the Deno load path). Run as `--gjs-only --timeout 180000`: per-test timeout 5000 ms and per-suite 30 s (`@gjsify/unit` defaults), per-package wall clock 180 s.

## Scope

**33 packages** — every `@gjsify/*` whose `package.json#gjsify.runtimes.node` is `"none"` and which ships a `src/test.mts` (or a committed `src/test.node-gi.mts`). That is exactly what `--gjs-only` selects, and it is the population this survey is about: packages that have no Node story *except* the reverse bridge.

Packages declaring a `native` or `polyfill` node slot are out of scope by construction — they already run on Node without node-gi and are covered by their own `test:node` leg (`path`, `buffer`, `querystring`, `string_decoder`, `events`, `stream`, `assert` are in that group). One of them, `string_decoder`, is still wired into the `consumer-suites` CI gate as a pure-TS control; it therefore appears under [Proof legs](#proof-legs-wired-in-ci) but not in the table below.

## Results

Legend: ✅ pass · 🟡 partial (some tests fail) · ❌ fail (non-zero exit / no clean summary) · ⏱ killed on the wall clock · ▶ ran but emitted no `@gjsify/unit` summary.

| pkg | build | node | bun | deno | failure group |
|---|---|---|---|---|---|
| `adwaita-app` | ok | ✅ 28/28 | ✅ 28/28 | ✅ 28/28 | |
| `canvas2d` | ok | ✅ 191/191 | ✅ 191/191 | ✅ 191/191 | |
| `canvas2d-core` | ok | ✅ 599/599 | ✅ 599/599 | ✅ 599/599 | |
| `child_process` | ok | ✅ 225/225 | 🟡 28/37 | 🟡 28/37 | bun/deno: mainloop-drain |
| `crypto` | ok | ✅ 626/626 | ✅ 626/626 | ✅ 626/626 | |
| `devtools` | ok | ✅ 39/39 | ✅ 39/39 | ✅ 39/39 | |
| `devtools-browser` | ok | ✅ 40/40 | ✅ 40/40 | ✅ 40/40 | |
| `devtools-cdp` | ok | ✅ 86/86 | ✅ 86/86 | ✅ 86/86 | |
| `devtools-mcp` | ok | ✅ 7/7 | ✅ 7/7 | ✅ 7/7 | |
| `devtools-protocol` | ok | ✅ 24/24 | ✅ 24/24 | ✅ 24/24 | |
| `dgram` | ok | ✅ 146/146 | 🟡 123/129 | ✅ 118/118 | bun: mainloop-drain |
| `dns` | ok | ✅ 118/118 | 🟡 78/85 | 🟡 79/85 | bun/deno: mainloop-drain |
| `dom-elements` | ok | ✅ 441/441 | ✅ 441/441 | ✅ 441/441 | |
| `event-bridge` | ok | ✅ 0/0 | ✅ 0/0 | ✅ 0/0 | (vacuous — 0 runnable specs) |
| `fs` | ok | ✅ 657/657 | ▶ no-summary | ▶ no-summary | bun/deno: no-unit-summary |
| `http` | ok | ❌ fail | 🟡 845/874 | 🟡 845/874 | node: other; bun/deno: mainloop-drain |
| `http2` | ok | ✅ 102/102 | ✅ 102/102 | ✅ 102/102 | |
| `iframe` | ok | ✅ 275/275 | ✅ 275/275 | ✅ 275/275 | |
| `module` | ok | ❌ fail | ❌ fail | ❌ fail | alias leak FIXED (gap 5); now blocked on the rolldown `keepNames` helper-order bug (`__name is not a function`) |
| `net` | ok | ❌ fail | 🟡 241/284 | 🟡 241/284 | node/bun/deno: mainloop-drain |
| `node-globals` | ok | ✅ 221/221 | 🟡 218/221 | ✅ 221/221 | bun: 3 fidelity gaps in Bun's own native `structuredClone` |
| `os` | ok | ✅ 276/276 | ✅ 276/276 | ✅ 276/276 | |
| `sqlite` | ok | ✅ 105/105 | ✅ 105/105 | ✅ 105/105 | |
| `storybook` | ok | ✅ 9/9 | ✅ 9/9 | ✅ 9/9 | |
| `tls` | ok | ✅ 158/158 | ✅ 158/158 | ✅ 158/158 | |
| `tsc` | ok | ✅ 0/0 | ✅ 0/0 | ✅ 0/0 | (vacuous — 0 runnable specs) |
| `tty` | ok | ✅ 29/29 | ✅ 29/29 | 🟡 40/55 | deno: assertion-mismatch |
| `v8` | ok | 🟡 56/60 | ✅ 72/72 | ✅ 72/72 | node: other |
| `webaudio` | ok | ▶ no-summary | ▶ no-summary | ▶ no-summary | no-unit-summary |
| `webrtc` | ok | ▶ no-summary | ▶ no-summary | ▶ no-summary | no-unit-summary |
| `worker_threads` | ok | ✅ 282/282 | ▶ no-summary | ▶ no-summary | bun/deno: no-unit-summary |
| `ws` | ok | ✅ 19/19 | ✅ 19/19 | ✅ 19/19 | |
| `zlib` | ok | ✅ 53376/53376 | ✅ 53376/53376 | 🟡 53374/53375 | deno: other |

Every package **builds** `--app node`. **25 of 33 pass on node, 20 on bun, 19 on deno** — counting a pass as a ✅ row that actually ran specs, so the two `0/0` non-runs (`event-bridge`, `tsc`, explained below) are excluded; ~57k tests pass per runtime (the bulk is `zlib`'s exhaustive matrix).

### Genuine passes

**Green on all three runtimes (19, of which 17 have runnable specs):** `sqlite` (Gda), `http2` (Soup 3.0 + ALPN), `tls` (Gio/glib-networking), `ws` (Soup), `crypto` (GLib.Checksum/Hmac), `os` (GLib spawn + `imports.byteArray`), `dom-elements` (GdkPixbuf + the `'2d'` factory), `canvas2d-core` (cairo + PangoCairo + GdkPixbuf + Gdk — headless Canvas 2D incl. text metrics and `putImageData`), `canvas2d` (the GTK-bridge package), `iframe` (WebKit), and the pure-logic layers of `devtools`, `devtools-browser`, `devtools-cdp`, `devtools-mcp`, `devtools-protocol`, `storybook`, `adwaita-app`.

**Green on node, runtime-specific residue elsewhere (8):** `child_process` (Gio.Subprocess), `dgram` (UDP via Gio.Socket), `dns` (Gio.Resolver), `fs` (Gio.File + Gio.FileMonitor), `node-globals` (GLib), `worker_threads` (Gio.Subprocess workers + sab-native), `zlib` (Gio.ZlibCompressor), `tty`.

> The two lists add up to the node figure above: 17 runnable all-three + 8 node-only = 25.

> `devtools`/`storybook`/`adwaita-app` build against `gi://Gtk`/`Adw` and pass **headless** because their unit specs exercise pure logic (`LoadToken`, the story registry, nav-model, mock widget-trees), not live widgets. Live-GTK-on-Node is separately proven by the `gtk-smoke` job. `event-bridge` and `tsc` report `0/0`: both suites live entirely inside `on('Gjs', …)`, which does not fire on the node-gi path, so nothing runs — a `0/0` is not a pass.

## Gaps, grouped by root cause (prioritized)

Each root cause is fixed once and unblocks all its consumers.

### 1. Process lifetime under the reverse bridge — node half RESOLVED, bun/deno half open

**Affects:** `node-globals` (node: hang — FIXED here; bun/deno: early exit — still open), plus `fs` + `worker_threads` on bun/deno (same `ran-no-summary` shape, same cause). For `fs` the shared cause is now more than an inference from shape: its node leg passes 657/657 since the gap-7 harness fix, so the bun/deno `ran-no-summary` cannot be about missing assets.

The symptom was two-faced and turned out to be **two unrelated bugs**. The keep-alive hypothesis explains only the bun/deno half.

**Node — an infinite `System.exit` ⇄ `process.exit` recursion. FIXED.** A CPU profile of the hung process gives the whole loop: a GLib idle callback → node-gi's `system.exit` → `globalThis.process.exit` → `@gjsify/process`'s `exitProcess` → `ensureMainLoop()` + `GLib.idle_add(…)` → repeat. `@gjsify/node-globals/register` replaces `globalThis.process` with the gjsify polyfill *unconditionally*, and that polyfill's `exit()` takes its GJS path — deferring the real exit through a GLib idle — whenever `imports.system.exit` exists. node-gi's `system.exit` in turn read `globalThis.process.exit`, i.e. the polyfill. The cycle closed, each turn armed a fresh idle source, and the process spun at 100 % CPU instead of terminating. Nothing to do with keep-alive.

GJS's `System.exit` is the `exit()` syscall — terminal, uninterceptable — so the bridge must reach the RUNTIME's own process exit, never whatever `globalThis.process` currently is. `system.js` now binds it once at module evaluation, preferring `process.getBuiltinModule('node:process')`. Regression cover: conformance `system-exit-lifetime`, whose exit behaviour is byte-compared against `gjs -m` on node/bun/deno.

With that alone the whole `--require-pass` proof set is green on node, `node-globals` included (221/221, exits in 0.09 s).

**Bun/Deno — the early exit. RESOLVED** (the JS-armed keep-alive pump). `startMainContextPump` was opt-in (nothing called it) and its timer permanently `unref`'d, so an armed GLib source neither dispatched nor held the process. `@gjsify/node-globals/register` swaps `globalThis.setTimeout` for `GLib.timeout_add` whenever `imports.gi.GLib` resolves — which it does under the bridge — so the first spec awaiting a `setTimeout` (`clearImmediate › should cancel a pending setImmediate`) waits on a source nobody will ever dispatch, the runtime loop runs empty, and the process exits 0 with the suite half-run.

Auto-arming the pump with keep-alive accounting fixes it (measured: `node-globals` 218/221 on bun, 221/221 on deno; `fs` 656/657 on bun; `worker_threads` 278/280 on bun, 282/282 on deno — every `ran-no-summary` gone), which is what landed: keying the hold on "the context has any scheduled source" makes a finished GTK program immortal (GDK leaves a ~1 s repeating timeout armed), so the hold counts JS-armed GLib work only — which also fixes the matching pre-existing Node hang in `node --test test/gtk-smoke.test.mjs`. On Deno the pump's beat additionally stays COMPLETELY out of the addon while idle (it reads the JS-armed counter through the zero-napi `pumpPendingCount` Int32Array view and gates dispatch on it): merely entering the addon from a timer tick during Deno's between-test-files GC window reproduces the documented #47 teardown SIGSEGV, so the ungated pump took the GTK/Adw smoke leg from exit 0 to a deterministic 139 — the view-gated beat brings it back (measured 10/10 exit 0, both files passing).

### 2. No auto-pump on bun/deno — async Gio suites time out where node passes

**Affects:** `child_process` (28/37), `dns` (78–79/85), `dgram` (bun 123/129), `net` (241/284), `http` (845/874) — all on bun and/or deno. On node, `child_process`/`dns`/`dgram` pass outright, and `net`/`http` fail for unrelated reasons (gaps 3 and 4).

Signature is uniform: `Timeout: "…" exceeded 5000ms` on exactly the tests that await a Gio async completion (subprocess stdout, resolver lookups, UDP recv, socket round-trips, server requests). Node drains pending GLib sources from its own libuv loop (the uv-driven auto-pump in node-gi's `src/loop.cc`); bun and deno have no libuv to hook, so they run the timer-driven `startMainContextPump` instead, and it does not deliver the same completions in time. Closing this is what turns the bun/deno columns green for the whole async-Gio family at once.

### 3. `net` on node — residual socket-lifecycle failures

**Affects:** `net` (node).

Even with the auto-pump, the node run exits non-zero with a small, specific set: `should emit end event when server closes` and `should emit connect and ready events` time out, and `should handle server close while client connected` fails an equality assertion. The bulk of the suite is fine (bun/deno reach 241/284 with the pump-related timeouts on top), so this is a close-path/event-ordering gap in `@gjsify/net` or in how a `Gio.SocketService` shutdown propagates, not the missing-pump class above.

### 4. `http` on node — an uncaught assertion inside a stream callback aborts the process

**Affects:** `http` (node).

Reproduced with the harness's typelib env: the suite runs to `http.createServer round-trip › should receive request headers`, where the expectation fires **inside** an `IncomingMessage` `'end'` listener:

```
Error:       Expected values to match using ===
      Expected: custom-value (string)
      Actual: no header (string)
    at IncomingMessage.<anonymous> (…/test.node-gi.harness.http.mjs)
    at endReadableNT (node:internal/streams/readable)
```

Two distinct problems: a **fidelity bug** (a request header set by the client does not reach the handler — `no header`), and the fact that a throw from a listener dispatched off a GLib source is fatal under Node while it is merely logged under gjs, so the process dies before `@gjsify/unit` can print anything. bun/deno get past it (the same assertion is counted, not fatal) and finish at 845/874.

### 5. `module` — user `--alias` leaked into the CLI's virtual gi modules — **FIXED**

**Affected:** `module` (all three runtimes). **Status: resolved** in `rolldown-plugin-gjsify`.

`TypeError: Cannot read properties of undefined (reading 'filename_from_uri')` (bun: `undefined is not an object (evaluating 'o.filename_from_uri')`). The harness's `--alias node:module=@gjsify/module` retarget was applied IMPORTER-BLIND, so the `\0gjsify-gi-node:*` virtual modules the CLI's `gjsGiNodePlugin` emits — whose source is `import { createRequire } from 'node:module'` ([`plugins/gjs-gi-node.ts`](../../packages/infra/rolldown-plugin-gjsify/src/plugins/gjs-gi-node.ts)) — got their `node:module` import rewritten onto the polyfill UNDER TEST. The bundle then called `@gjsify/module`'s own `createRequire` at top level, before the polyfill's lazy GLib namespace proxy was initialized; and even past that, the polyfill's Gio-based CJS loader cannot bootstrap `@gjsify/node-gi/gi` (it needs GLib, which needs the loader — a genuine cycle).

**Fix (landed):** `aliasPlugin` skips the alias tables entirely when the IMPORTER is a gjsify-generated virtual module (`isGjsifyVirtualModuleId`, i.e. any `\0gjsify-*` id — entry wrapper, gi-node, napi-addon, gjs-imports-empty). The importer-scoped guard was chosen over the alternative (`process.getBuiltinModule('node:module')` inside `gjs-gi-node.ts`) because it protects EVERY generated module rather than one specifier in one plugin, and it depends on no runtime API. `process.getBuiltinModule` does exist on all three runtimes as installed here (node 24.15.0, bun 1.3.14, deno 2.9.3 — measured), but it is a Node ≥ 22.3 API and the `--app node` bundle imposes no such floor of its own, so pinning the fix to it would trade a build-layer guarantee for a runtime-version assumption. All four virtual-id prefixes are now derived from one `GJSIFY_VIRTUAL_PREFIX` constant so a future virtual module inherits the protection. Coverage: `packages/infra/cli/src/alias-plugin.spec.ts` (10 specs) + a two-sided e2e in `tests/e2e/node-gi-build` (the generated module keeps `node:module`; the user's own source is still aliased).

**Re-measured** (`node scripts/node-gi-consumer-harness.mjs @gjsify/module --runtimes node`): the bundle now emits `import { createRequire } from "node:module"` and the `filename_from_uri` TypeError is gone. `module` still fails, with a DIFFERENT and pre-existing error — `TypeError: __name is not a function` — which reproduces identically with the guard disabled and disappears under `--minify false`: rolldown 1.1.4 emits the `output.keepNames` helper (`var __name = …`) ~9 kB into the chunk while the gi virtual module calls it at byte ~200. Tracked in `status/open-todos.md` as an upstream rolldown issue; it is not an alias-layer problem.

### 6. `webrtc` — native abort in the data-channel path (RESOLVED)

**Affected:** `webrtc` (node, bun; deno timed out in the same region).

The suite got through construction, SDP round-trips, ICE candidates and the deferred-API guards, then aborted inside `Loopback data channel`:

```
free(): invalid pointer
   (SIGABRT, exit 134)
```

**Root cause — an ENGINE bug, not the Vala bridge.** `JsToGIArgument`'s boxed-handle
branch handed the callee `h->ptr` verbatim, ignoring the argument's transfer
annotation. A `(transfer full)` IN arg is ADOPTED by the callee, so both the callee
and the still-owning JS boxed handle freed the same block. The trigger is
`RTCSessionDescription.toGstDesc()`:

```ts
const [ret, sdp] = GstSdp.SDPMessage.new_from_text(this.sdp);   // OUT (transfer full) → handle owns it
return GstWebRTC.WebRTCSessionDescription.new(type, sdp);       // IN  (transfer full) → callee adopts it
```

valgrind pins all three events on one 184-byte block: allocated in
`gst_sdp_message_new` ← `gst_sdp_message_new_from_text` ← `gi_function_info_invoke`;
freed by `gst_webrtc_session_description_free` ← the node-gi `BoxedHandle` finalizer;
then freed AGAIN by `gst_sdp_message_free` ← the SDPMessage handle's own finalizer.
The `gst_sdp_message_init` frame in the abort backtrace is `gst_sdp_message_uninit`
walking the already-released field pointers.

The same code path is safe on plain GJS (`gjsify workspace @gjsify/webrtc test`
completes, `Loopback data channel` passes) because gjs COPIES a transferring IN arg —
`refs/gjs/gi/wrapperutils.h` `GIWrapperBase::transfer_to_gi_argument` →
`Instance::copy_ptr` (`g_boxed_copy`, or `g_variant_ref` for GVariant). node-gi now
mirrors that (`TransferBoxedIn` in `packages/node-gi/node-gi/src/marshal.cc`), so the
callee owns an independent instance and the handle keeps its own. Transfer-NOTHING is
unchanged. Regression: `packages/node-gi/node-gi/test/boxed-in-transfer.test.mjs`
(GStreamer-free — `pango_attr_list_insert`, whose `attr` is `(transfer full)`; SIGSEGV
before the fix).

The Vala bridge (`@gjsify/webrtc-native`) is untouched; its prebuilt `.so`/`.typelib`
did not need rebuilding.

**Remaining:** the suite runs to completion on node, bun and deno but still scores
`no-unit-summary` — `packages/web/webrtc/src/test.mts` awaits its spec functions
directly instead of calling `@gjsify/unit`'s `run()`, so no summary line is emitted
(identically on GJS). Adding `run()` would make `gjsify workspace @gjsify/webrtc test`
exit non-zero on the suite's ~20 pre-existing functional failures, so it is tracked
separately rather than folded into this fix.

### 7. `fs` — the harness staged only `fixtures/`, not the suite's `test/` dir — **FIXED**

**Affected:** `fs` (node: hard fail; bun/deno: early exit with no summary). **Status: resolved on node**; the bun/deno residue survived and is gap 1, not this.

`Failed to create file "…/packages/node/fs/dist/test/watch.js.2F2YS3": No such file or directory`. `sync.spec.ts` resolves its scratch file as `join(__dirname, 'test/watch.js')`, i.e. relative to the BUNDLE. The package's own test bundle lives at the package root (where `test/` exists); the harness builds into `dist/`, and `stageFixtures` bridged only `fixtures/` (`dist/fixtures → ../fixtures`), not `test/`. **This was never an `@gjsify/fs` defect and never a node-gi finding** — the suite was measured against a directory layout the harness itself created.

**Fix (landed):** `stageFixtures` → `stageTestAssets`, driven by a `STAGED_ASSET_DIRS = ['fixtures', 'test']` list rather than one hard-coded name, so every on-disk asset dir a package ships is bridged the same way. Symlinks, not copies: these suites WRITE into the dirs (`writeFileSync(watchMe)` / `unlinkSync(watchMe)`), so a copy would diverge from the tree the package's own `test:gjs` run uses. Coverage: `tests/e2e/node-gi-consumer-harness/run.mjs` pins the SET of bridged dirs plus link-resolution and idempotence (the three cases fail if the list is reverted to `['fixtures']`).

**Re-measured** (`node scripts/node-gi-consumer-harness.mjs @gjsify/fs --runtimes node`):

| | before | after |
|---|---|---|
| status | `fail` | **`pass`** |
| counts | — | **657/657** |
| reason | `other` — `Failed to create file "…/packages/node/fs/dist/test/watch.js.UIV0S3": No such file or directory` | — |

So `@gjsify/fs` runs its entire GJS suite unchanged on Node via the reverse bridge. **Residual:** bun and deno still `ran-no-summary` — the same early-exit shape as `node-globals`/`worker_threads` in gap 1, unchanged by this fix and tracked there.

### 8. Display/media-bound and bespoke entries

`webaudio` emits no `@gjsify/unit` summary on any runtime and its failures are `Unable to decode audio data` — the GStreamer decodebin path is not usable in this configuration, and its bespoke `test.mts` has no `run()` summary either. Low priority.

### 9. Runtime-specific quirks (not blockers)

`v8` — 4 `Buffer.copy` range errors (`The value of "sourceStart" is out of range …`) on **node only**, which also cuts the run short (60 registered vs 72 on bun/deno). `tty` — deno registers a different suite (40/55, all `Expected values to match using ===` on the color-depth probes: `NO_COLOR`, `TERM=xterm-256color`, `TERM=dumb`), while node and bun are 29/29. `zlib` — one deno failure, `gunzip async should decompress concatenated gzip members — failed to write whole buffer`, out of 53375.

## Proof legs (wired in CI)

The `consumer-suites` job in [`node-gi.yml`](../../.github/workflows/node-gi.yml) runs the harness `--require-pass` over **nine** packages on node/bun/deno: `sqlite` (Gda), `http2` (Soup), `zlib` (Gio), `tls` (Gio/glib-networking), `ws` (Soup), `dom-elements` (GdkPixbuf + the `'2d'` factory), `node-globals` (GLib), `crypto` (GLib.Checksum/Hmac) and `string_decoder` (pure TS). The job pins Node 24 (gjsify's `--app node` compile target) and installs `glib-networking gdk-pixbuf2 pango dejavu-sans-fonts` on top of the base container. A regression in the reverse bridge fails that job; the existing `consumer-sqlite` job stays as-is.

**The counts in this report were measured on a Fedora 44 DESKTOP with the full GTK stack; the gate runs a minimal Fedora 44 container.** That difference — not any code change — is why a green row here is not by itself sufficient to add a package to the gate. Before promoting a package, check what its bundle actually loads (`grep -o "requireGi(\`[A-Za-z]*\`" <bundle>`) against what the container installs.

Two current consequences:

- **`node-globals` used to be in the gate and hang on this desktop** (gap 1) — that latent red is closed: it now passes 221/221 and exits in 0.09 s on node, and the whole nine-package `--require-pass` set is green.
- **`canvas2d-core` is 599/599 on all three runtimes, and the headless core itself is Gdk-free** — the only `gi://Gdk` file is `src/gdk-pixel-bridge.ts`, exposed as the side-effect subpath `@gjsify/canvas2d-core/gdk`, so nothing in the package's ROOT entry graph pulls Gdk. What is *not* true is that its SUITE runs without Gdk: `src/test.mts` imports `./gdk-pixel-bridge.js` on purpose (so the core's pixel specs run standalone), and the built harness bundle consequently requires `Gdk 4.0`, `GdkPixbuf`, `Pango`, `PangoCairo` plus bare `cairo`. Promoting it into the gate therefore needs one of: a committed `src/test.node-gi.mts` that exercises the headless core without the GDK pixel bridge, or `gtk4` in the container (which pulls graphene/vulkan-loader into a 20-minute job).

Still-green candidates not wired (deps too heavy for *this* container): `devtools`/`devtools-browser`/`devtools-cdp`/`devtools-mcp`/`devtools-protocol`/`storybook`/`adwaita-app` (gtk4/libadwaita/webkitgtk stack), `os` (spawns `ps`/`renice`), `worker_threads` (sab-native host surface), `canvas2d` (GTK).

`iframe` left that list. It is wired as its own committed `test:gjs-on-node` leg in `node-gi.yml`'s `gtk-host-node` job, whose container is the one that DOES carry the GTK/WebKit stack — the sibling job follow-up 7 names. That leg is what [ADR 0022](../adr/0022-webkit-on-darwin.md) § *Amendment — the `node` slot* rests on; it re-measured 275/275 on GJS 1.88.1 / Node 24.19.0 with `DISPLAY` and `WAYLAND_DISPLAY` both unset. Note what a committed leg has to spell that the harness does for free: `--alias @gjsify/message-channel=…/lib/esm/index.js`, one member of the forced sibling-polyfill closure. Without it the node leg runs Node's own `MessageChannel` while the gjs leg runs ours, and `Symbol.toStringTag identifies the types` is red at 274 — a difference in the CORPUS, arriving as a defect report about the package.

## Follow-ups

Prioritized by the gaps above:

1. **Bun/Deno process lifetime** — the node non-exit half of gap 1 is fixed; the bun/deno early exit needs the auto-armed portable pump, whose keep-alive must count JS-armed GLib work only (a "any scheduled source" rule immortalizes a finished GTK program) and which still trips Deno's #47 teardown race on the GTK smoke files.
2. **bun/deno main-context pump parity** (gap 2) — unblocks the bun/deno columns of `child_process`, `dns`, `dgram`, `net`, `http` in one change.
3. ~~**CLI alias-scoping for virtual gi modules** (gap 5)~~ — **done**; `module` now blocks on the rolldown `keepNames` helper-order bug instead (`status/open-todos.md`).
4. **`@gjsify/http` request-header propagation + throw-in-callback fatality** (gap 4), and **`@gjsify/net`'s close/connect event ordering** (gap 3).
5. ~~**`webrtc` data-channel double-free** (gap 6)~~ — RESOLVED: node-gi now copies a `(transfer full)` boxed IN arg (gap 6). Residual: give `@gjsify/webrtc`'s `test.mts` a `run()` summary so the harness can score it.
6. ~~**Harness fix:** stage the suite's on-disk `test/` dir alongside `fixtures/` (gap 7).~~ — **done**; `fs` now passes 657/657 on node. Its bun/deno `ran-no-summary` survived the fix and belongs to gap 1.
7. **Widen the proof set:** `canvas2d-core` once its suite can run without `Gdk` (or the container carries gtk4); the GTK-stack candidates once a sibling job carries gtk4/libadwaita/webkitgtk. `iframe` took that second route and is wired in `gtk-host-node` (see above) — as a committed leg, not as a proof-set member, because its `node: "polyfill"` slot is a claim about the package rather than about the bridge and belongs where `reverse-bridge-leg` can hold it.
8. **Full CI matrix:** run the whole survey (not just the proof set) as a non-gating `continue-on-error` job that publishes this table, so regressions and improvements surface per PR.
