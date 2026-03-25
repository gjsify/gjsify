# gjsify — Project Status

> Last updated: 2026-03-25 (after coverage & stability sprint, Day 10)

## Summary

gjsify implements Node.js and Web Standard APIs for GJS (GNOME JavaScript / SpiderMonkey 128).
The project comprises **37 Node.js packages**, **14 Web API packages**, **3 GJS infrastructure packages**, and **7 build tools**.

| Category | Total | Full | Partial | Stub |
|----------|-------|------|---------|------|
| Node.js APIs | 37 | 30 (81%) | 3 (8%) | 4 (11%) |
| Web APIs | 15 | 15 (100%) | — | — |
| GJS Infrastructure | 3 | 2 | 1 (types) | — |
| Build Tools | 7 | 7 | — | — |

**Test coverage:** 2,540 test cases in 83 spec files (each test runs on both Node.js and GJS). CI via GitHub Actions (Node.js 24.x + GJS on Ubuntu 24.04).

---

## Node.js Packages (`packages/node/`)

### Fully Implemented (30)

| Package | GNOME Libs | Tests | Description |
|---------|-----------|-------|-------------|
| **assert** | — | 73 | AssertionError, deepEqual, throws, strict mode |
| **async_hooks** | — | 28 | AsyncLocalStorage, AsyncResource, createHook |
| **buffer** | — | 52 | Buffer via Blob/atob/btoa, alloc, from, concat |
| **child_process** | Gio, GLib | 79 | exec/execSync, execFile/execFileSync, spawn/spawnSync via Gio.Subprocess; cwd/env via Gio.SubprocessLauncher |
| **console** | — | 37 | Console class with stream support |
| **crypto** | GLib | 160 (12 specs) | Hash, Hmac, randomBytes/UUID, PBKDF2, HKDF, scrypt, AES (CBC/CTR/ECB/GCM), DH, ECDH, Sign/Verify, publicEncrypt/privateDecrypt, **KeyObject (JWK import/export)**, **X509Certificate** |
| **dgram** | Gio, GLib | 37 | UDP Socket via Gio.Socket with bind, send, receive, multicast, connect/disconnect/remoteAddress |
| **diagnostics_channel** | — | 14 | Channel, TracingChannel, subscribe/unsubscribe |
| **dns** | Gio, GLib | 58 (2 specs) | lookup, resolve4/6, reverse via Gio.Resolver + dns/promises |
| **events** | — | 60 | EventEmitter, once, on, listenerCount |
| **fs** | Gio, GLib | 153 (8 specs) | sync, callback, promises, streams, FSWatcher, symlinks, FileHandle (read/write/truncate/writeFile/stat/readFile/appendFile), access/copyFile/rename/lstat, ENOENT error mapping |
| **globals** | — | 96 | process, Buffer, structuredClone (full polyfill), TextEncoder/Decoder, atob/btoa, URL, setImmediate |
| **http** | Soup 3.0, Gio, GLib | 71 (2 specs) | Server (Soup.Server), ClientRequest (Soup.Session), IncomingMessage, ServerResponse, OutgoingMessage, STATUS_CODES, Agent, round-trip on GJS |
| **https** | Soup 3.0 | 24 | Agent, request/get (Soup.Session handles HTTPS natively), createServer, Server |
| **module** | Gio, GLib | 27 | builtinModules, isBuiltin, createRequire (with JSON loading and module resolution) |
| **net** | Gio, GLib | 84 | Socket (Duplex via Gio.SocketClient), Server (Gio.SocketService), isIP/isIPv4/isIPv6 |
| **os** | GLib | 32 | homedir, hostname, cpus (real times from /proc/stat), platform-specific |
| **path** | — | 41 | POSIX + Win32 (1,052 lines total) |
| **perf_hooks** | — | 31 | performance (Web API / GLib fallback), monitorEventLoopDelay, mark/measure/getEntries |
| **process** | GLib | 37 | EventEmitter-based, env, cwd, platform, exit |
| **querystring** | — | 63 | parse/stringify with full encoding |
| **readline** | — | 24 | Interface, createInterface, question, prompt, async iterator, clearLine, cursorTo |
| **stream** | — | 196 (3 specs) | Readable, Writable, Duplex, Transform, PassThrough, objectMode, backpressure, destroy, consumers (text/json/buffer/blob/arrayBuffer), promises (pipeline/finished) |
| **string_decoder** | — | 65 | UTF-8, Base64, hex, streaming |
| **timers** | — | 51 (2 specs) | setTimeout/setInterval/setImmediate + timers/promises |
| **tls** | Gio, GLib | 48 | TLSSocket (encrypted, getPeerCertificate, getProtocol, getCipher, **ALPN**), **connect with TLS handshake**, createServer, createSecureContext, **checkServerIdentity** (wildcard, SAN, FQDN), **getCiphers**, DEFAULT_CIPHERS |
| **tty** | — | 23 | ReadStream/WriteStream, isatty, ANSI, clearLine, cursorTo, getColorDepth |
| **url** | GLib | 32 | URL, URLSearchParams via GLib.Uri |
| **util** | — | 70 | inspect, format (%%, -0, BigInt, Symbol), promisify, types |
| **zlib** | — | 38 | gzip/deflate/deflateRaw round-trip, constants, Unicode, binary, cross-format errors |

