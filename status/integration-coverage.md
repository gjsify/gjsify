<!-- Authored per-suite notes — THIS FILE is the tracked source of truth for the
     "Integration Test Coverage" section of the generated status snapshot.
     One `## <dir>` section per tests/integration/<dir> — the status-data check
     enforces the bijection in BOTH directions (a suite without a section fails,
     a section without a suite fails). Keep counts/narrative current in place;
     per-change history belongs in commit messages. -->

**How CI uses this file.** `main.yml`'s `integration` job gates the suites measured green in
`ghcr.io/gjsify/ci-fedora`; every suite below that is NOT marked **HELD OUT** is in that
allowlist. A held-out suite states its measured cause inline and returns to the allowlist in the
commit that makes it green — one cause per commit.

The counts in each section were true when authored and nothing re-ran them, which is how nine
suites came to be described as green while failing. They are now measured. Where a count below
carries no HELD OUT marker it was re-confirmed; four had drifted upward as tests were added
(acorn 127→128 per runtime, chokidar 19→33, execa GJS 43→44, worker-stress GJS 1034→1057) and
are corrected in place.

## acorn

Phase D-1 Workstream P — pure-JS ECMAScript parser + AST visitor (acorn + acorn-walk) used by `@gjsify/rolldown-plugin-gjsify`'s `auto-globals` detector. **Node: 128/128 green. GJS: 128/128 green, 0 skips.** No `@gjsify/*` fixes required — a clean canary that the SpiderMonkey 140 ES2024 surface (private class fields, top-level await, optional chaining, logical assignment, dynamic `import()`, import attributes, tagged templates) used by the `--globals auto` builder is intact under `firefox140` lowering. Suites: parse-basic (11), parse-strict (10), walk-basic (6), walk-recursive (5), error-positions (6) — each ×2 runtimes.

## autobahn

RFC 6455 WebSocket protocol compliance validated by the [crossbario/autobahn-testsuite](https://github.com/crossbario/autobahn-testsuite) fuzzingserver running in a Podman/Docker container. Two client drivers exercise the stack from different entry points:

| Driver | Target | Baseline (517 cases, Autobahn 0.10.9) |
|---|---|---|
| `fuzzingclient-driver.ts` → `@gjsify/websocket` (W3C `WebSocket` over `Soup.WebsocketConnection`) | foundational RFC 6455 compliance at the Soup layer, incl. permessage-deflate framing (RFC 7692) | **510 OK / 4 NON-STRICT / 3 INFORMATIONAL / 0 FAILED** |
| `fuzzingclient-driver-ws.ts` → `@gjsify/ws` (npm `ws` wrapper on top of `@gjsify/websocket`) | API-wrapper semantics: EventEmitter handlers, binary type coercion, close-reason byte encoding, deflate pass-through | **510 OK / 4 NON-STRICT / 3 INFORMATIONAL / 0 FAILED** |

Identical scores confirm `@gjsify/ws` adds zero regressions over `@gjsify/websocket`.

**NON-STRICT (4 cases, all 6.4.x)** — fragmented text messages with invalid UTF-8 in a later fragment. `behaviorClose` is `OK` (close code 1007 as RFC requires); only the timing is NON-STRICT because `Soup.WebsocketConnection` surfaces only coalesced messages (no pre-assembly `frame` signal over GI), so per-fragment validation cannot run before libsoup has buffered the whole message. Tracked as an upstream libsoup patch candidate. **INFORMATIONAL (3 cases)** — implementation-defined close behaviors (7.1.6, 7.13.x); never failures by Autobahn's own classification.

No cases are excluded: core RFC 6455 (1.\*–7.\*), permessage-deflate (12.\*/13.\*) and the performance group (9.\*, single frames up to 16 MB — a full run takes 30–90 min locally; driver timeout 480 s per case, matching the server's own limit). Historic root-cause fixes this pillar surfaced (all landed): the `@gjsify/websocket` `/register` subpath, NUL-safe `send()` via `send_message(TEXT, GLib.Bytes)`, explicit permessage-deflate negotiation (manager before deflate), `WebSocket.extensions` reflecting the negotiated set, and the driver exit watchdog (`scripts/run-driver.mjs`, see Open TODOs).

**Not wired into CI** — Podman-in-CI needs privileged containers our config doesn't grant. Manual run + committed baselines under `reports/baseline/<agent>.json`; regressions surface in PR diffs.

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): external precondition — `ghcr.io/gjsify/ci-fedora` ships neither podman nor docker, so `autobahn:up` exits 2 before a single case runs. Matches the "Not wired into CI" note above; the note is now measured rather than assumed.

## axios

Validates axios 1.x against `@gjsify/*` using real localhost `node:http` servers (no mocking). On GJS, axios selects the XHR adapter because `globalThis.XMLHttpRequest` is available. **Node: 68/68 green. GJS: 52/52 green, 12 ignored (HTTP-adapter-only features).** Suites: basic (12), headers (8/5+3 ignored), timeout (6/5+1), redirects (7/5+2), compression (8/5+2), streams (6/3+3), abort (5/5). Root-cause fixes surfaced (landed): the `@gjsify/fetch` double-decompression bug (`Soup.ContentDecoder` removed per session; JS-level `DecompressionStream` decompresses exclusively), UTF-8 BOM stripping in XHR `responseText`, and the `@gjsify/zlib` brotli stubs.

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): GJS **1 of 51 fails** — `compression › empty gzip response body is handled (no Z_BUF_ERROR)` reports `Network Error`. The Node leg is green (68). Documented above as `GJS: 52/52 green`, which no longer holds.

