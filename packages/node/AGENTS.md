# AGENTS.md — `packages/node/*` (Node.js pillar)

> Scope: this directory tree. Repo-wide rules live in the [root AGENTS.md](../../AGENTS.md) — read that first.
> The runtime-axis model these packages declare against is in the root's § Runtime & platform model.

## Node.js Packages — `packages/node/*` → `@gjsify/<name>`

Status detail + test counts: `status/status.json` (`npm run status:generate` for the tables). Below: backing libs + the load-bearing specifics. **browser:`partial` blockers** per § Slot routing.

| Pkg | Libs | Status | Notes |
|-----|------|--------|-------|
| assert | — | Full | AssertionError, deepEqual, throws, strict |
| async_hooks | — | Full | AsyncLocalStorage, AsyncResource, createHook |
| buffer | — | Full | Buffer via Blob/File/atob/btoa |
| child_process | Gio | Full | exec/execSync, spawn/spawnSync via Gio.Subprocess |
| cluster | — | Stub | isPrimary, isWorker |
| console | — | Full | Console with stream support |
| constants | — | Full | flattened re-export of os/fs/legacy-crypto constants; deprecated Node alias |
| crypto | GLib | Full | Hash(GLib.Checksum), Hmac(GLib.Hmac), randomBytes/UUID (entropy via `@gjsify/webcrypto/random` — see webcrypto row), PBKDF2/HKDF/scrypt, AES, DH/ECDH, Sign/Verify, KeyObject JWK, X509Certificate. browser:`partial` — `Hash.digest()` throws `ENOTSUP_SYNC_DIGEST` (WebCrypto digest is async-only); DH/publicEncrypt/X509 have no WebCrypto pendant |
| dgram | Gio | Full | UDP via Gio.Socket |
| diagnostics_channel | — | Full | Channel, TracingChannel |
| dns | Gio | Full | lookup/resolve*/reverse via Gio.Resolver. browser:`partial` — `resolve*`/`reverse` ENOTSUP (no browser DNS resolver; IP literals + `localhost` via `lookup`) |
| domain | — | Stub | deprecated |
| events | — | Full | EventEmitter — prototype methods made enumerable (socket.io v4 compat), once/on/listenerCount, `makeCallable` (util.inherits CJS compat) |
| fs | Gio | Full | sync + callback + promises + streams + FSWatcher; URL path args everywhere. `watch(…, {recursive:true})` is BUILT over one monitor per directory (`watch-tree.ts`) — GIO's are flat; filename is relative to the watched dir, symlinked dirs are reported but never descended (Node's Linux fallback, both ways). On darwin a dir monitor reports create/delete but NOT a write to a child, so each file gets one too — bounded, loud when spent. browser:`partial` — FSWatcher never fires (no browser API), `Volume` entry 34 value exports short of root |
| globals | GLib | Full | process, Buffer, structuredClone, TextEncoder/Decoder, atob/btoa, URL, setImmediate, queueMicrotask |
| http | Soup 3.0 | Partial | Server(Soup.Server, chunked+upgrade), ClientRequest, IncomingMessage (close-only-via-destroy per Node semantics), Agent. browser:`partial` — `createServer`/`Server`/`ServerResponse` ENOTSUP (no inbound TCP); client half rides native `fetch()` |
| http2 | Soup 3.0 | Partial | createServer/createSecureServer/connect + compat layer + session API. createServer()=HTTP/1.1 only (no h2c); createSecureServer()=h2 via ALPN. pushStream/stream-IDs/flow-control = Phase 2 (Vala/nghttp2) |
| https | — | Partial | Agent, stub request/get. browser:`partial` — root re-exports `TLSSocket`+`createSecureContext` from `@gjsify/tls` (`browser:"none"`): a user agent terminates TLS below JS |
| inspector | — | Stub | Session stub |
| module | Gio, GLib | Full | builtinModules, isBuiltin, createRequire. browser:`partial` — `createRequire` returns an always-throwing require (no sync CJS loader in a browser ESM bundle) |
| net | Gio | Full | Socket(Gio.SocketClient), Server(Gio.SocketService) |
| os | GLib | Full | homedir, hostname, cpus |
| path | — | Full | POSIX + Win32 |
| perf_hooks | — | Full | performance (Web API / GLib fallback) |
| polyfills | — | Meta | `@gjsify/node-polyfills` — dep-only umbrella pulling every Node polyfill (create-app templates + CLI scaffolds). No runtime code |
| process | GLib, GjsifyTerminal | Full | extends EventEmitter; nextTick = batched GLib-idle delivery (keeps GTK input responsive); stdin/stdout/stderr as Process{Read,Write}Stream (isTTY/setRawMode/columns via `@gjsify/terminal-native` when installed, env/GLib fallback); SIGWINCH→'resize' |
| querystring | — | Full | parse/stringify |
| readline | — | Full | Interface, question/prompt, async iterator, `Interface[Symbol.dispose]`=close() |
| sqlite | Gda 6.0 | Partial | node:sqlite via `gi://Gda?version=6.0` (libgda SQLite provider). URL + Uint8Array paths, param binding, typed readers, error codes. **Parse ONLY through `parseSql()` — `Gda.SqlParser.parse_string()` aborts the PROCESS** (its `remain` out-param is an interior pointer the GIR declares `transfer full`, so GJS `g_free()`s it); string params are BOUND to holders, never spliced into SQL — libgda reads `\` as an escape inside `'…'` and SQLite does not. Both incidents documented in `sqlite/src/parse-sql.ts`. browser:`partial` — `DatabaseSync` throws from ctor (no engine without shipping a WASM SQLite; `node:sqlite` is sync while OPFS sync handles are worker-only; honest future shape = `./browser-worker` subpath `polyfill`, `./browser` stays `partial`) |
| stream | — | Full | Readable (protected `_autoClose` hook), Writable, Duplex, Transform, PassThrough, pipeline/finished; FIFO write-ordering across drain re-entry; serialized concurrent I/O; `[Symbol.asyncDispose]` |
| string_decoder | — | Full | UTF-8, Base64, hex, streaming |
| sys | — | Full | deprecated alias for util |
| timers | — | Full | setTimeout/Interval/Immediate + promises — GLib-source-safe: uses `GLib.timeout_add` to avoid the SpiderMonkey-GC race on GLib.Source BoxedInstances |
| tls | Gio, @gjsify/tls-native | Full | TLSSocket via Gio.TlsClientConnection (ALPN, mTLS, custom CA, RFC 6125 hostname matching, custom `checkServerIdentity`, SNI via real-ClientHello-peek). Optional native Phase 1 = OCSP parsing (`parseOcspResponse`/`hasOcspSupport()`), Phase 2 = session access (`getFinished`/`getPeerFinished`/`get`/`setSession`/`isSessionReused` + `'session'` event + `{session}` option + channel binding, auto `tls-unique` (≤1.2) vs `tls-exporter` (1.3)) — real GnuTLS calls via the C shim; `hasTlsSessionAccess()` true on glib-networking GnuTLS backends, non-GnuTLS degrades to Node's no-session contract (`undefined`/`false`/no-op) |
| tls-native | GjsifyTls (Vala+C) | Partial | **Optional native prebuild.** OCSP DER parser (`gnutls_ocsp_resp_*`; Vala 0.56's vapi gap filled by sibling `gnutls-ocsp.vapi`) + `SessionAccess` wrapping `Gio.TlsConnection`. The C shim extracts `gnutls_session_t` from `GTlsConnectionGnutls`'s private struct via public `g_type_instance_get_private` + runtime `g_type_from_name` — struct layout vendored from `refs/glib-networking` (4-pointer, stable 2.74–2.84 = Fedora 43+44); force-loads the GIO TLS module via `g_tls_backend_get_client_connection_type()` so the type registers before any connection exists. Loaded via `imports.gi.GjsifyTls` in try/catch — safe when typelib absent. Prebuild targets: `gjsify.platforms` (derived; `audit-runtimes --platforms` renders the matrix) — a literal list here went stale the day macOS was added |
| terminal-native | GjsifyTerminal (Vala) | Full | **Optional native prebuild.** `is_tty`/`get_size` (ioctl TIOCGWINSZ)/`set_raw_mode` (termios) + SIGWINCH `ResizeWatcher`. try/catch-loaded, safe when absent. Consumed by tty + process |
| tty | GjsifyTerminal | Full | ReadStream/WriteStream, ANSI; native via terminal-native, env/GLib fallback |
| url | GLib | Full | URL (static create/revokeObjectURL over `Blob._tmpPath` + `file://`), URLSearchParams via GLib.Uri |
| util | — | Full | inspect, format, promisify, types |
| v8 | — | Stub | getHeapStatistics, serialize/deserialize (JSON) |
| vm | — | Partial | runInThisContext (eval), runInNewContext (Function+sandbox), Script, compileFunction. No realm isolation |
| worker_threads | @gjsify/sab-native, @gjsify/message-channel | Partial | MessagePort W3C surface composed OVER `@gjsify/message-channel` (single source of truth for listener/queue semantics; wrapper extends EventEmitter for `@types/node` compat); Worker via Gio.Subprocess; transferList: ArrayBuffer (zero-copy SM140 transfer), MessagePort (in-process hand-off + cross-process `SubprocessPortTransport` over worker stdin/stdout), SharedBuffer (memfd + SCM_RIGHTS over fd 3). `SharedArrayBuffer` ctor still gated by upstream GJS opt-in — use `@gjsify/sab-native` `SharedBuffer`. browser:`partial` — `receiveMessageOnPort` returns `undefined` (no sync drain), `workerData` first-macrotask only |
| sab-native | Linux libc | Native | **Optional Vala bridge**: `SharedBuffer` (memfd_create + mmap MAP_SHARED, typed accessors, `viewBytes()`/`toBuffer<T>()` duck-type for `Buffer.from`, SEQ_CST atomics + futex), `FdChannel` (SOCK_SEQPACKET + SCM_RIGHTS). Lazy `imports.gi.GjsifySabNative`, `hasNativeSab()`. Prebuilds linux-* |
| ws (npm) | Soup 3.0 | Partial | `ws`-compat client + WebSocketServer over `@gjsify/websocket` + Soup.Server; aliases `ws`+`isomorphic-ws`. Server: `{server}` shared-port, `{noServer}`+`handleUpgrade()`, verifyClient (sync+async), handleProtocols, 'headers', client tracking, `createWebSocketStream`. Missing: custom perMessageDeflate, ping/pong events (Soup handles control frames internally — no GI API). browser:`partial` — `WebSocketServer` ENOTSUP; client IS `globalThis.WebSocket`. Only one of the ten partials with no `src/test.browser.mts` |
| zlib | — | Full | one-shot via Web Compression API, Gio.Zlib* fallback; streaming classes are REAL `@gjsify/stream` Transform subclasses (genuine constructors so `inherits(Sub, zlib.Inflate)` works at module init — sync-inflate/pngjs/qrcode); `Unzip` auto-detects by magic byte. Brotli/Zstd throw (no GLib codec). browser:`partial` — every `*Sync` ENOTSUP (CompressionStream is Promise-only); brotli/zstd outside the WHATWG spec |