### Partially Implemented (3)

| Package | GNOME Libs | Tests | Working | Missing |
|---------|-----------|-------|---------|---------|
| **worker_threads** | Gio, GLib | 50 | MessageChannel, MessagePort (deep clone: Date, RegExp, Map, Set, Error, TypedArrays), BroadcastChannel, receiveMessageOnPort, environmentData, Worker (Gio.Subprocess with stdin/stdout IPC), **addEventListener/removeEventListener on MessagePort/BroadcastChannel**, structured clone edge cases (-0, NaN, BigInt, Int32Array) | SharedArrayBuffer, transferList, Worker file-based (requires pre-bundled .mjs) |
| **http2** | — | 30 | Complete constants, getDefaultSettings, getPackedSettings/getUnpackedSettings, Http2Session/Stream class stubs | createServer/createSecureServer/connect (Soup 3.0 lacks multiplexed stream API) |
| **vm** | — | 37 | runInThisContext (eval), runInNewContext (Function constructor with sandbox), runInContext, createContext/isContext, compileFunction, Script (reusable, runInNewContext) | True sandbox isolation (requires SpiderMonkey Realms) |

### Stubs (4)

| Package | Tests | Description | Effort |
|---------|-------|-------------|--------|
| **cluster** | 4 | isPrimary, isMaster, isWorker; fork() throws | High — requires multi-process architecture |
| **domain** | 5 | Deprecated Node.js API; pass-through | Low — intentionally minimal |
| **inspector** | 6 | Session.post(), open/close; empty | Medium — V8-specific, hard to port |
| **v8** | 4 | getHeapStatistics (JSON-based), serialize/deserialize | Medium — V8-specific |

---

## Web API Packages (`packages/web/`)

All 14 packages have real implementations:

| Package | GNOME Libs | Tests | Web APIs |
|---------|-----------|-------|----------|
| **abort-controller** | — | 18 (2 specs) | AbortController, AbortSignal (.abort, .timeout, .any) |
| **compression-streams** | — | 16 | CompressionStream, DecompressionStream (gzip/deflate/deflate-raw). Uses @gjsify/web-streams TransformStream |
| **dom-events** | — | 97 (3 specs) | Event, EventTarget, CustomEvent |
| **dom-exception** | — | 34 | DOMException polyfill (WebIDL standard) |
| **eventsource** | — | 24 | EventSource (Server-Sent Events), TextLineStream. Uses fetch + Web Streams |
| **fetch** | Soup 3.0, Gio, GLib | 35 | fetch(), Request, Response, Headers, Referrer-Policy |
| **formdata** | — | 24 | FormData, File, multipart encoding |
| **dom-elements** | — | 61 | Node, Element, HTMLElement, Attr, NamedNodeMap, NodeList, NodeType, NamespaceURI (DOM hierarchy; GJS-only) |
| **html-image-element** | GdkPixbuf | 22 | HTMLImageElement (alt, src, width, height, crossOrigin, loading, decode()), Image() |
| **streams** | — | 72 | ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream, ByteLengthQueuingStrategy, CountQueuingStrategy (WHATWG Streams polyfill for GJS) |
| **webcrypto** | — | 42 | SubtleCrypto (digest, AES-CBC/CTR/GCM, HMAC, ECDSA, RSA-PSS, RSA-OAEP, PBKDF2, HKDF, ECDH, generateKey, importKey/exportKey, deriveBits/deriveKey), CryptoKey |
| **webgl** | gwebgl, Gtk 4, Gio | 12 | WebGLRenderingContext (1.0), Canvas, Extensions |
| **web-globals** | — | 28 | Unified entry point: imports all Web API packages, registers globals |
| **websocket** | Soup 3.0, Gio, GLib | 15 | WebSocket, MessageEvent, CloseEvent (W3C spec) |
| **webstorage** | — | 20 | Storage, localStorage, sessionStorage (W3C Web Storage) |

### Missing Web APIs

Not yet implemented (but potentially relevant for GJS projects):

