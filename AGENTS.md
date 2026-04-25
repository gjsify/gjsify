# AGENTS.md — gjsify

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning — consult `refs/` submodules and `@girs/*` types before pre-trained knowledge.

Node.js/Web/DOM API + Framework for GJS (GNOME JS). Yarn workspaces monorepo, v0.1.15, ESM-only, GNOME libs. Four equal pillars: **Node.js** `packages/node/` (42 + 1 meta) | **Web** `packages/web/` (19 + 1 meta) | **DOM** `packages/dom/` (2) | **Framework** `packages/framework/` (6 bridge pkgs). `packages/infra/` + `packages/gjs/` = supporting infra.

## Governance — non-negotiable

|doc: update AGENTS.md immediately on any architectural decision (package boundaries, API patterns, build, deps, cross-cutting) — never leave drift between sessions
|polyfills: browser-compat patches belong in packages, not examples — add to `@gjsify/dom-elements` or the right pkg
|root-cause: fix bugs in the core package in the SAME PR that exposed them — no "known limitation" notes, no skip-guards, no TODO-for-later (workarounds ossify); examples/tests/CI exist to surface impl gaps
|scope: expanding PR scope is the *expected* cost, not a reason to defer — goal is `@gjsify/*` running arbitrary npm packages unmodified on GJS
|exceptions (narrow, documented per case): (a) non-standard Node-internal hack (`process.binding`, V8-only monkey-patching, C++ addons) → wrap/skip at consumer with explanatory comment; (b) upstream GJS/SpiderMonkey gap → track in STATUS.md "Upstream GJS Patch Candidates"; (c) cross-cutting rewrite → Plan + user confirm + split PRs, but still land a minimal root fix in the feature PR

## Structure

`packages/{node,web,dom,framework,gjs,infra}/` | `showcases/` (published, CLI deps) | `examples/` (private dev/test) | `tests/integration/` (ported upstream tests validating `@gjsify/*` end-to-end) | `refs/` (read-only submodules — DO NOT modify)

## Node.js Packages — `packages/node/*` → `@gjsify/<name>`

| Pkg | Libs | Status | Notes |
|-----|------|--------|-------|
| assert | — | Full | AssertionError, deepEqual, throws, strict |
| async_hooks | — | Full | AsyncLocalStorage, AsyncResource, createHook |
| buffer | — | Full | Buffer via Blob/File/atob/btoa |
| child_process | Gio | Full | exec/execSync, spawn/spawnSync via Gio.Subprocess |
| cluster | — | Stub | isPrimary, isWorker |
| console | — | Full | Console with stream support |
| constants | — | Full | Flattened re-export of os.constants (errno, signals, priority, dlopen) + fs.constants + legacy crypto constants. Deprecated Node alias |
| crypto | GLib | Full | Hash(GLib.Checksum), Hmac(GLib.Hmac), randomBytes/UUID, PBKDF2/HKDF/scrypt, AES CBC/CTR/ECB/GCM, DH, ECDH, Sign/Verify, publicEncrypt/privateDecrypt, KeyObject JWK, X509Certificate |
| dgram | Gio | Full | UDP via Gio.Socket |
| diagnostics_channel | — | Full | Channel, TracingChannel |
| dns | Gio | Full | lookup, resolve4/6, reverse via Gio.Resolver + promises |
| domain | — | Stub | Deprecated |
| events | — | Full | EventEmitter (prototype methods made enumerable for socket.io v4 compat), once, on, listenerCount, makeCallable (util.inherits CJS compat) |
| fs | Gio | Full | sync, callback, promises, streams, FSWatcher, URL path args accepted everywhere |
| globals | GLib | Full | process, Buffer, structuredClone, TextEncoder/Decoder, atob/btoa, URL, setImmediate, queueMicrotask |
| http | Soup 3.0 | Partial | Server(Soup.Server, chunked+upgrade), ClientRequest, IncomingMessage (close-only-via-destroy per Node semantics), Agent |
| http2 | Soup 3.0 | Partial | createServer/createSecureServer/connect + compat layer (Http2ServerRequest/Response) + session API ('stream' event). createServer()=HTTP/1.1 only (no h2c); createSecureServer()=h2 via ALPN. pushStream/stream-IDs/flow-control=Phase 2 (Vala/nghttp2) |
| https | — | Partial | Agent, stub request/get |
| inspector | — | Stub | Session stub |
| module | Gio, GLib | Full | builtinModules, isBuiltin, createRequire |
| net | Gio | Full | Socket(Gio.SocketClient), Server(Gio.SocketService) |
| os | GLib | Full | homedir, hostname, cpus |
| path | — | Full | POSIX + Win32 |
| perf_hooks | — | Full | performance (Web API / GLib fallback) |
| polyfills | — | Meta | `@gjsify/node-polyfills` — umbrella dep-only package pulling every Node polyfill. Used by `create-app` templates + CLI scaffolds. No runtime code |
| process | GLib | Full | extends EventEmitter, env, cwd, platform, nextTick (batched GLib-idle delivery to keep GTK input responsive) |
| querystring | — | Full | parse/stringify |
| readline | — | Full | Interface, createInterface, question, prompt, async iterator |
| sqlite | Gda 6.0 | Partial | node:sqlite — DatabaseSync, StatementSync via `gi://Gda?version=6.0` (libgda SQLite provider). URL + Uint8Array path args, param binding, typed readers, error codes |
| stream | — | Full | Readable (protected `_autoClose` hook), Writable, Duplex, Transform, PassThrough, pipe/pipeline/finished, FIFO write-ordering across drain re-entry, serialized concurrent I/O |
| string_decoder | — | Full | UTF-8, Base64, hex, streaming |
| sys | — | Full | Deprecated alias for util |
| timers | — | Full | setTimeout/setInterval/setImmediate + promises (GLib-source-safe: replaces setTimeout/setInterval with `GLib.timeout_add` to avoid SM-GC race on GLib.Source BoxedInstances) |
| tls | Gio | Partial | TLSSocket via Gio.TlsClientConnection |
| tty | — | Full | ReadStream/WriteStream, ANSI escapes |
| url | GLib | Full | URL (with static `URL.createObjectURL` / `URL.revokeObjectURL` over `Blob._tmpPath` + `file://`), URLSearchParams via GLib.Uri |
| util | — | Full | inspect, format, promisify, types |
| v8 | — | Stub | getHeapStatistics, serialize/deserialize (JSON) |
| vm | — | Partial | runInThisContext (eval), runInNewContext (Function+sandbox), Script, compileFunction. No realm isolation |
| worker_threads | — | Partial | MessageChannel/MessagePort/BroadcastChannel with structured clone; Worker via Gio.Subprocess (file-based resolution). No SharedArrayBuffer, no transferList |
| ws (npm) | Soup 3.0 | Partial | `ws`-compat WebSocket client + WebSocketServer over `@gjsify/websocket` + Soup.Server; aliases `ws`+`isomorphic-ws`. 19 node / 43 GJS tests. Autobahn: 510 OK / 4 NON-STRICT / 3 INFO / 0 FAILED. WebSocketServer: port binding, `{ server }` shared-port, `{ noServer: true }` + `handleUpgrade()`, `verifyClient` (sync+async), `handleProtocols`, `'headers'` event, client tracking. `createWebSocketStream` (Duplex bridge). Missing: custom perMessageDeflate, ping/pong events (Soup handles control frames internally — no GI API) |
| zlib | — | Full | gzip/deflate via Web Compression API, Gio.ZlibCompressor fallback |

