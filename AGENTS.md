# AGENTS.md — gjsify

Node.js API implementation for GJS (GNOME JavaScript). Monorepo (`Yarn workspaces`, v0.0.4, ESM-first). All packages use native GNOME libraries.

## Structure

```
packages/
  node/   — 39 Node.js API polyfills (see table below)
  gjs/    — GJS modules: unit (test framework), utils, types
  infra/  — cli, esbuild-plugin-gjsify, esbuild-plugin-alias, esbuild-plugin-deepkit,
             esbuild-plugin-transform-ext, resolve-npm, empty
  web/    — Web API polyfills: fetch, dom-events, abort-controller, formdata,
             globals, html-image-element, websocket, webgl
refs/     — read-only git submodules (node, node-test, deno, bun, quickjs,
             workerd, edgejs, llrt, gjs, wpt, stream-http,
             headless-gl, troll, crypto-browserify, readable-stream, undici,
             browserify-cipher, browserify-sign, create-ecdh,
             create-hash, create-hmac, diffie-hellman, hash-base,
             pbkdf2, public-encrypt, randombytes, randomfill,
             node-gst-webrtc, happy-dom, jsdom)
```

## Node.js Packages (`packages/node/*`)

Each is `@gjsify/<name>`. All have native GJS implementations.

| Package | GNOME Libs | Status | Notes |
|---------|-----------|--------|-------|
| assert | — | Full | AssertionError, deepEqual, throws, strict mode |
| async_hooks | — | Full | AsyncLocalStorage, AsyncResource, createHook |
| buffer | — | Full | Buffer via global Blob/File/atob/btoa |
| child_process | Gio | Full | exec/execSync, execFile/execFileSync, spawn/spawnSync via Gio.Subprocess |
| cluster | — | Stub | isPrimary, isMaster, isWorker, fork throws |
| console | — | Full | Console class with stream support |
| crypto | GLib | Partial | Hash (GLib.Checksum), Hmac (GLib.Hmac), randomBytes/UUID (WebCrypto/GLib) |
| dgram | Gio | Full | UDP Socket via Gio.Socket, bind, send, receive, multicast |
| diagnostics_channel | — | Full | Channel, TracingChannel, subscribe/unsubscribe |
| dns | Gio | Full | lookup, resolve4/6, reverse via Gio.Resolver + dns/promises |
| domain | — | Stub | Deprecated. Domain stub with run/bind/intercept |
| events | — | Full | EventEmitter, once, on, listenerCount |
| fs | Gio | Full | sync, callback, promises, streams, FSWatcher |
| globals | GLib | Full | process, Buffer, structuredClone, TextEncoder/Decoder, atob/btoa, URL, setImmediate |
| http | Soup 3.0 | Partial | Server (Soup.Server), IncomingMessage, ServerResponse, STATUS_CODES, METHODS |
| http2 | — | Stub | constants, createServer/connect throw |
| https | — | Partial | Agent, stub request/get (requires http completion) |
| inspector | — | Stub | Session stub, open/close/url |
| module | Gio, GLib | Full | builtinModules, isBuiltin, createRequire (with JSON loading and module resolution) |
| net | Gio | Full | Socket (Duplex via Gio.SocketClient), Server (Gio.SocketService), connect/createServer |
| os | GLib | Full | homedir, hostname, cpus, platform-specific (linux.ts, darwin.ts) |
| path | — | Full | POSIX + Win32 path operations |
| perf_hooks | — | Full | performance (Web API / GLib fallback), monitorEventLoopDelay stub |
| process | GLib | Full | Process extends EventEmitter, env, cwd, platform |
| querystring | — | Full | parse/stringify |
| readline | — | Full | Interface, createInterface, question, prompt, async iterator, clearLine, cursorTo |
| stream | — | Full | Readable, Writable, Duplex, Transform, PassThrough |
| string_decoder | — | Full | UTF-8, Base64, hex, streaming support |
| timers | — | Full | setTimeout/setInterval/setImmediate + Timeout class + timers/promises |
| tls | Gio | Partial | TLSSocket via Gio.TlsClientConnection, connect, createSecureContext |
| tty | — | Full | ReadStream/WriteStream with ANSI escapes, clearLine, cursorTo, getColorDepth |
| url | GLib | Full | URL, URLSearchParams via GLib.Uri |
| util | — | Full | inspect, format, promisify, types |
| v8 | — | Stub | getHeapStatistics, serialize/deserialize (JSON-based) |
| vm | — | Stub | runInThisContext (eval), Script class |
| worker_threads | — | Stub | isMainThread, Worker throws |
| zlib | — | Full | gzip/deflate via Web Compression API, Gio.ZlibCompressor fallback |

## Web Packages (`packages/web/*`)