| API | Priority | Notes |
|-----|----------|-------|
| ~~**ECDSA sign/verify**~~ | ✓ Done | Implemented in Phase 19 (RFC 6979 + FIPS 186-4) |
| ~~**RSA-PSS / RSA-OAEP**~~ | ✓ Done | Implemented in Phase 19 (RFC 8017, MGF1) |
| **URL/URLSearchParams (global)** | Low | Exists in @gjsify/url, missing as global export |
| **Blob/File (global)** | Low | Partially native in GJS; globals package could re-export |
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
| Total Node.js packages | 37 |
| Fully implemented | 30 (81%) |
| Partially implemented | 3 (8%) |
| Stubs | 4 (11%) |
| Web API packages | 15 (all implemented) |
| Total test cases | 2,540 |
| Spec files | 83 |
| GNOME-integrated packages | 13 (25%) |
| Alias mappings (GJS) | 60+ |
| Reference submodules | 27 |

---

## Priorities / Next Steps

### Completed

- ~~**Web Streams API**~~✓ — `@gjsify/web-streams` (72 tests). ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream, queuing strategies.
- ~~**WebCrypto (crypto.subtle)**~~✓ — `@gjsify/webcrypto` (42 tests). SubtleCrypto: digest, AES-CBC/CTR/GCM, HMAC, ECDSA, RSA-PSS, RSA-OAEP, PBKDF2, HKDF, ECDH, importKey/exportKey, generateKey.
- ~~**EventSource**~~✓ — `@gjsify/eventsource` (24 tests). Server-Sent Events via fetch + Web Streams.
- ~~**WebCrypto ECDSA/RSA-PSS/RSA-OAEP**~~✓ — Implemented: ECDSA (RFC 6979), RSA-PSS (RFC 8017), RSA-OAEP (RFC 8017), MGF1.
- ~~**Unified web-globals package**~~✓ — `@gjsify/web-globals` as single entry point for all Web API globals. DOMException extracted to `@gjsify/dom-exception`.
- ~~**vm promoted to Partial**~~✓ — createContext, runInNewContext, compileFunction, Script class (37 tests).

### High Priority

1. **Increase test coverage** — Port more tests from `refs/node-test/` and `refs/bun/test/`, especially for networking (net, tls, dgram) and fs.

### Medium Priority

2. **worker_threads file-based Workers** — Currently requires pre-bundled .mjs. Support file path resolution relative to build output.
3. **BYOB Byte Streams** — ReadableByteStreamController for optimized binary streaming.
4. **http2 client** — Soup.Session supports HTTP/2 via ALPN; wrap behind Http2Session API. Requires nghttp2 bindings or pure-JS HTTP/2 frame parser.

### Low Priority

5. **v8** — Approximate heap statistics via GJS runtime info.
6. **cluster** — Multi-process via Gio.Subprocess pool.
7. **inspector** — GJS debugger integration (gjs --debugger).

---

## Upstream GJS Patch Candidates

Workarounds we maintain that could be eliminated with upstream GJS/SpiderMonkey patches. These are ordered by impact — features where an upstream fix would benefit the most gjsify packages.

| Workaround | Affected Packages | Current Solution | Upstream Fix |
|-----------|-------------------|------------------|-------------|
| Web Streams (`ReadableStream`, `WritableStream`, `TransformStream`) not exposed as globals | compression-streams, fetch body streaming, EventSource, any Web Streams consumer | Cannot use W3C Compression Streams API or TransformStream-based polyfills on GJS | Expose Web Streams API globals (already available in SpiderMonkey 128 / Firefox) |
| `structuredClone` not available as global in GJS ESM | worker_threads, potentially all packages using message passing | Full polyfill in `@gjsify/utils` (`structured-clone.ts`) — supports Date, RegExp, Map, Set, Error types, ArrayBuffer, TypedArrays, DataView, Blob, File, circular refs, DataCloneError | Expose `structuredClone` as global in GJS ESM context (already available in SpiderMonkey 128) |
| `TextDecoder` malformed UTF-8 handling differs across SpiderMonkey versions | string_decoder | Pure manual UTF-8 decoder implementing W3C maximal subpart algorithm (`utf8DecodeMaximalSubpart`) | Fix SpiderMonkey 115's `TextDecoder` to follow W3C encoding spec for maximal subpart replacement |
| `queueMicrotask` not exposed as global in GJS 1.86 | timers, stream (any code needing microtask scheduling) | `Promise.resolve().then()` workaround | Expose `queueMicrotask` as global (already exists in SpiderMonkey 128) |

## Changelog

### 2026-03-25 — Coverage & Stability Sprint (Day 7–10)