## chalk

Universal terminal-color package (every CLI tool depends on chalk). Three ported spec files exercise ANSI escape-code generation, the truecolor + RGB/hex/ansi256 chain API with level-downsampling, and the level-gating contract: basic (18 — chain styling, nesting, `.reset()`, grey/gray alias, `Function.prototype.{apply,bind,call}` preserved, LF + CRLF line-break reopening), templates (11 — 24-bit SGR, hex parsing, ansi256, level=1/2/3 downsampling), level (17 — level=0 stripping, child/root level propagation, `new Chalk({level})` isolated context, range validation). **46 authored assertions; Node + GJS counts pending a clean run** (the initial suite-local install exhausted the worktree tmpfs; chalk 5 is pure-ESM JS over vendored ansi-styles + supports-color, so no `@gjsify/*` source change is anticipated). `chalk.level` is pinned per suite so assertions stay deterministic regardless of host TTY/COLORTERM/CI/FORCE_COLOR.

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): Node **5 of 74 fail** — the `chalk.level` gating cases (`level = 1/2/3`, and the isolated `new Chalk({level})` context) all report `Expected values to match using ===`. This is the NODE leg, so by the repo's own rule it says the TEST is wrong, not that our implementation is. The "counts pending a clean run" note above was honest; this is that run.

## chokidar

4 spec files ported from chokidar 5.0.0 `src/index.test.ts`. **Node: 33/33 green. GJS: 33/33 green, 0 skips.** Validates `@gjsify/fs`'s `FSWatcher` (`Gio.FileMonitor`-backed) end-to-end via the file-watching surface every TypeScript-aware dev tool depends on (Vite, Rolldown, esbuild/tsc `--watch`): basic events (add/change/unlink/addDir/unlinkDir/rename/all/close idempotency), recursive watch (chokidar walks the tree itself; `depth` boundaries), ignored (regex/function/subdir), await-write-finish (stabilityThreshold polling). Root-cause fix surfaced (landed): `FSWatcher` now emits the Node-contract `'change'` event shape — `(eventType: 'rename' | 'change', filename)` — instead of separate `'rename'`-named events that dropped every create/rename/delete for contract-following consumers (16 of 19 cases failed before the one-character fix in `fs-watcher.ts`).

## claude-agent-sdk

Fresh suite (no API key) against `@anthropic-ai/claude-agent-sdk@0.3.181` — the ground-truth compatibility check for building AI-agent tooling on GNOME. **Node: 123/123 green. GJS: 125/125 green.** Exercises Explicit Resource Management (`using`/`await using` → the `Symbol.dispose`/`asyncDispose` GJS-banner polyfill; stream/readline/FileHandle dispose), zod-v4 + the MCP SDK (`createSdkMcpServer`/`tool` via `InMemoryTransport`), fs session readers + `CLAUDE_CONFIG_DIR`, os/path/process.env.

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): GJS throws at module load — `ReferenceError: SharedArrayBuffer is not defined`, inside `__esmMin`, before any test executes. Needs the SharedArrayBuffer constructor opt-in tracked in `status/open-todos.md`. The Node leg is green (123). Documented above as `GJS: 125/125 green`.