| Package | GNOME Libs | Implements |
|---------|-----------|------------|
| fetch | Soup 3.0, Gio | fetch(), Request, Response, Headers |
| dom-events | — | Event, CustomEvent, EventTarget, DOMException |
| abort-controller | — | AbortController, AbortSignal (uses @gjsify/dom-events) |
| formdata | — | FormData, File |
| globals | — | Re-exports dom-events + abort-controller for global scope |
| html-image-element | GdkPixbuf | HTMLImageElement, Image (uses happy-dom) |
| websocket | Soup 3.0 | WebSocket, MessageEvent, CloseEvent |
| webgl | Gtk 4.0, Gio | WebGL 1.0 via Vala native extension (@gwebgl-0.1) |

### Planned Web Packages

| Package (planned) | GNOME Libs | Reference | Priority |
|-------------------|-----------|----------|----------|
| web-streams | Gio | `refs/deno/ext/web/06_streams.js` | High — foundation for CompressionStream, TextEncoderStream |
| compression-streams | Gio | `refs/deno/ext/web/14_compression.js` | Medium — uses Gio.ZlibCompressor |
| webcrypto | GLib | `refs/deno/ext/crypto/00_crypto.js` | Medium — partial via GLib.Checksum/Hmac |
| eventsource | Soup 3.0 | `refs/deno/ext/fetch/27_eventsource.js`, `refs/undici/lib/web/eventsource/` | Low |
| webstorage | Gio | `refs/deno/ext/webstorage/01_webstorage.js` | Low |

## Build System

esbuild with platform-specific plugins. Same test source, different resolution per platform:

- **GJS** (`gjsify build --app gjs`): `assert` → `@gjsify/assert`, etc. Externals: `gi://*`, `cairo`, `system`, `gettext`. Target: `firefox128`.
- **Node** (`gjsify build --app node`): `@gjsify/process` → `process`, etc. Native built-ins. Target: `node18`.

Key files:
- `packages/infra/esbuild-plugin-gjsify/src/app/gjs.ts` — GJS platform config
- `packages/infra/esbuild-plugin-gjsify/src/app/node.ts` — Node platform config
- `packages/infra/resolve-npm/lib/index.mjs` — alias mappings per platform

### Commands

```bash
yarn build                # Build everything
yarn build:node           # Build all Node.js polyfill packages
yarn build:web            # Build all Web polyfill packages
yarn test                 # Test everything
yarn check                # Type-check all packages (tsc --noEmit)
```

Per-package:
```bash
yarn build:gjsify         # Build library (ESM → lib/)
yarn build:types          # Generate .d.ts
yarn build:test:gjs       # gjsify build src/test.mts --app gjs --outfile test.gjs.mjs
yarn build:test:node      # gjsify build src/test.mts --app node --outfile test.node.mjs
yarn test:node            # node test.node.mjs
yarn test:gjs             # gjs -m test.gjs.mjs
```

## GNOME Libraries (`node_modules/@girs/*`)

| Library | Package | Maps To |
|---------|---------|---------|
| GLib 2.0 | `@girs/glib-2.0` | ByteArray, Checksum, DateTime, Regex, URI, env, MainLoop |
| GObject 2.0 | `@girs/gobject-2.0` | Object system, signals, properties |
| Gio 2.0 | `@girs/gio-2.0` | File/streams (fs), Socket/InetAddress (net), TLS, DBus |
| GioUnix 2.0 | `@girs/giounix-2.0` | Unix FDs, mount monitoring |
| Soup 3.0 | `@girs/soup-3.0` | HTTP client/server (fetch, http), WebSocket, cookies |
| GJS | `@girs/gjs` | Runtime info, GJS-specific APIs |

### Node→GNOME Mapping

```
fs.*          → Gio.File, Gio.FileInputStream, Gio.FileOutputStream
Buffer        → GLib.Bytes, GLib.ByteArray, Uint8Array
EventEmitter  → custom implementation (not GObject signals)
net.Socket    → Gio.SocketConnection, Gio.SocketClient
http          → Soup.Session, Soup.Server
crypto hashes → GLib.Checksum, GLib.Hmac
process.env   → GLib.getenv(), GLib.setenv()
url.URL       → GLib.Uri
```

### Web→GNOME Mapping

```
fetch()            → Soup.Session (already in @gjsify/fetch)
WebSocket          → Soup.WebsocketConnection (already in @gjsify/websocket)
Web Streams        → Gio.InputStream/OutputStream wrapper + Gio.ConverterInputStream
CompressionStream  → Gio.ZlibCompressor/Decompressor (already used in @gjsify/zlib)
SubtleCrypto       → GLib.Checksum + GLib.Hmac + extern (RSA/EC not natively available)
localStorage       → Gio.File (JSON-based) or GLib.KeyFile
Cache API          → Gio.File + Soup.Cache
ImageBitmap        → GdkPixbuf.Pixbuf
EventSource        → Soup.Session (SSE via streaming response)
```

## Reference Implementations (`refs/`)

Read-only git submodules — do NOT modify. Use GNOME libraries internally, not copied code.

