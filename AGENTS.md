# AGENTS.md — gjsify

Prefer retrieval-led reasoning over pre-training-led reasoning — consult `refs/` submodules and `@girs/*` types before pre-trained knowledge.

Node.js API for GJS (GNOME JS). Monorepo (Yarn workspaces, v0.0.4, ESM-only). All packages use native GNOME libs.

## Structure

`packages/{node/,gjs/,infra/,web/,dom/}` | `refs/` — read-only git submodules (DO NOT modify)

## Node.js Packages — `packages/node/*` → `@gjsify/<name>`

| Pkg | Libs | Status | Notes |
|-----|------|--------|-------|
| assert | — | Full | AssertionError, deepEqual, throws, strict |
| async_hooks | — | Full | AsyncLocalStorage, AsyncResource, createHook |
| buffer | — | Full | Buffer via Blob/File/atob/btoa |
| child_process | Gio | Full | exec/execSync, spawn/spawnSync via Gio.Subprocess |
| cluster | — | Stub | isPrimary, isWorker |
| console | — | Full | Console with stream support |
| crypto | GLib | Partial | Hash(GLib.Checksum), Hmac(GLib.Hmac), randomBytes/UUID |
| dgram | Gio | Full | UDP via Gio.Socket |
| diagnostics_channel | — | Full | Channel, TracingChannel |
| dns | Gio | Full | lookup, resolve4/6, reverse via Gio.Resolver + promises |
| domain | — | Stub | Deprecated |
| events | — | Full | EventEmitter, once, on, listenerCount |
| fs | Gio | Full | sync, callback, promises, streams, FSWatcher |
| globals | GLib | Full | process, Buffer, structuredClone, TextEncoder/Decoder, atob/btoa, URL, setImmediate |
| http | Soup 3.0 | Partial | Server(Soup.Server), IncomingMessage, ServerResponse |
| http2 | — | Stub | constants only |
| https | — | Partial | Agent, stub request/get |
| inspector | — | Stub | Session stub |
| module | Gio, GLib | Full | builtinModules, isBuiltin, createRequire |
| net | Gio | Full | Socket(Gio.SocketClient), Server(Gio.SocketService) |
| os | GLib | Full | homedir, hostname, cpus |
| path | — | Full | POSIX + Win32 |
| perf_hooks | — | Full | performance (Web API / GLib fallback) |
| process | GLib | Full | extends EventEmitter, env, cwd, platform |
| querystring | — | Full | parse/stringify |
| readline | — | Full | Interface, createInterface, question, prompt, async iterator |
| stream | — | Full | Readable, Writable, Duplex, Transform, PassThrough |
| string_decoder | — | Full | UTF-8, Base64, hex, streaming |
| timers | — | Full | setTimeout/setInterval/setImmediate + promises |
| tls | Gio | Partial | TLSSocket via Gio.TlsClientConnection |
| tty | — | Full | ReadStream/WriteStream, ANSI escapes |
| url | GLib | Full | URL, URLSearchParams via GLib.Uri |
| util | — | Full | inspect, format, promisify, types |
| v8 | — | Stub | getHeapStatistics, serialize/deserialize (JSON) |
| vm | — | Stub | runInThisContext (eval), Script |
| worker_threads | — | Stub | isMainThread only |
| zlib | — | Full | gzip/deflate via Web Compression API, Gio.ZlibCompressor fallback |

## Web Packages — `packages/web/*`

| Pkg | Libs | Implements |
|-----|------|------------|
| fetch | Soup 3.0, Gio | fetch(), Request, Response, Headers |
| dom-events | — | Event, CustomEvent, EventTarget, DOMException |
| abort-controller | — | AbortController, AbortSignal |
| formdata | — | FormData, File |
| globals | — | Re-exports dom-events + abort-controller |
| websocket | Soup 3.0 | WebSocket, MessageEvent, CloseEvent |

## DOM Packages — `packages/dom/*`

