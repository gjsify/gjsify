# gjsify — Project Status

> Last updated: 2026-03-24 (after Phase 7)

## Summary

gjsify implements Node.js and Web Standard APIs for GJS (GNOME JavaScript / SpiderMonkey 128).
The project comprises **39 Node.js packages**, **7 Web API packages**, **3 GJS infrastructure packages**, and **7 build tools**.

| Category | Total | Full | Partial | Stub |
|----------|-------|------|---------|------|
| Node.js APIs | 39 | 27 (69%) | 5 (13%) | 7 (18%) |
| Web APIs | 7 | 7 (100%) | — | — |
| GJS Infrastructure | 3 | 2 | 1 (types) | — |
| Build Tools | 7 | 7 | — | — |

**Test coverage:** ~2,100 test cases in 69+ spec files. CI via GitHub Actions (Node.js 24.x + GJS on Ubuntu 24.04).

---

## Node.js Packages (`packages/node/`)

### Fully Implemented (27)

| Package | GNOME Libs | Tests | Description |
|---------|-----------|-------|-------------|
| **assert** | — | 73 | AssertionError, deepEqual, throws, strict mode |
| **async_hooks** | — | 26 | AsyncLocalStorage, AsyncResource, createHook |
| **buffer** | — | 123 | Buffer via Blob/atob/btoa, alloc, from, concat |
| **child_process** | Gio, GLib | 35 | exec/execSync, execFile/execFileSync, spawn/spawnSync via Gio.Subprocess; cwd/env via Gio.SubprocessLauncher |
| **console** | — | 57 | Console class with stream support |
| **diagnostics_channel** | — | 26 | Channel, TracingChannel, subscribe/unsubscribe |
| **dns** | Gio, GLib | 50 (2 specs) | lookup, resolve4/6, reverse via Gio.Resolver + dns/promises |
| **events** | — | 119 | EventEmitter, once, on, listenerCount (707 lines) |
| **fs** | Gio, GLib | 40 (6 specs) | sync, callback, promises, streams, FSWatcher |
| **module** | Gio, GLib | 21 | builtinModules, isBuiltin, createRequire (with JSON loading and module resolution) |
| **net** | Gio, GLib | 35 | Socket (Duplex via Gio.SocketClient), Server (Gio.SocketService), isIP/isIPv4/isIPv6 |
| **os** | GLib | 240 | homedir, hostname, cpus (real times from /proc/stat), platform-specific |
| **path** | — | 41 | POSIX + Win32 (1,052 lines total) |
| **perf_hooks** | — | 30 | performance (Web API / GLib fallback), monitorEventLoopDelay, mark/measure/getEntries |
| **process** | GLib | 47 | EventEmitter-based, env, cwd, platform, exit |
| **querystring** | — | 63 | parse/stringify with full encoding |
| **stream** | — | 66 | Readable, Writable, Duplex, Transform, PassThrough |
| **string_decoder** | — | 65 | UTF-8, Base64, hex, streaming |
| **timers** | — | 43 (2 specs) | setTimeout/setInterval/setImmediate + timers/promises |
| **tty** | — | 23 | ReadStream/WriteStream, isatty, ANSI, clearLine, cursorTo, getColorDepth |
| **url** | GLib | 82 | URL, URLSearchParams via GLib.Uri |
| **util** | — | 110 | inspect, format (%%, -0, BigInt, Symbol), promisify, types |
| **zlib** | — | 27 | gzip/deflate/deflateRaw round-trip, constants, Unicode, binary, cross-format errors |
| **dgram** | Gio, GLib | 20 | UDP Socket via Gio.Socket with bind, send, receive, multicast |
| **globals** | — | 40 | process, Buffer, structuredClone, TextEncoder/Decoder, atob/btoa, URL, setImmediate |
| **readline** | — | 50 | Interface, createInterface, question, prompt, async iterator, clearLine, cursorTo |

### Partially Implemented (5)

