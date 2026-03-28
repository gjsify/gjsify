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
| canvas2d | Cairo, GdkPixbuf, PangoCairo | CanvasRenderingContext2D, CanvasGradient, CanvasPattern, Path2D, ImageData, Canvas2DWidget→Gtk.DrawingArea |
| webgl | gwebgl, Gtk 4.0, GObject | WebGL 1.0/2.0 via Vala (@gwebgl-0.1), CanvasWebGLWidget→Gtk.GLArea |
| event-bridge | Gtk 4.0, Gdk 4.0 | GTK→DOM event bridge: attachEventControllers() maps GTK controllers→MouseEvent/PointerEvent/KeyboardEvent/WheelEvent/FocusEvent |
| iframe | WebKit 6.0 | HTMLIFrameElement, IFrameWidget→WebKit.WebView, postMessage bridge |

### DOM Elements = GTK Widgets

Each visual DOM element pairs with a GTK Widget: `HTMLCanvasElement`(2d)→`Canvas2DWidget`→`Gtk.DrawingArea`(Cairo) | `HTMLCanvasElement`(webgl)→`CanvasWebGLWidget`→`Gtk.GLArea`(OpenGL ES/libepoxy) | `HTMLIFrameElement`→`IFrameWidget`→`WebKit.WebView`

Widget pattern: (1) widget creates DOM element internally (2) app code uses standard DOM API (3) widget translates GTK↔Web lifecycle (signals/draw_func/render ↔ rAF/events/ready)

Common widget API: `onReady(cb)` — DOM element+context ready | `installGlobals()` — register browser globals (rAF) | element getter (`canvas`, `iframeElement`)

DOM backing: `HTMLImageElement`→GdkPixbuf | `HTMLCanvasElement`(2d)→Cairo.ImageSurface+PangoCairo | `HTMLCanvasElement`(webgl)→Gtk.GLArea+libepoxy | `HTMLIFrameElement`→WebKit.WebView(postMessage). `dom-elements` auto-registers `globalThis.{Image,HTMLCanvasElement,document}` on import.

### GTK→DOM Event Bridge (`@gjsify/event-bridge`)

`attachEventControllers(widget, getElement)` attaches GTK4 controllers→dispatches DOM events:

| GTK Controller | DOM Events |
|---|---|
| EventControllerMotion | pointermove, mousemove, pointer/mouse enter/leave/over/out |
| GestureClick | pointer/mouse down/up, click, dblclick, contextmenu |
| EventControllerScroll | wheel |
| EventControllerKey | keydown, keyup |
| EventControllerFocus | focus, focusin, blur, focusout |

Dispatch order: W3C UIEvents spec. Coords: GTK widget-relative→DOM offsetX/Y/clientX/Y. Keys: `key-map.ts` converts ~80 Gdk keyvals→DOM key/code (L/R modifiers, Numpad location). Both Canvas2DWidget/CanvasWebGLWidget call `attachEventControllers(this, () => this._canvas)` in constructor.

UI Event classes in `@gjsify/dom-events`: UIEvent, MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent — Web-standard with init interfaces, `getModifierState()`, `Symbol.toStringTag`.

### Context Factory Registry

`HTMLCanvasElement.registerContextFactory` — modular context registration: `@gjsify/canvas2d` registers `'2d'`→CanvasRenderingContext2D(Cairo) | `@gjsify/webgl` registers `'webgl'`/`'webgl2'` via subclass override+fallthrough

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

GJS needs GLib MainLoop for async I/O. `ensureMainLoop()` (`@gjsify/utils`): idempotent, non-blocking, no-op on Node.js. Used in: `http.Server.listen()`, `net.Server.listen()`, `dgram.Socket.bind()`. Public: `import { ensureMainLoop } from '@gjsify/node-globals'`. GTK apps must NOT use it (use `Gtk.Application.runAsync()`).

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
| `refs/wpt/` | W3C canonical test suite |
| `refs/happy-dom/` | DOM(60+ types), 296 tests. Ref for dom-events, dom-elements |
| `refs/jsdom/` | 30+ modules, WPT integration |
| `refs/undici/` | 366 tests. fetch, WebSocket, Cache, EventSource |
| `refs/headless-gl/` | **Primary WebGL test ref.** 42 tests |
| `refs/webgl/` | Khronos spec + conformance tests. Authoritative |
| `refs/three/` | three.js. Ref for WebGL examples |
| `refs/libepoxy/` | OpenGL func ptrs. Used by Vala ext |
| `refs/node-gst-webrtc/` | WebRTC via GStreamer |

