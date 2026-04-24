# gjsify — Project Status

> Last updated: 2026-04-23 (Autobahn Testsuite pillar + `@gjsify/ws` npm-compatible wrapper; `@gjsify/sqlite` on libgda; `@gjsify/xmlhttprequest` split out of fetch; `@gjsify/canvas2d-core` extracted to break the dom-elements ↔ canvas2d cycle; `@gjsify/domparser` for excalibur-tiled; meta polyfill packages `@gjsify/node-polyfills` + `@gjsify/web-polyfills`.)

## Summary

gjsify implements Node.js, Web Standard, and DOM APIs for GJS (GNOME JavaScript / SpiderMonkey 128).
The project comprises **42 Node.js packages** (+1 meta), **19 Web API packages** (+1 meta), **8 DOM/bridge packages**, **4 GJS infrastructure packages**, and **9 build/infra tools**.

| Category | Total | Full | Partial | Stub |
|----------|-------|------|---------|------|
| Node.js APIs | 42 | 34 (81%) | 4 (10%) | 4 (10%) |
| Node.js meta | 1 | 1 | — | — |
| Web APIs | 19 | 17 (89%) | 2 (11%) | — |
| Web meta | 1 | 1 | — | — |
| DOM / Bridges | 8 | 8 (100%) | — | — |
| Browser UI | 3 | 3 (adwaita-web, adwaita-fonts, adwaita-icons) | — | — |
| Showcases | 6 | 6 | — | — |
| GJS Infrastructure | 4 | 3 | 1 (types) | — |
| Build/Infra Tools | 9 | 9 | — | — |
| Integration test suites | 4 | 4 (webtorrent, socket.io, streamx, autobahn) | — | — |

**Test coverage:** 10,500+ test cases in 110+ spec files (each test runs on both Node.js and GJS). CI via GitHub Actions (Node.js 24.x + GJS on Fedora 42/43). Integration suites (`yarn test:integration`) are opt-in and exercise curated upstream tests from webtorrent / socket.io / streamx, plus the Autobahn fuzzingserver for RFC 6455 compliance.

---

## Node.js Packages (`packages/node/`)

### Fully Implemented (34)

| Package | GNOME Libs | Tests | Description |
|---------|-----------|-------|-------------|
| **assert** | — | 117 | AssertionError, deepEqual, throws, strict mode |
| **async_hooks** | — | 130 | AsyncLocalStorage (run, enterWith, snapshot, exit), AsyncResource (bind, runInAsyncScope, triggerAsyncId), createHook |
| **buffer** | — | 317 | Buffer via Blob/atob/btoa, alloc, from, concat, encodings, fill, indexOf/lastIndexOf, slice/subarray, copy, int/float read/write, swap16/32/64, equals, compare |
| **child_process** | Gio, GLib | 110 | exec/execSync, execFile/execFileSync, spawn/spawnSync via Gio.Subprocess; cwd/env via Gio.SubprocessLauncher |
| **console** | — | 124 | Console class with stream support, format specifiers, table, dir, time/timeLog, count, group, assert, trace, stdout/stderr routing |
| **constants** | — | 27 | Flattened re-export of `os.constants` (errno, signals, priority, dlopen) + `fs.constants` + legacy crypto constants — the deprecated Node `constants` alias |
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
| **sys** | — | 7 | Deprecated Node alias — re-exports `@gjsify/util` |
| **timers** | — | 88 (3 specs) | setTimeout/setInterval/setImmediate (**delay verification, args, clear, ordering**) + timers/promises |
| **tls** | Gio, GLib | 132 | TLSSocket (encrypted, getPeerCertificate, getProtocol, getCipher, **ALPN**), **connect with TLS handshake**, createServer/TLSServer, createSecureContext, **checkServerIdentity** (CN, wildcard, SAN DNS/IP, FQDN, edge cases, error properties), **getCiphers**, DEFAULT_CIPHERS, rootCertificates |
| **tty** | — | 29 | ReadStream/WriteStream, isatty (various fds), ANSI, clearLine, cursorTo, getColorDepth (env-based), hasColors, getWindowSize |
| **url** | GLib | 278 | URL, URLSearchParams via GLib.Uri |
| **util** | — | 245 (2 specs) | inspect (**colors, styles, custom symbol, defaultOptions**, edge cases), format (%%, %s/%d/%j/%i/%f, args), promisify (**custom symbol**), callbackify, deprecate, inherits (**super_**), isDeepStrictEqual, **types** (isDate/RegExp/Map/Set/Promise/ArrayBuffer/TypedArray/Async/Generator/WeakMap/WeakSet/DataView), TextEncoder/TextDecoder |
| **zlib** | — | 102 | gzip/deflate/deflateRaw round-trip, constants, Unicode, binary, cross-format errors, sync methods, double compression, consistency |

### Meta package

| Package | Purpose |
|---------|---------|
| **@gjsify/node-polyfills** | Dep-only umbrella — pulls every Node polyfill so `gjsify create-app` templates and CLI-generated scaffolds resolve any `node:*` import out of the box. No runtime code. |

### Partially Implemented (5)