| Pkg | Libs | Implements |
|-----|------|------------|
| dom-elements | GdkPixbuf | Node, Element, HTMLElement, HTMLCanvasElement, HTMLImageElement, Image, Document, Text, Comment, DocumentFragment, DOMTokenList, MutationObserver, ResizeObserver, IntersectionObserver, Attr, NamedNodeMap, NodeList |
| canvas2d | Cairo, GdkPixbuf, PangoCairo | CanvasRenderingContext2D, CanvasGradient, CanvasPattern, Path2D, ImageData, Canvas2DWidget (Gtk.DrawingArea subclass) |
| webgl | gwebgl, Gtk 4.0, GObject | WebGL 1.0/2.0 via Vala (@gwebgl-0.1), CanvasWebGLWidget (Gtk.GLArea subclass) |
| event-bridge | Gtk 4.0, Gdk 4.0 | GTK→DOM event bridge: attachEventControllers() maps GTK event controllers to MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent |
| iframe | WebKit 6.0 | HTMLIFrameElement, IFrameWidget (WebKit.WebView subclass), postMessage bridge |

### Core concept: DOM Elements as GTK Widgets

gjsify bridges the gap between Web APIs and native GTK by implementing standard DOM elements backed by GNOME libraries. Each DOM element that requires a visual representation on screen is paired with a **GTK Widget** that handles the native rendering:

| DOM Element | GTK Widget | Native Backend | Package |
|-------------|-----------|----------------|---------|
| `HTMLCanvasElement` (2d context) | `Canvas2DWidget` → `Gtk.DrawingArea` | Cairo | `@gjsify/canvas2d` |
| `HTMLCanvasElement` (webgl context) | `CanvasWebGLWidget` → `Gtk.GLArea` | OpenGL ES / libepoxy | `@gjsify/webgl` |
| `HTMLIFrameElement` | `IFrameWidget` → `WebKit.WebView` | WebKit | `@gjsify/iframe` |

**The pattern is always the same:**
1. The widget creates the corresponding DOM element internally
2. Application code works against the standard DOM API (Canvas 2D, WebGL, postMessage)
3. The widget translates between GTK lifecycle (signals, draw_func, render) and Web lifecycle (requestAnimationFrame, events, ready)

**All widgets share a common API surface** (modeled after `IFrameWidget`):
- `onReady(cb)` — fires when the DOM element and context are available
- `installGlobals()` — registers browser globals (e.g. `requestAnimationFrame`)
- Element getter (`canvas`, `iframeElement`) — access to the backing DOM element

This enables **dual-target development**: the same application code (e.g. a Three.js scene, a Canvas 2D game, an iframe with postMessage) runs both in the browser and in a native GTK application without changes to the business logic. Examples under `examples/gtk/` demonstrate this with shared demo code and separate entry points for GJS and browser.

### Context Factory Registry

`HTMLCanvasElement` has a static context factory registry (`registerContextFactory`) that allows packages to register rendering context types independently:
- `@gjsify/canvas2d` registers `'2d'` → `CanvasRenderingContext2D` (Cairo-backed)
- `@gjsify/webgl` registers `'webgl'`/`'webgl2'` via subclass override + fallthrough to registry

This enables modular composition — packages don't need to know about each other. A canvas element can support any combination of contexts depending on which packages are imported.

### Why this approach

gjsify targets two use cases simultaneously:
1. **GJS native apps** — GNOME apps written in TypeScript that need Node.js/Web API parity
2. **Browser-engine portability** — Running browser-targeted libraries (e.g. game engines, UI frameworks) on GJS/GTK without modification

Browser libraries depend on DOM APIs that don't exist in GJS. Our implementations back these with native GNOME equivalents:
- `HTMLImageElement` → GdkPixbuf (loads images from disk; `getImageData()` returns pixel data)
- `HTMLCanvasElement` (2d) → Cairo.ImageSurface (full Canvas 2D API including text via PangoCairo)
- `HTMLCanvasElement` (webgl) → Gtk.GLArea (renders OpenGL ES via libepoxy)
- `HTMLIFrameElement` → WebKit.WebView (bidirectional postMessage via script message handlers)

`dom-elements` auto-registers `globalThis.Image`, `globalThis.HTMLCanvasElement`, `globalThis.document`, etc. on import (same pattern as `@gjsify/node-globals`).

### Planned

| Pkg | Libs | Ref | Priority |
|-----|------|-----|----------|
| web-streams | Gio | `refs/deno/ext/web/06_streams.js` | High |
| compression-streams | Gio | `refs/deno/ext/web/14_compression.js` | Med |
| webcrypto | GLib | `refs/deno/ext/crypto/00_crypto.js` | Med |
| eventsource | Soup 3.0 | `refs/deno/ext/fetch/27_eventsource.js` | Low |
| webstorage | Gio | `refs/deno/ext/webstorage/01_webstorage.js` | Low |

## Build

