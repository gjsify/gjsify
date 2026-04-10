# AGENTS.md — gjsify

Prefer retrieval-led reasoning over pre-training-led reasoning — consult `refs/` submodules and `@girs/*` types before pre-trained knowledge.

Node.js API, Web API, and DOM API for GJS (GNOME JS). Monorepo (Yarn workspaces, v0.0.4, ESM-only). All packages use native GNOME libs. Three equal-priority pillars: **Node.js API** (`packages/node/`) | **Web API** (`packages/web/`) | **DOM API** (`packages/dom/`).

Browser compatibility patches (globals, DOM stubs) belong in packages, not examples. If an example needs a `globalThis.*` polyfill or DOM method stub, add it to `@gjsify/dom-elements` or the appropriate package.

**Architectural decisions must be documented here.** Whenever a new architectural decision is made (new package boundaries, API design patterns, widget conventions, build pipeline changes, dependency strategies, or cross-cutting concerns), update this file immediately so future conversations have the full picture.

## Structure

`packages/{node/,gjs/,infra/,web/,dom/}` | `showcases/` — curated examples shipped with CLI | `examples/` — private dev/test examples | `refs/` — read-only git submodules (DO NOT modify)

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
| dom-events | — | Event, CustomEvent, EventTarget, UIEvent, MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent, DOMException |
| dom-exception | — | DOMException (WebIDL standard) |
| abort-controller | — | AbortController, AbortSignal |
| formdata | — | FormData, File |
| streams | — | ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream |
| compression-streams | Gio | CompressionStream, DecompressionStream |
| webcrypto | GLib | crypto.subtle, getRandomValues, randomUUID |
| eventsource | Soup 3.0 | EventSource (Server-Sent Events) |
| websocket | Soup 3.0 | WebSocket, MessageEvent, CloseEvent |
| webstorage | Gio | localStorage, sessionStorage |
| webaudio | Gst 1.0, GstApp 1.0 | AudioContext(decodeAudioData via GStreamer decodebin), AudioBufferSourceNode(appsrc→volume→autoaudiosink), GainNode(AudioParam+setTargetAtTime), AudioBuffer(PCM Float32), HTMLAudioElement(canPlayType+playbin). Phase 1 |
| gamepad | Manette 0.2 | Gamepad(navigator.getGamepads polling via libmanette signals), GamepadButton(pressed/touched/value), GamepadEvent(gamepadconnected/gamepaddisconnected), GamepadHapticActuator(dual-rumble). Lazy Manette.Monitor init, graceful degradation without libmanette |
| web-globals | — | Re-exports all web API globals (dom-events, abort-controller, streams, webcrypto, etc.) |
| adwaita-web | — | Browser Adwaita components: AdwWindow, AdwHeaderBar, AdwPreferencesGroup, AdwCard, AdwSwitchRow, AdwComboRow, AdwSpinRow, AdwToastOverlay, AdwOverlaySplitView. Custom Elements + SCSS source partials in `scss/` (mirrors `refs/adwaita-web/scss/`). Built to `dist/adwaita-web.css` via the `sass` package. Light/dark theme. Consumers: `import '@gjsify/adwaita-web'` (custom elements) + `import '@gjsify/adwaita-web/style.css'` (or `@use '@gjsify/adwaita-web/scss/...'`). No GJS deps. **Long-term goal:** complete the framework — port additional components from `refs/adwaita-web/scss/` (button, entry, dialog, popover, banner, tabs, …); see STATUS.md roadmap |

## DOM Packages — `packages/dom/*`

| Pkg | Libs | Implements |
|-----|------|------------|
| dom-elements | GdkPixbuf | Node(ownerDocument→document, event bubbling via parentNode), Element(setPointerCapture, releasePointerCapture, hasPointerCapture), HTMLElement(getBoundingClientRect), HTMLCanvasElement, HTMLImageElement, Image, Document(body→documentElement tree), Text, Comment, DocumentFragment, DOMTokenList, MutationObserver, ResizeObserver, IntersectionObserver, Attr, NamedNodeMap, NodeList. Auto-registers `globalThis.{Image,HTMLCanvasElement,document,self,devicePixelRatio,alert}` on import |
| canvas2d | Cairo, GdkPixbuf, PangoCairo | CanvasRenderingContext2D, CanvasGradient, CanvasPattern, Path2D, ImageData, Canvas2DWidget→Gtk.DrawingArea |
| webgl | gwebgl, Gtk 4.0, GObject | WebGL 1.0/2.0 via Vala (@gwebgl-0.1), CanvasWebGLWidget→Gtk.GLArea |
| event-bridge | Gtk 4.0, Gdk 4.0 | GTK→DOM event bridge: attachEventControllers() maps GTK controllers→MouseEvent/PointerEvent/KeyboardEvent/WheelEvent/FocusEvent |
| iframe | WebKit 6.0 | HTMLIFrameElement, IFrameWidget→WebKit.WebView, postMessage bridge |

