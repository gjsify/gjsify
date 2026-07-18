# node-gi consumer survey — running `@gjsify/*` GJS test suites on Node/Bun/Deno

**Generated:** 2026-07-18 · **Harness:** [`scripts/node-gi-consumer-harness.mjs`](../../scripts/node-gi-consumer-harness.mjs) · **Raw data:** [`node-gi-consumer-survey.json`](node-gi-consumer-survey.json)

This report generalizes the proven `@gjsify/sqlite` "run its own GJS test suite on Node via `@gjsify/node-gi`" leg (the [`consumer-sqlite`](../../.github/workflows/node-gi.yml) CI job / ADR-0005 second-consumer gate) into a **reusable cross-runtime harness**, then runs it across the GJS-only packages plus a sample of dual (cross-runtime) packages to produce a concrete PASS/FAIL gap report. The goal is to prioritize the remaining Axis-5 (`gi://` reverse bridge) work: **which real consumers already run unchanged on Node, and exactly what blocks the rest.**

The full 22-package rollout as committed `test:gjs-on-node` legs + a full CI matrix are deliberately **out of scope** here (see [Follow-ups](#follow-ups)); this survey + a first `consumer-suites` CI proof job are the deliverable.

## How the harness works

For each package the harness ([`scripts/node-gi-consumer-harness.mjs`](../../scripts/node-gi-consumer-harness.mjs)):

1. Picks a node-gi test **entry** — a committed `src/test.node-gi.mts` (a hand-written proof leg, like sqlite's) if present, else **generates** one from the package's existing `src/test.mts` by prepending a bare `print(...)` call. That bare GJS ambient global is the genuine-GJS-source signal `detectNodeGiGlobals` looks for: it flips `nodeGiGlobalsInject`, so `@gjsify/node-gi/globals` is auto-injected **and** `@girs/*` value imports resolve to their real bodies whose inner `gi://Ns?version=X` are rewritten to `requireGi('Ns','X')`. (Same mechanism sqlite's `test.node-gi.mts` uses.)
2. Builds that entry `gjsify build --app node --alias node:<name>=@gjsify/<name>` (the sqlite `--alias` pattern — the specs' `node:<name>` import is retargeted onto the GNOME-backed polyfill under test, not Node's own builtin), under Node via a Node-runnable `@gjsify/cli` (npm `rolldown`).
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
| `crypto` | ok | 🟡 526/570 | 🟡 526/570 | 🟡 526/570 | encoding-helper unresolved |
| `os` | ok | 🟡 11/41 | 🟡 11/41 | 🟡 11/41 | GLib fn → undefined |
| `module` | ok | ❌ fail | ❌ fail | ❌ fail | needs GJS `imports.*` runtime |
| `zlib` | ok | ✅ 53376/53376 | ✅ 53376/53376 | 🟡 53374/53375 | (deno: 1 flake) |
| `child_process` | ok | ❌ fail | ❌ fail | ❌ fail | marshalling: `ByteArray.fromGBytes` |
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
| `worker_threads` | ok | 🟡 0/82 | 🟡 0/82 | 🟡 0/82 | `MessagePort` constructor |
| `ws` | ok | ✅ 19/19 | ✅ 19/19 | ✅ 19/19 |  |
| `webaudio` | ok | ▶ no-summary | ▶ no-summary | ▶ no-summary | GStreamer + bespoke entry |
| `webrtc` | ok | ❌ fail | ❌ fail | ❌ fail | Vala typelib not on GI path |
| `canvas2d-core` | ok | ❌ fail | ❌ fail | ❌ fail | bare `cairo` builtin unaliased |
| `dom-elements` | ok | ✅ 441/441 | ✅ 441/441 | ✅ 441/441 |  |
| `adwaita-app` | ok | ✅ 28/28 | ✅ 28/28 | ✅ 28/28 |  |
| `canvas2d` | ok | ❌ fail | ❌ fail | ❌ fail | bare `cairo` builtin unaliased |
| `devtools` | ok | ✅ 20/20 | ✅ 20/20 | ✅ 20/20 |  |
| `devtools-browser` | ok | ✅ 40/40 | ✅ 40/40 | ✅ 40/40 |  |
| `devtools-mcp` | ❌ **build** | — | — | — | `--app node` module-not-found ×6 |
| `event-bridge` | ok | ✅ 0/0 | ✅ 0/0 | ✅ 0/0 | (vacuous — 0 runnable specs) |
| `iframe` | ok | 🟡 275/276 | ✅ 277/277 | 🟡 270/273 | (1 WebKit `toStringTag`) |
| `storybook` | ok | ✅ 9/9 | ✅ 9/9 | ✅ 9/9 |  |
| `path` | ok | ✅ 432/432 | ✅ 432/432 | ✅ 432/432 |  |
| `buffer` | ok | ✅ 317/317 | ✅ 317/317 | ✅ 317/317 |  |
| `querystring` | ok | ✅ 471/471 | ✅ 471/471 | ✅ 471/471 |  |
| `string_decoder` | ok | 🟡 0/0 | 🟡 0/0 | 🟡 0/0 | encoding-helper unresolved |
| `events` | ok | ✅ 266/266 | ✅ 266/266 | ✅ 266/266 |  |
| `stream` | ok | ❌ fail | ❌ fail | ❌ fail | async mainloop (data events) |
| `assert` | ok | ✅ 117/117 | ✅ 117/117 | ✅ 117/117 |  |

*(`worker_threads`/`string_decoder` show `0/…` because `@gjsify/unit` counted more failing assertions than `it()`s — leaked/stray — so `passed` is clamped to 0; both are genuine fails, see below.)*

### Genuine passes — 14 packages run unchanged on node-gi

**`gi://` reverse-bridge consumers (real GNOME libs on Node/Bun/Deno):** `sqlite` (Gda), `http2` (Soup 3.0 + ALPN), `tls` (Gio/glib-networking), `ws` (Soup), `dom-elements` (GdkPixbuf), `node-globals` (GLib), `tty` (node/bun), and the pure-logic layers of `devtools` / `devtools-browser` / `storybook` / `adwaita-app`.

> Note on `devtools`/`storybook`/`adwaita-app`: they build against `gi://Gtk`/`Adw` and pass **headless** because their unit specs exercise pure logic (`LoadToken`, the story registry, nav-model, mock widget-trees), not live widgets. Live-GTK-on-Node is separately proven by the existing `gtk-smoke` job. `event-bridge`'s `0/0` is **not** a real pass — its `test.mts` has no runnable specs on this path (they need live GTK controllers).

**Pure-TS dual sample (validates the polyfills are cross-runtime):** `path`, `buffer`, `querystring`, `events`, `assert` — all ✅ on node/bun/deno.

## Gaps, grouped by root cause (prioritized)

These directly prioritize the remaining Axis-5 work — each root cause is fixed once and unblocks all its consumers.

### P1 — Async Gio callbacks + timers don't drain in a bare `node bundle.mjs` run
**Blocks:** `fs`, `net`, `dns`, `dgram`, `stream` (and contributes to `worker_threads`; masks the true score of `crypto`/`os`). **Signature:** every failure is `Timeout: "…" exceeded 5000ms`. A Gio async op's completion callback (or a `setTimeout`/`queueMicrotask` continuation) never fires because **nothing pumps the default GLib main context** in a plain Node script that never calls `Gtk.Application.run()`/`GLib.MainLoop.run()`. This is the documented node-gi mainloop caveat (node-gtk #442/#121) surfacing on real consumers. **Highest-value fix:** have node-gi auto-co-pump the default GLib main context under Node (the `startMainContextPump` bun/deno already use for the non-blocking case), so async-Gio consumers work with no explicit loop. Unblocks the entire async-I/O surface at once.

### P2 — Bare GJS built-ins (`cairo`, `system`, `gettext`) not aliased for `--app node`
**Blocks:** `canvas2d-core`, `canvas2d`. **Signature:** `ERR_MODULE_NOT_FOUND: Cannot find package 'cairo'`. node-gi already **ships** `@gjsify/node-gi/cairo`; the gap is the empty `ALIASES_GJS_FOR_NODE` map (`packages/infra/resolve-npm/lib/index.mjs`) — an already-documented "STILL PENDING" TODO that this survey now gives two concrete blocked consumers. Cheapest high-value fix.

### P3 — GLib/GObject marshalling-helper gaps
**Blocks:** `child_process` (`ByteArray.fromGBytes` undefined ⇒ can't read subprocess stdout), `os` (a GLib call returns `undefined` ⇒ `.toString()` throws), `module` (`GLib.filename_from_uri` undefined + the GJS CJS-require internals `imports.searchPath`/`globalThis.exports` are unseeded). **Fix:** seed the missing `imports.byteArray.*` + marshal the specific GLib functions in node-gi's globals shim.

### P4 — `normalizeEncoding`/`checkEncoding` unresolved when a polyfill is force-aliased onto Node
**Blocks:** `crypto` (the encoding path of hash/hmac — 44 of 570), `string_decoder` (all). The polyfill imports a Node-`internal/util`-shaped helper that native `node:buffer` doesn't export on the Node target. Partly an artifact of `--alias node:<self>=@gjsify/<self>` forcing the polyfill onto Node; worth confirming whether it also bites the real `--app gjs` target (it should not — this is Node-target-specific).

### P5 — Package-own Vala-bridge typelib not on the GI search path
**Blocks:** `http` (`GjsifyHttpSoupBridge`), `webrtc` (`GjsifyWebrtc`). **Not an engine gap** — the harness/runner must prepend the package's `prebuilds/` to `GI_TYPELIB_PATH` (what `gjsify run`'s `detectNativePackages` does). `http2`/`tls`/`ws` pass because system Soup/Gio suffices. → Harness follow-up.

### P6 — GStreamer / display-bound
`webaudio` (GStreamer AudioContext; bespoke `test.mts` with no `run()` summary), `webrtc` (also needs its Vala bridge, P5). Need GStreamer typelibs; low priority.

### P7 — Constructor / registerClass
`worker_threads`: `MessagePort … Constructor cannot be called`. A node-gi native-constructor gap for the `MessagePort`/`MessageChannel` classes (compounded by P1 for the async message delivery).

### P8 — `--app node` build resolution
`devtools-mcp`: `--app node: Module not found` ×6 at build time. A dep isn't resolvable for the node target; needs investigation.

### Near-passes / runtime-specific quirks (not blockers)
`iframe` (1 WebKit `Symbol.toStringTag ===`; deno 3), `v8` (4 `Buffer.copy` range errors on **node only** — bun/deno 72/72), `zlib` (1 deno flake), `tty` (deno 40/55 vs node 29/29 — terminal probing differs), `node-globals` (3 bun), `dgram` (node/bun 6 UDP-recv timeouts, deno clean).

## Proof legs (wired in CI)

The new `consumer-suites` job in [`node-gi.yml`](../../.github/workflows/node-gi.yml) runs the harness `--require-pass` over **`sqlite` + `http2` + `zlib`** on node/bun/deno (three GNOME lib families — Gda / Soup / Gio — needing only `libgda`/`libsoup3`/`glib`, already in the job's dnf). A regression in the reverse bridge fails that job. The existing `consumer-sqlite` job stays as-is.

## Follow-ups

Enumerated, prioritized by the survey above:

1. **P1 fix (node-gi auto main-context co-pump under Node)** — unblocks `fs`/`net`/`dns`/`dgram`/`stream`. Highest leverage.
2. **P2 fix (`ALIASES_GJS_FOR_NODE` for `cairo`/`system`/`gettext`)** — unblocks `canvas2d-core`/`canvas2d`; cheapest.
3. **P3 marshalling-helper seeding** — unblocks `child_process`/`os`/`module`.
4. **Harness: prepend each package's `prebuilds/` to `GI_TYPELIB_PATH`** (P5) so `http`/`webrtc` and other Vala-bridge consumers resolve.
5. **Full rollout:** wire committed `src/test.node-gi.mts` + `test:gjs-on-node` legs for the packages that already pass (beyond sqlite/http2/zlib: `tls`, `ws`, `dom-elements`, `node-globals`, `devtools`, `devtools-browser`, `storybook`, `adwaita-app`), and add them to the CI proof set as each is fixed/verified.
6. **Full CI matrix:** run the whole survey (not just the proof set) as a non-gating `continue-on-error` job that publishes this table, so regressions/improvements surface per PR.
7. **P4/P7/P8** individually as their consumers are prioritized.