## cosmiconfig

Phase D-1 Workstream S. Validates `@gjsify/fs` (read), `@gjsify/path` (resolve) and dynamic ESM `import()` with `file://` URLs — the same code paths `@gjsify/cli`'s config loader uses. Green on Node + GJS; the `--configName` ESM-rc loading path is additionally regression-covered end-to-end by the ts-for-gir suite (gjsify/ts-for-gir#385).

## debug

Validates `@gjsify/tty` (isatty), `@gjsify/process` (`process.stderr.write` + `.fd`) and `@gjsify/util` (formatWithOptions + inspect format specifiers) end-to-end via TJ Holowaychuk's `debug` — the same code paths Express / socket.io / eslint pull on every log. Green on Node + GJS.

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): GJS — every built-in format specifier case fails, and the assertion shows an EMPTY captured string (`Expected  to contain fmt:s`, `… count=42`, `… payload={"a":1,"b":"two"}`). Nothing reaches the captured `process.stderr`. Documented above as green on both.

## deepkit-type-compiler

Phase D-1 Workstream W — the Deepkit TypeScript type compiler consumed by `@gjsify/rolldown-plugin-deepkit` (opt-in `reflection: true`). **Node: 29/29 green. GJS: 29/29 green, 0 skips.** loader (6 — `DeepkitLoader` transform round-trips) + transform (7 — `typeOf<T>()` instrumentation, per-kind metadata emission). The heaviest single TS-Compiler-API exercise in the tree (≈8 MiB test bundle). Pinned to `typescript: "^6.0.3"` — `@deepkit/type-compiler@^1.0.19` instruments correctly against TS 6 internals, so the suite is a full workspace member again.

## deltachat

DeltaChat / chatmail core (`@deltachat/jsonrpc-client` + `@deltachat/stdio-rpc-server`) on Node + GJS. **43/43 green on both.** Validates the pure-JS JSON-RPC client speaking to the Rust core process over stdio via `@gjsify/child_process` — the canonical real-world consumer for a future native Adwaita+GJS DeltaChat app.

## domparser

The differential oracle for `@gjsify/domparser`'s HTML mode (ADR 0026). Not a port of an upstream
suite: parse5 is the REFERENCE, and each fixture is parsed twice — by us and by parse5 with
`scriptingEnabled: false` — then printed by the SAME `canonicalize()` through two `TreeReader`s and
compared with `toBe`. Two canonicalizers would be two chances to agree on the same mistake.
**Node: 169/169 green. GJS: 169/169 green, 0 skips.** 32 fixtures: 29 asserted IDENTICAL to parse5
(implied `li`/`p`/`td`/`dt` end tags, void elements mid-tree, raw text vs RCDATA, the script escape
levels, the full entity table, the attribute query-string rule, implicit `html`/`head`/`body`,
in-head `noscript`, `<template>` content, EOF auto-close, whitespace placement, a data-state NUL,
repeated root tags) and 3 asserted
DIVERGENT against a committed golden — the adoption agency algorithm, foster parenting and SVG
foreign content, each scoped out in ADR 0026 § 6. A divergent fixture also asserts
`not.toBe(parse5)`, so the day one of those algorithms lands the test fails and forces this ledger
to move; it retires itself the way `it.failing` does.

Every fixture carries its discriminators — `minElements` (one below its real element count) and a
`mustContain` list of DECODED content — asserted BEFORE the comparison, because two empty strings
compare equal and `27 === 27` was green against the tree this parser replaces.

That parse5 runs unmodified under gjsify/GJS is what makes the oracle possible at all, and the GJS
leg of this suite is the standing proof of it.

## devtools-cdp