esbuild with platform-specific plugins. Same test source, different resolution per platform.

- **GJS** (`gjsify build --app gjs`): `assert`→`@gjsify/assert`. Externals: `gi://*`, `cairo`, `system`, `gettext`. Target: `firefox128`
- **Node** (`gjsify build --app node`): `@gjsify/process`→`process`. Target: `node24`

Key files: `packages/infra/esbuild-plugin-gjsify/src/app/{gjs,node}.ts` | `packages/infra/resolve-npm/lib/index.mjs`

### GLib MainLoop — `ensureMainLoop()`

GJS needs a running GLib MainLoop for async I/O (Soup.Server, Gio.SocketService, etc.). Node.js has an implicit event loop. `ensureMainLoop()` (`@gjsify/utils`) bridges this: idempotent, non-blocking, no-op on Node.js. Call it in any `@gjsify/*` server/listener implementation that relies on GLib async dispatch — currently: `http.Server.listen()`, `net.Server.listen()`, `dgram.Socket.bind()`. Public API via `import { ensureMainLoop } from '@gjsify/node-globals'`. GTK apps must NOT use it (they use `Gtk.Application.runAsync()`).

```bash
# Root
yarn build | yarn build:node | yarn build:web | yarn test | yarn check
# Per-package
yarn build:gjsify | yarn build:types
yarn build:test:{gjs,node} | yarn test:{gjs,node}
```

## GNOME Libs & Mappings — `node_modules/@girs/*`

`@girs/glib-2.0`(ByteArray,Checksum,DateTime,Regex,URI,env,MainLoop) | `@girs/gobject-2.0`(signals,properties) | `@girs/gio-2.0`(File,streams,Socket,TLS,DBus) | `@girs/giounix-2.0`(Unix FDs) | `@girs/soup-3.0`(HTTP,WebSocket,cookies) | `@girs/gjs`(runtime)

```
Node→GNOME: fs→Gio.File{,I/O}Stream | Buffer→GLib.Bytes/ByteArray/Uint8Array | net.Socket→Gio.Socket{Connection,Client} | http→Soup.{Session,Server} | crypto→GLib.{Checksum,Hmac} | process.env→GLib.{g,s}etenv() | url.URL→GLib.Uri
Web→GNOME: fetch→Soup.Session | WebSocket→Soup.WebsocketConnection | Streams→Gio.{In,Out}putStream | Compression→Gio.ZlibCompressor | SubtleCrypto→GLib.Checksum+Hmac | localStorage→Gio.File/GLib.KeyFile | ImageBitmap→GdkPixbuf.Pixbuf | EventSource→Soup.Session(SSE)
```

## References — `refs/`

### Node.js

| Path | Use |
|------|-----|
| `refs/node/` | Canonical spec. `lib/<name>.js`, `test/parallel/test-<name>*.js` |
| `refs/node-test/` | **Primary test source.** 3897 tests, 43 modules. `parallel/`, `module-categories/` |
| `refs/deno/` | TS ref. Polyfills: `ext/node/polyfills/`. **Also primary Web API ref** |
| `refs/bun/` | Clean TS tests: `test/js/node/` |
| `refs/quickjs/` | Language feature tests: `tests/` |
| `refs/workerd/` | 67 modules. Tests: `src/workerd/api/node/tests/` |
| `refs/edgejs/` | Test harness patterns (uses node-test) |
| `refs/llrt/` | TS tests: `tests/unit/*.test.ts` (assert,buffer,crypto,events,fs,net,path,stream) |

### Web API

| Path | Use |
|------|-----|
| `refs/deno/` | **Primary.** `ext/{web,fetch,crypto,websocket,webstorage,cache,image}/` |
| `refs/wpt/` | W3C canonical test suite for web standards |
| `refs/happy-dom/` | DOM(60+ types), 296 test files. Ref for dom-events, dom-elements |
| `refs/jsdom/` | 30+ modules, WPT integration: `test/web-platform-tests/` |
| `refs/undici/` | 366 test files. fetch, WebSocket, Cache, EventSource. Ref for @gjsify/{fetch,http} |
| `refs/headless-gl/` | **Primary WebGL test ref.** 42 test files. Reference implementation for webgl |
| `refs/webgl/` | Khronos WebGL spec + conformance test suite. Authoritative for spec questions |
| `refs/three/` | three.js source. Ref for WebGL demo/examples (`examples/gtk/three-geometry-cube/`) |
| `refs/libepoxy/` | OpenGL function pointer library. Used by Vala native extension (`packages/dom/webgl/`) |
| `refs/node-gst-webrtc/` | WebRTC via GStreamer |

