# gjsify — Project Status

> Last updated: 2026-03-27 (WebGL refactor: HTMLCanvasElement inheritance, WebGLArea widget, class renames, test coverage)

## Summary

gjsify implements Node.js and Web Standard APIs for GJS (GNOME JavaScript / SpiderMonkey 128).
The project comprises **39 Node.js packages**, **14 Web API packages**, **3 GJS infrastructure packages**, and **7 build tools**.

| Category | Total | Full | Partial | Stub |
|----------|-------|------|---------|------|
| Node.js APIs | 39 | 32 (82%) | 3 (8%) | 4 (10%) |
| Web APIs | 15 | 15 (100%) | — | — |
| GJS Infrastructure | 3 | 2 | 1 (types) | — |
| Build Tools | 7 | 7 | — | — |

**Test coverage:** 9,500+ test cases in 94 spec files (each test runs on both Node.js and GJS). CI via GitHub Actions (Node.js 24.x + GJS on Fedora 42/43).

---

## Node.js Packages (`packages/node/`)

### Fully Implemented (32)

| Package | GNOME Libs | Tests | Description |
|---------|-----------|-------|-------------|
| **assert** | — | 117 | AssertionError, deepEqual, throws, strict mode |
| **async_hooks** | — | 130 | AsyncLocalStorage (run, enterWith, snapshot, exit), AsyncResource (bind, runInAsyncScope, triggerAsyncId), createHook |
| **buffer** | — | 317 | Buffer via Blob/atob/btoa, alloc, from, concat, encodings, fill, indexOf/lastIndexOf, slice/subarray, copy, int/float read/write, swap16/32/64, equals, compare |
| **child_process** | Gio, GLib | 110 | exec/execSync, execFile/execFileSync, spawn/spawnSync via Gio.Subprocess; cwd/env via Gio.SubprocessLauncher |
| **console** | — | 124 | Console class with stream support, format specifiers, table, dir, time/timeLog, count, group, assert, trace, stdout/stderr routing |
| **constants** | — | 27 | Flattened re-export of os.constants (errno, signals, priority, dlopen) + fs.constants + crypto.constants (deprecated) |
| **crypto** | GLib | 571 (13 specs) | Hash (SHA256/384/512, MD5, SHA1, known vectors), Hmac (extended edge cases), randomBytes/UUID/Int (v4 format, uniqueness), PBKDF2, HKDF, scrypt, AES (CBC/CTR/ECB/GCM), DH, ECDH, Sign/Verify, publicEncrypt/privateDecrypt, **KeyObject (JWK import/export)**, **X509Certificate**, timingSafeEqual, getHashes/getCiphers/getCurves, constants |
| **dgram** | Gio, GLib | 143 | UDP Socket via Gio.Socket with bind, send, receive, multicast, connect/disconnect/remoteAddress, broadcast, TTL, ref/unref, IPv6, EventEmitter |
| **diagnostics_channel** | — | 137 | Channel, TracingChannel, subscribe/unsubscribe |
| **dns** | Gio, GLib | 121 (2 specs) | lookup, resolve4/6, reverse via Gio.Resolver + dns/promises |
| **events** | — | 241 | EventEmitter, once, on, listenerCount, setMaxListeners, errorMonitor, captureRejections, getEventListeners, prependListener, eventNames, rawListeners, Symbol events, async iterator |
| **fs** | Gio, GLib | 465 (9 specs) | sync, callback, promises, streams, FSWatcher, symlinks, FileHandle (read/write/truncate/writeFile/stat/readFile/appendFile), access/copyFile/rename/lstat, mkdir/rmdir/mkdtemp/chmod/truncate, ENOENT error mapping, fs.constants (O_RDONLY/WRONLY/RDWR/CREAT/EXCL/S_IFMT/S_IFREG), readdir options (withFileTypes, encoding), appendFileSync, mkdirSync recursive edge cases |
| **globals** | — | 221 | process, Buffer, structuredClone (full polyfill), TextEncoder/Decoder, atob/btoa, URL, setImmediate |
| **http** | Soup 3.0, Gio, GLib | 1034 (6 specs) | Server (Soup.Server, **chunked streaming**, **upgrade event**), ClientRequest (Soup.Session, **timeout events**, **auth option**, **signal option**), IncomingMessage (**timeout events**), ServerResponse (**setTimeout**, chunked transfer), OutgoingMessage, STATUS_CODES, METHODS, Agent (**constructor options**, keepAlive, maxSockets, scheduling), validateHeaderName/Value, maxHeaderSize, round-trip on GJS |
| **https** | Soup 3.0 | 99 | Agent (defaultPort, protocol, maxSockets, destroy, options, keepAlive, scheduling), globalAgent, request (URL/options/headers/timeout/methods), get, createServer, Server |
| **module** | Gio, GLib | 158 | builtinModules (all 37+ modules verified), isBuiltin (bare/prefixed/subpath/scoped), createRequire (resolve, cache, extensions) |
| **net** | Gio, GLib | 378 (5 specs) | Socket (Duplex via Gio.SocketClient, **allowHalfOpen enforcement**, timeout with reset, properties, remote/local address, **IOStream support**), Server (Gio.SocketService, **allowHalfOpen option**, options, createServer, **getConnections**), isIP/isIPv4/isIPv6 (comprehensive IPv4/IPv6/edge cases), connect/createConnection |
| **os** | GLib | 276 | homedir, hostname, cpus, platform, arch, type, release, endianness, EOL, devNull, availableParallelism, userInfo, networkInterfaces, constants (signals/errno), loadavg, uptime, memory |
| **path** | — | 432 | POSIX + Win32 (1,052 lines total) |
| **perf_hooks** | — | 115 | performance (now, timeOrigin, mark/measure, getEntries/ByName/ByType, clearMarks/clearMeasures, toJSON), monitorEventLoopDelay, PerformanceObserver, eventLoopUtilization, timerify |
| **process** | GLib | 143 (2 specs) | EventEmitter-based, env (CRUD, enumerate, coerce), cwd/chdir, platform, arch, pid/ppid, version/versions, argv, hrtime/hrtime.bigint (**monotonicity, diff**), memoryUsage (**field validation**), nextTick (**FIFO ordering, args**), exit/kill, config, execArgv, cpuUsage (**delta**), **signal handler registration**, **stdout/stderr write methods**, **emitWarning** |
| **querystring** | — | 471 | parse/stringify with full encoding |
| **readline** | — | 145 (2 specs) | Interface (lifecycle, line events, mixed line endings, Unicode, chunked input, long lines, history), question (sequential, output), prompt, pause/resume, async iterator, clearLine/clearScreenDown/cursorTo/moveCursor, **readline/promises** (createInterface, question→Promise) |
| **stream** | — | 330 (4 specs) | Readable, Writable, Duplex, Transform (**_flush** edge cases), PassThrough, objectMode, backpressure (**drain events**), destroy, **pipeline** (error propagation, multi-stream), **finished** (premature close, cleanup), **addAbortSignal**, **Readable.from** (array/generator/async generator/string/Buffer), consumers (text/json/buffer/blob/arrayBuffer), promises (pipeline/finished), **async iteration** |
| **string_decoder** | — | 103 | UTF-8, Base64, hex, streaming |
| **sys** | — | 7 | Alias for util (deprecated) |
| **timers** | — | 88 (3 specs) | setTimeout/setInterval/setImmediate (**delay verification, args, clear, ordering**) + timers/promises |
| **tls** | Gio, GLib | 132 | TLSSocket (encrypted, getPeerCertificate, getProtocol, getCipher, **ALPN**), **connect with TLS handshake**, createServer/TLSServer, createSecureContext, **checkServerIdentity** (CN, wildcard, SAN DNS/IP, FQDN, edge cases, error properties), **getCiphers**, DEFAULT_CIPHERS, rootCertificates |
| **tty** | — | 29 | ReadStream/WriteStream, isatty (various fds), ANSI, clearLine, cursorTo, getColorDepth (env-based), hasColors, getWindowSize |
| **url** | GLib | 278 | URL, URLSearchParams via GLib.Uri |
| **util** | — | 245 (2 specs) | inspect (**colors, styles, custom symbol, defaultOptions**, edge cases), format (%%, %s/%d/%j/%i/%f, args), promisify (**custom symbol**), callbackify, deprecate, inherits (**super_**), isDeepStrictEqual, **types** (isDate/RegExp/Map/Set/Promise/ArrayBuffer/TypedArray/Async/Generator/WeakMap/WeakSet/DataView), TextEncoder/TextDecoder |
| **zlib** | — | 102 | gzip/deflate/deflateRaw round-trip, constants, Unicode, binary, cross-format errors, sync methods, double compression, consistency |