Validates `@gjsify/devtools-cdp`'s `InspectorProtocolClient` against a **live WebKit remote inspector** (CDP-shaped JSON-RPC over a per-target WebSocket), ported from `refs/webkit/LayoutTests/inspector/{runtime,dom}`. Opt-in + skip-if-unreachable: with `GJSIFY_CDP_INSPECTOR_PORT` unset it registers a single passing "skipped" test; pointed at a reachable inspector it asserts real `Runtime.evaluate` / `DOM.getDocument`/`querySelector`/`getOuterHTML`/`querySelectorAll` round-trips. Launch recipe: `gjsify browse <url> --inspector-port 9222`, then `GJSIFY_CDP_INSPECTOR_PORT=9222 gjsify workspace @gjsify/integration-devtools-cdp test`. **Not wired into CI** — needs a real WebKitGTK display.

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): HELD OUT of the allowlist despite exiting 0. Its whole run is one test reading `skipped — no reachable inspector`: with `GJSIFY_CDP_INSPECTOR_PORT` unset it self-skips, so rc=0 and the assertion count is 1. Listing it would add a permanently green check that verifies nothing.

## dotenv

Tiny but load-bearing — dotenv is the most ubiquitous third-party `process.env` mutator on npm, so if the `@gjsify/process` `process.env` Proxy's get/set/delete traps drift from Node's plain-object semantics this suite catches it first. **Node: 127/127 green (96 `it()` blocks). GJS: 127/127 green, 0 skips.** parse (48 — every quoting branch, inline comments, `\n` expansion, `export` tolerance, Buffer input, duplicate-key + line-ending matrix), parse-multiline (23), config (38 — string/array/URL paths, override semantics, `processEnv` target, ENOENT), populate (18 — incl. `delete process.env.X` unsetenv trap + `in` has trap). Fixtures reproduced verbatim from upstream v17.4.2. No `@gjsify/*` fix required.

## execa

Phase D-1 Workstream T — the `execa` v9 subprocess wrapper consumed by `@gjsify/vite-plugin-blueprint` (blueprint-compiler) and `@gjsify/vite-plugin-gettext` (xgettext/msgfmt). **Node: 44/44 green. GJS: 44/44 green, 0 ignored** — the async-stdin-piping case that was ignored on GJS now runs and passes (the measured run shows no `(skipped)` and no `✗`), so the Open-TODO note about it no longer describes this suite. Fixes surfaced (landed): named-import `hrtime` preserves `.bigint`; `ChildProcess.stdio` getter exposes the `[stdin, stdout, stderr]` tuple; the `--app gjs` process-stub's `hrtime` gained `.bigint` so pre-register `__esm` lazy-init code cannot hit a TypeError.

## fast-glob

Phase D-1 Workstream Q — the `fast-glob` v3 pattern matcher used by `@gjsify/rolldown-plugin-gjsify` and `@gjsify/vite-plugin-gettext`. **Node: 98/98 green. GJS: 98/98 green, 0 skips.** basic-patterns (8), glob-vs-stream (5), cwd-and-absolute (6), dot-and-hidden (8), symlinks (7) over a deterministic prebuild fixture tree incl. three symlinks (file/dir/dangling). Root-cause fixes surfaced (landed): `readdirSync(withFileTypes: true)` reports symlinks correctly (`NOFOLLOW_SYMLINKS` enumerator so `followSymbolicLinks: false` works on GJS), and `makeCallable` auto-constructs on no-`new` invocation (`PassThrough(opts)` from merge2).

## gettext-parser

Phase D-1 Workstream R. Validates `@gjsify/buffer` (binary MO parsing, endianness), `@gjsify/fs` (URL paths, binary read) and text encoding (utf-8/latin-1) via the parser `@gjsify/vite-plugin-gettext` uses. Green on Node + GJS.

## lightningcss

6 fixtures × 2 backend pairs = **12/12 byte-equality assertions green** (6/6 Node, 6/6 GJS). Locks in the load-bearing Phase D-2 decision-matrix property: every backend `cssAsStringPlugin` wires (npm `lightningcss` on Node, `@gjsify/lightningcss-native` under GJS, `@gjsify/lightningcss-wasm` as fallback) produces byte-identical output for the same input — Node diffs wasm vs npm, GJS diffs native vs wasm, giving a transitive chain across all three. Fixtures exercise distinct lowering/minification paths (plain selector, longhand collapse, nesting flatten for `firefox >= 60`, `lch()` lowering, pretty-print, nested `@media` flatten). Source maps are deliberately NOT part of the contract (`mappings` encode backend-specific source indexes; code-only equality is what consumers observe).

## loro-crdt