### Other

| Path | Use |
|------|-----|
| `refs/gjs/` | GJS internals: `modules/`(JS), `gjs/`(C++), `gi/`(GObject Introspection) |
| `refs/stream-http/` | HTTP via streams → ref for @gjsify/http |
| `refs/troll/` | GJS utility patterns |
| `refs/crypto-browserify/` | Crypto orchestrator → sub-pkgs: `refs/{browserify-cipher,browserify-sign,create-ecdh,create-hash,create-hmac,diffie-hellman,hash-base,pbkdf2,public-encrypt,randombytes,randomfill}` |
| `refs/readable-stream/` | Stream polyfill edge cases |
| `refs/ungap-structured-clone/` | structuredClone ref → `packages/gjs/utils/src/structured-clone.ts` |

## npm Packages — Prefer reimplementing in TS

npm pkgs cause GJS problems: legacy patterns (`Transform.call(this)`), missing globals at load time, circular deps via bundler aliases, `"browser"` field issues. Use as **references only** — read source, rewrite in TS using `@gjsify/*` imports directly.

## CJS-ESM Interop for GJS Builds

### Problem

esbuild's GJS build (`format: 'esm'`, `platform: 'neutral'`) bundles CJS npm packages alongside ESM `@gjsify/*` packages. When CJS code does `require('stream')`, esbuild wraps the ESM module with `__toCommonJS`, returning a namespace object `{ __esModule, default, Stream, Readable, ... }` instead of the expected constructor/function. This breaks CJS patterns like `util.inherits(Child, require('stream'))` and `var fn = require('is-promise'); fn(value)`.

### Two complementary mechanisms

**1. `__toCommonJS` patch (automatic)** — `packages/infra/esbuild-plugin-gjsify/src/app/gjs.ts` `onEnd` callback. Automatically unwraps ESM modules that have **only** a default export (no named exports). Handles npm ESM packages like `is-promise`, `depd`, etc. No action needed.

**2. `cjs-compat.cjs` wrappers (manual)** — Required for `@gjsify/*` packages that have **both** named exports AND a default export. The patch can't unwrap these because CJS consumers also need the named exports (e.g., `require('stream').Readable`).

### When to add a `cjs-compat.cjs`

Add one when a `@gjsify/*` package meets ALL of:
1. Has a default export that is a constructor/class (used by CJS as `var X = require('...')` directly)
2. Has named exports alongside the default export
3. The default export has all named exports as properties (via `Object.assign` or class statics)
4. CJS npm packages `require()` it and use the result as a constructor, with `inherits()`, or call it as a function

**Symptoms:** `TypeError: The super constructor to "inherits" must have a prototype` | `TypeError: X is not a function` | `TypeError: X.call is not a function`

**Candidates:** Packages where Node.js CJS `require()` returns a constructor directly:

| Package | `require()` returns | Has cjs-compat |
|---------|-------------------|----------------|
| `stream` | `Stream` class (with `.Readable`, `.Writable`, etc.) | ✅ |
| `events` | `EventEmitter` class | ✅ |
| `buffer` | `{ Buffer, ... }` object — not a constructor | ❌ not needed |
| `util` | `{ format, inherits, ... }` object | ❌ not needed |
| `http` | `{ createServer, ... }` object | ❌ not needed |
| `path` | `{ join, resolve, ... }` object | ❌ not needed |

Only packages where `require()` returns a function/class directly need wrappers. Packages returning plain objects work fine because CJS consumers destructure properties, which match named exports.

### How to add a wrapper

1. Create `packages/node/<name>/cjs-compat.cjs`:
```js
// CJS compatibility wrapper for npm packages that require('<name>')
// In Node.js CJS, require('<name>') returns the <Class> directly.
// When esbuild bundles ESM @gjsify/<name> for CJS consumers, it returns a
// namespace object instead. This wrapper extracts the default export.
const mod = require('./lib/esm/index.js');
module.exports = mod.default || mod;
```

2. Add `require` condition to `package.json` exports (BEFORE `default`):
```json
"exports": {
    ".": {
        "types": "./lib/types/index.d.ts",
        "require": "./cjs-compat.cjs",
        "default": "./lib/esm/index.js"
    }
}
```