**New API implementations:**
- `tls`: Added `checkServerIdentity()` (wildcard certs, SAN, FQDN/trailing-dot), `getCiphers()`, `DEFAULT_CIPHERS` (18 new tests)
- `dgram`: Added `Socket.connect()`, `Socket.disconnect()`, `Socket.remoteAddress()` with ERR_SOCKET_DGRAM_IS_CONNECTED / NOT_CONNECTED / BAD_PORT error handling (7 new tests)
- `worker_threads`: Added `MessagePort.addEventListener()` / `removeEventListener()` and `BroadcastChannel.addEventListener()` / `removeEventListener()` (9 new tests)
- `fs/FileHandle`: Implemented `read()` (Gio.FileInputStream-based), `truncate()` (Gio.File overlay), `writeFile()` (Gio.File), `stat()` (Stats constructor). Fixed `open()` error mapping for GLib.FileError (ENOENT vs ENOTDIR). Fixed `readlinkSync` error re-throw guard (numeric vs string code). Fixed `read()` `...args` rest param bug (previously parsed buffer bytes as args).

**Test additions:**
- `fs`: 126 → 153 (+27): FileHandle read/write/truncate/writeFile/stat/readFile/appendFile, error cases for non-existent paths, symlink edge cases
- `tls`: 30 → 48 (+18): checkServerIdentity (wildcards, SANs, FQDN, IP), getCiphers, DEFAULT_CIPHERS constant
- `dgram`: 30 → 37 (+7): connect/disconnect/remoteAddress, error codes
- `worker_threads`: 41 → 50 (+9): addEventListener/removeEventListener, structured clone edge cases (-0, NaN, BigInt, Int32Array)

**Bug fixes:**
- `tls.checkServerIdentity`: Wildcard pattern `unfqdn()` normalization for trailing-dot FQDNs (GJS test was failing)
- `tls` test: `toContain()` does not check string substrings in `@gjsify/unit` (only array containment); replaced with `toMatch(/.../)`
- `readlinkSync`: Catch block `if ((err as {code?}).code) throw err` re-threw Gio errors with numeric code (1) before `createNodeError` conversion; fixed to check `typeof === 'string'`
- `FileHandle.open()`: GLib.IOChannel.new_file() throws GLib.FileError (code 4 = NOENT) which overlaps with Gio.IOErrorEnum (code 4 = NOT_DIRECTORY); added `GLIB_FILE_ERROR_TO_NODE` mapping in constructor
- `FileHandle.write()`: Switched to Gio.File overlay (read-modify-write) so data is immediately on-disk and visible to subsequent `read()` calls (GLib.IOChannel flush does not call fflush on stdio FILE* buffer)

**Total: 2,503 → 2,540 test cases. All pass on both Node.js and GJS.**

---

### 2026-03-25 — Metric Consolidation (Coverage Audit)

**Corrected test counts to match actual spec files (no implementation changes):**
- `net`: 64 → 84 (TCP lifecycle, error handling, large data, simultaneous connections)
- `fs`: 83 (7 specs) → 126 (8 specs) — added symlink.spec.ts, expanded extended/new-apis/file-handle
- `stream`: 141 (3 specs) → 196 — expanded Readable/Writable/Transform/backpressure/objectMode tests
- `child_process`: 43 → 79 — expanded execFile, spawn, env, cwd, edge cases
- `html-image-element`: 2 → 22 — full attribute coverage (alt, src, width, height, crossOrigin, loading, decode)
- Added `@gjsify/dom-elements` to Web API table (was missing): 61 tests, Node/Element/HTMLElement hierarchy
- Total test cases: 2,130 → 2,503 | Spec files: 75 → 83 | Web APIs: 14 → 15

### 2026-03-25 — Stabilization & Deduplication

**Fixed worker_threads GJS timeouts (17 tests → 0 failures):**
- Added `@gjsify/node-globals` import to test.mts (registers structuredClone on GJS)
- Replaced `setTimeout(..., 0)` with `Promise.resolve().then()` in MessagePort._dispatchMessage() and BroadcastChannel.postMessage() for correct microtask scheduling on GLib main loop
- worker_threads tests: 63 → 82 (all pass on both Node.js and GJS)

**Extracted shared base64 utilities to `@gjsify/utils/src/base64.ts`:**
- Consolidated duplicate base64 encode/decode from `@gjsify/buffer` (58 lines) and `@gjsify/string_decoder` (16 lines)
- Exports: `base64Encode`, `base64Decode`, `atobPolyfill`, `btoaPolyfill`
- Both consumer packages now import from `@gjsify/utils` — no behavioral change