### Partially Implemented (3)

| Package | GNOME Libs | Tests | Working | Missing |
|---------|-----------|-------|---------|---------|
| **worker_threads** | Gio, GLib | 232 | MessageChannel, MessagePort (deep clone: Date, RegExp, Map, Set, Error, TypedArrays), BroadcastChannel, receiveMessageOnPort, environmentData, Worker (Gio.Subprocess with stdin/stdout IPC, **file-based resolution with relative paths**, missing-file error handling, stderr capture), **addEventListener/removeEventListener on MessagePort/BroadcastChannel**, structured clone edge cases (-0, NaN, BigInt, Int32Array) | SharedArrayBuffer, transferList |
| **http2** | — | 102 | Complete constants, getDefaultSettings, getPackedSettings/getUnpackedSettings, Http2Session/Stream class stubs | createServer/createSecureServer/connect (Soup 3.0 lacks multiplexed stream API) |
| **vm** | — | 203 | runInThisContext (eval), runInNewContext (Function constructor with sandbox), runInContext, createContext/isContext, compileFunction, Script (reusable, runInNewContext) | True sandbox isolation (requires SpiderMonkey Realms) |

### Stubs (4)

| Package | Tests | Description | Effort |
|---------|-------|-------------|--------|
| **cluster** | 5 | isPrimary, isMaster, isWorker; fork() throws | High — requires multi-process architecture |
| **domain** | 10 | Deprecated Node.js API; pass-through | Low — intentionally minimal |
| **inspector** | 9 | Session.post(), open/close; empty | Medium — V8-specific, hard to port |
| **v8** | 8 | getHeapStatistics (JSON-based), serialize/deserialize | Medium — V8-specific |