esbuild auto-selects `require` vs `import` condition based on the consumer's syntax (`require()` → CJS entry, `import` → ESM entry). The alias plugin passes through `args.kind` to `build.resolve()`.

## Native Extensions (Vala)

Vala→Meson→shared lib+GIR typelib→`gi://` import. Example: `packages/dom/webgl/`. Prefer TS; Vala only for C-level access.

### DOM Widget examples

All DOM widgets follow the same pattern — `onReady()`, `installGlobals()`, element getter:

```ts
// Canvas 2D (Cairo-backed)
import { Canvas2DWidget } from '@gjsify/canvas2d';
const widget = new Canvas2DWidget();
widget.installGlobals();
widget.onReady((canvas, ctx) => { ctx.fillRect(0, 0, 100, 100); });
window.set_child(widget);

// WebGL (OpenGL ES-backed)
import { CanvasWebGLWidget } from '@gjsify/webgl';
const widget = new CanvasWebGLWidget();
widget.installGlobals();
widget.onReady((canvas, gl) => { gl.clearColor(0, 0, 0, 1); });
window.set_child(widget);

// IFrame (WebKit-backed)
import { IFrameWidget } from '@gjsify/iframe';
const widget = new IFrameWidget();
widget.onReady((iframe) => { iframe.contentWindow?.addEventListener('message', handler); });
widget.iframeElement.srcdoc = '<h1>Hello</h1>';
window.set_child(widget);
```

### Prebuild distribution convention

Packages with native libs ship prebuilt binaries in `prebuilds/linux-<arch>/` (`.so` + `.typelib`). Declare in `package.json`:
```json
"files": ["lib", "prebuilds"],
"gjsify": { "prebuilds": "prebuilds" }
```
The `gjsify` CLI detects this field and auto-sets `LD_LIBRARY_PATH` / `GI_TYPELIB_PATH`:
- `gjsify run dist/gjs.js` — spawn gjs with correct env vars
- `gjsify info [file]` — print required env vars for direct `gjs` use; `--export` for eval

Prebuilds are built by `.github/workflows/prebuilds.yml` (matrix: x86_64 + aarch64, Fedora containers) and committed to the repo. Local rebuild: `yarn build:prebuilds` in the package.

**gi:// import ordering constraint:** `GIRepository.prepend_search_path()` must be called before `gi://Foo` is resolved. Static `gi://` imports are resolved in the ESM Linking phase (before any code runs) — an inject shim cannot set paths in time. Use `gjsify run` (sets env vars before spawning gjs) or a two-file loader pattern (tiny loader that calls prepend_search_path, then `await import('./bundle.js')`).

## Testing

### Framework: `@gjsify/unit`

```typescript
import { describe, it, expect, on } from '@gjsify/unit';
export default async () => {
  await describe('module.function', async () => {
    await it('should do X', async () => { expect(result).toBe(expected); });
  });
  await on('Gjs', async () => { /* GJS-only */ });
  await on('Node.js', async () => { /* Node-only */ });
};
```

Matchers: `toBe|toEqual|toBeTruthy|toBeFalsy|toBeNull|toBeDefined|toBeUndefined|toBeLessThan|toBeGreaterThan|toContain|toMatch|toThrow` + `.not`

### Rules

1. **Cross-platform pkgs:** Use `node:` prefix for all Node.js imports — value + type (`from 'node:stream'`, `import type { Readable } from 'node:stream'`). Bundler resolves per platform. Aliased Web pkgs: use bare specifier from `ALIASES_WEB_FOR_{GJS,NODE}` (`packages/infra/resolve-npm/lib/index.mjs`); add alias if missing. **Never import `@gjsify/*` directly** in cross-platform tests (except `@gjsify/unit`).
2. **GJS-only pkgs** (dom-elements, webgl): Import `@gjsify/*` directly. No aliases, no `test:node`.
3. Node.js tests validate **test correctness**; GJS tests validate **our implementation**. Both must pass.
4. Common (`*.spec.ts`): both platforms, no `@girs/*`. Platform-specific (`*.gjs.spec.ts` / `on('Gjs')`): minimal, only for platform-specific behavior.
5. Layout: `src/index.ts`(impl) | `src/*.spec.ts`(specs) | `src/test.mts`(entry).
6. **Never weaken tests** — fix implementation, not tests. No platform guards to skip on GJS.

## Package Convention