**166/166 green on Node + GJS.** Validates `@gjsify/webassembly` Promise APIs + TextEncoder/TextDecoder + `crypto.getRandomValues` against wasm-bindgen-generated bindings — the canonical real-world consumer pattern. Loro is a CRDT framework distributed as base64-embedded WASM (no fetch/fs at load time); exercises LoroDoc, LoroText, LoroList, LoroMap, snapshot export/import, bidirectional sync.

## mcp-inspector-cli

Drives the official `@modelcontextprotocol/inspector` CLI as a subprocess against both GJS and Node builds of `examples/node/net-mcp-server` — catches regressions in the exact wire shape that produced the original MCP crash. **Node: 14/14 green. GJS: 14/14 green, 0 skips.** 7 scenarios (tool list/call, resource list/read, prompt list/get, server info) × both server builds. Sequential-call cap N ≤ 4 to stay under the residual deferred-GC window from the MCP SDK / Hono / web-streams stack (see Upstream GJS Patch Candidates).

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): missing build precondition — the suite reads `examples/node/net-mcp-server/dist/index.gjs.mjs`, which `gjsify run build` does not produce (`build:examples` does). Reported as `14 of 0 tests failed`. Documented above as green on both.

## mcp-typescript-sdk

Validates `@gjsify/http`, `@gjsify/fetch`, `@gjsify/net`, `@gjsify/ws`, `@gjsify/events`, `@gjsify/child_process`, `@gjsify/buffer` and the MCP TypeScript SDK's pure-JS surfaces. **Node: 281/281 green. GJS: 281/287 green** (6 pre-existing `streamable-http.spec.ts` timeouts under flaky libsoup long-poll SSE pause behaviour; tracked separately). Suites: protocol, tool, resource, prompt, streamable-http (⚠ flaky on GJS), in-memory-transport, stdio-buffer (newline framing incl. mid-codepoint UTF-8 chunking), uri-template (RFC 6570 incl. the CVE-2026-0621 ReDoS regression cases), tool-name-validation, stdio-subprocess (regression coverage for the `@gjsify/child_process` env-undefined silent-data-loss fix), server-initiated-requests (sampling + elicitation), cancellation-progress. Historic fixes surfaced: `ServerRequestSocket.destroySoon()`, async handler rejections swallowed in `_handleRequest`, `McpServer` GC'd between requests when handler-scoped.

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): GJS **1 of 278 fails** — `MCP Streamable HTTP Transport › should sustain inspector-like mixed workload across sessions` exceeds its 5000 ms budget. Time-sensitive, so it may behave differently on a slower runner.

## minify-xml

Phase D-1 Workstream X — the `minify-xml` v4 pure-JS XML compressor consumed by `@gjsify/vite-plugin-blueprint`. **Node: 63/63 green. GJS: 63/63 green, 0 skips.** basic (10), options (10), edge-cases (12 — 100-deep nesting, entities, PIs, Blueprint-style GTK XML, unicode, CDATA-with-markup) ×2 runtimes + shared cases. SpiderMonkey 140's RegExp engine matches V8 exactly for every pattern the minifier exercises (incl. the lookbehind-anchored `tagPattern` chain). Specs derived from the documented public API (the tarball ships no tests).

## nativescript

On-device polyfill smoke suite — runs gjsify `nativescript:'polyfill'` packages on the **real NativeScript V8 runtime** (Android), closing the gap between *declaring* an NS slot and *executing* it. **14/14 green on NS V8** (NS CLI 9.0.6 / runtime 9.0.4, `@nativescript/core` 9.x, Vite 8.0.16): `@gjsify/path` 7/7 + `@gjsify/buffer` 7/7. Bundles the specs into a tiny NS app via the `@gjsify/nativescript-vite` composer, builds the APK, installs + launches on an emulator, parses `__GJSIFY_NS__` markers out of `adb logcat`. Root-cause fix surfaced (landed): `@gjsify/buffer` constructed `TextEncoder`/`TextDecoder` at module-eval time — on NS V8 those globals register after module evaluation, so the bundle rejected on app start; now lazily initialised. Local-only (needs the NS CLI + an Android emulator); excluded from the root workspace so the heavy NS toolchain is not pulled by `gjsify install`; not wired into CI. The deterministic runner works around NS CLI 9.0.6's watch-only Vite bundle-copy (see Open TODOs).

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): not selectable at all: the root manifest excludes `tests/integration/nativescript` from `workspaces`, so no `@gjsify/integration-nativescript` workspace exists (`gjsify workspace …` answers `no workspace named …`). It also drives a real device over `adb`.