---

## Web API Packages (`packages/web/`)

All 12 packages have real implementations:

| Package | GNOME Libs | Tests | Web APIs |
|---------|-----------|-------|----------|
| **abort-controller** | — | 23 (2 specs) | AbortController, AbortSignal (.abort, .timeout, .any) |
| **compression-streams** | — | 29 | CompressionStream, DecompressionStream (gzip/deflate/deflate-raw). Uses @gjsify/web-streams TransformStream |
| **dom-events** | — | 142 (3 specs) | Event, EventTarget, CustomEvent |
| **dom-exception** | — | 64 | DOMException polyfill (WebIDL standard) |
| **eventsource** | — | 15 | EventSource (Server-Sent Events), TextLineStream. Uses fetch + Web Streams |
| **fetch** | Soup 3.0, Gio, GLib | 51 | fetch(), Request, Response, Headers, Referrer-Policy |
| **formdata** | — | 49 | FormData, File, multipart encoding |
| **streams** | — | 283 | ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream, ByteLengthQueuingStrategy, CountQueuingStrategy (WHATWG Streams polyfill for GJS) |
| **webcrypto** | — | 486 | SubtleCrypto (digest, AES-CBC/CTR/GCM, HMAC, ECDSA, RSA-PSS, RSA-OAEP, PBKDF2, HKDF, ECDH, generateKey, importKey/exportKey, deriveBits/deriveKey), CryptoKey |
| **web-globals** | — | 66 | Unified entry point: imports all Web API packages, registers globals (URL, URLSearchParams, Blob, File, FormData, performance, PerformanceObserver) |
| **websocket** | Soup 3.0, Gio, GLib | 27 | WebSocket, MessageEvent, CloseEvent (W3C spec) |
| **webstorage** | — | 41 | Storage, localStorage, sessionStorage (W3C Web Storage) |

## DOM Packages (`packages/dom/`)