### DOM Elements = GTK Widgets

Each visual DOM element pairs with a GTK Widget: `HTMLCanvasElement`(2d)→`Canvas2DWidget`→`Gtk.DrawingArea`(Cairo) | `HTMLCanvasElement`(webgl)→`CanvasWebGLWidget`→`Gtk.GLArea`(OpenGL ES/libepoxy) | `HTMLIFrameElement`→`IFrameWidget`→`WebKit.WebView`

Widget pattern: (1) widget creates DOM element internally (2) app code uses standard DOM API (3) widget translates GTK↔Web lifecycle (signals/draw_func/render ↔ rAF/events/ready)

Common widget API: `onReady(cb)` — DOM element+context ready | `installGlobals()` — register browser globals (rAF) | element getter (`canvas`, `iframeElement`)

DOM backing: `HTMLImageElement`→GdkPixbuf | `HTMLCanvasElement`(2d)→Cairo.ImageSurface+PangoCairo | `HTMLCanvasElement`(webgl)→Gtk.GLArea+libepoxy | `HTMLIFrameElement`→WebKit.WebView(postMessage).

`CanvasWebGLWidget` on resize: dispatches DOM `resize` event on canvas + re-invokes last rAF callback. Demand-driven apps re-render automatically without animation loop. `WebGL2RenderingContext` overrides `texImage2D`, `texSubImage2D`, `drawElements` from WebGL1 base — bypasses WebGL1-only format/type validation. Native Vala layer handles all OpenGL ES 3.2 formats.

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

## Build

esbuild with platform-specific plugins. Same test source, different resolution per platform.

- **GJS** (`gjsify build --app gjs`): `assert`→`@gjsify/assert`. Externals: `gi://*`, `cairo`, `system`, `gettext`. Target: `firefox128`
- **Node** (`gjsify build --app node`): `@gjsify/process`→`process`. Target: `node24`

- **Browser** (`gjsify build --app browser`): Standard browser target. Target: `esnext`

Key files: `packages/infra/esbuild-plugin-gjsify/src/app/{gjs,node,browser}.ts` | `packages/infra/esbuild-plugin-gjsify/src/utils/scan-globals.ts` | `packages/infra/resolve-npm/lib/{index,globals-map}.mjs`

**Blueprint support:** `@gjsify/esbuild-plugin-blueprint` compiles `.blp` files via `blueprint-compiler` → XML string. Wired into `gjsify build` for GJS and browser targets. `import Template from './window.blp'` → string. Type declaration: `@gjsify/esbuild-plugin-blueprint/types` (add to tsconfig `"types"`).

**Globals via `--globals`:** `gjsify build --app gjs` supports three globals modes:

- `--globals auto` **(default)**: Two-pass build. First pass bundles in-memory with minification (no globals injection). `acorn` parses the bundled output and detects free identifiers that match `GJS_GLOBALS_MAP`. Second pass injects only the discovered globals. This avoids false positives from source-level scanning because it analyses the **bundled output** after esbuild tree-shaking has removed dead code paths.
- `--globals fetch,Buffer,...`: Explicit comma-separated list (or group aliases: `node`, `web`, `dom`). The CLI resolves each identifier against `globals-map.mjs`, writes a stub, and injects it.
- `--globals none`: Disables globals injection entirely.

Key files: `packages/infra/esbuild-plugin-gjsify/src/utils/detect-free-globals.ts` (acorn AST analysis) | `packages/infra/esbuild-plugin-gjsify/src/utils/auto-globals.ts` (two-pass orchestrator) | `packages/infra/esbuild-plugin-gjsify/src/utils/scan-globals.ts` (explicit-list resolver) | `packages/infra/resolve-npm/lib/globals-map.mjs` (identifier→register-path map).

### GLib MainLoop — `ensureMainLoop()`

GJS needs GLib MainLoop for async I/O. `ensureMainLoop()` (`@gjsify/utils`): idempotent, non-blocking, no-op on Node.js. Used in: `http.Server.listen()`, `net.Server.listen()`, `dgram.Socket.bind()`. Public: `import { ensureMainLoop } from '@gjsify/node-globals'` (re-exported from the `@gjsify/utils` root). GTK apps must NOT use it (use `Gtk.Application.runAsync()`).