## oxfmt-native

**12 green under GJS (8 tests)** (GJS-only — the native bridge needs the GjsifyOxfmt typelib). Locks in the Node-free `gjsify format` contract end-to-end against the `@gjsify/oxfmt-native` prebuild: `hasNativeOxfmt()` typelib load, single-shot `format()` (Prettier-default output + TSX dialect-from-extension + throw-on-parse-error), and the full in-process CLI `runOxfmt()` — `--write` on-disk effect + exit 0, `--list-different` exit 1 on drift, `--check` exit 0 when clean, `.oxfmtrc.json` honoring via `--config`, exit 2 when no files match.

## pkg-types

Phase D-1 Workstream U — combined suite for the two TypeScript-config readers used by `@gjsify/cli`'s config loader (`pkg-types` + `get-tsconfig`). **Node: 88/88 green. GJS: 88/88 green, 0 skips.** pkg-types read/write round-trips, `findFile`/`findNearestFile` tree walking, `getTsconfig`/`parseTsconfig`/`findTsconfig`, 2-level `extends` chain inlining, `createPathsMatcher` alias resolution + baseUrl fallback. No `@gjsify/*` fixes required.

## rolldown-native

Locks in the Phase D-2.B plugin-bridge contract of `@gjsify/rolldown-native` end-to-end: `bundleWithPlugins()` under GJS with the full hook surface (load/transform/resolveId/renderChunk/banner/footer/intro/outro/buildStart/End/generateBundle), the per-hook id-regex filter short-circuit, and the nested protocol for plugin-context callbacks (`this.resolve`/`this.warn`/`this.error`). GJS-only — the native bridge needs the Vala/GIR typelib that only loads under SpiderMonkey + GLib.

## rollup-pluginutils

Phase D-1 Workstream V — the helper toolkit consumed by `@gjsify/rolldown-plugin-gjsify` itself. **Node: 138/138 green. GJS: 138/138 green, 0 skips.** createFilter (15), dataToEsm (12), makeLegalIdentifier (8), attachScopes (9), extractAssignedNames (10) ×2 runtimes + shared. The picomatch transitive dep bundles + runs cleanly on GJS — indirect coverage for the heavy regex paths. Specs derived from the documented public API (the tarball ships no tests).

## socket.io

5 test suites ported from socket.io v4 upstream. **Node: 112/112 green. GJS: 112/112 green, 0 skips.** Full transport coverage: polling, polling→WebSocket upgrade, and WebSocket-only. handshake (4 — CORS, allowRequest), socket-middleware (2), socket-timeout (4), socket (63 — emit/acks, onAny/offAny/prependAny, volatile, compression, disconnect, reserved-event guards), namespaces (39 — multi-namespace, `except()`, dynamic namespaces). Root-cause fixes surfaced (landed): `@gjsify/fetch` POST body never sent (raw-body attach via `set_request_body_from_bytes`); `IncomingMessage` wrongly emitted `'close'` after body end (breaking engine.io long-poll — `_autoClose` hook, close only via destroy per Node semantics); `EventEmitter.prototype` methods made enumerable (socket.io builds its namespace proxy from `Object.keys(EventEmitter.prototype)`); `req.socket` set on WebSocket upgrades; `--globals auto,WebSocket` for the alias-shaped `globalThisShim.WebSocket` access the detector cannot follow.

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): GJS — the four `volatile event` cases fail with `Expected values to match using ===`. Documented above as `GJS: 112/112 green, 0 skips`.

## streamx

6 spec files ported from `refs/streamx/test/` plus an original `throughput.spec.ts`. **Node: 155/155 green. GJS: 156/156 green (1 GJS-only test), 0 skips.** readable (24), writable (10), transform (2), pipeline (5), duplex (5), throughput (5/6 — queueMicrotask injection, 100-chunk no-loss, pipeline byte preservation, Duplex echo, timing). Root cause of the historic 0 B/s webtorrent-player symptom: `queueMicrotask` must be injected so streamx uses Promise-based microtask scheduling instead of the `process.nextTick` fallback — the GJS-only throughput test pins the injection.

## tls-session