| Package | GNOME Libs | Tests | Working | Missing |
|---------|-----------|-------|---------|---------|
| **crypto** | GLib | 119 (9 specs) | Hash, Hmac, randomBytes/UUID, PBKDF2, HKDF, Cipher/Decipher (AES-CBC/CTR/ECB/GCM), scrypt, **DH, ECDH, Sign/Verify, publicEncrypt/privateDecrypt** | KeyObject, X509Certificate |
| **http** | Soup 3.0, Gio, GLib | 93 (2 specs) | Server (Soup.Server), **ClientRequest (Soup.Session)**, IncomingMessage, ServerResponse, STATUS_CODES, Agent, **round-trip on GJS** | — (fully functional) |
| **https** | — | 17 | Agent (defaultPort 443, protocol https:), request/get wrapper | createServer with TLS |
| **tls** | Gio, GLib | 19 | TLSSocket (encrypted, getPeerCertificate, getProtocol, getCipher), connect, createSecureContext | createServer, TLS session resumption, ALPN |
| **worker_threads** | Gio, GLib | 56 | MessageChannel, MessagePort (EventEmitter-based, auto-start, clone via structuredClone), BroadcastChannel, receiveMessageOnPort, environmentData, Worker (Gio.Subprocess with stdin/stdout IPC, bootstrap script, eval mode) | SharedArrayBuffer, transferList, Worker file-based (requires pre-bundled .mjs) |

### Stubs (7)

| Package | Tests | Description | Effort |
|---------|-------|-------------|--------|
| **cluster** | ✓ | isPrimary, isMaster, isWorker; fork() throws | High — requires multi-process architecture |
| **domain** | ✓ | Deprecated Node.js API; pass-through | Low — intentionally minimal |
| **http2** | ✓ | Only constants exported; create* throws | High — HTTP/2 protocol is complex |
| **inspector** | ✓ | Session.post(), open/close; empty | Medium — V8-specific, hard to port |
| **v8** | ✓ | getHeapStatistics (JSON-based), serialize/deserialize | Medium — V8-specific |
| **vm** | ✓ | runInThisContext (eval), Script class | Medium — sandbox isolation limited |

---

## Web API Packages (`packages/web/`)

All 8 packages have real implementations:

| Package | LOC | GNOME Libs | Tests | Web APIs |
|---------|-----|-----------|-------|----------|
| **dom-events** | 1,323 | — | 97 | Event, EventTarget, CustomEvent, DOMException |
| **fetch** | 1,674 | Soup 3.0, Gio, GLib | 24 | fetch(), Request, Response, Headers, Referrer-Policy |
| **formdata** | 438 | — | ✓ | FormData, File, multipart encoding |
| **abort-controller** | 291 | — | 19 | AbortController, AbortSignal (.abort, .timeout, .any) |
| **globals** | 14 | — | 1 | Re-export of dom-events + abort-controller |
| **html-image-element** | 347 | GdkPixbuf | 2 | HTMLImageElement, Image() |
| **webgl** | 5,662 | gwebgl, Gtk 4, Gio | 12 | WebGLRenderingContext (1.0), Canvas, Extensions |
| **websocket** | 230 | Soup 3.0, Gio, GLib | 27 | WebSocket, MessageEvent, CloseEvent (W3C spec) |

### Missing Web APIs

Not yet implemented (but potentially relevant for GJS projects):

| API | Priority | Notes |
|-----|----------|-------|
| **TextEncoder/TextDecoder** | Medium | Partially available natively in GJS; polyfill for encoding variants |
| **crypto.subtle (WebCrypto)** | Medium | Partially possible via GLib.Checksum |
| **URL/URLSearchParams (global)** | Low | Exists in @gjsify/url, missing as global export |
| **Blob/File (global)** | Low | Partially native in GJS; globals package could re-export |
| **ReadableStream/WritableStream** | Low | Web Streams API — foundation for fetch body |
| **structuredClone** | Low | Natively available in SpiderMonkey 128 |
| **Performance (global)** | Low | @gjsify/perf_hooks exists; Web export missing |

---

## Build Infrastructure

| Package | Function | Status |
|---------|----------|--------|
| **@gjsify/cli** | `gjsify build` CLI | Full |
| **esbuild-plugin-gjsify** | Platform orchestration (GJS/Node/Browser) | Full |
| **esbuild-plugin-alias** | Module alias resolution | Full |
| **esbuild-plugin-transform-ext** | Normalize import extensions | Full |
| **esbuild-plugin-deepkit** | Deepkit type reflection | Full |
| **resolve-npm** | Central alias registry (60+ mappings) | Full |
| **empty** | Stub module for platform exclusion | Full |