| Package | GNOME Libs | Tests | APIs |
|---------|-----------|-------|------|
| **dom-elements** | GdkPixbuf | 210 | Node, Element, HTMLElement, **HTMLCanvasElement** (base DOM stub), HTMLImageElement, Image, Attr, NamedNodeMap, NodeList, NodeType, NamespaceURI (GJS-only); side-effect registers `globalThis.HTMLCanvasElement`, `HTMLImageElement`, `Image` |
| **webgl** | gwebgl, Gtk 4, Gio | 12 | WebGLRenderingContext (1.0), HTMLCanvasElement (GTK-backed, extends dom-elements base), **WebGLArea** (Gtk.GLArea subclass with requestAnimationFrame + WebGL bootstrap), Extensions |

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
| **@gjsify/utils** | Gio wrappers, process info, encoding, ensureMainLoop | Full |
| **@gjsify/runtime** | Platform-independent runtime detection (isGJS, isNode, runtimeName) | Full |
| **@gjsify/types** | GIR TypeScript bindings | Manual |

---

## GNOME Library Usage

| GNOME Lib | Used In |
|-----------|---------|
| **Gio 2.0** | fs, net, dns, child_process, dgram, tls, module, fetch |
| **GLib 2.0** | crypto, url, os, process, dns, child_process, dgram, tls, module |
| **Soup 3.0** | http, https, fetch, websocket |
| **Gtk 4.0** | webgl |
| **GdkPixbuf 2.0** | dom-elements (HTMLImageElement) |
| **gwebgl 0.1** | webgl (Vala extension) |

---

## Metrics

| Metric | Value |
|--------|-------|
| Total Node.js packages | 39 |
| Fully implemented | 32 (82%) |
| Partially implemented | 3 (8%) |
| Stubs | 4 (10%) |
| Web API packages | 15 (all implemented) |
| GJS infrastructure packages | 4 (unit, utils, runtime, types) |
| Total test cases | 9,900+ |
| Spec files | 102 |
| Real-world examples | 11 (Express, Koa, Static file server, SSE chat, Hono REST, WS chat, file search, DNS lookup, worker pool, GTK dashboard, JSON store) |
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

1. **Real-world application examples** — Validate the platform against real frameworks and use cases. Each example must run on both Node.js and GJS. Current: Express.js hello, Koa.js blog, Static file server, SSE chat, Hono REST API, file search CLI, DNS lookup, worker pool. Planned:

   | Example | Category | Frameworks/APIs | Status |
   |---------|----------|-----------------|--------|
   | ~~**Static file server**~~✓ | net | http, fs, path, stream, zlib | `examples/net/static-file-server` |
   | ~~**SSE chat**~~✓ | net | http, events, fs, SSE protocol | `examples/net/sse-chat` |
   | ~~**Hono REST API**~~✓ | net | hono, http, JSON CRUD | `examples/net/hono-rest` (GJS WIP) |
   | ~~**CLI file search**~~✓ | cli | fs, path, readline, process | `examples/cli/file-search` |
   | ~~**DNS lookup tool**~~✓ | cli | dns, net, readline | `examples/cli/dns-lookup` |
   | ~~**Worker pool**~~✓ | cli | worker_threads, events, crypto | `examples/cli/worker-pool` |
   | **SQLite/JSON data store** | cli | fs, crypto, buffer, stream | — |
   | **GTK + HTTP** (dashboard) | gtk | Gtk 4, Soup, fetch, WebSocket | — |

   These examples serve as integration tests and surface real CJS-ESM interop issues, missing globals, GC problems, and MainLoop edge cases that unit tests alone don't catch.

2. **Increase test coverage** — Port more tests from `refs/node-test/` and `refs/bun/test/`, especially for networking (net, tls, dgram) and fs.

### Medium Priority

3. **worker_threads file-based Workers** — Currently requires pre-bundled .mjs. Support file path resolution relative to build output.
4. **BYOB Byte Streams** — ReadableByteStreamController for optimized binary streaming.
5. **http2 client** — Soup.Session supports HTTP/2 via ALPN; wrap behind Http2Session API. Requires nghttp2 bindings or pure-JS HTTP/2 frame parser.

### Low Priority

6. **v8** — Approximate heap statistics via GJS runtime info.
7. **cluster** — Multi-process via Gio.Subprocess pool.
8. **inspector** — GJS debugger integration (gjs --debugger).

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

### 2026-03-27 — WebGL Refactor: HTMLCanvasElement Inheritance, WebGLArea Widget

**Goal: enable browser-targeted game engines (e.g. Excalibur) to run on GJS/GTK with minimal changes.**

