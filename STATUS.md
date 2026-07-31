# gjsify — Project Status

<!-- GENERATED FILE — DO NOT EDIT BY HAND.
     Regenerate: node scripts/generate-status.mjs
     Authored inputs: status/ (status.json, integration-coverage.md, open-todos.md,
     upstream-patch-candidates.md, sections/*.md). Everything else is DERIVED from
     package manifests + the tree at generation time. CI fails on drift
     (audit-runtimes --check, rule `status-data`). -->

> **This file is GENERATED.** The status snapshot lives as data: per-package status
> prose in [`status/status.json`](status/status.json), integration-suite notes, open
> TODOs and upstream patch candidates in [`status/*.md`](status/), free-form sections
> in [`status/sections/`](status/sections/). Package lists, tiers, runtime slots,
> platform targets, GNOME-library usage and every count are derived from the repo —
> never typed by hand. Edit the data (or the manifests), then run
> `node scripts/generate-status.mjs`. STATUS.md remains a CURRENT SNAPSHOT, not a
> changelog: per-change narrative belongs in commit messages + CHANGELOG.md.

## Summary

gjsify implements Node.js, Web Standard, and DOM APIs for GJS (GNOME JavaScript / SpiderMonkey 140). Release train version: **v0.25.1** (every `@gjsify/*` package publishes at one version, ADR 0008).

| Category | Total | Full | Partial | Stub |
|---|---|---|---|---|
| Node.js APIs | 41 | 33 (80%) | 5 (12%) | 3 (7%) |
| Node.js native bridges | 5 | 5 | — | — |
| Node.js meta | 2 | 2 | — | — |
| Web APIs | 19 | 19 | — | — |
| Web native bridges | 1 | 1 | — | — |
| Web meta | 1 | 1 | — | — |
| Browser UI / Adwaita | 5 | 5 | — | — |
| DOM | 2 | 2 | — | — |
| Framework | 15 | 15 | — | — |
| NativeScript bridges | 5 | 5 | — | — |
| GJS infrastructure | 3 | 3 | — | — |
| Build/Infra tools | 20 | 17 (85%) | 3 (15%) | — |
| Runtime engines | 4 | 3 (75%) | 1 (25%) | — |
| Showcases | 13 | 13 | — | — |
| Integration test suites | 35 | 35 | — | — |

**Web platform coverage** (vs. the relevant W3C/WHATWG standards, not just our own package list): ≈54 % of all surveyed standards implemented full or partial, with ~20 % out of scope by design for desktop GTK apps (Service Worker, FS Access, Web Bluetooth, …). See `website/src/data/web-standards.ts` for the canonical category list.

**Test coverage:** every package's spec suite runs on both Node.js and GJS (browser-tested packages additionally run under Playwright/Firefox — same SpiderMonkey engine family as GJS). CI via GitHub Actions (Node.js 24.x + GJS on Fedora — minimum supported runtime: GJS 1.86 / SpiderMonkey 140). The static spec/`it()` counts in the tables and metrics below are derived from the tree at generation time; runtime pass/fail totals are what CI gates on. Integration suites (`gjsify foreach test:integration`) are opt-in and exercise curated upstream tests — see the Integration Test Coverage section.

---

## Package Tiers

Every published package declares its stability contract in `package.json#gjsify.tier` — the source of truth, verified by `scripts/audit-runtimes.mjs --check` (tier presence + dependency direction). See [ADR 0003](docs/adr/0003-package-tiering.md) + [ADR 0005](docs/adr/0005-node-gi-scope.md). Membership below is derived from the manifests:

- **Tier 1 — core (99):** stability promise. abort-controller, assert, async_hooks, bridge-types, browser-node-polyfills, buffer, canvas2d, canvas2d-core, child_process, cli, cluster, compression-streams, console, constants, create-app, crypto, dgram, diagnostics_channel, dns, dom-elements, dom-events, dom-exception, domain, domparser, empty, event-bridge, events, eventsource, fetch, formdata, fs, gamepad, http, http-soup-bridge, http2, http2-native, https, iframe, inspector, lightningcss-native, lightningcss-wasm, message-channel, module, net, node-globals, node-polyfills, npm-registry, os, oxfmt-native, path, perf_hooks, process, querystring, readline, resolve-npm, rolldown-native, rolldown-plugin-deepkit, rolldown-plugin-gjsify, rolldown-plugin-pnp, runtime, sab-native, semver, sqlite, stream, string_decoder, sys, tar, terminal-native, timers, tls, tls-native, tsc, tty, unit, url, util, utils, v8, video, vite-plugin-blueprint, vite-plugin-gettext, vite-plugin-gjsify, vm, web-globals, web-polyfills, web-streams, webassembly, webaudio, webcrypto, webgl, webrtc, webrtc-native, websocket, webstorage, worker_threads, workspace, ws, xmlhttprequest, zlib
- **Tier 2 — product (19):** best effort. adwaita-app, adwaita-core, adwaita-fonts, adwaita-icons, adwaita-nativescript, adwaita-storybook, adwaita-web, devtools, devtools-mcp, devtools-nativescript, devtools-protocol, native-fs-bridge, native-platform, nativescript-vite, node-gi, stories, storybook, storybook-core, storybook-nativescript
- **Tier 3 — experimental (5):** no promise; new axes start here. devtools-browser, devtools-cdp, gtk-runtime-darwin-arm64, gtk-runtime-win32-x64, napi

---

## Node.js Packages (`packages/node/`)

### Fully implemented (33)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **assert** | — | 1 specs · 73 it() | AssertionError, deepEqual, throws, strict mode. |
| **async_hooks** | — | 1 specs · 74 it() | AsyncLocalStorage (run, enterWith, snapshot, exit), AsyncResource (bind, runInAsyncScope, triggerAsyncId), createHook. |
| **buffer** | — | 2 specs · 172 it() | Buffer via Blob/atob/btoa, alloc, from, concat, encodings, fill, indexOf/lastIndexOf, slice/subarray, copy, int/float read/write, swap16/32/64, equals, compare. `TextEncoder`/`TextDecoder` lazily initialised (NS V8 registers them after module eval). |
| **child_process** | gio-2.0, glib-2.0 | 2 specs · 146 it() | exec/execSync, execFile/execFileSync, spawn/spawnSync via Gio.Subprocess; cwd/env via Gio.SubprocessLauncher; `child.stdout`/`child.stderr` as Readable streams; `ensureMainLoop()` in spawn/exec/execFile (fixes GJS-from-GJS deadlock). Node-parity audit: env value coercion (`null`/number/boolean/array → string, `undefined` dropped, prototype-chain iteration, empty-env wipes parent env), cwd accepts `URL`/`Buffer`, `argv0`/`detached`/`uid`/`gid`/`windowsHide`/`windowsVerbatimArguments` accepted (argv0 via `/bin/sh -c 'exec -a'` shim, detached via `setsid`), `encoding: 'buffer'` returns Buffer, `timeout` + `killSignal` on all six call shapes (sync paths via `communicateWithTimeout()` — a GLib timer driving `communicate_async()` on a private main context), timed-out sync throws `ETIMEDOUT`/`killed`/`signal`/`status: null` with partial output, exec honours `maxBuffer` + `AbortSignal`, ENOENT surfaces as `err.code='ENOENT'`/`errno`/`syscall`/`path`/`spawnargs`, `kill()` maps named signals to POSIX numbers. pid captured at spawn (instant-exit children: see Upstream GJS Patch Candidates). |
| **console** | — | 1 specs · 84 it() | Console class with stream support, format specifiers, table, dir, time/timeLog, count, group, assert, trace, stdout/stderr routing. |
| **constants** | — | 1 specs · 8 it() | Flattened re-export of `os.constants` (errno, signals, priority, dlopen) + `fs.constants` + legacy crypto constants — the deprecated Node `constants` alias. |
| **crypto** | glib-2.0 | 14 specs · 256 it() | Hash (SHA256/384/512, MD5, SHA1; GLib.Checksum), Hmac (GLib.Hmac), randomBytes/UUID/Int, PBKDF2, HKDF, scrypt, AES (CBC/CTR/ECB/GCM), DH, ECDH, Sign/Verify, publicEncrypt/privateDecrypt, KeyObject (JWK import/export), X509Certificate, timingSafeEqual, getHashes/getCiphers/getCurves, constants. Entropy via the `@gjsify/webcrypto/random` chain. NativeScript entry (`@gjsify/crypto/nativescript`): sync createHash/createHmac (7 algorithms via `@noble/hashes`), random, timingSafeEqual; ENOTSUP for AES/DH/ECDH/Sign/PBKDF2/RSA. Browser slot is `partial` (sync `Hash.digest()` impossible over async-only WebCrypto). |
| **dgram** | gio-2.0, glib-2.0 | 1 specs · 82 it() | UDP Socket via Gio.Socket with bind, send, receive, multicast, connect/disconnect/remoteAddress, broadcast, TTL, ref/unref, IPv6, EventEmitter. |
| **diagnostics_channel** | — | 1 specs · 66 it() | Channel, TracingChannel, subscribe/unsubscribe. |
| **dns** | gio-2.0, glib-2.0 | 3 specs · 70 it() | lookup, resolve4/6, reverse via Gio.Resolver + dns/promises. Browser slot `partial` (no DNS resolver in a browser sandbox). |
| **events** | — | 2 specs · 138 it() | EventEmitter (prototype methods enumerable for socket.io v4 compat), once, on, listenerCount, setMaxListeners, errorMonitor, captureRejections, getEventListeners, prependListener, eventNames, rawListeners, Symbol events, async iterator, makeCallable (`.call(this)` + `util.inherits` CJS compat), `"module.exports"` string-export for bundled CJS `require('events')`. |
| **fs** | gio-2.0, glib-2.0 | 19 specs · 390 it() | sync, callback, promises, streams, FSWatcher (Node-contract `'change'` event shape), symlinks (NOFOLLOW-aware Dirents), FileHandle (read/write/truncate/writeFile/stat/readFile/appendFile, stat/chmod/chown/utimes/datasync/sync/readv/writev/readLines), access/copyFile/cp/cpSync/promises.cp/rename/lstat, mkdir/rmdir/mkdtemp/chmod/truncate, Dir/opendir/opendirSync/promises.opendir, globSync/glob/promises.glob (*, **, ?, {a,b}, extglob, exclude fn/array), promises.watch() (async iterator, AbortSignal, Gio.FileMonitor), watchFile/unwatchFile/StatWatcher, statfsSync/statfs/promises.statfs, utimes/lutimes/lchown/lchmod, fd-based ops via FileHandle registry (fstat/ftruncate/fdatasync/fsync/fchmod/fchown/futimes/closeSync/readSync/writeSync/readv/writev/exists/openAsBlob), URL path args everywhere, ENOENT error mapping, fs.constants, readdir options (withFileTypes, encoding). Browser slot `partial` (in-memory Volume; FSWatcher never fires — see Open TODOs). |
| **node-globals** | glib-2.0 | 1 specs · 96 it() | process, Buffer, structuredClone (full polyfill), TextEncoder/Decoder, atob/btoa, URL, setImmediate. Root export pure; side effects in `@gjsify/node-globals/register` (granular subpaths per feature; catch-all kept as the official "give me everything" opt-in). Users opt in via `--globals` (default `auto`) or an explicit register import. |
| **http** | gio-2.0, glib-2.0, soup-3.0 | 8 specs · 428 it() | Server (Soup.Server via `@gjsify/http-soup-bridge`, chunked streaming, upgrade event, `SoupMessageLifecycle` per-request helper: GC guard for in-flight Soup messages + `'wrote-chunk'`-driven re-unpause + `'disconnected'`/`'finished'` → req/res `'close'`/`'aborted'`), ClientRequest (Soup.Session, timeout events, auth option, signal option), IncomingMessage (timeout events; close-only-via-destroy per Node semantics), ServerResponse (setTimeout, chunked transfer), OutgoingMessage, `ServerRequestSocket` (Duplex-typed `req.socket` with working pause/resume/destroySoon for Hono backpressure), STATUS_CODES, METHODS, Agent (constructor options, keepAlive, maxSockets, scheduling), validateHeaderName/Value, maxHeaderSize. Known limitation: libsoup stops polling the input stream while a server message is paused, so `'disconnected'` does not fire for long-poll/SSE clients that hang up — see Upstream GJS Patch Candidates. Browser slot `partial` (no inbound TCP; client half rides fetch). |
| **http2** | gio-2.0, glib-2.0, gobject-2.0, soup-3.0 | 3 specs · 62 it() | `createServer()` (HTTP/1.1 via Soup; opt-in `allowHTTP1:false` → raw h2c via `Http2NativeDispatcher` on `Gio.SocketService`), `createSecureServer()` (h2 via ALPN + TLS), `connect()` (Soup.Session default, `nativeDispatcher:'force'` for native h2c client + push-event reception), compat layer (`Http2ServerRequest`/`Http2ServerResponse`), session API (`'stream'` event + `ServerHttp2Stream.respond()`), `ClientHttp2Session.request()` → `ClientHttp2Stream`, protocol constants + settings pack/unpack, `respondWithFile()`/`respondWithFD()` (statCheck honoured), `pushStream()`/`createPushResponse()` with wire-level PUSH_PROMISE on the native path (`ERR_HTTP2_NESTED_PUSH` on nested push), client-side `'stream'` event for pushed resources, GOAWAY on `server.close()`, RST_STREAM on `stream.close(code)`, GC-pinning of active `SessionBridge` instances. Two lazy native-dispatcher loads still use a bare `require` (sanctioned lint disables — see Open TODOs). |
| **https** | — | 2 specs · 91 it() | Agent (defaultPort, protocol, maxSockets, destroy, options, keepAlive, scheduling), globalAgent, request (URL/options/headers/timeout/methods), get, createServer, Server. Browser slot `partial` (`TLSSocket`/`createSecureContext` cannot exist — the UA terminates TLS below JS). |
| **module** | gio-2.0, glib-2.0 | 2 specs · 94 it() | builtinModules, isBuiltin (bare/prefixed/subpath/scoped), createRequire (resolve, cache, extensions; ancestor `node_modules` walk; PnP-aware — parses `.pnp.cjs` `RAW_RUNTIME_STATE` directly). Browser slot `partial` (no synchronous CJS loader). |
| **net** | gio-2.0, glib-2.0 | 6 specs · 223 it() | Socket (Duplex via Gio.SocketClient, allowHalfOpen enforcement, timeout with reset, remote/local address, IOStream support), Server (Gio.SocketService, allowHalfOpen, getConnections), isIP/isIPv4/isIPv6, connect/createConnection. |
| **os** | gio-2.0, glib-2.0 | 2 specs · 90 it() | homedir, hostname, cpus, platform, arch, type, release, endianness, EOL, devNull, availableParallelism, userInfo, networkInterfaces, constants (signals/errno), loadavg, uptime, memory. |
| **path** | — | 1 specs · 135 it() | POSIX + Win32. Validated on-device on NativeScript V8 (integration suite). |
| **perf_hooks** | — | 1 specs · 70 it() | performance (now, timeOrigin, mark/measure, getEntries/ByName/ByType, clearMarks/clearMeasures, toJSON), monitorEventLoopDelay, PerformanceObserver, eventLoopUtilization, timerify. |
| **process** | — | 4 specs · 155 it() | EventEmitter-based, env (CRUD, enumerate, coerce; dotenv-validated Proxy traps), cwd/chdir, platform, arch, pid/ppid, version/versions, argv, hrtime/hrtime.bigint (named import preserves `.bigint`), memoryUsage, nextTick (batched GLib-idle delivery keeps GTK input responsive), exit/kill, config, execArgv, cpuUsage, signal handler registration, stdout/stderr write methods, emitWarning; stdin/stdout/stderr as ProcessReadStream/ProcessWriteStream (isTTY, setRawMode, columns/rows via `@gjsify/terminal-native` or env/GLib fallback); SIGWINCH → stdout/stderr 'resize'. |
| **querystring** | — | 1 specs · 63 it() | parse/stringify with full encoding. |
| **readline** | — | 2 specs · 89 it() | Interface (lifecycle, line events, mixed line endings, Unicode, chunked input, long lines, history), question (sequential, output), prompt, pause/resume, async iterator, clearLine/clearScreenDown/cursorTo/moveCursor, readline/promises, `Interface[Symbol.dispose]` = close() (`using`). |
| **stream** | — | 9 specs · 334 it() | Readable (protected `_autoClose` hook), Writable, Duplex, Transform, PassThrough, objectMode, backpressure (drain, HWM=0), pipe (cleanup, error handling, multiple dest, unpipe), inheritance (instanceof hierarchy, util.inherits), destroy, pipeline, finished, addAbortSignal, Readable.from, consumers, promises, async iteration, FIFO write-ordering across drain re-entry, `[Symbol.asyncDispose]` (`await using`), `"module.exports"` string-export for bundled CJS `require('stream')`. Split into per-class modules (`stream-base`/`readable`/`writable`/`duplex`/`transform`/`passthrough` + utils), `src/index.ts` a re-export barrel preserving the `cjs-compat.cjs` default-export shape; `pipe` wired via a late-binding hook to break the eager-ESM import cycle. |
| **string_decoder** | — | 1 specs · 65 it() | UTF-8, Base64, hex, streaming; pure manual UTF-8 decoder implementing the W3C maximal-subpart algorithm. |
| **sys** | — | 1 specs · 4 it() | Deprecated Node alias — re-exports `@gjsify/util`. |
| **timers** | — | 3 specs · 70 it() | setTimeout/setInterval/setImmediate (delay verification, args, clear, ordering) + timers/promises. GLib-source-safe: replaces setTimeout/setInterval with `GLib.timeout_add` to avoid the SM-GC race on GLib.Source BoxedInstances; Node-shaped `GjsifyTimeout` wrapper with no-op ref/unref/hasRef, working refresh/Symbol.dispose/Symbol.toPrimitive. |
| **tls** | gio-2.0, glib-2.0 | 5 specs · 155 it() | TLSSocket via Gio.TlsClientConnection: getPeerCertificate (Node shape incl. `detailed=true` issuer-chain walk), getProtocol, getCipher, ALPN advertise/negotiate, servername; connect (mTLS via `set_certificate`, custom CA validation, custom `checkServerIdentity`); createServer/TLSServer (requestCert+rejectUnauthorized, addContext/SNICallback with real ClientHello-driven server-side SNI via BufferedInputStream peek + RFC 6066 §3 parser, ALPN); createSecureContext (string/Buffer/Uint8Array/array PEM, ca bundle); checkServerIdentity (full RFC 6125 §6.4.3 incl. wildcard rules, A-label matching, `ERR_TLS_CERT_ALTNAME_INVALID`); getCiphers, DEFAULT_CIPHERS, DEFAULT_MIN/MAX_VERSION, rootCertificates. Phase 2 session access via `@gjsify/tls-native`: `getFinished()`/`getPeerFinished()`/`getSession()`/`setSession()`/`isSessionReused()` + `'session'` event + `{session}` option, `tls-unique`/`tls-exporter` channel binding auto-selected per TLS version; `hasTlsSessionAccess()` gate. OCSP-response parsing surfaced via `parseOcspResponse`/`hasOcspSupport`. |
| **tty** | glib-2.0 | 1 specs · 58 it() | ReadStream/WriteStream, isatty (Posix or GLib fallback), ANSI escapes, clearLine, cursorTo, getColorDepth (env-based), hasColors, getWindowSize (ioctl or env/default fallback), setRawMode (termios or no-op fallback) — all terminal primitives via `@gjsify/terminal-native` when installed. |
| **url** | glib-2.0 | 1 specs · 150 it() | URL (with static `URL.createObjectURL`/`revokeObjectURL` over `Blob._tmpPath` + `file://`), URLSearchParams via GLib.Uri. |
| **util** | — | 2 specs · 156 it() | inspect (colors, styles, custom symbol, defaultOptions), format (%%, %s/%d/%j/%i/%f), promisify (custom symbol), callbackify, deprecate, inherits (`super_`), isDeepStrictEqual, styleText, stripVTControlCharacters, types (isDate/RegExp/Map/Set/Promise/ArrayBuffer/TypedArray/Async/Generator/WeakMap/WeakSet/DataView), TextEncoder/TextDecoder. |
| **zlib** | gio-2.0, glib-2.0 | 3 specs · 147 it() | gzip/deflate/deflateRaw round-trip via the Web Compression API with Gio.ZlibCompressor fallback, constants, sync methods, streaming classes (`Gzip`/`Gunzip`/`Deflate`/`Inflate`/`DeflateRaw`/`InflateRaw`/`Unzip` as real `Transform` subclasses over Gio.ZlibCompressor/ZlibDecompressor; `Unzip` auto-detects gzip-vs-zlib by magic byte; `inherits(Sub, zlib.Inflate)` module-init compat for sync-inflate/pngjs/qrcode). Brotli + Zstd surfaces present as throwing stubs (no GLib codec; unblocks axios + undici@7 feature detection). Browser slot `partial` (`*Sync` impossible over Promise-only `CompressionStream`). |

### Partially implemented (5)

| Package | GNOME Libs | Tests (static) | Working | Missing |
|---|---|---|---|---|
| **sqlite** | gda-6.0, gobject-2.0 | 5 specs · 59 it() | `DatabaseSync` (open/close, prepare, exec, `enableForeignKeyConstraints`, `readBigInts`, location property, path as `string`/`URL`/`Uint8Array`), comment/quote-aware multi-statement `exec()` splitting (quoted regions + `--`/`/* … */` comments; comments stripped before parsing to dodge libgda's block-comment `parse_string` heap crash), `StatementSync` (all/get/run/iterate, named + positional params, typed readers, `{ lastInsertRowid, changes }`), spec-compliant error codes (`ERR_SQLITE_ERROR`, `ERR_INVALID_STATE`, `ERR_INVALID_URL_SCHEME`). | Compound-statement (`CREATE TRIGGER … BEGIN … END;`) splitting — the hand-rolled splitter is token-level, not a full parser (clean fix needs libgda's own tokenizer, see Open TODOs); `PRAGMA user_version` round-trip depends on libgda build; WAL journal mode; `sqlite.constants` (SQLITE_CHANGESET_*); session/changeset extension APIs; backup/vfs APIs. Browser slot `partial` (`DatabaseSync` throws from its constructor — future `./browser-worker` OPFS subpath, see Open TODOs). |
| **v8** | glib-2.0 | 1 specs · 33 it() | Real heap stats via `/proc/self/status` (VmRSS/VmPeak/VmSize/VmData), V8 wire format v15 serialize/deserialize (all scalars, TypedArrays, Buffer, BigInt, circular refs, Date, RegExp, ArrayBuffer), `Serializer`/`Deserializer`/`DefaultSerializer`/`DefaultDeserializer`, `isStringOneByteRepresentation`, `GCProfiler`, `startCpuProfile`. | `getHeapSpaceStatistics` (no SpiderMonkey heap-space API), `getHeapSnapshot`/`writeHeapSnapshot` (no Readable stream from GJS), CPU profiling, `queryObjects`, `promiseHooks`, `cachedDataVersionTag` (all V8-internal). |
| **vm** | — | 2 specs · 164 it() | runInThisContext (eval), runInNewContext (Function constructor with sandbox), runInContext, createContext/isContext, compileFunction, Script (reusable, runInNewContext). | True sandbox isolation (requires SpiderMonkey Realms). |
| **worker_threads** | gio-2.0, glib-2.0 | 4 specs · 164 it() | MessageChannel, MessagePort (deep clone: Date, RegExp, Map, Set, Error, TypedArrays), BroadcastChannel, receiveMessageOnPort, environmentData, Worker (Gio.Subprocess with stdin/stdout IPC, file-based resolution with relative paths, stderr capture, orphan shutdown on parent EOF), addEventListener/removeEventListener, structured-clone edge cases (-0, NaN, BigInt, Int32Array), `postMessage(value, transferList)` for `ArrayBuffer` (zero-copy via SM140 `transfer()`; rejects detached/duplicate/non-transferable/SAB entries with `DataCloneError`) and for `MessagePort` (in-process channel hand-off + cross-process subprocess IPC via `SubprocessPortTransport`), `SharedArrayBuffer` pass-through in same-process MessageChannel (Node), cross-process `SharedBuffer` in `Worker.postMessage` and `workerData` via `@gjsify/sab-native` (SCM_RIGHTS fd side-channel on inherited fd 3, count-and-drain placeholder protocol). | `SharedArrayBuffer` constructor unavailable in stock GJS (Mozilla disables it; use `SharedBuffer` instead); `worker.postMessage` IPC-side `ArrayBuffer` transferList (JSON protocol — no binary frames yet for non-SharedBuffer transfers). Browser slot `partial` (no synchronous `receiveMessageOnPort`; `workerData` lands on the first macrotask). |
| **ws** | gio-2.0, glib-2.0, soup-3.0 | 4 specs · 39 it() | `WebSocket` client class (url/protocol/headers), readyState + events, `send()`/`close()`/`terminate()`, `binaryType` conversions (nodebuffer/arraybuffer/fragments/blob), W3C `addEventListener` compat, `WebSocketServer` via `Soup.Server.add_websocket_handler` (port binding, client tracking, close), `options.headers`/`origin`/`handshakeTimeout`, `verifyClient` (sync + async), `handleProtocols`, `{ server }` shared-port mode, `{ noServer: true }` + `handleUpgrade()` (manual upgrade routing incl. Sec-WebSocket-Accept + `'headers'` event), `createWebSocketStream` (Duplex bridge). | `ping`/`pong` events (Soup handles control frames internally — libsoup 3 GI exposes no user-level send API), `upgrade`/`unexpected-response`/`redirect` events (no Soup hook), custom perMessageDeflate parameters. The only one of the ten browser-`partial` packages with no `src/test.browser.mts` (see Open TODOs). |

### Stubs (3)

| Package | Tests (static) | Notes |
|---|---|---|
| **cluster** | 1 specs · 4 it() | isPrimary, isMaster, isWorker; fork() throws. Effort to implement: high — requires multi-process architecture. |
| **domain** | 2 specs · 16 it() | Deprecated Node.js API; pass-through. Intentionally minimal. |
| **inspector** | 1 specs · 6 it() | Session.post(), open/close; empty. V8-specific, hard to port. |

### Native bridges (5)

| Package | Platforms | GNOME Libs | Notes |
|---|---|---|---|
| **http-soup-bridge** | linux-x64, linux-arm64, linux-ppc64, linux-s390x, linux-riscv64, darwin-arm64 | gio-2.0, gjsifyhttpsoupbridge-1.0, glib-2.0, gmodule-2.0, gobject-2.0, soup-3.0 | Vala/GObject library consumed by `@gjsify/http`. Wraps `Soup.Server` + `SoupServerMessage`, exposing JS only plain GObject classes whose lifetime SpiderMonkey GC cannot race. Solves two libsoup GC crashes: (1) `BoxedBase::finalize → g_source_unref` SIGSEGV from deferred-GC on in-flight Soup messages, (2) `g_main_context_unref` assertion from shared `GMainContext` ref imbalance. Contains `Server` (emits `request-received`/`upgrade`/`error-occurred`), `Request` (read-side snapshot), `Response` (write side, owns `SoupServerMessage` C-side incl. pause/unpause bookkeeping), and a peer-close watcher (`g_socket_create_source(IN\|HUP\|ERR)` + non-blocking `MSG_PEEK` probe — unreachable from JS because `Gio.Socket.receive_message` is not introspectable). |
| **http2-native** | linux-x64, linux-arm64, linux-ppc64, linux-s390x, linux-riscv64, darwin-arm64 | gjsifyhttp2-1.0, glib-2.0, gobject-2.0 | Vala/GObject library (+ C shim around `nghttp2_hd_deflate_*`) consumed by `@gjsify/http2` — nghttp2 primitives unreachable through libsoup's GIR API. `FrameEncoder` (HPACK header-block encoder + raw frame builders for DATA/HEADERS/PUSH_PROMISE/SETTINGS/WINDOW_UPDATE/PING/RST_STREAM/GOAWAY), `StreamIdAllocator` (RFC 7540 §5.1.1 even-id sequencer + client-id tracking for GOAWAY), `SessionBridge` (full `nghttp2_session` driver, server + client modes, complete submit family; events drain via `gjsify_http2_event_*` getters and re-emit on the main loop via `GLib.Idle.add()`). Header signals carry `GLib.Variant("a(ss)")` so GJS's marshaller doesn't trip `G_VALUE_HOLDS_POINTER`; all buffer ownership stays C-side via `GLib.Bytes`. TS wrapper loads the typelib lazily — JS-only fallback when the prebuild is unavailable. |
| **sab-native** | linux-x64, linux-arm64, linux-ppc64, linux-s390x, linux-riscv64 | — | Vala + C shim providing cross-process shared memory + atomics for `@gjsify/worker_threads` (closes the SharedArrayBuffer gap — Mozilla disables the SAB constructor in stock GJS). `SharedBuffer` (memfd_create + mmap(MAP_SHARED); typed accessors, bulk read/write via GLib.Bytes with refcount-pinned mmap lifetime, `viewBytes()`/`toBuffer()` duck-type entry for `Buffer.from(sharedBuffer)`, SEQ_CST `__atomic_*` builtins, cross-process futex wait/notify via `syscall(SYS_futex)`), `FdChannel` (SOCK_SEQPACKET socketpair + SCM_RIGHTS fd transfer). `SharedBuffer.create(size)` / `SharedBuffer.from_fd(fd, size)`; byte-order-explicit LE wire accessors so x86_64 and s390x read identically. Loaded via `imports.gi.GjsifySabNative` with try/catch; `hasNativeSab()` predicate. |
| **terminal-native** | linux-x64, linux-arm64, linux-ppc64, linux-s390x, linux-riscv64, darwin-arm64 | — | Optional Vala prebuild: `GjsifyTerminal.Terminal.is_tty(fd)` (Posix.isatty), `get_size(fd)` (ioctl TIOCGWINSZ), `set_raw_mode(fd, enable)` (termios — clears ICANON+ECHO+ISIG, Node-parity so Ctrl-C is a keystroke, not SIGINT); `ResizeWatcher` with a `resized(rows, cols)` signal on SIGWINCH via `GLib.Unix.signal_add()`. Loaded via synchronous `imports.gi.GjsifyTerminal` with try/catch — GLib/env fallback when not installed. Consumed by `@gjsify/tty` + `@gjsify/process`. |
| **tls-native** | linux-x64, linux-arm64, linux-ppc64, linux-s390x, linux-riscv64, darwin-arm64 | — | Optional Vala prebuild for GnuTLS capabilities Gio does not expose. Phase 1: OCSP-response parsing — sibling `gnutls-ocsp.vapi` fills the OCSP gap in Vala 0.56's `gnutls.vapi`; `Tls.parse_ocsp_response(uint8[])` returns an `OcspResponseInfo` GObject (all RFC 6960 §4.2.1 fields). Phase 2 (Path A, functional): `SessionAccess` + `ChannelBindingType` wrap a `Gio.TlsConnection` — is_supported/for_connection/is_session_reused/get_session_data/set_session_data/get_channel_binding/get_finished/get_peer_finished — via the C shim `src/c/gjsify-tls-private.{c,h}`, which extracts `gnutls_session_t` from `GTlsConnectionGnutls`'s private struct (layout vendored from refs/glib-networking, stable across 2.74–2.84) and force-loads the GIO TLS module. Loaded via `imports.gi.GjsifyTls` with try/catch — safe when the typelib is not installed. |

### Meta packages (2)

| Package | Purpose |
|---|---|
| **browser-node-polyfills** | Dep-only umbrella — the browser-capable subset of the Node polyfills, so browser builds resolve `node:*` imports out of the box. No runtime code. |
| **node-polyfills** | Dep-only umbrella — pulls every Node polyfill so `gjsify create-app` templates and CLI-generated scaffolds resolve any `node:*` import out of the box. No runtime code. |

---

## Web API Packages (`packages/web/`, excluding Adwaita)

### Fully implemented (19)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **abort-controller** | — | 2 specs · 19 it() | AbortController, AbortSignal (.abort, .timeout, .any). |
| **compression-streams** | — | 1 specs · 17 it() | CompressionStream, DecompressionStream (gzip/deflate/deflate-raw). Uses `@gjsify/web-streams` TransformStream. |
| **dom-events** | — | 4 specs · 137 it() | Event, EventTarget, CustomEvent, UIEvent, MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent; `dispatchEvent` reports a throwing listener and keeps going (WHATWG DOM §2.7) with dispatch flags restored in a `finally`. |
| **dom-exception** | — | 1 specs · 34 it() | DOMException polyfill (WebIDL standard). |
| **domparser** | — | 1 specs · 23 it() | DOMParser (parseFromString XML + HTML), minimal DOM (Element tagName/getAttribute/children/childNodes/querySelector[All]/textContent/innerHTML, Document documentElement/querySelector[All]). Sized for excalibur-tiled map parsing. |
| **eventsource** | — | 1 specs · 24 it() | EventSource (Server-Sent Events), TextLineStream. Uses fetch + Web Streams. |
| **fetch** | gio-2.0, glib-2.0, soup-3.0 | 5 specs · 69 it() | fetch(), Request (raw body via `set_request_body_from_bytes`), Response, Headers, Referrer-Policy, `file://` URI support, streaming gzip decode (full-body buffer through `DecompressionStream`; `Soup.ContentDecoder` removed per-session to avoid double decompression), per-connection TLS opt-out (`rejectUnauthorized: false`, undici-style — that `Soup.Message` only, never the shared session) + `NODE_TLS_REJECT_UNAUTHORIZED=0`, AbortSignal honored during connect/request-send/TTFB. XHR + `URL.createObjectURL` moved out into `@gjsify/xmlhttprequest` + `@gjsify/url`. |
| **formdata** | — | 1 specs · 24 it() | FormData, File, multipart encoding. |
| **gamepad** | manette-0.2 | 1 specs · 19 it() | Gamepad (navigator.getGamepads polling via libmanette event-driven signals), GamepadButton (pressed/touched/value), GamepadEvent (gamepadconnected/gamepaddisconnected), GamepadHapticActuator (dual-rumble). Manette→W3C standard-layout button mapping (17 buttons incl. triggers-as-buttons), 4 stick axes + trigger axes→button values. Lazy Manette.Monitor init, graceful degradation without libmanette. |
| **message-channel** | — | 1 specs · 10 it() | MessageChannel, MessagePort (W3C, EventTarget-based, transport-pluggable). Stock GJS exposes neither. The pluggable transport hook backs `@gjsify/iframe`'s WebKit bridge and `@gjsify/worker_threads`' cross-process ports. |
| **web-streams** | — | 2 specs · 186 it() | ReadableStream (incl. `type:'bytes'`), WritableStream, TransformStream, ReadableByteStreamController + `autoAllocateChunkSize`, ReadableStreamBYOBReader (`read(view, {min?})` preserves view-constructor), ReadableStreamBYOBRequest, polymorphic close/error/cancel for default + BYOB readers, byte-stream `tee()`, TextEncoderStream, TextDecoderStream, ByteLengthQueuingStrategy, CountQueuingStrategy (WHATWG Streams polyfill for GJS). |
| **web-globals** | — | 1 specs · 41 it() | Unified re-export surface for all Web API packages. Root export pure; side effects (URL, URLSearchParams, Blob, File, FormData, performance, PerformanceObserver + every sub-package's `/register`) in `@gjsify/web-globals/register`. Declares `node: "polyfill"` but re-exports `@gjsify/webaudio` (`node: "none"`) — flagged on every audit run, see Open TODOs. |
| **webassembly** | — | 1 specs · 7 it() | WebAssembly Promise-API polyfill — `compile`, `compileStreaming`, `instantiate`, `instantiateStreaming`, `validate` wrap SpiderMonkey's working synchronous constructors. Granular `/register/promise` subpath; auto-injected by `--globals auto` via `WebAssembly.<method>` METHOD_MARKERS. |
| **webaudio** | gio-2.0, glib-2.0, gst-1.0, gstapp-1.0 | 1 specs · 35 it() | AudioContext (decodeAudioData via GStreamer decodebin, createBufferSource, createGain, currentTime via GLib monotonic clock), AudioBuffer (PCM Float32Array), AudioBufferSourceNode (appsrc→audioconvert→volume→autoaudiosink), GainNode (AudioParam with setTargetAtTime), HTMLAudioElement (canPlayType, playbin). Phase 1 — covers Excalibur.js. Guaranteed NULL-state teardown (`gst-teardown.ts`): every pipeline tracked and drained via `GApplication::shutdown` / `process.on('exit')` / `AudioContext.close()` / a `finally` in the decoder. No runtime branching — decode + playback run on gjs AND the node-gi reverse bridge (node/bun/deno; bun/deno need the context pump, see Open TODOs). |
| **webcrypto** | gio-2.0, glib-2.0 | 2 specs · 143 it() | SubtleCrypto (digest, AES-CBC/CTR/GCM, AES-KW (RFC 3394), HMAC, ECDSA, RSA-PSS, RSA-OAEP, PBKDF2, HKDF, ECDH, generateKey, importKey/exportKey, deriveBits/deriveKey, wrapKey/unwrapKey), CryptoKey, getRandomValues, randomUUID. Owns the workspace entropy chain: `@gjsify/webcrypto/random` (leaf subpath) exports `fillRandomBytes()` with an ordered, reported source chain (WebCrypto → /dev/urandom via Gio → GLib.random_int_range → Math.random; the last two warn once) + `isSecureRandomSource(tier)`. |
| **webrtc** | glib-2.0, gobject-2.0, gst-1.0, gstsdp-1.0, gstwebrtc-1.0 | 4 specs · 304 it() | Full W3C WebRTC (Phases 1–4): RTCPeerConnection (offer/answer, ICE trickle, STUN/TURN config, addTransceiver/addTrack/removeTrack, getStats, restartIce, setConfiguration), RTCDataChannel (string + binary, bufferedAmount, binaryType), RTCRtpSender/Receiver/Transceiver, MediaStream, MediaStreamTrack (GStreamer source integration, enabled→valve), getUserMedia (pipewiresrc/pulsesrc/v4l2src fallback chain), MediaDevices, RTCDTMFSender, RTCCertificate, RTCDtlsTransport/RTCIceTransport/RTCSctpTransport, RTCStatsReport (GstStructure → W3C camelCase), RTCIceCandidate, RTCSessionDescription. Outgoing pipeline source→valve→convert→encode(opus/vp8)→payloader→capsfilter→webrtcbin; end-to-end bidirectional audio verified. Requires GStreamer ≥ 1.20 with gst-plugins-bad + libnice-gstreamer. Detailed phase/deviation notes: see the WebRTC status section below. |
| **websocket** | gio-2.0, glib-2.0, soup-3.0 | 1 specs · 18 it() | WebSocket, MessageEvent, CloseEvent (W3C spec). NUL-byte-safe text frames (send via `send_message(TEXT, GLib.Bytes)` — Soup's `send_text` truncates at `\0`), permessage-deflate negotiation (RFC 7692; extension manager + deflate registered explicitly), `extensions` reflects the negotiated set. RFC 6455 fuzz-validated via Autobahn: 510 OK / 4 NON-STRICT / 3 INFO / 0 FAILED. |
| **webstorage** | — | 1 specs · 20 it() | Storage, localStorage, sessionStorage (W3C Web Storage) via Gio.File/GLib.KeyFile. |
| **xmlhttprequest** | glib-2.0 | — | XMLHttpRequest (full `responseType`: arraybuffer / blob + temp-file / json / text / document), UTF-8 BOM stripped from responseText. FakeBlob with `_tmpPath`; owns the blob-file plumbing behind `URL.createObjectURL`. Backs Excalibur's asset loader and axios' XHR adapter. Known deno-under-node-gi stall at readyState 3 — see Open TODOs. |

### Native bridges (1)

| Package | Platforms | GNOME Libs | Notes |
|---|---|---|---|
| **webrtc-native** | linux-x64, linux-arm64, linux-ppc64, linux-s390x, linux-riscv64 | gjsifywebrtc-0.1 | Vala/GObject library consumed by `@gjsify/webrtc`. Three main-thread signal bridges — `WebrtcbinBridge` (webrtcbin's `on-negotiation-needed`/`on-ice-candidate`/`on-data-channel` + `notify::*-state`), `DataChannelBridge` (GstWebRTCDataChannel's open/close/error/message/buffered-amount-low + `notify::ready-state`; wraps incoming channels eagerly on the streaming thread so early messages are not dropped), `PromiseBridge` (`Gst.Promise.new_with_change_func`). Each bridge connects C-side (never invokes JS on the streaming thread) and re-emits via `GLib.Idle.add()` on the main context. |

### Meta packages (1)

| Package | Purpose |
|---|---|
| **web-polyfills** | Dep-only umbrella — pulls every Web polyfill so `gjsify create-app` scaffolds resolve any Web API import out of the box. No runtime code. |

### WebRTC status detail

**Implemented (Phase 1 + 1.5 — Data Channel end-to-end):** RTCPeerConnection (constructor, createOffer/createAnswer, setLocal/RemoteDescription, addIceCandidate, close, createDataChannel, getConfiguration; all state getters incl. pending/current descriptions + canTrickleIceCandidates; events negotiationneeded/icecandidate/icegatheringstatechange/iceconnectionstatechange/connectionstatechange/signalingstatechange/datachannel), RTCDataChannel (send for string/ArrayBuffer/ArrayBufferView/Blob, close, readyState, bufferedAmount(+LowThreshold), binaryType, id/label/ordered/protocol/negotiated/maxPacketLifeTime/maxRetransmits; events open/close/message/error/bufferedamountlow/closing), RTCSessionDescription (Gst↔JS round-trip via GstSDP), RTCIceCandidate (W3C fields + candidate-line parser), RTCError/RTCErrorEvent/RTCPeerConnectionIceEvent/RTCDataChannelEvent.

**Implemented (Phase 2 / 2.5 — media surface + incoming pipeline):** addTransceiver (real GstWebRTC transceivers), getSenders/getReceivers/getTransceivers, removeTrack, `track` event (RTCTrackEvent on pad-added), RTCRtpTransceiver (mid, direction read/write, currentDirection, stop, setCodecPreferences), RTCRtpSender (track, dtmf, transport, get/setParameters, replaceTrack, getCapabilities), RTCRtpReceiver (track, muted→unmuted via the Vala ReceiverBridge — decodebin's streaming-thread `pad-added` handled entirely in C, jitterBufferTarget), MediaStream/MediaStreamTrack/MediaStreamTrackEvent, pipeline cleanup on close().

**Implemented (Phase 3 — outgoing media + getUserMedia):** addTrack wires the outgoing pipeline via request_pad_simple (source → valve → audioconvert/videoconvert → opusenc/vp8enc → payloader → capsfilter → webrtcbin); getUserMedia wraps GStreamer sources with graceful fallback chains (pipewiresrc → pulsesrc → autoaudiosrc → audiotestsrc; pipewiresrc → v4l2src → autovideosrc → videotestsrc); MediaDevices (getUserMedia, enumerateDevices stub, getSupportedConstraints); `enabled`→valve.drop, `stop()`→NULL+dispose; replaceTrack with atomic source swap; capsfilter ensures createOffer generates m= lines immediately. Single-PC-per-track (multi-PC fan-out via tee deferred).

**Implemented (Phase 4 — stats & advanced):** getStats() (`get-stats` signal → GstStructure → RTCStatsReport via `gst-stats-parser.ts`; selector validation with `InvalidAccessError`; sender/receiver delegation), restartIce(), setConfiguration() (rejects immutable fields with `InvalidModificationError`), RTCDTMFSender (full spec tone insertion — validation, duration/interToneGap clamping, `tonechange`, comma delay; tested against WPT), RTCCertificate (generateCertificate with W3C 30-day expiry; the actual DTLS cert is GStreamer-internal), RTCDtlsTransport/RTCIceTransport/RTCSctpTransport thin proxies.

**Still deferred (post-Phase 4):** `icecandidateerror` event (needs webrtcbin ICE-failure signal mapping); `peerIdentity`/`getIdentityAssertion` (identity-provider integration not planned); `setLocalDescription()` without an explicit argument (callers must pass an `RTCSessionDescriptionInit` — the one current deviation from the W3C spec); MediaStreamTrack constraints (`applyConstraints`/`getConstraints`/per-device `getCapabilities`); `enumerateDevices` with the GStreamer Device Monitor; multi-PC-per-track fan-out via the tee multiplexer.

**Spec behaviour verified against WPT:** RTCDataChannel.binaryType defaults to `'arraybuffer'` — that IS the W3C default (§6.2), distinct from WebSocket's `'blob'`; invalid assignments are silently ignored per WPT (matches Firefox/Chrome/Safari). Setting `binaryType` to `'blob'` requires `globalThis.Blob` (via `@gjsify/buffer/register`), else the setter throws `NotSupportedError`.

**How the GJS streaming-thread issue is solved:** webrtcbin emits its signals (and `Gst.Promise` change_func callbacks) from GStreamer's internal streaming thread, and GJS/SpiderMonkey blocks any JS callback invoked from a non-main thread. An in-JS `GLib.idle_add` cannot help because the callback body itself never runs. `@gjsify/webrtc-native` solves it C-side: the three Vala bridges connect to the underlying signals, capture their args, and re-emit mirror signals on the main GLib context via `GLib.Idle.add()`. Two subtleties: incoming data channels are wrapped in a `DataChannelBridge` ON the streaming thread before the idle hop (else the first messages race the JS-side setup and get dropped), and the `GstWebRTCDataChannelState` C enum is 1-based while the generated TS declaration infers 0-based — `RTCDataChannel` maps against the real runtime values.

**System prerequisites:** GStreamer ≥ 1.20 with **gst-plugins-bad** (webrtcbin) AND **libnice-gstreamer** (ICE transport — state-change to PLAYING fails without it). Fedora: `dnf install gstreamer1-plugins-bad-free gstreamer1-plugins-bad-free-extras libnice-gstreamer1`; Debian/Ubuntu: `apt install gstreamer1.0-plugins-bad gstreamer1.0-nice`; verify with `gst-inspect-1.0 webrtcbin && gst-inspect-1.0 nicesrc`. Tests that exercise webrtcbin auto-skip with a clear message when the nice plugin is missing; the platform-agnostic cases (RTCSessionDescription, RTCIceCandidate parsing, register wiring) run regardless.

---

## Browser UI / Adwaita Packages (`packages/web/adwaita*`)

### Fully implemented (5)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **adwaita-core** | — | 5 specs · 67 it() | Headless Adwaita widget behavior (ADR 0004) — pure TS, NO platform imports, all-runtime `polyfill`, no `/register`; the machine-checked `gjsify.headless: true` contract (ADR 0015). Breakpoint condition grammar/parser/evaluator + transition-only `AdwBreakpoint` state machine; light/dark color-scheme observable + default icon-fg constants; toast queue (`AdwToast` + `AdwToastQueue` with injected `ToastScheduler` timing seam); alert-dialog response model (`AdwAlertResponses` — registry, appearance/enabled, OK/cancel/neutral ordering, action-sheet threshold, resolve-to-chosen-id); row interaction state machines (`ExpanderState`/`ComboState`/`SpinState`/`ToggleGroupState` with per-instance subscribe seams + interactive-vs-programmatic tagging). Re-exported by `@gjsify/adwaita-nativescript` (no consumer break); `adwaita-web` adopts opportunistically. |
| **adwaita-fonts** | — | — | Adwaita Sans font files (fontsource-style): `@font-face` CSS + TTFs. Sourced from `refs/adwaita-fonts/`, SIL OFL 1.1. |
| **adwaita-icons** | — | — | Adwaita symbolic icons as importable SVG strings (actions, devices, mimetypes, places, status, ui, …) + `toDataUri()` helper. Sourced from `refs/adwaita-icon-theme/`, CC0-1.0 / LGPLv3. |
| **adwaita-storybook** | — | — | Browser storybook renderer for the `@gjsify/stories` contract — renders the same stories as the GTK (`@gjsify/storybook`) and NativeScript (`@gjsify/storybook-nativescript`) renderers in an `@gjsify/adwaita-web` component browser, so the three targets screenshot-compare 1:1. Composes `@gjsify/storybook-core` for registry/controls/controller logic and exposes the same devtools/MCP surface. |
| **adwaita-web** | — | 9 specs · 69 it() | Browser Adwaita components (Custom Elements, light DOM; SCSS partials mirroring `refs/adwaita-web/scss/`, compiled to `dist/adwaita-web.css` via sass; light/dark via CSS variables; style-isolation boundary reset per ADR 0010). Widgets: AdwWindow, AdwHeaderBar, AdwPreferencesGroup, AdwCard, AdwSwitchRow, AdwComboRow, AdwSpinRow, AdwToastOverlay, AdwOverlaySplitView; nav/shell trio AdwViewStack + AdwViewSwitcherBar + AdwMenuButton (Learn6502 web rewrite); dialogs AdwAboutDialog/AdwAlertDialog/AdwPreferencesDialog + generic adaptive AdwDialog; controls AdwButton, AdwEntry, AdwToggleGroup, AdwSplitButton, AdwDropDown; AdwDataGrid (aligned numeric grid for tabular financial data — CSS-subgrid alignment, accounting row variants, `row-activated`; the web mirror of a native Gtk.Grid, deliberately NOT a sortable ColumnView); opt-in `@gjsify/adwaita-web/source-view` subpath: AdwSourceView, a CodeMirror-6 GtkSourceView twin (6502 assembly StreamLanguage, hex-address gutter mode, Adwaita light/dark theme, copy-without-spaces, `code-changed`). Port roadmap: see the Adwaita Web roadmap section below. |

### Adwaita Web framework roadmap

Long-term goal: complete `@gjsify/adwaita-web` so it can replace the styling layer of `refs/adwaita-web/scss/` while keeping our Web Components abstraction. Planned port order (each adds a custom element + SCSS partial + AGENTS attribution; each port must add a SPDX header citing `refs/adwaita-web/adwaita-web/scss/_<name>.scss` and/or `refs/libadwaita/src/stylesheet/widgets/_<name>.scss`):

| Status | Component | Source partial |
|---|---|---|
| ✅ Done | `<adw-window>`, `<adw-header-bar>`, `<adw-preferences-group>`, `<adw-card>`, `<adw-switch-row>`, `<adw-combo-row>`, `<adw-spin-row>`, `<adw-toast-overlay>`, `<adw-overlay-split-view>` | `_window.scss`, `_headerbar.scss`, `_preferences.scss`, `_card.scss`, `_switch_row.scss`, `_combo_row.scss`, `_spin_button.scss`, `_toast.scss`, (libadwaita C source) |
| ✅ Done | `<adw-view-stack>`, `<adw-view-switcher-bar>`, `<adw-menu-button>` (phone-shell nav/shell trio for the Learn6502 web rewrite) | `_view_stack.scss`, `_view_switcher_bar.scss`, `_menu_button.scss` |
| ✅ Done | `<adw-source-view>` — CodeMirror-6 editor at the opt-in subpath `@gjsify/adwaita-web/source-view` | self-injected CSS + CodeMirror theme (no SCSS partial) |
| ✅ Done | `<adw-data-grid>` — slim aligned numeric grid for tabular financial data | `_data_grid.scss` |
| ✅ Done | `<adw-dialog>` (generic adaptive dialog) + `<adw-drop-down>` (standalone `Gtk.DropDown` mirror) | `_dialog.scss`, `_drop_down.scss` |
| Planned | `<adw-button>` (flat / suggested / destructive) | `_button.scss`, `_button_row.scss` |
| Planned | `<adw-entry>` / `<adw-entry-row>` | `_entry.scss`, `_entry_row.scss` |
| Planned | `<adw-action-row>` | `_action_row.scss` |
| Planned | `<adw-checkbox>` / `<adw-radio>` | `_checkbox.scss`, `_radio.scss` |
| Planned | `<adw-popover>` | `_popover.scss` |
| Planned | `<adw-banner>` / `<adw-bottom-sheet>` | `_banner.scss`, `_bottom_sheet.scss` |
| Planned | `<adw-tabs>` / `<adw-view-switcher>` | `_tabs.scss`, `_viewswitcher.scss` |
| Planned | `<adw-progress-bar>` / `<adw-spinner>` | `_progressbar.scss`, `_spinner.scss` |
| Planned | `<adw-status-page>` | `_status_page.scss` |
| Planned | `<adw-toggle-group>` / `<adw-split-button>` | `_toggle_group.scss`, `_split_button.scss` |
| Planned | `<adw-expander-row>` / `<adw-carousel>` | `_expander_row.scss`, `_carousel_indicators.scss` |
| Planned | `<adw-avatar>` / `<adw-label>` / `<adw-icon>` | `_avatar.scss`, `_label.scss`, `_icon.scss` |
| Planned | Utility classes & layout helpers | `_box.scss`, `_wrap_box.scss`, `_listbox.scss`, `_toolbar_view.scss`, `_utility_classes.scss` |

---

## DOM Packages (`packages/dom/`)

### Fully implemented (2)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **canvas2d-core** | cairo, gdk-4.0, gdkpixbuf, gio, glib, pango, pangocairo | 9 specs · 99 it() | Headless CanvasRenderingContext2D (HSL/HSLA color parsing, shadowBlur approximation, drawImage paint+clip, composite operations), CanvasGradient, CanvasPattern, Path2D, ImageData, color parser — NO GTK dependency in the root entry (machine-checked `gjsify.headless: ["Gdk","GdkPixbuf","Gsk","Gtk","Adw"]`, ADR 0015). Pixel-interop seam (`src/pixel-bridge.ts`): pixel ops call an injected `CanvasPixelBridge`; the GDK-backed impl is the side-effect subpath `@gjsify/canvas2d-core/gdk` (the package's only `gi://Gdk` file), imported by `@gjsify/dom-elements/register/canvas` and `@gjsify/canvas2d`. Unregistered + a pixel op → a TypeError naming the subpath, never silent blank pixels. Extracted from `@gjsify/canvas2d` to break the dom-elements↔canvas2d cycle. 578/578 suite green on node/bun/deno via node-gi. |
| **dom-elements** | gdkpixbuf-2.0, gio-2.0, glib-2.0, gst-1.0, pangocairo-1.0 | 5 specs · 175 it() | Node (ownerDocument→document, event bubbling), Element (setPointerCapture/releasePointerCapture/hasPointerCapture, `_onResize` + allocation cache), HTMLElement (getBoundingClientRect, dataset/DOMStringMap; clientWidth/clientHeight/offsetWidth/offsetHeight/scrollWidth/scrollHeight return the cached GTK allocation written by `notifyElementResize()` — fixes Excalibur.js `Screen.FillContainer` reading 0), HTMLCanvasElement (auto-registers the `'2d'` context factory via `@gjsify/canvas2d-core`), HTMLImageElement (data: URIs), HTMLMediaElement/HTMLVideoElement, Image, Document, Text, Comment, DocumentFragment, DOMTokenList, MutationObserver, ResizeObserver (real impl wired into the bridges' GTK resize signal; fires on target + ancestors), IntersectionObserver, Attr, NamedNodeMap, NodeList. Auto-registers the browser-global surface (`document`, `Image`, `HTMLCanvasElement`, `self`, `devicePixelRatio`, scroll offsets, `alert`, fetch family) on import. |

---

## Framework Packages (`packages/framework/`)

### Fully implemented (15)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **adwaita-app** | adw-1, gdk-4.0, gio-2.0, gobject-2.0, gtk-4.0 | 3 specs · 14 it() | Native Adwaita application shell (ADR 0009) — `runAdwaitaApp(options)` + `AdwaitaApp` base (runAsync lifecycle, DEFAULT_FLAGS, get-or-create window, startup CSS, env-gated `installDevtools`, `app.quit`/`app.about`), `createNavShell` (NavigationSplitView + sidebar + content stack + breakpoint, data-driven from `NavItem[]`), `LoadToken` + `loadIntoStack` async-view mounter, `confirmDialog`/`errorDialog`, toast helpers, `pickFile`/`saveFile`, `readAppDevHooks`. Ships the first reusable widget `LoadingStack` + its storybook story. Adoption in storybook/buchhaltung/eco-retrofit tracked in Open TODOs. |
| **bridge-types** | — | — | DOMBridgeContainer (interface), BridgeEnvironment (isolated document+body+window per bridge), BridgeWindow (rAF, performance.now, viewport). |
| **canvas2d** | cairo, gdk-4.0, glib-2.0, gobject, gtk-4.0 | 2 specs · 82 it() | Re-exports `@gjsify/canvas2d-core` + FontFace (pixel-perfect font rendering via PangoCairo) + `Canvas2DBridge` → Gtk.DrawingArea GTK widget. Supplies the headless core's injected pixel bridge explicitly (`@gjsify/canvas2d-core/gdk`). Ships `/register` for `ImageData` + `Path2D` (ADR 0012). 191/191 suite green on node via node-gi. |
| **devtools** | gdk-4.0, gio-2.0, glib-2.0, graphene-1.0, gtk-4.0 | 2 specs · 19 it() | In-app DBus devtools control plane for GTK/GJS apps: `installDevtools(app, opts?)` (startup-time, env-gated by `GJSIFY_DEVTOOLS`, prod-safe no-op) exports iface `org.gjsify.Devtools`. Methods: Screenshot (PNG via `captureWidgetPng`), DumpTree/GetProperty/GetFocused/ListToplevels, ActivateWidget (click-drive by path incl. GtkListBox row activation), GetStatus, ListActions/ActivateAction/ChangeActionState, ResizeWindow/PresentWindow, DumpCss/SwapCss, DumpGSettings. Routes through the transport-agnostic `@gjsify/devtools-protocol` MethodRegistry; `opts.extend` adds app-specific methods. Consumed by `gjsify debug` + the adwaita-storybook showcase. |
| **devtools-browser** | adw-1, gio-2.0, glib-2.0, gobject-2.0, gtk-4.0 | 2 specs · 15 it() | Browser-side devtools adapter over the shared `@gjsify/devtools-protocol` MethodRegistry. Tier 3. |
| **devtools-cdp** | — | 4 specs · 46 it() | `InspectorProtocolClient` over a WebKit remote inspector (CDP-shaped JSON-RPC over a per-target WebSocket). Validated against a live inspector by the opt-in `devtools-cdp` integration suite. Tier 3. |
| **devtools-mcp** | gio-2.0, giounix-2.0, glib-2.0, soup-3.0 | 2 specs · 9 it() | Host-side MCP bridge — `runDevtoolsMcp(profile)` with profiles `storybookProfile`/`browserProfile`/`cdpProfile`/`nativescriptProfile`; the backend of `gjsify debug` (stdout = MCP channel, logs → stderr). The Tier-3 CDP profile is a lazy-loaded optional peer, so its walked deps stay Tier ≤ 2. |
| **devtools-protocol** | — | 2 specs · 13 it() | Transport-agnostic `MethodRegistry` + generic method contract — pure TS, shared by the GTK (`@gjsify/devtools`), NativeScript (`@gjsify/devtools-nativescript`) and browser (`@gjsify/devtools-browser`) adapters. |
| **event-bridge** | gdk-4.0, gtk-4.0 | 1 specs · 4 it() | GTK→DOM event bridge: `attachEventControllers()` maps GTK4 controllers (EventControllerMotion/GestureClick/EventControllerScroll/EventControllerKey/EventControllerFocus) → DOM Mouse/Pointer/Keyboard/Wheel/FocusEvent, incl. window-level keyboard listeners; ~80 Gdk keyvals mapped to DOM key/code. |
| **iframe** | gio-2.0, glib-2.0, gobject, javascriptcore-6.0, webkit-6.0 | 7 specs · 97 it() | HTMLIFrameElement, IFrameBridge → WebKit.WebView, postMessage bridge, navigation (loadUri/loadHtml/goBack/goForward/reload + canGoBack/canGoForward). Ships `/register` for `HTMLIFrameElement` + the `'iframe'` element factory (ADR 0012 — WebKit stays an optional system dep). |
| **stories** | — | 1 specs · 6 it() | Story-authoring contract: `ControlType`, discriminated-union `StoryControl`, `StoryArgs`/`StoryMeta`, generic `StoryModule`/`StoryComponentConstructor`/`StoryDecorator`, `argsFromControls`, `isStoryModule`. Pure TS, all-`polyfill` on every runtime — the shared vocabulary the GTK + browser + NativeScript renderers and `@gjsify/storybook-core` consume. |
| **storybook** | adw-1, gdk-4.0, gio-2.0, glib-2.0, gobject-2.0, gtk-4.0 | 3 specs · 15 it() | GTK/Adwaita renderer for the `@gjsify/stories` contract: `StoryWidget` base (Adw.Bin, programmatic chrome, `fromMeta()`/`addContent()`/`initialize()`/`updateArgs()`/`teardown()`), `StoryRegistryService` (no singleton), `StorybookWindow` (sidebar-by-category + 6 live-bound control kinds; no `.blp` so it builds under `--library`), `StorybookApplication`, `runStorybook()` + `collectStoryModules()`, `withActionGroup` decorator. Launched via `gjsify storybook` (auto-discovers `*.story.ts`, builds `--app gjs`, runs); `--runtime node` builds the same storybook `--app node` and runs it on Node via `@gjsify/node-gi`. Self-verify probe `installStorybookProbe` (env `GJSIFY_STORYBOOK_PROBE`) drives a running storybook headlessly in-process. |
| **storybook-core** | — | 5 specs · 51 it() | Renderer-agnostic storybook logic shared by the GTK, browser and NativeScript renderers — pure TS, all-`polyfill`. `StoryViewBase<TNode>` (meta/story/args surface + chrome seam), generic `StoryRegistry<TInstance>` (per-run instance reset so a second mount never reuses stale parented views), `bindControl` (all per-kind coercion — the leaf-widget factory is the only renderer seam), `StorybookController`/`StorybookView` (mount/select/refresh state machine, category grouping, the `listStories`/`openStoryByTitle`/`getCurrentStory`/`setActiveArg` MCP surface), `collectStoryModules`, `buildStorybookDevtoolsExtension`. Re-exports the `@gjsify/stories` contract. |
| **video** | gdk-4.0, glib-2.0, gobject, gst-1.0, gtk-4.0 | — | HTMLVideoElement, VideoBridge → Gtk.Picture (gtk4paintablesink). srcObject (MediaStream from getUserMedia/WebRTC) + src (URI via playbin). Phase 1. |
| **webgl** | gdk-4.0, gdkpixbuf-2.0, glib-2.0, gobject, gtk-4.0, gwebgl-0.1 | 12 specs · 297 it() | WebGLRenderingContext (1.0), WebGL2RenderingContext (2.0 — overrides texImage2D/texSubImage2D/drawElements for GLES3.2 compat, native FBO completeness delegation, GLSL 1.0 compat for versionless shaders, clearBufferfv/iv/uiv/fi, premultipliedAlpha), HTMLCanvasElement (GTK-backed), WebGLBridge (Gtk.GLArea subclass, rAF, resize re-render, eager context init), extensions — via the gwebgl Vala bridge (prebuild). Context methods split into focused `src/ts/context/` modules with prototype-merge install functions. Ships `/register` for the WebGL context classes (ADR 0012). Deferred items: see the WebGL known-issues section below. |

### WebGL known issues

Issues discovered while porting Three.js demos. Non-fatal but should be addressed for full compatibility.

| Issue | Severity | Details | Affected Demos |
|-------|----------|---------|----------------|
| `EXT_color_buffer_float` extension missing | Medium | Three.js requests this extension for `HalfFloatType` render targets. Not implemented in the extension registry. Rendering works but with fallback quality. | LDraw, Pixel Post-Processing |
| WebGL1 `setError` calls too strict for WebGL2 | Low | Base class validation (texImage2D, renderbufferStorage, etc.) uses WebGL1 format/type rules. WebGL2 allows more combinations (R8, RG8, RGBA16F, DEPTH_COMPONENT24, etc.). Non-fatal — native GL still executes the calls. | All WebGL2 demos |
| WebGL1 framebuffer color attachment validation too strict | Low | Base `_preCheckFramebufferStatus` only accepts RGBA/UNSIGNED_BYTE or RGBA/FLOAT. WebGL2 override delegates to the native driver. WebGL1 with extensions (OES_texture_half_float) still rejects valid formats. | Post-processing with WebGL1 |

### Missing Web APIs

Not yet implemented (but potentially relevant for GJS projects):

| API | Priority | Notes |
|-----|----------|-------|
| **URL/URLSearchParams (global)** | Low | Exists in @gjsify/url, missing as global export |
| **Blob/File (global)** | Low | Partially native in GJS; globals package could re-export |
| **structuredClone** | Low | Natively available in SpiderMonkey — expose as global (see Upstream GJS Patch Candidates) |
| **Performance (global)** | Low | @gjsify/perf_hooks exists; Web export missing |

---

## NativeScript Bridge Packages (`packages/nativescript-bridge/`)

### Fully implemented (5)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **adwaita-nativescript** | — | 1 specs · 60 it() | Design-identity axis 4 — 42 native Adwaita widgets for NativeScript (real StackLayout/GridLayout/ScrollView/Switch/TextField/Button/Slider + native `action()`/`confirm()` dialogs, NOT a webview), parallel to `@gjsify/adwaita-web`: the full Libadwaita storybook set — faithful rows/chrome (PreferencesPage/Group, Action/Switch/Entry/PasswordEntry/Combo/Spin/Slider/Expander/Button rows, HeaderBar, ToolbarView, Avatar, Banner, Clamp, SplitButton, ToggleGroup, ImageButton/MenuButton/Icon/ButtonContent with REAL rasterised Adwaita symbolic icons via `androidx.core.graphics.PathParser`), approximated view-switching (ViewSwitcher/InlineViewSwitcher/TabView/Carousel), the decoupled phone shell (ViewStack + bottom ViewSwitcherBar), navigation (NavigationView, Navigation/OverlaySplitView driven by `AdwBreakpoint` off the live window width, slide + scrim via native `View.animate()`), feedback/dialogs (Toast/ToastOverlay, AlertDialog via native confirm()/action(), About/PreferencesDialog overlays). Shared headless behavior (breakpoints, color scheme, toast queue, alert responses, row state machines) lives in `@gjsify/adwaita-core` (ADR 0004) and is re-exported. Static `theme/adwaita.css` (NS CSS subset, light + `.ns-dark`), Adwaita Sans via `@gjsify/adwaita-fonts`, `@nativescript/core` optional peer with ambient `src/ns-core.d.ts`. Widget-by-widget detail incl. the CSS-subset compromises: AGENTS.md § NativeScript Bridge. |
| **devtools-nativescript** | — | 1 specs · 6 it() | In-app devtools agent — the NS analogue of `@gjsify/devtools` (GTK). `installDevtools({ application, frame })` (env-gated `GJSIFY_DEVTOOLS`) attaches `globalThis.__adwDevtools.dispatch(reqJson)` routing through the same `@gjsify/devtools-protocol` MethodRegistry; GetStatus/ListToplevels/DumpTree/GetProperty walk the NS view tree via `view.eachChildView()`; Screenshot rasterises the root view → base64 PNG (Android tested, iOS variant untested); reached by the host `@gjsify/devtools-mcp` `nativescriptProfile` over the V8 CDP inspector. |
| **native-fs-bridge** | — | 1 specs · 7 it() | `readFile`, `writeFile`, `readdir`, `stat`, `mkdir`, `unlink`, `exists` via `java.io.File` (Android) + `NSFileManager` (iOS). Spec tests run on GJS + Node off-device via the `assertNativeScript()` guard. |
| **native-platform** | — | 1 specs · 5 it() | `isAndroid`/`isIOS`/`isNativeScript`, `assertNativeScript()`, `platformInfo()` (OS version, SDK level, device model, manufacturer) via `android.os.Build` + `UIDevice`. Keyed on runtime globals only — no `@nativescript/core` value import. |
| **storybook-nativescript** | — | 1 specs · 4 it() | NativeScript renderer for the `@gjsify/stories` contract — renders the SAME stories as the GTK + browser renderers in a native Adwaita component browser built from `@gjsify/adwaita-nativescript` widgets, so the three targets screenshot-compare 1:1. `StoryView` (NS twin of StoryElement/StoryWidget, identical authoring surface), `createControlRow` (per-kind live two-way-bound Adwaita rows), adaptive `AdwNavigationSplitView` shell driven by `AdwBreakpoint` (`max-width: 720sp` — the same condition as the GTK storybook), same MCP/devtools control surface, OS color-scheme seeding at mount. Layout/theming detail: AGENTS.md § NativeScript Bridge. |

---

## GJS Infrastructure (`packages/gjs/`)

### Fully implemented (3)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **runtime** | — | — | Platform-independent runtime detection (isGJS, isNode, runtimeName). |
| **unit** | glib-2.0 | 4 specs · 129 it() | Test framework (describe/it/expect, cross-platform Node+GJS+browser) + vitest-compat surface (`vi.fn`/`stubGlobal`/`stubEnv`, `toMatchObject`/`toBeNaN`/`toHaveBeenCalled*`, `expect().rejects.toThrow`/`.resolves.toResolve`), `browserSignalDone` for the Playwright axis, fail-count isolation (a leaked late assertion becomes a distinct stray, never poisons a bystander `it()`). |
| **utils** | gio-2.0, giounix-2.0, glib-2.0 | 3 specs · 16 it() | Shared GJS utilities: Gio wrappers, process info, encoding, `ensureMainLoop`/`quitMainLoop`, structuredClone polyfill, `installCriticalLogWriter`. Two entry points per ADR 0014: `@gjsify/utils/core` is the cross-runtime half (makeCallable, deferEmit, gio-errors errno table, registerGlobal, queueMicrotask, nextTick, …) that polyfill/partial-slot packages MUST import; the barrel adds the six GJS-only modules (byte-array, cli, file, fs, gio, path). |

---

## Build Infrastructure (`packages/infra/`)

### Fully implemented (17)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **cli** | adw, giounix-2.0, gtk, soup-3.0 | 49 specs · 592 it() | The `gjsify` CLI: build (Rolldown engine, `--app gjs\|node\|browser\|nativescript`, `--library`), run, install (native backend, lockfile, `--immutable`), dlx, foreach/workspace/run orchestration with the per-package build cache (ADR 0006), test runner, lint/format/fix (oxc), tsc, check, create-app scaffolding, showcase, storybook, debug (MCP↔devtools bridge), flatpak subcommands, publish/whoami/login/logout/trust/onboard, affected (selective-CI classifier), self-update, upgrade. Ships the committed GJS bundles `dist/cli.gjs.mjs` + `dist/affected.gjs.mjs` (freshness-gated in CI). |
| **create-app** | — | — | `gjsify create-app` scaffolding — project templates (incl. the Adwaita/canvas templates) with `--globals` default wiring and `@gjsify/{node,web}-polyfills` so any `node:*`/Web import resolves out of the box. |
| **empty** | — | — | Stub module for platform exclusion (`export default {}`). Every remaining browser-alias use of it carries an (A)/(A')/(B)/(C) classification tag — an untagged `@gjsify/empty` alias is a bug (see AGENTS.md cross-runtime rules). |
| **nativescript-vite** | — | — | Vite-8 composer for NativeScript apps: `defineNativescriptConfig()` loads `@nativescript/vite`'s config and fixes the Vite-8/Rolldown incompatibilities at compose time (major-gated: function-alias drop, `@rollup/plugin-commonjs` removal, ns-typescript-check strip), stubs missing framework peers via Node synchronous hooks, applies the SBG bundle-sync fix (stable chunk names + `emptyOutDir`), then spreads `gjsifyNativescript()`. Only hard dep: `@gjsify/vite-plugin-gjsify`. |
| **npm-registry** | — | 2 specs · 44 it() | fetchPackument (+conditional ETag revalidation), fetchTarball with sha512 SRI verification, parseNpmrc (registries, scoped overrides, `_authToken`, basic auth, env expansion), nerf-dart auth-host normalization, longest-prefix Authorization resolution. Cross-platform via `globalThis.fetch` + `crypto.subtle`. |
| **oxfmt-native** | gjsifyoxfmt | — | Vala+Rust cdylib GI bridge to oxc's formatter — the Node-free engine behind `gjsify format`/`fix` under GJS (npm `oxfmt` is a Rust napi binary GJS cannot load). Links the pure-Rust oxfmt CLI core via Cargo path-deps into `refs/oxc`, pinned in lockstep with the npm `oxfmt` devDep (`refs-pin` + `refsLockstep` machine-checked). `Formatter.run(args)` = the full CLI in-process (.oxfmtrc/.editorconfig resolution, ignore handling, --write/--check/--list-different) + single-shot `Formatter.format()`. Not covered (napi-only upstream): the Prettier ExternalFormatter (CSS/HTML/Vue/Markdown), `.oxfmtrc.ts`, --init/--migrate, LSP + stdin. |
| **resolve-npm** | — | — | Central alias registry: the curated `ALIASES_*` tables per target, the globals map (`GJS_GLOBALS_MAP`/groups/METHOD_MARKERS closure data), derived runtime-slot routing (`withDerivedSlotRouting` composing `package.json#gjsify.runtimes` under the curated baseline), the pnp-relay helper, and the committed register-globals closure map. Plain `lib/*.mjs`, no build. |
| **rolldown-native** | gjsifyrolldown-1.0, glib-2.0, gobject-2.0 | — | Vala+Rust cdylib bridge to rolldown — the DEFAULT bundler engine under GJS (npm rolldown is a Rust N-API addon GJS cannot load; `bundler-pick.ts` selects native under GJS, npm under Node, `GJSIFY_BUNDLER` override). Wraps `rolldown::Bundler::generate()` in a per-call current-thread tokio runtime, JSON options/output at the FFI boundary; `bundleWithPlugins()` drives a `BundlerSession` GObject running all 12 rolldown hook positions, so gjsify's full JS plugin set runs on the native engine; `runNativeBundle` replicates npm rolldown's `.write()` incl. nested chunk/asset dirs. Built from the `refs/rolldown` submodule via cargo path-dep, pinned in exact lockstep with the npm `rolldown` devDep (`check-refs-pin.mjs`). Portable anonymous-pipe wakeup channel (darwin-ready); still Linux-only in `gjsify.platforms` until the prebuilds.yml darwin leg lands (see Open TODOs). No watch/HMR (`--watch` needs npm rolldown under Node) and no incremental builds. |
| **rolldown-plugin-gjsify** | adw-1, gio-2.0, giounix, gtk-4.0 | — | Platform orchestration for `gjsify build`: the `--app gjs\|node\|browser\|nativescript` target factories, externals policy, alias plugin, auto-globals detection (acorn on post-tree-shake output), process-stub/wellknown-symbols banner, css-as-string (lightningcss), text/dataurl loaders, blueprint composition, `gjsGiNodePlugin` (gi://→node-gi rewrite), `napiNodeAddonPlugin` (transparent `.node` addon loading), unresolved-workspace-import guard, gjs/node bundle guards, platform-resolve + platform-defines for NativeScript, `./runtime` host-detection subpath. |
| **rolldown-plugin-pnp** | — | — | Yarn PnP resolver + relay through the polyfill meta-packages (`getPnpPlugin` with `transformContentsFactory`), so external consumers under PnP resolve every transitive `@gjsify/*` register subpath without re-declaring them. |
| **semver** | — | 1 specs · 27 it() | Pure-JS subset of node-semver: SemVer, Range, satisfies, maxSatisfying, minSatisfying, validRange; caret/tilde/hyphen/x/star ranges, OR sets, prerelease comparison, npm prerelease-range gating. |
| **tar** | — | 1 specs · 10 it() | Streaming `.tar`/`.tar.gz` reader: ustar headers + PAX extended (path/linkpath/size), GNU long-name (L) + long-link (K), checksum-validated. `extractTarball()` strips the npm `package/` prefix, preserves modes, creates symlinks, refuses entries escaping destDir. |
| **tsc** | — | 1 specs · 4 it() | Bundled-toolchain axis exemplar: upstream `typescript`'s `_tsc.js` CLI wrapped into a committed GJS bundle (`dist/tsc.gjs.mjs`, `gjsify-tsc` bin) pinned to the workspace TS invariant (`TYPESCRIPT_VERSION`). The workspace SELF-HOSTS its type-checking (`check` = `gjsify tsc --noEmit`) and `.d.ts` emit (`build:types`) on it — byte-identical to node tsc, ~1.3× at full-workspace scale. Ships the ~108 version-locked `lib*.d.ts` (committed; `pickLibSource()` keep/refresh/error logic guards against a stale or partial installed `typescript`). |
| **vite-plugin-blueprint** | — | — | Compile `.blp` files via blueprint-compiler → XML string (Vite/Rollup/Rolldown; GJS + browser). `import T from './window.blp'` → string; types via `@gjsify/vite-plugin-blueprint/types`; output compressed via minify-xml. |
| **vite-plugin-gettext** | — | — | xgettext/msgfmt/po2json pipeline (Vite/Rollup/Rolldown). |
| **vite-plugin-gjsify** | — | — | Vite presets mirroring the `gjsify build` targets: `gjsifyBrowser()` (dev/HMR parity with `--app browser` — gi://→empty, polyfill aliases, browser conditions, opt-in css-as-string) and `gjsifyNativescript()` (platform file resolution, platform defines, xmlns-barrel registration, css-tree alias, node-builtin aliases). |
| **workspace** | — | 1 specs · 32 it() | Workspace discovery + topological orchestration library backing `gjsify foreach`/`workspace`/`run` (glob expansion, dependency-closure walks, script dispatch). |

### Proof-of-concept (3)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **lightningcss-native** | gjsifylightningcss-1.0, glib-2.0, gobject-2.0 | 1 specs · 13 it() | Vala+Rust cdylib bridge to lightningcss for GJS. `Engine.transform()` (in-memory CSS→CSS) + `Engine.bundle()` (entry file, resolves `@import` chains via lightningcss's FileProvider), browserslist queries accepted directly. Backs `cssAsStringPlugin` under `--app gjs` — `css-as-string` resolves + inlines bare-specifier `@import`s in JS first (its shared `cssBundleResolver`), then routes flattened CSS through `transform()` for the GTK4 lowering; npm `lightningcss` `bundleAsync` fallback when the prebuild is unavailable. One lazily-created stateless Engine reused across calls (pinned by its own GJS spec). POC scope: no source-map input, no css-modules, no analyze-dependencies. |
| **lightningcss-wasm** | — | — | WASM-track companion to `lightningcss-native`: vendors `lightningcss-wasm@1.32.0`'s NAPI-on-WASM bundle (15.8 MiB .wasm + napi-wasm runtime + asyncify helper). Pure-JS loader instantiates via SpiderMonkey's synchronous `new WebAssembly.{Module,Instance}`; no WASI shim required. Decision matrix: 3–5× slower than native on transforms, ~960× slower cold init — kept in tree as a fallback for unsupported architectures. |
| **rolldown-plugin-deepkit** | — | — | Deepkit TypeScript runtime reflection via `@deepkit/type-compiler` (`transform` hook, `order: 'pre'`, lazy-loaded). Opt-in only (`reflection: false` default) — it transforms TS `extends` method definitions into invalid syntax on non-Deepkit code, so it stays off unless a project uses Deepkit runtime types. |

---

## Runtime Engines (`packages/node-gi/`, `packages/napi/`)

### Fully implemented (3)

| Package | GNOME Libs | Tests (static) | Notes |
|---|---|---|---|
| **gtk-runtime-darwin-arm64** | — | — | Prebuilt GTK runtime data bundle for node-gi on macOS arm64 (darwin twin of the win32 bundle). |
| **gtk-runtime-win32-x64** | — | — | Batteries-included GTK runtime for node-gi windowing on Windows: `build-gtk-runtime.mjs --windowing` builds a superset of the display-free bundle carrying gdk-pixbuf loaders + `loaders.cache`, compiled GSettings schemas, Adwaita/hicolor icon themes + caches and Fontconfig; node-gi's loader wires the env off the `gschemas.compiled` marker. |
| **node-gi** | — | — | Axis-5 reverse bridge — GI/GObject runtime for Node: unchanged GJS/GObject-Introspection code runs under Node.js (and Bun/Deno from the same N-API binary). Headless core complete (marshalling incl. OUT/INOUT, toggle-ref GC dance, signals, `GObject.registerClass` incl. custom props/signals/vfuncs + chain-up, boxed/struct access, callbacks, mainloop with the uv-driven auto-pump so a bare `node bundle.mjs` drains Gio async work byte-identically to `gjs -m`); GTK/Cairo layer landed (Adwaita window realizes + renders via GSK; the full Libadwaita storybook renders on Linux + Windows via the `--windowing` GTK runtime bundle); GIMarshallingTests oracle 370 pass / 0 fail; graduated Tier 3→2 per ADR 0005 (2026-07-14), dependency-isolation invariant retained (devDep-only seam). 17 `@gjsify/*` packages run their own suites unchanged on it. Deferred limitations tracked in Open TODOs. |

### Partially implemented (1)

| Package | GNOME Libs | Tests (static) | Working | Missing |
|---|---|---|---|---|
| **napi** | — | — | Phase 0: full `js_native_api.h` surface + module loader/version/fatal — better-sqlite3 v13 runs unmodified inside GJS, byte-identical to Node, valgrind-clean; conformance oracle 13 pass / 8 ledgered / 0 fail. Phase 1: the tsfn surface (`napi_*_threadsafe_function` + `napi_make_callback` over a thread-safe idle GSource) — `@gjsify/node-gi` itself runs under the shim, byte-identical to native `gi://` across all 21 conformance programs (a CI test oracle, NOT a production path). Transparent `.node`→`loadAddon` build integration shipped (`napiNodeAddonPlugin`, always-on for `--app gjs`). Prebuilds: linux-x64 committed + darwin-arm64 CI-built (uploaded per release, `platformsUncommitted`). | Rest of the async/uv group loud-stubbed (async_work beyond the GThreadPool port, callback scopes, `napi_get_uv_event_loop`) — node-gi never calls it; deferred non-experimental stubs (`napi_*_bigint_words`, external strings, `napi_create_external_arraybuffer`); the 4 NAPI_EXPERIMENTAL conformance addons; win32 blocked at gjs-on-Windows (servo/mozjs MSVC prebuild exists, libgjs does not); macOS conformance/consumer/valgrind widening deferred; a tsfn claim nobody hands back still leaks its control block (~840 B, Node's own posture — see Open TODOs). |

---

## GNOME Library Usage

Derived from `gi://` imports in each package's sources (namespace + version where pinned):

| GNOME Namespace | Used In |
|---|---|
| **adw-1** | adwaita-app, devtools-browser, storybook, cli, rolldown-plugin-gjsify |
| **cairo** | canvas2d-core, canvas2d |
| **gda-6.0** | sqlite |
| **gdk-4.0** | canvas2d-core, adwaita-app, canvas2d, devtools, event-bridge, storybook, video, webgl |
| **gdkpixbuf-2.0** | canvas2d-core, dom-elements, webgl |
| **gio-2.0** | canvas2d-core, dom-elements, adwaita-app, devtools, devtools-browser, devtools-mcp, iframe, storybook, utils, rolldown-plugin-gjsify, child_process, dgram, dns, fs, http, http-soup-bridge, http2, module, net, os, tls, worker_threads, ws, zlib, fetch, webaudio, webcrypto, websocket |
| **giounix-2.0** | devtools-mcp, utils, cli, rolldown-plugin-gjsify |
| **gjsifyhttp2-1.0** | http2-native |
| **gjsifyhttpsoupbridge-1.0** | http-soup-bridge |
| **gjsifylightningcss-1.0** | lightningcss-native |
| **gjsifyoxfmt** | oxfmt-native |
| **gjsifyrolldown-1.0** | rolldown-native |
| **gjsifywebrtc-0.1** | webrtc-native |
| **glib-2.0** | canvas2d-core, dom-elements, canvas2d, devtools, devtools-browser, devtools-mcp, iframe, storybook, video, webgl, unit, utils, lightningcss-native, rolldown-native, child_process, crypto, dgram, dns, fs, node-globals, http, http-soup-bridge, http2, http2-native, module, net, os, tls, tty, url, v8, worker_threads, ws, zlib, fetch, webaudio, webcrypto, webrtc, websocket, xmlhttprequest |
| **gmodule-2.0** | http-soup-bridge |
| **gobject-2.0** | adwaita-app, canvas2d, devtools-browser, iframe, storybook, video, webgl, lightningcss-native, rolldown-native, http-soup-bridge, http2, http2-native, sqlite, webrtc |
| **graphene-1.0** | devtools |
| **gst-1.0** | dom-elements, video, webaudio, webrtc |
| **gstapp-1.0** | webaudio |
| **gstsdp-1.0** | webrtc |
| **gstwebrtc-1.0** | webrtc |
| **gtk-4.0** | adwaita-app, canvas2d, devtools, devtools-browser, event-bridge, storybook, video, webgl, cli, rolldown-plugin-gjsify |
| **gwebgl-0.1** | webgl |
| **javascriptcore-6.0** | iframe |
| **manette-0.2** | gamepad |
| **pango** | canvas2d-core |
| **pangocairo-1.0** | canvas2d-core, dom-elements |
| **soup-3.0** | devtools-mcp, cli, http, http-soup-bridge, http2, ws, fetch, websocket |
| **webkit-6.0** | iframe |

---

## Metrics

All derived at generation time — none of these numbers is maintained by hand.

| Metric | Value |
|---|---|
| Packages under `packages/` | 123 published + 4 private |
| Node.js pillar | 48 (41 APIs + 5 native bridges + 2 meta) |
| Web pillar | 26 (19 APIs + 1 native bridge + 1 meta + 5 Adwaita) |
| DOM pillar | 2 |
| Framework pillar | 15 |
| NativeScript bridges | 5 |
| GJS infrastructure | 3 |
| Build/Infra tools | 20 published + 2 private (internal, documented in AGENTS.md) |
| Runtime engines (node-gi / napi) | 4 |
| Spec files (static count, `packages/**/src`) | 303 |
| `it()` call sites (static count — not runtime totals; CI is the gate for those) | 8000 |
| Packages with a browser test entry (`src/test.browser.mts`) | 52 (canvas2d-core, dom-elements, stories, storybook-core, assert, async_hooks, buffer, console, constants, crypto, diagnostics_channel, dns, domain, events, fs, http, https, module, os, path, perf_hooks, process, querystring, sqlite, stream, string_decoder, sys, timers, url, util, vm, worker_threads, zlib, abort-controller, adwaita-core, adwaita-web, compression-streams, dom-events, dom-exception, domparser, eventsource, fetch, formdata, gamepad, message-channel, web-streams, web-globals, webassembly, webcrypto, websocket, webstorage, xmlhttprequest) |
| Integration test suites (`tests/integration/*`) | 35 (acorn, autobahn, axios, chalk, chokidar, claude-agent-sdk, cosmiconfig, debug, deepkit-type-compiler, deltachat, devtools-cdp, dotenv, execa, fast-glob, gettext-parser, lightningcss, loro-crdt, mcp-inspector-cli, mcp-typescript-sdk, minify-xml, nativescript, oxfmt-native, pkg-types, rolldown-native, rollup-pluginutils, socket.io, streamx, tls-session, ts-for-gir, typescript-tsc, undici, webtorrent, worker-stress, yargs, yjs) |
| E2E suites (`tests/e2e/*`) | 105 |
| Showcases (`showcases/*`) | 13 (dom/adwaita-storybook-nativescript, dom/adwaita-widgets-nativescript, dom/canvas2d-fireworks, dom/excalibur-jelly-jumper, dom/minimalist-browser, dom/three-geometry-teapot, dom/three-geometry-teapot-nativescript, dom/three-postprocessing-pixel, dom/webrtc-loopback, dom/webrtc-video, gtk/adwaita-storybook, gtk/node-gi-window, node/express-webserver) |
| Examples (`examples/*`) | 68 |
| Reference submodules (`refs/`) | 93 |

---

## Priorities / Next Steps

### High priority

1. **Real-world application examples** — validate the platform against real frameworks and use cases; each example must run on both Node.js and GJS. The current set (Express/Koa/Hono servers, SSE chat, WS/socket.io chat, static file server, CLI tools, SQLite/JSON stores, worker pool, SAB-native parallel SHA-256, GTK HTTP dashboard, axios client, deepkit examples, …) serves as integration validation and surfaces real CJS-ESM interop issues, missing globals, GC problems, and MainLoop edge cases that unit tests alone don't catch. Keep adding examples along new pillar work.
2. **Increase test coverage** — port more tests from `refs/node-test/` and `refs/bun/test/`, especially for networking (net, tls, dgram) and fs.

### Low priority

3. **cluster** — multi-process via a Gio.Subprocess pool.
4. **inspector** — GJS debugger integration (`gjs --debugger`).

---

## Integration Test Coverage

`tests/integration/` validates `@gjsify/*` implementations by running curated upstream tests from popular npm packages — 35 suites (opt-in: `gjsify foreach test:integration`). Suite notes are authored in [`status/integration-coverage.md`](status/integration-coverage.md); headings are validated against the suite directories.

<!-- Authored per-suite notes for STATUS.md's "Integration Test Coverage" section.
     One `## <dir>` section per tests/integration/<dir> — the status-data check
     enforces the bijection in BOTH directions (a suite without a section fails,
     a section without a suite fails). Keep counts/narrative current in place;
     per-change history belongs in commit messages. -->

## acorn

Phase D-1 Workstream P — pure-JS ECMAScript parser + AST visitor (acorn + acorn-walk) used by `@gjsify/rolldown-plugin-gjsify`'s `auto-globals` detector. **Node: 127/127 green. GJS: 127/127 green, 0 skips.** No `@gjsify/*` fixes required — a clean canary that the SpiderMonkey 140 ES2024 surface (private class fields, top-level await, optional chaining, logical assignment, dynamic `import()`, import attributes, tagged templates) used by the `--globals auto` builder is intact under `firefox140` lowering. Suites: parse-basic (11), parse-strict (10), walk-basic (6), walk-recursive (5), error-positions (6) — each ×2 runtimes.

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

## axios

Validates axios 1.x against `@gjsify/*` using real localhost `node:http` servers (no mocking). On GJS, axios selects the XHR adapter because `globalThis.XMLHttpRequest` is available. **Node: 68/68 green. GJS: 52/52 green, 12 ignored (HTTP-adapter-only features).** Suites: basic (12), headers (8/5+3 ignored), timeout (6/5+1), redirects (7/5+2), compression (8/5+2), streams (6/3+3), abort (5/5). Root-cause fixes surfaced (landed): the `@gjsify/fetch` double-decompression bug (`Soup.ContentDecoder` removed per session; JS-level `DecompressionStream` decompresses exclusively), UTF-8 BOM stripping in XHR `responseText`, and the `@gjsify/zlib` brotli stubs.

## chalk

Universal terminal-color package (every CLI tool depends on chalk). Three ported spec files exercise ANSI escape-code generation, the truecolor + RGB/hex/ansi256 chain API with level-downsampling, and the level-gating contract: basic (18 — chain styling, nesting, `.reset()`, grey/gray alias, `Function.prototype.{apply,bind,call}` preserved, LF + CRLF line-break reopening), templates (11 — 24-bit SGR, hex parsing, ansi256, level=1/2/3 downsampling), level (17 — level=0 stripping, child/root level propagation, `new Chalk({level})` isolated context, range validation). **46 authored assertions; Node + GJS counts pending a clean run** (the initial suite-local install exhausted the worktree tmpfs; chalk 5 is pure-ESM JS over vendored ansi-styles + supports-color, so no `@gjsify/*` source change is anticipated). `chalk.level` is pinned per suite so assertions stay deterministic regardless of host TTY/COLORTERM/CI/FORCE_COLOR.

## chokidar

4 spec files ported from chokidar 5.0.0 `src/index.test.ts`. **Node: 19/19 green. GJS: 19/19 green, 0 skips.** Validates `@gjsify/fs`'s `FSWatcher` (`Gio.FileMonitor`-backed) end-to-end via the file-watching surface every TypeScript-aware dev tool depends on (Vite, Rolldown, esbuild/tsc `--watch`): basic events (add/change/unlink/addDir/unlinkDir/rename/all/close idempotency), recursive watch (chokidar walks the tree itself; `depth` boundaries), ignored (regex/function/subdir), await-write-finish (stabilityThreshold polling). Root-cause fix surfaced (landed): `FSWatcher` now emits the Node-contract `'change'` event shape — `(eventType: 'rename' | 'change', filename)` — instead of separate `'rename'`-named events that dropped every create/rename/delete for contract-following consumers (16 of 19 cases failed before the one-character fix in `fs-watcher.ts`).

## claude-agent-sdk

Fresh suite (no API key) against `@anthropic-ai/claude-agent-sdk@0.3.181` — the ground-truth compatibility check for building AI-agent tooling on GNOME. **Node: 123/123 green. GJS: 125/125 green.** Exercises Explicit Resource Management (`using`/`await using` → the `Symbol.dispose`/`asyncDispose` GJS-banner polyfill; stream/readline/FileHandle dispose), zod-v4 + the MCP SDK (`createSdkMcpServer`/`tool` via `InMemoryTransport`), fs session readers + `CLAUDE_CONFIG_DIR`, os/path/process.env.

## cosmiconfig

Phase D-1 Workstream S. Validates `@gjsify/fs` (read), `@gjsify/path` (resolve) and dynamic ESM `import()` with `file://` URLs — the same code paths `@gjsify/cli`'s config loader uses. Green on Node + GJS; the `--configName` ESM-rc loading path is additionally regression-covered end-to-end by the ts-for-gir suite (gjsify/ts-for-gir#385).

## debug

Validates `@gjsify/tty` (isatty), `@gjsify/process` (`process.stderr.write` + `.fd`) and `@gjsify/util` (formatWithOptions + inspect format specifiers) end-to-end via TJ Holowaychuk's `debug` — the same code paths Express / socket.io / eslint pull on every log. Green on Node + GJS.

## deepkit-type-compiler

Phase D-1 Workstream W — the Deepkit TypeScript type compiler consumed by `@gjsify/rolldown-plugin-deepkit` (opt-in `reflection: true`). **Node: 29/29 green. GJS: 29/29 green, 0 skips.** loader (6 — `DeepkitLoader` transform round-trips) + transform (7 — `typeOf<T>()` instrumentation, per-kind metadata emission). The heaviest single TS-Compiler-API exercise in the tree (≈8 MiB test bundle). Pinned to `typescript: "^6.0.3"` — `@deepkit/type-compiler@^1.0.19` instruments correctly against TS 6 internals, so the suite is a full workspace member again.

## deltachat

DeltaChat / chatmail core (`@deltachat/jsonrpc-client` + `@deltachat/stdio-rpc-server`) on Node + GJS. **43/43 green on both.** Validates the pure-JS JSON-RPC client speaking to the Rust core process over stdio via `@gjsify/child_process` — the canonical real-world consumer for a future native Adwaita+GJS DeltaChat app.

## devtools-cdp

Validates `@gjsify/devtools-cdp`'s `InspectorProtocolClient` against a **live WebKit remote inspector** (CDP-shaped JSON-RPC over a per-target WebSocket), ported from `refs/webkit/LayoutTests/inspector/{runtime,dom}`. Opt-in + skip-if-unreachable: with `GJSIFY_CDP_INSPECTOR_PORT` unset it registers a single passing "skipped" test; pointed at a reachable inspector it asserts real `Runtime.evaluate` / `DOM.getDocument`/`querySelector`/`getOuterHTML`/`querySelectorAll` round-trips. Launch recipe: `gjsify browse <url> --inspector-port 9222`, then `GJSIFY_CDP_INSPECTOR_PORT=9222 gjsify workspace @gjsify/integration-devtools-cdp test`. **Not wired into CI** — needs a real WebKitGTK display.

## dotenv

Tiny but load-bearing — dotenv is the most ubiquitous third-party `process.env` mutator on npm, so if the `@gjsify/process` `process.env` Proxy's get/set/delete traps drift from Node's plain-object semantics this suite catches it first. **Node: 127/127 green (96 `it()` blocks). GJS: 127/127 green, 0 skips.** parse (48 — every quoting branch, inline comments, `\n` expansion, `export` tolerance, Buffer input, duplicate-key + line-ending matrix), parse-multiline (23), config (38 — string/array/URL paths, override semantics, `processEnv` target, ENOENT), populate (18 — incl. `delete process.env.X` unsetenv trap + `in` has trap). Fixtures reproduced verbatim from upstream v17.4.2. No `@gjsify/*` fix required.

## execa

Phase D-1 Workstream T — the `execa` v9 subprocess wrapper consumed by `@gjsify/vite-plugin-blueprint` (blueprint-compiler) and `@gjsify/vite-plugin-gettext` (xgettext/msgfmt). **Node: 44/44 green. GJS: 43/43 green, 1 ignored on GJS** (async-stdin piping — tracked in Open TODOs as part of the child_process surface). Fixes surfaced (landed): named-import `hrtime` preserves `.bigint`; `ChildProcess.stdio` getter exposes the `[stdin, stdout, stderr]` tuple; the `--app gjs` process-stub's `hrtime` gained `.bigint` so pre-register `__esm` lazy-init code cannot hit a TypeError.

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

## mcp-typescript-sdk

Validates `@gjsify/http`, `@gjsify/fetch`, `@gjsify/net`, `@gjsify/ws`, `@gjsify/events`, `@gjsify/child_process`, `@gjsify/buffer` and the MCP TypeScript SDK's pure-JS surfaces. **Node: 281/281 green. GJS: 281/287 green** (6 pre-existing `streamable-http.spec.ts` timeouts under flaky libsoup long-poll SSE pause behaviour; tracked separately). Suites: protocol, tool, resource, prompt, streamable-http (⚠ flaky on GJS), in-memory-transport, stdio-buffer (newline framing incl. mid-codepoint UTF-8 chunking), uri-template (RFC 6570 incl. the CVE-2026-0621 ReDoS regression cases), tool-name-validation, stdio-subprocess (regression coverage for the `@gjsify/child_process` env-undefined silent-data-loss fix), server-initiated-requests (sampling + elicitation), cancellation-progress. Historic fixes surfaced: `ServerRequestSocket.destroySoon()`, async handler rejections swallowed in `_handleRequest`, `McpServer` GC'd between requests when handler-scoped.

## minify-xml

Phase D-1 Workstream X — the `minify-xml` v4 pure-JS XML compressor consumed by `@gjsify/vite-plugin-blueprint`. **Node: 63/63 green. GJS: 63/63 green, 0 skips.** basic (10), options (10), edge-cases (12 — 100-deep nesting, entities, PIs, Blueprint-style GTK XML, unicode, CDATA-with-markup) ×2 runtimes + shared cases. SpiderMonkey 140's RegExp engine matches V8 exactly for every pattern the minifier exercises (incl. the lookbehind-anchored `tagPattern` chain). Specs derived from the documented public API (the tarball ships no tests).

## nativescript

On-device polyfill smoke suite — runs gjsify `nativescript:'polyfill'` packages on the **real NativeScript V8 runtime** (Android), closing the gap between *declaring* an NS slot and *executing* it. **14/14 green on NS V8** (NS CLI 9.0.6 / runtime 9.0.4, `@nativescript/core` 9.x, Vite 8.0.16): `@gjsify/path` 7/7 + `@gjsify/buffer` 7/7. Bundles the specs into a tiny NS app via the `@gjsify/nativescript-vite` composer, builds the APK, installs + launches on an emulator, parses `__GJSIFY_NS__` markers out of `adb logcat`. Root-cause fix surfaced (landed): `@gjsify/buffer` constructed `TextEncoder`/`TextDecoder` at module-eval time — on NS V8 those globals register after module evaluation, so the bundle rejected on app start; now lazily initialised. Local-only (needs the NS CLI + an Android emulator); excluded from the root workspace so the heavy NS toolchain is not pulled by `gjsify install`; not wired into CI. The deterministic runner works around NS CLI 9.0.6's watch-only Vite bundle-copy (see Open TODOs).

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

## streamx

6 spec files ported from `refs/streamx/test/` plus an original `throughput.spec.ts`. **Node: 155/155 green. GJS: 156/156 green (1 GJS-only test), 0 skips.** readable (24), writable (10), transform (2), pipeline (5), duplex (5), throughput (5/6 — queueMicrotask injection, 100-chunk no-loss, pipeline byte preservation, Duplex echo, timing). Root cause of the historic 0 B/s webtorrent-player symptom: `queueMicrotask` must be injected so streamx uses Promise-based microtask scheduling instead of the `process.nextTick` fallback — the GJS-only throughput test pins the injection.

## tls-session

Real TLS-handshake round-trip validating the `@gjsify/tls-native` Phase 2 Path-A C shim. session-resumption (conn 1 captures the session blob via the `'session'` event; conn 2 with `{session}` resumes — `isSessionReused() === true`; TLS 1.2 forced for predictable ticket-based resumption; the GJS path additionally asserts `hasTlsSessionAccess() === true` so a degraded native bridge fails loudly) + channel-binding (`getFinished()`/`getPeerFinished()` non-empty and different on both TLS 1.2 `tls-unique` and TLS 1.3 `tls-exporter` — identical bytes would be a handedness bug). Green on Node + GJS. Fixture cert+key generated at prebuild time via one `openssl req -x509` command; the server is a vanilla `node:tls.createServer` driven by `@gjsify/tls` under `--app gjs` via the standard alias layer — no GJS-specific test plumbing.

## ts-for-gir

Phases 1–9 (partial): validates `@gi.ts/parser`, `@ts-for-gir/lib`, the typescript/json/html-doc generators, `@ts-for-gir/cli` and `@ts-for-gir/language-server` (v4.0.0-rc.13). **Node: 278/278 green. GJS: 214/214 green (3 ignored — Node-only: TypeDoc/shiki WASM + the CJS `typescript` lib resolution).** `glob`, `ejs`, `lodash`, `colorette`, `cosmiconfig`, `yargs`, `typedoc` all work on GJS/Node via `@gjsify/*`. Parser fixtures are gjsify's own Vala-generated GIRs; both CLI bundles (`dist/cli.node.mjs` + `dist/cli.gjs.mjs`) run the non-interactive command surface incl. the `--configName` cosmiconfig ESM-rc path (gjsify/ts-for-gir#385) and the `create` GJS-bundle short-circuit (gjsify/ts-for-gir#386). Root-cause fixes this suite drove into the platform over its phases: `util.styleText`/`stripVTControlCharacters`, per-source-file `__filename`/`__dirname` injection on the node target, the `--define`/`--external`/`--alias` CLI flags, runtime-relative `import.meta.url` rewriting (removed the TypeDoc stubs), `createRequire` ancestor-`node_modules` walk, `ensureMainLoop()` in `@gjsify/child_process.spawn()`. Strategic goal: ts-for-gir runs unmodified on GJS — remaining phases in Open TODOs.

## typescript-tsc

TypeScript compiler (tsc) + language-server API on GJS and Node. **Node: 35 green; GJS: 33 green + 1 ignored.** Probes whether the TypeScript compiler API runs end-to-end under GJS via `@gjsify/*` — Program creation, type-checking, diagnostics emission — and what gaps surface for tsserver's LSP-over-stdio loop. Failures are documented in the suite's TODO comments and surface as test results, not silent skips. (The production answer to "tsc under GJS" is the `@gjsify/tsc` bundled toolchain, which self-hosts the workspace's own `check` + `build:types`.)

## undici

Three ports against npm `undici@7` — the canonical HTTP/1.1 + WebSocket client (Node's own `globalThis.fetch` is undici). Exercises `fetch`, `request` and `WebSocket` end-to-end against a local `node:http`-backed server (native on Node; `@gjsify/http` under GJS via the alias layer). **Node: 31/31 green (76 assertions). GJS: unblocked by the `@gjsify/zlib` Zstd stubs (undici's module-init feature detector reads `createZstdDecompress`); live GJS counts pending a run — any remaining gap is a separate follow-up.** fetch-basic (13), request (13), websocket (5 — npm `ws` server on Node, `@gjsify/ws` on GJS via the alias map, same source both runtimes).

## webtorrent

7 test files ported from `refs/webtorrent/test/`. **Node: 185/185 green. GJS: 185/185 green, 0 skips.** selections, rarity-map, client-destroy, client-add, bitfield, file-buffer, iterator — exercising fs (URL paths), stream, events, buffer, crypto, the `require`-condition ESM fix and the `random-access-file` alias. Root-cause fixes surfaced (landed): `@gjsify/fs` accepts `URL` path arguments across every public entry point; ESM builds no longer pull CJS entries through the `require` condition (double-`__toESM`-wrap made classes non-constructable); `random-access-file` aliased to its Node entry (the browser-stub throw stalled every `client.seed()`).

## worker-stress

Three-suite stress workload validating `@gjsify/worker_threads` `transferList` semantics + the `SharedArrayBuffer` pass-through path + the cross-process `SharedBuffer` path. **Node: 1169/1169 green (SAB suite included; sab-native suite skipped). GJS: 1034/1034 green (SAB suite probe-only; sab-native suite runs the full 4-worker workload).** transferlist-stress (bulk ArrayBuffer transfer — 256 × 64 KiB with detach + integrity checks; multi-channel FIFO fan-out; 5-hop MessagePort transfer chain), sab-parallel-hash (Node: 4 threads SHA-256 over disjoint slices of a 1 MiB SAB, `Atomics` barrier), sab-native-parallel-hash (GJS: 4 subprocess workers over a memfd-backed `SharedBuffer` — SCM_RIGHTS fd-passing under load, page-coherent mmap across 5 processes, SEQ_CST visibility, count-and-drain bootstrap protocol; plus 8 workers × 10k `fetch_add` under contention with exactly 80,000 observed). Throughput baselines logged per run, not asserted (Node ≈ 700 MiB/s transferList; GJS ≈ 235 MiB/s).

## yargs

Phase D-1 Workstream O — the yargs v18 ESM CLI parser used by `@gjsify/cli` end-to-end on GJS. **Node: 52/52 green. GJS: 52/52 green, 0 skips.** parser (10), options (10), commands (6), help (5), esm (6) ×2 runtimes + shared. No `@gjsify/*` fixes required; yargs's transitive deps (cliui, escalade, get-caller-file, string-width, y18n, yargs-parser) all bundle and run on GJS without intervention.

## yjs

8 spec files ported from yjs@13.6.31 + y-protocols upstream tests. **Node: 147 assertions / 54 cases green. GJS: 147/54 green, 0 skips.** y-text, y-array, y-map, y-xml, doc (subdocs, transaction origins, clientID re-roll), updates-sync (state vectors, mergeUpdates, snapshots), undo-manager, awareness (y-protocols). Yjs is the de-facto JS CRDT (TipTap/ProseMirror collab/BlockNote/Hocuspocus); pure JS at its core, so it exercises heavy `Uint8Array`/`DataView` wire-format paths, Map/Set/WeakMap bookkeeping and `crypto.getRandomValues` (via lib0). Upstream's PRNG-driven `TestConnector` multi-user scenarios are reduced to deterministic 2-/3-doc sync via the canonical wire format (`Y.applyUpdate(b, Y.encodeStateAsUpdate(a))`) — same correctness assertion, no PRNG in CI. No `@gjsify/*` source fixes were required.

---

## Open TODOs

Tracked follow-up work that has been deliberately deferred. Every "out of scope" / "follow-up" note from a PR must end up here (authored in [`status/open-todos.md`](status/open-todos.md)). A resolved TODO is DELETED — its record is the commit + CHANGELOG that closed it; the `status-data` check rejects struck-through or "Completed" headings.

<!-- Authored Open-TODO sections for STATUS.md. One `### <title>` per open item.
     A RESOLVED item is DELETED (its record is the commit + CHANGELOG that closed
     it) — the status-data check rejects struck-through / ✓ / "Completed"
     headings, so the done-log cannot regrow. -->

### 60 dead lint-disable directives; `--report-unused-disable-directives` is off

oxlint supports `--report-unused-disable-directives`, which flags an `// eslint-disable-…` / `// oxlint-disable-…` comment that suppresses nothing. That is precisely the failure mode behind the bare-`require` incident: the `@typescript-eslint/no-require-imports` disables sitting at the offending sites were DECORATION, because the rule they named was never enabled. An unused-directive check would have said so out loud, years before a red main did.

Measured on `c185bbaf4`: **60 unused directives** across the tree (`node-gi/globals.d.ts`, `zlib/src/browser.ts`, `worker-stress`, `http2/src/native-dispatcher.ts`, …). So the flag cannot just be switched on at `error` — that is a 60-site cleanup, and each site needs deciding individually (delete the directive, or repair the rule name it got wrong; a directive naming a rule oxlint does not implement is indistinguishable from one naming a rule that is merely disabled).

Enabling it at `warn` alone is NOT worth doing: `gjsify lint` already emits warnings that nothing gates on, so it would add noise without adding a guarantee — the half-measure this whole class argues against. The useful shape is one change that sweeps the 60 AND turns it on as an ERROR, so it cannot regrow.

### `@gjsify/http2` lazy native-dispatcher loads still use a bare `require`

Two sites load the optional native HTTP/2 dispatcher through a bare `require(...)` from ESM source — `src/client-session.ts` (`_setupNativeClient`, reached from `connect()`) and `src/server/http2-server.ts` (`_startNativeListen`, reached from `listen()`). This is the class documented in AGENTS.md § CJS-ESM Interop → "Our source is ESM": the call resolves at build time inside a bundle and is a `ReferenceError` from the unbundled `lib/` we publish. Neither obvious fix applies as-is:

- a **static import** would pull `native-{client-,}dispatcher`'s static `gi://GLib` / `gi://Gio` / `@gjsify/http2-native` imports into EVERY http2 consumer, defeating the optional-native-package design;
- **`await import()`** (the ESM way to lazy-load) requires making both call paths async, i.e. changing `connect()` / `listen()` — and Node's `listen()` contract is synchronous.

So it needs a real design decision inside `@gjsify/http2` (e.g. resolving the dispatcher during an already-async phase, or an explicit async opt-in), not a lint fix. Both sites carry an `oxlint-disable-next-line typescript/no-require-imports` with the reason inline; they are the only sanctioned disables of that rule in the tree.

### Manifest-conformance follow-ups

The five standalone declaration-vs-reality scripts are now one rule registry (`@gjsify/manifest-conformance` + `scripts/manifest-conformance/`). Three things were deliberately left out of that refactor so it stayed a refactor.

- **`gjsify manifest-check` is designed but not shipped.** The portable rules (`package-outputs`, `prebuild-artifacts`, `headless`, `field-coverage`) are already extracted into a package with a hand-written `lib/index.d.ts`, so the command is a thin wrapper over `selectRules({ scope: 'portable' })`. It was held back because it carries two costs a refactor must not smuggle in: the package has to flip from `private` to published, which needs the manual first-publish + Trusted-Publisher bootstrap BEFORE the next release train, and adding a command rebuilds `dist/{cli,affected}.gjs.mjs`, coupling the change to the committed-bundle gate. The name is settled: `manifest-check` — a sibling of `system-check` (machine has what the project needs) and distinct from `check` (types compile). Evidence it is worth doing: downstream consumers already declare `gjsify.storybook` (buchhaltung, pixel-rpg/map-editor) and `gjsify.prebuilds` (buchhaltung's ERiC package, which declares a prebuilds directory with NO `gjsify.platforms` — a hard failure in this repo, unchecked in theirs).
- **Five `gjsify.*` declaration kinds have no rule** and are deferred with a written reason in `scripts/manifest-conformance/unchecked-fields.mjs`, printed on every audit run. Four are judged unverifiable-by-construction (`defineFromPackageJson`, `flatpak`, `buildCache`, and `nativescriptPlatforms` until there is a per-platform artifact to compare against); the one remaining FINDING is `gjsify.storybook` (a typo in `stories` produces an empty component browser, not an error). `gjsify.main` and `gjsify.example` left the ledger when `package-outputs` claimed them.
- **The affected classifier does not know the conformance/status paths.** `scripts/audit-runtimes.mjs` is a `GLOBAL_TRIGGER`; `scripts/manifest-conformance/**`, `packages/infra/manifest-conformance/**`, `scripts/generate-status.mjs` and the authored `status/**` data are not classified (unknown paths fall back to a conservative full run; `status/**` should arguably join the docs-shaped IGNORE set alongside `STATUS.md` itself). No coverage is lost today because `audit-runtimes.yml` carries no `paths` filter and runs on every PR, but the trigger/ignore tables and the rule locations should be brought back into agreement — an affected-classifier change rebuilds the committed `dist/affected.gjs.mjs`, so batch it with the next CLI-src touch.

### Toolchain hygiene follow-ups

- **Nine fixtures re-implement the prebuild-target name instead of importing it.** `resolvePrebuildDirName()` / `prebuildDirCandidates()` (`packages/infra/cli/src/utils/detect-native-packages.ts`) are pure functions and already the single source of truth for `prebuilds/<os>-<arch>/` — but every e2e that needs that directory composes the name itself, and several translated `process.arch` into the `uname -m` machine on the way. The `<os>-<arch>` unification had to fix all nine by hand, and one (`tests/e2e/self-host/run.mjs`) was missed on the first pass precisely because the composed string never appears as a literal. Export a small test helper (or let fixtures import the CLI's built `lib/utils/detect-native-packages.js` directly, the way `tests/e2e/dlx-native-prebuilds` already imports `run-gjs.js`) so the name has exactly one definition, and delete the per-fixture copies. Until that lands, any change to the target vocabulary must be swept for BOTH shapes — the literal path AND the computed one.
- **`@gjsify/cli`'s `tsconfig.json` type-checks only what `src/index.ts` imports.** `files: ["src/index.ts"]` means `gjsify tsc --noEmit` never sees `src/affected-entry.ts` — the entry CI's `changes` job actually boots (`dist/affected.gjs.mjs` is bundled from it) — nor `src/test.mts`. A type error in either is caught only when the bundle build runs, i.e. in the pre-commit hook rather than in `check`. Widen to an `include` covering `src/**` (and confirm the emit stays `lib/**` only), or add the two entries to `files`.
- **`gjsify install` materialises EVERY platform package, so a cold install does ~4x the necessary work — this, not a wedge, is what the 30-min budget hits.** Measured on a fresh clone (linux-x64, warm tarball cache, 2026-07-28): 1597 packages / **4.78 GB** extracted, of which **183 packages / 3.36 GB (70% of the bytes)** declare an `os`/`cpu` that EXCLUDES the host, so npm/yarn/pnpm would never place them — six `@anthropic-ai/claude-agent-sdk-*` siblings at ~230 MB each, six `@pagefind/*`, plus the `@rolldown`/`@oxlint`/`@oxfmt`/`@img/sharp`/`@deltachat` binding sets. The fix is to honour `os`/`cpu` like every other package manager, and it is a TWO-part change because `--immutable` materialises straight from `gjsify-lock.json`: record `os`/`cpu`/`libc` on lock entries at resolve time, and filter at materialisation. That is a lockfile-format change + a full `gjsify-lock.json` regeneration, so it wants its own PR + e2e; the napi-rs entry-replacement in `napi-node-addon.ts` already selects its sibling BY HOST TRIPLE, so it is unaffected. Do NOT "fix" this by raising `--timeout`: a budget that exists to bound a hang must not be tuned to accommodate one.
- **`utils/stdin.ts` is the only reader of fd 0, but `@gjsify/fs` still has no numeric-descriptor support.** The CLI routes stdin through `GioUnix.InputStream` under GJS (`readStdinText`), which fixes `gjsify affected --changed-from-stdin`. The underlying gap is in `@gjsify/fs`: `readFileSync(0)` / `readSync(0, …)` coerce the descriptor to the relative PATH `"0"` and throw `ENOENT`, so ANY bundled npm package doing the Node idiom breaks the same way, silently and off-target. Fix at the core (map 0/1/2 — and `openSync` handles — onto the Gio streams) and then let the CLI helper collapse back to `readFileSync(0)`.

### CI coverage follow-ups

- **`prebuilds.yml` covers every Linux target on a PR; `darwin-arm64` is still proven for the first time AFTER the merge.** The workflow runs its BUILD legs on `pull_request` (native x64 + arm64 and the ppc64/s390x/riscv64 QEMU legs, Vala *and* the three Rust bridges — the break that motivated it, #827, was in the Rust dependency graph). Under real qemu-user (10.2.2, ppc64le): dependency install ~6 min, the Vala/GI packages compile in minutes; `@gjsify/lightningcss-native`'s Rust cdylib is the one expensive step — if a leg's total makes it the PR critical path, drop THAT package from the emulated legs rather than the architecture. `build-prebuilds-macos` remains the one PR-skipped leg (10x billing + the shared macOS concurrency pool); label a PR `ci:macos` to opt in. `prebuilds-summary` names the skipped legs per run. Closing the macOS gap permanently means either paying 10x per PR or a nightly full-matrix run. Pairs with the "nothing byte-compares a committed prebuild against a CI-built one" item below.
- **`@gjsify/rolldown-native`'s darwin-arm64 leg is PROVEN but not promoted, so `gjsify build` still has no bundler engine on macOS.** As of run 30271998319 the manual-dispatch `build-prebuilds-macos-experimental` job builds the Rust cdylib + Vala bridge on a real Apple-silicon runner, stages BOTH libraries, passes `check-prebuild-loader-path.mjs`, loads under Homebrew `gjs` and resolves its sibling cdylib with `DYLD_*` unset — every gate the required job applies to `lightningcss-native`/`oxfmt-native`. Missing is only the promotion: a build+collect+upload step in `build-prebuilds-macos`, `darwin-arm64` in the package's `gjsify.platforms`, and the download+commit wiring in `commit-prebuilds`. Until then the one job that covers the bundler engine on macOS runs on no automatic event.
- **`linux-ppc64`, `linux-s390x` and `linux-riscv64` have a working emulated BUILD but no committed prebuild yet, on all eight bridges that declare them.** Two defects stacked historically: `uraimo/run-on-arch-action` ignored the architecture whenever a custom `base_image` was set (the legs compiled x86-64 and staged it as ppc64/s390x/riscv64), and it reset binfmt to a qemu 7.2 under which Fedora's package manager does not survive emulation. The job now registers a pinned current qemu (`tonistiigi/binfmt:qemu-v10.2.3`) and runs `.github/prebuild-toolchain/emulated-build.sh` in the target-arch image. The mis-staged x86-64 artifacts were removed and each package records the gap in `gjsify.platformsUncommitted`, printed by `audit-runtimes --check` on every run. **A `commit-prebuilds` run on `main` is what closes it** — the audit then requires the `platformsUncommitted` entries to be deleted in the same change. Until then an exotic-arch consumer gets no native bridge and the guarded `imports.gi` probes degrade, which is the honest state rather than the previous unloadable one.
- **Fork PRs have no working CI at all.** Every container job pulls the PRIVATE `ghcr.io/gjsify/ci-fedora:<major>`, and a fork PR's `GITHUB_TOKEN` cannot read another repo's private package. Either publish the image publicly (it contains nothing secret — a Fedora + GNOME devel stack) or accept that external contributions cannot be validated until a maintainer pushes the branch.

### Cross-runtime reachability follow-ups (ADR 0014)

- **Nothing byte-compares a committed prebuild against a CI-built one.** `scripts/check-refs-pin.mjs` (wired into every `build:meson`) catches the three ways a locally-built native artifact diverges from its pinned source — checkout drift, version skew against the npm engine, and a stale `build/` dir ninja will not invalidate. What it cannot catch is a binary that was simply never rebuilt: the `rolldown-native` prebuild had drifted BEHIND its pin for an unknown number of commits and only surfaced when a rebuild finally happened. Close it by having `prebuilds.yml` rebuild and diff the committed artifact (or publish the CI-built one as the source of truth and stop committing hand-built binaries).
- **Three browser bundles are ledgered as NON-GATING in the `browser` CI job.** The axis runs (`main.yml` `browser` job: Playwright/Firefox over the bundles the Fedora `build` job stages, 51 discovered, 48 gating-green), but `$BROWSER_PROBE_GREP` carves out three that were red the moment it was first executed. (a) **`@gjsify/events`** and (b) **`@gjsify/util`** both declare `src/test.browser.mts` as `export * from './test.js'` — re-running the GJS/Node spec files in a browser, which AGENTS.md explicitly forbids (`events` hangs; `util` dies on a bare `process.env` read in one spec). (c) **`@gjsify/streams`** feeds STRING chunks into `new Response(stream).text()` in three cases; per the Fetch spec a body stream must yield `Uint8Array`, and Firefox enforces it where Chromium and undici are lenient — the spec needs `TextEncoderStream` in front of the `Response`. **The same forbidden `export * from './test.js'` shape is in 11 packages** (`assert`, `async_hooks`, `buffer`, `constants`, `diagnostics_channel`, `events`, `path`, `querystring`, `string_decoder`, `sys`, `util`); the other nine pass only because their specs happen to be pure logic. Rewrite all 11 to browser-globals-only entries, then delete the ledger.
- **`@gjsify/worker_threads` ships a `src/browser.ts` with NO browser-axis test coverage.** No `index.browser.spec.ts` backs its `test.browser.mts`, so nothing ever asserted against that entry — which is how the exported `workerData` stayed permanently `null` (fixed, found by reading rather than by a failing test). `@gjsify/zlib`, `@gjsify/vm` and `@gjsify/http` show the pattern to copy. Worth doing before the package is considered for `partial` → `polyfill`, since export parity alone would have passed that bug.
- **`@gjsify/web-globals` declares `node: "polyfill"` but re-exports `@gjsify/webaudio`** (`node: "none"`, hard-bound: `gi://Gst?version=1.0` + a top-level `Gst.init(null)`) from `src/index.ts` and `src/register.ts`. A `--app node` bundle therefore hard-requires the external `@gjsify/node-gi` at module load. Fix by downgrading the slot to `partial` or adding a `src/node.ts` platform entry. Reported on every `audit-runtimes --check` run.
- **The ten `browser:"partial"` slots are RESOLVED as partial — the residual work is per-package, not a slot sweep.** All ten were audited against the `platform-entry-parity` gate; none is promotable, because in every case a NAMED export is unavailable on the browser platform itself (the blocking export per package is recorded in each package's status entry / AGENTS.md row). Parity is necessary but not sufficient — it passes `sqlite`, whose `DatabaseSync` throws from its constructor; treat a green parity gate as permission to look, not a mandate to promote. Still open, per package: **`fs`** — close the 34-export gap over the in-memory `Volume` (does NOT unblock promotion while `FSWatcher` is a never-firing stub); **`sqlite`** — add a `./browser-worker` subpath declared `polyfill` backed by OPFS `createSyncAccessHandle`, leaving `./browser` at `partial`; **`ws`** — the only one of the ten without a `src/test.browser.mts` (its browser entry is 93 LOC; a small spec asserting the `WebSocketServer` ENOTSUP shape + CJS-compat statics closes it); **`crypto`** — only 2 of its 25 root modules have a platform dependency (`GLib.Checksum` in `src/hash.ts`, the `imports.gi` fallback in `src/random.ts`); replacing those makes the ROOT browser-clean with full synchronous Node semantics — the one path that would actually earn `polyfill` — and retires the 1,774-LOC `src/browser/` duplicate.
- **The `native` runtime slot means two different things, and the NativeScript bridge packages use the wrong one.** The routing rule reads `native` as "the RUNTIME provides this API — resolve to `<pkg>/globals`", but `packages/nativescript-bridge/*` declare `nativescript: "native"` in the sense "this package IS the native implementation". None of them ships a `globals.mjs`, so all five resolve to `@gjsify/empty` with a warn-once on ANY `--app nativescript` build that imports them BY NAME — a shipping bug, not a latent one. It also blocks `ALIASES_NODE_FOR_NATIVESCRIPT` from being composed through `withDerivedSlotRouting`. Fix by settling the vocabulary (either a new slot value for "this package is the runtime-native impl", or re-declaring the five as `polyfill`) — an ADR-sized decision because it changes a published `package.json#gjsify.runtimes` contract and `scripts/audit-runtimes.mjs`. Compose the NS table in the same change.
- **Rolldown 1.1.4 emits the `keepNames` helper AFTER its first use.** With `output.keepNames = true` (gjsify's default whenever `minify` is on) a minified bundle can contain `__name(fn, 'x')` at byte ~200 while the helper declaration appears ~9 kB later; `var` hoisting makes the early call `TypeError: __name is not a function`. Reproduced on `--app node` with the `@gjsify/module` node-gi test bundle (the `\0gjsify-gi-node:*` virtual module is ordered first); `--minify false` runs. Upstream (`refs/rolldown`, pinned `v1.1.4` in lockstep with `@gjsify/rolldown-native`) — needs a minimal reproducer filed, or a chunk-prelude workaround if the pin cannot move.

### `--app node` genuine-GJS-source detection is narrower than the reverse bridge it gates

`nodeGiGlobalsInject` keys on BARE ambient globals (`print`/`imports`/`ARGV`), so a genuine GJS source that uses `gi://` but logs via `console.log` — and passes no explicit `--globals` — is not recognised: its `@girs/*` value imports are emptied (`class extends undefined`) **and** its `/register` imports route to `@gjsify/empty`. Verified with both probes. This pre-dates ADR 0012 and hits `@girs/*` and registers equally; ADR 0012 only brought the two into parity via the single `isGjsSourceBuild` gate in `app/node.ts`. Fix by widening the SIGNAL itself — e.g. treat "a `gi://` specifier survived in the bundled graph" as a reverse-bridge build — which closes both at once.

### `@gjsify/node-gi` — a pointer struct FIELD whose length lives in a sibling field marshals EMPTY

`GstMapInfo.data` is a `guint8*` field whose length is carried by the sibling `size` field — a dependency GI cannot express for a struct-field READ. gjs resolves it; node-gi returns an empty array, and reports no error while doing so. Measured on a decoded audio sample: `map: ok=true size=8192 data.length=0` while `buffer.extract_dup(0, 8192)` returns 8192 bytes. That silent zero is what made audio inaudible on node for a whole investigation: every layer above reported success on an empty buffer. `@gjsify/webaudio` now uses the copying `gst_buffer_extract_dup`, which works on both runtimes — but any consumer reading a length-in-a-sibling-field pointer will hit this, and the empty result is indistinguishable from a genuinely empty buffer. Fix shape: honour the GIR's `array length=` annotation on struct FIELDS in the field reader (the call-argument path already does), and where the annotation is absent, prefer failing loudly over returning an empty array.

### `@gjsify/node-gi` — `GTK_IS_EVENT_CONTROLLER` assertion failures on the reverse bridge

Running any GTK app through node-gi intermittently produces `Gtk-CRITICAL **: gtk_event_controller_handle_crossing: assertion 'GTK_IS_EVENT_CONTROLLER (controller)' failed` and can take the process down mid-frame. NONDETERMINISTIC, which is the trap: single runs prove nothing in either direction. Measured on the showcase — node 1/6/1 criticals over three consecutive runs, bun likewise, deno clean in the same sample. It is INDEPENDENT of audio (still occurs with audio gated off, and on code predating the GValue marshalling fix). The event controllers are attached by `@gjsify/event-bridge` via `attachEventControllers`, so the likely shape is the JS wrapper for a controller being collected while GTK still holds the C object — a toggle-ref/lifetime question, not a GStreamer one.

### `@gjsify/node-gi` — the `$gtype` surface is incomplete

gjs exposes `$gtype` uniformly (`[object GType for 'X']`); node-gi does not, and the three shapes fail differently — measured against gjs on the same source: `Gio.ApplicationFlags.$gtype` is `undefined` (`makeEnum` freezes a plain member object, no lazy getter); `GLib.Variant.$gtype` is a static-method THUNK (`$gtype` falls through the struct proxy to method resolution); `String(Gio.Application.$gtype)` throws `Cannot convert object to primitive value` (the GType handle is a bare tagged External). The handle works fine as an ARGUMENT (`GObject.Value.init(GObject.TYPE_STRING)` round-trips), so this is a surface gap, not a marshalling one. Fix shape: attach the same lazy `$gtype` getter `defineLazyGType` gives classes to `makeEnum`'s frozen object and to the struct path that misses it, and give the GType handle a `toString`/`Symbol.toPrimitive` + `.name` so it prints like gjs's GType object.

### `@gjsify/napi` — a tsfn claim nobody hands back still leaks its control block

`finalize_env_tsfns` (`src/cc/tsfn.cc`) partitions `thread_count` by owner; only the claims a foreign thread demonstrably holds are joined (2 s deadline). Whatever is still outstanding afterwards makes the tsfn DETACH — its JS-side resources are freed and the control block is handed to whichever thread returns the last claim, which then frees it. That is Node's `MaybeDelete()` posture and it closes the force-free UAF window for good, but it inherits Node's consequence: **if no thread ever returns the claim, ~840 bytes leak for the process lifetime** (measured: 264 direct + 576 indirect, valgrind, 0 memory errors). Both outcomes warn unconditionally. Two residuals worth a decision later: an unattributed claim a foreign thread genuinely holds is not joined (safe, but the warning can only say "never attributed" — closing it needs an ownership signal N-API does not expose); nothing reclaims a detached control block at process exit (a per-env registry of detached tsfns would trade the leak for a much harder lifetime question; today the leak is accepted because Node accepts it). Measured on every CI run by `test/tsfn-teardown-gate.mjs` (Linux + macOS legs).

### Regenerate the register-globals closure map after a `GJS_GLOBALS_MAP` change

`node packages/infra/cli/scripts/generate-register-closure.mjs` (`--check` reports staleness). A stale map is fail-soft — builds stay correct but pay extra `--globals auto` analysis passes. (The related hazard — the committed CLI bundle inlining a stale map — is closed: `.githooks/pre-commit` triggers on `packages/infra/resolve-npm/lib/` and `packages/infra/rolldown-plugin-gjsify/src/`.)

### `@gjsify/rolldown-native` macOS prebuild — the last step to a Node-free toolchain on macOS

The Rust blocker is GONE (eventfd descriptors → portable anonymous pipes in `src/rust/src/wakeup.rs`; `cargo check --target aarch64-apple-darwin` green) and `meson.build` is darwin-ready — but no NATIVE macOS build has been promoted: run the manual-dispatch `build-prebuilds-macos-experimental` job, promote the package into the REQUIRED `build-prebuilds-macos` job, add `darwin-arm64` to `package.json#gjsify.platforms`, and commit the prebuild. Until that leg is green the docs must keep describing the Node-free toolchain as Linux-only. The CLI-side loading follow-ups are DONE (`detectNativePackages()` resolves `<os>-<arch>` for the running host; `buildNativeEnv()` emits the loader variable the host actually reads). Only the artifact itself is missing. (See also the CI coverage item above — the darwin leg is proven, not promoted.)

### Follow-up — adwaita-web style isolation (ADR 0010)

The style-isolation boundary reset (`scss/_reset.scss`) landed. Remaining: document the `--adw-*` / `--*` token set as the public theming contract on the website (the sanctioned external-override API — the counterpart to the isolation); if a second light-DOM Adwaita renderer ever appears, lift the boundary reset into `@gjsify/adwaita-core` (headless) so both share it; keep `$adw-components` in `_reset.scss` in sync with `src/elements/*` (guarded by `style-isolation.spec.ts`). Shadow DOM stays a documented FUTURE option, not adopted.

### Follow-up — adopt `@gjsify/adwaita-app` in the shell consumers (ADR 0009)

Adoption is opportunistic, not a rewrite — wire each consumer onto the shell package on its next shell touch: `@gjsify/storybook` (re-base `StorybookApplication` onto `AdwaitaApp`/`runAdwaitaApp`), buchhaltung (`app/src/frontends/desktop` — replace its hand-rolled application/nav/loadIntoStack/toast/dialog code; follows the release train), eco-retrofit (`cli/src/app` — same; also fixes its latent `Adw.Application.run(null)` → `runAsync()` hang class).

### Stale PixelRPG maker bundle — rebuild + recommit with `installDevtools`

`@gjsify/devtools` exports `org.gjsify.Devtools` correctly in every app config (verified rigorously, guarded by `tests/e2e/devtools-export`), and the css-as-string bare-`@import` gap that blocked the maker's rebuild under the global GJS CLI is fixed at the core (native `bundle()` path resolves + inlines bare-specifier `@import`s via `cssBundleResolver`; unresolvable imports fail loudly; `tests/e2e/css-as-string-bare-import`). Residual (map-editor repo, not gjsify): the committed `apps/maker-gjs/org.pixelrpg.maker` bundle predates the `installDevtools(this)` call — rebuild + recommit it. `installDevtools` logs `[gjsify-devtools] exported …` so "did devtools come up?" is answerable from the app's stderr.

### Architecture backlog — ADRs 0001–0008

Decisions in [docs/adr/](../docs/adr/README.md), prioritized backlog in [docs/reports/2026-07-01-architecture-review.md](../docs/reports/2026-07-01-architecture-review.md). Remaining open work (resolved sub-items are recorded in the commits/CHANGELOG that closed them):

- **ADR 0001 (P1)** — install non-destructive invariant: the Phase D.8 dedup pass is still open (the e2e guards, per-prefix lock, atomic writes and conflict warning have landed).
- **ADR 0006 (P1)** — per-package build cache: **CI wiring DEFERRED** — enabling it on the `main.yml` build steps timed out the serial `Build examples` step (cold cache + per-package closure re-hashing at scale). Remaining: (a) memoize input hashes across a single `foreach` before re-enabling in CI; (b) phase 2 = source-direct workspace-consumption spike.
- **ADR 0003 (P1)** — tiering shipped; the website still lacks a per-package tier index (the tier model is documented on the versioning page).
- **ADR 0002 (P1, after 0006)** — minimal committed `bootstrap.gjs.mjs` (install+run only), full CLI/tsc consumed from the registry via the lockfile; `tests/e2e/bootstrap-install` fresh-clone gate BEFORE removing `dist/cli.gjs.mjs`/`dist/tsc.gjs.mjs`/committed `lib/lib*.d.ts`; pre-commit hook shrinks to the bootstrap.
- **ADR 0007 (P3, easy6502)** — superseded into the full Learn6502 app-web rewrite (own project). Foundation pieces (phone-shell trio, `<adw-source-view>`) have landed on adwaita-web; remaining: the app-web view implementations over these + the classic-tutorial removal + the learn-package HTML target.

(ADRs 0004, 0005 and 0008 are fully implemented.)

### N-API host in GJS (`@gjsify/napi`) — Phase 2+ follow-ups

Phase 0 (full `js_native_api.h` + module loader; better-sqlite3 byte-identical to Node, valgrind-clean; conformance 13 pass / 8 ledgered / 0 fail) and Phase 1 (tsfn surface; node-gi-under-shim byte-identical to native `gi://` across all 21 conformance programs — a CI test oracle, NOT a production path) are complete; the transparent `.node`→`loadAddon` build integration has shipped (`napiNodeAddonPlugin`, e2e-gated byte-vs-Node on all four addon-loading conventions). Open:

- **implement the deferred non-experimental stubs** — `napi_*_bigint_words`, `node_api_create_external_string_{latin1,utf16}`, `napi_create_external_arraybuffer` (currently loud stubs → several of the 8 ledgered conformance programs).
- **crash-class hardening (deferred, non-blocking)** — null `state->wrap` via a back-pointer to close a theoretical teardown-finalizer sibling-unwrap UAF; Node-parity, not a graduation gate.
- **the 4 `NAPI_EXPERIMENTAL` conformance addons** — `node_api_post_finalizer` / `node_api_create_object_with_properties` / `node_api_is_sharedarraybuffer`.
- **node-gyp golden drift watch** — the node-gyp goldens were generated on Node 24 but CI runs Node 22; watch the first CI run for golden drift.
- **cross-platform prebuilds** — macOS darwin-arm64 SHIPPED incl. the tsfn gate (conformance/consumer/valgrind widening deferred; no maintained arm64-macOS valgrind). **Windows (win32-x64): ATTEMPTED, blocked at gjs-on-Windows** — shim-side portability is done and Linux-verified (`.def` exports, `LoadLibraryEx` loader, manual-dispatch `windows` job); a prebuilt MSVC mozjs-140 now exists (servo/mozjs `mozjs-sys-v140.13.0-0`), but no prebuilt libgjs exists for Windows and servo's patched static-lib layout is not the pkg-config `mozjs-140` gjs's meson consumes, so gjs must still be source-built (clang-cl) — and behind that waits the delay-load host-binding wall (no POSIX global symbol namespace; an unmodified node-gyp `.node` binds `napi_*` against the host `.exe`, which `gjs.exe` does not export). Unblocks when a prebuilt libgjs-win32 appears OR gjs builds against the servo mozjs AND the delay-load host-binding is solved.

### GI/GObject runtime for Node (Axis 5) — deferred limitations

`@gjsify/node-gi` graduated Tier 3→2 per ADR 0005 (2026-07-14) — the four gate items landed (teardown crash, vfunc OUT/INOUT, GTK/Cairo layer, second real consumer), the GIMarshallingTests oracle sits at 370 pass / 0 fail, the Excalibur-WebGL and Adwaita-window/storybook GTK capstones render byte-identically to `gjs -m`, and the cross-runtime legs (Bun full core parity, Deno conformance subset) ship from one N-API binary. The step-by-step roadmap provenance lives in git/CHANGELOG. Known gaps left for follow-up PRs (each surfaces a clear error or is benign; none is silently wrong):

- **Cross-runtime consumer survey — prioritized backlog.** `scripts/node-gi-consumer-harness.mjs` generalizes the consumer proof (a package's OWN GJS suite runs `--app node` on node/bun/deno); the `consumer-suites` CI job gates the proof set `sqlite`+`http2`+`zlib` under `--require-pass`. Full survey + gap report: `docs/reports/node-gi-consumer-survey.{md,json}` — 17 packages already run unchanged. Remaining blockers, priority order: **P3** — GLib/GObject marshalling-helper gaps (`ByteArray.fromGBytes`, `GLib.filename_from_uri` undefined; blocks `child_process`/`os`/`module`); **P4** — `normalizeEncoding`/`checkEncoding` unresolved when a polyfill is `--alias`ed onto Node (`crypto`/`string_decoder`). Follow-ups: full 22-package `test:gjs-on-node` rollout + a non-gating full-survey CI job that publishes the table.
- **Bun/Deno conformance is a curated subset, not the full suite.** Excluded from `test:bun`/`test:deno`: the display/GTK tests (CI Xvfb leg), the `--expose-gc` toggle-ref stress leg (Node's GC-safety gate), and the mainloop/runasync/pump uv-integration cases (they assert the Node-only libuv↔GLib bridges; Bun/Deno drive the non-blocking case via `startMainContextPump`, and `async-gio-await` is ledgered for them accordingly).
- **Reverse-bridge polyfill routing over runtime natives** — on Node the global `fetch` stays the NATIVE undici one (the register convention never overrides an existing native), so `@excaliburjs/plugin-tiled`'s fetch-based fileLoader cannot load the root-relative `/res/…` asset paths our GJS fetch/XHR resolve against the program dir. This is what blocks the FULL `excalibur-jelly-jumper` on `gjsify run --runtime node` — everything else boots. Needs an opt-in GJS-parity-globals mode for reverse-bridge builds (route `fetch`/friends to the `@gjsify/*` polyfills over the runtime natives).
- **Gst audio decode/playback on node-gi is PROVEN on node, bun and deno; the residual is the bun/deno pump requirement.** The former nondeterministic decodebin SEGFAULT was the `(transfer full)` GObject IN-arg ownership bug in `marshal.cc`, fixed; measured clean against PipeWire (a real sink-input owned by the runtime pid, 0 crashes/CRITICALs over repeated runs). The harness verdict: node `pass 62/62`, bun/deno `partial 61/62` — the one failure is `onended` not firing in a BARE script, the already-ledgered no-auto-pump property (`ended` rides a `Gst.Bus` watch on the GLib main context; with the context advancing it fires on bun and deno too). Deciding whether `@gjsify/webaudio` should drive the context itself (it cannot import node-gi — ADR 0005 forbids the hard dep) or whether bun/deno should gain node's auto-pump is a separate cut. No CI leg exercises this (needs a sound device); the harness is the reproducible check. Related test-harness fix already landed: `@gjsify/webaudio`'s `test.mts` awaited the spec directly instead of routing through `@gjsify/unit`'s `run()`, so a broken assertion still exited 0 — the same shape is worth checking on any package whose `test.mts` does not call `run()`.
- **`@gjsify/xmlhttprequest` — on DENO every XHR stalls at `readyState 3`, so an asset loader never completes.** Reproduced on the jelly-jumper showcase (`--app node`, `--runtime deno`): all 26 resource requests reach readyState 3 within 10 ms and then NOTHING — no readyState 4, no load/error events, for the whole run. **Bun runs the identical bundle to completion**, so this is deno-specific. Ruled out by measurement (do not re-investigate): GLib sources fire, microtasks drain inside the blocking `Adw.Application.run()`, `Gio.File.load_contents_async` completes, and the two primitives `readFileUrl()` is built from return correct bytes on deno. The stall is inside `send()`'s `Promise.resolve().then(doFetch)` chain and needs instrumentation INSIDE `@gjsify/xmlhttprequest` (its `__GJSIFY_DEBUG_XHR` logs go through `console.log`, which the `--app node` bundle routes somewhere the terminal does not see — fixing that visibility is step one).
- **vfunc chain-up** — OUT/INOUT args supported; the remaining gap is multi-level JS-override chains (a registered subclass of a registered subclass), rejected with a clear error. INOUT *container* args stay deferred (a catchable throw, like the function path).
- **struct gaps** — struct *construction* (`new Ns.Struct({…})`), array-of-struct-by-value element field reads, and GValue BLOB (byte-array) marshalling (surfaced by the sqlite consumer — a bound `Uint8Array` doesn't persist and a BLOB return comes back as a raw boxed handle).
- **`worker.terminate()` mid-native-call** — the `Error::New` `SIGABRT` funnel is CLOSED (every fallible chain checks the swallowed-failure residue; stress: 0 aborts / 200 terminates on both loop shapes, guarded by `test/worker-terminate.test.mjs`). RESIDUAL: a lower-rate SIGSEGV (12/200 ≈ 6%, identical pre-fix) when the terminate lands while the worker OS thread is inside a blocking GLib C call — the terminating isolate racing an OS thread in native code, with no napi frame; pre-existing, the textbook "terminating a worker mid-native-call is documented-hazardous in Node generally" case. Closing it would need Node/V8 to quiesce in-flight native calls before freeing the worker isolate.

### child_process instant-exit pid — upstream GIO gap (issue #503; rewrite scoped + rejected)

`@gjsify/child_process`'s `spawn()`/`exec` read `child.pid` from `Gio.Subprocess.get_identifier()`, which returns `null` once GSubprocess's child-watch (GLib worker-thread context) reaps the child — so an instant-exit child on a saturated runner can lose its pid (Node always reports one). **Resolved at the test layer** (deterministic alive-when-checked process) + **documented as an upstream GIO limitation** (see Upstream GJS Patch Candidates). The `GLib.spawn_async_with_pipes_and_fds` + `DO_NOT_REAP_CHILD` rewrite was scoped and **rejected for now**: it regresses `child.kill()` to a `/bin/kill` shell-out and reimplements env/cwd/stdio/wait-status reaping on a critical path. Revisit IF: (a) a real consumer needs a reliable pid for instant-exit children, or (b) upstream GIO exposes a spawn-time pid. **Filed upstream: [GNOME/glib#3981](https://gitlab.gnome.org/GNOME/glib/-/work_items/3981)**; maintainer verdict: accessor "would be OK" but de-prioritised in favour of pidfds, so the deterministic alive-process test + spawn-time capture (`_capturePidAtSpawn`) is our stable, permanent posture, not a temporary workaround.

### `linkBins` is not `gjsify.bin`-aware — Node-less GJS consumer gets the wrong `.bin/gjsify`

`linkBins` (`install-backend-native.ts`) links an EXTERNAL package's bins into `node_modules/.bin/` from its npm `bin` field ONLY, never `gjsify.bin`. So a consumer project depending on the published `@gjsify/cli` gets `.bin/gjsify → @gjsify/cli/lib/index.js` (the Node entry) instead of the GJS-first shim `writeWorkspaceBinShims`/`buildBinShim` emits. Harmless wherever Node exists; on a Node-less GJS host it points at the wrong interpreter — a silent-wrong-build for the Node-free promise. Fix: teach `linkBins` to read the extracted package's `gjsify.bin` from disk and emit a GJS-first shim (reuse `buildBinShim`); also harden `mergeWorkspaceBins` against mixed string/object `bin`/`gjsify.bin` forms.

### `spawn(process.execPath, [cliBin, …])` under the GJS bundle (showcase.ts)

`showcase.ts` spawns `spawn(process.execPath, [cliBin, 'dlx', dlxSpec])` — the same `process.execPath`-is-the-bundle trap fixed in `spawnOxcLauncher`. Under the committed GJS bundle `process.execPath` is `gjs`/the `.mjs`, not `node`, so `gjsify showcase <name>` under the GJS bundle spawns the wrong interpreter. Two-part fix (mirror `spawnOxcLauncher`): resolve the launcher via `nodeBinary()`, and use the blocking spawn path under GJS (a command that returns normally must not rely on the async exit event — see AGENTS.md § Lint & format). The deeper root — making async `@gjsify/child_process` spawns usable from CLI commands that return normally — is worth a dedicated fix (would also unblock spawn-based `gjsify test` under GJS).

### `@gjsify/sqlite` exec() compound-statement (CREATE TRIGGER) splitting

`DatabaseSync.prototype.exec()`'s `#splitStatements()` is comment/quote-aware, but still a token-level scanner, not a parser — a compound statement whose body carries inner semicolons is shattered: `CREATE TRIGGER t … BEGIN INSERT …; … END;` splits at the `;` after the inner `INSERT`, yielding `incomplete input`. node:sqlite gets this right because SQLite's real parser knows `BEGIN…END`. **Clean fix = let libgda's own statement tokenizer do the splitting** — currently blocked because `Gda.SqlParser.parse_string()` used iteratively hits a double-free under GJS and `parse_string_as_batch()` returns `Gda.Batch` objects rather than `Gda.Statement`s. A heuristic port of SQLite's `sqlite3_complete()` state machine was considered and NOT taken (mis-handles `CASE…END;`, adds risk to the transaction `BEGIN; … COMMIT;` path). Revisit when the libgda `parse_string` limitation is resolved (then the hand-rolled splitter can be retired entirely).

### oxlint native path — deferred (JS-plugin host needs Node)

`gjsify lint` still spawns the npm `oxlint` Node launcher even under GJS. A `@gjsify/oxlint-native` GI bridge (mirroring `@gjsify/oxfmt-native`) could only run the Rust rule subset: the JS-plugin host that executes `.oxlintrc.json` `jsPlugins` (the internal `gjsify/register-class-order` rule) lives in the Node launcher, so a native lint would silently skip that rule — a worse failure mode than requiring Node. Options when picked up: (a) native lint as an explicit opt-in subset (`GJSIFY_OXLINT=native`, warn when jsPlugins are configured); (b) port `register-class-order` to a Rust rule upstream; (c) wait for oxlint's plugin host to become embeddable without Node. Until then: `gjsify format`/`fix`'s oxfmt half is Node-free under GJS, `gjsify lint` (and the oxlint half of `fix`) needs Node.

### gjsify on Flatpak — remaining roadmap

The `org.freedesktop.Sdk.Extension.gjsify` SDK extension (toolchain under `/usr/lib/sdk/gjsify`, no network and no Node at app-build time, x86_64 + aarch64, `gjsify-tsc` included, e2e-gated incl. a real `flatpak-builder` tier) and the Node-free self-build (the committed GJS bundle rebuilds the CLI itself via native rolldown; e2e `tests/e2e/self-host`) have both landed. Open:

- **Flathub-grade offline-sources build** — vendor via `gjsify flatpak sources` instead of `../` file paths; only needed for an actual Flathub submission, which is itself gated on Flathub's Generative-AI policy (extensions/runtimes are in scope → discretionary "mature, well-maintained" exception; a gjsify-owned OSTree remote sidesteps it).
- **Remaining Node touchpoints for a FULLY Node-free self-build** — oxc lint (oxlint's JS-plugin host needs Node — see the oxlint entry above) + switching the build-orchestrator entry from the Node CLI to `gjs -m cli.gjs.mjs`.
- **`gjsify install --offline`** — a fail-fast-on-cache-miss flag so a no-network sandbox install errors clearly instead of attempting (and slowly failing) a network fetch. Complements `gjsify flatpak sources`.

### Upstream PRs in flight (NativeScript) — track until merged

Two fixes contributed upstream so NS apps work without gjsify-side workarounds. **Both OPEN as of 2026-06-04.** Revisit when either merges + ships in a NativeScript release: drop the corresponding workaround, then bump the version floor / re-validate.

| PR | Fixes | Our interim workaround | Drop when merged + released |
|---|---|---|---|
| [NativeScript/NativeScript#11259](https://github.com/NativeScript/NativeScript/pull/11259) — `fix(vite): support Vite 8 / Rolldown` | `@nativescript/vite`'s function-replacement `resolve.alias` + `@rollup/plugin-commonjs` that Vite 8 / Rolldown reject | `@gjsify/nativescript-vite`'s `applyVite8Fixes()` drops both at compose time | When `@nativescript/vite` ships Vite-8 support, `applyVite8Fixes` can shrink to (or drop) the two fixes — gate on the `@nativescript/vite` version |
| [NativeScript/nativescript-cli#6056](https://github.com/NativeScript/nativescript-cli/pull/6056) — `fix(bundler): copy the vite bundle to native in non-watch builds` | NS CLI copies the Vite bundle into the APK only in watch mode; `ns build` / `ns run --justlaunch` leave `assets/app` empty → SBG fails | `tests/integration/nativescript/scripts/run-on-device.mjs` does `ns prepare` → manual copy → `gradle assembleDebug` | When the fixed NS CLI ships, the runner can use plain `ns build` / `ns run --justlaunch` again |

Check status: `gh pr view 11259 --repo NativeScript/NativeScript --json state` / `gh pr view 6056 --repo NativeScript/nativescript-cli --json state`. No CLA required on either repo; both are auto-reviewed by CodeRabbit — address only blocking findings.

### NativeScript apps that pull web-API third-party deps — eval-time global injection (Welle 5 follow-up)

On-device teapot re-validation confirmed the css-tree fix, but the teapot still does not render on NS V8: its third-party deps (`@nativescript/canvas-polyfill`, `@xmldom/xmldom`, `three`) instantiate web globals at module-evaluation time (`new TextEncoder()` / `new XMLHttpRequest()` / `new FileReader()` at top level) and NS V8 doesn't provide those globals that early. The same class as the `@gjsify/buffer` eager-`TextEncoder` bug, but in deps gjsify doesn't own. The gjsify-side fix is a composer feature: inject/seed the web-API globals (or hoist canvas-polyfill's registration) at the very top of the NS bundle, before any module evaluates — analogous to the GJS `process-stub` `renderChunk` prepend. Design open (which globals; seed-from-`@gjsify/web-*` vs hoist canvas-polyfill; `optimizeDeps`/`renderChunk` prepend). Until then, NS apps whose dependency graph instantiates web globals at eval time (canvas/WebGL/three.js stacks) build but crash on launch; headless logic packages run fine. Related open items:

- **NS CLI 9.0.6 Vite bundle-copy is watch-mode-only** — `compileWithoutWatch` never calls `copyViteBundleToNative`; the smoke runner works around it (manual copy after `ns prepare`); the real fix is the upstream NS-CLI PR above.
- **iOS smoke test** — only Android was validated on-device; the platform path is symmetric (`.ios` extensions, `__IOS__`/`__APPLE__` defines) but unproven; add an iOS build smoke test when a macOS runner is available.
- **Conditional-export precedence** — `resolve.conditions` keep upstream's `browser` active alongside `nativescript`; a package with divergent `browser` vs `nativescript` conditional exports may resolve its `browser` variant. Decide a policy (drop `browser` for NS, or document) + add a regression test.
- **Worker builds** — the upstream `worker` config is passed through verbatim; gjsify transforms are not propagated into `worker.plugins`. Validate + propagate when a worker-using NS showcase lands.
- **Full ownership (Level 3)** — the composer keeps `@nativescript/vite` as an optional peer. Owning the NS-runtime plugins outright remains the larger goal — gated on whether the peer proves a maintenance burden + the upstream NS-CLI pluggable-`bundler` PR.

### NativeScript pillar coverage (Welle 5+, parallel implementations)

The slot backfill (all 80 declarable packages), `@gjsify/native-fs-bridge`, the `@gjsify/crypto` NS entry and the on-device integration suite have landed. Remaining Wellen (each a separate PR/worktree):

- **Welle 5-D — `@gjsify/stream` + `@gjsify/http`-client** (M): client-side over NS' native `fetch()`; server-side (`createServer` etc.) throws ENOTSUP; `runtimes.nativescript: 'partial'`.
- **Welle 5-F — extend `tests/integration/nativescript/`** per pillar as 5-D lands (CI runner may need a privileged container for the NS emulator stack).
- **Welle 5-G — `gjsify create-app --template nativescript-*`** (M): mobile-app scaffold templates. Adwaita-feel-on-mobile is an open design question — could use NS' native UI with gjsify polyfills providing the data layer.

### NativeScript build-feature ownership — Level 3 (gjsify as a first-class NS production bundler)

Level 2 (platform file resolution + platform defines) is owned by gjsify. **Level 3 (north-star, L, multi-week):** make `gjsify build --app nativescript` (or the Vite preset) produce a standalone NS-loadable production bundle, replacing `@nativescript/{webpack,vite}` for the JS-bundling step. The NS-runtime subset still to replicate: main-entry + bundle-emit to NS's expected dist layout (≈150 LOC sans HMR), static-copy of `App_Resources`/fonts/assets, the `@NativeClass()` transform (≈43 LOC), optionally app-components/XML page registration (≈278 LOC — skippable for code-only canvas apps) + CSS/theme-core. HMR is the bulk of `@nativescript/vite`'s complexity and is NOT needed to ship (production-only target). **Hard blocker:** NS's CLI bundler dispatch is a hardcoded `webpack|rspack|vite` switch — `bundler: 'gjsify'` needs an upstream NS-CLI PR for a pluggable bundler, OR gjsify masquerades under the `vite` name (current Level-1 path). The spawn contract is discoverable (`node <bundler>/bin build --config=<path>`, `NATIVESCRIPT_BUNDLER_ENV` JSON env, dist copied into APK assets).

### Website & docs follow-ups

Collected user-tracked items — every one turns existing engineering work into something visible / measurable for users.

- **Test + extend the new showcases, then embed them on the website.** Each showcase needs: (1) a manual smoke-test on GJS (`gjsify showcase <name>` end-to-end), (2) gaps turned into fixes or tracked follow-ups, (3) a `website/src/content/docs/showcases/<name>.mdx` page embedding the browser entry for live demo + describing the GJS counterpart.
- **Bridge widgets docs on website.** `@gjsify/canvas2d` / `@gjsify/webgl` / `@gjsify/iframe` / `@gjsify/video` are documented inline in AGENTS.md but there is no user-facing doc explaining the pairing matrix (DOM element ↔ Bridge class ↔ GTK widget) and the `installGlobals()`/`onReady()` lifecycle. Target one Astro page under `website/src/content/docs/framework/bridges.mdx` with a minimal worked example per bridge.
- **Web/Node compat as progress bars on the website.** The Summary table is consumed by `website/scripts/generate-coverage.mjs` → `src/data/coverage.ts`; extend the same treatment per package on the detail pages.
- **Ship `gjsify` and `ts-for-gir` themselves as Flathub CLI apps.** The `gjsify flatpak --cli-only` path already produces the right shape; take both CLIs through the full Flathub-submission flow (manifest in `flathub/<app-id>`, `flatpak-builder` validation, appstreamcli + `flatpak-builder-lint`, screenshots/release notes).

### WebGL deferred items (Workstream D)

- **Optional headless drawing-buffer pre-allocation.** `_init()` (`webgl-context-base.ts`) leaves the headless-gl-style `_allocateDrawingBuffer` call commented out because `GtkGLArea` owns the surface. Re-enable if/when a non-GTK output path is added.

### Flatpak helper subcommands — downstream adoption (PR3–PR6)

`gjsify flatpak {init,build,deps,ci}` and the bundler-side primitives they lean on have landed. Remaining downstream work: PR3 (ts-for-gir-cli adopts `defineFromPackageJson`), PR4 (app-gnome Vite → `gjsify build`), PR5 (app-gnome flatpak workflow on top of `gjsify flatpak`), PR6 (CLI-flatpak example docs page — the documented `org.gjsify.TsForGir` shape: GNOME Platform runtime + read-only `/usr/share/gir-1.0` mounts).

### TLS gaps that Gio does not surface (Workstream B follow-up)

Server-side SNI, session resumption and channel binding are resolved (see the `@gjsify/tls`/`tls-native` status entries). Remaining gaps map to GnuTLS/OpenSSL features Gio's GI bindings do not expose:

- **OCSP stapling.** Neither client- nor server-side OCSP is exposed by Gio (`gnutls_ocsp_status_request_*` has no GI binding), so `tls.connect({requestOCSP})` / the `'OCSPResponse'` event cannot be implemented end-to-end without a native bridge wiring `request_ocsp_status` into `Gio.TlsConnection`. Partial unblocker shipped: `@gjsify/tls-native` Phase 1 `parseOcspResponse(bytes)` (RFC 6960 DER parser), surfaced via `@gjsify/tls` with the `hasOcspSupport()` graceful-degradation gate — consumers can fetch OCSP responses themselves (e.g. via the cert's AIA responder URL) and validate status without bypassing Gio's TLS stack. The Gio-side `request_ocsp` wiring (responses arriving automatically over the handshake) stays open.
- **DH params / explicit ECDH curves / ticket-key rotation.** Gio does not expose `g_tls_server_connection_set_dh_params` or equivalent. Server tuning happens via `GIO_USE_TLS=gnutls` env at process level; not per-connection.

### SharedArrayBuffer constructor opt-in (Mozilla pref)

- **`SharedArrayBuffer` constructor is unavailable in stock GJS** (`typeof SharedArrayBuffer` is `undefined` on GJS 1.88): Mozilla disables it unless the SpiderMonkey embedder opts in, and GJS does not. Upstream patch candidate: enable the SharedMemory pref in `gjs/engine.cpp` + the matching `Atomics.wait`/`notify` capability bits. Workaround landed: `@gjsify/sab-native`'s `SharedBuffer` (method-accessor API + free-function `atomics` namespace over memfd/mmap/futex) does not require the constructor at all and is wired into `Worker.postMessage`.
- **Generic `ArrayBuffer` cross-process transferList.** `Worker.postMessage(value, transferList)` for a plain `ArrayBuffer` (not a `SharedBuffer`) still goes through JSON IPC and stays a deep-clone, not a zero-copy hand-off — the SCM_RIGHTS side-channel only carries memfd-backed regions; arbitrary ArrayBuffers would need a generic binary IPC frame format (or a SharedBuffer-as-ArrayBuffer wrapper the structured-clone layer recognises). Lower priority — SharedBuffer covers the high-bandwidth workloads.

Use `@gjsify/worker_threads` `MessageChannel` (in-process) for zero-copy / pure-`ArrayBuffer` workloads today; cross-process SharedBuffer for shared-memory workloads across subprocess workers.

### ts-for-gir — extend integration suite beyond Phase 4b

Strategic goal: `ts-for-gir` runs unmodified on GJS. Phases 1–9 have landed (see the integration-coverage notes). Remaining:

- **Phase 6 / gjsify run:** runtime npm-package resolution for GJS bundles (GJS has no node_modules resolver; would need a C-level patch).
- **Phase 8 / GVariant type-inference:** full port of `gvariant-validation.test.ts` — requires `@girs` ambient declarations resolvable by the TypeScript compiler.

`refs/ts-for-gir/` is pinned at the commit corresponding to `@gi.ts/parser@4.0.0-rc.9`; bump the submodule alongside the published-package version when porting future phases.

### Universal DOM Container (`@gjsify/dom-bridge`)

Architectural vision for unified DOM-in-GTK: `document.createElement("canvas")` + `getContext("2d")` automatically creates the right GTK widget behind the scenes; `document.body` maps to a real GTK container hierarchy; each child element gets its own bridge transparently — making browser code "just work" in GTK without explicit bridge creation. Deferred from the initial bridge architecture — requires deeper integration between `Document`, `Element.appendChild`, and the GTK widget tree.

### Autobahn — wire into CI

Full Autobahn suite (core + permessage-deflate + performance 9.\*) is part of the committed baseline. Remaining: (1) the `6.4.x` NON-STRICT fragmented-text timing needs an upstream libsoup change (fragment-level UTF-8 validation — see Upstream GJS Patch Candidates); (2) Podman-in-CI needs privileged containers (or socket sharing) the Fedora-based CI doesn't currently grant — until then the suite is a manual opt-in run + baseline-commit workflow. Plan: wire the autobahn scripts into a nightly CI job once Podman-in-CI is unblocked.

### Autobahn driver — `System.exit()` bypass in bundled driver context

`System.exit(0)` called from the bundled driver's `Promise.then` continuation silently returns without terminating the gjs process (the GLib main loop `ensureMainLoop()` starts for Soup keeps the process alive after `main()` resolves), even though the same call works from a standalone script or a MainLoop idle callback. `scripts/run-driver.mjs` compensates with a watchdog (waits for the `Done.` marker, 3 s grace, then SIGKILL — no data loss; the report is flushed before `Done.`). Next steps to remove it: isolate whether the block is in `@gjsify/process`'s `exit()` shim, the `globalThis.imports` patching, or an interaction with `@gjsify/node-globals/register`; write a minimal reproducer outside the Autobahn pillar; fix root-cause and inline `gjs -m dist/driver-*.gjs.mjs` back into the package scripts.

### `@gjsify/sqlite` — expand API surface

Libgda does not expose session/changeset, WAL-mode toggles, backup or VFS APIs, so those are open gaps beyond the current DatabaseSync/StatementSync coverage. The closest paths: (a) wrap sqlite3 directly via libsqlite3 GI bindings (expensive — no upstream GIR), or (b) live with the libgda-shaped subset and document the gaps per API. (b) is the current direction; `sqlite.constants` (SQLITE_CHANGESET_\*) remains unimplemented until (a).

### WebRTC showcases (extended)

`webrtc-loopback` is a published showcase. Open follow-ups: `webrtc-video` could be a second showcase (getUserMedia + media pipeline; needs camera-permission UX — separate workstream); `webrtc-dtmf` / `webrtc-states` / `webrtc-trickle-ice` remain private reference implementations for specific spec behaviors, not end-user showcases.

---

## Upstream GJS Patch Candidates

<!-- Authored "Upstream GJS Patch Candidates" table for STATUS.md. Workarounds we
     maintain that could be eliminated with upstream GJS/SpiderMonkey/GLib/libsoup
     patches, ordered by impact. A SOLVED row is DELETED (its record is the commit
     + CHANGELOG that closed it). The status-data check requires this exact
     4-column header. -->

Workarounds we maintain that could be eliminated with upstream patches. Ordered by impact — features where an upstream fix would benefit the most gjsify packages.

| Workaround | Affected Packages | Current Solution | Upstream Fix |
|-----------|-------------------|------------------|-------------|
| **`Gda.SqlParser.parse_string()` corrupts the heap (`free(): invalid pointer`, process abort) when the parsed statement contains a `/* … */` block comment.** A `--` line comment parses fine; a block comment — leading, trailing, or mid-statement — triggers a double/invalid free inside libgda's lexer (`gi://Gda?version=6.0`, libgda 6.0 SQLite provider). Verified with a minimal reproducer: `parser.parse_string('/* c */ CREATE TABLE b(y TEXT)')` aborts the GJS process. | @gjsify/sqlite (`DatabaseSync.prototype.exec` / `prepare` — any SQL with a block comment) | `#splitStatements()` **strips comments** from each chunk before `parse_string()` sees them (line comments removed keeping the newline; block comments replaced with a space). Semantically transparent — SQL comments are inert outside quoted regions, which are preserved verbatim. The crash is unreachable from the public API as a result. | **Fix libgda's SQL lexer** (`libgda/sql-parser/` — the Flex/Lemon-generated tokenizer) so block comments are skipped without the bad free, OR expose a comment-stripping pre-pass. Until then comment-stripping in the splitter is the only safe option; it also blocks the long-term "let libgda tokenize/split" cleanup (see Open TODOs). |
| `imports.byteArray.fromGBytes(gbytes)` memcpy's GBytes data into a fresh `JS::ArrayBuffer` even when the source GBytes wraps mutable mmap'd memory via `g_bytes_new_with_free_func`. `refs/gjs/gjs/byteArray.cpp::from_gbytes_func` does this deliberately — but that immutability assumption is wrong for our use case. | @gjsify/sab-native (`SharedBuffer.viewBytes`, `SharedBuffer.toBuffer`, `Buffer.from(sharedBuffer)`), and any future package that wants to expose mmap'd memory as a JS-mutable view | `viewBytes()` and `toBuffer()` are documented as fresh copies in current GJS. `readBytes()` keeps the same memcpy semantics it always had. Callers needing in-place mutation through a Buffer use `writeBytes()` to commit changes back. | **Add an explicit zero-copy path in GJS `byteArray`** — e.g. a sibling `byteArray.fromGBytesShared(gbytes)` that calls `JS::NewExternalArrayBuffer` instead of `JS::NewArrayBuffer + memcpy`. Caller-attests the GBytes is mutable + alignment-safe. **No internal alternative is viable today**: `JS::NewExternalArrayBuffer` requires a `JSContext*` which GJS does not expose to GObject-introspected `.so` plugins (verified — no native package in the monorepo links against `mozjs140`). A Vala/C-shim cannot call SpiderMonkey directly without first patching GJS to expose the JSContext (or add the helper itself). |
| `setTimeout` / `setInterval` return a `GLib.Source` BoxedInstance whose `.unref()` is `g_source_unref` (GLib refcount decrement) — clashes with Node.js `Timeout.unref()` ("don't keep event loop alive", refcount-irrelevant). Node-compat libraries (WebTorrent, bittorrent-dht, async-limiter, …) call `timer.unref()` as standard, each call partially frees the source → SIGSEGV in `g_source_unref_internal` at SM GC finalization. Compounded by GJS `_timers.js` calling `releaseSource(source)` before `drainMicrotaskQueue()`, opening a window where SM GC can finalize the BoxedInstance while GLib still holds a dispatch ref. | @gjsify/node-globals (timers), any Node.js code using setTimeout/setInterval under load, any GJS code that lets GLib.Source BoxedInstances reach the GC | `packages/node/globals/src/register/timers.ts`: full replacement of setTimeout / setInterval via `GLib.timeout_add` (numeric source ID, no BoxedInstance). Returns a Node-shaped `GjsifyTimeout` wrapper with no-op `.ref / .unref / .hasRef` and working `.refresh / Symbol.dispose / Symbol.toPrimitive`. Also monkey-patches `GLib.Source.prototype.ref / .unref` to no-op as a safety net for BoxedInstances that leak from other gi APIs. | **Two changes in GJS `_timers.js`** (modules/esm/\_timers.js): (1) reorder the dispatch closure so `drainMicrotaskQueue()` runs BEFORE `releaseSource(source)`, closing the SM-GC-during-drain window. (2) expose a Node-compatible `Timeout.unref() / .ref()` that tracks a "keep event loop alive" flag **instead of** mapping to `g_source_unref / g_source_ref`. Both changes can land independently; (2) alone eliminates the crash for Node-compat consumers. |
| Web Streams (`ReadableStream`, `WritableStream`, `TransformStream`) not exposed as globals | compression-streams, fetch body streaming, EventSource, any Web Streams consumer | Cannot use W3C Compression Streams API or TransformStream-based polyfills on GJS without `@gjsify/web-streams` | Expose Web Streams API globals (already available in SpiderMonkey / Firefox) |
| `structuredClone` not available as global in GJS ESM | worker_threads, potentially all packages using message passing | Full polyfill in `@gjsify/utils` (`structured-clone.ts`) — supports Date, RegExp, Map, Set, Error types, ArrayBuffer, TypedArrays, DataView, Blob, File, circular refs, DataCloneError | Expose `structuredClone` as global in GJS ESM context (already available in SpiderMonkey) |
| `TextDecoder` malformed UTF-8 handling differs across SpiderMonkey versions | string_decoder | Pure manual UTF-8 decoder implementing the W3C maximal-subpart algorithm (`utf8DecodeMaximalSubpart`) | Fix SpiderMonkey's `TextDecoder` to follow the W3C encoding spec for maximal subpart replacement |
| `queueMicrotask` not exposed as global in GJS 1.86 | timers, stream (any code needing microtask scheduling) | `Promise.resolve().then()` workaround | Expose `queueMicrotask` as global (already exists in SpiderMonkey) |
| **Top-level `await` + a registered main-loop hook + process exit from an async continuation deadlocks.** `imports.system.exit()` only sets GJS's internal `m_should_exit` flag + throws the uncatchable exit exception — it does **not** call `loop.quit()`. With a hook registered (which `ensureMainLoop()` does via `GLib.MainLoop.runAsync()`), `eval_module` drives the hook's **blocking** `loop.run()`; a bare `system.exit()` from a microtask never unblocks that nested loop, so the process hangs. Specific to a registered hook. Microtask draining is NOT affected — only teardown hangs. | @gjsify/utils (`ensureMainLoop`), and any entry module that combines top-level `await` with a server started via `ensureMainLoop()` | **Already mitigated for `process.exit()`:** `@gjsify/process`'s `exitProcess()` idle-schedules `quitMainLoop()` + `system.exit()`, so the process exits cleanly. The hole is only a **direct** `imports.system.exit()` from an async continuation under TLA, which gjsify cannot intercept. Documented guidance + a `main-loop.ts` JSDoc warning steer entry modules to a `main().catch(…)` body or an explicit `GLib.MainLoop().run()` torn down via `process.exit()`. Runnable proof: `docs/poc/tla-microtask-draining.gjs.mjs` + `.md`. | **Make a registered main-loop hook observe GJS's exit flag.** In `eval_module`/`run_main_loop_hook`, when `m_should_exit` is set from inside a job, quit the hook's loop (or document that hooks MUST be quit explicitly). Then a bare `system.exit()` from any continuation would terminate cleanly regardless of TLA. |
| `Gio.Subprocess.get_identifier()` returns `null` once the child is reaped — and GSubprocess reaps via a `g_child_watch_source` on the GLib **worker thread** context, so an instant-exit child can be reaped between `spawnv()` and the synchronous `get_identifier()`. Result: `child.pid` is `undefined` for a fast child under load, whereas Node always reports a numeric pid for a successful spawn. | @gjsify/child_process (`spawn`/`exec` `ChildProcess.pid` for instant-exit children) | `pid` is captured on the statement immediately after `spawnv()` (`_capturePidAtSpawn`) — the narrowest possible window; reliable for long-lived processes (the realistic pid consumers), best-effort for instant-exit children. All pid assertions spawn an alive-when-checked process. The `DO_NOT_REAP_CHILD` rewrite was scoped + rejected (regresses `child.kill()` to a shell-out, reimplements env/cwd/stdio/wait-status on a critical path). | **Expose the spawn-time pid in `Gio.Subprocess`** — keep `get_identifier()` returning the historical pid after reap, or add a spawn-time `pid` accessor. **Filed upstream:** [GNOME/glib#3981](https://gitlab.gnome.org/GNOME/glib/-/work_items/3981) (pure-C reproducer + proposed `g_subprocess_get_initial_identifier()`). **Maintainer verdict:** accessor "would be OK" but de-prioritised in favour of pidfds ([#1866](https://gitlab.gnome.org/GNOME/glib/-/issues/1866)) ⇒ no near-term upstream fix; the alive-process test + spawn-time capture is the stable downstream answer. |
| `Soup.WebsocketConnection` only emits the coalesced `message` signal — no fragment-level / frame-level hook is exposed over GI. A text message with invalid UTF-8 in a later fragment is only validated after libsoup has buffered the entire message, so the RFC 6455 "fail the connection at the first invalid byte" timing is unreachable from JS. | @gjsify/websocket (manifests as Autobahn cases 6.4.1–6.4.4 `behavior: NON-STRICT, behaviorClose: OK, remoteCloseCode: 1007`) | None needed at the application layer — libsoup itself sends close 1007 at end-of-message, which is RFC-correct but "late" by Autobahn's strict timing definition. No code is shipped to work around this. | **libsoup patch (`soup/websocket/*`)** — expose either a per-frame `incoming-fragment` signal or an opt-in "validate-as-you-go" mode on `SoupWebsocketConnection` for text opcodes. Either shape flips 6.4.x from NON-STRICT to strictly-OK. |
| **Deferred-GC SIGSEGV from JS-Boxed Sources allocated outside @gjsify/http.** Even with `@gjsify/http-soup-bridge` eliminating libsoup-side exposure, the MCP example still SIGSEGVs ~13 s after a single Node.js fetch with chunked SSE. Backtrace identical to the historic Boxed-Source race (`BoxedBase::finalize → g_source_unref` from GJS's deferred-GC heuristic), but the offending wrapper is allocated somewhere in the MCP-SDK / @hono/node-server / web-streams stack. Bridge alone (no MCP SDK) survives 30 s + 50 sequential SSE fetches; with MCP SDK loaded, ~13 s. | examples/node/net-mcp-server (and any consumer pulling MCP SDK / Hono / web-streams polyfills into a long-running GJS process) | **Diagnostic helper:** `installCriticalLogWriter()` in `@gjsify/utils/log-writer.ts` prints a one-time `G_DEBUG=fatal-criticals` advisory at server startup so users get a SIGABRT with backtrace + coredump rather than a silent SIGSEGV. **Test cap:** `mcp-inspector-cli` sequential-call loop runs N ≤ 4 iterations to stay under the ~10 s deferred-GC window. Mitigations attempted and rejected: eager `imports.system.gc()` after each response (corrupts in-flight state), idle-only GC gated on `_inFlightCount === 0` (paused long-polls keep it above zero), force-`Connection: close` (doesn't change the window). | **Identify the offending Boxed.** A coredump with full debug symbols (libsoup-debuginfo + mozjs140-debuginfo + a GIWrapperBase break-on-finalize) would name the type. Likely candidates: a `GLib.Source` returned by a web-streams scheduler, or an MCP-SDK-internal `Gio.Cancellable.create_source()` result not pinned past its cancellable. Once identified, fix the GIR transfer-mode annotation OR pin the wrapper from JS until its underlying resource is released. |

## Changelog

All dated entries live in [CHANGELOG.md](CHANGELOG.md). Do not duplicate them here.