### Other

`refs/gjs/`(GJS internals) | `refs/stream-http/`(HTTP via streams) | `refs/troll/`(GJS utils) | `refs/crypto-browserify/`(crypto orchestrator→sub-pkgs: `refs/{browserify-cipher,browserify-sign,create-ecdh,create-hash,create-hmac,diffie-hellman,hash-base,pbkdf2,public-encrypt,randombytes,randomfill}`) | `refs/readable-stream/`(stream edge cases) | `refs/ungap-structured-clone/`(→`packages/gjs/utils/src/structured-clone.ts`)

## npm Packages — Prefer reimplementing in TS

npm pkgs cause GJS problems: legacy CJS patterns, missing globals at load, circular deps, `"browser"` field. Use as **references only** — read source, rewrite in TS with `@gjsify/*` imports.

## CJS-ESM Interop for GJS Builds

**Problem:** esbuild GJS build (`esm`+`neutral`) wraps ESM with `__toCommonJS`→namespace object instead of constructor. Breaks `util.inherits(Child, require('stream'))`.

**Fix 1: `__toCommonJS` patch (auto)** — `esbuild-plugin-gjsify/src/app/gjs.ts` `onEnd`. Unwraps ESM with only default export. No action needed.

**Fix 2: `cjs-compat.cjs` (manual)** — For `@gjsify/*` pkgs with BOTH named+default exports where `require()` must return constructor. Add when: (1) default=constructor/class (2) has named exports (3) default has named as properties (4) CJS consumers use as constructor/inherits/call.

Symptoms: `TypeError: super constructor to "inherits" must have prototype` | `X is not a function` | `X.call is not a function`

Needs wrapper: `stream`(✅), `events`(✅). Not needed: `buffer`, `util`, `http`, `path` (return plain objects).

```js
// packages/node/<name>/cjs-compat.cjs
const mod = require('./lib/esm/index.js');
module.exports = mod.default || mod;
```
Add `"require": "./cjs-compat.cjs"` to package.json exports BEFORE `"default"`. esbuild selects condition by consumer syntax.

## Native Extensions (Vala)

Vala→Meson→shared lib+GIR typelib→`gi://` import. Example: `packages/dom/webgl/`. Prefer TS; Vala only for C-level access.

### DOM Widget examples

```ts
// Canvas 2D
import { Canvas2DWidget } from '@gjsify/canvas2d';
const w = new Canvas2DWidget(); w.installGlobals();
w.onReady((canvas, ctx) => { ctx.fillRect(0, 0, 100, 100); }); window.set_child(w);

// WebGL
import { CanvasWebGLWidget } from '@gjsify/webgl';
const w = new CanvasWebGLWidget(); w.installGlobals();
w.onReady((canvas, gl) => { gl.clearColor(0, 0, 0, 1); }); window.set_child(w);

// IFrame
import { IFrameWidget } from '@gjsify/iframe';
const w = new IFrameWidget();
w.onReady((iframe) => { iframe.contentWindow?.addEventListener('message', handler); });
w.iframeElement.srcdoc = '<h1>Hello</h1>'; window.set_child(w);
```

### Prebuilds

Native libs ship in `prebuilds/linux-<arch>/` (`.so`+`.typelib`). `package.json`: `"files":["lib","prebuilds"]`, `"gjsify":{"prebuilds":"prebuilds"}`. CLI auto-sets `LD_LIBRARY_PATH`/`GI_TYPELIB_PATH`: `gjsify run dist/gjs.js` | `gjsify info [file]` (print env, `--export` for eval). Built by `.github/workflows/prebuilds.yml` (x86_64+aarch64, Fedora). Local: `yarn build:prebuilds`.

**gi:// ordering:** `GIRepository.prepend_search_path()` must run before `gi://Foo` resolves. Static `gi://` imports resolve in ESM Linking (before code). Use `gjsify run` or two-file loader (loader calls prepend_search_path, then `await import('./bundle.js')`).

## Testing

### Framework: `@gjsify/unit`