**GJS Infrastructure:**

| Package | Function | Status |
|---------|----------|--------|
| **@gjsify/unit** | Test framework (describe/it/expect) | Full |
| **@gjsify/utils** | Gio wrappers, process info, encoding | Full |
| **@gjsify/types** | GIR TypeScript bindings | Manual |

---

## GNOME Library Usage

| GNOME Lib | Used In |
|-----------|---------|
| **Gio 2.0** | fs, net, dns, child_process, dgram, tls, module, fetch |
| **GLib 2.0** | crypto, url, os, process, dns, child_process, dgram, tls, module |
| **Soup 3.0** | http, fetch |
| **Gtk 4.0** | webgl |
| **GdkPixbuf 2.0** | html-image-element |
| **gwebgl 0.1** | webgl (Vala extension) |

---

## Metrics

| Metric | Value |
|--------|-------|
| Total Node.js packages | 39 |
| Fully implemented | 27 (69%) |
| Partially implemented | 5 (13%) |
| Stubs | 7 (18%) |
| Web API packages | 7 (all implemented) |
| Total test cases | ~2,100 |
| Spec files | 69+ |
| GNOME-integrated packages | 13 (28%) |
| Alias mappings (GJS) | 60+ |
| Reference submodules | 27 |

---

## Priorities / Next Steps

### High Priority

1. **Complete crypto** — ~~Cipher/Decipher (AES)~~✓, ~~scrypt~~✓. Still open: Sign/Verify, DH/ECDH, KeyObject, AES-GCM. References: `refs/browserify-sign/`, `refs/create-ecdh/`, `refs/diffie-hellman/`.
2. **http client-side** — Fully implement `http.request()`, `http.get()` via Soup.Session. References: `refs/undici/`, `refs/stream-http/`.
3. **https** — Building on http + tls.
4. **WebSocket (Web API)** — Soup.WebsocketConnection as foundation.

### Medium Priority

5. **Complete readline** — Cursor navigation, history, tab completion.
6. **tls server-side** — createServer, session resumption.
7. **Increase test coverage** — Especially for crypto, http, net, tls. Port more tests from `refs/node-test/` and `refs/bun/test/`.
8. **worker_threads** — Investigate whether GJS threads or GLib.Thread are usable.

### Low Priority

9. **vm** — Sandbox isolation via SpiderMonkey Realms (experimental).
10. **v8** — Approximate heap statistics via GJS runtime info.
11. **cluster** — Multi-process via Gio.Subprocess pool.
12. **http2** — Soup 3.0 partially supports HTTP/2 natively.
13. **inspector** — GJS debugger integration (gjs --debugger).

---

## Changelog

### 2026-03-24 — Phase 7: worker_threads — From Stub to Partial

**Promoted worker_threads from Stub → Partial** with full MessageChannel/MessagePort/BroadcastChannel implementation and subprocess-based Worker prototype:

- **MessagePort** (EventEmitter-based): `postMessage` with `structuredClone`, auto-start on `on('message')`, message queue for pre-start delivery, `close()` with cleanup, `ref()`/`unref()` stubs
- **MessageChannel**: Creates paired MessagePorts for bidirectional communication
- **BroadcastChannel** (W3C API): Global registry by name, `onmessage` property, `addEventListener`/`removeEventListener`, `close()` with registry cleanup, no self-delivery
- **Worker** (Gio.Subprocess): Spawns `gjs` child process with embedded bootstrap script, stdin/stdout IPC (newline-delimited JSON), `postMessage`/`on('message')`/`terminate()`, `eval: true` mode, environment variable passthrough
- **Worker context detection**: `globalThis.__gjsify_worker_context` flag lets bundled worker scripts import correct `parentPort`/`workerData`/`threadId` from `worker_threads`
- **Utility functions**: `receiveMessageOnPort` (synchronous dequeue), `getEnvironmentData`/`setEnvironmentData`, `markAsUntransferable`, `markAsUncloneable`, `moveMessagePortToContext`
- **56 tests** (was 6): exports, MessageChannel message delivery (string/object/multi/order), clone verification, MessagePort auto-start/close/once, receiveMessageOnPort (empty/sync/dequeue), BroadcastChannel (same-name/self/different-name/closed/multi-receiver), environmentData CRUD, utility functions
- All 56 tests pass on both Node.js 24 and GJS 1.86