**Extracted shared nextTick utility to `@gjsify/utils/src/next-tick.ts`:**
- Consolidated duplicate microtask scheduling (process.nextTick → queueMicrotask → Promise fallback)
- `@gjsify/stream` now imports `nextTick` from `@gjsify/utils` (was inline 6-line definition)

**Expanded test coverage:**
- fetch tests: 24 → 51 (Headers forEach/values, Request clone/redirect/signal/null-body, Response.json/clone/statusText/type/headers)
- vm tests: 22 → 49 (SyntaxError/ReferenceError propagation, object literals, nested sandbox objects, Script invalid code, multi-context reuse)
- Total test cases: ~2,960 → ~3,030

### 2026-03-25 — structuredClone Polyfill

**Replaced JSON round-trip polyfill with full HTML structured clone algorithm:**
- New `packages/gjs/utils/src/structured-clone.ts` implementing spec-compliant structuredClone
- Supports: primitives (-0, NaN, BigInt), wrapper objects, Date, RegExp, Error types (with cause), ArrayBuffer, all TypedArrays, DataView, Map, Set, Blob, File, circular/shared references
- Throws DataCloneError for functions, symbols, WeakMap, WeakSet, WeakRef
- Removed duplicated `deepClone`/`cloneValue` from worker_threads (now uses global structuredClone)
- Added `refs/ungap-structured-clone/` as reference submodule
- globals tests: 40 → 96 (56 new structuredClone tests ported from WPT and node-test)
- All 221 tests pass on both Node.js and GJS

### 2026-03-25 — Phase 20: worker_threads + vm Enhancement

**worker_threads structured clone improvements:**
- Replaced JSON round-trip fallback with proper deep clone supporting: Date, RegExp, Map, Set, Error, ArrayBuffer, TypedArrays, nested objects, circular reference detection
- 7 new structured clone tests (Date, RegExp, Map, Set, Error, Uint8Array, nested complex types)
- worker_threads tests: 56 → 63

**vm promoted from Stub to Partial:**
- `runInNewContext(code, sandbox)`: Evaluates code with sandbox variables injected via Function constructor
- `runInContext(code, context)`: Delegates to runInNewContext for created contexts
- `createContext(context)`: Marks objects with Symbol for isContext() detection
- `isContext(context)`: Checks for createContext marker
- `compileFunction(code, params)`: Compiles source code into a reusable Function
- `Script.runInNewContext(context)`: Run compiled script with sandbox
- `Script.runInContext(context)`: Run compiled script in created context
- `Script.createCachedData()`: Returns empty Uint8Array (stub)
- 22 tests (was 6): exports, runInThisContext (arithmetic, strings, complex), runInNewContext (sandbox variables, strings, empty context, arrays), createContext/isContext, compileFunction (no params, with params, string return), Script (constructable, runInThisContext, runInNewContext, runInContext, reusable, createCachedData)

### 2026-03-25 — Phase 19: WebCrypto Algorithm Completion

**New crypto primitives:**
- **ECDSA sign/verify** (`crypto/src/ecdsa.ts`): Full FIPS 186-4 implementation with RFC 6979 deterministic k generation via HMAC-DRBG. Supports P-256, P-384, P-521 curves with SHA-1/256/384/512. Signature format: raw r||s concatenation.
- **MGF1** (`crypto/src/mgf1.ts`): Mask Generation Function 1 per RFC 8017 Section B.2.1. Foundation for RSA-PSS and RSA-OAEP.
- **RSA-PSS sign/verify** (`crypto/src/rsa-pss.ts`): EMSA-PSS-ENCODE/VERIFY per RFC 8017 Section 9.1. Configurable salt length.
- **RSA-OAEP encrypt/decrypt** (`crypto/src/rsa-oaep.ts`): RSAES-OAEP-ENCRYPT/DECRYPT per RFC 8017 Section 7.1. Optional label support.

**SubtleCrypto extensions:**
- `sign()`: Added ECDSA and RSA-PSS algorithm routing
- `verify()`: Added ECDSA and RSA-PSS algorithm routing
- `encrypt()`: Added RSA-OAEP algorithm routing
- `decrypt()`: Added RSA-OAEP algorithm routing

**6 new ECDSA tests**: key generation (P-256), sign/verify round-trip (P-256 SHA-256), corrupted signature rejection, wrong data rejection, different messages produce different signatures, P-384 sign/verify

### 2026-03-25 — Phase 18: Web-Layer-Refactoring + Unified Web-Globals