## Web Packages — `packages/web/*`

| Pkg | Libs | Implements |
|-----|------|------------|
| fetch | Soup 3.0, Gio | fetch(), Request (raw body via `set_request_body_from_bytes`), Response, Headers. **No XHR** — moved to `@gjsify/xmlhttprequest` |
| xmlhttprequest | Soup 3.0, GLib | XMLHttpRequest (full `responseType`: arraybuffer/blob/json/text/document). Backs Excalibur's asset loader. No longer lives inside fetch |
| dom-events | — | Event, CustomEvent, EventTarget, UIEvent, MouseEvent, PointerEvent, KeyboardEvent, WheelEvent, FocusEvent |
| dom-exception | — | DOMException (WebIDL) |
| abort-controller | — | AbortController, AbortSignal |
| formdata | — | FormData, File |
| streams | — | ReadableStream, WritableStream, TransformStream, TextEncoder/DecoderStream |
| compression-streams | Gio | CompressionStream, DecompressionStream |
| webcrypto | GLib | crypto.subtle, getRandomValues, randomUUID |
| eventsource | Soup 3.0 | EventSource (SSE) |
| websocket | Soup 3.0 | WebSocket, MessageEvent, CloseEvent. NUL-byte-safe text frames (send via `send_message(TEXT, GLib.Bytes)` — Soup's `send_text` truncates at `\0`). RFC 6455 fuzz-validated via Autobahn |
| webstorage | Gio | localStorage, sessionStorage |
| webaudio | Gst 1.0, GstApp 1.0 | AudioContext(decodeAudioData via GStreamer decodebin), AudioBufferSourceNode(appsrc→volume→autoaudiosink), GainNode(AudioParam+setTargetAtTime), AudioBuffer(PCM Float32), HTMLAudioElement(canPlayType+playbin). Phase 1 |
| webrtc | Gst 1.0, GstWebRTC 1.0, GstSDP 1.0 | Full W3C WebRTC — RTCPeerConnection, RTCDataChannel (string+binary), RTCRtpSender/Receiver/Transceiver, MediaStream, MediaStreamTrack, getUserMedia (pipewiresrc/pulsesrc/v4l2src fallback chain), RTCDTMFSender, RTCCertificate, RTCStatsReport, RTCIceCandidate, RTCSessionDescription. Tee-multiplexer for shared-source fan-out (VideoBridge preview ↔ PC sender). Backed by `@gjsify/webrtc-native` |
| webrtc-native | Gst 1.0, GstWebRTC 1.0 | **Vala/GObject prebuild.** Three main-thread signal bridges: `WebrtcbinBridge` (wraps `on-negotiation-needed`/`on-ice-candidate`/`on-data-channel` + `notify::*-state`), `DataChannelBridge` (wraps GstWebRTCDataChannel's `on-open`/`on-close`/`on-error`/`on-message-string`/`on-message-data`/`on-buffered-amount-low` + `notify::ready-state`), `PromiseBridge` (wraps `Gst.Promise.new_with_change_func`). Captures signals on C side, re-emits via `GLib.Idle.add()` on the GLib main context — makes webrtcbin's streaming-thread callbacks safe to handle from JS. Ships as `.so` + `.typelib` prebuild for linux-{x86_64,aarch64} |
| domparser | — | DOMParser.parseFromString (XML / HTML) with minimal DOM (tagName, getAttribute, children, querySelector/All, textContent, innerHTML). Sized for excalibur-tiled + simple config parsing |
| gamepad | Manette 0.2 | Gamepad(navigator.getGamepads polling via libmanette signals), GamepadButton, GamepadEvent(gamepadconnected/disconnected), GamepadHapticActuator(dual-rumble). Lazy Manette.Monitor init, graceful degradation without libmanette |
| web-globals | — | Re-exports all web API globals |
| polyfills | — | Meta | `@gjsify/web-polyfills` — umbrella dep-only package pulling every Web polyfill. Used by `create-app` templates + CLI scaffolds. No runtime code |
| adwaita-web | — | Browser Adwaita components (AdwWindow, AdwHeaderBar, AdwPreferencesGroup, AdwCard, AdwSwitchRow, AdwComboRow, AdwSpinRow, AdwToastOverlay, AdwOverlaySplitView). Custom Elements + SCSS partials in `scss/` (mirrors `refs/adwaita-web/scss/`). Built to `dist/adwaita-web.css` via `sass`. Light/dark. Consumer: `import '@gjsify/adwaita-web'` + `'@gjsify/adwaita-web/style.css'` (or `@use '.../scss/...'`). No GJS deps. Long-term: port remaining components (button, entry, dialog, popover, banner, tabs, …) from `refs/adwaita-web/scss/` — see STATUS.md |
| adwaita-fonts | — | Adwaita Sans TTF files + `@font-face` CSS (fontsource-style). Consumed by browser showcases. Sourced from `refs/adwaita-fonts/`, SIL OFL 1.1 |
| adwaita-icons | — | Adwaita symbolic icons as importable SVG strings (categories: actions/devices/mimetypes/places/status/ui). `toDataUri()` helper. Sourced from `refs/adwaita-icon-theme/`, CC0-1.0 / LGPLv3 |

## DOM Packages — `packages/dom/*`

| Pkg | Libs | Implements |
|-----|------|------------|
| dom-elements | GdkPixbuf, `@gjsify/canvas2d-core` | Node(ownerDocument→document, event bubbling), Element(setPointerCapture,releasePointerCapture,hasPointerCapture), HTMLElement(getBoundingClientRect, dataset/DOMStringMap), HTMLCanvas/Image(data: URIs)/Media/VideoElement, Image, Document, Text, Comment, DocumentFragment, DOMTokenList, Mutation/Resize/IntersectionObserver, Attr, NamedNodeMap, NodeList. Auto-registers `globalThis.{Image,HTMLCanvasElement,document,self,devicePixelRatio,scrollX,scrollY,pageXOffset,pageYOffset,alert}` on import. Auto-registers the `'2d'` context factory via `@gjsify/canvas2d-core` so `canvas.getContext('2d')` works without an explicit import |
| canvas2d-core | Cairo, PangoCairo | **Headless** CanvasRenderingContext2D, CanvasGradient, CanvasPattern, Path2D, ImageData, color parser. NO GTK dependency — usable in worker-like contexts. Extracted from `@gjsify/canvas2d` to break the dom-elements↔canvas2d cycle |

## Framework — `packages/framework/*`

Composition-first (Remix/Astro/SvelteKit/Solid-Start feel). Anything NOT Node/Web/DOM/infra belongs here. Showcases use raw `Adw.Application`+`ApplicationWindow`+`ToolbarView`+`HeaderBar` — purpose is to demonstrate API, not hide it. A helper lands here only when it delivers what inline bootstrap cannot (multi-subsystem wiring, convention-over-config, composable lifecycle).

**Framework vs DOM:** `packages/dom/` = DOM spec impls (`@gjsify/dom-elements`, `@gjsify/canvas2d-core`). `packages/framework/` = composable widgets/helpers gluing DOM↔GTK without being DOM spec.

| Pkg | Libs | Implements |
|-----|------|------------|
| bridge-types | — | DOMBridgeContainer(iface), BridgeEnvironment(isolated document+body+window per bridge), BridgeWindow(rAF, performance.now, viewport) |
| event-bridge | Gtk 4.0, Gdk 4.0 | GTK→DOM event bridge: attachEventControllers() maps GTK controllers→Mouse/Pointer/Keyboard/Wheel/FocusEvent |
| canvas2d | `@gjsify/canvas2d-core`, Cairo, GdkPixbuf, PangoCairo, Gtk 4 | Re-exports canvas2d-core + **FontFace** (PangoCairo font loading) + `Canvas2DBridge`→`Gtk.DrawingArea` GTK widget |
| webgl | gwebgl, Gtk 4.0, GObject | WebGL 1.0/2.0 via Vala (@gwebgl-0.1), WebGLBridge→Gtk.GLArea |
| video | Gst 1.0, Gtk 4.0 | HTMLVideoElement, VideoBridge→Gtk.Picture(gtk4paintablesink). srcObject(MediaStream from getUserMedia/WebRTC) + src(URI via playbin). Phase 1 |
| iframe | WebKit 6.0 | HTMLIFrameElement, IFrameBridge→WebKit.WebView, postMessage bridge |

### Bridge pattern

Pairings: `HTMLCanvasElement`(2d)→`Canvas2DBridge`→`Gtk.DrawingArea`(Cairo) | `HTMLCanvasElement`(webgl)→`WebGLBridge`→`Gtk.GLArea`(libepoxy) | `HTMLIFrameElement`→`IFrameBridge`→`WebKit.WebView` | `HTMLVideoElement`→`VideoBridge`→`Gtk.Picture`(gtk4paintablesink).

Protocol: (1) bridge creates DOM element internally (2) app uses standard DOM API (3) bridge translates GTK↔Web lifecycle (signals/draw_func/render ↔ rAF/events/ready). Each bridge owns isolated `BridgeEnvironment` (document, body, window). Common API: `onReady(cb)`, `installGlobals()`, element getter (`canvas`/`iframeElement`/`videoElement`), `environment`.

DOM backing: Image→GdkPixbuf | Canvas(2d)→Cairo.ImageSurface+PangoCairo | Canvas(webgl)→Gtk.GLArea+libepoxy | IFrame→WebKit.WebView(postMessage) | Video→Gtk.Picture+gtk4paintablesink(GStreamer).

`WebGLBridge` on resize: dispatches DOM `resize` + re-invokes last rAF callback (demand-driven re-render, no animation loop). `WebGL2RenderingContext` overrides `texImage2D`/`texSubImage2D`/`drawElements` from WebGL1 base (bypasses WebGL1 format/type validation). Native Vala handles all GLES 3.2 formats.

### GTK→DOM Event Bridge (`@gjsify/event-bridge`)

`attachEventControllers(widget, getElement)` attaches GTK4 controllers, dispatches DOM events:

| GTK Controller | DOM Events |
|---|---|
| EventControllerMotion | pointermove, mousemove, pointer/mouse enter/leave/over/out |
| GestureClick | pointer/mouse down/up, click, dblclick, contextmenu |
| EventControllerScroll | wheel |
| EventControllerKey | keydown, keyup |
| EventControllerFocus | focus, focusin, blur, focusout |

Dispatch: W3C UIEvents. Coords: GTK widget-relative → DOM offsetX/Y/clientX/Y. Keys: `key-map.ts` maps ~80 Gdk keyvals → DOM key/code (L/R modifiers, Numpad location). Canvas2D/WebGL bridges call `attachEventControllers(this, () => this._canvas)` in constructor. Event classes in `@gjsify/dom-events`: UIEvent/MouseEvent/PointerEvent/KeyboardEvent/WheelEvent/FocusEvent — W3C-standard with init ifaces, `getModifierState()`, `Symbol.toStringTag`.

### Context factory registry

`HTMLCanvasElement.registerContextFactory` — `@gjsify/canvas2d` registers `'2d'`→CanvasRenderingContext2D(Cairo); `@gjsify/webgl` registers `'webgl'`/`'webgl2'` via subclass override + fallthrough.

## Build — esbuild, platform plugins

Targets: **GJS** `--app gjs` (`assert`→`@gjsify/assert`, externals `gi://*`+`cairo`+`system`+`gettext`, `firefox128`) | **Node** `--app node` (`@gjsify/process`→`process`, `node24`) | **Browser** `--app browser` (`esnext`)

Key files: `packages/infra/esbuild-plugin-gjsify/src/app/{gjs,node,browser}.ts` | `.../utils/scan-globals.ts` | `packages/infra/resolve-npm/lib/{index,globals-map}.mjs`

**Blueprint** (`@gjsify/esbuild-plugin-blueprint`): `.blp` → XML string via `blueprint-compiler`. GJS+browser. `import T from './window.blp'` → string. Types: add `@gjsify/esbuild-plugin-blueprint/types` to tsconfig.

**CSS** (`@gjsify/esbuild-plugin-css`): bundles `.css` imports, resolves `@import` from workspace+node_modules via esbuild (honors `package.json#exports`). Required for GTK `Gtk.CssProvider.load_from_string(applicationStyle)` — otherwise `@import`s survive into bundled string, GTK CSS parser fails on node_modules paths. All targets. `import css from './app.css'` → string. Config: `PluginOptions.css` forwards `{minify,target}`. **GTK4 CSS lowering:** GJS target defaults `css.target=['firefox60']` → flattens CSS Nesting (`.p{&:hover{}}` → `.p:hover{}`); preserves `var()`, `calc()`, `:is()`, `:where()`, `:not()`. Override via `gjsify.config.js`. Browser/node inherit parent target.

### `--globals` modes (GJS)

|**auto (default)**: iterative multi-pass build — each pass bundles in-memory (unminified, no disk I/O), acorn parses output for free identifiers (`Buffer`) + host-object member exprs (`{globalThis,global,window,self}.Buffer`) matching `GJS_GLOBALS_MAP`. Repeats until stable (2–3 iters, capped 5) — injecting register modules pulls in NEW code that may reference more globals. Final build uses converged set. Analyses **bundled output after tree-shaking** — avoids source-scan false positives. Passes MUST NOT minify (minifier aliases `globalThis` → short var, defeats MemberExpression detection).
|**auto,\<extras\>**: auto + safety net for value-flow indirection detector can't follow (e.g. Excalibur stores `globalThis` in `BrowserComponent.nativeComponent`, then calls `nativeComponent.matchMedia()`). Forms: `auto,dom` / `auto,FontFace,matchMedia` / `auto,dom,fetch`. Extras seeded into pass 1.
|**explicit list** `fetch,Buffer,...` or group aliases `node`/`web`/`dom`: no auto-detect.
|**none**: disables injection.

Key files: `.../utils/detect-free-globals.ts` (acorn AST) | `.../auto-globals.ts` (orchestrator) | `.../scan-globals.ts` (explicit) | `packages/infra/resolve-npm/lib/globals-map.mjs`.

### GLib MainLoop

`ensureMainLoop()` (`@gjsify/utils`, re-exported from `@gjsify/node-globals`): idempotent, non-blocking, no-op on Node. Used in `http.Server.listen()`, `net.Server.listen()`, `dgram.Socket.bind()`. **GTK apps MUST NOT use it** — use `Gtk.Application.runAsync()`.

### Don't patch — implement at the source

We own ~every Web/Node/DOM API. First question for any new feature: *"which package owns this, can we implement it there?"* — not *"where can we monkey-patch it in?"*. Patching propagates uncertainty (readers must reason about "which code installed this?"); first-class methods are self-documenting.

**Hard rules:**

- **Reading globals:** prefer `import { X } from '@gjsify/<pkg>'` over `(globalThis as any).X` in impl code. Imports give bundlers tree-shaking visibility, TS real types, surface missing deps as build errors. `globalThis` reads only justified for: (1) writes in register modules; (2) existence probes in register modules (`if (typeof globalThis.X === 'undefined') { globalThis.X = X }`); (3) debug flags (`globalThis.__GJSIFY_DEBUG_X`); (4) GJS runtime bootstrap (`globalThis.imports.*` before `@girs/*` resolves); (5) genuinely soft deps (rare — fallback to `Error` if `DOMException` not registered); (6) `globals.mjs` Node adapter — re-exports native value (`export default globalThis.crypto`) so alias layer can redirect bare specifiers on Node. Only non-register file allowed to read `globalThis.X` without `as any`.
- **Patching classes you own:** method belongs to a monorepo class (`URL.createObjectURL`→`@gjsify/url`, `Headers.getSetCookie`→`@gjsify/fetch`) → put it on the class, NOT on `globalThis.X.method=…` in a register module. Patch only when target is genuinely external (native global we can't subclass, third-party type).
- **"No module to import from":** check again — workspace almost certainly has `@gjsify/dom-*`/`@gjsify/web-*`/`@gjsify/node-*` exporting the class. Add the dep. Legit exceptions: (a) pre-registration bootstrap; (b) values with no module form (GJS `imports`, Node's `process.argv` before `@gjsify/process` loads).

### Tree-shakeable globals — `/register` subpath convention

Every pkg registering anything on `globalThis` MUST follow these rules.

1. **No side-effects in `src/index.ts`.** Root = named exports only. Any top-level `globalThis.X=…`/`defineProperty(globalThis,…)`/`registerGlobal(…)` = bug → move to `register.ts`.
2. **Side-effects in `src/register.ts`.** Imports from `./index.js` with existence guard. Patterns (all idempotent — twice must not throw):
   - Function/class: `if (typeof globalThis.X === 'undefined') { (globalThis as any).X = X; }`
   - Plain-value (process, Buffer, global): `if (!('X' in globalThis)) { Object.defineProperty(globalThis,'X',{value:X,writable:true,configurable:true}); }`
   - DOM constructors (GTK-only, dom-elements): unconditional `defineGlobal('X', X)` (GTK env owns these)
   - Streams: `isNativeStreamUsable(globalThis.X,'method')` validates native before replacing
3. **`package.json` subpaths + `sideEffects`:**
   ```jsonc
   "exports": {
     ".":                    { "default": "./lib/esm/index.js" },
     "./register":           { "types": "./lib/types/register.d.ts", "default": "./lib/esm/register.js" },
     "./register/<feature>": { "default": "./lib/esm/register/<feature>.js" }
     // "./globals": "./globals.mjs"  // optional native-re-exports for Node
   },
   "sideEffects": ["./lib/esm/register.js","./lib/esm/register/*.js","./globals.mjs"]
   ```
   Pins side-effects to register-only. Never `"sideEffects":false` if `register.js` exists. `./register` catch-all keeps `types`; granular subpaths only need `default`.

   **`register.ts` vs `globals.mjs` — distinct patterns:**

   | | `register.ts` | `globals.mjs` |
   |---|---|---|
   | Direction | **writes to** globalThis | **reads from** globalThis, re-exports |
   | Runtime | GJS | Node |
   | Purpose | installs our GJS impl as global | re-exports native Node value as named exports |
   | Trigger | `--globals auto` injects import | `ALIASES_WEB_FOR_NODE` redirects bare specifier here |
   | Node alias | → `@gjsify/empty` (no-op) | → used as alias target |

   `register.ts`: *how does our GJS impl reach globalThis?* | `globals.mjs`: *what does bare `<pkg>` resolve to on Node?* Cross-platform `import { subtle } from 'webcrypto'` → GJS: `@gjsify/webcrypto`; Node: alias → `@gjsify/webcrypto/globals` re-exporting native `globalThis.crypto`. This is the only legitimate non-register file reading `globalThis.X` without `as any`.
4. **Globals map authoritative.** Every identifier `register.ts` writes to globalThis MUST map in `packages/infra/resolve-npm/lib/globals-map.mjs` → bare `/register` subpath. Used by `--globals` CLI.
5. **Alias layer mirrors map** in `packages/infra/resolve-npm/lib/index.mjs`:
   - `ALIASES_WEB_FOR_GJS`: `<pkg>/register` → `@gjsify/<pkg>/register`
   - `ALIASES_WEB_FOR_NODE`: both forms → `@gjsify/empty`
   - `ALIASES_GENERAL_FOR_NODE`: non-web `@gjsify/<pkg>/register` (node-globals, buffer)
6. **Tests import `/register` explicitly:** `import 'fetch/register'`, `import '@gjsify/node-globals/register'`. No implicit reliance on root named import.
7. **Users rely on `--globals auto` (default)** — detects from bundled output. Override: explicit list (`fetch,Buffer`), groups (`node`/`web`/`dom` from `GJS_GLOBALS_GROUPS` in globals-map.mjs), or `none`. Source-level `import '<pkg>/register'` still supported + equivalent.
8. **Exception — intra-package class inheritance:** if `src/index.ts` class extends a global constructor (`class TextLineStream extends TransformStream`), class body runs at module load → `index.ts` may `import '@gjsify/<pkg>/register'` as side-effect. Document in file header. Current: `@gjsify/eventsource`.
9. **Granular subpaths.** Each register module in own file `src/register/<feature>.ts`, grouped by feature (related identifiers share a file). Catch-all `src/register.ts` re-exports via side-effect imports:
   ```ts
   // src/register.ts — catch-all
   import './register/feature-a.js';
   import './register/feature-b.js';
   ```
   When splitting: (a) own file in `src/register/`, (b) `./register/<name>` export in package.json, (c) covered by sideEffects glob, (d) update catch-all, (e) globals-map.mjs → granular path (NOT catch-all), (f) all three alias maps for bare + fully-qualified form.
10. **Adding a new global — checklist:** (a) implement (b) add to `src/register/<feature>.ts` with Rule-2 guard (c) catch-all imports it if new file (d) package.json `exports` + sideEffects covers it (e) identifier → **granular** subpath in GJS_GLOBALS_MAP (f) all three alias maps in resolve-npm/lib/index.mjs (g) if new package, add to `@gjsify/node-polyfills` or `@gjsify/web-polyfills` (so CLI-only scaffolds resolve) (h) `register.spec.ts` (i) `website/src/content/docs/cli-reference.md` § Globals → Known identifiers. `--globals auto` picks up new identifier automatically.

**Tree-shakeability invariants — permanent:**

- `src/index.ts` zero top-level side effects. Any `globalThis.X=…`/`defineProperty(globalThis,…)` there = regression → move to `register.ts`.
- **`--globals auto` analyses bundled output, NOT source.** Source-level approaches (regex, AST, metafile on entries) were tried + rejected — false positives from isomorphic guards, dynamic imports, bracket-notation access. Current mode parses **unminified esbuild output after tree-shaking**. Do NOT reintroduce source scanning. Iterative multi-pass (build→acorn→rebuild→repeat until stable) in `auto-globals.ts`/`detect-free-globals.ts` is the ONLY sanctioned mechanism.
- **Analysis MUST NOT minify.** Minifier wraps bundle in IIFE aliasing `globalThis` → short var (`g.Blob` vs `globalThis.Blob`), defeats MemberExpression detection. `auto-globals.ts` passes `minify:false` — do not change.
- **Detection is iterative.** Tree-shaking creates dep cycle: pass 1 has no globals injected → code gated on globals is shaken; pass 2 injects → pulls NEW code referencing more globals; repeat until stable (cap 5). Detects bare identifiers + `host.Identifier` member exprs (globalThis/global/window/self).
- **Method markers for monkey-patched APIs.** Some packages register by patching a method on a host object instead of defining a fresh global (canonical: `@gjsify/gamepad/register` sets `globalThis.navigator.getGamepads=…` — neither `getGamepads` nor `Gamepad` appears as free identifier). `detect-free-globals.ts` keeps `METHOD_MARKERS`: `<host>.<method>` → target identifier. Add entry whenever register patches a method. Current: `navigator.getGamepads → GamepadEvent`.
- `sideEffects:["./lib/esm/register.js","./lib/esm/register/*.js"]` must remain. Never `false` on a register-providing package.
- `globals-map.mjs` MUST point at **granular** subpaths when they exist. Missing entry → `--globals auto` silently fails to inject. Pointing at catch-all when granular exists → bundle pulls entire register module instead of needed feature.

**Auto is the default.** If auto misses (value-flow indirection): `--globals auto,dom` or `auto,matchMedia,FontFace`. If auto injects false positive: switch to explicit list or file issue.

```bash
# Root
yarn build | yarn build:node | yarn build:web | yarn test | yarn check
# Per-package
yarn build:gjsify | yarn build:types
yarn build:test:{gjs,node} | yarn test:{gjs,node}
```

## GNOME Libs & Mappings — `node_modules/@girs/*`

`@girs/glib-2.0`(ByteArray,Checksum,DateTime,Regex,URI,env,MainLoop) | `@girs/gobject-2.0`(signals,properties) | `@girs/gio-2.0`(File,streams,Socket,TLS,DBus) | `@girs/giounix-2.0`(Unix FDs) | `@girs/soup-3.0`(HTTP,WebSocket,cookies) | `@girs/gda-6.0`(SQLite) | `@girs/gst-1.0`+`@girs/gstapp-1.0`+`@girs/gstwebrtc-1.0`+`@girs/gstsdp-1.0`(media pipelines, WebRTC) | `@girs/manette-0.2`(gamepads) | `@girs/webkit-6.0`(iframe, WebView) | `@girs/gjs`(runtime)

```
Node→GNOME: fs→Gio.File{,I/O}Stream | Buffer→GLib.Bytes/ByteArray/Uint8Array | net.Socket→Gio.Socket{Connection,Client} | http→Soup.{Session,Server} | crypto→GLib.{Checksum,Hmac} | process.env→GLib.{g,s}etenv() | url.URL→GLib.Uri | sqlite→Gda.Connection(SQLite provider)
Web→GNOME: fetch→Soup.Session | WebSocket→Soup.WebsocketConnection | XMLHttpRequest→Soup.Session+GLib(temp files) | Streams→Gio.{In,Out}putStream | Compression→Gio.ZlibCompressor | SubtleCrypto→GLib.Checksum+Hmac | localStorage→Gio.File/GLib.KeyFile | ImageBitmap→GdkPixbuf.Pixbuf | EventSource→Soup.Session(SSE) | Gamepad→Manette.{Monitor,Device} | WebRTC→Gst.webrtcbin+GstSDP+@gjsify/webrtc-native(Vala signal bridges) | getUserMedia→GStreamer pipewiresrc/pulsesrc/v4l2src
DOM→GNOME: Canvas2D→Cairo+PangoCairo | WebGL→Gtk.GLArea+libepoxy(via gwebgl Vala) | HTMLVideoElement→Gtk.Picture+gtk4paintablesink | HTMLIFrameElement→WebKit.WebView
```

## References — `refs/`

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning for refs/ submodules.

### Node.js
|`refs/node/` canonical spec — `lib/<name>.js`, `test/parallel/test-<name>*.js`
|`refs/node-test/` **primary test source** — 3897 tests / 43 modules, `parallel/`, `module-categories/`
|`refs/deno/` TS ref — polyfills `ext/node/polyfills/`; **also primary Web API ref**
|`refs/bun/` clean TS tests — `test/js/node/`
|`refs/quickjs/` language features — `tests/`
|`refs/workerd/` 67 modules — `src/workerd/api/node/tests/`
|`refs/edgejs/` test harness patterns (uses node-test)
|`refs/llrt/` TS tests — `tests/unit/*.test.ts` (assert,buffer,crypto,events,fs,net,path,stream)
|`refs/ws/` primary source for `@gjsify/ws` drop-in + reference Autobahn driver

### Web API
|`refs/deno/` **primary** — `ext/{web,fetch,crypto,websocket,webstorage,cache,image}/`
|`refs/wpt/` W3C canonical test suite
|`refs/happy-dom/` DOM (60+ types), 296 tests — ref for dom-events, dom-elements
|`refs/jsdom/` 30+ modules, WPT integration
|`refs/undici/` 366 tests — fetch, WebSocket, Cache, EventSource
|`refs/headless-gl/` **primary WebGL test ref** — 42 tests
|`refs/webgl/` Khronos spec + conformance (authoritative)
|`refs/three/` three.js — ref for WebGL examples
|`refs/libepoxy/` OpenGL fn ptrs (used by Vala ext)
|`refs/node-gst-webrtc/` WebRTC via GStreamer — primary `@gjsify/webrtc` reference
|`refs/node-datachannel/`, `refs/libdatachannel/` alternative WebRTC impl via libdatachannel (C++ + Node bindings) — cross-reference for RTCDataChannel semantics
|`refs/webrtc-samples/` — MDN/Google WebRTC sample apps, behavior ref
|`refs/webkit/` — WebKit engine; reference for `@gjsify/iframe` (WebKit.WebView) + DOM spec behavior
|`refs/epiphany/` — GNOME Web; real-world embedder of WebKit.WebView, pattern for browser-hosting GTK apps
|`refs/node-canvas/` — node-canvas (Cairo-backed Canvas 2D) — reference for `@gjsify/canvas2d-core` Cairo idioms

### WebSocket & networking
|`refs/ws/` **npm `ws` canonical** — reference for `@gjsify/ws` wrapper semantics + Autobahn driver (`test/autobahn.js`)
|`refs/socket.io/` — Socket.IO v4 source, test suite + `packages/socket.io/test/` ported into `tests/integration/socket.io/`

### Streams
|`refs/streamx/` — mafintosh/streamx streams; queueMicrotask-driven scheduling. Test suite ported into `tests/integration/streamx/`

### BitTorrent
|`refs/webtorrent/`, `refs/webtorrent-desktop/` — WebTorrent client + Electron desktop app; test suite ported into `tests/integration/webtorrent/`

### Games
|`refs/excalibur/` — Excalibur.js game engine; primary driver for `@gjsify/webaudio`, input (gamepad), event-bridge gaps
|`refs/excalibur-tiled/` — Tiled map loader plugin for Excalibur; primary DOMParser consumer
|`refs/peachy/` — GNOME GJS game example (vixalien) — practical GJS+GTK pattern ref
|`refs/map-editor/` — PixelRPG map editor; Excalibur + Tiled GJS showcase

### GNOME app samples
|`refs/showtime/` — GNOME video player (Gtk4 + gtk4paintablesink) — reference for `@gjsify/video` VideoBridge
|`refs/gamepad-mirror/` — Manette 0.2 gamepad reference app

### Other
`refs/gjs/`(internals) | `refs/stream-http/`(HTTP via streams) | `refs/troll/`(GJS utils) | `refs/crypto-browserify/`(orchestrator → sub-pkgs: `refs/{browserify-cipher,browserify-sign,create-ecdh,create-hash,create-hmac,diffie-hellman,hash-base,pbkdf2,public-encrypt,randombytes,randomfill}`) | `refs/readable-stream/`(edge cases) | `refs/ungap-structured-clone/`(→`packages/gjs/utils/src/structured-clone.ts`)

### Adwaita/GTK design
|`refs/adwaita-web/` Web Framework based on GTK4/Libadwaita — CSS/component ref for `@gjsify/adwaita-web`
|`refs/libadwaita/` canonical CSS colors, radii, widget styles
|`refs/adwaita-fonts/` Adwaita Sans/Mono (SIL OFL) — sources packaged into `@gjsify/adwaita-fonts`
|`refs/adwaita-icon-theme/` GNOME symbolic icons (CC0/LGPLv3) — sources packaged into `@gjsify/adwaita-icons`
|`refs/app-mockups/` GNOME mockup PNGs/SVGs — visual ref
|`refs/app-icon-requests/` GNOME app icon requests — supplemental visual ref

### Build/tooling
`refs/astro/`(website ref) | `refs/deepkit/`(type compiler) | `refs/gjsify-vite/`(`examples/gtk/three-geometry-shapes/refs/gjsify-vite/`, Vite plugins for GJS)

## npm packages — reimplement in TS

npm pkgs cause GJS problems (legacy CJS, missing-globals-at-load, circular deps, `"browser"` field). Use as **references only** — rewrite in TS with `@gjsify/*` imports.

## CJS-ESM Interop (GJS)

Problem: esbuild GJS (`esm`+`neutral`) wraps ESM with `__toCommonJS` → namespace object, not constructor. Breaks `util.inherits(Child, require('stream'))`.

|**Fix 1 `__toCommonJS` patch (auto)**: `esbuild-plugin-gjsify/src/app/gjs.ts` `onEnd` unwraps ESM with only default export. No action needed.
|**Fix 2 `cjs-compat.cjs` (manual)**: for pkgs with BOTH named+default exports where `require()` must return constructor. Symptoms: `super constructor to "inherits" must have prototype` / `X is not a function` / `X.call is not a function`. **Needed:** `stream`, `events`. **Not needed:** `buffer`, `util`, `http`, `path` (plain objects).
```js
// packages/node/<name>/cjs-compat.cjs
const mod = require('./lib/esm/index.js');
module.exports = mod.default || mod;
```
Add `"require":"./cjs-compat.cjs"` to package.json `exports` BEFORE `"default"`.

## Native Extensions (Vala)

Vala → Meson → shared lib + GIR typelib → `gi://` import. Example: `packages/framework/webgl/`. Prefer TS; Vala only for C-level access.

### DOM bridge examples

```ts
import { Canvas2DBridge } from '@gjsify/canvas2d';
const w = new Canvas2DBridge(); w.installGlobals();
w.onReady((canvas, ctx) => { ctx.fillRect(0,0,100,100); }); window.set_child(w);

import { WebGLBridge } from '@gjsify/webgl';
const w = new WebGLBridge(); w.installGlobals();
w.onReady((canvas, gl) => { gl.clearColor(0,0,0,1); }); window.set_child(w);

import { IFrameBridge } from '@gjsify/iframe';
const w = new IFrameBridge();
w.onReady(iframe => iframe.contentWindow?.addEventListener('message', handler));
w.iframeElement.srcdoc = '<h1>Hello</h1>'; window.set_child(w);

import { VideoBridge } from '@gjsify/video';
const v = new VideoBridge();
v.onReady(async video => { video.srcObject = await navigator.mediaDevices.getUserMedia({video:true}); });
window.set_child(v);
```

### Prebuilds

Native libs in `prebuilds/linux-<arch>/` (`.so`+`.typelib`). `package.json`: `"files":["lib","prebuilds"]`, `"gjsify":{"prebuilds":"prebuilds"}`. CLI auto-sets `LD_LIBRARY_PATH`/`GI_TYPELIB_PATH`: `gjsify run dist/gjs.js` | `gjsify info [file]` (`--export` for eval). Built by `.github/workflows/prebuilds.yml` (x86_64+aarch64, Fedora). Local: `yarn build:prebuilds`.

**gi:// ordering:** `GIRepository.prepend_search_path()` must run before `gi://Foo` resolves. Static `gi://` imports resolve in ESM Linking (before code). Use `gjsify run` or two-file loader (loader calls prepend_search_path, then `await import('./bundle.js')`).

## Testing

### Framework `@gjsify/unit`

```ts
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

1. **Cross-platform pkgs:** `node:` prefix for all Node imports (value+type). **Never import `@gjsify/*` directly** (except `@gjsify/unit`). Aliased Web pkgs: bare specifier from `ALIASES_WEB_FOR_{GJS,NODE}`.
2. **GJS-only pkgs** (dom-elements, webgl): import `@gjsify/*` directly. No aliases, no `test:node`.
3. Node tests = correctness of test; GJS tests = our impl. Both must pass.
4. Common `*.spec.ts`: both platforms, no `@girs/*`. Platform-specific `*.gjs.spec.ts` / `on('Gjs')`: minimal.
5. Layout: `src/index.ts`(impl) | `src/*.spec.ts` | `src/test.mts`(entry).
6. **Never weaken tests** — fix impl. No platform guards.
7. **`/register` side-effect tests in dedicated file:** Tests verifying globalThis wiring (`globalThis.FontFace`, `globalThis.__gjsify_globalEventTarget`) need `import '<pkg>/register'` → put in `register.spec.ts`, NOT common spec. Reason: even pure-JS global — `/register` pulls GTK/Cairo via import chain, crashes on Node. Common spec tests class/value via named import; `register.spec.ts` tests wiring (GJS-only, wrap in `on('Gjs',...)`). Add to `test.mts` as named suite. Applies only to GJS-only packages. Cross-platform: `/register` test → `.gjs.spec.ts`. Example: `packages/dom/dom-elements/src/register.spec.ts`.

### Regression tests from examples

Real-world examples uncovering bugs (GC, missing globals, CJS-ESM, MainLoop) → always add targeted test to relevant `*.spec.ts`. Examples = integration validation; regression tests = permanent safety net.

### Test sources

Rewrite in `@gjsify/unit` with bare specifiers. Never copy verbatim. Select: core behavior, GNOME-relevant edge cases, errors, cross-platform. Skip: V8 internals, native addons, stubbed features.

### Deno Web API refs — `refs/deno/`

`ext/web/`{`06_streams`, `14_compression`, `02_event`(Event,EventTarget,CustomEvent,ErrorEvent,CloseEvent,MessageEvent), `03_abort_signal`, `08_text_encoding`, `09_file,10_filereader`(Blob,File,FileReader), `15_performance`, `02_structured_clone,13_message_port,16_image_data,01_broadcast_channel,01_urlpattern`} | `ext/fetch/`{`20-26`(fetch,Headers,Request,Response,FormData), `27_eventsource`} | `ext/crypto/00_crypto`(SubtleCrypto,CryptoKey,getRandomValues,randomUUID) | `ext/{websocket/01,webstorage/01,cache/01,image/01}`

### Integration tests — `tests/integration/`

Sibling to `tests/e2e/`/`tests/dom/`. Runs curated upstream tests from npm packages against `@gjsify/*` — validates pillars end-to-end in a real consumer (not itself a pillar).

Layout: `tests/integration/<pkg>/` → `@gjsify/integration-<pkg>`, `private:true`, scripts `prebuild:test:{gjs,node}` (→ fixtures), `build:test:{gjs,node}` (→ `dist/test.{gjs,node}.mjs`), `test:{gjs,node}`, `test`. Specs `src/*.spec.ts`, aggregator `src/test.mts`. Fixtures copied at prebuild from npm devDep → `./fixtures/` (gitignored), loaded via `new URL('../fixtures/<file>', import.meta.url)` + `fileURLToPath` — NOT bundled, NOT committed. See `tests/integration/README.md`.

**Port convention — manual rewrite to `@gjsify/unit`.** Each upstream file → `<name>.spec.ts`:
```ts
// SPDX-License-Identifier: MIT
// Ported from refs/<pkg>/test/<name>.js
// Original: Copyright (c) <holder>. <license>.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
```
tape→gjsify-unit: `t.equal`→`expect().toBe` | `t.deepEqual`→`toStrictEqual` | `t.ok/notOk`→`toBeTruthy/Falsy` | `t.error(err)`→`expect(err).toBeFalsy()` | `t.throws(fn)`→`expect(fn).toThrow()` | `t.plan/t.end` omitted | callback cleanup → `new Promise((res,rej)=>op(err=>err?rej(err):res()))`. **Never weaken.** Failure → root-cause fix. Exception: pre-known out-of-scope gap → wrap suite with `on('Node.js', async ()=>{…})` + document in file header + STATUS.md `## Integration Test Coverage`. Skips temporary.

No `@gjsify/test-compat` shim today (manual rewrite keeps code idiomatic). Revisit when 2nd dialect (mocha+expect.js for socket.io) is added.

Scripts: `yarn test:integration[:node|:gjs]`. NOT part of `yarn test` — opt-in to avoid blocking PRs on tracked gaps.

**Current suites:**

| Suite | Source | Node | GJS | Pillars exercised |
|---|---|---|---|---|
| `tests/integration/webtorrent/` | `refs/webtorrent/test/` — 7 ports | 185/185 | 185/185 | fs (URL paths), stream, events, buffer, crypto, esbuild `require` condition fix, `random-access-file` alias |
| `tests/integration/socket.io/` | `refs/socket.io/packages/socket.io/test/` — 3 ports | 20/20 | 20/20 | http, fetch (raw body), events (enumerable proto), IncomingMessage close semantics, polling transport |
| `tests/integration/streamx/` | `refs/streamx/test/` — 6 ports + `throughput.spec.ts` | 155/155 | 156/156 | stream, queueMicrotask injection (fixes 0 B/s regression) |
| `tests/integration/autobahn/` | crossbario fuzzingserver (non-port) | — | 240 OK / 4 NON-STRICT / 3 INFO / 0 FAILED × 2 agents | websocket, ws wrapper, RFC 6455 |

**Protocol-fuzzing integration** (`tests/integration/autobahn/`, non-port): runs [crossbario/autobahn-testsuite](https://github.com/crossbario/autobahn-testsuite) Python fuzzingserver in Podman/Docker, points Gjs drivers at it. Thin echo-client iterating `getCaseCount`→`runCase`→`updateReports` (pattern from `refs/ws/test/autobahn.js`). Validation: diff `reports/output/clients/index.json` vs `reports/baseline/<agent>.json` via `scripts/validate-reports.mjs` (regressions/improvements/missing per agent). Two drivers: `@gjsify/websocket` (W3C over Soup) + `@gjsify/ws` (npm `ws` wrapper) — isolates wrapper-layer from transport-layer bugs. Runtime: `scripts/autobahn-up.mjs`/`down.mjs` — `CONTAINER_RUNTIME=podman|docker` overrides auto-detection (prefers Podman; Fedora default). Baselines under `reports/baseline/` are committed; regressions surface in PR diffs. Not wired into CI yet (Podman-in-CI needs privileged containers).

## Package convention

`packages/node/<name>/` → `@gjsify/<name>`, v0.1.15, `"type":"module"` | exports `./lib/esm/index.js` + `./lib/esm/register.js` (if globals) | `sideEffects:["./lib/esm/register.js"]` pinned to register-only | scripts: `build:gjsify|build:types|build:test:{gjs,node}|test|test:{gjs,node}` | deps: `@girs/*`; devDep `@gjsify/unit`; workspace deps `workspace:^`

Layout: `src/index.ts` (pure named exports) | `src/register.ts` (side-effect globals) | `src/*.spec.ts` | `src/test.mts` (entry, imports `@gjsify/node-globals/register` + feature-specific `<pkg>/register`). Full rules: Tree-shakeable Globals section.

**Framework packages** (`packages/framework/<name>/`): flat name `@gjsify/<name>` (NOT `@gjsify/framework-<name>`), composition-first. **No `/register`, no `globalThis.*` writes, no top-level side effects.** Pure named exports. Compose standard DOM/GTK APIs; never register browser globals (Web/DOM pillars' job). A framework pkg needing a global imports `@gjsify/<web-or-dom-pkg>/register` explicitly. Minimal: `src/index.ts` + `package.json` + `tsconfig.json`.

Shared utils: `@gjsify/utils` (`packages/gjs/utils/`). Check before duplicating; only extract when 2nd package needs it.

**`@gjsify/stream` direct imports** in internal modules/test files needing non-standard exports (`Stream_`, `makeCallable`, internal state types) are allowed. All public code (examples, showcases, cross-package APIs) must use `node:stream`.

## Example convention (GTK + browser)

Dual-target with Adwaita UI:

```
examples/gtk/<name>/src/
  <shared>.ts        # Platform-agnostic logic + constants
  gjs/               # Adw.Application, GObject window, .blp
  browser/           # @gjsify/adwaita-web UI, index.html, .css
  assets/            # Shared (textures, fonts)
```

Scripts: `build:gjs`→`gjsify build src/gjs/gjs.ts --app gjs` | `build:browser`→`gjsify build src/browser/browser.ts --app browser` | `start`→`gjsify run dist/gjs.js` | `start:browser`→`http-server dist`

Constants (dropdowns, defaults) in shared `.ts` — both `gjs/` + `browser/` import. No duplication in HTML.

## Showcase — `gjsify showcase`

Polished examples under `showcases/`. Published npm packages (`@gjsify/example-{dom,node}-<name>`), CLI deps. Self-contained + independently runnable (`gjsify showcase <name>`, `yarn start[:browser]`).

Rules: CLI executable via `gjsify showcase <name>` | browser version embedded in website (imports as npm package: `import { mount } from '@gjsify/example-dom-three-postprocessing-pixel/browser'`) | full npm package — export browser entry + assets + package.json via `exports`, never reference internals via relative paths | self-contained | production-quality, not experiments.

Exports pattern:
```json
"exports": {
  "./browser": "./src/browser/browser.ts",
  "./three-demo": "./src/three-demo.ts",
  "./assets/*": "./src/assets/*",
  "./package.json": "./package.json"
}
```
Assets via `require.resolve('@gjsify/example-dom-<name>/assets/<file>')`.

`examples/` → private (`"private":true`, no version, not published, not in CLI) — dev/test only.

Discovery: `gjsify showcase` lists; `<name>` runs `check` then shared `runGjsBundle()`. Dynamic scan of CLI's `package.json` for `@gjsify/example-*` deps, `require.resolve` each, read `main`.

**Adding a showcase:** (1) `showcases/{dom,node}/<name>/` named `@gjsify/example-{dom,node}-<name>` (2) `"files":["dist"]`, keep version, no `"private"` (3) export browser entry + assets + package.json (4) all deps → devDependencies except `@gjsify/webgl` (5) add as dep in `packages/infra/cli/package.json` (6) rebuild CLI.

**Dep rule:** esbuild-bundled → `devDependencies`. Only packages with native prebuilds needed by `gjsify run` at runtime (only `@gjsify/webgl` today) stay in `dependencies`.

## Implementation workflow (TDD)

1. Study API: `refs/node/lib/<name>.js`
2. Port tests to `*.spec.ts` via `@gjsify/unit`
3. `yarn test:node` — verify tests correct
4. `yarn test:gjs` — expect failures → fix impl
5. Implement with `@girs/*`, consult `refs/{deno,bun,quickjs,workerd}/`
6. Iterate until both pass
7. Full: `yarn install && yarn clear && yarn build && yarn check && yarn test`

## Type Safety

`unknown` over `any` | `as unknown as T` for unrelated casts | Error callbacks: `NodeJS.ErrnoException | null` | Validate: `yarn check`

## Source Attribution

**Templates** — **A** (direct adaptation): `SPDX-License-Identifier: MIT` + `Adapted from <project> (<refs/path>). Copyright (c) <year> <holder>` + `Modifications: <brief>` | **B** (API reimpl): `Reference: Node.js lib/<name>.js[, refs/deno/...]` + `Reimplemented for GJS using <lib>` | **C** (ported tests): `Ported from refs/<project>/test/...` + `Original: MIT, <holder>` | **D** (spec algorithm): `Implements <algo> per <spec> (<RFC>)` + `Reference: refs/<project>/path. Copyright (c) <holder>. <license>.`

Every impl → A or B. Every ported test → C. Original: `// <Module> for GJS — original implementation using <library>`. Use `refs/` paths over URLs.

### Copyright (refs/<pkg> → holder, license)

|node,node-test → Node.js contributors, MIT |deno → 2018-2026 Deno authors, MIT |bun → Oven, MIT |quickjs → Bellard+Gordon, MIT |workerd → Cloudflare, Apache 2.0 |edgejs → Wasmer, MIT |crypto-browserify,browserify-cipher,create-hash,create-hmac,randombytes,randomfill → crypto-browserify contributors, MIT |browserify-sign,diffie-hellman,public-encrypt → Calvin Metcalf, ISC/MIT |create-ecdh → createECDH contributors, MIT |hash-base → Kirill Fomichev, MIT |pbkdf2 → Daniel Cousens, MIT |readable-stream → Node.js contributors, MIT |undici → Matteo Collina+contributors, MIT |gjs → GNOME contributors, MIT/LGPLv2+ |headless-gl → Mikola Lysenko, BSD-2-Clause |webgl → Khronos Group, MIT |three → three.js authors, MIT |libepoxy → Intel, MIT |node-gst-webrtc → Ratchanan Srirattanamet, ISC |node-datachannel → Murat Doğan, MPL 2.0 |libdatachannel → Paul-Louis Ageneau, MPL 2.0 |webkit → WebKit contributors, LGPLv2 / BSD-2-Clause |epiphany → GNOME contributors, GPLv3 |webrtc-samples → WebRTC authors, BSD-3-Clause |node-canvas → Automattic, MIT |llrt → Amazon, Apache 2.0 |happy-dom → David Ortner, MIT |jsdom → Elijah Insua, MIT |wpt → web-platform-tests contributors, 3-Clause BSD |ungap-structured-clone → Andrea Giammarchi, ISC |ws → WebSocket/IO contributors, MIT |socket.io → Automattic, MIT |streamx → Mathias Buus, MIT |webtorrent,webtorrent-desktop → WebTorrent LLC, MIT |excalibur → Excalibur.js authors, BSD-2-Clause |excalibur-tiled → Excalibur.js authors, BSD-2-Clause |peachy → vixalien, MIT |map-editor → PixelRPG, MIT |gamepad-mirror → vendillah, GPLv3 |showtime → GNOME contributors, GPLv3 |adwaita-web → mclellac, MIT |libadwaita → GNOME contributors, LGPLv2.1+ |adwaita-fonts → Inter/Iosevka/GNOME, SIL OFL 1.1 |adwaita-icon-theme → GNOME contributors, CC0-1.0 / LGPLv3 |app-mockups,app-icon-requests → GNOME contributors, CC-BY-SA |node-fetch → MIT |event-target-shim → Toru Nagashima, MIT |gjs-require → Andrea Giammarchi, ISC

## STATUS.md & CHANGELOG.md Maintenance

**STATUS.md always reflects current codebase state.** Feature lands / bug fixed / test added / workaround discovered / deferred item identified → update STATUS.md in the same commit. Never leave drift.

Update when: adding/expanding tests (counts) | fixing impls (Working/Missing) | completing stubs (move category). Keep Metrics current. Add GJS/SpiderMonkey workarounds to "Upstream GJS Patch Candidates".

**Track deferred work in dedicated `Open TODOs` section.** Every "out of scope" / "follow-up" / "later" note from PR description / plan file / commit message must have a corresponding entry — otherwise forgotten. Resolved TODO → move to `### Completed` list (or delete if trivial).

**Changelog entries ONLY in CHANGELOG.md.** STATUS.md = current state; CHANGELOG.md = what changed + when. Do NOT add dated "Latest:" lines, changelog highlights, or per-session summaries to STATUS.md. Update CHANGELOG.md after work sessions with dated entries describing what changed and why.

## Constraints

Target: GJS 1.86.0 / SpiderMonkey 128 (ES2024) / esbuild `firefox128` | ESM-only | GNOME libs + standard JS only | Tests pass on both Node + GJS | Do NOT modify `refs/`

## JS Feature Availability

### SM128 (GJS 1.84–1.86, current) — ES2024

**Available:** Object/Map.groupBy | Promise.withResolvers | Set methods(intersection,union,difference,symmetricDifference,isSubsetOf,isSupersetOf,isDisjointFrom) | Array.fromAsync | structuredClone | SharedArrayBuffer | Intl.Segmenter | globalThis | ??/?. | ??=/||=/&&= | top-level await | private/static fields | WeakRef | FinalizationRegistry

**NOT available:** Error.captureStackTrace (polyfill: `packages/gjs/utils/src/error.ts`) | Error.stackTraceLimit (typeof guard) | queueMicrotask (use `Promise.resolve().then()`) | Float16Array, Math.f16round() | Iterator helpers | Uint8Array.{fromBase64,toBase64,fromHex,toHex} | RegExp.escape() | Promise.try() | JSON.rawJSON/isRawJSON | Intl.DurationFormat | Math.sumPrecise | Atomics.pause | Error.isError | Temporal | `import...with{type:"json"}`

### SM140 (GJS 1.85.2+/1.87+, upcoming)

All SM128-missing features become available. Notable: Error.captureStackTrace native (drop polyfill) | Temporal | Iterator helpers | `import...with{type:"json"}`

## Writing agent context files

Pipe-delimited | single-line directives | strip prose | abbreviated keys (req,opt,str,int,bool,len,min,max,def) | flatten with brace expansion | "Prefer retrieval-led reasoning" preamble. Compression: 70–80% token reduction | preserve actionable info + structural boundaries | keep non-obvious code examples | never compress error messages / edge case docs.