### Node.js References

| Path | Use |
|------|-----|
| `refs/node/` | Canonical Node.js behavior (the spec). Check `lib/<name>.js`, tests in `test/parallel/test-<name>*.js` |
| `refs/node-test/` | wasmerio/node-test — isolated Node.js tests for any Node-like runtime. 3.897 tests, 43 modules, pre-sorted in `module-categories/`. **Primary test source.** |
| `refs/deno/` | TypeScript reference, closest to gjsify's use case. Node.js polyfills in `ext/node/polyfills/`. **Also primary Web API reference** — see Web API References below |
| `refs/bun/` | Alternative TS/Zig implementation, clean TypeScript tests in `test/js/node/` |
| `refs/quickjs/` | Lightweight JS engine (ES2024) — language feature tests in `tests/`, limited Node.js API coverage |
| `refs/workerd/` | Cloudflare Workers Runtime — Node.js compat layer with 67 tested modules, two-layer architecture (C++ + TS). Tests in `src/workerd/api/node/tests/` |
| `refs/edgejs/` | Edge.js — Node-compatible JS runtime for edge computing. Uses node-test as test suite. Reference for test harness patterns |
| `refs/llrt/` | AWS LLRT (Low Latency Runtime) — lightweight JS runtime (Rust + QuickJS) with Node.js compat. Tests in `tests/unit/` cover assert, buffer, crypto, events, fs, net, path, stream, etc. |

### Web API References

| Path | Use |
|------|-----|
| `refs/deno/` | **Primary Web API reference.** `ext/web/` (Streams, Events, Compression, TextEncoding, Performance, Blob/File, structuredClone, MessagePort, BroadcastChannel, URLPattern, ImageData), `ext/fetch/` (fetch, Headers, Request, Response, FormData, EventSource), `ext/crypto/` (SubtleCrypto, CryptoKey), `ext/websocket/` (WebSocket), `ext/webstorage/` (localStorage, sessionStorage), `ext/cache/` (Cache, CacheStorage), `ext/image/` (ImageBitmap). Tests in `tests/unit/` |
| `refs/wpt/` | W3C Web Platform Tests — canonical test suite for web standards. Equivalent of `refs/node-test/` for Web APIs. Tests for fetch, DOM events, AbortController, WebSocket, Streams, Encoding, URL, and more. Shallow clone |
| `refs/happy-dom/` | Pure-JS browser environment (no GUI) — DOM (60+ element types), HTML parsing, CSS, MutationObserver, IntersectionObserver, TreeWalker, Range, Selection. **296 test files.** Reference for `packages/web/dom-events/`, `packages/web/html-image-element/` |
| `refs/jsdom/` | JS implementation of web standards (DOM, HTML, CSS) — 30+ modules in `lib/jsdom/living/` (DOM, CSS, Fetch, File API, Web Crypto, WebSocket, XHR, Storage). **WPT integration** in `test/web-platform-tests/` for W3C compliance testing |
| `refs/undici/` | Official Node.js HTTP client. `lib/web/` contains: fetch (Headers, Request, Response, FormData), WebSocket, Cache API, EventSource, cookies. **366 test files.** Reference for `@gjsify/fetch` and `@gjsify/http` |
| `refs/headless-gl/` | Headless WebGL — 42 test files (shaders, buffers, textures, extensions). Reference for `packages/web/webgl/` |
| `refs/node-gst-webrtc/` | WebRTC JS API via GStreamer's webrtcbin — incomplete but useful approach for RTCPeerConnection, RTCDataChannel, RTCSessionDescription, MediaStreamTrack using GStreamer/GObject bindings |

### Other References

| Path | Use |
|------|-----|
| `refs/gjs/` | GJS internals: `modules/` (built-in JS), `gjs/` (C++ runtime), `gi/` (GObject Introspection) |
| `refs/stream-http/` | HTTP via Node.js streams — reference for `@gjsify/http` |
| `refs/troll/` | GJS utility patterns (Sonny Piers) |
| `refs/crypto-browserify/` | Pure-JS crypto orchestrator — wires together the sub-packages below for `@gjsify/crypto` |
| `refs/browserify-cipher/` | AES cipher/decipher (createCipher, createCipheriv, getCiphers) — dep of crypto-browserify |
| `refs/browserify-sign/` | Sign/Verify (createSign, createVerify) + algo list — dep of crypto-browserify |
| `refs/create-ecdh/` | ECDH key exchange (createECDH) — dep of crypto-browserify |
| `refs/create-hash/` | Hash streaming (createHash, MD5/SHA) — dep of crypto-browserify |
| `refs/create-hmac/` | HMAC streaming (createHmac) — dep of crypto-browserify |
| `refs/diffie-hellman/` | DH key agreement (createDiffieHellman, getDiffieHellman) — dep of crypto-browserify |
| `refs/hash-base/` | Base class for streaming hash transforms — dep of create-hash/create-hmac |
| `refs/pbkdf2/` | PBKDF2 key derivation (pbkdf2, pbkdf2Sync) — dep of crypto-browserify |
| `refs/public-encrypt/` | RSA encrypt/decrypt (publicEncrypt, privateDecrypt) — dep of crypto-browserify |
| `refs/randombytes/` | Random byte generation (randomBytes) — dep of crypto-browserify |
| `refs/randomfill/` | Random buffer filling (randomFill, randomFillSync) — dep of crypto-browserify |
| `refs/readable-stream/` | Maintained Node.js stream polyfill — reference for edge cases |
| `refs/ungap-structured-clone/` | Pure-JS structuredClone polyfill — serialize/deserialize pattern, type dispatch, circular refs. Reference for `packages/gjs/utils/src/structured-clone.ts` |