| Package | GNOME Libs | Tests | Working | Missing |
|---------|-----------|-------|---------|---------|
| **sqlite** | Gda 6.0 | 48 | `DatabaseSync` (open/close, prepare, exec, `enableForeignKeyConstraints`, `readBigInts`, location property, path as `string`/`URL`/`Uint8Array`), `StatementSync` (all/get/run/iterate, named + positional params, typed readers via `data-model-reader.ts`, returning `{ lastInsertRowid, changes }`), spec-compliant error codes (`ERR_SQLITE_ERROR`, `ERR_INVALID_STATE`, `ERR_INVALID_URL_SCHEME`) via libgda SQLite provider (`gi://Gda?version=6.0`). | `PRAGMA user_version` round-trip depends on libgda build; WAL journal mode; `sqlite.constants` (SQLITE_CHANGESET_*); session/changeset extension APIs (libgda doesn't expose them); backup/vfs APIs |
| **ws** (npm) | Soup 3.0 (via `@gjsify/websocket`) | 18 (node) / 23 (gjs); Autobahn: 240 OK / 4 NON-STRICT / 3 INFO | `WebSocket` client class (url/protocol/headers through native), readyState + events (`open`/`message`/`close`/`error`), `send()`/`close()`/`terminate()`, `binaryType` conversions (nodebuffer/arraybuffer/fragments/blob), W3C `addEventListener` compat surface, `WebSocketServer` via `Soup.Server.add_websocket_handler` (port binding, `connection` event, client tracking, close). Aliases: npm `ws` and `isomorphic-ws` both resolve here. | `ping`/`pong` events (Soup handles control frames internally), `upgrade`/`unexpected-response`/`redirect` events (no Soup hook), `{ noServer: true }` + `handleUpgrade()`, `{ server: existingHttpServer }`, `verifyClient`/`handleProtocols`/`path` routing, custom `perMessageDeflate` options, `createWebSocketStream`, `options.headers` / `origin` / `handshakeTimeout` forwarding |
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

All 19 packages have real implementations (plus 1 meta). New in this cycle: `@gjsify/xmlhttprequest` (split out of fetch), `@gjsify/domparser` (excalibur-tiled), `@gjsify/webrtc`, `@gjsify/webrtc-native`, `@gjsify/adwaita-fonts`, `@gjsify/adwaita-icons`, `@gjsify/web-polyfills`.

| Package | GNOME Libs | Tests | Web APIs |
|---------|-----------|-------|----------|
| **abort-controller** | — | 23 (2 specs) | AbortController, AbortSignal (.abort, .timeout, .any) |
| **compression-streams** | — | 29 | CompressionStream, DecompressionStream (gzip/deflate/deflate-raw). Uses @gjsify/web-streams TransformStream |
| **dom-events** | — | 142 (3 specs) | Event, EventTarget, CustomEvent |
| **dom-exception** | — | 64 | DOMException polyfill (WebIDL standard) |
| **domparser** | — | 23 | DOMParser (parseFromString XML + HTML), minimal DOM (Element tagName/getAttribute/children/childNodes/querySelector[All]/textContent/innerHTML, Document documentElement/querySelector[All]). Sized for excalibur-tiled map parsing |
| **eventsource** | — | 15 | EventSource (Server-Sent Events), TextLineStream. Uses fetch + Web Streams |
| **fetch** | Soup 3.0, Gio, GLib | 73 | fetch(), Request, Response, Headers, Referrer-Policy, **file:// URI support**. Raw request body via `set_request_body_from_bytes` (fixes POST body never sent). XHR + `URL.createObjectURL` moved out into `@gjsify/xmlhttprequest` + `@gjsify/url` |
| **xmlhttprequest** | Soup 3.0, GLib | covered via fetch `on('Gjs', …)` | XMLHttpRequest (full `responseType`: arraybuffer / blob + temp-file / json / text / document). FakeBlob with `_tmpPath`. `URL.createObjectURL`/`revokeObjectURL` are first-class methods on `@gjsify/url`'s URL class — this package just owns the blob-file plumbing and the XHR class |
| **formdata** | — | 49 | FormData, File, multipart encoding |
| **streams** | — | 283 | ReadableStream, WritableStream, TransformStream, TextEncoderStream, TextDecoderStream, ByteLengthQueuingStrategy, CountQueuingStrategy (WHATWG Streams polyfill for GJS) |
| **webcrypto** | — | 486 | SubtleCrypto (digest, AES-CBC/CTR/GCM, HMAC, ECDSA, RSA-PSS, RSA-OAEP, PBKDF2, HKDF, ECDH, generateKey, importKey/exportKey, deriveBits/deriveKey), CryptoKey |
| **web-globals** | — | 66 | Unified re-export surface for all Web API packages. Root export is pure named re-exports; side effects (registering URL, URLSearchParams, Blob, File, FormData, performance, PerformanceObserver + chaining every sub-package's `/register`) live in `@gjsify/web-globals/register`. Users opt in via the `--globals` CLI flag or an explicit `import '@gjsify/web-globals/register'`. |
| **websocket** | Soup 3.0, Gio, GLib | 27 | WebSocket, MessageEvent, CloseEvent (W3C spec) |
| **webaudio** | Gst 1.0, GstApp 1.0 | 32 | AudioContext (decodeAudioData via GStreamer decodebin, createBufferSource, createGain, currentTime via GLib monotonic clock), AudioBuffer (PCM Float32Array storage), AudioBufferSourceNode (GStreamer appsrc→audioconvert→volume→autoaudiosink), GainNode (AudioParam with setTargetAtTime), AudioParam, HTMLAudioElement (canPlayType, playbin playback). **Phase 1 — covers Excalibur.js** |
| **gamepad** | Manette 0.2 | 19 | Gamepad (navigator.getGamepads polling via libmanette event-driven signals), GamepadButton (pressed/touched/value), GamepadEvent (gamepadconnected/gamepaddisconnected on globalThis), GamepadHapticActuator (dual-rumble with strong/weak magnitude). Button mapping: Manette→W3C standard layout (17 buttons incl. triggers-as-buttons). Axis mapping: 4 stick axes + trigger axes→button values. Lazy Manette.Monitor init, graceful degradation without libmanette. |
| **webrtc** | Gst 1.0, GstWebRTC 1.0, GstSDP 1.0 | 26 | **Phase 1–3 — Data Channel + Media + Outgoing Pipeline.** RTCPeerConnection (offer/answer, ICE trickle, STUN/TURN config, addTransceiver, addTrack, removeTrack, all sync getters + on-event handlers), RTCDataChannel (string + binary send/receive, bufferedAmount, binaryType), RTCRtpSender (track, getParameters/setParameters, replaceTrack with atomic source swap, getCapabilities), RTCRtpReceiver (track with muted→unmuted via ReceiverBridge, jitterBufferTarget), RTCRtpTransceiver (mid, direction, stop, setCodecPreferences), MediaStream, MediaStreamTrack (GStreamer source integration, enabled→valve), getUserMedia (pipewiresrc/pulsesrc/v4l2src fallback), MediaDevices. Outgoing pipeline: source→valve→convert→encode(opus/vp8)→payloader→capsfilter→webrtcbin. End-to-end bidirectional audio verified. Registers via `@gjsify/webrtc/register` (granular subpaths) — `--globals auto` picks them up. Requires GStreamer ≥ 1.20 with gst-plugins-bad + libnice-gstreamer. |
| **webrtc-native** | Gst 1.0, GstWebRTC 1.0, GstSDP 1.0 | — | Vala/GObject library consumed by `@gjsify/webrtc`. Exposes three main-thread signal bridges: `WebrtcbinBridge` (wraps webrtcbin's `on-negotiation-needed` / `on-ice-candidate` / `on-data-channel` + `notify::*-state`), `DataChannelBridge` (wraps GstWebRTCDataChannel's `on-open` / `on-close` / `on-error` / `on-message-string` / `on-message-data` / `on-buffered-amount-low` + `notify::ready-state`), `PromiseBridge` (wraps `Gst.Promise.new_with_change_func`). Each bridge connects on the C side (never invokes JS on the streaming thread) and re-emits via `GLib.Idle.add()` on the main context. Ships as prebuilt `.so` + `.typelib` in `prebuilds/linux-{x86_64,aarch64}/`; CI (`.github/workflows/prebuilds.yml`) rebuilds on Vala source changes. |
| **webstorage** | — | 41 | Storage, localStorage, sessionStorage (W3C Web Storage) |

### WebRTC Status

**Implemented (Phase 1 + 1.5 — Data Channel end-to-end):**
- RTCPeerConnection: constructor, createOffer, createAnswer, setLocalDescription, setRemoteDescription, addIceCandidate, close, createDataChannel, getConfiguration
- State getters: signalingState, connectionState, iceConnectionState, iceGatheringState, localDescription, remoteDescription, currentLocal/RemoteDescription, pendingLocal/RemoteDescription, canTrickleIceCandidates
- RTCPeerConnection events: negotiationneeded, icecandidate, icegatheringstatechange, iceconnectionstatechange, connectionstatechange, signalingstatechange, datachannel
- RTCDataChannel: send (string / ArrayBuffer / ArrayBufferView / Blob), close, readyState, bufferedAmount, bufferedAmountLowThreshold, binaryType ('arraybuffer' default, 'blob' lazy via globalThis.Blob), id, label, ordered, protocol, negotiated, maxPacketLifeTime, maxRetransmits
- RTCDataChannel events: open, close, message, error, bufferedamountlow, closing
- RTCSessionDescription (with Gst↔JS round-trip via GstSDP), RTCIceCandidate (W3C fields + candidate-line parser), RTCError (extends DOMException), RTCErrorEvent, RTCPeerConnectionIceEvent, RTCDataChannelEvent

**Implemented (Phase 2 — Media API Surface):**
- RTCPeerConnection.addTransceiver(kind, init) — creates real GstWebRTC transceivers, returns RTCRtpTransceiver
- RTCPeerConnection.getSenders / getReceivers / getTransceivers — return live lists
- RTCPeerConnection.removeTrack(sender) — validates sender, resets track
- RTCPeerConnection `track` event — fires on pad-added with RTCTrackEvent (receiver, track, streams, transceiver)
- RTCRtpTransceiver: mid, direction (read/write, mapped to GstWebRTC enum), currentDirection, stop(), setCodecPreferences(codecs)
- RTCRtpSender: track, dtmf, transport, getParameters/setParameters, replaceTrack (stub), getCapabilities(kind)
- RTCRtpReceiver: track (stub MediaStreamTrack, muted), jitterBufferTarget (0–4000ms range), getParameters, getCapabilities(kind)
- MediaStream: id, active, getTracks/getAudioTracks/getVideoTracks, getTrackById, addTrack/removeTrack, clone, addtrack/removetrack events
- MediaStreamTrack: id, kind, label, enabled, muted, readyState, contentHint, clone, stop
- MediaStreamTrackEvent, RTCTrackEvent
- Globals via `@gjsify/webrtc/register/media`: MediaStream, MediaStreamTrack, RTCTrackEvent

**Implemented (Phase 2.5 — Incoming Media Pipeline):**
- ReceiverBridge (Vala): manages muted source → decodebin → tee switching entirely in C to handle decodebin's streaming-thread `pad-added` signal
- RTCRtpReceiver._connectToPad wires webrtcbin output → ReceiverBridge → media-flowing signal → track unmute
- Track transitions from muted to unmuted when decoded media replaces the muted source
- Pipeline cleanup on RTCPeerConnection.close() disposes receiver bridges

**Implemented (Phase 3 — Outgoing Media + getUserMedia):**
- RTCPeerConnection.addTrack(track, ...streams) — creates transceiver, wires outgoing pipeline via request_pad_simple
- getUserMedia({ audio, video }) — wraps GStreamer sources (pipewiresrc → pulsesrc → autoaudiosrc → audiotestsrc fallback; pipewiresrc → v4l2src → autovideosrc → videotestsrc fallback)
- MediaDevices class with getUserMedia, enumerateDevices (stub), getSupportedConstraints
- navigator.mediaDevices registration via `@gjsify/webrtc/register/media-devices`
- Outgoing pipeline: source → valve → audioconvert/videoconvert → encoder (opusenc/vp8enc) → payloader (rtpopuspay/rtpvp8pay) → capsfilter → webrtcbin sink pad
- MediaStreamTrack GStreamer integration: _gstSource, _gstPipeline, enabled→valve.drop, stop()→NULL+dispose
- RTCRtpSender._wirePipeline builds explicit encoder chains (no Vala bridge needed — all main-thread)
- RTCRtpSender.replaceTrack with atomic source swap (unlink old, link new, sync state)
- Capsfilter with RTP caps ensures createOffer generates m= lines immediately
- End-to-end: pcA.addTrack(getUserMedia audio) → pcB receives track event, track unmutes
- Single-PC-per-track limitation (multi-PC fan-out via tee deferred to Phase 4)

**Deferred (Phase 4 — Stats & advanced):**
- RTCPeerConnection.getStats — rejects with `NotSupportedError`
- RTCPeerConnection.restartIce, setConfiguration — throw `NotSupportedError`
- RTCPeerConnection.getIdentityAssertion, peerIdentity — absent
- RTCPeerConnection.sctp — returns `null`
- `icecandidateerror` event — never fires
- RTCDTMFSender, RTCCertificate — not implemented
- RTCDtlsTransport, RTCIceTransport, RTCSctpTransport — not exposed
- MediaStreamTrack constraints, enumerateDevices with GStreamer Device Monitor
- Multi-PC-per-track fan-out via tee multiplexer

**Notes on spec behaviour (verified against WPT):**
- RTCDataChannel.binaryType defaults to `'arraybuffer'` — this IS the W3C spec default (§6.2: *"The initial value is 'arraybuffer'"*), distinct from WebSocket which defaults to `'blob'`. Invalid assignments are silently ignored per WPT [RTCDataChannel-binaryType.window.js](refs/wpt/webrtc/RTCDataChannel-binaryType.window.js) (matches Firefox / Chrome / Safari).
- Setting `binaryType` to `'blob'` requires `globalThis.Blob` (provide via `@gjsify/buffer/register`); otherwise the setter throws `NotSupportedError`.

**Current deviation from W3C spec:**
- `setLocalDescription()` without a description argument (implicit createOffer/createAnswer re-use) is not implemented — callers must pass an explicit `RTCSessionDescriptionInit`.

**How the GJS streaming-thread issue is solved (Phase 1.5):**

Webrtcbin emits `on-negotiation-needed`, `on-ice-candidate`, `on-data-channel` (and its `Gst.Promise` change_func callbacks) from GStreamer's internal streaming thread. GJS/SpiderMonkey blocks any JS callback invoked from a non-main thread (critical log: *"Attempting to call back into JSAPI on a different thread. … it has been blocked."*) to prevent VM corruption. An in-JS `GLib.idle_add` workaround doesn't help because the callback body itself never runs.

**`@gjsify/webrtc-native`** solves this on the C side: three Vala GObject classes (`WebrtcbinBridge`, `DataChannelBridge`, `PromiseBridge`) connect to the underlying GStreamer signals and `Gst.Promise` change_func, capture their args, then use `GLib.Idle.add()` to re-emit mirror signals on the main GLib context. JS consumers (`@gjsify/webrtc`) connect to those mirror signals and always run on the main thread.

Two subtleties in the bridge design:
1. `WebrtcbinBridge.on_data_channel_cb` wraps the incoming channel in a `DataChannelBridge` *on the streaming thread* before the idle hop — so the bridge's own signal handlers are connected before any `on-message-*` callbacks can fire on the same thread. Without this eager wrap, the first few messages from the remote peer would race the JS-side setup and get dropped.
2. The `GstWebRTCDataChannelState` C enum is **1-based** (`CONNECTING=1 … CLOSED=4`) but the auto-generated TypeScript declaration omits the initialiser and infers 0-based values. `RTCDataChannel` maps against the real 1-based runtime values.

Tests passing on GJS: **203 green** (89 data-channel + 109 media API + 5 media pipeline tests), including the full loopback (two local peers, offer/answer, ICE trickle, data-channel open/send/receive/echo).

**System prerequisites:**
- GStreamer ≥ 1.20 with **gst-plugins-bad** (for webrtcbin) AND **libnice-gstreamer** (for ICE transport — webrtcbin's state-change to PLAYING fails without it)
- Fedora:   `dnf install gstreamer1-plugins-bad-free gstreamer1-plugins-bad-free-extras libnice-gstreamer1`
- Ubuntu/Debian: `apt install gstreamer1.0-plugins-bad gstreamer1.0-nice`
- Verify:   `gst-inspect-1.0 webrtcbin && gst-inspect-1.0 nicesrc`

Tests that exercise `webrtcbin` (construction, deferred-APIs-throw, close, loopback) auto-skip with a clear message if the nice plugin is missing; the remaining 18 tests (RTCSessionDescription, RTCIceCandidate parsing, register-subpath wiring) cover the platform-agnostic code paths.

## DOM Packages (`packages/dom/`)

| Package | GNOME Libs | Tests | APIs |
|---------|-----------|-------|------|
| **dom-elements** | GdkPixbuf, `@gjsify/canvas2d-core` | 210 | Node(ownerDocument→document, event bubbling via parentNode), Element(setPointerCapture, releasePointerCapture, hasPointerCapture), HTMLElement(getBoundingClientRect, **dataset/DOMStringMap**), HTMLCanvasElement (base DOM stub; auto-registers `'2d'` context factory via `@gjsify/canvas2d-core`), HTMLImageElement (**data: URI support**), HTMLMediaElement, HTMLVideoElement, Image, Document(body→documentElement tree), Text, Comment, DocumentFragment, DOMTokenList, MutationObserver, ResizeObserver, IntersectionObserver, Attr, NamedNodeMap, NodeList. Auto-registers `globalThis.{Image,HTMLCanvasElement,document,self,devicePixelRatio,scrollX,scrollY,pageXOffset,pageYOffset,alert,AbortController,AbortSignal,fetch,Request,Response,Headers}` |
| **canvas2d-core** | Cairo, PangoCairo | 89 (8 specs: clearing, color, composite, drawimage, imagedata, state, text, transform) | **Headless** CanvasRenderingContext2D (HSL/HSLA color parsing, shadowBlur approximation, drawImage paint+clip, composite operations), CanvasGradient, CanvasPattern, Path2D, ImageData, color parser. NO GTK dependency — usable in pure-Cairo contexts. Extracted from `@gjsify/canvas2d` to break the dom-elements ↔ canvas2d circular dependency and to give downstream code a GTK-free 2D surface |
| **bridge-types** | — | — | DOMBridgeContainer(interface), BridgeEnvironment(isolated document+body+window per bridge), BridgeWindow(rAF, performance.now, viewport) |
| **canvas2d** | `@gjsify/canvas2d-core`, Cairo, GdkPixbuf, PangoCairo, Gtk 4 | — | Re-exports `canvas2d-core` surface + **FontFace** (pixel-perfect font rendering via PangoCairo) + Canvas2DBridge→Gtk.DrawingArea (GTK widget wrapper) |
| **webgl** | gwebgl, Gtk 4, Gio | 12 | WebGLRenderingContext (1.0), WebGL2RenderingContext (2.0, overrides texImage2D/texSubImage2D/drawElements for GLES3.2 compat, native FBO completeness delegation, GLSL 1.0 compatibility for versionless shaders, **clearBufferfv/iv/uiv/fi**, **premultipliedAlpha support**), HTMLCanvasElement (GTK-backed), WebGLBridge (Gtk.GLArea subclass, rAF, resize re-render, **eager context init**), Extensions |
| **event-bridge** | Gtk 4.0, Gdk 4.0 | — | attachEventControllers(): GTK4 controllers→DOM MouseEvent/PointerEvent/KeyboardEvent/WheelEvent/FocusEvent, **window-level keyboard listeners** |
| **iframe** | WebKit 6.0 | — | HTMLIFrameElement, IFrameBridge→WebKit.WebView, postMessage bridge |
| **video** | Gst 1.0, Gtk 4.0 | — | VideoBridge→Gtk.Picture(gtk4paintablesink). Supports srcObject(MediaStream from getUserMedia/WebRTC) + src(URI via playbin). Phase 1 |

## Browser UI Packages (`packages/web/adwaita-web/`)

| Package | Tests | APIs |
|---------|-------|------|
| **adwaita-web** | — | AdwWindow, AdwHeaderBar, AdwPreferencesGroup, AdwSwitchRow, AdwComboRow, AdwSpinRow, AdwToastOverlay, AdwOverlaySplitView, AdwCard. Custom Elements (light DOM). SCSS source partials in `scss/` (mirroring `refs/adwaita-web/scss/`) compiled to `dist/adwaita-web.css` via the `sass` package. Light/dark theme via CSS variables. Consumers import `@gjsify/adwaita-web` (registers custom elements + Adwaita Sans font) plus `@gjsify/adwaita-web/style.css` (or via SCSS partials at `@gjsify/adwaita-web/scss/*`). No GJS deps |
| **adwaita-fonts** | — | Adwaita Sans font files (fontsource-style). CSS @font-face + TTF files. SIL OFL 1.1 |
| **adwaita-icons** | — | Adwaita symbolic icons as importable SVG strings (categories: actions, devices, mimetypes, places, status, ui, …). `toDataUri()` utility. Sourced from `refs/adwaita-icon-theme/`. CC0-1.0 / LGPLv3 |

### Meta package

| Package | Purpose |
|---------|---------|
| **@gjsify/web-polyfills** | Dep-only umbrella — pulls every Web polyfill (abort-controller, compression-streams, dom-events, dom-exception, domparser, eventsource, fetch, formdata, gamepad, webaudio, webcrypto, websocket, webstorage, web-streams, web-globals, xmlhttprequest) so `gjsify create-app` scaffolds resolve any Web API import out of the box. No runtime code. |

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
| **esbuild-plugin-css** | Bundle `.css` imports (resolve `@import` from node_modules) → JS string | Full |
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
| **Gio 2.0** | fs, net, dns, child_process, dgram, tls, module, fetch, xmlhttprequest |
| **GLib 2.0** | crypto, url, os, process, dns, child_process, dgram, tls, module, timers, xmlhttprequest (temp files) |
| **Soup 3.0** | http, https, fetch, websocket, eventsource, xmlhttprequest |
| **Gda 6.0** | sqlite (libgda SQLite provider) |
| **Gtk 4.0** | canvas2d (DrawingArea), webgl (GLArea), video (Picture), event-bridge |
| **Gdk 4.0** | event-bridge (key/modifier state) |
| **GdkPixbuf 2.0** | dom-elements (HTMLImageElement) |
| **WebKit 6.0** | iframe (WebKit.WebView) |
| **Cairo + PangoCairo** | canvas2d-core, canvas2d (FontFace) |
| **gwebgl 0.1** | webgl (Vala extension) |
| **Gst 1.0** | webaudio, webrtc, video (all GStreamer pipelines) |
| **GstApp 1.0** | webaudio (appsrc/appsink for PCM I/O) |
| **GstWebRTC 1.0** | webrtc (webrtcbin element) |
| **GstSDP 1.0** | webrtc (SDP message parse/serialize via `SDPMessage.new_from_text` + `as_text`) |
| **Manette 0.2** | gamepad (libmanette monitor + devices) |
| **`@gjsify/webrtc-native` (Vala)** | webrtc (main-thread signal bridges for webrtcbin / data channels / Gst.Promise) |

---

## Metrics

| Metric | Value |
|--------|-------|
| Total Node.js packages | 42 + 1 meta |
| Fully implemented | 34 (81%) |
| Partially implemented | 4 (10%) — sqlite, ws, worker_threads, http2, vm |
| Stubs | 4 (10%) — cluster, domain, inspector, v8 |
| Web API packages | 19 + 1 meta (17 full, 2 partial) |
| DOM / Bridge packages | 8 (all implemented) — dom-elements, canvas2d-core, canvas2d, bridge-types, webgl, event-bridge, iframe, video |
| Browser UI packages | 3 (adwaita-web, adwaita-fonts, adwaita-icons) |
| GJS infrastructure packages | 4 (unit, utils, runtime, types) |
| Build tools | 9 (infra/) |
| Total test cases | 10,500+ (unit) + 360+ (integration) |
| Spec files | 110+ |
| Integration test suites | 4 (webtorrent, socket.io, streamx, autobahn) |
| Showcases | 6 (Canvas2D Fireworks, Three.js Teapot, Three.js Pixel Post-Processing, Excalibur Jelly Jumper, Express Webserver, Adwaita Package Builder) |
| Real-world examples | 50+ across `examples/dom/` (WebGL tutorials, WebRTC loopback/DTMF/trickle-ice/video/states, WebTorrent download/player/seed/stream, three.js variants, video-player, gamepad-snes, iframe, canvas2d-confetti/text) and `examples/node/` (Express, Koa, Hono REST, SSE chat, WS chat, socket.io pingpong / chat-server, static file server, CLI tools for fs/path/events/os/url/buffer, deepkit di/events/types/validation/workflow, file search, DNS lookup, JSON store, Gio cat, worker pool, yargs, GTK HTTP dashboard) |
| GNOME-integrated packages | 20+ (Gio, GLib, Soup, Gda, Gst, GstApp, GstWebRTC, GstSDP, Manette, WebKit, Gtk, Cairo, PangoCairo, GdkPixbuf, libepoxy) |
| Alias mappings (GJS) | 70+ |
| Reference submodules | 59 |

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
- ~~**WebRTC Phase 1 + 1.5 (Data Channel end-to-end)**~~✓ — `@gjsify/webrtc` (23 tests incl. loopback). RTCPeerConnection (offer/answer, ICE trickle, STUN/TURN), RTCDataChannel (string + binary send/receive), RTCSessionDescription, RTCIceCandidate, RTCError. Backed by `@gjsify/webrtc-native` Vala bridge (WebrtcbinBridge, DataChannelBridge, PromiseBridge) that marshals webrtcbin's streaming-thread signals + Gst.Promise callbacks onto the main GLib context via `GLib.Idle.add()`. Media (RTCRtpSender/Receiver, MediaStream, getUserMedia) deferred to Phase 2.
- ~~**WebRTC Phase 2 + 2.5 + 3 (Media)**~~✓ — Full W3C media surface: `addTransceiver`, `addTrack`/`removeTrack`, `RTCRtpSender`/`Receiver`/`Transceiver`, `MediaStream`/`MediaStreamTrack`, `getUserMedia` (pipewiresrc/pulsesrc/v4l2src), incoming pipeline via `ReceiverBridge` (Vala, decodebin → tee switching), outgoing pipeline via explicit encoder chain (source→valve→convert→encode→payloader→capsfilter→webrtcbin). Tee-multiplexer for fan-out. DTMF via `RTCDTMFSender`. WebTorrent on GJS is now end-to-end thanks to RTCDataChannel maturity.
- ~~**npm `ws` drop-in wrapper**~~✓ — `@gjsify/ws` (`packages/node/ws/`) wraps `@gjsify/websocket` + `Soup.Server.add_websocket_handler`. Aliased via `ws` and `isomorphic-ws`. Autobahn fuzzingserver reports identical 240/4/3/0 scores as the underlying `@gjsify/websocket`, confirming zero wrapper regressions.
- ~~**Autobahn RFC 6455 pillar**~~✓ — `tests/integration/autobahn/` (two driver agents: `@gjsify/websocket` W3C, `@gjsify/ws` npm wrapper). Baseline: 240 OK / 4 NON-STRICT / 3 INFORMATIONAL / 0 FAILED per agent (cases 9.* / 12.* / 13.* excluded — performance + permessage-deflate deferred).
- ~~**`@gjsify/sqlite`**~~✓ — `node:sqlite` on top of `gi://Gda?version=6.0`. DatabaseSync / StatementSync with the subset of the API realistic libgda exposes; 48 tests.
- ~~**`@gjsify/canvas2d-core` extraction**~~✓ — Headless Cairo/PangoCairo 2D surface split out of `@gjsify/canvas2d`. Breaks the dom-elements ↔ canvas2d cycle; `@gjsify/dom-elements` auto-registers the `'2d'` context factory via the new package.
- ~~**XHR + `URL.createObjectURL` moved to their natural homes**~~✓ — `@gjsify/xmlhttprequest` owns the XHR class + FakeBlob; `@gjsify/url` owns `URL.createObjectURL`/`revokeObjectURL` as static methods on the URL class. `@gjsify/fetch` no longer monkey-patches URL from a register module.
- ~~**Meta polyfill packages**~~✓ — `@gjsify/node-polyfills` + `@gjsify/web-polyfills`. Dep-only umbrellas so `gjsify create-app` templates + CLI scaffolds resolve any `node:*` / Web import without hand-rolling dep lists.
- ~~**Integration suites**~~✓ — `tests/integration/{webtorrent,socket.io,streamx,autobahn}/`. Opt-in via `yarn test:integration`. Every suite uncovered root-cause fixes (URL-path fs, esbuild `require` condition, `random-access-file` alias, fetch POST body, IncomingMessage close semantics, EventEmitter prototype enumerability, queueMicrotask injection, NUL-byte-safe WebSocket text frames) that landed in the surfacing PR.
- ~~**GLib.Source GC race hardening**~~✓ — `@gjsify/node-globals/register/timers` replaces `setTimeout`/`setInterval` with `GLib.timeout_add` (numeric source IDs, no BoxedInstance). Prevents SIGSEGV in `g_source_unref_internal` under webtorrent/bittorrent-dht/async-limiter load where libraries routinely call `timer.unref()`.

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

## Integration Test Coverage

`tests/integration/` validates `@gjsify/*` implementations by running curated upstream tests from popular npm packages. Opt-in target: `yarn test:integration`.

### webtorrent (`tests/integration/webtorrent/`)

7 test files ported from `refs/webtorrent/test/` into `@gjsify/unit` style. **Node: 185/185 green. GJS: 185/185 green, 0 skips.**

| Port | Node | GJS | Exercises |
|---|---|---|---|
| selections.spec.ts | ✅ | ✅ | Pure JS (smoke test of infrastructure) |
| rarity-map.spec.ts | ✅ | ✅ | `@gjsify/buffer`, `@gjsify/events`, bittorrent-protocol wire-stub |
| client-destroy.spec.ts | ✅ | ✅ | `@gjsify/events`, lifecycle + error suppression |
| client-add.spec.ts | ✅ | ✅ | Torrent parsing, magnet URI, infoHash, `@gjsify/crypto` |
| bitfield.spec.ts | ✅ | ✅ | `@gjsify/fs` (fs-chunk-store), `@gjsify/path`, `@gjsify/buffer` |
| file-buffer.spec.ts | ✅ | ✅ | `@gjsify/fs` seed path + async arrayBuffer slicing |
| iterator.spec.ts | ✅ | ✅ | `@gjsify/stream` async iterator over chunk store |

### Root-cause fixes surfaced by the webtorrent port and landed in this PR

1. **`@gjsify/fs` now accepts `URL` path arguments.** Added a `normalizePath` helper in [packages/node/fs/src/utils.ts](packages/node/fs/src/utils.ts) and routed every public entry point (`readFileSync`, `readFile`, `writeFile`, `stat`, `lstat`, `readdirSync`, `realpathSync`, `symlinkSync`, `unlinkSync`, `renameSync`, `copyFileSync`, `accessSync`, `appendFileSync`, `readlinkSync`, `linkSync`, `truncateSync`, `chmodSync`, `chownSync`, `rmdirSync`, `rmSync`, `mkdirSync`, `promises.*`, `FSWatcher`, `ReadStream`, `FileHandle`, `watch`) through it. Previously threw "Expected type string for argument 'path' but got type Object" on any `new URL('file:///path')` call.
2. **ESM builds no longer pull CJS entries through the `require` condition.** [packages/infra/esbuild-plugin-gjsify/src/app/gjs.ts](packages/infra/esbuild-plugin-gjsify/src/app/gjs.ts) previously listed `['browser', 'import', 'require']` as conditions even for ESM format. esbuild picks the first matching condition in an exports-map's declared order, so packages like `bitfield` that list `"require"` before `"import"` silently routed through the CJS entry. That entry is then wrapped by `__toESM(mod, 1)` which double-wraps an already-default-exported CJS class (`exports.default = X`) as `{ default: { __esModule: true, default: X } }` — causing `new Pkg.default(...)` to throw `is not a constructor` at runtime. Mirrors Node's own ESM resolution: in ESM mode Node never applies the `require` condition. CJS-only packages still resolve via `main`/`module` mainField fallback.
3. **`random-access-file` browser stub aliased to the Node entry.** [packages/infra/resolve-npm/lib/index.mjs](packages/infra/resolve-npm/lib/index.mjs) `ALIASES_GENERAL_FOR_GJS` now maps `random-access-file` → `random-access-file/index.js`. Without this, esbuild's `browser` mainField precedence routed to the package's browser stub that unconditionally throws "random-access-file is not supported in the browser" on construction — fs-chunk-store (used by webtorrent to write seed chunks) then failed to `.put()`, silently stalling every `client.seed(Buffer)` call. GJS has a working `fs` via `@gjsify/fs`, so the real implementation just works.

### streamx (`tests/integration/streamx/`)

6 spec files ported from `refs/streamx/test/` plus an original `throughput.spec.ts`. **Node: 155/155 green. GJS: 156/156 green (1 GJS-only test), 0 skips.**

| Port | Node | GJS | Exercises |
|---|---|---|---|
| readable.spec.ts | ✅ (24) | ✅ (24) | Readable push/pause/resume/from/setEncoding/isDisturbed |
| writable.spec.ts | ✅ (10) | ✅ (10) | Writable write/drain/writev/cork/drained-helper |
| transform.spec.ts | ✅ (2) | ✅ (2) | Transform teardown + PassThrough pipe |
| pipeline.spec.ts | ✅ (5) | ✅ (5) | pipeline/pipelinePromise + error propagation |
| duplex.spec.ts | ✅ (5) | ✅ (5) | Duplex open/map/readable/destroy |
| throughput.spec.ts | ✅ (5) | ✅ (6) | queueMicrotask injection, 100-chunk no-loss, pipeline byte preservation, Duplex echo, timing |

Root cause of 0 B/s symptom (webtorrent-player): `queueMicrotask` must be injected so streamx uses Promise-based microtask scheduling instead of `process.nextTick` fallback. The throughput GJS-only test confirms injection works and pipeline completes within 1 s.

### socket.io (`tests/integration/socket.io/`)

3 test suites ported from socket.io v4 upstream into `@gjsify/unit` style. **Node: 20/20 green. GJS: 20/20 green, 0 skips.** Transport: polling only (`transports: ['polling']`).

| Port | Node | GJS | Exercises |
|---|---|---|---|
| handshake.spec.ts | ✅ (4) | ✅ (4) | CORS headers (OPTIONS/GET), `allowRequest` accept/reject, `@gjsify/fetch`, `@gjsify/http` |
| socket-middleware.spec.ts | ✅ (2) | ✅ (2) | `socket.use()` middleware chain + error propagation |
| socket-timeout.spec.ts | ✅ (4) | ✅ (4) | `socket.timeout().emit()` ack timeout, `emitWithAck()` with/without ack |

WebSocket transport deferred — requires a server-side `ws` package shim (see Open TODOs).

### autobahn (`tests/integration/autobahn/`)

RFC 6455 WebSocket protocol compliance validated by the [crossbario/autobahn-testsuite](https://github.com/crossbario/autobahn-testsuite) fuzzingserver running in a Podman/Docker container. Two client drivers exercise the stack from different entry points:

| Driver | Target | Baseline (463 cases, Autobahn 0.10.9) |
|---|---|---|
| `fuzzingclient-driver.ts` → `@gjsify/websocket` (W3C `WebSocket` over `Soup.WebsocketConnection`) | foundational RFC 6455 compliance at the Soup layer, including permessage-deflate framing (RFC 7692) | **456 OK / 4 NON-STRICT / 3 INFORMATIONAL / 0 FAILED** |
| `fuzzingclient-driver-ws.ts` → `@gjsify/ws` (npm `ws` wrapper on top of `@gjsify/websocket`) | API-wrapper semantics: EventEmitter handlers, binary type coercion, close-reason byte encoding, deflate pass-through | **456 OK / 4 NON-STRICT / 3 INFORMATIONAL / 0 FAILED** |

Identical scores confirm `@gjsify/ws` adds zero regressions over `@gjsify/websocket`.

**NON-STRICT (4 cases, all of form 6.4.x)** — fragmented text messages with invalid UTF-8 in a later fragment. `behaviorClose` is `OK` (we send close code 1007 as RFC requires), only `behavior` is NON-STRICT because Autobahn expects the failure to occur *fast* — immediately when the invalid byte arrives, not at end-of-message. `Soup.WebsocketConnection` only surfaces coalesced messages (no pre-assembly `frame` signal is exposed over GI), so per-fragment validation cannot run before libsoup has already buffered the whole message. Tracked as an upstream libsoup patch candidate under "Upstream GJS Patch Candidates" below.

**INFORMATIONAL (3 cases)** — implementation-defined close behaviors (7.1.6 large-message-then-close race, 7.13.x custom close codes). By Autobahn's own classification these are never failures — just observations.

Cases excluded from the baseline: `9.*` (performance, ~30 min per run). The `12.*` / `13.*` permessage-deflate suites are part of the baseline since deflate landed enabled in this iteration.

**Not wired into CI yet** — Podman-in-CI on Fedora requires privileged containers or socket sharing that our current CI config doesn't enable. Manual `yarn test` + baseline commit is the Phase 1 workflow. Baseline JSON under `reports/baseline/<agent>.json` is tracked; regressions surface in PR diffs.

### Root-cause fixes surfaced by the Autobahn pillar and landed in this PR

1. **`@gjsify/websocket` now ships a `/register` subpath.** Before this PR, `globalThis.WebSocket` had no register entry — the CLI's `--globals` flag silently ignored `WebSocket` tokens (unknown identifier), and `--globals auto` had no way to inject the class when user code wrote `new WebSocket(...)`. Consumers who needed it either pre-declared the global manually (webtorrent-player) or imported the class by name. Now `@gjsify/websocket/register` sets `globalThis.{WebSocket,MessageEvent,CloseEvent}` with existence guards, gets listed in `GJS_GLOBALS_MAP` (→ `websocket/register`) and both alias maps (`ALIASES_WEB_FOR_GJS`, `ALIASES_WEB_FOR_NODE`), and is added to the `web` global group so `--globals web` picks it up alongside `fetch`/`crypto`/stream globals. The Autobahn driver was the first consumer of the full `--globals auto` path for `WebSocket`, so the missing register entry showed up immediately.

2. **`WebSocket.send(string)` no longer truncates payloads at embedded NUL bytes.** Previously `send()` routed strings through `Soup.WebsocketConnection.send_text(str)`. That method's C signature is `const char *` — null-terminated — so any `\x00` in the JS string was silently truncated at the GI marshaling boundary. Autobahn case 6.7.1 (send a text frame whose single payload byte is `0x00`) exercised this directly and reported the frame as empty. Fix: route strings through `send_message(Soup.WebsocketDataType.TEXT, GLib.Bytes)` — we now encode the JS string as UTF-8 bytes ourselves and hand Soup a byte buffer, which preserves embedded NULs (and anything else the string happens to contain). Binary sends go through the same `send_message` path for consistency. The 6.7.1 regression flipped from `FAILED` to `OK` in both agent baselines.

3. **`@gjsify/websocket` now negotiates permessage-deflate (RFC 7692).** Soup documents `WebsocketExtensionManager` as "added to the session by default," but in practice `new Soup.Session()` ships without one — so the client never sent a `Sec-WebSocket-Extensions` header and Autobahn marked every `12.*` / `13.*` case `UNIMPLEMENTED`. Fix: in the `WebSocket` constructor, explicitly register both the manager and the deflate extension type via `Session.add_feature_by_type(Soup.WebsocketExtensionManager.$gtype)` followed by `Session.add_feature_by_type(Soup.WebsocketExtensionDeflate.$gtype)`. Adding deflate alone fails with a runtime warning (`No feature manager for feature of type 'SoupWebsocketExtensionDeflate'`) — the manager must land first. Browsers always offer deflate, so we match that unconditionally (no opt-out today). The 216 previously-UNIMPLEMENTED deflate cases flipped to OK in both agent baselines.

4. **`WebSocket.extensions` now reflects the actual negotiated extensions** (was hardcoded `''`). After `websocket_connect_finish` succeeds we call `this._connection.get_extensions()` and serialize each `Soup.WebsocketExtension` into the `Sec-WebSocket-Extensions` response-header format (`"permessage-deflate"` or `"permessage-deflate; client_max_window_bits=15"`). Libsoup doesn't surface an extension's spec name on the JS object (it's a class-level C field), so we `instanceof`-check `Soup.WebsocketExtensionDeflate` for the one extension Soup ships today and fall back to the stripped GType name for any third-party extension registered on the session. W3C spec compliance: `WebSocket.extensions` must echo the server-accepted extensions after `open`.

5. **Driver case-timeout bumped to 60 s, from 10 s.** The largest deflate cases (12.2.10+, 12.3.10+, 12.5.17 — 1000 messages of 131 072 bytes each, ~128 MB roundtrip through GJS) legitimately need 10–30 s; the prior 10 s cap timed out 12 of them and reported `FAILED` even though they were making steady progress. 60 s matches Autobahn's own server-side case timeout for these cases.

6. **Driver exit watchdog (`scripts/run-driver.mjs`).** `System.exit(0)` called from the bundled driver's `Promise.then` continuation silently returns in this context (the GLib main loop kept alive by `ensureMainLoop()` keeps the process running even after main() has resolved and the Autobahn report is written). The same `System.exit` call works from a standalone script or a MainLoop idle callback, so the blocker is specific to the driver bundle's heavily-patched `@gjsify/node-globals` runtime surface. Workaround: a Node wrapper polls for the `Done.` marker in the driver's log, gives the process 3 s to self-exit, then `SIGKILL`s. The report is on disk before `Done.` is printed so no data is lost. Removal blocker tracked below in Open TODOs.

### Root-cause fixes surfaced by the socket.io port and landed in this PR

1. **`@gjsify/fetch` POST body never sent.** `Request._send()` in [packages/web/fetch/src/request.ts](packages/web/fetch/src/request.ts) never attached the body to the `Soup.Message`. Root cause: the `.body` getter creates a Web ReadableStream whose `start(controller)` runs synchronously, switching the internal Node Readable to flowing mode and draining its buffer before `_send()` ran. Fix: added `_rawBodyBuffer` getter to `Body` class that reads directly from `Body[INTERNALS].body` without going through the Web stream, then calls `message.set_request_body_from_bytes(null, new GLib.Bytes(rawBuf))`.
2. **`IncomingMessage` wrongly emitted `'close'` after body stream ends.** Engine.io registers `req.on('close', onClose)` to detect dropped connections during long-poll. Our `Readable._emitEnd()` auto-emitted `'close'` after `'end'` (mimicking `autoDestroy` behavior), which engine.io treated as a premature disconnect. Fix: added `_autoClose()` protected hook to `Readable` (emits `'close'` by default) and overrode it in `IncomingMessage` to be a no-op — `'close'` now fires only via `destroy()`, matching Node.js HTTP semantics.
3. **`EventEmitter.prototype` methods were non-enumerable.** Socket.io v4 builds `Server`→Namespace proxy methods by iterating `Object.keys(EventEmitter.prototype)`. ES class methods are non-enumerable, so this returned `[]` and no proxy was created. `io.on('connection', handler)` attached to the Server's own EventEmitter instead of the default namespace, so the `connection` event (fired by `namespace._doConnect`) never reached user handlers. Fix: after the class declaration in [packages/node/events/src/event-emitter.ts](packages/node/events/src/event-emitter.ts), `Object.defineProperty` re-declares all 15 public instance methods as `enumerable: true`, matching Node.js's prototype-assignment style.

## Open TODOs

Tracked follow-up work that has been deliberately deferred. Every "out of scope" or "follow-up" note from a PR or implementation plan must end up here so future sessions can pick it up.

### Split `@gjsify/node-globals/register` into topic-specific packages

**Priority: Medium — reduces bundle size, improves tree-shake signal.**

`@gjsify/node-globals/register` is the historical kitchen-sink side-effect module: importing it registers `Buffer`, `process`, `URL`, `TextEncoder`/`TextDecoder`, `structuredClone`, `setImmediate`, `atob`/`btoa`, and more in one shot. Every integration driver and test entry-point still imports it, pulling the whole set into bundles that only need a subset. We have since moved to **granular, feature-scoped register subpaths** (e.g. `@gjsify/fetch/register/fetch`, `@gjsify/fetch/register/xhr`, `@gjsify/dom-events/register/ui-events`), and the CLI's `--globals auto` can inject exactly the identifiers a bundle references.

Migration (each step a separate PR, chosen by which consumer first complains):

1. Audit `@gjsify/node-globals/src/register.ts` — list every global it sets, which package should own each.
2. Move each registration into its owning package's own `register.ts` if that doesn't already exist, and add the identifier to `GJS_GLOBALS_MAP` so `--globals auto` finds it.
3. Replace downstream `import '@gjsify/node-globals/register'` lines with granular imports (or the appropriate `--globals` flag), one consumer at a time.
4. When the last consumer is migrated, delete `@gjsify/node-globals/register` and fold the package's remaining non-register exports into a smaller surface (or deprecate entirely if nothing else lives there).

Keep the top-level `@gjsify/node-globals` package bare-specifier alias (`@gjsify/runtime` in some layouts) for **new** consumers that genuinely want "give me the full Node runtime surface" — but mark it opt-in, not the default path.

### Integration tests — socket.io WebSocket transport

**Priority: Medium.**

Socket.io WebSocket transport requires a server-side `ws` npm package shim (Soup WebSocket server + per-message framing). Currently bypassed with `transports: ['polling']`. Once the `ws` shim lands, port `socket.ts` and `namespaces.ts` from `refs/socket.io/packages/socket.io/test/`.

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

### Universal DOM Container (`@gjsify/dom-bridge`)

**Priority: Medium — architectural vision for unified DOM-in-GTK.**

A future `@gjsify/dom-bridge` package where `document.createElement("canvas")` + `getContext("2d")` automatically creates the right GTK widget behind the scenes. `document.body` would map to a real GTK container hierarchy. Each child element gets its own bridge transparently. This is the long-term vision for making browser code "just work" in GTK without explicit bridge creation. Deferred from the initial bridge architecture PR — requires deeper integration between `Document`, `Element.appendChild`, and the GTK widget tree.

### WebRTC Phase 4 — Stats & advanced

**Priority: Low — nice-to-have once Phase 3 lands.**

- `getStats` — emit `get-stats` signal on webrtcbin, convert `GstStructure` → `RTCStatsReport` (Map<string, RTCStats>).
- `restartIce`, `setConfiguration` — dynamic reconfig.
- `RTCDtlsTransport`, `RTCIceTransport`, `RTCSctpTransport` — thin proxies over webrtcbin's child transports.
- `RTCCertificate` — local DTLS certificate management.
- `RTCDTMFSender` — audio-track-based DTMF via GStreamer `dtmfsrc`.
- `icecandidateerror` event — map from webrtcbin's ICE failure signals.
- `peerIdentity`, `getIdentityAssertion` — identity provider integration.

### Autobahn — expand coverage and wire into CI

**Priority: Medium.**

Current baseline excludes cases `9.*` (performance — ~30 min/run). The `12.*` / `13.*` permessage-deflate suites are now part of the baseline. Remaining items:

- `6.4.x` NON-STRICT fragmented-text-with-invalid-UTF-8 cases close with `1007` but not "fast enough" by Autobahn's yardstick — libsoup surfaces only coalesced messages to GJS, so fast-fail needs an upstream libsoup change. Tracked under "Upstream GJS Patch Candidates" below.
- Podman-in-CI needs privileged containers (or socket sharing) that our Fedora-based CI doesn't currently grant. Until that lands, the suite is a manual opt-in run + baseline-commit workflow.

Plan: (1) investigate libsoup patch for `6.4.x` fragment-level UTF-8 validation; (2) wire autobahn scripts into a nightly CI job once Podman-in-CI is unblocked.

### Autobahn driver — `System.exit()` bypass in bundled driver context

**Priority: Low — has a working watchdog workaround, not on the user-visible surface.**

Calling `System.exit(0)` from the bundled Autobahn driver's `Promise.then` continuation silently returns without terminating the gjs process, even though the exact same call works from a standalone script or a plain `GLib.MainLoop` idle callback. The GLib main loop that `ensureMainLoop()` starts for Soup's async I/O keeps the process alive indefinitely after `main()` has resolved and the Autobahn report is on disk. `tests/integration/autobahn/scripts/run-driver.mjs` compensates: it watches the log for the `Done.` marker the driver prints on success, allows a 3 s grace window for a clean exit, then `SIGKILL`s. No data loss — the report is flushed before `Done.` is emitted.

Next steps to remove the watchdog: (1) isolate whether the block is in `@gjsify/process`'s `exit()` shim, in how we patch `globalThis.imports`, or in an interaction with `@gjsify/node-globals/register` preventing the libc `exit` syscall from propagating; (2) write a minimal reproducer outside the Autobahn pillar; (3) fix root-cause, drop the wrapper, inline `gjs -m dist/driver-*.gjs.mjs` back into the package.json scripts.

### `@gjsify/sqlite` — expand API surface

**Priority: Low — libgda-shaped.**

Today's partial-implementation covers DatabaseSync/StatementSync against Node 24's `node:sqlite`. Libgda does not expose session/changeset, WAL-mode toggles, backup or VFS APIs, so those are open gaps. The closest path forward is either (a) wrap `sqlite3` directly via `cwrap`/`libsqlite3` GI bindings (expensive: no upstream GIR), or (b) live with the libgda-shaped subset and document the gaps per API. (b) is the current direction. `sqlite.constants` (`SQLITE_CHANGESET_*`) remains unimplemented until (a).

### WebRTC Showcase

**Priority: Low — after Phase 2.**

Promote [examples/dom/webrtc-loopback](examples/dom/webrtc-loopback) to `showcases/dom/webrtc-loopback/` once Media Phase 2 lands, so the showcase demonstrates both data and media paths. Until then it stays as a private example.

---

## Upstream GJS Patch Candidates

Workarounds we maintain that could be eliminated with upstream GJS/SpiderMonkey patches. These are ordered by impact — features where an upstream fix would benefit the most gjsify packages.

| Workaround | Affected Packages | Current Solution | Upstream Fix |
|-----------|-------------------|------------------|-------------|
| `setTimeout` / `setInterval` return a `GLib.Source` BoxedInstance whose `.unref()` is `g_source_unref` (GLib refcount decrement) — clashes with Node.js `Timeout.unref()` ("don't keep event loop alive", refcount-irrelevant). Node-compat libraries (WebTorrent, bittorrent-dht, async-limiter, …) call `timer.unref()` as standard, each call partially frees the source → SIGSEGV in `g_source_unref_internal` at SM GC finalization. Compounded by GJS `_timers.js` calling `releaseSource(source)` before `drainMicrotaskQueue()`, opening a window where SM GC can finalize the BoxedInstance while GLib still holds a dispatch ref. | @gjsify/node-globals (timers), any Node.js code using setTimeout/setInterval under load, any GJS code that lets GLib.Source BoxedInstances reach the GC | `packages/node/globals/src/register/timers.ts`: full replacement of setTimeout / setInterval via `GLib.timeout_add` (numeric source ID, no BoxedInstance). Returns a Node-shaped `GjsifyTimeout` wrapper with no-op `.ref / .unref / .hasRef` and working `.refresh / Symbol.dispose / Symbol.toPrimitive`. Also monkey-patches `GLib.Source.prototype.ref / .unref` to no-op as a safety net for BoxedInstances that leak from other gi APIs (GStreamer plugins, Gio async helpers, third-party bindings). | **Two changes in GJS `_timers.js`** (modules/esm/\_timers.js): (1) reorder the dispatch closure so `drainMicrotaskQueue()` runs BEFORE `releaseSource(source)`, closing the SM-GC-during-drain window. (2) expose a Node-compatible `Timeout.unref() / .ref()` that tracks a "keep event loop alive" flag **instead of** mapping to `g_source_unref / g_source_ref` — the current semantics collide with nearly every Node.js library ever written. Both changes can land independently; (2) alone eliminates the crash for Node-compat consumers. |
| Web Streams (`ReadableStream`, `WritableStream`, `TransformStream`) not exposed as globals | compression-streams, fetch body streaming, EventSource, any Web Streams consumer | Cannot use W3C Compression Streams API or TransformStream-based polyfills on GJS | Expose Web Streams API globals (already available in SpiderMonkey 128 / Firefox) |
| `structuredClone` not available as global in GJS ESM | worker_threads, potentially all packages using message passing | Full polyfill in `@gjsify/utils` (`structured-clone.ts`) — supports Date, RegExp, Map, Set, Error types, ArrayBuffer, TypedArrays, DataView, Blob, File, circular refs, DataCloneError | Expose `structuredClone` as global in GJS ESM context (already available in SpiderMonkey 128) |
| `TextDecoder` malformed UTF-8 handling differs across SpiderMonkey versions | string_decoder | Pure manual UTF-8 decoder implementing W3C maximal subpart algorithm (`utf8DecodeMaximalSubpart`) | Fix SpiderMonkey 115's `TextDecoder` to follow W3C encoding spec for maximal subpart replacement |
| `queueMicrotask` not exposed as global in GJS 1.86 | timers, stream (any code needing microtask scheduling) | `Promise.resolve().then()` workaround | Expose `queueMicrotask` as global (already exists in SpiderMonkey 128) |
| `Soup.WebsocketConnection` only emits the coalesced `message` signal — no fragment-level / frame-level hook is exposed over GI. A text message with invalid UTF-8 in a later fragment is only validated after libsoup has buffered the entire message, so the RFC 6455 "fail the connection at the first invalid byte" timing is unreachable from JS. | @gjsify/websocket (manifests as Autobahn cases 6.4.1–6.4.4 `behavior: NON-STRICT, behaviorClose: OK, remoteCloseCode: 1007`) | None needed at the application layer — libsoup itself sends close 1007 and the client does so at end-of-message, which is RFC-correct but "late" by Autobahn's strict timing definition. No code is shipped to work around this. | **libsoup patch (`soup/websocket/*`)** — expose either a per-frame `incoming-fragment` signal or an opt-in "validate-as-you-go" mode on `SoupWebsocketConnection` for text opcodes. Either shape lets the client fail the connection before the next fragment arrives on the wire, flipping 6.4.x from NON-STRICT to strictly-OK. |

## Changelog

All dated entries live in [CHANGELOG.md](CHANGELOG.md). Do not duplicate them here.