## CJS-ESM Interop (GJS)

Three SEPARATE mechanisms share the word `require`; conflating them is how a latent `ReferenceError` hides for months. (1) is a rule about OUR source; (2)/(3) are interop for FOREIGN code — inbound and outbound. Neither (2) nor (3) is a general `require` polyfill, and neither makes (1) safe.

### 1. Our source is ESM — never a bare `require`

`"type": "module"`, no ambient `require` binding. **A bare `require(...)` in our own source is a latent `ReferenceError`.**
|**THE TRAP — bundled code is shimmed, published `lib/` is not.** Inside a `--app gjs|node` bundle a bare `require('node:fs')` WORKS: rolldown resolves the (aliased) specifier and rewrites the CALL to `__toCommonJS(<bundled module>)` at build time — mechanism (2) catching our mistake as a side effect. The unbundled ESM `lib/` — what we PUBLISH, what every `node lib/index.js` path loads — has no `require` and throws. A site whose only production caller runs a committed `dist/*.gjs.mjs` can sit broken indefinitely and go red the first time anything reaches it through `lib/`.
|**a swallowing `catch` turns it into a silent wrong answer.** `try { require('node:x') } catch { return <fallback> }` converts the ReferenceError into an unverified result: `oxc-resolve.ts` left `libc` pinned to `'gnu'` and told musl hosts to install the wrong binding; `app/gjs.ts` returned an unverified shim path — and since bare `require` only resolves INSIDE a bundle, the `createRequire` fallback written FOR the bundled case was the one branch bare `require` could reach, while the unbundled case it was meant to rescue returned early every time. Catch only around an operation with a real failure mode, and say which.
|**write instead:** a static `import` (the default — `node:*` is aliased per target), or `createRequire(import.meta.url)` as a NAMED import from `node:module` when you specifically need an exports-map-aware RESOLVER (`@gjsify/module`'s polyfill rejects synchronous BUILTIN loads through it — resolve paths, don't load modules). `await import(...)` is ordinary ESM, not a `require`.
|**enforced, not merely documented:** `.oxlintrc.json` sets `typescript/no-require-imports: "error"` — it is NOT in the `correctness` category, so it must be listed explicitly; until it was, the rule NEVER RAN and the `eslint-disable-next-line @typescript-eslint/no-require-imports` comments at some offending sites were pure decoration. Unused-disable reporting is also an error (§ Lint) so that decoration cannot sit next to a live bug again. An `overrides` entry turns the rule OFF for `**/*.cjs`/`**/*.cts` (CJS files — `require` is their module syntax: the `cjs-compat.cjs` shims, CJS fixtures).
|**a per-site disable needs a STATED REASON + tracked TODO — never bare.** All three spellings suppress (`@typescript-eslint/…`, `typescript/…`, `oxlint-…`). Only sanctioned sites today: the two lazy native-dispatcher loads in `@gjsify/http2` (static import would drag the optional typelib-backed `http2-native` into every consumer; the ESM fix needs async `connect()`/`listen()`) — latent ReferenceErrors on the unbundled path, tracked in `status/open-todos.md`.
|`require` TEXT that is not a binding stays legal (generated fixture source, `node -e` one-liners, worker templates, comments) — the rule sees bindings.