**18a: DOMException extracted to own package:**
- New package `@gjsify/dom-exception` — DOMException polyfill per WebIDL standard
- Extracted from `@gjsify/dom-events` (was mixed with DOM Events, but DOMException is WebIDL, not DOM Events)
- `@gjsify/dom-events` now re-exports DOMException from `@gjsify/dom-exception` (backwards compatible)
- Registers `globalThis.DOMException` on GJS if missing

**18b: Unified web-globals package:**
- Redesigned `@gjsify/web-globals` from 2-line side-effect import to unified entry point
- Single `import '@gjsify/web-globals'` registers all Web API globals on GJS:
  - DOMException, Event, EventTarget, CustomEvent (dom-exception + dom-events)
  - AbortController, AbortSignal (abort-controller)
  - ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream (web-streams)
  - CompressionStream, DecompressionStream (compression-streams)
  - crypto.subtle, getRandomValues, randomUUID (webcrypto)
  - EventSource (eventsource)
- Re-exports key types for programmatic use
- **27 tests**: DOMException (constructable, error codes, instanceof), DOM Events (Event, EventTarget dispatch), AbortController (signal, abort), Web Streams (Readable/Writable/Transform constructable), Encoding Streams, Compression Streams, WebCrypto (subtle, getRandomValues, randomUUID), EventSource import

### 2026-03-25 — Phase 17: fs + Stream Submodule Test Expansion

**fs callback test expansion** (1 → 15 tests):
- stat/lstat: directory stat, ENOENT error
- readdir: list files
- mkdir/rmdir: create and remove directory
- writeFile/readFile: string and Buffer data, ENOENT error
- open/write/close: low-level file I/O
- access: F_OK success and ENOENT failure
- appendFile: append content
- rename: file rename round-trip
- copyFile: file copy round-trip
- truncate: truncate file content
- chmod: change file mode

**stream submodule tests** (new 2 spec files):
- **stream/consumers** (12 tests): text (empty, single, multi-chunk), json (object, array, number), buffer (data, empty), arrayBuffer (single, multi-chunk), blob (data, content verification)
- **stream/promises** (8 tests): pipeline (readable→writable, through transform, PassThrough, source error rejection), finished (writable finish, readable end, error rejection, already-finished)

### 2026-03-24 — Phase 16: Networking Test Expansion + Housekeeping

**Housekeeping:**
- Committed pending eventsource GJS compatibility changes (Event/EventTarget polyfill fallbacks, runtime deps)
- Committed TextDecoderStream GJS fallback (manual UTF-8 buffering for missing `stream` option)
- Cleaned up STATUS.md priorities (removed duplicate WebCrypto entry, reordered by impact)

**Networking test expansion:**
- **net** (35 → 64 tests): isIP edge cases (full/compressed IPv6, zone IDs, IPv4-mapped, malformed, non-string input), Socket properties (pending, readyState, destroy, address), TCP connection lifecycle (connect state transitions, localAddress/localPort, bytesRead/bytesWritten, setEncoding, setTimeout, getConnections, remoteFamily, connection event, multi-byte UTF-8 echo, large data transfer, server address family)
- **dgram** (20 → 30 tests): Multiple sends, UDP echo round-trip, rinfo.size, Socket as EventEmitter, ipv6Only option

### 2026-03-24 — Phase 15: Test Coverage Expansion

**Stream package** test expansion (66 → 87 tests):
- Writable backpressure: HWM threshold, drain event, writableLength, writableEnded/Finished state tracking
- ObjectMode: Transform with objects, Readable objectMode, readableObjectMode property
- Destroy behavior: idempotent destroy, error emission, close events on both Readable and Writable
- Pipe error handling: unpipe stops data flow, error isolation between piped streams

### 2026-03-24 — Phase 14: EventSource (Server-Sent Events)

**New package `@gjsify/eventsource`** — W3C EventSource (Server-Sent Events):

- **EventSource** class extending EventTarget with CONNECTING/OPEN/CLOSED states
- **TextLineStream** utility: TransformStream splitting stream into lines (\n, \r\n, standalone \r)
- SSE field parsing: event, data, id, retry fields per HTML spec
- Multi-line data support (multiple `data:` fields concatenated with \n)
- Comment filtering (lines starting with `:`)
- Auto-reconnection with configurable retry delay, new AbortController per attempt
- `onopen`/`onmessage`/`onerror` attribute handlers + addEventListener support
- `lastEventId` tracking via `id:` field
- Global registration on GJS
- **24 tests**: 4 TextLineStream + 11 unit tests + 9 SSE integration tests (real HTTP server)

### 2026-03-24 — Phase 13: WebCrypto (crypto.subtle)

**New package `@gjsify/webcrypto`** — W3C WebCrypto API for GJS:

- **SubtleCrypto** class with all major methods:
  - `digest`: SHA-1, SHA-256, SHA-384, SHA-512 (wraps @gjsify/crypto Hash/GLib.Checksum)
  - `encrypt`/`decrypt`: AES-CBC, AES-CTR, AES-GCM (wraps @gjsify/crypto cipher.ts)
  - `sign`/`verify`: HMAC (wraps @gjsify/crypto hmac.ts)
  - `generateKey`: AES (128/192/256), HMAC, ECDH (P-256/P-384/P-521), ECDSA key pairs
  - `importKey`/`exportKey`: raw, jwk formats for symmetric + EC keys
  - `deriveBits`/`deriveKey`: PBKDF2, HKDF, ECDH
- **CryptoKey** class with type/extractable/algorithm/usages + frozen properties
- **Crypto** polyfill: `getRandomValues()`, `randomUUID()`, `subtle`
- Native passthrough on Node.js (uses globalThis.crypto.subtle), polyfill on GJS
- Global `crypto` registration on GJS
- **37 tests**: digest, generateKey, importKey/exportKey round-trip, AES encrypt/decrypt (CBC/CTR/GCM with AAD), HMAC sign/verify, PBKDF2/HKDF deriveBits, ECDH shared secret, deriveKey, CryptoKey properties, getRandomValues, randomUUID

### 2026-03-24 — Phase 12: TextEncoderStream / TextDecoderStream

**Added to `@gjsify/web-streams`** — WHATWG Encoding Streams:

- **TextEncoderStream**: Encodes string chunks to UTF-8 Uint8Array via TransformStream. Handles surrogate pairs split across chunks (buffers pending high surrogates, emits U+FFFD for unpaired surrogates at stream end). Reference: `refs/deno/ext/web/08_text_encoding.js`.
- **TextDecoderStream**: Decodes byte chunks to strings via TransformStream wrapping `TextDecoder` with `stream: true`. Supports `encoding`, `fatal`, `ignoreBOM` options. Handles multi-byte UTF-8 sequences split across chunks.
- **Global registration**: On GJS, registers `TextEncoderStream` and `TextDecoderStream` as globals (not natively available in GJS 1.86).
- **Re-exports**: Available via `stream/web` module (same as `@gjsify/web-streams`).
- **22 new tests** (117 total for web-streams): Constructor, encoding properties, ASCII/multi-byte/4-byte encode/decode, empty chunks, surrogate pair split, unpaired surrogate replacement, ArrayBuffer input, round-trip (ASCII, Unicode, split surrogates).
- All 117 tests pass on Node.js 24. Foundation for Phase 14 (EventSource).

### 2026-03-24 — Phase 11: WHATWG Web Streams API (@gjsify/web-streams)

**New package `@gjsify/web-streams`** — complete WHATWG Streams polyfill for GJS, ported from `refs/node/lib/internal/webstreams/` (pure TypeScript, no native bindings):

- **WritableStream** (Phase 1): WritableStream, WritableStreamDefaultWriter, WritableStreamDefaultController, backpressure, abort/close lifecycle
- **ReadableStream** (Phase 2): ReadableStream, ReadableStreamDefaultReader, ReadableStreamDefaultController, tee, pipeTo, pipeThrough, async iteration, `ReadableStream.from()` (iterables/async iterables)
- **TransformStream** (Phase 3): TransformStream, TransformStreamDefaultController, backpressure coordination, flush/cancel
- **Queuing strategies**: ByteLengthQueuingStrategy, CountQueuingStrategy
- **Consumer integration** (Phase 4): `stream/web` re-exports from `@gjsify/web-streams`, `compression-streams` uses real TransformStream (SimpleReadable/SimpleWritable shims removed)
- **Global registration**: On GJS, registers ReadableStream/WritableStream/TransformStream as globals
- **95 tests** pass on both Node.js 24 and GJS 1.86
- BYOB/byte streams deferred (Phase 5, optional)

### 2026-03-24 — Phase 10: Promote 4 packages to Full, add 2 Web API packages

**Promoted http, crypto, tls, https from Partial → Full (27 → 31 Full, 69% → 79%):**