`packages/node/<name>/`: `@gjsify/<name>`, v0.0.4, `"type":"module"` | exports `./lib/esm/index.js` (ESM-only) | scripts: `build:gjsify|build:types|build:test:{gjs,node}|test|test:{gjs,node}` | deps: `@girs/*`, devDep: `@gjsify/unit` | workspace deps: always `workspace:^`

Shared cross-package utilities live in `@gjsify/utils` (`packages/gjs/utils/`). Check there before duplicating helpers. Don't extract prematurely — only move code to utils when a second package actually needs it.

## Implementation Workflow (TDD)

1. Study API: `refs/node/lib/<name>.js`
2. Port tests to `*.spec.ts` using `@gjsify/unit`
3. `yarn test:node` — verify tests correct
4. `yarn test:gjs` — expect failures → fix implementation
5. Implement with `@girs/*`, consult `refs/{deno,bun,quickjs,workerd}/`
6. Iterate until both pass
7. Full validation: `yarn install && yarn clear && yarn build && yarn check && yarn test`

### Regression Tests from Examples

When real-world examples (Express, Koa, Hono, etc.) uncover bugs — GC issues, missing globals, CJS-ESM interop problems, MainLoop edge cases — always add a targeted test to the relevant `packages/node/*/src/*.spec.ts`, `packages/web/*/src/*.spec.ts`, or `packages/dom/*/src/*.spec.ts` file. This ensures the bug is automatically caught in future test runs. Examples are integration validation; regression tests are the permanent safety net.

### Test Sources

Rewrite using `@gjsify/unit`, bare specifiers. Never copy verbatim. See References tables for paths and priorities.

Select: core behavior, GNOME-relevant edge cases, error conditions, cross-platform compat. Skip: V8 internals, native addons, intentionally-stubbed features.

### Deno Web API Impl Refs

| Path prefix: `refs/deno/` | APIs |
|---|---|
| `ext/web/06_streams.js` | ReadableStream, WritableStream, TransformStream |
| `ext/web/14_compression.js` | CompressionStream, DecompressionStream |
| `ext/web/02_event.js` | Event, EventTarget, CustomEvent, ErrorEvent, CloseEvent, MessageEvent |
| `ext/web/03_abort_signal.js` | AbortController, AbortSignal |
| `ext/web/08_text_encoding.js` | TextEncoder, TextDecoder + Stream variants |
| `ext/web/{09_file,10_filereader}.js` | Blob, File, FileReader |
| `ext/web/15_performance.js` | Performance, PerformanceMark/Measure/Observer |
| `ext/web/{02_structured_clone,13_message_port,16_image_data,01_broadcast_channel,01_urlpattern}.js` | structuredClone, MessageChannel, ImageData, BroadcastChannel, URLPattern |
| `ext/fetch/20_headers.js`–`26_fetch.js` | fetch(), Headers, Request, Response, FormData |
| `ext/fetch/27_eventsource.js` | EventSource (SSE) |
| `ext/crypto/00_crypto.js` | SubtleCrypto, CryptoKey, getRandomValues(), randomUUID() |
| `ext/{websocket/01_websocket,webstorage/01_webstorage,cache/01_cache,image/01_image}.js` | WebSocket, Storage, Cache, ImageBitmap |

## Type Safety

- `unknown` over `any`; `as unknown as T` for unrelated casts
- Error callbacks: `NodeJS.ErrnoException | null`
- Validate: `yarn check` (`tsc --noEmit`)

## Source Attribution

### Templates

```typescript
// A (direct adaptation):
// SPDX-License-Identifier: MIT
// Adapted from <project> (<refs/ path>). Copyright (c) <year> <holder>
// Modifications: <brief>

// B (API reimplementation):
// Reference: Node.js lib/<name>.js[, refs/deno/ext/node/polyfills/<name>.ts]
// Reimplemented for GJS using <GNOME library>

// C (ported tests):
// Ported from refs/<project>/test/parallel/test-<name>.js
// Original: MIT license, <copyright holder>

// D (algorithm from spec):
// Implements <algorithm> per <spec> (<RFC>)
// Reference: refs/<project>/path/to/file.js. Copyright (c) <holder>. <license>.
```

Every impl file req Template A or B. Every ported test req Template C. Wholly original: `// <Module> for GJS — original implementation using <library>`. Use `refs/` paths over URLs. Preserve existing correct attributions. Do not fabricate.

### Copyright Lines