Real TLS-handshake round-trip validating the `@gjsify/tls-native` Phase 2 Path-A C shim. session-resumption (conn 1 captures the session blob via the `'session'` event; conn 2 with `{session}` resumes — `isSessionReused() === true`; TLS 1.2 forced for predictable ticket-based resumption; the GJS path additionally asserts `hasTlsSessionAccess() === true` so a degraded native bridge fails loudly) + channel-binding (`getFinished()`/`getPeerFinished()` non-empty and different on both TLS 1.2 `tls-unique` and TLS 1.3 `tls-exporter` — identical bytes would be a handedness bug). Green on Node + GJS. Fixture cert+key generated at prebuild time via one `openssl req -x509` command; the server is a vanilla `node:tls.createServer` driven by `@gjsify/tls` under `--app gjs` via the standard alias layer — no GJS-specific test plumbing.

**HELD OUT of CI, with the cause now FIXED AT THE SOURCE and the fix not yet in the image.** The blocker was an external precondition: `setup-fixtures` shells out to `openssl(1)`, which the image did not ship (`spawnSync openssl ENOENT`), so the suite died before `build:test` — green on any workstation, which is why nobody noticed. `.docker/ci-fedora.Dockerfile` now installs `openssl`; measured on `fedora:44`, the base carries `openssl-libs` and no `openssl(1)`, and nothing else on the image pulls the binary in.

It stays out of `main.yml`'s `--include` list for ONE more merge, and that is mechanical, not a second defect. `build-ci-image.yml` pushes `ghcr.io/gjsify/ci-fedora:<major>` on a push to main and deliberately does NOT push from a pull request, while the `integration` job consumes the mutable tag — so a commit that added the suite alongside the package would run it against the image from BEFORE the package, redden its own PR, and then redden main on the merge. `dash` hit the same wall (cc775993: "the image gains `dash` only after this merge"). Returns to the allowlist in the first commit after `build-ci-image` has republished both majors — one cause per commit, as above.

## ts-for-gir

Phases 1–9 (partial): validates `@gi.ts/parser`, `@ts-for-gir/lib`, the typescript/json/html-doc generators, `@ts-for-gir/cli` and `@ts-for-gir/language-server` (v4.0.0-rc.13). **Node: 278/278 green. GJS: 214/214 green (3 ignored — Node-only: TypeDoc/shiki WASM + the CJS `typescript` lib resolution).** `glob`, `ejs`, `lodash`, `colorette`, `cosmiconfig`, `yargs`, `typedoc` all work on GJS/Node via `@gjsify/*`. Parser fixtures are gjsify's own Vala-generated GIRs; both CLI bundles (`dist/cli.node.mjs` + `dist/cli.gjs.mjs`) run the non-interactive command surface incl. the `--configName` cosmiconfig ESM-rc path (gjsify/ts-for-gir#385) and the `create` GJS-bundle short-circuit (gjsify/ts-for-gir#386). Root-cause fixes this suite drove into the platform over its phases: `util.styleText`/`stripVTControlCharacters`, per-source-file `__filename`/`__dirname` injection on the node target, the `--define`/`--external`/`--alias` CLI flags, runtime-relative `import.meta.url` rewriting (removed the TypeDoc stubs), `createRequire` ancestor-`node_modules` walk, `ensureMainLoop()` in `@gjsify/child_process.spawn()`. Strategic goal: ts-for-gir runs unmodified on GJS — remaining phases in Open TODOs.

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): Node **1 of 291 fails** — `Expected --template is required (non-TTY)`. The NODE leg again, so this is the test/fixture, not our implementation. Documented above as `Node: 278/278 green`.

## typescript-tsc

