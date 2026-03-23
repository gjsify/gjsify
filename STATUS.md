# gjsify — Project Status

> Last updated: 2026-03-23 (after Wave 3)

## Summary

gjsify implements Node.js and Web Standard APIs for GJS (GNOME JavaScript / SpiderMonkey 128).
The project comprises **39 Node.js packages**, **7 Web API packages**, **3 GJS infrastructure packages**, and **7 build tools**.

| Category | Total | Full | Partial | Stub |
|----------|-------|------|---------|------|
| Node.js APIs | 39 | 25 (64%) | 6 (15%) | 8 (21%) |
| Web APIs | 7 | 7 (100%) | — | — |
| GJS Infrastructure | 3 | 2 | 1 (types) | — |
| Build Tools | 7 | 7 | — | — |

**Test coverage:** ~2,050 test cases in 68+ spec files. CI via GitHub Actions (Node.js 24.x + GJS on Ubuntu 24.04).

---

## Node.js Packages (`packages/node/`)

### Fully Implemented (25)

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
| **module** | — | 21 | builtinModules, isBuiltin, createRequire |
| **net** | Gio, GLib | 35 | Socket (Duplex via Gio.SocketClient), Server (Gio.SocketService), isIP/isIPv4/isIPv6 |
| **os** | GLib | 240 | homedir, hostname, cpus (real times from /proc/stat), platform-specific |
| **path** | — | 41 | POSIX + Win32 (1,052 lines total) |
| **perf_hooks** | — | 30 | performance (Web API / GLib fallback), monitorEventLoopDelay, mark/measure/getEntries |
| **process** | GLib | 47 | EventEmitter-based, env, cwd, platform, exit |
| **querystring** | — | 63 | parse/stringify with full encoding |
| **require** | Gio, GLib | ✓ | CommonJS require() for GJS |
| **stream** | — | 66 | Readable, Writable, Duplex, Transform, PassThrough |
| **string_decoder** | — | 65 | UTF-8, Base64, hex, streaming |
| **timers** | — | 43 (2 specs) | setTimeout/setInterval/setImmediate + timers/promises |
| **tty** | — | 23 | ReadStream/WriteStream, isatty, ANSI, clearLine, cursorTo, getColorDepth |
| **url** | GLib | 82 | URL, URLSearchParams via GLib.Uri |
| **util** | — | 110 | inspect, format (%%, -0, BigInt, Symbol), promisify, types |
| **zlib** | — | 27 | gzip/deflate/deflateRaw round-trip, constants, Unicode, binary, cross-format errors |
| **dgram** | Gio, GLib | 20 | UDP Socket via Gio.Socket with bind, send, receive, multicast |

### Partially Implemented (6)

| Package | GNOME Libs | Tests | Working | Missing |
|---------|-----------|-------|---------|---------|
| **crypto** | GLib | 78 (6 specs) | Hash, Hmac, randomBytes/UUID, PBKDF2, HKDF, **Cipher/Decipher (AES-CBC/CTR/ECB)**, **scrypt (RFC 7914)** | Sign/Verify, ECDH, DH, KeyObject, X509Certificate, AES-GCM |
| **globals** | — | 40 | setImmediate, process, Buffer, structuredClone, TextEncoder/Decoder, atob/btoa, URL | Complete globalThis configuration |
| **http** | Soup 3.0, Gio, GLib | 42 (2 specs) | Server (Soup.Server), IncomingMessage, ServerResponse, STATUS_CODES, Agent, round-trip | Client-side: http.request(), http.get() still incomplete |
| **https** | — | 17 | Agent (defaultPort 443, protocol https:), request/get wrapper | Client integration, createServer with TLS |
| **readline** | — | 50 | Interface, createInterface, \r line-ending support | Cursor navigation, history, completion, prompt |
| **tls** | Gio, GLib | 19 | TLSSocket (encrypted, getPeerCertificate, getProtocol, getCipher), connect, createSecureContext | createServer, TLS session resumption, ALPN |

### Stubs (8)

| Package | Tests | Description | Effort |
|---------|-------|-------------|--------|
| **cluster** | ✓ | isPrimary, isMaster, isWorker; fork() throws | High — requires multi-process architecture |
| **domain** | ✓ | Deprecated Node.js API; pass-through | Low — intentionally minimal |
| **http2** | ✓ | Only constants exported; create* throws | High — HTTP/2 protocol is complex |
| **inspector** | ✓ | Session.post(), open/close; empty | Medium — V8-specific, hard to port |
| **v8** | ✓ | getHeapStatistics (JSON-based), serialize/deserialize | Medium — V8-specific |
| **vm** | ✓ | runInThisContext (eval), Script class | Medium — sandbox isolation limited |
| **worker_threads** | ✓ | isMainThread; Worker throws | High — GJS has no native threading API |

---

## Web API Packages (`packages/web/`)

All 7 packages have real implementations:

| Package | LOC | GNOME Libs | Tests | Web APIs |
|---------|-----|-----------|-------|----------|
| **dom-events** | 1,323 | — | 97 | Event, EventTarget, CustomEvent, DOMException |
| **fetch** | 1,674 | Soup 3.0, Gio, GLib | 24 | fetch(), Request, Response, Headers, Referrer-Policy |
| **formdata** | 438 | — | ✓ | FormData, File, multipart encoding |
| **abort-controller** | 291 | — | 19 | AbortController, AbortSignal (.abort, .timeout, .any) |
| **globals** | 14 | — | 1 | Re-export of dom-events + abort-controller |
| **html-image-element** | 347 | GdkPixbuf | 2 | HTMLImageElement, Image() |
| **webgl** | 5,662 | gwebgl, Gtk 4, Gio | 12 | WebGLRenderingContext (1.0), Canvas, Extensions |

### Missing Web APIs

Not yet implemented (but potentially relevant for GJS projects):

| API | Priority | Notes |
|-----|----------|-------|
| **WebSocket** | High | Soup 3.0 has WebSocket support (Soup.WebsocketConnection) |
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
| **Gio 2.0** | fs, net, dns, child_process, dgram, tls, require, fetch |
| **GLib 2.0** | crypto, url, os, process, dns, child_process, dgram, tls, require |
| **Soup 3.0** | http, fetch |
| **Gtk 4.0** | webgl |
| **GdkPixbuf 2.0** | html-image-element |
| **gwebgl 0.1** | webgl (Vala extension) |

---

## Metrics

| Metric | Value |
|--------|-------|
| Total Node.js packages | 39 |
| Fully implemented | 25 (64%) |
| Partially implemented | 6 (15%) |
| Stubs | 8 (21%) |
| Web API packages | 7 (all implemented) |
| Total test cases | ~2,050 |
| Spec files | 68+ |
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