**Base `HTMLCanvasElement` in `@gjsify/dom-elements`:**
- New `packages/dom/dom-elements/src/html-canvas-element.ts` — DOM-spec base class extending `HTMLElement`
- Stubs for `getContext()`, `toDataURL()`, `toBlob()`, `captureStream()` (overridden in `@gjsify/webgl`)
- Side-effect globals on import: `Object.defineProperty(globalThis, 'HTMLCanvasElement', ...)`, `HTMLImageElement`, `Image` — same pattern as `@gjsify/node-globals` and `@gjsify/web-globals`
- Removes the `// TODO move this to dom globals` boilerplate from all WebGL examples

**`@gjsify/webgl` real inheritance + class renames:**
- Removed the fake interface trick (`export interface GjsifyHTMLCanvasElement extends HTMLCanvasElement {}`)
- `GjsifyHTMLCanvasElement` → `HTMLCanvasElement` — now extends `BaseHTMLCanvasElement` from `@gjsify/dom-elements`, overrides `width`/`height` getters with `Gtk.GLArea` allocated size
- `GjsifyWebGLRenderingContext` → `WebGLRenderingContext` (and all other `Gjsify*` class prefixes removed — 136 occurrences across 29 files)
- `getContext('webgl')` creates `WebGLRenderingContext` lazily via `??=`

**New `WebGLArea` widget (`packages/dom/webgl/src/ts/webgl-area.ts`):**
- `Gtk.GLArea` subclass registered with `GObject.registerClass({ GTypeName: 'GjsifyWebGLArea' }, ...)`
- Sets up ES 3.2 context + depth buffer + stencil buffer automatically
- `onWebGLReady(cb: (canvas, gl) => void)` — fires once GL context is initialized
- `requestAnimationFrame(cb)` — backed by `GLib.idle_add` + render signal (replaces per-example boilerplate)
- `installGlobals()` — sets `globalThis.requestAnimationFrame` scoped to this widget
- Handles `unrealize` cleanup (disconnects render handler, removes idle source)

**VAPI cleanup:**
- Deleted unused `packages/dom/webgl/src/vapi/glesv2.vapi` (Vala source uses `using GL;` from `epoxy.vapi` only)
- Updated `epoxy.vapi` header: removed vapigen-generated comment, added attribution to valagl

**Examples refactored (6 files):**
- `examples/gtk/webgl-tutorial-02` through `07` and `webgl-demo-fade` simplified from 60–120 lines → 22–33 lines
- All manual `Gtk.GLArea` setup, `requestAnimationFrame` implementations, and `globalThis.Image =` assignments removed
- All now use `new WebGLArea()` + `glArea.installGlobals()` + `glArea.onWebGLReady((canvas) => start(canvas))`

### 2026-03-27 — Restructure: new `packages/dom/` category

**New package category `packages/dom/` for DOM/platform-specific packages:**
- Moved `dom-elements` from `packages/web/` → `packages/dom/`
- Moved `webgl` from `packages/web/` → `packages/dom/`
- Merged `html-image-element` into `dom-elements` (HTMLImageElement, Image now part of @gjsify/dom-elements)
- Updated `@gjsify/webgl` dependency: `html-image-element` → `dom-elements`
- Updated root `package.json` workspaces, `meson.build`, WebGL example scripts, CLAUDE.md, STATUS.md

### 2026-03-27 — HTTP Upgrade Event, Web Globals, Client Auth, Test Coverage

**HTTP Server upgrade event:**
- `server.on('upgrade', (req, socket, head) => {...})` for custom protocol upgrades
- Uses `Soup.ServerMessage.steal_connection()` to take over raw TCP connection
- Socket is a net.Socket Duplex wrapping the stolen Gio.IOStream
- Note: WebSocket upgrades (`Upgrade: websocket`) are handled by Soup internally via `addWebSocketHandler()`

**HTTP Client improvements:**
- `auth` option for Basic authentication (`http.request({auth: 'user:pass'})`)
- `signal` option for AbortController support
- `localAddress` and `family` options in ClientRequestOptions
- Agent constructor options: `keepAlive`, `maxSockets`, `maxTotalSockets`, `maxFreeSockets`, `scheduling`
- Agent exposes `requests`/`sockets`/`freeSockets` objects for framework compatibility