**Research findings documented:**
- GJS intentionally blocks `GLib.Thread.new()` (throws "Use GIO async methods or Promise()")
- SpiderMonkey JSContext is thread-bound — no parallel JS execution possible in-process
- Subprocess-based approach (Ansatz A) is the only viable path for true parallelism
- Vala extension approach (Ansatz B) would require wrapping `gjs_context_new()` — unstable API
- libpeas (Ansatz C) is designed for plugins, not worker pools

### 2026-03-24 — Phases 1–5: Major Feature Implementation

**Phase 1 — HTTP client round-trip on GJS:**
- Fixed ClientRequest to buffer response body before emitting 'response' (race condition fix)
- Fixed ServerResponse double 'finish' emission
- Fixed stream nextTick to prefer queueMicrotask
- All 93 HTTP tests now pass on GJS (6 round-trip tests: GET, POST, headers, 404, etc.)

**Phase 2 — WebSocket Web API:**
- New package `@gjsify/websocket` using Soup 3.0 WebsocketConnection
- W3C spec: WebSocket, MessageEvent, CloseEvent, text + binary support
- 27 tests including 3 round-trip tests with echo server

**Phase 3 — Crypto DH/ECDH/AES-GCM:**
- DiffieHellman: BigInt-based, RFC 2409/3526 groups (modp1–modp18)
- ECDH: Pure TypeScript elliptic curve arithmetic (secp256k1, P-256, P-384, P-521)
- AES-GCM: GHASH authentication in GF(2^128), AAD support
- 30 new tests