### Tree-shakeable Globals — `/register` subpath convention

Every `@gjsify/*` package that registers anything on `globalThis` MUST follow these rules so that user bundles stay tree-shakeable and the `--globals` CLI flag can resolve identifiers correctly.

1. **No side-effects in `src/index.ts`.** The root entry is named exports only. Any `globalThis.X = ...`, `Object.defineProperty(globalThis, ...)`, or `registerGlobal('X', ...)` call at module top level is a bug — move it to `src/register.ts`.
2. **Side-effects live in `src/register.ts`.** This file exists solely to register globals. Imports what it needs from `./index.js` and uses an existence guard. Use the pattern that matches the global type:
   - **Function/class globals** (most packages): `if (typeof globalThis.X === 'undefined') { (globalThis as any).X = X; }`
   - **Plain-value globals** (process, Buffer, global in node-globals): `if (!('X' in globalThis)) { Object.defineProperty(globalThis, 'X', { value: X, writable: true, configurable: true }); }`
   - **DOM constructors** (dom-elements, GTK-only): unconditional `defineGlobal('X', X)` via the package-local helper (writable+configurable; GTK environment always owns these)
   - **Streams**: `isNativeStreamUsable(globalThis.X, 'method')` helper validates whether the existing native implementation is functional before replacing it
   All guards must be idempotent — registering twice must not throw.
3. **`package.json` declares both subpaths + `sideEffects`:**
   ```jsonc
   "exports": {
     ".":          { "default": "./lib/esm/index.js" },
     "./register": { "default": "./lib/esm/register.js" }
     // "./globals": "./globals.mjs"  // optional: native-re-exports for Node builds
   },
   "sideEffects": ["./lib/esm/register.js", "./globals.mjs"]
   ```
   The `sideEffects` array pins side-effects to register-only so bundlers can tree-shake the root module. Never `"sideEffects": false` if there is a `register.js`.
4. **Globals map is authoritative.** Every identifier that `register.ts` writes to `globalThis` MUST have an entry in `packages/infra/resolve-npm/lib/globals-map.mjs` mapping it to the bare-specifier `/register` subpath. The `--globals` CLI flag uses this map to resolve user-provided identifiers to register subpaths.
5. **Alias layer mirrors the map.** Add new `/register` subpaths to `packages/infra/resolve-npm/lib/index.mjs`:
   - `ALIASES_WEB_FOR_GJS` — bare-specifier `<pkg>/register` → real `@gjsify/<pkg>/register`
   - `ALIASES_WEB_FOR_NODE` — both the bare and the fully-qualified form → `@gjsify/empty` (no-op, Node has native globals)
   - `ALIASES_GENERAL_FOR_NODE` — for `@gjsify/<pkg>/register` paths that are not web-only (e.g. `@gjsify/node-globals/register`, `@gjsify/buffer/register`)
6. **Tests that need globals** import the `/register` subpath explicitly: `import 'fetch/register'`, `import 'abort-controller/register'`, `import '@gjsify/node-globals/register'`. Do NOT rely on implicit global registration via a named import from the root.
7. **User projects rely on `--globals auto` (the default)**, which detects needed globals automatically from the bundled output. No manual `--globals` list or source-level register imports are needed. Users can override with an explicit list (`--globals fetch,Buffer`) or disable entirely (`--globals none`). Source-level `import '<pkg>/register'` is still supported and equivalent. Three **group aliases** expand to the full identifier set: `node` (Buffer, process, URL, …), `web` (fetch, streams, crypto, AbortController, events, …), `dom` (document, HTMLCanvasElement, Image, …). Groups are defined in `GJS_GLOBALS_GROUPS` in `globals-map.mjs` and expanded in `scan-globals.ts`.
8. **Exception — intra-package class inheritance.** If `src/index.ts` defines a class that extends a global constructor (e.g. `class TextLineStream extends TransformStream`), the class declaration runs at module load time and needs the global set. In this ONE case, `index.ts` may `import '@gjsify/<pkg>/register'` as a side-effect to seed the global before the class body runs. Document the exception explicitly in the file header. Current occurrences: `@gjsify/eventsource`.
9. **Adding a new global.** Checklist: (a) implement in the package, (b) add to `register.ts` with the appropriate existence guard (see Rule 2), (c) add to `package.json` `sideEffects` if the file is new, (d) add to `GJS_GLOBALS_MAP` in `globals-map.mjs`, (e) add aliases in `resolve-npm/lib/index.mjs`, (f) add a test in the package's own spec, (g) add the identifier to the appropriate category group in the Known Identifiers table at `website/src/content/docs/cli-reference.md` (§ Globals → Known identifiers). Note: `--globals auto` will pick up the new identifier automatically — no template or example updates needed.

