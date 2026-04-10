# gjsify — Project Status

> Last updated: 2026-04-10 (@gjsify/webaudio: Web Audio API via GStreamer 1.26 — AudioContext, decodeAudioData, AudioBufferSourceNode playback, GainNode volume, HTMLAudioElement format detection. 29 tests. Jelly Jumper showcase now has real audio)

## Summary

gjsify implements Node.js, Web Standard, and DOM APIs for GJS (GNOME JavaScript / SpiderMonkey 128).
The project comprises **39 Node.js packages**, **15 Web API packages**, **5 DOM packages**, **4 GJS infrastructure packages**, and **9 build/infra tools**.

| Category | Total | Full | Partial | Stub |
|----------|-------|------|---------|------|
| Node.js APIs | 39 | 32 (82%) | 3 (8%) | 4 (10%) |
| Web APIs | 15 | 14 (93%) | 1 (7%) | — |
| DOM APIs | 5 | 5 (100%) | — | — |
| Browser UI | 1 | 1 | — | — |
| Showcases | 5 | 5 | — | — |
| GJS Infrastructure | 4 | 3 | 1 (types) | — |
| Build/Infra Tools | 9 | 9 | — | — |

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
| **events** | — | 255+ (2 specs) | EventEmitter, once, on, listenerCount, setMaxListeners, errorMonitor, captureRejections, getEventListeners, prependListener, eventNames, rawListeners, Symbol events, async iterator, **makeCallable** (`.call(this)` + `util.inherits` CJS compat) |
| **fs** | Gio, GLib | 465 (9 specs) | sync, callback, promises, streams, FSWatcher, symlinks, FileHandle (read/write/truncate/writeFile/stat/readFile/appendFile), access/copyFile/rename/lstat, mkdir/rmdir/mkdtemp/chmod/truncate, ENOENT error mapping, fs.constants (O_RDONLY/WRONLY/RDWR/CREAT/EXCL/S_IFMT/S_IFREG), readdir options (withFileTypes, encoding), appendFileSync, mkdirSync recursive edge cases |
| **globals** | — | 221 | process, Buffer, structuredClone (full polyfill), TextEncoder/Decoder, atob/btoa, URL, setImmediate. Root export is pure; side effects live in `@gjsify/node-globals/register`. Users opt in via the `--globals` CLI flag (default-wired in the `@gjsify/create-app` template) or an explicit `import '@gjsify/node-globals/register'`. |
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
| **stream** | — | 509 (7 specs) | Readable, Writable, Duplex, Transform (**_flush** edge cases, constructor options, objectMode, split HWM, destroy, final/flush ordering, ERR_MULTIPLE_CALLBACK), PassThrough, objectMode, backpressure (**drain events**, **HWM=0**), **pipe** (event, cleanup, error handling, multiple dest, unpipe, same dest twice, needDrain, objectMode→non-objectMode), **inheritance** (instanceof hierarchy, util.inherits single/multi-level, stream subclassing), destroy, **pipeline** (error propagation, multi-stream), **finished** (premature close, cleanup), **addAbortSignal**, **Readable.from** (array/generator/async generator/string/Buffer), consumers (text/json/buffer/blob/arrayBuffer), promises (pipeline/finished), **async iteration**, **_readableState/_writableState** (highWaterMark, objectMode, pipes), **Symbol.hasInstance** (Duplex/Transform/PassThrough instanceof Writable) |
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

All 13 packages have real implementations:

| Package | GNOME Libs | Tests | Web APIs |
|---------|-----------|-------|----------|
| **abort-controller** | — | 23 (2 specs) | AbortController, AbortSignal (.abort, .timeout, .any) |
| **compression-streams** | — | 29 | CompressionStream, DecompressionStream (gzip/deflate/deflate-raw). Uses @gjsify/web-streams TransformStream |
| **dom-events** | — | 142 (3 specs) | Event, EventTarget, CustomEvent |
| **dom-exception** | — | 64 | DOMException polyfill (WebIDL standard) |
| **eventsource** | — | 15 | EventSource (Server-Sent Events), TextLineStream. Uses fetch + Web Streams |
| **fetch** | Soup 3.0, Gio, GLib | 51 | fetch(), Request, Response, Headers, Referrer-Policy, **file:// URI support** |
| **formdata** | — | 49 | FormData, File, multipart encoding |
| **streams** | — | 283 | ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream, ByteLengthQueuingStrategy, CountQueuingStrategy (WHATWG Streams polyfill for GJS) |
| **webcrypto** | — | 486 | SubtleCrypto (digest, AES-CBC/CTR/GCM, HMAC, ECDSA, RSA-PSS, RSA-OAEP, PBKDF2, HKDF, ECDH, generateKey, importKey/exportKey, deriveBits/deriveKey), CryptoKey |
| **web-globals** | — | 66 | Unified re-export surface for all Web API packages. Root export is pure named re-exports; side effects (registering URL, URLSearchParams, Blob, File, FormData, performance, PerformanceObserver + chaining every sub-package's `/register`) live in `@gjsify/web-globals/register`. Users opt in via the `--globals` CLI flag or an explicit `import '@gjsify/web-globals/register'`. |
| **websocket** | Soup 3.0, Gio, GLib | 27 | WebSocket, MessageEvent, CloseEvent (W3C spec) |
| **webaudio** | Gst 1.0, GstApp 1.0 | 32 | AudioContext (decodeAudioData via GStreamer decodebin, createBufferSource, createGain, currentTime via GLib monotonic clock), AudioBuffer (PCM Float32Array storage), AudioBufferSourceNode (GStreamer appsrc→audioconvert→volume→autoaudiosink), GainNode (AudioParam with setTargetAtTime), AudioParam, HTMLAudioElement (canPlayType, playbin playback). **Phase 1 — covers Excalibur.js** |
| **gamepad** | Manette 0.2 | 19 | Gamepad (navigator.getGamepads polling via libmanette event-driven signals), GamepadButton (pressed/touched/value), GamepadEvent (gamepadconnected/gamepaddisconnected on globalThis), GamepadHapticActuator (dual-rumble with strong/weak magnitude). Button mapping: Manette→W3C standard layout (17 buttons incl. triggers-as-buttons). Axis mapping: 4 stick axes + trigger axes→button values. Lazy Manette.Monitor init, graceful degradation without libmanette. |
| **webstorage** | — | 41 | Storage, localStorage, sessionStorage (W3C Web Storage) |

## DOM Packages (`packages/dom/`)

| Package | GNOME Libs | Tests | APIs |
|---------|-----------|-------|------|
| **dom-elements** | GdkPixbuf | 210 | Node(ownerDocument→document, event bubbling via parentNode), Element(setPointerCapture, releasePointerCapture, hasPointerCapture), HTMLElement(getBoundingClientRect, **dataset/DOMStringMap**), HTMLCanvasElement (base DOM stub), HTMLImageElement (**data: URI support**), Image, Document(body→documentElement tree), Text, Comment, DocumentFragment, DOMTokenList, MutationObserver, ResizeObserver, IntersectionObserver, Attr, NamedNodeMap, NodeList. Auto-registers `globalThis.{Image,HTMLCanvasElement,document,self,devicePixelRatio,alert,AbortController,AbortSignal,fetch,Request,Response,Headers}` |
| **canvas2d** | Cairo, GdkPixbuf, PangoCairo | — | CanvasRenderingContext2D (**HSL/HSLA color parsing**, **shadowBlur approximation**, drawImage via paint+clip, composite operations), CanvasGradient, CanvasPattern, Path2D, ImageData, **FontFace** (pixel-perfect font rendering via PangoCairo), Canvas2DWidget→Gtk.DrawingArea |
| **webgl** | gwebgl, Gtk 4, Gio | 12 | WebGLRenderingContext (1.0), WebGL2RenderingContext (2.0, overrides texImage2D/texSubImage2D/drawElements for GLES3.2 compat, native FBO completeness delegation, GLSL 1.0 compatibility for versionless shaders, **clearBufferfv/iv/uiv/fi**, **premultipliedAlpha support**), HTMLCanvasElement (GTK-backed), CanvasWebGLWidget (Gtk.GLArea subclass, rAF, resize re-render, **eager context init**), Extensions |
| **event-bridge** | Gtk 4.0, Gdk 4.0 | — | attachEventControllers(): GTK4 controllers→DOM MouseEvent/PointerEvent/KeyboardEvent/WheelEvent/FocusEvent, **window-level keyboard listeners** |
| **iframe** | WebKit 6.0 | — | HTMLIFrameElement, IFrameWidget→WebKit.WebView, postMessage bridge |

## Browser UI Packages (`packages/web/adwaita-web/`)

| Package | Tests | APIs |
|---------|-------|------|
| **adwaita-web** | — | AdwWindow, AdwHeaderBar, AdwPreferencesGroup, AdwSwitchRow, AdwComboRow, AdwSpinRow, AdwToastOverlay, AdwOverlaySplitView, AdwCard. Custom Elements (light DOM). SCSS source partials in `scss/` (mirroring `refs/adwaita-web/scss/`) compiled to `dist/adwaita-web.css` via the `sass` package. Light/dark theme via CSS variables. Consumers import `@gjsify/adwaita-web` (registers custom elements + Adwaita Sans font) plus `@gjsify/adwaita-web/style.css` (or via SCSS partials at `@gjsify/adwaita-web/scss/*`). No GJS deps |
| **adwaita-fonts** | — | Adwaita Sans font files (fontsource-style). CSS @font-face + TTF files. SIL OFL 1.1 |
| **adwaita-icons** | — | Adwaita symbolic icons as importable SVG strings (categories: actions, devices, mimetypes, places, status, ui, …). `toDataUri()` utility. Sourced from `refs/adwaita-icon-theme/`. CC0-1.0 / LGPLv3 |

### Adwaita Web Framework Roadmap

Long-term goal: complete the `@gjsify/adwaita-web` framework so it can replace the styling layer of `refs/adwaita-web/scss/` while keeping our Web Components abstraction. Currently 9 components ported; ~40 SCSS partials remain in the reference. Planned port order (each adds a custom element + SCSS partial + AGENTS attribution):

| Status | Component | Source partial |
|---|---|---|
| ✅ Done | `<adw-window>`, `<adw-header-bar>`, `<adw-preferences-group>`, `<adw-card>`, `<adw-switch-row>`, `<adw-combo-row>`, `<adw-spin-row>`, `<adw-toast-overlay>`, `<adw-overlay-split-view>` | `_window.scss`, `_headerbar.scss`, `_preferences.scss`, `_card.scss`, `_switch_row.scss`, `_combo_row.scss`, `_spin_button.scss`, `_toast.scss`, (libadwaita C source) |
| Planned | `<adw-button>` (flat / suggested / destructive) | `_button.scss`, `_button_row.scss` |
| Planned | `<adw-entry>` / `<adw-entry-row>` | `_entry.scss`, `_entry_row.scss` |
| Planned | `<adw-action-row>` | `_action_row.scss` |
| Planned | `<adw-checkbox>` / `<adw-radio>` | `_checkbox.scss`, `_radio.scss` |
| Planned | `<adw-dialog>` / `<adw-about-dialog>` | `_dialog.scss`, `_about_dialog.scss` |
| Planned | `<adw-popover>` | `_popover.scss` |
| Planned | `<adw-banner>` / `<adw-bottom-sheet>` | `_banner.scss`, `_bottom_sheet.scss` |
| Planned | `<adw-tabs>` / `<adw-view-switcher>` | `_tabs.scss`, `_viewswitcher.scss` |
| Planned | `<adw-progress-bar>` / `<adw-spinner>` | `_progressbar.scss`, `_spinner.scss` |
| Planned | `<adw-status-page>` | `_status_page.scss` |
| Planned | `<adw-toggle-group>` / `<adw-split-button>` | `_toggle_group.scss`, `_split_button.scss` |
| Planned | `<adw-expander-row>` / `<adw-carousel>` | `_expander_row.scss`, `_carousel_indicators.scss` |
| Planned | `<adw-avatar>` / `<adw-label>` / `<adw-icon>` | `_avatar.scss`, `_label.scss`, `_icon.scss` |
| Planned | Utility classes & layout helpers (`_box.scss`, `_wrap_box.scss`, `_listbox.scss`, `_toolbar_view.scss`, `_utility_classes.scss`) | various |

Each port must add a SPDX header to the SCSS partial citing `refs/adwaita-web/adwaita-web/scss/_<name>.scss` and/or `refs/libadwaita/src/stylesheet/widgets/_<name>.scss` per the AGENTS.md Source Attribution rules.

### WebGL Known Issues

Issues discovered while porting Three.js demos. Non-fatal but should be addressed for full compatibility.

| Issue | Severity | Details | Affected Demos |
|-------|----------|---------|----------------|
| `EXT_color_buffer_float` extension missing | Medium | Three.js requests this extension for `HalfFloatType` render targets. Not implemented in extension registry. Rendering works but with fallback quality. | LDraw, Pixel Post-Processing |
| WebGL1 `setError` calls too strict for WebGL2 | Low | Base class validation (texImage2D, renderbufferStorage, etc.) uses WebGL1 format/type rules. WebGL2 allows more combinations (R8, RG8, RGBA16F, DEPTH_COMPONENT24, etc.). Non-fatal — native GL still executes the calls. | All WebGL2 demos |
| WebGL1 framebuffer color attachment validation too strict | Low | Base `_preCheckFramebufferStatus` only accepts RGBA/UNSIGNED_BYTE or RGBA/FLOAT. WebGL2 override delegates to native driver. WebGL1 with extensions (OES_texture_half_float) still rejects valid formats. | Post-processing with WebGL1 |

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
| **esbuild-plugin-blueprint** | Compile `.blp` files via blueprint-compiler→XML | Full |
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
| **Gst 1.0** | webaudio (audio decoding + playback) |
| **GstApp 1.0** | webaudio (appsrc/appsink for PCM I/O) |

---

## Metrics

| Metric | Value |
|--------|-------|
| Total Node.js packages | 39 |
| Fully implemented | 32 (82%) |
| Partially implemented | 3 (8%) |
| Stubs | 4 (10%) |
| Web API packages | 15 (14 full, 1 partial) |
| DOM packages | 5 (all implemented) |
| Browser UI packages | 1 (adwaita-web) |
| GJS infrastructure packages | 4 (unit, utils, runtime, types) |
| Build tools | 9 (infra/) |
| Total test cases | 10,100+ |
| Spec files | 106 |
| Showcases | 5 (Canvas2D Fireworks, Three.js Teapot, Three.js Pixel Post-Processing, Excalibur Jelly Jumper, Express Webserver) |
| Real-world examples | 11+ (Express, Koa, Static file server, SSE chat, Hono REST, WS chat, file search, DNS lookup, worker pool, GTK dashboard, Three.js teapot) |
| GNOME-integrated packages | 13 (25%) |
| Alias mappings (GJS) | 60+ |
| Reference submodules | 42 |

---

## Priorities / Next Steps

### Completed

- ~~**Web Streams API**~~✓ — `@gjsify/web-streams` (72 tests). ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream, queuing strategies.
- ~~**WebCrypto (crypto.subtle)**~~✓ — `@gjsify/webcrypto` (42 tests). SubtleCrypto: digest, AES-CBC/CTR/GCM, HMAC, ECDSA, RSA-PSS, RSA-OAEP, PBKDF2, HKDF, ECDH, importKey/exportKey, generateKey.
- ~~**EventSource**~~✓ — `@gjsify/eventsource` (24 tests). Server-Sent Events via fetch + Web Streams.
- ~~**WebCrypto ECDSA/RSA-PSS/RSA-OAEP**~~✓ — Implemented: ECDSA (RFC 6979), RSA-PSS (RFC 8017), RSA-OAEP (RFC 8017), MGF1.
- ~~**Unified web-globals package**~~✓ — `@gjsify/web-globals` as single re-export surface for all Web API globals. DOMException extracted to `@gjsify/dom-exception`.
- ~~**Tree-shakeable globals (`/register` subpath refactor)**~~✓ — every global-providing package now exposes a pure root export and a side-effectful `/register` subpath. Root imports are tree-shakeable; global registration is opt-in via `/register` or the `gjsify build --globals` CLI flag. See the [Tree-shakeable Globals section in AGENTS.md](AGENTS.md#tree-shakeable-globals--register-subpath-convention) for the rules.
- ~~**Explicit `--globals` CLI flag**~~✓ — `gjsify build --globals fetch,Buffer,process,URL,crypto,structuredClone,AbortController` wires the matching `/register` modules into the bundle. Default list pre-wired in the `@gjsify/create-app` template `package.json` script. No auto-scanning — heuristic scanners leaked too many edge cases (isomorphic library guards, dynamic imports, bracket-notation global access).
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

## Open TODOs

Tracked follow-up work that has been deliberately deferred. Every "out of scope" or "follow-up" note from a PR or implementation plan must end up here so future sessions can pick it up.

### Browser Testing Infrastructure for DOM Packages

**Priority: High — architectural gap**

DOM tests (`packages/dom/*`) currently only run on GJS. The correct test target for DOM behaviour is a **real browser**, not Node.js. Node.js lacks a DOM and would require heavy polyfilling that obscures whether our implementation is correct. We do not yet have a browser test runner integrated into the monorepo.

**What is needed:**
- A browser test runner (e.g. Playwright, WPT harness, or a `gjsify build --app browser` + headless Chromium setup) that executes `*.spec.ts` suites in a real browser context
- Specs must be written **without** manual `import '<pkg>/register'` in source. Instead: `gjsify build --globals` injects the register for GJS; the browser provides native globals. The same spec file then runs on both GJS and browser without platform guards
- Once browser infrastructure exists, `register.spec.ts` files (created as a temporary GJS-only workaround for testing `globalThis` wiring) should fold back into the common spec — no manual register import, runs on GJS + browser
- Priority packages: `dom-elements`, `canvas2d`, `canvas2d-core`, `event-bridge`
- `refs/wpt/` is the authoritative conformance test source for DOM specs

**Current workaround:** GJS-only `register.spec.ts` per package for tests that verify globalThis wiring after `/register` runs. See AGENTS.md Rule 7.

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

All dated entries live in [CHANGELOG.md](CHANGELOG.md). Do not duplicate them here.