## Official Node.js npm Packages

Some Node.js core modules are published as standalone npm packages (pure JS, browser-compatible). Because our esbuild bundler aliases `buffer` → `@gjsify/buffer`, `events` → `@gjsify/events`, etc., these packages can work in GJS builds without modification — the bundler injects our GJS-compatible implementations.

**Usable as direct dependencies (instead of reimplementing):**

| npm Package | Published By | Can Replace | Notes |
|-------------|-------------|-------------|-------|
| `readable-stream` (v4) | nodejs-foundation | `@gjsify/stream` | Official Node.js streams for userland. Deps: buffer, events, process, string_decoder — all aliased to @gjsify/* |
| `string_decoder` (v1.3) | nodejs-foundation | `@gjsify/string_decoder` | Official. Dep: safe-buffer → buffer (aliased) |

**Useful as references only (need native APIs we don't have yet):**

| npm Package | Why Reference-Only |
|-------------|-------------------|
| `undici` (v7) | HTTP client — uses net, tls, crypto internally. Useful after Phase 2 networking is done |

**Decision guideline:** Prefer reimplementing in TypeScript over depending on npm packages. Third-party npm packages cause problems in GJS because:
1. They use legacy patterns (`Transform.call(this)`, `inherits()`) incompatible with ES6 classes in SpiderMonkey
2. They reference globals like `Buffer` or `process` that aren't available at module load time in GJS
3. Circular dependencies arise when the bundler aliases `crypto`/`stream`/`buffer` back to our implementations
4. The `"browser"` field in package.json may not be respected by the bundler depending on `mainFields` config

Use npm packages only as **references** (read the source, understand the algorithm, rewrite in TypeScript). Use `refs/` submodules for the same purpose. The resulting TypeScript implementation should use our own modules (`@gjsify/stream`, `@gjsify/buffer`, etc.) directly via imports, not through bundler aliases.

## Native Extensions (Vala)

For low-level system access without GIR bindings. Vala → Meson → shared library + GIR typelib → `gi://` import.

Example: `packages/web/webgl/` — WebGL via Vala + Meson. Prefer TypeScript; use Vala only when C-level access is required.

## Testing

### Framework: `@gjsify/unit` (`packages/gjs/unit/`)

```typescript
import { describe, it, expect, on } from '@gjsify/unit';

export default async () => {
  await describe('module.function', async () => {
    await it('should do X', async () => {
      expect(result).toBe(expected);
    });
  });
  await on('Gjs', async () => { /* GJS-only test */ });
  await on('Node.js', async () => { /* Node-only test */ });
};
```

Matchers: `toBe`, `toEqual`, `toBeTruthy`, `toBeFalsy`, `toBeNull`, `toBeDefined`, `toBeUndefined`, `toBeLessThan`, `toBeGreaterThan`, `toContain`, `toMatch`, `toThrow` + `.not` negation.

### Test Rules

1. **Always use bare specifiers in test imports — never relative paths or `@gjsify/*` package names.**
   The bundler resolves bare specifiers to the correct implementation per platform: on GJS, `'stream'` → `@gjsify/stream`; on Node.js, `'stream'` stays as native `stream`. Relative imports (`'./index.js'`) bypass the bundler alias system entirely, causing the gjsify implementation to be bundled into the Node.js test — which defeats the purpose (Node.js tests should validate against the native implementation, not our polyfill).
   - **Node.js packages:** Use the Node.js module name: `from 'assert'`, `from 'stream/web'`, `from 'crypto'`
   - **Web packages:** Use the standard bare specifier registered in `ALIASES_WEB_FOR_GJS` (see `packages/infra/resolve-npm/lib/index.mjs`). If no bare specifier alias exists yet for a Web package, **add one** to both `ALIASES_WEB_FOR_GJS` and `ALIASES_WEB_FOR_NODE` (mapping to the native/global equivalent or `@gjsify/empty` if native). Do NOT fall back to relative imports.
   - **Never import `@gjsify/*` directly** in test files (except `@gjsify/unit` for the test framework). The `@gjsify/*` namespace is an implementation detail — tests must be written against the standard API surface.
2. Node.js tests validate **test correctness** against the reference. GJS tests validate **our implementation**. Both must pass.
3. No GJS-specific code (`@girs/*`, Soup, Gio) in test files — the bundler handles platform separation.
4. File layout: `src/index.ts` (impl), `src/*.spec.ts` (specs), `src/test.mts` (entry point).
5. **Tests define the specification — never weaken tests to match implementation gaps.** If a test fails on GJS, fix the implementation, not the test. If a Web API like `CompressionStream` is missing in GJS, implement a polyfill using GNOME libraries (e.g. `Gio.ZlibCompressor`). If event timing differs (sync vs async), fix the implementation to match Node.js behavior.
6. **Both platforms must behave identically.** Do not use platform guards (`if (typeof X === 'undefined') return`) to skip tests on GJS. The whole point of gjsify is Node.js API compatibility — if something works on Node.js, our GJS implementation must match. The only exception is features we **intentionally** stub (see Status column in package table).

## Package Convention

Each `packages/node/<name>/`:
- `package.json`: `@gjsify/<name>`, v0.0.4, `"type": "module"`
- Exports: `./lib/esm/index.js` (import) — ESM-only, no CJS
- Scripts: `build:gjsify`, `build:types`, `build:test:gjs`, `build:test:node`, `test`, `test:gjs`, `test:node`
- Deps: `@girs/*` (implementation), `@gjsify/unit` (devDep)
- **Workspace dependencies** must always use `workspace:^` (e.g. `"@gjsify/cli": "workspace:^"`). Never use fixed versions for packages that exist in this monorepo.

## Implementation Workflow (Test-Driven)

We follow a **test-driven development** approach: tests are written first, then the implementation is completed until all tests pass.

**Core principle:** Tests are the specification. They define the correct Node.js behavior. When a test fails on GJS, the implementation must be fixed — never the test. This applies to:
- Missing Web APIs (e.g. `CompressionStream`) → implement using GNOME libraries
- Different event timing (sync vs async) → fix implementation to match Node.js async scheduling
- Missing globals (e.g. `btoa`) → implement polyfills
- Any behavioral difference between Node.js and GJS → the GJS implementation is wrong, fix it

### Step-by-step

1. **Study the Node.js API surface:** `refs/node/lib/<name>.js`
2. **Adopt tests from reference projects** (see below). Port relevant test cases to `*.spec.ts` using `@gjsify/unit`. Focus on tests that exercise behavior our GJS implementation must support.
3. **Verify tests pass on Node.js first:** `yarn test:node` — this confirms the tests themselves are correct against the reference runtime.
4. **Run tests on GJS:** `yarn test:gjs` — expect failures. **This is the signal to fix the implementation, not to weaken the tests.**
5. **Implement/fix** using GNOME libraries (`@girs/*`), check types in `node_modules/@girs/`. Consult references: `refs/deno/`, `refs/bun/`, `refs/quickjs/`, `refs/workerd/`.
6. **Iterate** until `yarn test:gjs` passes alongside `yarn test:node`.
7. **Full validation:** After completing the implementation, run the full project pipeline and fix any issues:
   ```bash
   yarn install && yarn clear && yarn build && yarn check && yarn test
   ```
   The `clear` step removes all build artifacts to ensure a clean rebuild. This ensures the new code doesn't break other packages. Fix any install, build, type-check, or test failures before considering the task done.

### Test Sources from Reference Projects

Port meaningful tests from these reference projects into our `*.spec.ts` files. Do **not** copy tests verbatim — rewrite them using `@gjsify/unit` (`describe`/`it`/`expect`) and bare specifier imports.

| Source | Where to find tests | Notes |
|--------|-------------------|-------|
| node-test (`refs/node-test/`) | `parallel/test-<name>*.js`, `module-categories/` | **Primary source.** Curated for non-Node runtimes. 3.897 tests, 43 modules. |
| Node.js (`refs/node/`) | `test/parallel/test-<name>*.js` | Canonical reference — exhaustive edge cases and error handling. |
| Bun (`refs/bun/`) | `test/js/node/` | Clean TypeScript tests, often more concise. Good for async_hooks, process. |
| workerd (`refs/workerd/`) | `src/workerd/api/node/tests/` | 67 modules tested. Similar two-layer architecture (native + TS). |
| QuickJS (`refs/quickjs/`) | `tests/` | Language feature tests — limited Node.js API coverage. |
| Edge.js (`refs/edgejs/`) | Uses node-test | Reference for test harness integration pattern. |
| LLRT (`refs/llrt/`) | `tests/unit/*.test.ts` | AWS runtime (Rust + QuickJS). TypeScript tests for assert, buffer, crypto, events, fs, net, path, stream. |

**Selection criteria:** Prefer tests that cover:
- Core API behavior (the happy path)
- Edge cases relevant to our GNOME-based implementation (e.g. encoding handling, stream backpressure)
- Error conditions and argument validation
- Cross-platform compatibility issues

Skip tests that depend on Node.js/V8 internals, native addons, or features we intentionally stub.

### Web API Test Sources from Reference Projects

Port meaningful tests from these reference projects into `packages/web/*/src/*.spec.ts` files. Same rules as Node.js test sources: rewrite using `@gjsify/unit`, bare specifier imports, no verbatim copying.

| Source | Where to find tests | Web APIs covered |
|--------|-------------------|-----------------|
| WPT (`refs/wpt/`) | `fetch/`, `dom/`, `websockets/`, `streams/`, `encoding/`, `url/`, `FileAPI/`, `compression/`, `eventsource/`, `webstorage/`, `webgl/` | **Canonical W3C/WHATWG test suite.** Authoritative for all Web APIs. Equivalent of `refs/node-test/` for web standards. |
| Deno (`refs/deno/`) | `tests/unit/fetch_test.ts` (~2.400 lines), `tests/unit/webcrypto_test.ts` (~2.200 lines), `tests/unit/websocket_test.ts` (~1.200 lines), `tests/unit/streams_test.ts` (~750 lines), `tests/unit/event_target_test.ts`, `tests/unit/event_test.ts`, `tests/unit/abort_controller_test.ts`, `tests/unit/dom_exception_test.ts` | TypeScript unit tests — largest Web API test corpus. Good for fetch, crypto, WebSocket, streams, events. |
| happy-dom (`refs/happy-dom/`) | `packages/happy-dom/test/` (296 test files) | DOM elements (60+ types), events, CSS, MutationObserver, IntersectionObserver, TreeWalker, Range, Selection, fetch, FormData, WebSocket, Storage |
| jsdom (`refs/jsdom/`) | `test/web-platform-tests/` (WPT runner), `test/to-port-to-wpts/` | W3C-compliant DOM/HTML tests, web-platform-tests integration |
| undici (`refs/undici/`) | `test/` (366 test files) | fetch (Headers, Request, Response), FormData, WebSocket, Cache API, EventSource, cookies |

### Deno Web API Implementation Files

Use these as implementation references when building `packages/web/` packages:

| Deno file | Web APIs | Notes |
|-----------|----------|-------|
| `ext/web/06_streams.js` | ReadableStream, WritableStream, TransformStream, ByteLengthQueuingStrategy, CountQueuingStrategy | Complete WHATWG Streams implementation |
| `ext/web/14_compression.js` | CompressionStream, DecompressionStream | Uses Rust ops internally; reimplement with Gio.ZlibCompressor |
| `ext/web/02_event.js` | Event, EventTarget, CustomEvent, ErrorEvent, CloseEvent, MessageEvent, ProgressEvent | Full DOM Events spec |
| `ext/web/03_abort_signal.js` | AbortController, AbortSignal | Signal.abort(), Signal.timeout(), Signal.any() |
| `ext/web/08_text_encoding.js` | TextEncoder, TextDecoder, TextEncoderStream, TextDecoderStream | Streaming variants useful for web-streams |
| `ext/web/09_file.js` | Blob, File | WHATWG File API |
| `ext/web/10_filereader.js` | FileReader | Async file reading |
| `ext/web/15_performance.js` | Performance, PerformanceMark, PerformanceMeasure, PerformanceObserver | High Resolution Time + User Timing |
| `ext/web/02_structured_clone.js` | structuredClone() | Structured clone algorithm |
| `ext/web/13_message_port.js` | MessageChannel, MessagePort | Cross-context messaging |
| `ext/web/16_image_data.js` | ImageData | Pixel data for canvas |
| `ext/web/01_broadcast_channel.js` | BroadcastChannel | Cross-tab messaging |
| `ext/web/01_urlpattern.js` | URLPattern | URL pattern matching |
| `ext/fetch/20_headers.js` — `ext/fetch/26_fetch.js` | fetch(), Headers, Request, Response, FormData | Complete WHATWG Fetch |
| `ext/fetch/27_eventsource.js` | EventSource | Server-Sent Events |
| `ext/crypto/00_crypto.js` | SubtleCrypto, CryptoKey, getRandomValues(), randomUUID() | WebCrypto API (Rust-backed; reference for API surface) |
| `ext/websocket/01_websocket.js` | WebSocket | WHATWG WebSocket |
| `ext/webstorage/01_webstorage.js` | localStorage, sessionStorage (Storage) | Web Storage API |
| `ext/cache/01_cache.js` | Cache, CacheStorage | Service Worker Cache API |
| `ext/image/01_image.js` | ImageBitmap, createImageBitmap() | Async image decoding |

## Type Safety

- **Import Node.js types** from `node:*` modules, don't redefine: `import type { ReadableOptions } from 'node:stream'`
- Global types (`BufferEncoding`, `NodeJS.Platform`) from `@types/node` are auto-available
- Use `unknown` over `any`; keep `any` only where Node.js API requires it
- Use `as unknown as T` instead of `as any` for unrelated type casts
- Type error callbacks as `NodeJS.ErrnoException | null`
- Validate with `yarn check` (`tsc --noEmit`)

## Source Attribution

This project reimplements Node.js APIs using GNOME libraries, consulting reference implementations in `refs/` and external projects. Proper attribution is required for legal compliance and intellectual honesty.

### When Attribution Is Required

| Derivation Level | When It Applies | Required Format |
|-----------------|-----------------|-----------------|
| **Direct adaptation** | Code structure/logic closely follows a specific source file (control flow, algorithms, data tables) | Template A (SPDX + copyright) |
| **API-compatible reimplementation** | API surface matches Node.js but implementation is original using GNOME libs | Template B (Reference comment) |
| **Ported tests** | Test cases adapted from reference project test suites | Template C |
| **Algorithm from spec/RFC** | Implementation follows a published standard | Template D |

### Attribution Templates

**Template A — Direct adaptation** (code structure follows a source):

```typescript
// SPDX-License-Identifier: MIT
// Adapted from <project> (<refs/ path or URL>)
// Copyright (c) <year> <copyright holder>
// Modifications: <brief description, e.g. "Rewritten to use Gio.File instead of libuv">
```

**Template B — API-compatible reimplementation** (only the API matches):

```typescript
// Reference: Node.js lib/<name>.js
// Reimplemented for GJS using <GNOME library>
```

Multiple references:

```typescript
// Reference: Node.js lib/<name>.js, refs/deno/ext/node/polyfills/<name>.ts
// Reimplemented for GJS using <GNOME library>
```

**Template C — Ported tests** (in `*.spec.ts` files):

```typescript
// Ported from refs/<project>/test/parallel/test-<name>.js
// Original: MIT license, <copyright holder>
```

**Template D — Algorithm from spec** (crypto, protocol implementations):

```typescript
// Implements <algorithm> per <spec> (<RFC number or URL>)
// Reference: refs/<project>/path/to/file.js
// Copyright (c) <copyright holder>. <license>.
```

### Rules

1. **Every implementation file** (`src/*.ts`, excluding pure type re-exports and barrel `index.ts` that only re-export) must have a Template A or B comment at the top.
2. **Every test file** (`*.spec.ts`) that ports tests from reference projects must have a Template C comment.
3. **Do not fabricate attributions.** If the implementation is wholly original: `// <Module> for GJS — original implementation using <library>`.
4. **Preserve existing correct attributions** (copyright headers, "Credits" comments). Only add missing ones or upgrade vague ones.
5. **Use `refs/` paths** instead of external URLs where possible — they remain valid even if upstream URLs change.
6. When multiple sources were consulted, list all of them.

### Reference Project Copyright Lines

Use these canonical copyright lines when applying Template A or D:

| Source | Copyright Line |
|--------|---------------|
| `refs/node/` | `Copyright (c) Node.js contributors. MIT license.` |
| `refs/node-test/` | `Copyright (c) Node.js contributors. MIT license.` |
| `refs/deno/` | `Copyright (c) 2018-2026 the Deno authors. MIT license.` |
| `refs/bun/` | `Copyright (c) Oven (oven-sh). MIT license.` |
| `refs/quickjs/` | `Copyright (c) Fabrice Bellard, Charlie Gordon. MIT license.` |
| `refs/workerd/` | `Copyright (c) Cloudflare, Inc. Apache 2.0 license.` |
| `refs/edgejs/` | `Copyright (c) Wasmer, Inc. MIT license.` |
| `refs/crypto-browserify/` | `Copyright (c) crypto-browserify contributors. MIT license.` |
| `refs/browserify-cipher/` | `Copyright (c) crypto-browserify contributors. MIT license.` |
| `refs/browserify-sign/` | `Copyright (c) Calvin Metcalf. ISC license.` |
| `refs/create-ecdh/` | `Copyright (c) createECDH contributors. MIT license.` |
| `refs/create-hash/`, `refs/create-hmac/` | `Copyright (c) crypto-browserify contributors. MIT license.` |
| `refs/diffie-hellman/` | `Copyright (c) Calvin Metcalf. MIT license.` |
| `refs/hash-base/` | `Copyright (c) Kirill Fomichev. MIT license.` |
| `refs/pbkdf2/` | `Copyright (c) Daniel Cousens. MIT license.` |
| `refs/public-encrypt/` | `Copyright (c) Calvin Metcalf. MIT license.` |
| `refs/randombytes/`, `refs/randomfill/` | `Copyright (c) crypto-browserify contributors. MIT license.` |
| `refs/readable-stream/` | `Copyright (c) Node.js contributors. MIT license.` |
| `refs/undici/` | `Copyright (c) Matteo Collina and Undici contributors. MIT license.` |
| `refs/gjs/` | `Copyright (c) GNOME contributors. MIT/LGPLv2+ license.` |
| `refs/node-gst-webrtc/` | `Copyright (c) Ratchanan Srirattanamet. ISC license.` |
| `refs/llrt/` | `Copyright (c) Amazon.com, Inc. Apache 2.0 license.` |
| `refs/happy-dom/` | `Copyright (c) David Ortner (capricorn86). MIT license.` |
| `refs/jsdom/` | `Copyright (c) Elijah Insua. MIT license.` |
| `refs/wpt/` | `Copyright (c) web-platform-tests contributors. 3-Clause BSD license.` |
| node-fetch | `Copyright (c) node-fetch contributors. MIT license.` |
| event-target-shim | `Copyright (c) Toru Nagashima. MIT license.` |
| `refs/ungap-structured-clone/` | `Copyright (c) Andrea Giammarchi. ISC license.` |
| gjs-require | `Copyright (c) Andrea Giammarchi. ISC license.` |

## STATUS.md Maintenance

`STATUS.md` tracks overall project progress. **Update it when making significant changes:**

- After adding/expanding tests: update test counts in the package tables
- After fixing implementations: update the "Working" / "Missing" columns
- After completing a stub or partial package: move it to the correct category
- After a work session with multiple changes: add a Changelog entry with date and summary
- Keep the Metrics section (total test count, package counts) current
- **Upstream GJS patches:** When a workaround is implemented for a missing or broken GJS/SpiderMonkey feature (e.g. `structuredClone` not available as global, `TextDecoder` handling malformed UTF-8 differently, `queueMicrotask` not exposed), add it to the "Upstream GJS Patch Candidates" section in STATUS.md. These are features where an upstream GJS/SpiderMonkey patch would eliminate the need for our workaround and benefit the broader GJS ecosystem.

## Constraints

- Target: GJS 1.86.0 / SpiderMonkey 128 (ES2024) / esbuild `firefox128`
- ESM-only — no CJS support, all packages are exclusively ESM
- GNOME libs + standard JS only
- Tests must pass on both Node.js and GJS from same source
- Do not modify `refs/` — read-only submodules

## JS Feature Availability

### SpiderMonkey 128 (GJS 1.84–1.86, current target)

**Available (ES2024):** `Object.groupBy`, `Map.groupBy`, `Promise.withResolvers`, `Set` methods (intersection, union, difference, symmetricDifference, isSubsetOf, isSupersetOf, isDisjointFrom), `Array.fromAsync`, `structuredClone`, `SharedArrayBuffer`, `Intl.Segmenter`, `globalThis`, `??`, `?.`, `??=`, `||=`, `&&=`, top-level `await`, private/static class fields, `WeakRef`, `FinalizationRegistry`.

**NOT available in SpiderMonkey 128:**
- `Error.captureStackTrace` — polyfill: `packages/gjs/utils/src/error.ts`
- `Error.stackTraceLimit` — guard with typeof check
- `queueMicrotask` — not exposed as global in GJS 1.86; use `Promise.resolve().then()`
- `Float16Array`, `Math.f16round()`, `DataView.getFloat16()`/`setFloat16()`
- Iterator helpers (`Iterator.prototype.map/filter/take/drop/...`)
- `Uint8Array.fromBase64()`/`.toBase64()`/`.fromHex()`/`.toHex()`
- `RegExp.escape()`, regex modifiers `(?ims-ims:...)`
- `Promise.try()`
- `JSON.rawJSON()`, `JSON.isRawJSON()`, reviver context
- `Intl.DurationFormat`
- `Math.sumPrecise()`
- `Atomics.pause()`
- `Error.isError()`
- `Temporal` API
- `import ... with { type: "json" }` (JSON modules)

### SpiderMonkey 140 (GJS 1.85.2+/1.87+, upcoming)

All of the above become available, plus (from GJS 1.85.2 NEWS):
- `Float16Array`, `Math.f16round()`, `DataView.getFloat16/setFloat16`
- Iterator helpers: `Iterator.prototype.drop/every/filter/find/flatMap/forEach/map/reduce/some/take`
- `Uint8Array.fromBase64()`, `.fromHex()`, `.setFromBase64()`, `.setFromHex()`, `.toBase64()`, `.toHex()`
- Regex: `RegExp.escape()`, modifiers `(?ims-ims:...)`, duplicate named capturing groups
- `Promise.try()`
- `JSON.rawJSON()`, `JSON.isRawJSON()`, reviver context argument
- `Intl.DurationFormat`
- `Math.sumPrecise()`
- `Atomics.pause()`
- `Error.captureStackTrace()` (native! — polyfill no longer needed)
- `Error.isError()`
- `import ... with { type: "json" }` (JSON modules)
- `Temporal` API (`Temporal.Instant`, `Temporal.ZonedDateTime`, `Temporal.PlainDate`, `Temporal.Duration`, `Temporal.Now`, etc.)