**Tree-shakeability invariants — permanent, do not break:**

- `src/index.ts` MUST have zero top-level side effects. Any top-level `globalThis.X = ...`, `Object.defineProperty(globalThis, ...)`, or `registerGlobal(...)` in `index.ts` is a regression — move it to `register.ts`.
- **`--globals auto` analyses bundled output, NOT source files.** Previous source-level scanning approaches (regex, AST, metafile on entry points) were tried and rejected — they leaked false positives from isomorphic guards, dynamic imports, and bracket-notation access. The current auto mode avoids these problems by parsing the **minified esbuild output** after tree-shaking. Do NOT reintroduce source-level scanning. The two-pass approach (build → acorn analyse → rebuild) in `auto-globals.ts` / `detect-free-globals.ts` is the only sanctioned auto-detection mechanism.
- `sideEffects: ["./lib/esm/register.js"]` must remain in every package that registers globals. Never set `"sideEffects": false` on such a package.
- `globals-map.mjs` is authoritative. If a new identifier is added to `register.ts` but omitted from `globals-map.mjs`, the `--globals` flag silently fails to inject it.

**Auto mode is the default.** Most users never need to touch `--globals` — the two-pass build detects everything automatically. If auto mode misses a global (rare edge case), users can override with an explicit list. If auto mode injects an unwanted global (false positive from an isomorphic library guard that survived tree-shaking), users can switch to an explicit list or file an issue.

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
Web→GNOME: fetch→Soup.Session | WebSocket→Soup.WebsocketConnection | Streams→Gio.{In,Out}putStream | Compression→Gio.ZlibCompressor | SubtleCrypto→GLib.Checksum+Hmac | localStorage→Gio.File/GLib.KeyFile | ImageBitmap→GdkPixbuf.Pixbuf | EventSource→Soup.Session(SSE) | Gamepad→Manette.{Monitor,Device}(libmanette)
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

### Adwaita / GTK Design

| Path | Use |
|------|-----|
| `refs/adwaita-web/` | Web Framework based on GTK4/Libadwaita. CSS/component reference for `@gjsify/adwaita-web` |
| `refs/libadwaita/` | Original libadwaita source. Canonical CSS colors, radii, widget styles |
| `refs/adwaita-fonts/` | Adwaita Sans/Mono font files (SIL OFL). Used in browser examples |
| `refs/app-mockups/` | GNOME app mockup PNGs/SVGs. Visual reference for Adwaita UI |

### Build / Tooling

`refs/astro/`(Astro framework, website reference) | `refs/deepkit/`(Deepkit, type compiler) | `refs/gjsify-vite/`(`examples/gtk/three-geometry-shapes/refs/gjsify-vite/`, Vite plugins for GJS)

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
7. **`/register` side effects in a dedicated spec file:** Tests that verify globalThis wiring (e.g. `globalThis.FontFace`, `globalThis.__gjsify_globalEventTarget`) require `import '<pkg>/register'`. Put these in a separate `register.spec.ts` — NOT in the common `*.spec.ts`. Reason: even if the global itself (e.g. `FontFace`) is pure JS, the `/register` file pulls in GTK/Cairo implementation files via its import chain, which crashes on Node.js. The global value and the registration machinery are separate concerns. The common spec tests the class/value directly via named import (cross-platform); `register.spec.ts` tests that `/register` correctly wires it onto globalThis (GJS-only, wrap all tests in `on('Gjs', ...)`). Add to `test.mts` as a named suite. Applies only to packages that have no `test:node` (GJS-only packages like dom-elements, webgl). For cross-platform packages, the `/register` test belongs in a `.gjs.spec.ts` file. Example: `packages/dom/dom-elements/src/register.spec.ts`.

### Regression Tests from Examples

When real-world examples uncover bugs (GC, missing globals, CJS-ESM, MainLoop) — always add targeted test to relevant `*.spec.ts`. Examples=integration validation; regression tests=permanent safety net.

### Test Sources

Rewrite using `@gjsify/unit`, bare specifiers. Never copy verbatim. Select: core behavior, GNOME-relevant edge cases, error conditions, cross-platform compat. Skip: V8 internals, native addons, stubbed features.

