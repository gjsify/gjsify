# AGENTS.md — `packages/web/*` (Web pillar)

> Scope: this directory tree. Repo-wide rules live in the [root AGENTS.md](../../AGENTS.md) — read that first.

## Web Packages — `packages/web/*`

| Pkg | Libs | Implements |
|-----|------|------------|
| fetch | Soup 3.0, Gio | fetch(), Request (raw body via `set_request_body_from_bytes`), Response, Headers. **No XHR** — that lives in `@gjsify/xmlhttprequest` |
| xmlhttprequest | Soup 3.0, GLib | XMLHttpRequest, full `responseType`. Backs Excalibur's asset loader |
| dom-events | — | Event, CustomEvent, EventTarget, UI/Mouse/Pointer/Keyboard/Wheel/FocusEvent |
| dom-exception | — | DOMException (WebIDL) |
| abort-controller | — | AbortController, AbortSignal |
| message-channel | — | MessageChannel, MessagePort (W3C, EventTarget-based, transport-pluggable — backs `@gjsify/iframe` WebKit bridge + worker_threads cross-process). Stock GJS exposes neither |
| formdata | — | FormData, File |
| streams | — | ReadableStream, WritableStream, TransformStream, TextEncoder/DecoderStream |
| compression-streams | Gio | CompressionStream, DecompressionStream |
| webcrypto | GLib, Gio | crypto.subtle, getRandomValues, randomUUID. **Owns the entropy chain for the whole workspace**: `@gjsify/webcrypto/random` (a LEAF subpath — no SubtleCrypto, no dom-exception — so `@gjsify/crypto` consumes it cycle-free) exports `fillRandomBytes()` with an ORDERED, reported source chain: WebCrypto getRandomValues → `/dev/urandom` via Gio → `GLib.random_int_range` → `Math.random`; the last two are NOT cryptographic and say so once on stderr; `isSecureRandomSource(tier)` is the machine-readable form; `{webcrypto: null}` skips tier 1 so the polyfill uses the chain without recursing into itself. This replaced two copies that were each locally defensible and wrong in composition: `CryptoPolyfill.getRandomValues` claimed "GLib or Math.random" above a loop that only ever ran `Math.random()`, and `@gjsify/crypto.randomBytes` preferred `globalThis.crypto` — which on GJS IS that polyfill. `randomBytes()` therefore handed out non-cryptographic bytes on GJS, invisibly from either side |
| eventsource | Soup 3.0 | EventSource (SSE) |
| websocket | Soup 3.0 | WebSocket, MessageEvent, CloseEvent. NUL-byte-safe text frames — send via `send_message(TEXT, GLib.Bytes)`, because Soup's `send_text` truncates at `\0`. RFC 6455 fuzz-validated via Autobahn |
| webstorage | Gio | localStorage, sessionStorage |
| webassembly | — | Promise-API polyfill wrapping SpiderMonkey's working synchronous `new WebAssembly.{Module,Instance}`. Granular `/register/promise`; auto-injected via `WebAssembly.<method>` METHOD_MARKERS |
| webaudio | Gst 1.0, GstApp, Gio | AudioContext (decodeAudioData via decodebin), AudioBufferSourceNode, GainNode, AudioBuffer, HTMLAudioElement. **Every pipeline is REGISTERED and guaranteed to reach `GST_STATE_NULL`** (`gst-teardown.ts`) — see § Code anti-patterns (lifecycle) for the why; registry = `trackPipeline`/`stopPipeline` (idempotent)/`stopAllPipelines()`, wired to whichever exit the host HAS (`GApplication::shutdown` for GTK, `process.on('exit')` for node/bun/deno) + `AudioContext.close()`; `decodeAudioDataSync` tears down in `finally`. A gjs SCRIPT/test host has neither hook (`@gjsify/unit` exits via `imports.system.exit`, no `'exit'` event) so the suite drains the registry itself |
| webrtc | Gst, GstWebRTC, GstSDP | Full W3C WebRTC (RTCPeerConnection, RTCDataChannel, senders/receivers/transceivers, MediaStream(Track), getUserMedia via pipewiresrc/pulsesrc/v4l2src chain, DTMF, certs, stats). Tee-multiplexer for shared-source fan-out. Backed by `@gjsify/webrtc-native` |
| webrtc-native | Gst, GstWebRTC | **Vala/GObject prebuild** — three main-thread signal bridges (Webrtcbin/DataChannel/Promise) capturing webrtcbin's streaming-thread callbacks in C and re-emitting via `GLib.Idle.add()` on the main context, so they are safe to handle from JS. Prebuilds linux-{x64,arm64} |
| domparser | — | DOMParser.parseFromString (XML/HTML), minimal DOM sized for excalibur-tiled + config parsing |
| gamepad | Manette 0.2 | Gamepad polling via libmanette signals, GamepadEvent, dual-rumble haptics. Lazy Monitor init; `getGamepads()` = the spec's `[[gamepads]]`, EMPTY until a device connects. **No backend on macOS/Windows** (libmanette is Linux-only), made observable by a quiet `hasGamepadBackend()` + one diagnostic from the USE. Details: `packages/web/gamepad/README.md` |
| web-globals | — | re-exports all web API globals |
| polyfills | — | `@gjsify/web-polyfills` dep-only umbrella (templates + scaffolds) |
| adwaita-web | — | Browser Adwaita components (Custom Elements + SCSS mirroring `refs/adwaita-web/adwaita-web/scss/`), built to `dist/adwaita-web.css` via sass, light/dark. No GJS deps. Adaptive by itself since `addBreakpoints` (ResizeObserver) — `breakpoint="max-width: 720px"` on either split view drives `collapsed`. Coverage matrix is DERIVED into STATUS.md; the roadmap section holds only the upstream partials with no counterpart |
| adwaita-fonts | — | Adwaita **Sans** TTFs (normal+italic; NO Mono) + `@font-face` CSS, from `refs/adwaita-fonts/`, SIL OFL 1.1. `index.css` serves a pipeline that resolves `url()`; **from JS import the generated `./embedded`** (`applyAdwaitaFonts()`, `data:` URIs). Bare `import '@gjsify/adwaita-fonts'` is `export default "<css>"` under css-as-string — a side effect that is not one, MEASURED as a 0-byte bundle, 0 `@font-face`, exit 0. Opt-in: the two faces inlined are 2.39 MB / 1.18 MB gzip against a 190 KB / 26 KB stylesheet. `index.css` and `./embedded` ship the SAME two faces |
| adwaita-icons | — | Adwaita symbolic icons as importable SVG strings + `toDataUri()`, from `refs/adwaita-icon-theme/`, CC0-1.0/LGPLv3 |
| adwaita-core | — | **Headless Adwaita widget behavior** (ADR 0004) — pure TS, all-`polyfill`, no `/register`. Breakpoints (grammar/parser/evaluator + transition-only `AdwBreakpoint`), color-scheme observable, toast queue, alert responses, row state machines, avatar derivation, view-stack/navigation/sidebar/entry-row/split-view/split-button state, and `glibClamp`. The `./conformance` SUBPATH ships the libadwaita-derived vector tables BOTH renderer suites drive their real widgets with — a renderer that re-implements a derivation instead of delegating fails a unit test naming the input, which is what the two ports needed and did not have. `gjsify.headless: true` machine-checks the no-platform-imports claim |