**Web Globals consolidation:**
- `@gjsify/web-globals` now registers: URL, URLSearchParams, Blob, File, FormData, performance, PerformanceObserver
- Previously only: DOMException, Event/EventTarget, AbortController, Streams, Compression, WebCrypto, EventSource

**Net Socket IOStream support:**
- `net.Socket._setupFromIOStream()` creates sockets from raw `Gio.IOStream` (for stolen connections)
- Proper IOStream lifecycle: `_final()` closes entire SoupIOStream for proper EOF signaling
- `@gjsify/net` exports `./socket` subpath for direct internal imports

**New tests (+200):**
- HTTP: 995→1034 (+39): upgrade event (5 tests), auth option (3), Agent constructor (8), signal option, round-trip
- Net: 361→378 (+17): destroy idempotency, getConnections, maxConnections, address info, bytesWritten/bytesRead
- Web-Globals: 45→66 (+21): URL/URLSearchParams, Blob/File, FormData, Performance globals

### 2026-03-26 — Networking Hardening, Timeout Enforcement, Stream Edge Cases

**HTTP Server improvements:**
- **Chunked streaming**: ServerResponse now uses `Soup.Encoding.CHUNKED` for true streaming via `responseBody.append()` instead of buffering the entire response. Each `res.write()` flushes a chunk.
- **Timeout enforcement**: `ServerResponse.setTimeout()`, `IncomingMessage.setTimeout()`, and `ClientRequest.setTimeout()` now emit `'timeout'` events via actual timers (previously properties existed but were inert).
- **ClientRequest timeout option**: `http.request({timeout: 50})` starts a timer that emits `'timeout'` if no response arrives in time. Timer cleared on response or abort.

**Net Socket improvements:**
- **allowHalfOpen enforcement**: `net.Server({allowHalfOpen})` now stores and passes the option to accepted sockets. When `allowHalfOpen=false` (default), the socket calls `end()` on read EOF, matching Node.js behavior.
- **Socket allowHalfOpen property**: `net.Socket` exposes `allowHalfOpen` as a public property and respects it during EOF handling in the read loop.

**New tests (+200):**
- HTTP: 890→995 (+105): ServerResponse.setTimeout, IncomingMessage.setTimeout, ClientRequest.setTimeout/timeout option, abort events, HEAD no-body, automatic headers, custom status messages, res.end() callback, multiple headers (Set-Cookie), flushHeaders, POST body streaming (empty/64KB), error handling (EADDRINUSE, connection refused), server lifecycle
- Net: 295→361 (+66): Socket.setTimeout (idle timeout, data resets, cancellation), allowHalfOpen enforcement, server lifecycle (listening, close, address, getConnections), connection lifecycle (connect/ready events, connecting state, bytesRead/bytesWritten), destroy/close events, error handling (connection refused, EADDRINUSE), setKeepAlive/setNoDelay chainability, maxConnections, echo/binary data
- Stream: 288→330 (+42): pipeline (error propagation from source/transform/sink, callback behavior), finished (writable/readable/error/premature close, cleanup), Transform _flush (data push, error propagation), Readable.from (array/generator/async generator/string/Buffer), addAbortSignal (abort/already-aborted), backpressure (write returns false, drain events), PassThrough, Duplex read+write, objectMode, async iteration with errors

### 2026-03-26 — Fetch Globals, WebSocket Server, EADDRINUSE Fix, GTK Dashboard

**Infrastructure fixes:**
- **Fetch API globals on GJS**: `@gjsify/fetch` now registers `fetch`, `Request`, `Response`, `Headers` on `globalThis`. `@gjsify/node-globals` imports `@gjsify/fetch` for side-effect registration (replaces empty stubs).
- **EADDRINUSE error on GJS**: `http.Server.listen()` now throws when port is busy and no `'error'` listener is registered, matching Node.js behavior (previously exited silently).
- **WebSocket server**: `http.Server.addWebSocketHandler(path, callback)` delegates to `Soup.Server.add_websocket_handler()` for server-side WebSocket on GJS.

**New examples:**
- `examples/net/ws-chat`: WebSocket chat using `Soup.WebsocketConnection` signals, with REST POST fallback
- `examples/gtk/http-dashboard`: GTK4 window + embedded HTTP server. Labels show request count/uptime, TextView shows request log. Uses `GLib.idle_add()` for thread-safe UI updates.