### Deno Web API Refs — `refs/deno/`

`ext/web/`{`06_streams`(R/W/TransformStream), `14_compression`(Compression/DecompressionStream), `02_event`(Event,EventTarget,CustomEvent,ErrorEvent,CloseEvent,MessageEvent), `03_abort_signal`(AbortController/Signal), `08_text_encoding`(TextEncoder/Decoder), `09_file,10_filereader`(Blob,File,FileReader), `15_performance`(Performance,Mark/Measure/Observer), `02_structured_clone,13_message_port,16_image_data,01_broadcast_channel,01_urlpattern`} | `ext/fetch/`{`20-26`(fetch,Headers,Request,Response,FormData), `27_eventsource`(SSE)} | `ext/crypto/00_crypto`(SubtleCrypto,CryptoKey,getRandomValues,randomUUID) | `ext/{websocket/01,webstorage/01,cache/01,image/01}`(WebSocket,Storage,Cache,ImageBitmap)

## Package Convention

`packages/node/<name>/`: `@gjsify/<name>`, v0.0.4, `"type":"module"` | exports `./lib/esm/index.js` + `./lib/esm/register.js` (if the package provides globals) | `sideEffects: ["./lib/esm/register.js"]` pinned to register-only | scripts: `build:gjsify|build:types|build:test:{gjs,node}|test|test:{gjs,node}` | deps: `@girs/*`, devDep: `@gjsify/unit` | workspace deps: `workspace:^`

Layout: `src/index.ts` (pure named exports) | `src/register.ts` (side-effect globals, if applicable) | `src/*.spec.ts` (specs) | `src/test.mts` (entry, imports `@gjsify/node-globals/register` + any feature-specific `<pkg>/register`). See the Tree-shakeable Globals section for the full rules.

Shared utils: `@gjsify/utils` (`packages/gjs/utils/`). Check before duplicating. Only extract when second package needs it.

**`@gjsify/stream` direct imports in internal modules:** Internal modules and test files that need non-standard exports (e.g. `Stream_`, `makeCallable`, internal state types) may import `@gjsify/stream` directly. All public-facing code (examples, showcases, cross-package APIs) must use `node:stream`.

## Example Convention (GTK + Browser)

Dual-target examples with Adwaita UI:

```
examples/gtk/<name>/src/
  <shared>.ts        # Platform-agnostic logic, shared constants
  gjs/               # GJS/GTK4 native
    gjs.ts           # Adw.Application entry
    <window>.ts      # GObject.registerClass window
    <window>.blp     # Blueprint template
  browser/           # Browser target
    browser.ts       # @gjsify/adwaita-web programmatic UI
    index.html       # Minimal shell (<body> only)
    webgl.css        # Layout styles
  assets/            # Shared resources (textures, fonts)
```

Scripts: `build:gjs`→`gjsify build src/gjs/gjs.ts --app gjs` | `build:browser`→`gjsify build src/browser/browser.ts --app browser` | `start`→`gjsify run dist/gjs.js` | `start:browser`→`http-server dist`

Constants (dropdown items, defaults) live in shared `.ts` — both `gjs/` and `browser/` import from there. No duplication in HTML templates.

## Showcase — `gjsify showcase`

Showcases are polished, curated examples under `showcases/`. They are published npm packages (`@gjsify/example-{dom,node}-<name>`) and serve as CLI dependencies. Showcases are always self-contained and independently runnable — both via `gjsify showcase <name>` (GJS) and as standalone projects (`yarn start` / `yarn start:browser`).

### Showcase Rules

- **CLI dependency:** Showcases are dependencies of `@gjsify/cli` and can be executed directly via `gjsify showcase <name>`
- **Website integration:** The browser version of showcases can be embedded in the website. The website imports showcases as npm packages (e.g. `import { mount } from '@gjsify/example-dom-three-postprocessing-pixel/browser'`)
- **Full npm packages:** Showcases must export everything needed via `package.json` `exports` — browser entry, shared logic, assets. Never reference showcase internals via relative filesystem paths; always resolve through the package name
- **Self-contained:** Each showcase is independently buildable and runnable without the rest of the monorepo
- **Polished examples:** Showcases are production-quality demonstrations, not development experiments

### Showcase exports pattern

```json
"exports": {
  "./browser": "./src/browser/browser.ts",
  "./three-demo": "./src/three-demo.ts",
  "./assets/*": "./src/assets/*",
  "./package.json": "./package.json"
}
```