TypeScript compiler (tsc) + language-server API on GJS and Node. **Node: 35 green; GJS: 33 green + 1 ignored.** Probes whether the TypeScript compiler API runs end-to-end under GJS via `@gjsify/*` — Program creation, type-checking, diagnostics emission — and what gaps surface for tsserver's LSP-over-stdio loop. Failures are documented in the suite's TODO comments and surface as test results, not silent skips. (The production answer to "tsc under GJS" is the `@gjsify/tsc` bundled toolchain, which self-hosts the workspace's own `check` + `build:types`.)

## undici

Three ports against npm `undici@7` — the canonical HTTP/1.1 + WebSocket client (Node's own `globalThis.fetch` is undici). Exercises `fetch`, `request` and `WebSocket` end-to-end against a local `node:http`-backed server (native on Node; `@gjsify/http` under GJS via the alias layer). **Node: 31/31 green (76 assertions). GJS: unblocked by the `@gjsify/zlib` Zstd stubs (undici's module-init feature detector reads `createZstdDecompress`); live GJS counts pending a run — any remaining gap is a separate follow-up.** fetch-basic (13), request (13), websocket (5 — npm `ws` server on Node, `@gjsify/ws` on GJS via the alias map, same source both runtimes).

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): GJS — the basic verb cases fail with `me is not a function`. A MANGLED identifier reaching a call site points at the bundle rather than at the suite, so this one wants a look at the build before the test.

## webtorrent

7 test files ported from `refs/webtorrent/test/`. **Node: 185/185 green. GJS: 185/185 green, 0 skips.** selections, rarity-map, client-destroy, client-add, bitfield, file-buffer, iterator — exercising fs (URL paths), stream, events, buffer, crypto, the `require`-condition ESM fix and the `random-access-file` alias. Root-cause fixes surfaced (landed): `@gjsify/fs` accepts `URL` path arguments across every public entry point; ESM builds no longer pull CJS entries through the `require` condition (double-`__toESM`-wrap made classes non-constructable); `random-access-file` aliased to its Node entry (the browser-stub throw stalled every `client.seed()`).

**HELD OUT of CI** (measured per-suite in `ghcr.io/gjsify/ci-fedora`): external precondition — `Cannot find module '../../../build/Release/node_datachannel.node'`; the native `node_datachannel` binary is absent in the image. Documented above as green on both.

## worker-stress

Three-suite stress workload validating `@gjsify/worker_threads` `transferList` semantics + the `SharedArrayBuffer` pass-through path + the cross-process `SharedBuffer` path. **Node: 1169/1169 green (SAB suite included; sab-native suite skipped). GJS: 1057/1057 green (SAB suite probe-only; sab-native suite runs the full 4-worker workload).** transferlist-stress (bulk ArrayBuffer transfer — 256 × 64 KiB with detach + integrity checks; multi-channel FIFO fan-out; 5-hop MessagePort transfer chain), sab-parallel-hash (Node: 4 threads SHA-256 over disjoint slices of a 1 MiB SAB, `Atomics` barrier), sab-native-parallel-hash (GJS: 4 subprocess workers over a memfd-backed `SharedBuffer` — SCM_RIGHTS fd-passing under load, page-coherent mmap across 5 processes, SEQ_CST visibility, count-and-drain bootstrap protocol; plus 8 workers × 10k `fetch_add` under contention with exactly 80,000 observed). Throughput baselines logged per run, not asserted (Node ≈ 700 MiB/s transferList; GJS ≈ 235 MiB/s).

## yargs

Phase D-1 Workstream O — the yargs v18 ESM CLI parser used by `@gjsify/cli` end-to-end on GJS. **Node: 52/52 green. GJS: 52/52 green, 0 skips.** parser (10), options (10), commands (6), help (5), esm (6) ×2 runtimes + shared. No `@gjsify/*` fixes required; yargs's transitive deps (cliui, escalade, get-caller-file, string-width, y18n, yargs-parser) all bundle and run on GJS without intervention.

## yjs

8 spec files ported from yjs@13.6.31 + y-protocols upstream tests. **Node: 147 assertions / 54 cases green. GJS: 147/54 green, 0 skips.** y-text, y-array, y-map, y-xml, doc (subdocs, transaction origins, clientID re-roll), updates-sync (state vectors, mergeUpdates, snapshots), undo-manager, awareness (y-protocols). Yjs is the de-facto JS CRDT (TipTap/ProseMirror collab/BlockNote/Hocuspocus); pure JS at its core, so it exercises heavy `Uint8Array`/`DataView` wire-format paths, Map/Set/WeakMap bookkeeping and `crypto.getRandomValues` (via lib0). Upstream's PRNG-driven `TestConnector` multi-user scenarios are reduced to deterministic 2-/3-doc sync via the canonical wire format (`Y.applyUpdate(b, Y.encodeStateAsUpdate(a))`) — same correctness assertion, no PRNG in CI. No `@gjsify/*` source fixes were required.