```typescript
import { describe, it, expect, on } from '@gjsify/unit';
export default async () => {
  await describe('module.function', async () => {
    await it('should do X', async () => { expect(result).toBe(expected); });
  });
  await on('Gjs', async () => { /* GJS-only */ });
};
```

Matchers: `toBe|toEqual|toBeTruthy|toBeFalsy|toBeNull|toBeDefined|toBeUndefined|toBeLessThan|toBeGreaterThan|toContain|toMatch|toThrow` + `.not`

### Rules

1. **Cross-platform pkgs:** `node:` prefix for all Node.js imports (value+type). **Never import `@gjsify/*` directly** (except `@gjsify/unit`). Aliased Web pkgs: bare specifier from `ALIASES_WEB_FOR_{GJS,NODE}`.
2. **GJS-only pkgs** (dom-elements, webgl): Import `@gjsify/*` directly. No aliases, no `test:node`.
3. Node.js tests=test correctness; GJS tests=our implementation. Both must pass.
4. Common `*.spec.ts`: both platforms, no `@girs/*`. Platform-specific `*.gjs.spec.ts`/`on('Gjs')`: minimal.
5. Layout: `src/index.ts`(impl) | `src/*.spec.ts`(specs) | `src/test.mts`(entry).
6. **Never weaken tests** — fix implementation, not tests. No platform guards.

### Regression Tests from Examples

When real-world examples uncover bugs (GC, missing globals, CJS-ESM, MainLoop) — always add targeted test to relevant `*.spec.ts`. Examples=integration validation; regression tests=permanent safety net.

### Test Sources

Rewrite using `@gjsify/unit`, bare specifiers. Never copy verbatim. Select: core behavior, GNOME-relevant edge cases, error conditions, cross-platform compat. Skip: V8 internals, native addons, stubbed features.

### Deno Web API Refs — `refs/deno/`

`ext/web/`{`06_streams`(R/W/TransformStream), `14_compression`(Compression/DecompressionStream), `02_event`(Event,EventTarget,CustomEvent,ErrorEvent,CloseEvent,MessageEvent), `03_abort_signal`(AbortController/Signal), `08_text_encoding`(TextEncoder/Decoder), `09_file,10_filereader`(Blob,File,FileReader), `15_performance`(Performance,Mark/Measure/Observer), `02_structured_clone,13_message_port,16_image_data,01_broadcast_channel,01_urlpattern`} | `ext/fetch/`{`20-26`(fetch,Headers,Request,Response,FormData), `27_eventsource`(SSE)} | `ext/crypto/00_crypto`(SubtleCrypto,CryptoKey,getRandomValues,randomUUID) | `ext/{websocket/01,webstorage/01,cache/01,image/01}`(WebSocket,Storage,Cache,ImageBitmap)

## Package Convention

`packages/node/<name>/`: `@gjsify/<name>`, v0.0.4, `"type":"module"` | exports `./lib/esm/index.js` | scripts: `build:gjsify|build:types|build:test:{gjs,node}|test|test:{gjs,node}` | deps: `@girs/*`, devDep: `@gjsify/unit` | workspace deps: `workspace:^`

Shared utils: `@gjsify/utils` (`packages/gjs/utils/`). Check before duplicating. Only extract when second package needs it.

## Implementation Workflow (TDD)

1. Study API: `refs/node/lib/<name>.js`
2. Port tests to `*.spec.ts` using `@gjsify/unit`
3. `yarn test:node` — verify tests correct
4. `yarn test:gjs` — expect failures → fix implementation
5. Implement with `@girs/*`, consult `refs/{deno,bun,quickjs,workerd}/`
6. Iterate until both pass
7. Full: `yarn install && yarn clear && yarn build && yarn check && yarn test`

## Type Safety

`unknown` over `any` | `as unknown as T` for unrelated casts | Error callbacks: `NodeJS.ErrnoException | null` | Validate: `yarn check`

## Source Attribution

Templates: **A**(direct adaptation): `SPDX-License-Identifier: MIT` + `Adapted from <project> (<refs/path>). Copyright (c) <year> <holder>` + `Modifications: <brief>` | **B**(API reimpl): `Reference: Node.js lib/<name>.js[, refs/deno/...]` + `Reimplemented for GJS using <lib>` | **C**(ported tests): `Ported from refs/<project>/test/...` + `Original: MIT, <holder>` | **D**(spec algorithm): `Implements <algo> per <spec> (<RFC>)` + `Reference: refs/<project>/path. Copyright (c) <holder>. <license>.`