Assets are resolved via `require.resolve('@gjsify/example-dom-<name>/assets/<file>')` — never via relative filesystem paths.

### Examples vs Showcases

Examples under `examples/` are private (`"private": true`, no version) and are NOT published or included in the CLI. They serve as dev/test projects only.

### Discovery & Execution

`gjsify showcase` lists available showcases | `gjsify showcase <name>` runs `check` first, then executes via shared `runGjsBundle()` logic. Discovery is dynamic: scans CLI's own `package.json` for `@gjsify/example-*` deps, resolves each via `require.resolve`, reads `main` field.

**Adding a new showcase:** (1) create under `showcases/{dom,node}/<name>/` with name `@gjsify/example-{dom,node}-<name>` (2) set `"files":["dist"]`, keep version, no `"private"` (3) export browser entry, assets, and `package.json` (4) move all deps to `devDependencies` except `@gjsify/webgl` (5) add as dependency in `packages/infra/cli/package.json` (6) rebuild CLI

**Dependency rule for published showcases:** Everything bundled by esbuild → `devDependencies`. Only packages with native prebuilds needed by `gjsify run` at runtime (currently only `@gjsify/webgl`) stay in `dependencies`.

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

`refs/{node,node-test}/`→Node.js contributors, MIT | `refs/deno/`→2018-2026 Deno authors, MIT | `refs/bun/`→Oven, MIT | `refs/quickjs/`→Bellard+Gordon, MIT | `refs/workerd/`→Cloudflare, Apache 2.0 | `refs/edgejs/`→Wasmer, MIT | `refs/{crypto-browserify,browserify-cipher,create-hash,create-hmac,randombytes,randomfill}/`→crypto-browserify contributors, MIT | `refs/{browserify-sign,diffie-hellman,public-encrypt}/`→Calvin Metcalf, ISC/MIT | `refs/create-ecdh/`→createECDH contributors, MIT | `refs/hash-base/`→Kirill Fomichev, MIT | `refs/pbkdf2/`→Daniel Cousens, MIT | `refs/readable-stream/`→Node.js contributors, MIT | `refs/undici/`→Matteo Collina+contributors, MIT | `refs/gjs/`→GNOME contributors, MIT/LGPLv2+ | `refs/headless-gl/`→Mikola Lysenko, BSD-2-Clause | `refs/webgl/`→Khronos Group, MIT | `refs/three/`→three.js authors, MIT | `refs/libepoxy/`→Intel, MIT | `refs/node-gst-webrtc/`→Ratchanan Srirattanamet, ISC | `refs/llrt/`→Amazon, Apache 2.0 | `refs/happy-dom/`→David Ortner, MIT | `refs/jsdom/`→Elijah Insua, MIT | `refs/wpt/`→web-platform-tests contributors, 3-Clause BSD | `refs/ungap-structured-clone/`→Andrea Giammarchi, ISC | `refs/adwaita-web/`→mclellac, MIT | `refs/libadwaita/`→GNOME contributors, LGPLv2.1+ | `refs/adwaita-fonts/`→Inter/Iosevka/GNOME contributors, SIL OFL 1.1 | `refs/app-mockups/`→GNOME contributors, CC-BY-SA | node-fetch→MIT | event-target-shim→Toru Nagashima, MIT | gjs-require→Andrea Giammarchi, ISC

## STATUS.md & CHANGELOG.md Maintenance

**STATUS.md must always reflect the current state of the codebase.** Whenever a feature lands, a bug is fixed, a test is added, a workaround is discovered, or a deferred item is identified, STATUS.md must be updated in the same commit. Never leave STATUS.md drift between sessions.

Update STATUS.md when: adding/expanding tests (counts) | fixing impls (Working/Missing) | completing stubs (move category). Keep Metrics current. Add GJS/SpiderMonkey workarounds to "Upstream GJS Patch Candidates".

**Track deferred work in the dedicated `Open TODOs` section.** Every "out of scope", "follow-up" or "later" note from a PR description, plan file or commit message must have a corresponding entry there — otherwise it gets forgotten. When a TODO is resolved, move it to the relevant `### Completed` list (or delete it if trivial).

**Changelog entries live ONLY in CHANGELOG.md.** STATUS.md describes the current state; CHANGELOG.md records what changed and when. Do NOT add dated "Latest:" lines, changelog highlights, or per-session summaries to STATUS.md — they belong in CHANGELOG.md. Update CHANGELOG.md after work sessions with dated entries describing what changed and why.

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