### 2. Inbound — third-party CJS is resolved at BUILD time

A bundled npm dep's `require('stream')` is resolved by rolldown (`__commonJSMin` wrap, internal `__require`). Nothing is injected at runtime, and **`app/node.ts` deliberately sets NO `createRequire` banner** — one collided with yargs' own (`Identifier 'require' has already been declared`).

### 3. Outbound — `cjs-compat.cjs` is a PUBLISHING concern

`@gjsify/{stream,events,assert}` ship a `cjs-compat.cjs` via `exports['.'].require`, for an EXTERNAL CJS consumer whose `require('stream')` must get the constructor (so `util.inherits(Child, Stream)` works). `alias.ts` forwards `extraOptions.kind` to `this.resolve()` so the `require` condition can match the original call site (regression: `tests/e2e/cjs-require-stream`). **Where the condition is SELECTED is the subtlety:** `--app node`'s esm `conditionNames` include `'require'` → picks `cjs-compat.cjs`; `--app gjs`'s are `['browser','import']` (comment in `setupForGjs` explains why) → under GJS the constructor comes from the `"module.exports"` string-export below; `cjs-compat.cjs` is dead weight there. Forwarding `kind` is necessary, not sufficient.

### The namespace-vs-constructor fix

Bundling wraps ESM with `__toCommonJS` → a namespace object, not a constructor; a bundled CJS `require('stream')` (pngjs, mute-stream, readable-stream, …) then dies at load with `Stream is not a constructor` / `superCtor.prototype … undefined`.
|**Fix (active): the `"module.exports"` string-export** — for a pkg whose CJS `module.exports` must be a single callable (Node's dual shape — `stream`, `events`), add after `export default _default;`: `export { _default as 'module.exports' };` (ES2022 arbitrary-string export). Rolldown's `__toCommonJS` special-cases an OWN `"module.exports"` property on the namespace and returns it verbatim → a bundled `require('<name>')` yields the callable, normal ESM imports untouched. Engine-agnostic. Regression fixture: `packages/node/stream/src/cjs-interop.fixture.cjs` + `inheritance.spec.ts`.
|Historical note: the esbuild-era "Fix 1" (output unwrap in `onEnd`) was NOT ported to Rolldown; "Fix 2" (`cjs-compat.cjs`) still ships but is only selected on `--app node` (above).

## The OS axis — this pillar is what the macOS and Windows legs run

`main.yml` is Linux-only. `macos-suites.yml` and `windows-suites.yml` run the
Node-pillar suites (`path`, `os`, `process`, `util`, `fs`, `child_process`,
`net`, …) — on `main`, the nightly, and **since 2026-08-16 on your PR as well**
(ADR 0018 § 5 re-measured: a change here kept being green everywhere its author
could see and reddening `main`). ADVISORY, so nothing stops the merge: READ them.

|**A POSIX literal cannot fail on Linux.** `O_CREAT` is 0o100 on Linux, 0x200 on
darwin, 0x100 on win32; `O_APPEND` is 0o2000 vs 0x8; `EEXIST` is errno -17 vs
libuv -4075. Take flags from `fs.constants`, assert an errno's `code`.
`scripts/check-spec-posix-literals.mjs` gates the spellings it can see
statically — it is a floor, not a proof.
|**Before merging a change to a semantics spec here, ASK the OS legs** — they
have `workflow_dispatch`: `gh workflow run "macOS suites" --ref <branch>` and
the same for `"Windows suites"`. Two dispatches beat eight hours of red `main`.
|**Gate a host difference with `it.failing(…, reason, { when })`, never an
`if`** — it keeps the assertion whole and fails the run the day the host can
satisfy it. `packages/node/fs/src/capabilities.spec.ts` is the worked example,
including when to MEASURE a capability and when keying on the platform is the
honest choice (a probe running under `test.gjs.mjs` asks the implementation
under test whether the implementation is right).
|**`it.failing` fails a run for SUCCEEDING, so a `when` that is too broad is
itself a red build.** Two ways to get it too broad, both paid for in #1039:
|— *reasoning about the mechanism instead of measuring it.* The
descriptor-identity rules were gated on `/proc/self/fd` because that is how GJS
reaches a descriptor — but on darwin, which has none, the GJS leg passes them
anyway. A gate is a claim about a host; if you have not run it there, you have
not checked it.
|— *forgetting that a `when` may need the LEG.* Where the divergence is OURS the
marker must carry `IS_GJS`, or it fires on a Node leg that passes. Where the
REFERENCE diverges from the standard — darwin's `pwrite` ignoring POSIX's
`O_APPEND` clause, which `@gjsify/fs` implements correctly everywhere — it must
carry `!IS_GJS` instead, and the GJS leg must pass.

Incident: #1039 merged ~100 POSIX-semantics rules with a green Linux pipeline
and put 45 failures on `main` across the two legs — 9 on darwin, 36 on win32.