Every impl→A or B. Every ported test→C. Original: `// <Module> for GJS — original implementation using <library>`. Use `refs/` paths over URLs.

### Copyright

`refs/{node,node-test}/`→Node.js contributors, MIT | `refs/deno/`→2018-2026 Deno authors, MIT | `refs/bun/`→Oven, MIT | `refs/quickjs/`→Bellard+Gordon, MIT | `refs/workerd/`→Cloudflare, Apache 2.0 | `refs/edgejs/`→Wasmer, MIT | `refs/{crypto-browserify,browserify-cipher,create-hash,create-hmac,randombytes,randomfill}/`→crypto-browserify contributors, MIT | `refs/{browserify-sign,diffie-hellman,public-encrypt}/`→Calvin Metcalf, ISC/MIT | `refs/create-ecdh/`→createECDH contributors, MIT | `refs/hash-base/`→Kirill Fomichev, MIT | `refs/pbkdf2/`→Daniel Cousens, MIT | `refs/readable-stream/`→Node.js contributors, MIT | `refs/undici/`→Matteo Collina+contributors, MIT | `refs/gjs/`→GNOME contributors, MIT/LGPLv2+ | `refs/headless-gl/`→Mikola Lysenko, BSD-2-Clause | `refs/webgl/`→Khronos Group, MIT | `refs/three/`→three.js authors, MIT | `refs/libepoxy/`→Intel, MIT | `refs/node-gst-webrtc/`→Ratchanan Srirattanamet, ISC | `refs/llrt/`→Amazon, Apache 2.0 | `refs/happy-dom/`→David Ortner, MIT | `refs/jsdom/`→Elijah Insua, MIT | `refs/wpt/`→web-platform-tests contributors, 3-Clause BSD | `refs/ungap-structured-clone/`→Andrea Giammarchi, ISC | node-fetch→MIT | event-target-shim→Toru Nagashima, MIT | gjs-require→Andrea Giammarchi, ISC

## STATUS.md Maintenance

Update when: adding/expanding tests (counts) | fixing impls (Working/Missing) | completing stubs (move category) | after work sessions (Changelog). Keep Metrics current. Add GJS/SpiderMonkey workarounds to "Upstream GJS Patch Candidates".

## Constraints

Target: GJS 1.86.0 / SpiderMonkey 128 (ES2024) / esbuild `firefox128` | ESM-only | GNOME libs + standard JS only | Tests pass on both Node.js and GJS | Do not modify `refs/`

## JS Feature Availability

### SM128 (GJS 1.84–1.86, current) — ES2024

**Available:** Object/Map.groupBy | Promise.withResolvers | Set methods(intersection,union,difference,symmetricDifference,isSubsetOf,isSupersetOf,isDisjointFrom) | Array.fromAsync | structuredClone | SharedArrayBuffer | Intl.Segmenter | globalThis | ??/?. | ??=/||=/&&= | top-level await | private/static fields | WeakRef | FinalizationRegistry

**NOT available:** Error.captureStackTrace (polyfill: `packages/gjs/utils/src/error.ts`) | Error.stackTraceLimit (typeof guard) | queueMicrotask (use `Promise.resolve().then()`) | Float16Array, Math.f16round() | Iterator helpers | Uint8Array.{fromBase64,toBase64,fromHex,toHex} | RegExp.escape() | Promise.try() | JSON.rawJSON/isRawJSON | Intl.DurationFormat | Math.sumPrecise | Atomics.pause | Error.isError | Temporal | `import...with{type:"json"}`

### SM140 (GJS 1.85.2+/1.87+, upcoming)

All SM128-missing features become available. Notable: Error.captureStackTrace native (drop polyfill) | Temporal API | Iterator helpers | import...with{type:"json"}

## Writing Agent Context Files

Pipe-delimited format | single-line directives | strip prose | abbreviated keys (req,opt,str,int,bool,len,min,max,def) | flatten with brace expansion | "Prefer retrieval-led reasoning" preamble

Compression: 70–80% token reduction | preserve actionable info+structural boundaries | keep non-obvious code examples | never compress error messages/edge case docs