### 2026-03-26 — Real-World Examples Sprint (+6 examples, +116 tests)

**New examples (all work on both Node.js and GJS unless noted):**
- `examples/net/static-file-server`: `createReadStream().pipe(res)`, MIME types, gzip, directory listing, 304 caching
- `examples/net/sse-chat`: Real-time chat via Server-Sent Events + HTTP POST, EventEmitter message bus
- `examples/net/hono-rest`: Hono.js CRUD REST API with JSON validation (Node.js works, GJS needs Fetch API globals)
- `examples/cli/file-search`: Recursive file search using `createReadStream` + `readline.createInterface`
- `examples/cli/dns-lookup`: Interactive DNS tool using `dns.lookup/resolve4/resolve6/reverse`
- `examples/cli/worker-pool`: Task pool with MessageChannel for inter-worker communication

**New tests:**
- HTTP streaming (65 tests): `Readable.pipe(res)`, multi-chunk writes, large bodies (256KB), POST body, concurrent requests, routing, server lifecycle
- fs streams (27 tests): `createReadStream`/`createWriteStream`, pipe (ReadStream→WriteStream, Transform, PassThrough), Unicode, binary
- net TCP (24 tests): echo server, 64KB data transfer, connection events, socket properties, UTF-8/binary, error handling

**Validated:** `createReadStream().pipe(res)` works on GJS. TCP echo and data transfer work cross-platform. MessageChannel postMessage works for task distribution.

### 2026-03-26 — Static File Server Example

**New example:**
- `examples/net/static-file-server`: Static file server with `fs.createReadStream().pipe(res)`, MIME type detection, gzip compression (`zlib.gzipSync`), directory listing, `If-Modified-Since`/304, directory traversal prevention. Runs on both Node.js and GJS.

**Validated:** `createReadStream().pipe(res)` works correctly on GJS — the stream pipe mechanism (Readable→Writable with backpressure) and Soup.Server response buffering are fully compatible.

### 2026-03-26 — Real-World Application Examples & GJS Compat Fixes

**New examples:**
- `examples/net/koa-blog`: Koa.js blog with EJS templates, HTML forms, JSON API, CRUD. Runs on both Node.js and GJS.
- `examples/net/express-hello`: Updated to use `@gjsify/runtime` for platform detection.

**New packages:**
- `@gjsify/runtime`: Platform-independent runtime detection (isGJS, isNode, runtimeName, runtimeVersion). No dependencies, works on both platforms.

**GJS compatibility fixes surfaced by real-world frameworks:**
- **http.Server GC guard**: Koa/Express create http.Server inside `.listen()` and discard the return value. GJS GC collected the server after ~10s of inactivity. Fix: module-level `Set<Server>` keeps strong references to all listening servers.
- **http.Server connection exhaustion**: Soup.Server keeps HTTP/1.1 connections alive by default. After ~10 requests, connection pool was full. Fix: set `Connection: close` header, always call `set_response()` even for empty bodies (redirects, 204s).
- **assert cjs-compat.cjs**: Koa's `require('assert')` got a namespace object instead of the assert function. Added CJS compatibility wrapper.
- **Web API stubs**: Registered `Response`, `Request`, `Headers`, `ReadableStream`, `Blob` as empty global classes on GJS. Prevents `ReferenceError` in frameworks using `val instanceof Response`.
- **StringDecoder function constructor**: Converted from ES6 class to function constructor. `iconv-lite` (used by `koa-bodyparser`) calls `StringDecoder.call(this, enc)` which fails on ES6 classes.
- **skipLibCheck for TS6**: Added to all example and `@gjsify/unit` tsconfigs. `@types/node@25.5.0` has `export = console` pattern incompatible with TypeScript 6's `module: NodeNext`.

### 2026-03-25 — Comprehensive Improvement Sprint (3,260→8,100 tests)

**Phase 1 — Test pipeline stabilization:**
- Fixed test failures in perf_hooks, process, readline, tty, fetch, formdata, stream, url
- Stabilized cross-platform test execution for consistent Node.js and GJS results