| Source | Copyright |
|--------|-----------|
| `refs/{node,node-test}/` | Node.js contributors. MIT |
| `refs/deno/` | 2018-2026 Deno authors. MIT |
| `refs/bun/` | Oven (oven-sh). MIT |
| `refs/quickjs/` | Fabrice Bellard, Charlie Gordon. MIT |
| `refs/workerd/` | Cloudflare, Inc. Apache 2.0 |
| `refs/edgejs/` | Wasmer, Inc. MIT |
| `refs/{crypto-browserify,browserify-cipher,create-hash,create-hmac,randombytes,randomfill}/` | crypto-browserify contributors. MIT |
| `refs/{browserify-sign,diffie-hellman,public-encrypt}/` | Calvin Metcalf. ISC/MIT |
| `refs/create-ecdh/` | createECDH contributors. MIT |
| `refs/hash-base/` | Kirill Fomichev. MIT |
| `refs/pbkdf2/` | Daniel Cousens. MIT |
| `refs/readable-stream/` | Node.js contributors. MIT |
| `refs/undici/` | Matteo Collina and Undici contributors. MIT |
| `refs/gjs/` | GNOME contributors. MIT/LGPLv2+ |
| `refs/headless-gl/` | Mikola Lysenko. BSD-2-Clause |
| `refs/webgl/` | Khronos Group Inc. MIT |
| `refs/three/` | three.js authors. MIT |
| `refs/libepoxy/` | Intel Corporation. MIT |
| `refs/node-gst-webrtc/` | Ratchanan Srirattanamet. ISC |
| `refs/llrt/` | Amazon.com, Inc. Apache 2.0 |
| `refs/happy-dom/` | David Ortner (capricorn86). MIT |
| `refs/jsdom/` | Elijah Insua. MIT |
| `refs/wpt/` | web-platform-tests contributors. 3-Clause BSD |
| `refs/ungap-structured-clone/` | Andrea Giammarchi. ISC |
| node-fetch | node-fetch contributors. MIT |
| event-target-shim | Toru Nagashima. MIT |
| gjs-require | Andrea Giammarchi. ISC |

## STATUS.md Maintenance

Update when: adding/expanding tests (counts) | fixing impls (Working/Missing) | completing stubs (move category) | after work sessions (Changelog). Keep Metrics current. Add GJS/SpiderMonkey workarounds to "Upstream GJS Patch Candidates".

## Constraints

Target: GJS 1.86.0 / SpiderMonkey 128 (ES2024) / esbuild `firefox128` | ESM-only | GNOME libs + standard JS only | Tests pass on both Node.js and GJS | Do not modify `refs/`

## JS Feature Availability

### SM128 (GJS 1.84–1.86, current) — ES2024

**Available:** Object/Map.groupBy | Promise.withResolvers | Set methods(intersection,union,difference,symmetricDifference,isSubsetOf,isSupersetOf,isDisjointFrom) | Array.fromAsync | structuredClone | SharedArrayBuffer | Intl.Segmenter | globalThis | ?? | ?. | ??=/||=/&&= | top-level await | private/static fields | WeakRef | FinalizationRegistry

**NOT available:** Error.captureStackTrace (polyfill: `packages/gjs/utils/src/error.ts`) | Error.stackTraceLimit (typeof guard) | queueMicrotask (use `Promise.resolve().then()`) | Float16Array, Math.f16round() | Iterator helpers | Uint8Array.{fromBase64,toBase64,fromHex,toHex} | RegExp.escape() | Promise.try() | JSON.rawJSON/isRawJSON | Intl.DurationFormat | Math.sumPrecise | Atomics.pause | Error.isError | Temporal | `import...with{type:"json"}`

### SM140 (GJS 1.85.2+/1.87+, upcoming)

All SM128-missing features become available. Notable: Error.captureStackTrace native (drop polyfill) | Temporal API | Iterator helpers | import...with{type:"json"}

## Writing Agent Context Files

1. Pipe-delimited format for indexes and structured refs
2. Single-line directives, not multi-paragraph explanations
3. Strip prose — only actionable content
4. Abbreviated keys (req, opt, str, int, bool, len, min, max, def)
5. Flatten hierarchies with brace expansion and path prefixes
6. "Prefer retrieval-led reasoning" preamble when referencing external docs

Compression: target 70–80% token reduction | preserve actionable info + structural boundaries | keep non-obvious code examples | never compress error messages/edge case docs. Before adding: "Can this be expressed in fewer tokens?"