**Phase 4 — Crypto Sign/Verify/RSA:**
- ASN.1/DER/PEM parser for RSA keys (PKCS#1 and PKCS#8)
- createSign/createVerify: RSA PKCS#1 v1.5 signatures
- publicEncrypt/privateDecrypt: RSA encryption
- 11 new tests

**Phase 5 — TLS server, fs async, STATUS.md updates**

### 2026-03-23 — Phase 0: Housekeeping

- Reclassified **globals** from Partial → Full (40 tests, all essential globals implemented)
- Reclassified **readline** from Partial → Full (50 tests, Interface/createInterface/question/prompt/async-iterator)
- Updated CLAUDE.md: dgram from Stub → Full (was already correct in STATUS.md)
- Updated metrics: 27 fully implemented (69%), 4 partial (10%), 8 stubs (21%)

### 2026-03-23 — Wave 8

**Remaining packages — expand tests:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| globals | 15 | 40 | process (platform/argv/pid), Buffer (alloc/isBuffer), structuredClone, TextEncoder/Decoder, atob/btoa, URL/URLSearchParams, console |
| child_process | 26 | 35 | execFile error, spawnSync env, exports validation, edge cases |

### 2026-03-23 — Wave 7

**Networking completion — HTTPS & TLS tests:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| https | 2 | 17 | Agent (defaultPort/protocol), request/get wrapper, exports, globalAgent |
| tls | 2 | 19 | TLSSocket API (encrypted, getPeerCert, getProtocol, getCipher), createSecureContext, constants |

### 2026-03-23 — Wave 6

**Crypto expansion — implementation + tests:**

| Package | Component | Tests | Description |
|---------|-----------|-------|-------------|
| crypto | Cipher/Decipher | +25 | Pure-JS AES (FIPS-197): CBC, CTR, ECB; PKCS#7 padding; NIST test vectors |
| crypto | scrypt | +11 | RFC 7914 (Salsa20/8 + BlockMix + ROMix); sync + async; RFC test vectors |

**New implementations:**
- **cipher.ts:** Complete AES-128/192/256 implementation in pure TypeScript. S-Box, InvS-Box, KeyExpansion, MixColumns, ShiftRows. Modes: CBC (with IV chaining), CTR (stream cipher), ECB (no IV). PKCS#7 padding with setAutoPadding().
- **scrypt.ts:** RFC 7914 scrypt in pure TypeScript. Uses Salsa20/8 Core, BlockMix, ROMix. Internally uses pbkdf2Sync (already available).

### 2026-03-23 — Wave 5

**Networking foundation — tests + implementation polish:**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| net | 8 | 35 | isIP/isIPv4/isIPv6 complete, Socket/Server API, TCP echo/multi-connect (Node.js) |
| dgram | 10 | 20 | createSocket options, bind, UDP send/receive round-trip (Node.js) |
| http | 24 | 42 (2 specs) | STATUS_CODES/METHODS, Agent, Server round-trip (GET/POST/404/Headers, Node.js) |

### 2026-03-23 — Wave 4

**Test expansions (quick wins for already implemented packages):**

| Package | Before | After | Focus Areas |
|---------|--------|-------|-------------|
| dns | 3 | 50 (2 specs) | Constants, lookup options (family/all), resolve4/6, reverse, dns/promises complete |
| timers | 28 | 43 (2 specs) | Ordering, negative delays, nested timers, refresh, setInterval with AbortController |
| zlib | 15 | 27 | Unicode, binary, large data, constants, cross-format errors, gzip magic bytes |
| module | 14 | 21 | createRequire, builtinModules validation, isBuiltin with subpaths/prefixes |
| tty | 14 | 23 | isatty with various fds, ReadStream/WriteStream properties |
| perf_hooks | 18 | 30 | mark/measure/getEntries, clearMarks, toJSON, timeOrigin validation |

### 2026-03-23 — Waves 1–3

**New tests (selection):**

| Package | Before | After | Source |
|---------|--------|-------|--------|
| crypto | 38 | 144 | +Hmac specs, PBKDF2/HKDF tests |
| os | — | 240 | Extensive reference tests ported |
| util | 52 | 110 | format edge cases (%%, -0, BigInt, Symbol) |
| events | 60 | 119 | Extended EventEmitter tests |
| buffer | 52 | 123 | Encoding, alloc, compare, slice |
| url | — | 82 | URL/URLSearchParams compatibility tests |
| stream | 49 | 66 | Async scheduling, backpressure |
| console | — | 57 | Console.log/warn/error, formatting |
| readline | 15 | 50 | Line endings, Interface events |
| child_process | 4 | 26 | cwd, env, encoding, spawnSync |
| diagnostics_channel | 8 | 26 | Channel, TracingChannel |
| module | 6 | 14 | builtinModules, isBuiltin |

**Implementation fixes:**

- **crypto:** Replaced GLib.Hmac with pure-JS HMAC (RFC 2104) due to segfault. PBKDF2 + HKDF use the new Hmac implementation. 144 tests green on both platforms.
- **child_process:** `cwd` and `env` options via `Gio.SubprocessLauncher`; `spawnSync` with encoding support.
- **readline:** `\r` recognized as standalone line ending.
- **util.format:** `%%` escape, `-0`, BigInt, Symbol, `%i` with Infinity→NaN, remaining args without quotes.
- **os.cpus:** Real `times` from `/proc/stat` (jiffies → ms) instead of zeros.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Application                         │
├─────────────────────────────────────────────────────────────────┤
│  import 'fs'  │  import 'http'  │  import 'stream'  │  fetch() │
├───────────────┴─────────────────┴────────────────────┴──────────┤
│              esbuild + @gjsify/esbuild-plugin-gjsify            │
│         (aliased: fs → @gjsify/fs, http → @gjsify/http)        │
├─────────────────────────────────────────────────────────────────┤
│                     @gjsify/* Implementations                   │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐  │
│  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/  │  │ @gjsify/fetch │  │
│  │ fs       │  │ http     │  │ stream   │  │               │  │
│  └────┬─────┘  └────┬─────┘  └──────────┘  └──────┬────────┘  │
│       │              │                              │           │
├───────┴──────────────┴──────────────────────────────┴───────────┤
│                     GNOME Libraries (GIR)                       │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Gio 2.0  │  │ Soup 3.0 │  │ GLib 2.0 │  │ Gtk 4.0  │       │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘       │
├─────────────────────────────────────────────────────────────────┤
│              GJS (SpiderMonkey 128 / ES2024)                    │
└─────────────────────────────────────────────────────────────────┘
```
