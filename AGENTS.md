# AGENTS.md — gjsify

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning — consult `refs/` submodules and `@girs/*` types before pre-trained knowledge.

Node.js/Web/DOM API + Framework for GJS (GNOME JS). npm-workspaces monorepo, v0.4.42, ESM-only, GNOME libs. Bootstraps via the committed `packages/infra/cli/dist/cli.gjs.mjs` GJS bundle — `gjsify install --immutable` is the supported install path (no yarn / no Node-only npm CLI required at runtime, see Phase D.7d). Four equal pillars: **Node.js** `packages/node/` (42 + 1 meta) | **Web** `packages/web/` (21 + 1 meta) | **DOM** `packages/dom/` (2) | **Framework** `packages/framework/` (6 bridge pkgs). `packages/infra/` + `packages/gjs/` = supporting infra.

## Governance — non-negotiable

|doc: update AGENTS.md immediately on any architectural decision (package boundaries, API patterns, build, deps, cross-cutting) — never leave drift between sessions
|status: update STATUS.md in EVERY PR/commit that changes code or tests — new/promoted packages, test counts, Completed items, Metrics, Open TODOs; STATUS.md drift = blocked PR
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
| process | GLib, GjsifyTerminal | Full | extends EventEmitter, env, cwd, platform, nextTick (batched GLib-idle delivery to keep GTK input responsive); stdin/stdout/stderr as ProcessReadStream/ProcessWriteStream (isTTY, setRawMode, columns/rows via @gjsify/terminal-native when installed, env/GLib fallback); SIGWINCH→stdout/stderr 'resize' event |
| querystring | — | Full | parse/stringify |
| readline | — | Full | Interface, createInterface, question, prompt, async iterator |
| sqlite | Gda 6.0 | Partial | node:sqlite — DatabaseSync, StatementSync via `gi://Gda?version=6.0` (libgda SQLite provider). URL + Uint8Array path args, param binding, typed readers, error codes |
| stream | — | Full | Readable (protected `_autoClose` hook), Writable, Duplex, Transform, PassThrough, pipe/pipeline/finished, FIFO write-ordering across drain re-entry, serialized concurrent I/O |
| string_decoder | — | Full | UTF-8, Base64, hex, streaming |
| sys | — | Full | Deprecated alias for util |
| timers | — | Full | setTimeout/setInterval/setImmediate + promises (GLib-source-safe: replaces setTimeout/setInterval with `GLib.timeout_add` to avoid SM-GC race on GLib.Source BoxedInstances) |
| tls | Gio, @gjsify/tls-native | Full | TLSSocket via Gio.TlsClientConnection (incl. ALPN, mTLS, custom CA, RFC 6125 hostname matching, custom `checkServerIdentity`, SNI via real-ClientHello-peek), OCSP-response parsing via the optional `@gjsify/tls-native` Phase 1 (`parseOcspResponse` / `OcspCertStatus` / `OcspResponseStatus` / `hasOcspSupport()`), Phase 2 (v0.4.42 Path A, functional): `TLSSocket.getFinished()` / `getPeerFinished()` / `getSession()` / `setSession()` / `isSessionReused()` + `'session'` event + `{session}` option on `tls.connect()` + `TlsChannelBindingType` + `hasTlsSessionAccess()` gate — all backed by real `gnutls_session_t`-rooted GnuTLS calls via the C shim. Auto-selects `tls-unique` (RFC 5929, TLS ≤1.2) vs `tls-exporter` (RFC 9266, TLS 1.3) per negotiated version. `hasTlsSessionAccess()` returns `true` on glib-networking GnuTLS backends (Fedora 43+ default); a hypothetical `GIO_USE_TLS=openssl` backend degrades to the `undefined`/`false`/no-op contract Node uses on a build without session support |
| tls-native | GjsifyTls (Vala + C) | Partial | **Optional native Vala+C prebuild.** Phase 1 (`OcspResponseInfo` + `Tls.parse_ocsp_response`): RFC 6960 OCSPResponse DER parser via `gnutls_ocsp_resp_*` (the OCSP API gap in Vala 0.56's `gnutls.vapi` is filled by sibling `gnutls-ocsp.vapi`). Phase 2 (`SessionAccess` + `ChannelBindingType` + `SessionAccessError`, v0.4.42 Path A): wraps a `Gio.TlsConnection` + exposes `is_supported()` / `for_connection()` / `is_session_reused()` / `get_session_data()` / `set_session_data()` / `get_channel_binding()` / `get_finished()` / `get_peer_finished()` / `get_negotiated_protocol_version()`. Methods delegate to the C shim `src/c/gjsify-tls-private.{c,h}` which extracts `gnutls_session_t` from `GTlsConnectionGnutls`'s private struct via the public `g_type_instance_get_private` + a runtime `g_type_from_name("GTlsConnectionGnutls")` lookup. Struct layout vendored from `refs/glib-networking/tls/gnutls/gtlsconnection-gnutls.c` (4-pointer `{credentials, session, interaction_id, cancellable}`, stable across glib-networking 2.74–2.84 — covers Fedora 43 + 44). Force-loads the dynamic GIO TLS module via `g_tls_backend_get_client_connection_type()` so the type registers even before any connection is instantiated. Sibling vapi `gnutls-session.vapi` adds the missing `gnutls_session_channel_binding` declaration + `ChannelBinding` enum (`TLS_UNIQUE`/`TLS_SERVER_END_POINT`/`TLS_EXPORTER`). Loaded via synchronous `imports.gi.GjsifyTls` with try/catch — safe when typelib not installed. TS wrappers: `nativeTls`, `hasNativeTls()`, `parseOcspResponse()`, `hasTlsSessionAccess()`, `createSessionAccess()`. Consumed by `@gjsify/tls`. Ships as `.so`+`.gir`+`.typelib` in `prebuilds/linux-{x86_64,aarch64,ppc64,s390x,riscv64}/` |
| terminal-native | GjsifyTerminal (Vala) | Full | **Optional native Vala prebuild.** `GjsifyTerminal.Terminal`: `is_tty(fd)→bool` (Posix.isatty), `get_size(fd)→{rows,cols}` (ioctl TIOCGWINSZ), `set_raw_mode(fd,enable)→bool` (termios). `GjsifyTerminal.ResizeWatcher`: `resized(rows,cols)` signal on SIGWINCH. Loaded via synchronous `imports.gi.GjsifyTerminal` with try/catch — safe when typelib not installed. Ships as `.so`+`.typelib` prebuild in `prebuilds/linux-x86_64/`. TS wrapper: `nativeTerminal`, `hasNativeTerminal()`. Consumed by `@gjsify/tty` + `@gjsify/process` for native terminal support when installed |
| tty | GjsifyTerminal | Full | ReadStream/WriteStream, ANSI escapes; isatty via Posix.isatty or GLib fallback; getWindowSize via ioctl TIOCGWINSZ or env/default; setRawMode via termios — all through @gjsify/terminal-native optional native bridge |
| url | GLib | Full | URL (with static `URL.createObjectURL` / `URL.revokeObjectURL` over `Blob._tmpPath` + `file://`), URLSearchParams via GLib.Uri |
| util | — | Full | inspect, format, promisify, types |
| v8 | — | Stub | getHeapStatistics, serialize/deserialize (JSON) |
| vm | — | Partial | runInThisContext (eval), runInNewContext (Function+sandbox), Script, compileFunction. No realm isolation |
| worker_threads | @gjsify/sab-native, @gjsify/message-channel | Partial | MessageChannel/MessagePort/BroadcastChannel with structured clone; **MessagePort W3C surface composed over `@gjsify/message-channel`** (single source of truth for `addEventListener`/`onmessage`/`start`/`close`/queue, while the wrapper extends EventEmitter for `@types/node` compat); Worker via Gio.Subprocess (file-based resolution); transferList for ArrayBuffer (in-process, zero-copy via SM140 transfer), MessagePort (in-process channel hand-off + **cross-process subprocess IPC via `SubprocessPortTransport`** routing `{__msgport, op}` JSON lines over the existing worker stdin/stdout pipe), SharedBuffer (cross-process via memfd + SCM_RIGHTS over inherited fd 3). `SharedArrayBuffer` constructor still gated by upstream GJS opt-in — use `@gjsify/sab-native`'s `SharedBuffer` as substitute (method-accessor API + cross-process atomics via Linux futex) |
| sab-native | Linux libc (memfd, futex, SCM_RIGHTS) | Native | **Optional Vala bridge** providing cross-process shared memory + atomics for `@gjsify/worker_threads`. `SharedBuffer` (memfd_create + mmap(MAP_SHARED) with typed accessors + GLib.Bytes-wrapped reads + **`viewBytes()` / `toBuffer<T>()` duck-type entry for `Buffer.from(sharedBuffer)`** + SEQ_CST `__atomic_*` + Linux futex wait/notify), `FdChannel` (SOCK_SEQPACKET + SCM_RIGHTS for fd-transfer over an inherited side-channel). Lazy-loaded via `imports.gi.GjsifySabNative` — `hasNativeSab()` predicate. Ships as `.so`+`.gir`+`.typelib` in prebuilds/linux-{x86_64,aarch64,ppc64,s390x,riscv64}/ |
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
| message-channel | — | MessageChannel, MessagePort (W3C, EventTarget-based, transport-pluggable). Stock GJS exposes neither — needed for browser-compat code. Pluggable transport hook backs `@gjsify/iframe` WebKit bridge + (future) `@gjsify/worker_threads` cross-process workers |
| formdata | — | FormData, File |
| streams | — | ReadableStream, WritableStream, TransformStream, TextEncoder/DecoderStream |
| compression-streams | Gio | CompressionStream, DecompressionStream |
| webcrypto | GLib | crypto.subtle, getRandomValues, randomUUID |
| eventsource | Soup 3.0 | EventSource (SSE) |
| websocket | Soup 3.0 | WebSocket, MessageEvent, CloseEvent. NUL-byte-safe text frames (send via `send_message(TEXT, GLib.Bytes)` — Soup's `send_text` truncates at `\0`). RFC 6455 fuzz-validated via Autobahn |
| webstorage | Gio | localStorage, sessionStorage |
| webassembly | — | Promise-API polyfill — `compile`, `compileStreaming`, `instantiate`, `instantiateStreaming`, `validate` wrap SpiderMonkey's working synchronous `new WebAssembly.{Module,Instance}` constructors. Granular `/register/promise` subpath. Auto-injected by `--globals auto` via new `WebAssembly.<method>` METHOD_MARKERS. |
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
| iframe | WebKit 6.0 | HTMLIFrameElement, IFrameBridge→WebKit.WebView, postMessage bridge, navigation (loadUri / loadHtml / goBack / goForward / reload + canGoBack/canGoForward) |

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

## Build — Rolldown, platform plugins

Targets: **GJS** `--app gjs` (`assert`→`@gjsify/assert`, externals `gi://*`+`cairo`+`system`+`gettext`, `firefox140`) | **Node** `--app node` (`@gjsify/process`→`process`, `node24`) | **Browser** `--app browser` (`esnext`)

**Built-in defaults are not user-config.** Per-app externals (`gi://*`, `cairo`, `system`, `gettext` for `--app gjs`; `node-datachannel` plus the `EXTERNALS_NODE` set for `--app node`) and the compile target (`firefox140` for gjs, `node24` for node, `esnext` for browser) are owned authoritatively by the app orchestrator. `bundler.external` from `package.json#gjsify` / `.gjsifyrc.*` is appended to that hard-coded set, never replaces it; `bundler.transform.target` overrides only when the user wants to deviate. Consequence: redundant entries like `external: ["^gi:", "cairo", "system", "gettext"]` or `transform.target: "firefox140"` in user config are dead weight — they should be omitted. Note: `^gi:` as an exact-string entry never matches anything (`exactExternal.includes(id)` checks for literal equality, while real specifiers look like `gi://Gtk?version=4.0` and are caught by the prefix predicate). Set externals only for *additional* unbundled deps (e.g. an unbundled CLI plugin).

Engine: **Rolldown** (Vite 8's production bundler). The orchestrator returns a `{ options, plugins }` config bundle that the CLI composes into `rolldown(...)` + `.write()`. Same `gjsify build --app …` surface as before; Rollup-shaped plugins under the hood that also run under Vite for sister GJS apps.

Key files: `packages/infra/rolldown-plugin-gjsify/src/app/{gjs,node,browser}.ts` | `.../utils/scan-globals.ts` | `.../utils/auto-globals.ts` | `packages/infra/resolve-npm/lib/{index,globals-map}.mjs`

**Deepkit** (`@gjsify/rolldown-plugin-deepkit`): TypeScript runtime reflection via `@deepkit/type-compiler`. Default: `reflection: false` (opt-in). Set `typescript.reflection: true` in `.gjsifyrc.js` to enable. Hook: `transform(code, id)` with `order: 'pre'`. Keep disabled unless the project explicitly uses Deepkit runtime types — it transforms TypeScript `extends` method definitions into invalid `function extends()` syntax that breaks the parser.

**GJS target process bootstrap** (`packages/infra/rolldown-plugin-gjsify/src/plugins/process-stub.ts`): The GJS target always prepends a minimal synchronous `globalThis.process` stub via a `renderChunk(order:'post')` hook. This runs before any bundled module code. Required because packages like `glob` and `path-scurry` access `globalThis.process.platform` at top-level during `__esm` lazy init, before any import-triggered side effect can fire. The full `@gjsify/process` implementation is wired up afterwards by `--globals auto`. User banners from `.gjsifyrc.js` are composed after the process stub; a leading `#!shebang` is hoisted to byte 0 (SpiderMonkey 128+ rejects `#` anywhere else).

**Blueprint** (`@gjsify/vite-plugin-blueprint`): `.blp` → XML string via `blueprint-compiler`. GJS+browser. `import T from './window.blp'` → string. Types: add `@gjsify/vite-plugin-blueprint/types` to tsconfig. Same plugin runs under Vite (sister apps) and Rolldown (CLI).

**Vite-plugin track** (`@gjsify/vite-plugin-gjsify`): the dev-side mirror of `gjsify build --app browser`. A dual-target web app (the `examples/dom/*` / browser-showcase shape) builds for production with `gjsify build --app browser`, but develops under Vite (dev server + HMR). `gjsifyBrowser()` is the preset that makes the two match — spread it into your Vite config:
```ts
// vite.config.ts
import { defineConfig } from 'vite';
import { gjsifyBrowser } from '@gjsify/vite-plugin-gjsify';
export default defineConfig({ plugins: [...gjsifyBrowser({ reflection: false })] });
```
It composes the same browser-target pieces as `app/browser.ts`: `gjsImportsEmptyPlugin()` (`@girs/*`/`gi://` → empty module — these leak transitively via `@gjsify/unit` etc.), `blueprintPlugin()`, opt-in `deepkitPlugin({ reflection })`, plus a Vite `config()` hook that sets the browser polyfill aliases (`process`/`assert` → `@gjsify/empty`/`@gjsify/assert`, mergeable via `options.aliases`), `resolve.conditions: ['import','browser']`, `resolve.mainFields: ['browser','module','main']`, `define: { global/window: 'globalThis' }`, `build.target: 'esnext'`, and `optimizeDeps.exclude: ['@gjsify/unit', …]` (Vite's esbuild prebundle can't resolve `gi://`). Options: `{ reflection?, aliases?, optimizeDepsExclude? }`. **It does NOT include `cssAsStringPlugin`** — a browser app wants real CSS through Vite's native pipeline (HMR/extraction/PostCSS); css-as-string is a GJS/GTK build concern only. So the preset = Vite-dev parity with `--app browser`, minus css-as-string. Uses Vite's native `resolve.alias` instead of the CLI's (unexported) `aliasPlugin`.

**CSS** (`@gjsify/rolldown-plugin-gjsify/plugins/css-as-string`): `.css` → JS string default export via a `load` hook (filter `/\.css$/`). Rolldown removed its experimental CSS bundling, so this plugin reads the file with lightningcss `bundleAsync` and emits `export default ${JSON.stringify(css)}` — bypassing Rolldown's CSS classification entirely. All targets. `import css from './app.css'` → string for `Gtk.CssProvider.load_from_string()`. **CSS `@import` resolution** is built in (lightningcss bundling). **GTK4 CSS lowering**: `--app gjs` passes `targets: { firefox: 60 << 16 }`, so nesting / modern selectors are flattened to the subset GTK4's CSS engine accepts. Browser/Node targets keep CSS pristine (no targets). Plugin opts: `cssAsStringPlugin({ targets, bundle })` — set `bundle:false` to keep raw `@import` strings (rare).

**Asset loaders** (`gjsify.loaders` config, `@gjsify/rolldown-plugin-gjsify/plugins/text-loader`): extension → loader-kind map for files Rolldown does not classify natively. Lives at the top level of the gjsify config (not under `bundler`) so it is not leaked to Rolldown's raw options. Two kinds: `'text'` (file contents as JS string default export) and `'dataurl'` (`data:<mime>;base64,<b64>` string, MIME from extension: `.png` → `image/png`, `.jpg/.jpeg` → `image/jpeg`, `.gif` → `image/gif`, `.svg` → `image/svg+xml`, `.webp` → `image/webp`, `.wasm` → `application/wasm`, else `application/octet-stream`). Example: `"loaders": { ".glsl": "text", ".ui": "text", ".png": "dataurl" }`. `dataurl` is the right choice for Excalibur's `ImageSource` (expects a `data:` URL string, not a separate asset file). Replaces `esbuild.loader: { ... }` from the pre-Rolldown era.

**`bundler.define` alias**: Top-level `bundler.define` (a common mistake when flat-renaming `esbuild: { define: {...} }` → `bundler: { define: {...} }`) is auto-mapped to `bundler.transform.define` by `normalizeBundlerOptions`. A one-time `[gjsify] WARNING` is emitted. The canonical form is `bundler.transform.define`. Without this alias the token would survive as a bare identifier in the bundle and crash GJS at load with `ReferenceError`.

**App-build single-file invariant**: `--app gjs|node|browser` produces ONE bundle file. The orchestrator wraps the user's entry in a `\0gjsify-entry:<path>` virtual module that side-effect-imports the console shim + `--globals auto` inject stub then re-exports the entry. Combined with `output.inlineDynamicImports: true` this keeps everything in one chunk for `--outfile`. Library mode (`--library esm|cjs`) preserves modules (multi-file output, imports kept as-is).

### `--globals` modes (GJS)

|**auto (default)**: iterative multi-pass build — each pass bundles in-memory via `rolldown(...).generate()` (unminified, no disk I/O), acorn parses each chunk for free identifiers (`Buffer`) + host-object member exprs (`{globalThis,global,window,self}.Buffer`) matching `GJS_GLOBALS_MAP`. Per-chunk parsing (Rolldown emits one chunk per entry; concatenation would produce duplicate top-level declarations that acorn rejects) → detected sets unioned. Repeats until stable (2–3 iters, capped 5) — injecting register modules pulls in NEW code that may reference more globals. Final build uses converged set. Analyses **bundled output after tree-shaking** — avoids source-scan false positives. Passes MUST NOT minify (minifier aliases `globalThis` → short var, defeats MemberExpression detection).
|**auto,\<extras\>**: auto + safety net for value-flow indirection detector can't follow (e.g. Excalibur stores `globalThis` in `BrowserComponent.nativeComponent`, then calls `nativeComponent.matchMedia()`). Forms: `auto,dom` / `auto,FontFace,matchMedia` / `auto,dom,fetch`. Extras seeded into pass 1.
|**explicit list** `fetch,Buffer,...` or group aliases `node`/`web`/`dom`: no auto-detect.
|**none**: disables injection.

Key files: `packages/infra/rolldown-plugin-gjsify/src/utils/detect-free-globals.ts` (acorn AST) | `.../auto-globals.ts` (orchestrator) | `.../scan-globals.ts` (explicit) | `packages/infra/resolve-npm/lib/globals-map.mjs`.

### GLib MainLoop

`ensureMainLoop()` (`@gjsify/utils`, re-exported from `@gjsify/node-globals`): idempotent, non-blocking, no-op on Node. Used in `http.Server.listen()`, `net.Server.listen()`, `dgram.Socket.bind()`. **GTK apps MUST NOT use it** — use `Gtk.Application.runAsync()`.

### Don't patch — implement at the source

We own ~every Web/Node/DOM API. First question for any new feature: *"which package owns this, can we implement it there?"* — not *"where can we monkey-patch it in?"*. Patching propagates uncertainty (readers must reason about "which code installed this?"); first-class methods are self-documenting.

**Hard rules:**

- **Reading globals:** prefer `import { X } from '@gjsify/<pkg>'` over `(globalThis as any).X` in impl code. Imports give bundlers tree-shaking visibility, TS real types, surface missing deps as build errors. `globalThis` reads only justified for: (1) writes in register modules; (2) existence probes in register modules (`if (typeof globalThis.X === 'undefined') { globalThis.X = X }`); (3) debug flags (`globalThis.__GJSIFY_DEBUG_X`); (4) GJS runtime bootstrap (`globalThis.imports.*` before `@girs/*` resolves); (5) genuinely soft deps (rare — fallback to `Error` if `DOMException` not registered); (6) `globals.mjs` Node adapter — re-exports native value (`export default globalThis.crypto`) so alias layer can redirect bare specifiers on Node. Only non-register file allowed to read `globalThis.X` without `as any`.
- **Patching classes you own:** method belongs to a monorepo class (`URL.createObjectURL`→`@gjsify/url`, `Headers.getSetCookie`→`@gjsify/fetch`) → put it on the class, NOT on `globalThis.X.method=…` in a register module. Patch only when target is genuinely external (native global we can't subclass, third-party type).
- **"No module to import from":** check again — workspace almost certainly has `@gjsify/dom-*`/`@gjsify/web-*`/`@gjsify/node-*` exporting the class. Add the dep. Legit exceptions: (a) pre-registration bootstrap; (b) values with no module form (GJS `imports`, Node's `process.argv` before `@gjsify/process` loads).
- **Pure-JS → native swap:** before replacing a pure-JS impl with a (partly) native one in any pkg, ask: *is the pure-JS path still load-bearing on browser / Node / NativeScript?* If yes — KEEP the pure-JS code, lift it into a `-core` (or `/core` subpath) package that the native pkg depends on as a fallback. Native goes in front for the runtime that has it; the core stays as the default for the others. Mirrors `@gjsify/canvas2d-core` ⇆ `@gjsify/canvas2d` (Cairo-backed). Never delete portable code just because one platform got faster; the others still need it.

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
   **Examples and application code must NOT import `/register` directly.** Rely on `--globals auto` (the default for `gjsify build`). Explicit register imports in application code pull the catch-all into the bundle instead of only the granular subpaths that are actually used, bloating every build. They also hide detection gaps — if auto misses a global, the explicit import papers over the bug instead of surfacing it. Rule: if a global is needed, it must be detectable from the bundled output; if auto can't find it, fix the detector or add a `--globals auto,<extra>` override in the build script.
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
- **`--globals auto` analyses bundled output AFTER tree-shaking, NOT source.** Source-level approaches (regex, AST per-source via `transform`/`onLoad`, metafile on entries, `@rollup/plugin-inject` shape) were tried + rejected — false positives from isomorphic guards (`if(typeof window!=='undefined')window.fetch(...)`), dynamic-branch imports (`import(flag?'./a':'./b')`), bracket-notation access (`globalThis['Buf'+'fer']`). The "after tree-shaking" property is load-bearing and **bundler-agnostic**: it filters identifier references that survived dead-code elimination. Current mode parses **unminified bundled output** (esbuild today, Rolldown post-migration) via `acorn` AST. Do NOT reintroduce source scanning regardless of how good the new bundler's per-source `transform(code, id)` parser is — Oxc is no exception. Iterative multi-pass (build→acorn-on-output→rebuild→repeat until stable) in `auto-globals.ts`/`detect-free-globals.ts` is the ONLY sanctioned mechanism.
- **Analysis MUST NOT minify.** Minifier wraps bundle in IIFE aliasing `globalThis` → short var (`g.Blob` vs `globalThis.Blob`), defeats MemberExpression detection. `auto-globals.ts` passes `minify:false` to the inner build (esbuild today, `rolldown()` post-migration) — do not change.
- **Detection is iterative.** Tree-shaking creates dep cycle: pass 1 has no globals injected → code gated on globals is shaken; pass 2 injects → pulls NEW code referencing more globals; repeat until stable (cap 5). Detects bare identifiers + `host.Identifier` member exprs (globalThis/global/window/self).
- **Method markers for monkey-patched APIs.** Some packages register by patching a method on a host object instead of defining a fresh global (canonical: `@gjsify/gamepad/register` sets `globalThis.navigator.getGamepads=…` — neither `getGamepads` nor `Gamepad` appears as free identifier). `detect-free-globals.ts` keeps `METHOD_MARKERS`: `<host>.<method>` → target identifier. Add entry whenever register patches a method. Current: `navigator.getGamepads → GamepadEvent`.
- `sideEffects:["./lib/esm/register.js","./lib/esm/register/*.js"]` must remain. Never `false` on a register-providing package.
- `globals-map.mjs` MUST point at **granular** subpaths when they exist. Missing entry → `--globals auto` silently fails to inject. Pointing at catch-all when granular exists → bundle pulls entire register module instead of needed feature.
- **`@gjsify/<pkg>/register[/<feature>]` MUST NEVER be externalized for `--app gjs`.** GJS's native ESM loader has no node_modules walker AND does not follow `package.json#exports` maps for bare specifiers, so a bundle that externalizes one of these subpaths throws `Module not found` at runtime even when `<pkg>/lib/esm/register/<feature>.js` is physically on disk. The `--app gjs` externals predicate in `packages/infra/rolldown-plugin-gjsify/src/app/gjs.ts` enforces this via `isRegisterSubpath(id)` — it short-circuits to `false` (force-inline) before the user-external check fires, regardless of `bundler.external` from `package.json#gjsify`. The match is by SHAPE (`*/register`, `*/register/<feature>`, or resolved `<pkg>/lib/esm/register/<feature>.js` disk path) so the carve-out scales to every package added by this convention — no explicit allow-list. Verified by `packages/infra/cli/src/auto-globals.spec.ts`. Until upstream GJS gains an exports-map-aware resolver, inlining is the only safe option.

**Auto is the default.** If auto misses (value-flow indirection): `--globals auto,dom` or `auto,matchMedia,FontFace`. If auto injects false positive: switch to explicit list or file issue.

```bash
# Root (runs each script across all workspaces, topologically)
gjsify foreach build | gjsify foreach build:node | gjsify foreach build:web | gjsify foreach test | gjsify foreach check
# Node-free `tsc` under GJS via the @gjsify/tsc bundle (forwards args verbatim)
gjsify tsc --version | gjsify tsc -p tsconfig.json
# Publish + npmrc-auth verification (drop-in for `npm publish` / `npm whoami`)
gjsify publish [path] [--tag <t>] [--access public] [--otp <code>] [--trusted] [--dry-run]
gjsify whoami [--registry <url>] [--json]   # prints the npm username for the current ~/.npmrc token; clear failure on dead/missing token
gjsify login  [--registry <url>] [--scope @s] [--username <u>] [--otp <code>] [--json]   # Node-free `npm login` (legacy credentials flow): prompts user+password(hidden), PUTs the couchdb user doc (Basic auth, 409→_rev retry for existing users), writes //host/:_authToken to ~/.npmrc. No web-OAuth flow.
gjsify logout [--registry <url>] [--scope @s] [--json]   # revoke the token (best-effort DELETE /-/user/token) + strip it from ~/.npmrc
# Per-package (in the package dir)
gjsify run build:gjsify | gjsify run build:types
gjsify run build:test:{gjs,node} | gjsify run test:{gjs,node}
# One specific workspace from anywhere
gjsify workspace @gjsify/<name> <script>
gjsify workspace @gjsify/<name> <script> --with-dependencies      # also build transitive workspace deps in topological order first (alias: -d / -t / --topological)
gjsify workspace @gjsify/<name> <script> -d --continue-on-error   # keep going past failed deps; default stops on first failure
gjsify workspace @gjsify/<name> <script> -d --include-dev          # also walk devDependencies (default: prod + optional only)
# Workspace-wide dep upgrades (drop-in for `yarn upgrade-interactive`)
gjsify upgrade                       # interactive table aggregated across ALL workspaces; shows fan-out + ⚠ on inconsistencies
gjsify upgrade --latest | --minor | --patch    # bulk upgrade, same aggregation across all workspaces
gjsify upgrade --align                # offline: align inconsistent deps to their highest declared version (no registry calls)
gjsify upgrade --check                # CI gate: exit non-zero if any dep is declared at multiple ranges across workspaces
gjsify upgrade --check --exclude-workspace '@gjsify/integration-*'    # CI-friendly: carve out workspaces with intentional drift (the GJS workflow runs this exact form)
gjsify upgrade -p '@gjsify/*'         # restrict to a workspace subset (glob matched against name + path)
```

## GNOME Libs & Mappings — `node_modules/@girs/*`

`@girs/glib-2.0`(ByteArray,Checksum,DateTime,Regex,URI,env,MainLoop) | `@girs/gobject-2.0`(signals,properties) | `@girs/gio-2.0`(File,streams,Socket,TLS,DBus) | `@girs/giounix-2.0`(Unix FDs) | `@girs/soup-3.0`(HTTP,WebSocket,cookies) | `@girs/gda-6.0`(SQLite) | `@girs/gst-1.0`+`@girs/gstapp-1.0`+`@girs/gstwebrtc-1.0`+`@girs/gstsdp-1.0`(media pipelines, WebRTC) | `@girs/manette-0.2`(gamepads) | `@girs/webkit-6.0`(iframe, WebView) | `@girs/gjs`(runtime)

```
Node→GNOME: fs→Gio.File{,I/O}Stream | Buffer→GLib.Bytes/ByteArray/Uint8Array | net.Socket→Gio.Socket{Connection,Client} | http→Soup.{Session,Server} | crypto→GLib.{Checksum,Hmac} | process.env→GLib.{g,s}etenv() | url.URL→GLib.Uri | sqlite→Gda.Connection(SQLite provider) | tty.isatty/process.stdin.setRawMode/stdout.columns→GjsifyTerminal.Terminal(Posix.isatty+ioctl TIOCGWINSZ+termios, optional Vala prebuild)
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
|`refs/libsoup/` — Soup 3 source (C). Authoritative for HTTP/1.1+HTTP/2+WebSocket semantics backing `@gjsify/{fetch,xmlhttprequest,http,http2,websocket,eventsource,ws}`. Read when GI wrappers behave unexpectedly — the C source is ground truth
|`refs/axios/` — axios HTTP client (TS). XHR + http(s) adapters. Reference for typical npm-consumer expectations against `@gjsify/xmlhttprequest` and request/response semantics

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
`refs/gjs/`(internals) | `refs/stream-http/`(HTTP via streams) | `refs/troll/`(GJS utils) | `refs/crypto-browserify/`(orchestrator → sub-pkgs: `refs/{browserify-cipher,browserify-sign,create-ecdh,create-hash,create-hmac,diffie-hellman,hash-base,pbkdf2,public-encrypt,randombytes,randomfill}`) | `refs/readable-stream/`(edge cases) | `refs/ungap-structured-clone/`(→`packages/gjs/utils/src/structured-clone.ts`) | `refs/node-gtk/` — romgrk's Node.js GObject Introspection bindings; **reference-only** for the platform-bridge axis (Node-on-GTK aspiration documented in `## Strategic direction`); NOT a build target / NOT actively maintained on our side

### Mobile (NativeScript)
Reference sources for the upcoming 4th runtime axis. NativeScript is a V8-based mobile framework that exposes Android (Java) and iOS (Objective-C/Swift) APIs directly to JavaScript via a metadata-driven bridge — conceptually analogous to GJS↔GNOME. Used as inspiration for the `--app nativescript` build target, the `gjsifyNativescript()` Vite-preset, and the per-package `runtimes.nativescript` slot mechanics.
|`refs/nativescript/` — NativeScript core monorepo: `packages/core` (UI components, fetch, XMLHttpRequest, WebSocket, ApplicationSettings, etc.), `packages/types-android`, `packages/types-ios` (TypeScript types analogous to gjsify's `@girs/*`). Primary reference for which Web/Node APIs ship by default vs need polyfilling
|`refs/nativescript-android/` — V8 Android runtime + JNI metadata bridge + binary metadata generator. Reference for how `java.io.File`/`android.content.Context` etc. are exposed as JS globals at runtime
|`refs/nativescript-ios/` — V8 iOS runtime + Objective-C metadata bridge. Reference for `NSFileManager`/`UIDevice` etc. surface
|`refs/nativescript-napi/` — embeddable Node-API-based runtime (2025/2026 direction unifying iOS + Android engines). Reference for the future engine-agnostic substrate
|`refs/nativescript-nodeify/` — EddyVerbruggen's Node-shim plugin (`fs`/`path`/`crypto`/`events` polyfills for NS). **Not** a 1:1 take — gjsify ships its own per-pillar polyfills with native bridges; nodeify is a structural reference for what npm consumers expect
|`refs/nativescript-canvas/` — NativeScript/canvas monorepo (Rust/Skia native Canvas2D/WebGL/WebGPU + framework adapters). The NS pendant to GJS' `Gtk.GLArea` GL surface, used to bring WebGL showcases (three.js teapot) to NS-Android. **Use-vs-fork stance:** `packages/canvas` (native GL surface) + `packages/canvas-polyfill` (MinimalDOM / `Image` / event shims via `@xmldom/xmldom` + `query-selector` so three.js `TextureLoader`/`OrbitControls` run) are **used** as deps; `packages/canvas-three` (thin `Renderer(gl,…)` factory) is **reference only** — we keep our cross-platform `start(canvas)` seam (`new THREE.WebGLRenderer({ canvas })`, identical to browser/GJS) instead of adopting its gl-context construction pattern

### Browser polyfills
|`refs/node-stdlib-browser/` — canonical aggregator + npm-name → browser-polyfill mapping table (consumed by webpack/rollup/vite resolvers); reference for our resolver shim's expected names on the Web axis
|`refs/path-browserify/` — drop-in `node:path` polyfill; reference for our GJS `path` POSIX/win32 toggle, `path.parse` field order, trailing-slash semantics
|`refs/process/` — canonical browser `process` shim (defunctzombie/node-process); reference for the trimmed-down browser surface of `@gjsify/node-globals` (no `process.binding`, `nextTick` via microtask, `env` empty, `cwd()` returns `/`)
|`refs/stream-browserify/` — slim `node:stream` re-export wrapper companion to `refs/readable-stream/`; reference for the CJS-ESM Fix-2 `stream` wrapper exports shape
|`refs/buffer-browserify/` — feross/buffer `Buffer` class for the Web axis; industry-standard hand-tuned browser Buffer impl, source for typed-array interop assertions
|`refs/pako/` — zlib in pure JS (de-facto choice for `browserify-zlib`); closest zlib API parity, dual MIT/Zlib, used by `isomorphic-git`, `jszip`, `pdfjs`
|`refs/browserify-zlib/` — `node:zlib`-compatible streaming wrapper around pako (`Gzip`/`Inflate`/etc.); reference for `@gjsify/zlib`'s API shape on the Web axis when `Gio.ZlibCompressor` is unavailable
|`refs/memfs/` — streamich/memfs in-memory Node `fs` implementation (full `fs` + `fs.promises` + `Volume`); reference for `@gjsify/fs` test fixtures and the Web axis
|`refs/wa-sqlite/` — rhashimoto/wa-sqlite WebAssembly SQLite with modular VFS layers (OPFS, IndexedDB, Memory); design reference to mirror against `Gda.Connection` for `@gjsify/sqlite` on the Web axis

### Adwaita/GTK design
|`refs/adwaita-web/` Web Framework based on GTK4/Libadwaita — CSS/component ref for `@gjsify/adwaita-web`
|`refs/libadwaita/` canonical CSS colors, radii, widget styles
|`refs/adwaita-fonts/` Adwaita Sans/Mono (SIL OFL) — sources packaged into `@gjsify/adwaita-fonts`
|`refs/adwaita-icon-theme/` GNOME symbolic icons (CC0/LGPLv3) — sources packaged into `@gjsify/adwaita-icons`
|`refs/app-mockups/` GNOME mockup PNGs/SVGs — visual ref
|`refs/app-icon-requests/` GNOME app icon requests — supplemental visual ref

### Build/tooling
`refs/astro/`(website ref) | `refs/deepkit/`(type compiler) | `refs/gjsify-vite/`(`examples/gtk/three-geometry-shapes/refs/gjsify-vite/`, Vite plugins for GJS) | `refs/ts-for-gir/` — ts-for-gir source — primary reference for the `@gjsify/integration-ts-for-gir` suite (Phase 1: `@gi.ts/parser`; later phases: `@ts-for-gir/lib`, generators, CLI). Strategic goal: `ts-for-gir` runs unmodified on GJS.

### Bundlers — module resolution & bundling
Inspiration sources for `gjsify build` engine, plugin pipeline, and resolver. Tracked migration path in STATUS.md (esbuild → Vite plugin track → Rolldown 1.0).
|`refs/esbuild/` — current bundler engine. Go source — `internal/{resolver,bundler,linker}/`, `pkg/api/`. Reference for our 8 esbuild plugins under `packages/infra/esbuild-plugin-*/`
|`refs/vite/` — Vite source (TS) — `packages/vite/src/node/{plugins,server,build}/`. Plugin API + dev-server + HMR reference for the future Vite-plugin track and `examples/gtk/three-geometry-shapes/refs/gjsify-vite/`
|`refs/rolldown/` — Rust-based Rollup-compatible bundler powering Vite ≥ 7. Reference for the long-term `gjsify build` engine swap. Source: `crates/rolldown*/`, JS API: `packages/rolldown/`

### Package managers — install & dlx
Inspiration sources for the future `gjsify install` and `gjsify dlx` commands (see project-memory: package-manager resolution + `require.resolve` semantics for GJS).
|`refs/bun/` — Bun's package manager (Zig) + `bun install`/`bunx`. Source: `src/install/`, `src/bunfig.zig`. Also doubles as Node test ref (see Node.js section)
|`refs/npm-cli/` — canonical npm CLI. Resolver semantics (lockfile v3, peer-dep resolution), `npm exec`/`npx` behaviour. Source: `workspaces/{arborist,libnpmexec}/`, `lib/commands/`
|`refs/pnpm/` — content-addressable store + symlink-farm node_modules layout, hard-link dedup. Reference for efficient on-disk layouts. Source: `pnpm/` (Rust + TS workspace)
|`refs/yarn/` — Yarn Berry (PnP, zero-installs). Source: `packages/yarnpkg-{core,pnp,fslib}/`. Reference for resolver/linker plugin architecture and PnP runtime

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

Native libs in `prebuilds/linux-<arch>/` (`.so`+`.typelib`). `package.json`: `"files":["lib","prebuilds"]`, `"gjsify":{"prebuilds":"prebuilds"}`. **Showcases / dlx-runnable apps must declare every typelib-owning package as a runtime `dependency`** (not `devDependency`) — the bundle's static `gi://Gjsify…` imports require the corresponding `@gjsify/<vala-bridge>` package to physically exist in the consumer's node_modules. Build-time-only inclusion (via `@gjsify/node-globals` etc.) does NOT ship the typelib in the published tarball. CLI auto-sets `LD_LIBRARY_PATH`/`GI_TYPELIB_PATH` via `detectNativePackages(startDir)` — exhaustive `node_modules`-scan walking up from a startpoint. `runGjsBundle()` calls it twice (CWD + `dirname(bundlePath)`) so DLX-cache layouts (`~/.cache/gjsify/dlx/<sha>/.../node_modules/<pkg>/dist/bundle.js`) get their full transitive prebuild set picked up automatically. Used by `gjsify run dist/gjs.js` | `gjsify info [file]` (`--export` for eval) | `gjsify dlx <pkg>` | `gjsify showcase <name>`. Built by `.github/workflows/prebuilds.yml` (x86_64+aarch64, Fedora). Local: `gjsify workspace <pkg> build:prebuilds` for one native package, or `gjsify foreach build:prebuilds` for all of them (each runs `gjsify run build:meson` → `meson setup` + `meson compile`, so meson + vala + the relevant GI `-devel` packages must be installed). There is no root `build:prebuilds` script — yarn was dropped in Phase D.7d, scripts run via `gjsify run`/`gjsify workspace`/`gjsify foreach`.

**gi:// ordering:** `GIRepository.prepend_search_path()` must run before `gi://Foo` resolves. Static `gi://` imports resolve in ESM Linking (before code). Use `gjsify run` or two-file loader (loader calls prepend_search_path, then `await import('./bundle.js')`).

## Git hooks

Plain bash hooks under `.githooks/`, no husky/lefthook dep. Activate via `core.hooksPath=.githooks`; that key is wired automatically by `gjsify install` (`maybeInstallGitHooks()` post-check, gated on `existsSync(scripts/install-git-hooks.mjs) && existsSync(.git)` so consumer projects with `@gjsify/cli` as a dep are skipped silently). Manual install: `node scripts/install-git-hooks.mjs` (idempotent; `--uninstall` reverts to git's default; `--quiet` suppresses success log).

|`pre-commit` (`.githooks/pre-commit`): when staged files touch `packages/infra/cli/src/` / `packages/infra/cli/package.json` → runs `gjsify workspace @gjsify/cli build && build:gjs-bundle`, re-stages `packages/infra/cli/dist/cli.gjs.mjs`. When they touch `packages/infra/tsc/src/` / `packages/infra/tsc/package.json` → runs `gjsify workspace @gjsify/tsc build`, re-stages `packages/infra/tsc/dist/tsc.gjs.mjs`. No-op when neither path is touched. Resolves `gjsify` via workspace-local `node_modules/.bin/gjsify` → PATH → committed `cli.gjs.mjs` GJS bundle (so it works even on a fresh clone where `gjsify install` ran for the first time).
|**Bypass:** `git commit --no-verify` (standard) or `SKIP_GJSIFY_HOOKS=1 git commit` (env-var escape — use in CI / scripted commits that must not rebuild).
|**Why it exists:** `.github/workflows/main.yml` runs `gjs -m packages/infra/{cli,tsc}/dist/<bundle>.gjs.mjs --version` against both committed bundles and fails CI if the reported version drifts from `packages/infra/cli/package.json` / `TYPESCRIPT_VERSION` in `packages/infra/tsc/src/index.ts`. Contributors who edit `src/` without rebuilding the bundle land red CI runs (~90 min wasted per PR × 2 platforms). The hook removes the foot-gun by rebuilding + auto-staging the bundle transparently inside the same commit — no "remember to run two commands" step.
|**Tests:** `tests/e2e/git-hooks-cli-bundle-staleness/run.mjs` (no-op-for-unrelated / auto-rebuild-on-cli-src-change / `SKIP_GJSIFY_HOOKS=1` skip).

## Lint & format — oxc (oxlint + oxfmt)

`gjsify lint` / `gjsify format` / `gjsify fix` wrap **oxc** (`oxlint` for lint, `oxfmt` for format) — migrated from Biome (full replacement, no `--engine` fallback). `gjsify check` stays the **tsc** orchestrator, unrelated.

- **Resolution:** `packages/infra/cli/src/utils/oxc-resolve.ts` resolves the `oxlint`/`oxfmt` npm **Node launchers** (`node_modules/<tool>/bin/<tool>`) and spawns them via `process.execPath`. NOT the bare napi binary — oxlint's JS-plugin host (the `gjsify/register-class-order` rule) lives in the launcher. Tools are on-demand devDeps (resolved cwd → workspace-root → parents); a clear install hint names the expected `@oxlint/binding-<target>` / `@oxfmt/binding-<target>` napi package.
- **Config:** root `.oxlintrc.json` (correctness:error, typescript/consistent-type-imports, typescript/no-explicit-any:warn, unicorn/prefer-node-protocol:error, eslint/no-unused-vars:warn, typescript/no-this-alias with `allowedNames` for the legitimate `this`-capture idiom: `self`/`el`/`blob`/`readable`/`root`/`node`/`receivedThis`) + `.oxfmtrc.json` (printWidth 120, 4-space, singleQuote, semi, trailingComma all, arrowParens always). `gjsify format --init` writes both from `src/templates/{oxlintrc.json.tmpl,oxfmtrc.tmpl}` (loaded with the static-read-inliner `readFileSync(new URL(...))` shape so they bake into the bundle). `gjsify fix` = `oxfmt --write` then `oxlint --fix`.
- **`gjsify lint` is clean (0 errors)** across the whole codebase. Findings were FIXED, not silenced — autofix for `prefer-node-protocol`/`consistent-type-imports`/spread, manual fixes for the `correctness` longtail (`no-new-array` → `Array.from({ length })`, redundant parameter-property assignments dropped, dead code removed, a duplicate top-level `const seen` renamed, sqlite `allowUnknownNamedParameters` enforcement implemented). Genuinely-intentional patterns (NUL/ESC control-char regexes, GObject `static new()` factories in `.d.ts`, deliberate class+interface merging, NAPI pending-exception rethrow in `finally`, Excalibur points-setter trigger, GJS `imports[name]` side-effecting access) carry a per-line `// oxlint-disable-next-line <rule> -- <reason>`. Do NOT blanket-disable rules.
- **CSS/JSON formatting is DROPPED.** oxfmt formats JS/TS (+TOML) only. Biome's CSS/JSON formatting is NOT replaced — do not re-add Biome or another formatter for them.
- **Internal lint rule:** `packages/infra/oxlint-plugin-gjsify/` — `definePlugin` exposing `gjsify/register-class-order` (hoists `static` GObject metadata fields above a `GObject.registerClass` static block, with autofix). Internal-only (NOT published to npm — no Trusted-Publisher bootstrap). Wired via `.oxlintrc.json` `jsPlugins` + `"gjsify/register-class-order":"error"`.
- **oxfmt is pre-1.0** (0.51) — formatting output may churn across minor releases; budget a possible re-reformat per oxfmt minor until 1.0.
- **`--globals auto` detection stays on acorn** — oxc's parser must NOT be repurposed for global detection (this migration is lint/format tooling only). See the Tree-shakeable globals invariants.

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
2b. **GJS-only spec files in cross-platform pkgs** (`*.gjs.spec.ts`, OR a section wrapped in `on('Gjs', …)`): direct `@gjsify/*` imports allowed for that file/section. Same justification as rule 2 — only runs on GJS, has full access to impl-private types. Use this to test internal classes/methods (`Http2ServerResponse._allocatePushId`, `_state`, internals not surfaced through `@types/node`) **type-safely** instead of casting through `as any`. Cross-platform `*.spec.ts` (both Node + GJS) must still follow rule 1.
2c. **Internal-only helpers** (modules under `src/internal/`, `src/utils/internal-*.ts`, or anything not in the package's `exports` map): may import directly from sibling `@gjsify/*` packages even in production code, since the helper itself is not consumed externally and the import chain stays inside the workspace's GJS-resolved set. Use this to give internal utilities concrete `@gjsify/*` types instead of structural duck shapes. Public surface (`src/index.ts` and anything reachable from `exports`) still follows rule 1 to keep the cross-platform contract intact.
3. Node tests = correctness of test; GJS tests = our impl. Both must pass.
4. Common `*.spec.ts`: both platforms, no `@girs/*`. Platform-specific `*.gjs.spec.ts` / `on('Gjs')`: minimal.
5. Layout: `src/index.ts`(impl) | `src/*.spec.ts` | `src/test.mts`(entry).
6. **Never weaken tests** — fix impl. No platform guards.
7. **`/register` side-effect tests in dedicated file:** Tests verifying globalThis wiring (`globalThis.FontFace`, `globalThis.__gjsify_globalEventTarget`) need `import '<pkg>/register'` → put in `register.spec.ts`, NOT common spec. Reason: even pure-JS global — `/register` pulls GTK/Cairo via import chain, crashes on Node. Common spec tests class/value via named import; `register.spec.ts` tests wiring (GJS-only, wrap in `on('Gjs',...)`). Add to `test.mts` as named suite. Applies only to GJS-only packages. Cross-platform: `/register` test → `.gjs.spec.ts`. Example: `packages/dom/dom-elements/src/register.spec.ts`.

### Browser tests — `tests/browser/` (Playwright, Firefox/SpiderMonkey)

Third test axis alongside `test:gjs` / `test:node`. Validates Web API surface against a real browser (Firefox uses SpiderMonkey, same engine as GJS).

**Core principle: the goal is GJS, not browser.** gjsify reimplements Web/Node APIs _for GJS_. Browser tests verify that the native browser platform behaves the way our GJS implementation claims — they do NOT test our GJS packages in a browser.

**`test.browser.mts` must use browser globals directly** — never import `@gjsify/<pkg>` implementations or `*.spec.ts` files that do. Reason: Web APIs (`fetch`, `Event`, `crypto`, `ReadableStream`, …) are already global in the browser. Importing from our GJS packages would drag in `@girs/*` / `gi://*` bindings (GObject introspection, Soup, GLib) which have no browser equivalent, forcing a cascade of workaround aliases. The correct fix is always clean test files, not more aliases.

```ts
// ✓ Correct — browser test for @gjsify/fetch
import { run, describe, it, expect } from '@gjsify/unit';
run({
  async FetchTest() {
    await describe('Response', async () => {
      await it('reads json body', async () => {
        const r = new Response('{"x":1}');          // global — no import needed
        expect(await r.json()).toStrictEqual({x:1});
      });
    });
  },
});

// ✗ Wrong — imports GJS implementation, drags in gi:// bindings
import { run } from '@gjsify/unit';
import testSuite from './index.spec.js';  // ← index.spec.ts imports @gjsify/fetch which imports Soup
run({ testSuite });
```

**Layout:** `src/test.browser.mts`(browser entry, globals only) | `package.json` `build:test:browser: gjsify build src/test.browser.mts --app browser --outfile dist/test.browser.mjs` | `tests/browser/` runs all discovered bundles via Playwright.

**esbuild browser target (`--app browser`):** `gjsImportsEmptyPlugin` silences `@girs/*` and `gi://*` that appear transitively through `@gjsify/unit`'s GJS-specific code paths. Only two aliases are needed: `assert`/`node:assert` → `@gjsify/assert` (used by unit internally) and `process`/`node:process` → `@gjsify/empty` (unit has a dead `import('process')` that esbuild resolves statically; the runtime path never runs in browser).

**`@girs/*` or `gi://*` in a browser/Node bundle** = missing alias somewhere in the dependency chain. Fix the import (make the test file not drag in GJS-specific code) — never mask with `external:` (leaves bare specifiers the browser can't resolve) or a blanket `NODE_BUILTINS_EMPTY` map.

**Packages with browser tests (12):** `abort-controller`, `compression-streams`, `dom-events`, `domparser`, `eventsource`, `fetch`, `formdata`, `message-channel`, `streams`, `webcrypto`, `websocket`, `webstorage`. GJS-only packages (`webaudio`, `webrtc`, `gamepad`, …) have no browser test — the native platform has no equivalent of libsoup/GStreamer/Manette.

**Run locally:** `cd tests/browser && npx playwright test --project=firefox` (Firefox-primary; add `--project=chromium` to surface engine diffs). HTTP server must be running (Playwright starts one automatically from `playwright.config.ts`).

### Regression tests from examples

Real-world examples uncovering bugs (GC, missing globals, CJS-ESM, MainLoop) → always add targeted test to relevant `*.spec.ts`. Examples = integration validation; regression tests = permanent safety net.

### Selective CI — affected-only test runs

CI's `linux` job is gated by a `gjsify affected` classifier that diffs HEAD vs the PR base and decides which test tiers run. **Place new tests where the classifier can find them**:

|spec files: `<workspace>/src/**/*.spec.ts` — touching only this file → seed = that workspace, no closure expansion (test code has no downstream consumers).
|integration suites: `tests/integration/<name>/` — declare every backend pillar exercised in `package.json#dependencies` so the classifier fires the integration tier when those workspaces are in the closure. The forward-graph walk at the end of the closure step is what surfaces the suite when `@gjsify/<dep>` changes.
|e2e: `tests/e2e/<name>/` — runs only when `tests/e2e/**` itself is touched OR on a global trigger. Don't put per-workspace functional tests here.
|browser: `tests/browser/specs/*.spec.ts` — Playwright; runs as part of `test:browser`.

**Global triggers** (force a full run): touching `packages/infra/{workspace,cli,rolldown-plugin-gjsify,resolve-npm}/**`, `gjsify-lock.json`, root `package.json`/`tsconfig*.json`, `scripts/audit-runtimes.mjs`, or `.github/workflows/main.yml`. These can't be selectively gated because the classifier itself depends on them.

**Ignored** (no test run, no closure seed): `**/*.md`, `refs/**`, `website/**`, `docs/**`, unrelated workflow files (`.github/workflows/{deploy-docs,commitlint,release,audit-runtimes,prebuilds}.yml`), `.githooks/**`, `LICENSE*`, `.gitignore`, top-level `STATUS|CHANGELOG|AGENTS|CLAUDE|README.md`.

**Kill switch**: set repo variable `GJSIFY_CI_FORCE_FULL=1` (Settings → Variables → Actions) to short-circuit the classifier and run the full suite on every PR.

**Local dry-run**: `gjsify affected --base origin/main` prints what CI would run. Use this when adding a new tier of tests to verify the classifier picks them up. `--format=json` for machine-readable, `--changed-from-stdin` for fixture-driven testing.

When you add a new workflow file or a new top-level directory the classifier doesn't know about (e.g. `benchmarks/`), update `packages/infra/cli/src/commands/affected.ts`'s `GLOBAL_TRIGGERS` / `IGNORE` tables + the spec — silently mis-categorising new paths is the most common way to leak slowdowns back into the typical PR loop.

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

Scripts: `gjsify foreach test:integration[:node|:gjs]`. NOT part of `gjsify foreach test` — opt-in to avoid blocking PRs on tracked gaps.

**Current suites:**

| Suite | Source | Node | GJS | Pillars exercised |
|---|---|---|---|---|
| `tests/integration/webtorrent/` | `refs/webtorrent/test/` — 7 ports | 185/185 | 185/185 | fs (URL paths), stream, events, buffer, crypto, esbuild `require` condition fix, `random-access-file` alias |
| `tests/integration/socket.io/` | `refs/socket.io/packages/socket.io/test/` — 3 ports | 20/20 | 20/20 | http, fetch (raw body), events (enumerable proto), IncomingMessage close semantics, polling transport |
| `tests/integration/streamx/` | `refs/streamx/test/` — 6 ports + `throughput.spec.ts` | 155/155 | 156/156 | stream, queueMicrotask injection (fixes 0 B/s regression) |
| `tests/integration/chokidar/` | chokidar 5.0.0 `src/index.test.ts` — 4 ports | 19/19 | 19/19 | fs.watch / FSWatcher (Gio.FileMonitor): emit('change', eventType, basename) discriminant fix unblocks chokidar (Vite/Rolldown/tsc-watch surface) |
| `tests/integration/autobahn/` | crossbario fuzzingserver (non-port) | — | 240 OK / 4 NON-STRICT / 3 INFO / 0 FAILED × 2 agents | websocket, ws wrapper, RFC 6455 |

**Protocol-fuzzing integration** (`tests/integration/autobahn/`, non-port): runs [crossbario/autobahn-testsuite](https://github.com/crossbario/autobahn-testsuite) Python fuzzingserver in Podman/Docker, points Gjs drivers at it. Thin echo-client iterating `getCaseCount`→`runCase`→`updateReports` (pattern from `refs/ws/test/autobahn.js`). Validation: diff `reports/output/clients/index.json` vs `reports/baseline/<agent>.json` via `scripts/validate-reports.mjs` (regressions/improvements/missing per agent). Two drivers: `@gjsify/websocket` (W3C over Soup) + `@gjsify/ws` (npm `ws` wrapper) — isolates wrapper-layer from transport-layer bugs. Runtime: `scripts/autobahn-up.mjs`/`down.mjs` — `CONTAINER_RUNTIME=podman|docker` overrides auto-detection (prefers Podman; Fedora default). Baselines under `reports/baseline/` are committed; regressions surface in PR diffs. Not wired into CI yet (Podman-in-CI needs privileged containers).

## Package convention

`packages/node/<name>/` → `@gjsify/<name>`, v0.4.42, `"type":"module"` | exports `./lib/esm/index.js` + `./lib/esm/register.js` (if globals) | `sideEffects:["./lib/esm/register.js"]` pinned to register-only | scripts: `build:gjsify|build:types|build:test:{gjs,node}|test|test:{gjs,node}` | deps: `@girs/*`; devDep `@gjsify/unit`; workspace deps `workspace:^`

Layout: `src/index.ts` (pure named exports) | `src/register.ts` (side-effect globals) | `src/*.spec.ts` | `src/test.mts` (entry, imports `@gjsify/node-globals/register` + feature-specific `<pkg>/register`). Full rules: Tree-shakeable Globals section.

**Framework packages** (`packages/framework/<name>/`): flat name `@gjsify/<name>` (NOT `@gjsify/framework-<name>`), composition-first. **No `/register`, no `globalThis.*` writes, no top-level side effects.** Pure named exports. Compose standard DOM/GTK APIs; never register browser globals (Web/DOM pillars' job). A framework pkg needing a global imports `@gjsify/<web-or-dom-pkg>/register` explicitly. Minimal: `src/index.ts` + `package.json` + `tsconfig.json`.

Shared utils: `@gjsify/utils` (`packages/gjs/utils/`). Check before duplicating; only extract when 2nd package needs it.

**`@gjsify/stream` direct imports** in internal modules/test files needing non-standard exports (`Stream_`, `makeCallable`, internal state types) are allowed. All public code (examples, showcases, cross-package APIs) must use `node:stream`.

### New `@gjsify/*` package: first-publish + Trusted Publisher bootstrap

npm Trusted Publishing (OIDC) requires the package to **already exist** on npmjs.com — you cannot configure a Trusted Publisher for a name that has no published versions. This makes the **first publish a manual maintainer action**, not a CI release. Skipping this step breaks the entire serialized `npm:publish` loop in `release.yml`: every package alphabetically after the new name fails to publish because the OIDC exchange returns `404 — OIDC token exchange error - package not found` and the workflow exits 1 (historical incident on v0.4.20: `@gjsify/tls-native` was added in #242, no manual bootstrap → 60+ packages stuck at 0.4.19).

Run before the merge that adds the package (or immediately after, before the next release-it patch):

1. Build the package locally: `gjsify workspace @gjsify/<name> build`
2. **Manual first publish from a maintainer machine** with an npm account that has `@gjsify` scope publish access + 2FA OTP (or a granular access token with bypass-2fa enabled). `gjsify publish` now supports `--otp` natively, keeping the bootstrap entirely Node-free:
   ```bash
   cd packages/<pillar>/<name>
   gjsify publish --access public --otp <code>
   ```
   This creates the package record on npmjs.com. The `npm-otp: <code>` header is forwarded on the PUT request; if OTP is required but `--otp` is omitted on a non-TTY, the CLI exits with a clear error pointing at `--otp`. On an interactive TTY it prompts once and retries (mirrors npm's `otplease` behavior — see `refs/npm-cli/lib/utils/auth.js`).

   **Pre-flight — verify `~/.npmrc` auth.** Before the publish PUT, confirm the token is live with `gjsify whoami` (uses the same npmrc + bearer-resolution path as `gjsify publish`). Healthy: `Logged in as: <you>` / `Registry: https://registry.npmjs.org`. Dead/revoked: the command exits 1 with a clear "token appears dead or revoked" message — refresh via `npm login` and re-run. The same probe is available as `gjsify whoami --json` for CI scripts (`{"username":"<you>","registry":"<url>"}` on success; `{"error":"dead-token"|"no-token-configured"|"<network-message>","registry":"<url>"}` on failure). The legacy curl one-liner remains a hand-off fallback when `gjsify` itself is not on PATH yet:
   ```bash
   curl -s -H "Authorization: Bearer $(grep registry.npmjs.org ~/.npmrc | sed 's|.*=||')" \
        https://registry.npmjs.org/-/whoami
   # Healthy: {"username":"<you>"}
   # Dead:    {}
   ```

   **Diagnostic — `404 Not Found` on PUT.** A 404 on the publish PUT is ambiguous: the npm registry returns it for both a dead `_authToken` and a genuinely-missing package. `gjsify publish` now probes `GET /-/whoami` with the same Authorization header to disambiguate: body `{}` (status 200) → the `_authToken` in `~/.npmrc` is revoked/expired, refresh via `npm login`; body `{"username": "..."}` → the package doesn't exist on npm yet, run the first-publish bootstrap above. The probe is best-effort (token-auth path only, skipped under `--otp` or `--trusted`/OIDC where the error surfaces are already clear); on a network failure the generic error message is used instead.
3. **Configure Trusted Publisher** at `https://www.npmjs.com/package/@gjsify/<name>/access`:
   - Repository: `gjsify/gjsify`
   - Workflow: `release.yml`
   - Environment: (empty)
   - Permission: `npm publish`
4. **(Optional)** verify the config from CI before the next real release:
   ```bash
   gh workflow run release.yml -f verify_only=true
   ```
   The audit step prints a per-package `✓ / ✗` summary; the new package should report `✓`.
5. **From here on, normal CI release-it cadence takes over** — every subsequent `release.yml` run picks up the package via OIDC + Trusted Publisher.

Same procedure for new native-bridge packages (`@gjsify/<name>-native`) since they ship as their own npm packages alongside the parent. PR template / merge checklist should include: *"if this PR adds a new `@gjsify/*` package, the manual first-publish + Trusted Publisher step is done before merging or queued as the next maintainer action."*

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

**No explicit `/register` imports in example source.** Do not write `import '@gjsify/node-globals/register'` or any other `/register` side-effect import in `examples/` or `showcases/` source files. `gjsify build` uses `--globals auto` by default, which injects only the granular register subpaths actually referenced in the bundle. Explicit catch-all imports bloat the bundle and mask auto-detection gaps. If a global is needed and auto doesn't pick it up, add `--globals auto,<identifier>` to the build script instead.

Constants (dropdowns, defaults) in shared `.ts` — both `gjs/` + `browser/` import. No duplication in HTML.

## Showcase — `gjsify showcase`

Polished examples under `showcases/`. Published npm packages (`@gjsify/example-{dom,node}-<name>`), CLI deps. Self-contained + independently runnable (`gjsify showcase <name>`, `gjsify run start[:browser]`).

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
3. `gjsify run test:node` (in the package) — verify tests correct
4. `gjsify run test:gjs` — expect failures → fix impl
5. Implement with `@girs/*`, consult `refs/{deno,bun,quickjs,workerd}/`
6. Iterate until both pass
7. Full: `gjsify install --immutable && gjsify run clear && gjsify run build && gjsify run check && gjsify run test`

## Type Safety

`unknown` over `any` | `as unknown as T` for unrelated casts | Error callbacks: `NodeJS.ErrnoException | null` | Validate: `gjsify run check`

## Source Attribution

**Templates** — **A** (direct adaptation): `SPDX-License-Identifier: MIT` + `Adapted from <project> (<refs/path>). Copyright (c) <year> <holder>` + `Modifications: <brief>` | **B** (API reimpl): `Reference: Node.js lib/<name>.js[, refs/deno/...]` + `Reimplemented for GJS using <lib>` | **C** (ported tests): `Ported from refs/<project>/test/...` + `Original: MIT, <holder>` | **D** (spec algorithm): `Implements <algo> per <spec> (<RFC>)` + `Reference: refs/<project>/path. Copyright (c) <holder>. <license>.`

Every impl → A or B. Every ported test → C. Original: `// <Module> for GJS — original implementation using <library>`. Use `refs/` paths over URLs.

### Copyright (refs/<pkg> → holder, license)

|node,node-test → Node.js contributors, MIT |deno → 2018-2026 Deno authors, MIT |bun → Oven, MIT |quickjs → Bellard+Gordon, MIT |workerd → Cloudflare, Apache 2.0 |edgejs → Wasmer, MIT |crypto-browserify,browserify-cipher,create-hash,create-hmac,randombytes,randomfill → crypto-browserify contributors, MIT |browserify-sign,diffie-hellman,public-encrypt → Calvin Metcalf, ISC/MIT |create-ecdh → createECDH contributors, MIT |hash-base → Kirill Fomichev, MIT |pbkdf2 → Daniel Cousens, MIT |readable-stream → Node.js contributors, MIT |undici → Matteo Collina+contributors, MIT |gjs → GNOME contributors, MIT/LGPLv2+ |headless-gl → Mikola Lysenko, BSD-2-Clause |webgl → Khronos Group, MIT |three → three.js authors, MIT |libepoxy → Intel, MIT |node-gst-webrtc → Ratchanan Srirattanamet, ISC |node-datachannel → Murat Doğan, MPL 2.0 |libdatachannel → Paul-Louis Ageneau, MPL 2.0 |webkit → WebKit contributors, LGPLv2 / BSD-2-Clause |epiphany → GNOME contributors, GPLv3 |webrtc-samples → WebRTC authors, BSD-3-Clause |node-canvas → Automattic, MIT |llrt → Amazon, Apache 2.0 |happy-dom → David Ortner, MIT |jsdom → Elijah Insua, MIT |wpt → web-platform-tests contributors, 3-Clause BSD |ungap-structured-clone → Andrea Giammarchi, ISC |ws → WebSocket/IO contributors, MIT |socket.io → Automattic, MIT |streamx → Mathias Buus, MIT |webtorrent,webtorrent-desktop → WebTorrent LLC, MIT |excalibur → Excalibur.js authors, BSD-2-Clause |excalibur-tiled → Excalibur.js authors, BSD-2-Clause |peachy → vixalien, MIT |map-editor → PixelRPG, MIT |gamepad-mirror → vendillah, GPLv3 |showtime → GNOME contributors, GPLv3 |adwaita-web → mclellac, MIT |libadwaita → GNOME contributors, LGPLv2.1+ |adwaita-fonts → Inter/Iosevka/GNOME, SIL OFL 1.1 |adwaita-icon-theme → GNOME contributors, CC0-1.0 / LGPLv3 |app-mockups,app-icon-requests → GNOME contributors, CC-BY-SA |node-fetch → MIT |event-target-shim → Toru Nagashima, MIT |gjs-require → Andrea Giammarchi, ISC |ts-for-gir → ts-for-gir contributors / gjsify, Apache 2.0 |path-browserify → James Halliday + browserify contributors, MIT |process → Roman Shtylman, MIT |stream-browserify → James Halliday + browserify contributors, MIT |buffer-browserify → Feross Aboukhadijeh + contributors, MIT |pako → Vitaly Puzrin + Andrey Tupitsin, MIT AND Zlib |browserify-zlib → Devon Govett + Node.js contributors, MIT |memfs → streamich (Vadim Dalecky), Apache-2.0 |wa-sqlite → Roy Hashimoto, MIT |node-stdlib-browser → Ivan Nikolić + contributors, MIT |nativescript,nativescript-android,nativescript-ios → NativeScript contributors / Telerik / Progress / OpenJS Foundation, Apache 2.0 |nativescript-napi → NativeScript contributors, MIT |nativescript-nodeify → Eddy Verbruggen, MIT |nativescript-canvas → NativeScript contributors (oss@nativescript.org), Apache-2.0

## STATUS.md & CHANGELOG.md Maintenance

**STATUS.md always reflects current codebase state.** Feature lands / bug fixed / test added / workaround discovered / deferred item identified → update STATUS.md in the same commit. Never leave drift.

**Every PR that touches code or tests MUST include a STATUS.md update.** No exceptions. PRs without the update are incomplete. Checklist:

| Trigger | Required STATUS.md change |
|---|---|
| New package added | Add row to the correct table (Fully/Partially/Stub or new section); add entry to GNOME Library Usage if it uses a GNOME lib; update Metrics package counts |
| Package promoted (Stub→Partial, Partial→Full) | Move row to new table; update summary table percentages; add to `### Completed` |
| Tests added or counts change | Update test count in the package row; update Metrics "Total test cases" |
| New integration test suite | Add section under "Integration Test Coverage"; update Metrics suite count + test total |
| Bug fixed / workaround removed | Update Working/Missing column; strike through "Upstream GJS Patch Candidates" entry if resolved |
| Deferred item identified | Add entry to "Open TODOs" with priority and next steps |
| Deferred item resolved | Move from "Open TODOs" to `### Completed` (or delete if trivial) |
| Native Vala bridge added | Add dedicated package table + GNOME Library Usage row; update multi-arch prebuild list |
| New architecture/platform supported | Update all affected package prebuild lists; update Metrics |
| Header `> Last updated:` | Always update to the current date with a one-line summary of what changed |

**Track deferred work in dedicated `Open TODOs` section.** Every "out of scope" / "follow-up" / "later" note from PR description / plan file / commit message must have a corresponding entry — otherwise forgotten. Resolved TODO → move to `### Completed` list (or delete if trivial).

**Changelog entries ONLY in CHANGELOG.md.** STATUS.md = current state; CHANGELOG.md = what changed + when. Do NOT add dated "Latest:" lines, changelog highlights, or per-session summaries to STATUS.md. Update CHANGELOG.md after work sessions with dated entries describing what changed and why.

## Commit conventions

Conventional commits — `<type>[optional scope]: <description>`, imperative mood, ≤50 char subject.

**All types surface in CHANGELOG.md** (configured via the `types` array in `.release-it.json`). Use the type that best describes the change — no type is silently dropped. Enforced by commitlint (`commitlint.config.cjs`) on every PR via `.github/workflows/commitlint.yml`.

| Type | Changelog section | When to use |
|---|---|---|
| `feat` | Features | New user-visible feature or API |
| `fix` | Bug Fixes | Bug fix |
| `perf` | Performance Improvements | Performance improvement (no API change) |
| `revert` | Reverts | Reverts a previous commit |
| `docs` | Documentation | Docs-only change (website, AGENTS.md, comments) |
| `refactor` | Code Refactoring | Code restructuring with no behavior change |
| `build` | Build System | Build scripts, tooling, bundler config |
| `ci` | Continuous Integration | CI workflow changes |
| `chore` | Maintenance | Dependency bumps, submodule updates, version commits |
| `test` | Tests | Adding or fixing tests (no production code change) |
| `style` | _(hidden)_ | Whitespace / formatting only — omitted from changelog |

**Scope** (optional): lowercase package name without `@gjsify/` prefix, e.g. `feat(fetch): …`, `fix(rolldown-plugin-gjsify): …`. Use `(e2e)` for end-to-end test suites. Omit scope when the change crosses multiple packages.

## Constraints

Target: GJS 1.86.0 / SpiderMonkey 140 (ES2024) / Rolldown `firefox140` | ESM-only | GNOME libs + standard JS only | Tests pass on both Node + GJS | Do NOT modify `refs/`

**TypeScript version invariant.** Root + EVERY workspace (including all integration tests) declares `typescript: "^6.0.3"` — there is no longer any TS-5.x carve-out. The single, workspace-wide range is enforced by the CI `gjsify upgrade --check --exclude-workspace '@gjsify/integration-*'` step (the `--exclude-workspace` glob remains only because a couple of OTHER integration tests still pin intentionally-drifted ranges of *non-typescript* deps — `undici`'s `ws`, `mcp-typescript-sdk`'s `zod`; `typescript` itself is consistent everywhere). The 5 tests that previously pinned `^5.4.5` / `^5.7.3` — `tests/integration/{deepkit-type-compiler,loro-crdt,typescript-tsc,yjs,deltachat}` — were **empirically retested on TS 6 and all pass** (loro 166/166, yjs 147/147, typescript-tsc 35 node / 33+1-ignored gjs, deepkit 29/29, deltachat 43/43 — on BOTH node and gjs), so they were moved to `typescript: "^6.0.3"`, their `@gjsify/*` deps reverted from the published `^0.4.36` range back to `workspace:^`, and they are now **full workspace members again** (un-excluded from `package.json#workspaces`). This restores test fidelity: they once more exercise the *local* workspace `@gjsify/*` code, not a published snapshot. Notably `@deepkit/type-compiler@^1.0.19` instruments `typeOf<T>()` correctly against TS 6 internals — the "transforms `extends` into invalid `function extends()`" warning in the Deepkit build-plugin docs is about the *reflection emitter on user code*, not the type-compiler's own TS-6 compatibility. The ONLY remaining `tests/integration/*` exclusion is `!tests/integration/nativescript` (heavy NS toolchain, kept out of `gjsify install`). Because `gjsify install` hoists ONE `typescript` per name to the root (poor-man's hoisting) and every enumerated workspace now declares `^6.0.3`, the lockfile cleanly hoists `6.0.3` for everyone with zero TS-version conflict. (Do NOT reintroduce a 5.x pin + root `overrides` to scope it into a test's own `node_modules/`: that triggers a per-workspace `gjsify-lock.json` requirement under `--immutable` that no integration test commits — which is what red-lined the install step in the original v0.4.42 carve-out attempt.) The `@gjsify/tsc` bundled-toolchain `TYPESCRIPT_VERSION` (`packages/infra/tsc/src/index.ts`) MUST track this range. When bumping the TS range workspace-wide, update every `package.json` (incl. `templates/*` AND the integration tests) AND verify the lockfile + `gjsify run check` in the same PR — declaration-vs-resolution drift is what produced the v0.4.42 PR #385 CI break.

## Strategic direction — cross-runtime portability

GJS = primary target, NON-NEGOTIABLE. But many `@gjsify/*` packages are pure TS (no `gi://`/`@girs/*`/`imports.` value-deps) and therefore portable. Long-term vision: **"alles unter allem lauffähig"** — share what's shareable across GJS / Node / Browser; runtime-specific where not. Each package declares a runtime-triplet (`gjs` × `node` × `browser`), each slot ∈ {`polyfill`, `native`, `partial`, `none`}; the `--app <target>` alias layer routes `@gjsify/<X>` to the right slot.

|strategy: **opportunistic, not driven** — existing GJS-bound packages stay GJS-only (no refactor budget); NEW packages whose impl is pure-TS-portable anyway get cross-runtime treatment from day one; GJS remains test driver for everything (only runtime where all three pillars need polyfill)
|axis 1 (Node-API, `packages/node/*`) — wraps `node:*`; GJS-polyfill, Node-native, Browser-polyfill-possible
|axis 2 (Web-API, `packages/web/*`) — wraps W3C; GJS-polyfill, Browser-native, Node-polyfill-possible (today: `globals.mjs` re-export pattern)
|axis 3 (DOM, `packages/dom/*`) — DOM tree; GJS-polyfill, Browser-native, Node n/a today
|axis 4 (design-identity) — carry a runtime's design system to OTHER runtimes; today: `@gjsify/adwaita-{web,fonts,icons}` carries Libadwaita identity into the browser (Web Components + SCSS + fonts + icons)
|axis 5 (platform-bridge, future) — carry a runtime's NATIVE platform to OTHER runtimes; GTK-via-WebKit (`@gjsify/iframe` precedent for one specific case); long-term aspirational: GTK on Node via [`refs/node-gtk`](refs/node-gtk) (NOT actively worked; reference-only until a real consumer demands it); GTK on browser is a non-goal (design-identity axis is the right tool for that)
|slot routing per `--app` target: implemented by `packages/infra/resolve-npm/lib/runtime-aliases.mjs` reading each package's declared triplet at config-time and emitting a derived alias map COMPOSED UNDER the hardcoded `ALIASES_*_FOR_*` baseline (hardcoded wins on conflict). Rules: `polyfill`/`partial` → no rewrite (keep `@gjsify/<X>` resolving to the polyfill at `lib/esm/index.js`); `native` → `@gjsify/<X>/globals` (re-exports the runtime-native value); `none` → `@gjsify/empty`. A `native`-declared package missing its `globals.mjs` re-export file falls back to `@gjsify/empty` with a `[@gjsify/resolve-npm] ...` warn-once that surfaces the gap. `gjs` target keeps everything as `polyfill` per declaration; `node` target gets the `<pkg>/globals` re-export where slot=native (e.g. `@gjsify/assert` → `node:assert`); `browser` target follows the same rules for browser-natives.
|declared per package in `package.json#gjsify.runtimes`: `{"gjs":"polyfill","node":"native","browser":"native"}`
|pure-TS first-class examples (slot=polyfill on all three): `dom-events`, `dom-exception`, `abort-controller`, `string_decoder`, `querystring`, `path`, `buffer`, `formdata`, `message-channel`, `webstorage`
|GJS-only (slot=none off-GJS): `framework/*`, `webgl`, `canvas2d`, `webrtc`, `webaudio`, `gamepad`, `webkit`, `tls-native`, `terminal-native`, `webrtc-native`, `sab-native`, anything with `@girs/*` value imports
|already shipping cross-runtime: `adwaita-web`/`adwaita-fonts`/`adwaita-icons` (browser); 12 browser-test packages (`abort-controller`, `compression-streams`, `dom-events`, `domparser`, `eventsource`, `fetch`, `formdata`, `message-channel`, `streams`, `webcrypto`, `websocket`, `webstorage`)

**Graduation status (2026-05-28).** Cross-runtime portability is OUT of experimental status for the axes whose validation infrastructure is demonstrably exercising real consumers. Documentation in website / `gjsify --help` / README / package READMEs is unblocked per-axis as listed below. Avoid blanket "WinterCG-compatible" / "Node-compatible runtime" / similar runtime-class claims — describe what's actually validated, by name. `STATUS.md` continues to track audit-runtimes drift + slot-table per package as the single source of truth for the declared triplets.

| Axis | Graduation | Validated consumers |
|---|---|---|
| 1 — Node-API | ✓ Graduated | `tests/integration/{streamx,webtorrent,socket.io,chokidar,dotenv,ts-for-gir,…}` (10+ ports running on both Node and GJS via `@gjsify/{fs,stream,buffer,path,events,…}`); upstream `ts-for-gir` consumes `@gjsify/cli`+`@gjsify/path` on both Node and GJS bins |
| 2 — Web-API | ✓ Graduated | `tests/browser/` (Playwright Firefox/SpiderMonkey) drives 12 packages — `abort-controller`, `compression-streams`, `dom-events`, `domparser`, `eventsource`, `fetch`, `formdata`, `message-channel`, `streams`, `webcrypto`, `websocket`, `webstorage`; `tests/integration/autobahn` validates `@gjsify/{websocket,ws}` RFC 6455 conformance via the crossbario fuzzingserver |
| 3 — DOM | ✓ Graduated | `pixel-rpg/map-editor` uses `@gjsify/dom-elements`+`@gjsify/canvas2d-core` end-to-end via the Excalibur.js game engine (GJS+GTK target); `showcases/dom/excalibur-jelly-jumper` mirrors the same path with a browser-build target |
| 4 — Design-identity | ✓ Graduated since v0.4.28 (pre-strategy) | `@gjsify/adwaita-{web,fonts,icons}` shipped in `showcases/dom/{canvas2d-fireworks,excalibur-jelly-jumper,three-geometry-teapot,minimalist-browser,three-postprocessing-pixel,webrtc-loopback,webrtc-video}` browser builds + sister `easy6502/app-web` |
| 5 — Platform-bridge | Pre-graduation (single bridge, no external consumer yet) | `@gjsify/iframe`+`WebKit.WebView` exercised in `showcases/dom/minimalist-browser`; long-term Node-on-GTK path remains gated on a real consumer surfacing the need (`refs/node-gtk` stays read-only reference) |

**Convention for NEW packages:** the runtime axis is the FIRST clarification question. (a) needs `gi://*`/`@girs/*` value-imports → GJS-only (`runtimes.{node,browser}: "none"`); (b) pure TS, no platform-native deps → cross-runtime from day one (`runtimes.{gjs,node,browser}: "polyfill"`), test on all three; (c) native runtime equivalent exists → declare `"native"` for that slot, ship `<pkg>/globals` (Node) or browser-conditional export. Existing GJS-only packages are NOT refactored opportunistically — they stay as they are; the convention applies only to new package work and to packages already being touched for unrelated reasons (NO "while-I'm-here" scope creep in bug-fix PRs).

**Canonical exemplars** (mirror their `package.json` / `src/test.{mts,browser.mts}` layout when adding a new cross-runtime package): `@gjsify/abort-controller`, `@gjsify/dom-events`, `@gjsify/dom-exception` — all three declare `{gjs:"polyfill",node:"polyfill",browser:"native"}` and validate on GJS + Node + Browser via per-target `build:test:{gjs,node,browser}` scripts.

**Non-goals:** turning gjsify into a runtime; replacing Node/browser-native APIs where they exist; spec conformance beyond what a polyfill needs to behave correctly; forking / maintaining `refs/node-gtk` (it's reference, not a target); making GJS-bound packages cross-runtime by refactoring (only NEW pure-TS packages get the treatment from day one).

### Cross-Runtime Mobile (NativeScript) — 4. Runtime-Slot

NativeScript ist als 4. Runtime-Slot eingeführt (Welle 4-T). V8 (ES2024) auf iOS + Android via metadata-driven Native-Bridge — konzeptionell analog zu GJS↔GNOME, nur mit `java.io.File`/`NSFileManager` statt `imports.gi.Gio.File`.

|Triplet → Quadruplet: `{gjs, node, browser, nativescript}` in `package.json#gjsify.runtimes`
|Slot-Vokabular gleich wie bei den anderen Targets (`polyfill`/`native`/`partial`/`none`); `native` Slot redirected zu `@gjsify/<X>/globals` re-export wo vorhanden
|Optional: `package.json#gjsify.nativescriptPlatforms: ['ios','android']` (default beide) — erlaubt Capability-Deklaration auf Plattform-Subset-Niveau ohne den Slot zu doppeln. iOS/Android werden NICHT in separate Axes gesplittet (wir orientieren uns daran wie NS selbst es macht — ein `@nativescript/core` mit interner Plattform-Verzweigung). Revisitable: wenn iOS/Android-Divergenz beim Implementieren überstrapaziert wird, kann das Quintuplet später kommen — `VALID_TARGETS` in `runtime-aliases.mjs` ist ein 1-Line-Change
|Native-Bridge-Identifier (`java.*`, `android.*`, `androidx.*`, `kotlin.*`, `NS*`, `UI*`, `CG*`, `NSObject`) werden NICHT externalized + NICHT aliasiert — der NS-Runtime macht sie als globale Identifier verfügbar (wie GJS' `imports.gi.*`)
|Build: `gjsify build --app nativescript src/foo.ts --outfile dist/foo.ns.mjs` → ESM-Bundle, esnext target, codeSplitting:false. NS-Konsumer pipen das durch `@nativescript/webpack` oder `@nativescript/vite` als Entry-Datei
|Platform-File-Resolution: `platformResolvePlugin` (`packages/infra/rolldown-plugin-gjsify/src/plugins/platform-resolve.ts`) löst Plattform-Source-Varianten `foo.android.ts` / `foo.ios.ts` / `foo.native.ts` VOR `foo.ts` auf (Priorität `…<platform>` → `…native` → base). Plattform aus `NATIVESCRIPT_PLATFORM` / `NATIVESCRIPT_BUNDLER_ENV` (`detectNativescriptPlatform()`). Bewusst ein `resolveId`-**Hook**, KEINE `resolve.alias` — `@nativescript/vite`s funktionsbasierter Plattform-Alias wird von Vite 8 / Rolldown abgelehnt; gjsify behebt das an der Wurzel. In `app/nativescript.ts` + `gjsifyNativescript()` verdrahtet. Tests: `tests/e2e/ns-platform-resolve`
|Platform-Defines: `nativescriptPlatformDefines(platform,{dev})` backt die Standard-NS-Compile-Flags `__ANDROID__` / `__IOS__` / `__APPLE__` / `__VISIONOS__` / `__DEV__` in `transform.define` (Rolldown) bzw. `define` (Vite) → Per-Plattform-Branches werden statisch aufgelöst + dead-code-eliminiert. Matcht die Globals, die `@nativescript/vite` in seinem Main-Entry seedet
|Build-Feature-Ownership (Roadmap): die NS-runtime-spezifischen Features von `@nativescript/vite` (Plattform-Resolution ✓ Level 2, Main-Entry/Bundle-Emit + @NativeClass + static-copy = Level 3) wandern schrittweise in gjsifys eigenes Build-System. Level-3-Blocker: NS' CLI-Bundler-Dispatch ist ein hartcodierter Switch (`webpack`\|`rspack`\|`vite`) → `bundler: 'gjsify'` braucht einen Upstream-CLI-PR. Tracked in STATUS.md Open TODOs
|Vite-8-Composer: `@gjsify/nativescript-vite` (`packages/infra/nativescript-vite/`) — dünner Composer der `@nativescript/vite`s `typescriptConfig({mode})` lädt + die Vite-8/Rolldown- + Type-Check-Inkompatibilitäten auf dem returned Config-Objekt fixt: (1) DROPPT alle `resolve.alias`-Einträge mit Funktions-`replacement` (Rolldown lehnt sie ab — `Failed to convert builtin plugin 'ViteAlias' … function replacement into rust type String`; der `nativescript-package-resolver` resolveId-Plugin + die String-`~/`/`@`-Aliase decken die Resolution ab), (2) ENTFERNT das Plugin `'commonjs'` (`@rollup/plugin-commonjs` crasht Rolldown mit `currentLoadingModule`; Rolldown macht CJS nativ), warnt wenn nicht gefunden, (3) ENTFERNT das Plugin `'ns-typescript-check'` — ein Bundler bundelt, type-checkt nicht; gjsify deferred den Type-Gate an `gjsify tsc` / das eigene `check`-Script (wie Vites esbuild/SWC-Pipeline). Der vite-seitige Check fährt zudem ein SEPARATES Programm das die vollen `@nativescript/types`-Android-Globals lädt und unter TS 6+ den STANDARD-NS-`createNativeView(): android.view.View`-Override fatal flaggt (eine Kovarianz die das app-eigene `tsc --noEmit` akzeptiert) → würde jeden Build auf einem universellen NS-Idiom failen. Strip statt Silence — Typfehler tauchen in `gjsify tsc` auf, dem echten Gate. e2e `tests/e2e/ns-vite-fixes`. Spreaded danach `gjsifyNativescript()` aus `@gjsify/vite-plugin-gjsify` (gi://→empty, Platform-Resolution, Platform-Defines, Node-Aliase inkl. `module`→`@gjsify/module`). Export: `defineNativescriptConfig(opts?, userConfig?)` → async Vite-Config-Funktion (zweites Arg = eigene Vite-Config, mergeConfig'd zuletzt — composability-Seam z.B. für `external()`). Konsumer: `vite.config.ts` → `export default defineNativescriptConfig();` + `nativescript.config.ts` → `bundler: 'vite'`. NS-Pakete (`@nativescript/{vite,core,canvas,canvas-polyfill}`, `nativescript`, `vite ^8`) = OPTIONAL Peers; einzige harte Dep = `@gjsify/vite-plugin-gjsify`. Validiert: pristine `@nativescript/vite` 2.0.3 + Composer baut `@nativescript/canvas` three.js Teapot auf Vite 8.0.16 → 612 Module → `bundle.mjs` (~450 kB), `ns run android` rendert den Teapot, 0 `@nativescript/vite`/`gi://`/`@girs`-Leakage. Ein-Datei-Alternative zum manuellen `[nativescript(), ...gjsifyNativescript()]`-Spread
|Vite-Plugin-Track: `gjsifyNativescript()` Preset aus `@gjsify/vite-plugin-gjsify` (Schwesterstück zu `gjsifyBrowser()`) für NS 9.0+ Vite-Builds (low-level Plugin-Array; der `@gjsify/nativescript-vite`-Composer ist der high-level Ein-Datei-Weg). Konsumer-Pattern:
```ts
import nativescript from '@nativescript/vite';
import { gjsifyNativescript } from '@gjsify/vite-plugin-gjsify';
export default defineConfig({ plugins: [nativescript(), ...gjsifyNativescript()] });
```
|xmlns-Barrel-Registrierung: `gjsifyNativescript()` enthält das Plugin `gjsify-nativescript-xmlns-barrels` — registriert Barrel-Module die eine NS-App NUR via XML `xmlns="~/MOD"` referenziert (`~/widgets/index`, `~/mdx/index`). `@nativescript/vite`s `ns-bundler-context` registriert XML + paired Code-behind + CSS, aber KEINE standalone Barrels (`index.ts` ohne `.xml`-Geschwister) → `global.loadModule("widgets/index")` gibt `null` (ESM-Bundle hat keinen `global.require`-Fallback) → `Module 'SourceView' not found` (`@nativescript/webpack`s `xml-namespace-loader` registrierte jedes `.ts`, daher dort kein Problem). Das Plugin AUGMENTIERT das generierte `virtual:ns-bundler-context`-Modul (früh importiert, vor `Application.run`): scannt App-XML nach `xmlns="~/MOD"` + prependet pro Barrel OHNE `.xml`-Geschwister ein `import * as` + appendet einen `registerModule(...)`-Call. Liegt in `gjsifyNativescript()` → greift für BEIDE Pfade (Composer + low-level Spread). Validiert on-device: easy6502 app-android rendert alle Views OHNE den app-seitigen `register-xml-modules.ts`-Workaround. e2e: `tests/e2e/ns-vite-fixes`
|Audit: `scripts/audit-runtimes.mjs` ist quadruplet-aware. `nativescript` Slot ist OPTIONAL für bestehende Packages (Foundation = ergänzt den Slot-Mechanismus, per-package Backfill ist Welle 5). Wenn ein Package `nativescript` nicht deklariert, wird der Drift-Check für diesen Slot übersprungen
|Reference-Sources: 6 NativeScript-Submodules unter `refs/nativescript*` (siehe `## References — refs/` → `### Mobile (NativeScript)`)

**Universelle Core-Packages (Konvention, kein Pflicht):** Wenn ein `@gjsify/X` auf ≥3 Runtimes mit gemeinsamer pure-TS-Logik läuft, kann es in `@gjsify/X-core` (platform-agnostische Logik) + dünne Per-Platform-Adapter (`@gjsify/X`) extrahiert werden. Pro Welle/Agent zu entscheiden — kein automatisches Refactoring. Beispiel-Kandidaten: `@gjsify/fs-core` (POSIX-shape interface, alle Platform-Bridges importieren), `@gjsify/path-core` (pure POSIX/win32 logic).

### Sixth axis — bundled toolchains (Node-free build chain)

Orthogonal to the five runtime-portability axes above: NPM toolchains that are themselves plain TS/JS (no native deps, no `node-api` addons) can be re-bundled with `gjsify build --app gjs` and run under GJS — giving a Node-free version of the tool without reimplementing it. First exemplar:

- **`@gjsify/tsc`** (`packages/infra/tsc/`) — wraps upstream `typescript`'s `lib/_tsc.js` CLI entry into a ~3.6 MiB GJS bundle shipped as the `gjsify-tsc` bin. Bundles **TypeScript 6.0.3** (tracks the workspace TS invariant). `typescript` itself stays a `devDependency` (build-time only); the published bundle has no runtime `typescript` dep. Triplet `{gjs: "polyfill", node: "none", browser: "none"}` — GJS-only artifact; on Node, downstream uses upstream `typescript` directly. Bundle is **committed** to `dist/tsc.gjs.mjs` and re-included in root `.gitignore` (same `dist/cli.gjs.mjs` precedent). Rebuild via `gjsify workspace @gjsify/tsc build` (`scripts/build-bundle.mjs`). Pinned upstream version in `src/index.ts` as `TYPESCRIPT_VERSION`.
  - **gjsify SELF-HOSTS its type-checking on it.** Every package's `check` script is `gjsify tsc --noEmit` (NOT upstream `tsc`) — gjsify dogfoods its own Node-free compiler for the workspace's type-gate (a Node-free-build-chain step). Validated: full `gjsify run check` + `check:examples` green, identical to node `tsc` (incl. the CLI checking itself — the self-host circularity bootstraps off the committed bundle). Perf ≈ **1.3× node `tsc` at full-workspace parallel scale** (single-package is ~2.3× but startup-dominated, so it amortizes). Runs in CI because the check job is the **Fedora/GJS container** (gjs present). `typescript` remains the build-time devDep (the bundle is built from it). **`build:types` (the `.d.ts` emit) is ALSO `gjsify tsc`** (84 scripts incl. the `-p tsconfig.build.json` + `-b --force` project-reference variants) — emit-under-GJS validated **byte-identical** to node `tsc` (`@gjsify/path` 6 + `@gjsify/fetch` 2 `.d.ts` byte-for-byte), and `gjsify foreach build:types` (84) + a full `gjsify run check` against the gjsify-tsc-emitted `.d.ts` both green. So gjsify type-checks AND emits its published `.d.ts` with its own Node-free compiler; `typescript` is now only the seed the `@gjsify/tsc` bundle is built from. A bug in `@gjsify/tsc` would break every workspace `check`/`build:types`, so the self-host-tsc e2e (`tests/e2e/self-host-tsc`) guards it.
  - **Default-library (`lib.*.d.ts`) resolution — the drop-in fix.** tsc finds its default libs as `dirname(getExecutingFilePath())` === `dirname(__filename)` of `_tsc.js`. A consumer of `@gjsify/tsc` has no upstream `typescript`, so the libs must ship inside the package: `build-bundle.mjs` copies `lib*.d.ts` into `packages/infra/tsc/lib/` (shipped via `package.json#files` `lib/lib*.d.ts`) and re-points the bundle's runtime `__filename`/`__dirname` spec from `typescript/lib/_tsc.js` → `@gjsify/tsc/lib/_tsc.js`, so `getDefaultLibLocation()` deterministically resolves to the shipped, version-locked libs (`@gjsify/tsc` is always resolvable from the bundle, `typescript` is not). **The ~108 generated `lib*.d.ts` ARE committed** (re-included via a `.gitignore` exception, exactly like `dist/tsc.gjs.mjs`). They are also reproduced by `build-bundle.mjs` (copied from the `typescript` devDep **before** the bundle build) + shipped via `files`. The **v0.4.37–0.4.42 "empty `lib/`" regression** (`error TS6053: lib.esnext.d.ts not found` + a `TS2318: Cannot find global type …` cascade on every consumer) was **NOT** a gitignore or build-timing problem — the libs were always on disk at pack time. The real bug: **gjsify's own packer (`cli/src/commands/pack.ts`) did not expand `files` GLOBS**, so the entry `lib/lib*.d.ts` matched nothing and shipped **0** files. A plain-directory entry (`@gjsify/path`'s `files: ["lib"]`) packed fine; a glob (`lib/lib*.d.ts`) silently shipped nothing — `npm pack` expanded it, `gjsify publish` did not. Fixed by implementing glob expansion in `expandFilesPatterns` + `filesGlobToRegExp` (e2e: `tests/e2e/publish-files-glob`). Committing the libs is an independent self-contained-tool choice (tracked-correct, version-locked, like the bundle — the ~76k-line cost is accepted: the repo already commits the bundle + the zero-install `.yarn` cache); the **packer glob fix** is what actually includes them in the tarball. They MUST match the bundle's `TYPESCRIPT_VERSION` — rebuild after a TS bump (a stale `node_modules/typescript` copies the wrong lib set: TS-5.9's 100 vs TS-6's 108, missing the `es2025.*` libs `lib.esnext` references). The runtime resolution itself rides the shared `module-resolve` shim — `rolldown-plugin-gjsify`'s `rewrite-node-modules-paths.ts` **case 4 (CJS)** now uses the same location-independent runtime resolver as case 1 (ESM) when `runtimeResolve` is on, instead of baking the build machine's absolute path (which caused `TS6053: …/lib.esnext.d.ts not found` + a `TS2318: Cannot find global type …` cascade on every consumer).

Pattern (mirror when adding a new bundled toolchain — e.g. `@gjsify/oxlint`, `@gjsify/prettier`, `@gjsify/eslint`):
1. Package lives in `packages/infra/<tool>/`, declares `runtimes.{gjs: "polyfill", node: "none", browser: "none"}`.
2. `scripts/build-bundle.mjs` runs `gjsify build node_modules/<tool>/<dist-entry>.js --app gjs --shebang` against a `devDependency` of the upstream tool. Uses the workspace-local `node_modules/.bin/gjsify` Node-CLI on PATH (the global GJS-bundle CLI currently fails sub-package `rolldown` resolution — separate bug).
3. `dist/<bin>.gjs.mjs` is committed (heavy artifact, no per-install rebuild) and re-included via a paired root-`.gitignore` exception. `files: ["dist/<bin>.gjs.mjs"]` ships it in the npm tarball.
4. `bin: { "gjsify-<tool>": "./dist/<bin>.gjs.mjs" }` — namespaced bin to avoid PATH collisions with upstream's `<tool>` bin.
5. `src/index.ts` is a metadata stub exporting `<TOOL>_VERSION` (pinned) and `<TOOL>_BUNDLE_PATH` (absolute path resolver) — programmatic API re-exports land here once a separate `./library` subpath bundle is built from the tool's library entry point.
6. NOT a polyfill; do NOT mark as `polyfill` slot if the tool ISN'T re-implemented for cross-runtime — `none` for Node/Browser keeps the alias layer honest.
7. **Runtime data files** (a tool that reads its own files at runtime — e.g. tsc's `lib.*.d.ts`, a linter's rule configs): these don't travel with the bundle automatically. Copy them into the package's shipped `files` in `build-bundle.mjs` and rely on the `module-resolve` shim that `rewrite-node-modules-paths.ts` already wires into the bundle's `__dirname`/`__filename`/`import.meta.url` (location-independent — resolves relative to the *installed* bundle, NOT the build machine). If the tool resolves data files via its own package name, re-point the baked path spec to `@gjsify/<tool>/<shipped-dir>/…` in `build-bundle.mjs` so resolution stays deterministic regardless of what the consumer has installed (see `@gjsify/tsc`'s lib retarget). **COMMIT the copied data files** (same as the `dist/<bin>.gjs.mjs` bundle — re-include via a `.gitignore` exception): tracked-correct, version-locked, self-contained. **And list them with a `files` entry the gjsify packer actually expands.** The v0.4.37–0.4.42 `@gjsify/tsc` "empty `lib/`" regression was NOT caused by gitignore or build timing — the libs were on disk at pack time — but by **gjsify's packer not expanding `files` GLOBS**: `files: ["…","lib/lib*.d.ts"]` matched 0 files (a plain-dir entry `["lib"]` would have worked; `npm pack` expanded the glob, `gjsify publish` silently did not). Fixed in `cli/src/commands/pack.ts` (`expandFilesPatterns` + `filesGlobToRegExp`, e2e `tests/e2e/publish-files-glob`) — but the lesson stands: after adding committed data files, **verify they are actually in the tarball** (`gjsify pack` then `tar tzf`), don't assume a `files` glob ships them. Committing (~108 `lib*.d.ts` = ~76k lines for tsc) is the accepted cost of a self-contained published tool. They MUST be rebuilt after a version bump (a stale `node_modules` copies the wrong set), so keep the build-copy in `build-bundle.mjs` too (it copies them BEFORE the bundle build, so a local rebuild refreshes them even if the bundle build fails) — committed + reproducible, like the bundle.

Non-goal for this axis: bundling Node-API/native-addon tools (Rolldown, oxc binaries, esbuild). Those stay Node-resolved via `oxc-resolve.ts`-style PATH walkers — the bundled-toolchain pattern is for pure-TS/JS tools only.

### Bundled-artifact dependency classification — `dependencies` vs `devDependencies`

A package belongs in `dependencies` **IFF something a consumer runs needs it present on disk at runtime.** The trap with the bundled-artifact pattern is assuming "it's inlined into the GJS bundle ⇒ it's a devDependency." That holds **only when the bundle is the sole consumed artifact.** It is WRONG whenever the package ALSO ships a Node entry that resolves the same deps from `node_modules`. Decide per-package by counting the entry points:

- **Pure-bundle package — `@gjsify/tsc`** (`bin: dist/tsc.gjs.mjs`, no Node `lib/` consumed by anyone). The GJS bundle inlines everything, so `typescript` is genuinely a build-time-only `devDependency`; the published tarball has no runtime `typescript` dep. The bundled→devDep rule applies cleanly here.
- **Dual-entry package — `@gjsify/cli`** (`bin: lib/index.js` (Node) **AND** `gjsify.bin: dist/cli.gjs.mjs` (GJS)). npm installs the package and wires the `bin` to the **Node** entry, whose `lib/**` `import`s its deps from `node_modules` at runtime — even though those same packages are *also* inlined into the GJS bundle. So `cosmiconfig`, `yargs`, `get-tsconfig`, `pkg-types`, `@gjsify/{workspace,npm-registry,resolve-npm,tar,semver,buffer,node-globals,rolldown-plugin-*}`, the polyfill metas — all stay in `dependencies`. Only genuinely build/test-only tools (`typescript`, `@gjsify/unit`, `@types/*`) are `devDependencies`. **Moving a `lib/**`-imported dep to `devDependencies` breaks `gjsify` when installed as a normal npm dependency** — guarded by `tests/e2e/create-app` (scaffolds a project that depends on `@gjsify/cli` and runs its bin: a misclassified dep fails the build with `ERR_MODULE_NOT_FOUND: Cannot find package '<dep>'`).

Optional GJS-native fast-paths that have an npm fallback already on disk → **optional `peerDependencies`** (`peerDependenciesMeta.<name>.optional: true`), e.g. `@gjsify/rolldown-native` (falls back to npm `rolldown`).

**Keeping on-disk runtime deps in lockstep with the bundle:** `gjsify self-update` resolves the production `dependencies` tree by default (`--skip-deps` for the bundle-only fast path), so a `gjsify` update pulls the matching native bridges / `rolldown` / `lightningcss` / `@gjsify/tsc` rather than leaving them skewed at the version the original `install.mjs` laid down. This is only safe because every `@gjsify/*` package is published to the public registry; if a workspace-internal package were ever unpublished, resolving the production tree would 406 (the historical `@gjsify/v8` failure) and `self-update` would need `--skip-deps` or a curated pull instead.

## JS Feature Availability

### SM140 (GJS 1.86+, current) — ES2024 + extras

Minimum supported runtime is **GJS 1.86 / SpiderMonkey 140** (Fedora 43+). SM128 (GJS 1.84) is no longer supported.

**Available:** Object/Map.groupBy | Promise.withResolvers | Set methods(intersection,union,difference,symmetricDifference,isSubsetOf,isSupersetOf,isDisjointFrom) | Array.fromAsync | structuredClone | SharedArrayBuffer | Intl.Segmenter | globalThis | ??/?. | ??=/||=/&&= | top-level await | private/static fields | WeakRef | FinalizationRegistry | **Error.captureStackTrace native** | **Iterator helpers** | **`import...with{type:"json"}`** | **Temporal** (preview) | Float16Array, Math.f16round() | Uint8Array.{fromBase64,toBase64,fromHex,toHex} | RegExp.escape() | Promise.try() | JSON.rawJSON/isRawJSON | Intl.DurationFormat | Math.sumPrecise | Atomics.pause | Error.isError

Polyfills inherited from the SM128 era still load on SM140 (idempotent, no-op when native exists). They will be retired package by package as native SM140 paths are validated.

## Writing agent context files

Pipe-delimited | single-line directives | strip prose | abbreviated keys (req,opt,str,int,bool,len,min,max,def) | flatten with brace expansion | "Prefer retrieval-led reasoning" preamble. Compression: 70–80% token reduction | preserve actionable info + structural boundaries | keep non-obvious code examples | never compress error messages / edge case docs.