**Phase 2 — Test expansion (path, url, diagnostics_channel, zlib):**
- path: 51→135 (parse, format, normalize, resolve, relative, isAbsolute, POSIX + Win32 edge cases)
- url: 82→278 (URL constructor, searchParams, edge cases, legacy url.parse/format/resolve)
- diagnostics_channel: 26→137 (Channel lifecycle, subscribe/unsubscribe, TracingChannel, hasSubscribers)
- zlib: expanded sync/async methods, double compression, consistency tests

**Phase 3 — fs and os implementation fixes:**
- fs: Dirent methods (isFile/isDirectory/isSymbolicLink), FSWatcher persistent option, mkdirSync recursive return value, async rmdir/unlink, proper ENOENT/EACCES error codes
- os: Fixed TODO items in implementation

**Phase 4 — Test expansion (http, vm, worker_threads):**
- http: 136→457 (STATUS_CODES completeness, IncomingMessage/ServerResponse properties, Agent lifecycle, request options, chunked encoding, error handling)
- vm: 49→203 (runInThisContext edge cases, runInNewContext sandbox isolation, Script reuse, compileFunction params, createContext/isContext, error propagation)
- worker_threads: 93→217 (MessageChannel ordering, MessagePort lifecycle, BroadcastChannel multi-receiver, Worker IPC, structured clone completeness, environmentData)

**Phase 5 — Web API expansion (web-streams, webcrypto + impl fixes):**
- web-streams: 139→283 (ReadableStream tee/pipeTo/pipeThrough, WritableStream abort/close, TransformStream backpressure, TextEncoderStream/TextDecoderStream edge cases, queuing strategies)
- webcrypto: 190→486 (digest all algorithms, AES-CBC/CTR/GCM round-trip, HMAC sign/verify, ECDSA/RSA-PSS/RSA-OAEP, PBKDF2/HKDF/ECDH derivation, generateKey/importKey/exportKey completeness, CryptoKey properties)
- webcrypto impl fixes for GJS compatibility

**Total: 3,260→8,100 test cases. 83 spec files. All pass on both Node.js and GJS.**

### 2026-03-25 — Test Expansion Sprint (+720 tests)

**Phase 1 — Underserved packages (8 packages, +442 tests):**
- readline: 24→130 (line events, mixed endings, Unicode, history, async iterator, CSI utilities)
- https: 24→62 (Agent options, globalAgent, request/get methods, createServer/Server)
- tty: 23→29 (isatty, ReadStream/WriteStream prototype, getColorDepth env)
- module: 27→158 (builtinModules completeness, isBuiltin edge cases, createRequire)
- async_hooks: 28→74 (enterWith, snapshot, exit with args, triggerAsyncId option)
- process: 37→75 (env CRUD, pid/ppid, hrtime ordering, memoryUsage, nextTick, cpuUsage)
- os: 32→62 (type/platform/arch validation, constants signals/errno, userInfo, networkInterfaces)
- console: 37→84 (format specifiers, table, dir, time/timeLog, Console stdout/stderr routing)

**Phase 2 — Core packages (2 packages, +167 tests):**
- events: 60→127 (setMaxListeners, errorMonitor, captureRejections, prependListener, rawListeners, Symbol events, async iterator)
- buffer: 52→152 (encodings, TypedArray/ArrayBuffer, fill, indexOf/lastIndexOf, swap16/32/64, int/float read/write, equals)

**Phase 3 — Coverage gaps (3 packages, +111 tests):**
- dgram: 37→80 (socket methods, broadcast/TTL/multicast, ref/unref, IPv6, connect/disconnect, I/O)
- fs/promises: 30→59 (writeFile/readFile round-trip, mkdir/rmdir, stat, rename, copyFile, chmod, mkdtemp, truncate)
- perf_hooks: 31→70 (mark/measure lifecycle, getEntries filtering, clearMarks/Measures, toJSON, exports)

**Implementation fixes:**
- `async_hooks`: Fixed AsyncResource.asyncId() to return stable per-instance id; added snapshot(), exit() with args, triggerAsyncId option
- `os`: Fixed trailing newline from cli() output in type()/platform()/release()
- `buffer`: Fixed lastIndexOf with undefined byteOffset on SpiderMonkey (was searching from index 0)
- `module`: Added async_hooks to builtinModules list

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