- **http** (93 → 136 tests): Added `OutgoingMessage` base class, `setMaxIdleHTTPParsers` stub. API surface now matches Node.js http module. Added tests for empty body response, large response body, Server properties.
- **crypto** (119 → 437 tests): **KeyObject JWK import/export** (secret, RSA public/private, round-trip). **DER encoder** for RSA keys (PKCS#1 and PKCS#8 SubjectPublicKeyInfo/PrivateKeyInfo). **Derived public key** now exports valid PEM (was `[derived-public-key]` marker). **X509Certificate class** — full ASN.1 X.509 parsing (serial, subject, issuer, validity, fingerprints, SAN), checkHost/checkEmail/checkIP, toLegacyObject. Added `x509.spec.ts` with 18 tests.
- **tls** (19 → 36 tests): **Client TLS handshake** — `connect()` now wraps TCP `Gio.SocketConnection` with `Gio.TlsClientConnection`, performs async handshake, emits `secureConnect`. **Server I/O wiring** — `_setupTlsStreams()` replaces socket I/O with TLS connection streams after handshake. **ALPN** — `set_advertised_protocols()` on client, `get_negotiated_protocol()` on socket. Certificate validation via `accept-certificate` signal.
- **https** (17 → 32 tests): Confirmed functional — Soup.Session handles HTTPS natively for client requests.

**New Web API packages (7 → 10):**

- **@gjsify/compression-streams** (25 tests): W3C CompressionStream/DecompressionStream (gzip, deflate, deflate-raw). Uses native on Node.js. GJS polyfill blocked on Web Streams API availability.
- **@gjsify/webstorage** (41 tests): W3C Web Storage (Storage class, localStorage, sessionStorage). In-memory implementation, works on both Node.js and GJS. setItem/getItem/removeItem/clear/key, Unicode support.

**Key discovery:** GJS 1.86 does NOT expose `ReadableStream`, `WritableStream`, or `TransformStream` globals (despite SpiderMonkey 128 having them in Firefox). This blocks CompressionStream polyfill on GJS and is now the #1 priority.

### 2026-03-24 — Phase 9: Fix worker_threads, zlib, string_decoder for CI

- **worker_threads**: Fixed `structuredClone` unavailability in GJS by adding `cloneValue()` fallback (JSON round-trip). Switched message dispatch from `Promise.resolve().then()` to `setTimeout(fn, 0)` for GLib main loop integration. All 56 tests pass on GJS.
- **zlib**: Implemented sync methods (`gzipSync`, `gunzipSync`, `deflateSync`, `inflateSync`, `deflateRawSync`, `inflateRawSync`) using `Gio.ZlibCompressor`/`Gio.ZlibDecompressor`. Replaced legacy `imports.gi` access with proper `@girs/*` imports. All 340 tests pass on both platforms.
- **string_decoder**: Replaced `TextDecoder` dependency with pure manual UTF-8 decoder implementing W3C maximal subpart algorithm. Fixes `F0 B8 41` handling on GJS 1.80 (SpiderMonkey 115) where `TextDecoder` produces incorrect replacement character count.

### 2026-03-24 — Phase 8: http2 — From Stub to Partial

**Promoted http2 from Stub → Partial** with complete constants, settings functions, and class stubs:

- **Complete constants** (200+ entries): All NGHTTP2 error codes (RFC 7540 §7), session types, stream states, frame flags, settings IDs, default settings values, frame size constraints, padding strategies, HTTP/2 pseudo-headers, 70+ standard HTTP headers, 40+ HTTP methods, 60+ HTTP status codes
- **Settings functions**: `getDefaultSettings()` returns RFC 7540 defaults, `getPackedSettings()` / `getUnpackedSettings()` implement binary SETTINGS frame encoding (6-byte pairs: 2-byte ID + 4-byte value, big-endian)
- **Class stubs** (EventEmitter-based): `Http2Session` (localSettings/remoteSettings, settings/goaway/ping/close/destroy), `Http2Stream` (state machine, close/destroy/priority), `ServerHttp2Session`, `ClientHttp2Session`, `ServerHttp2Stream`, `ClientHttp2Stream`, `Http2ServerRequest` (headers/method/url/authority/scheme), `Http2ServerResponse` (setHeader/getHeader/writeHead/write/end)
- **102 tests** (was 5): constants (error codes, session types, stream states, settings IDs, default values, frame flags, pseudo-headers, HTTP headers/methods/status codes, frame size constraints), getDefaultSettings properties, getPackedSettings/getUnpackedSettings round-trip, sensitiveHeaders, factory functions, class exports
- All 102 tests pass on both Node.js 24 and GJS 1.86

**Soup 3.0 HTTP/2 findings**: Soup can negotiate HTTP/2 via ALPN but treats it as transparent — no multiplexed stream API. Full createServer/connect would require nghttp2 bindings (Vala extension) or a pure-JS HTTP/2 frame parser.

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
| globals | 15 | 96 | process (platform/argv/pid), Buffer (alloc/isBuffer), structuredClone (full polyfill: Date, RegExp, Error, TypedArrays, Map, Set, circular refs, DataCloneError), TextEncoder/Decoder, atob/btoa, URL/URLSearchParams, console |
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
