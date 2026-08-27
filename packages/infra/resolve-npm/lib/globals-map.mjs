/**
 * Map from global identifier → bare-specifier register subpath.
 *
 * Used by the `@gjsify/cli` `--globals` flag (via `@gjsify/esbuild-plugin-gjsify/globals`)
 * to resolve the user's explicit list of globals into the set of `/register`
 * modules that must be injected into the bundle.
 *
 * The register paths use bare specifiers ("fetch/register/fetch" rather than
 * "@gjsify/fetch/register/fetch") so they go through the normal ALIASES_WEB_FOR_GJS
 * / ALIASES_WEB_FOR_NODE resolution — which means they become no-ops on Node
 * (where native globals already exist) and resolve to the real
 * `@gjsify/<pkg>/register/<subpath>` modules on GJS.
 *
 * Granular subpaths (e.g. "dom-events/register/event-target" vs "dom-events/register")
 * ensure that --globals auto injects only the register code for identifiers
 * actually referenced in the bundle, keeping unused globals out of the output.
 */
/**
 * Pre-defined groups of identifiers that can be used as shorthand in `--globals`.
 *
 * - `node`  — Node.js core globals: Buffer, Blob, File, process, URL, …
 * - `web`   — Web API globals: fetch, crypto, streams, AbortController, events, …
 * - `dom`   — DOM/GTK-only globals: document, HTMLCanvasElement, Image, …
 *
 * A group token in `--globals` expands to all individual identifiers in that
 * group before the usual map lookup. Groups can be combined:
 *   --globals node,web,dom
 */
export const GJS_GLOBALS_GROUPS = {
    node: [
        'Buffer',
        'Blob',
        'File',
        'process',
        'setImmediate',
        'clearImmediate',
        'queueMicrotask',
        'structuredClone',
        'btoa',
        'atob',
        'URL',
        'URLSearchParams',
    ],
    web: [
        'fetch',
        'Headers',
        'Request',
        'Response',
        'FormData',
        'ReadableStream',
        'WritableStream',
        'TransformStream',
        'ReadableStreamBYOBReader',
        'ReadableStreamBYOBRequest',
        'ReadableByteStreamController',
        'ReadableStreamDefaultController',
        'ReadableStreamDefaultReader',
        'TextEncoderStream',
        'TextDecoderStream',
        'ByteLengthQueuingStrategy',
        'CountQueuingStrategy',
        'CompressionStream',
        'DecompressionStream',
        'crypto',
        'AbortController',
        'AbortSignal',
        'MessageChannel',
        'MessagePort',
        'Event',
        'EventTarget',
        'CustomEvent',
        'MessageEvent',
        'ErrorEvent',
        'CloseEvent',
        'ProgressEvent',
        'UIEvent',
        'MouseEvent',
        'PointerEvent',
        'KeyboardEvent',
        'WheelEvent',
        'FocusEvent',
        'EventSource',
        'WebSocket',
        'WebAssembly',
        'DOMException',
        'performance',
        'PerformanceObserver',
        'XMLHttpRequest',
        'XMLHttpRequestUpload',
        'DOMParser',
        'AudioContext',
        'webkitAudioContext',
        'Audio',
        'HTMLAudioElement',
        'GamepadEvent',
        'MediaDevices',
        'RTCPeerConnection',
        'RTCSessionDescription',
        'RTCIceCandidate',
        'RTCPeerConnectionIceEvent',
        'RTCDataChannel',
        'RTCDataChannelEvent',
        'RTCError',
        'RTCErrorEvent',
        'MediaStream',
        'MediaStreamTrack',
        'RTCTrackEvent',
    ],
    dom: [
        'document',
        'Image',
        'HTMLCanvasElement',
        'HTMLImageElement',
        'HTMLElement',
        'MutationObserver',
        'ResizeObserver',
        'IntersectionObserver',
        'FontFace',
        'matchMedia',
        'location',
        'navigator',
    ],
};

export const GJS_GLOBALS_MAP = {
    // --- Node.js globals (granular register subpaths) ----------------------
    Buffer: '@gjsify/node-globals/register/buffer',
    process: '@gjsify/node-globals/register/process',
    // setTimeout / setInterval ARE provided natively by GJS, but their return
    // value is a GLib.Source BoxedInstance whose deferred-GC finalize calls
    // g_source_unref on a possibly-freed source — silent SIGSEGV ~10 s after
    // any third-party library uses them. Our `register/timers` replacement
    // returns numeric IDs instead. Listing them here forces auto-globals to
    // inject the override on every bundle that calls setTimeout.
    setTimeout: '@gjsify/node-globals/register/timers',
    setInterval: '@gjsify/node-globals/register/timers',
    clearTimeout: '@gjsify/node-globals/register/timers',
    clearInterval: '@gjsify/node-globals/register/timers',
    setImmediate: '@gjsify/node-globals/register/timers',
    clearImmediate: '@gjsify/node-globals/register/timers',
    queueMicrotask: '@gjsify/node-globals/register/microtask',
    structuredClone: '@gjsify/node-globals/register/structured-clone',
    btoa: '@gjsify/node-globals/register/encoding',
    atob: '@gjsify/node-globals/register/encoding',

    // --- URL (shared Node + Web) -------------------------------------------
    URL: '@gjsify/node-globals/register/url',
    URLSearchParams: '@gjsify/node-globals/register/url',

    // --- Blob / File (exposed via node:buffer and Web File API) ------------
    Blob: '@gjsify/buffer/register',
    File: '@gjsify/buffer/register',

    // --- Fetch stack -------------------------------------------------------
    fetch: 'fetch/register/fetch',
    Headers: 'fetch/register/fetch',
    Request: 'fetch/register/fetch',
    Response: 'fetch/register/fetch',

    // --- FormData ----------------------------------------------------------
    FormData: '@gjsify/web-globals/register/formdata',

    // --- WHATWG Streams (granular register subpaths) ------------------------
    ReadableStream: 'web-streams/register/readable',
    ReadableStreamBYOBReader: 'web-streams/register/readable',
    ReadableStreamBYOBRequest: 'web-streams/register/readable',
    ReadableByteStreamController: 'web-streams/register/readable',
    ReadableStreamDefaultController: 'web-streams/register/readable',
    ReadableStreamDefaultReader: 'web-streams/register/readable',
    WritableStream: 'web-streams/register/writable',
    TransformStream: 'web-streams/register/transform',
    TextEncoderStream: 'web-streams/register/text-streams',
    TextDecoderStream: 'web-streams/register/text-streams',
    ByteLengthQueuingStrategy: 'web-streams/register/queuing',
    CountQueuingStrategy: 'web-streams/register/queuing',

    // --- Compression Streams -----------------------------------------------
    CompressionStream: 'compression-streams/register',
    DecompressionStream: 'compression-streams/register',

    // --- WebCrypto ---------------------------------------------------------
    crypto: 'webcrypto/register',

    // --- Events + Abort (granular register subpaths) -----------------------
    AbortController: 'abort-controller/register',
    AbortSignal: 'abort-controller/register',
    MessageChannel: 'message-channel/register',
    MessagePort: 'message-channel/register',
    Event: 'dom-events/register/event-target',
    EventTarget: 'dom-events/register/event-target',
    CustomEvent: 'dom-events/register/custom-events',
    MessageEvent: 'dom-events/register/custom-events',
    ErrorEvent: 'dom-events/register/custom-events',
    CloseEvent: 'dom-events/register/custom-events',
    ProgressEvent: 'dom-events/register/custom-events',
    UIEvent: 'dom-events/register/ui-events',
    MouseEvent: 'dom-events/register/ui-events',
    PointerEvent: 'dom-events/register/ui-events',
    KeyboardEvent: 'dom-events/register/ui-events',
    WheelEvent: 'dom-events/register/ui-events',
    FocusEvent: 'dom-events/register/ui-events',
    EventSource: 'eventsource/register',

    // --- WebSocket ---------------------------------------------------------
    // Single register module sets globalThis.{WebSocket,MessageEvent,CloseEvent}.
    // MessageEvent is shared with dom-events in practice — whichever register
    // runs first installs it; both guard with typeof === 'undefined'.
    WebSocket: 'websocket/register',

    // --- WebAssembly Promise APIs ------------------------------------------
    // Reach via marker (see METHOD_MARKERS in detect-free-globals.ts):
    // bare `WebAssembly.compile(...)` / `.instantiate(...)` etc. trigger
    // injection of the Promise polyfill. The synchronous `new WebAssembly.{Module,Instance}`
    // path also free-references `WebAssembly` and ends up here, but the
    // register module is a no-op when the natives already work.
    WebAssembly: 'webassembly/register/promise',

    // --- Performance -------------------------------------------------------
    performance: '@gjsify/web-globals/register/performance',
    PerformanceObserver: '@gjsify/web-globals/register/performance',

    // --- DOMException ------------------------------------------------------
    DOMException: 'dom-exception/register',

    // --- XMLHttpRequest (implemented in @gjsify/fetch) ---------------------
    XMLHttpRequest: 'fetch/register/xhr',
    XMLHttpRequestUpload: 'fetch/register/xhr',

    // --- DOMParser ---------------------------------------------------------
    DOMParser: '@gjsify/domparser/register',

    // --- Web Audio API (GStreamer backend) ----------------------------------
    AudioContext: '@gjsify/webaudio/register',
    webkitAudioContext: '@gjsify/webaudio/register',
    Audio: '@gjsify/webaudio/register',
    HTMLAudioElement: '@gjsify/webaudio/register',

    // --- Gamepad API (libmanette backend) -----------------------------------
    GamepadEvent: '@gjsify/gamepad/register',

    // --- WebRTC (GStreamer webrtcbin backend) -------------------------------
    MediaDevices: '@gjsify/webrtc/register/media-devices',
    RTCPeerConnection: '@gjsify/webrtc/register/peer-connection',
    RTCSessionDescription: '@gjsify/webrtc/register/peer-connection',
    RTCIceCandidate: '@gjsify/webrtc/register/peer-connection',
    RTCPeerConnectionIceEvent: '@gjsify/webrtc/register/peer-connection',
    RTCDataChannel: '@gjsify/webrtc/register/data-channel',
    RTCDataChannelEvent: '@gjsify/webrtc/register/data-channel',
    RTCError: '@gjsify/webrtc/register/error',
    RTCErrorEvent: '@gjsify/webrtc/register/error',
    MediaStream: '@gjsify/webrtc/register/media',
    MediaStreamTrack: '@gjsify/webrtc/register/media',
    RTCTrackEvent: '@gjsify/webrtc/register/media',

    // --- DOM elements (granular register subpaths) -------------------------
    document: '@gjsify/dom-elements/register/document',
    Image: '@gjsify/dom-elements/register/image',
    HTMLCanvasElement: '@gjsify/dom-elements/register/canvas',
    HTMLImageElement: '@gjsify/dom-elements/register/image',
    HTMLElement: '@gjsify/dom-elements/register/document',
    MutationObserver: '@gjsify/dom-elements/register/observers',
    ResizeObserver: '@gjsify/dom-elements/register/observers',
    IntersectionObserver: '@gjsify/dom-elements/register/observers',
    FontFace: '@gjsify/dom-elements/register/font-face',
    matchMedia: '@gjsify/dom-elements/register/match-media',
    location: '@gjsify/dom-elements/register/location',
    navigator: '@gjsify/dom-elements/register/navigator',

    // --- Canvas 2D + IFrame + WebGL (GTK/WebKit-backed DOM classes) --------
    //
    // These live in `packages/framework/*` rather than a Web/DOM pillar because
    // their implementations are GTK/Cairo-, WebKit- and Gwebgl/GLArea-bound
    // (ADR 0012). They are DELIBERATELY NOT members of `GJS_GLOBALS_GROUPS.dom`:
    // that group is the coarse `--globals auto,dom` safety net, and pulling
    // these into it would make every `auto,dom` build hard-require
    // `@gjsify/canvas2d` / `@gjsify/iframe` / `@gjsify/webgl` (and, for the
    // second, WebKitGTK) as an installed dependency. Auto-detection injects them
    // only when the identifier is actually referenced in the bundled,
    // tree-shaken output.
    ImageData: '@gjsify/canvas2d/register',
    Path2D: '@gjsify/canvas2d/register',
    HTMLIFrameElement: '@gjsify/iframe/register',
    WebGLRenderingContext: '@gjsify/webgl/register',
    WebGL2RenderingContext: '@gjsify/webgl/register',
};

/**
 * Reverse-bridge native-override identifiers.
 *
 * On a `--app node` reverse-bridge build (a genuine GJS app run on Node via
 * `@gjsify/node-gi`, EXPLICIT `--globals` requested), the register bodies for
 * these identifiers MUST win over the runtime-native globals the host ships —
 * unlike the default existence-guard (`if (typeof globalThis.X === 'undefined')`),
 * which is correct for a cross-platform package loaded on plain Node but wrong
 * here, where the app expects GJS Web-API semantics.
 *
 * Only `fetch` and its constructors qualify today: Node/Bun/Deno ship a native
 * global `fetch` (undici) that rejects the root-relative `/res/...` asset paths a
 * browser/GJS app uses, while `@gjsify/fetch` rewrites them to `file://` against
 * the program directory and drives Soup. Every OTHER Web/DOM global gjsify
 * injects (`XMLHttpRequest`, `document`, `Image`, `AudioContext`, the event
 * classes, …) is ABSENT on the host, so its guard already installs gjsify's
 * version — no override needed. `WebAssembly`/`URL`/`crypto`/streams are host
 * globals whose gjsify register deliberately DEFERS to the working native, so
 * they must NOT be listed here.
 *
 * Consumed by the `--app node` register-inject machinery
 * (`writeRegisterInjectFile`): the natives are cleared just before the injected
 * register bodies run, but ONLY for identifiers whose register is actually
 * injected (so no host global is deleted without a gjsify replacement).
 */
export const REVERSE_BRIDGE_NATIVE_OVERRIDE_IDENTS = ['fetch', 'Headers', 'Request', 'Response'];

/**
 * Register subpaths whose module imports a GObject-Introspection typelib
 * (`gi://…`) at load time, keyed by register-path PREFIX → the GI namespaces
 * they pull. `--globals auto` injecting one of these makes the resulting
 * bundle hard-require a GTK/GNOME runtime: under a GTK-less host (a headless
 * type-check container, SSR generator, plain CI) the bundle crashes at import
 * with `Typelib for <Ns> not found`.
 *
 * Consumed by `auto-globals.ts` to turn that otherwise-silent runtime crash
 * into an actionable build-time note naming the trigger references. Matched by
 * `path.startsWith(prefix)` so it covers every granular subpath of a package
 * (e.g. `…/register/document`, `…/register/canvas`) with one entry.
 *
 * Keep in lockstep with the GI-backed register modules: when a package's
 * `register/*` starts (or stops) importing a `gi://` namespace, update this
 * map. (Step in the "Adding a new global" checklist when the register is
 * GI-backed.) Only registers reachable via `GJS_GLOBALS_MAP` need an entry.
 */
export const GJS_GI_BACKED_REGISTERS = {
    '@gjsify/dom-elements/register': ['Gdk', 'GdkPixbuf', 'Pango', 'PangoCairo'],
    '@gjsify/webaudio/register': ['Gst', 'GstApp'],
    '@gjsify/webrtc/register': ['Gst', 'GstWebRTC', 'GstSdp'],
    '@gjsify/gamepad/register': ['Manette'],
    // Imports `@gjsify/dom-elements/register/canvas` (Gdk/GdkPixbuf/Pango/
    // PangoCairo) plus `@gjsify/canvas2d-core`, which uses the `cairo` foreign
    // struct module.
    '@gjsify/canvas2d/register': ['Gdk', 'GdkPixbuf', 'Pango', 'PangoCairo'],
    '@gjsify/iframe/register': ['WebKit'],
    // The WebGL context classes reach the GL driver through the `gwebgl` Vala
    // bridge shipped as this package's own prebuild, and decode `texImage2D`
    // sources via GdkPixbuf. Gtk/Gdk are NOT listed: they are pulled by
    // `webgl-bridge.ts` (the `Gtk.GLArea` widget), which the register does not
    // import — its chain is the two context classes only. As with the entries
    // above, the always-present base namespaces (GLib) are omitted; only the
    // ones whose absence breaks a GTK-less host are worth naming.
    '@gjsify/webgl/register': ['GdkPixbuf', 'Gwebgl'],
};

// ─── Browser target ────────────────────────────────────────────────────────
//
// `GJS_GLOBALS_MAP` is the GJS-target authority — every identifier needs a
// `@gjsify/<X>/register` install path because GJS ships none of them natively.
// The `--app browser` target inverts that: nearly every identifier in
// `GJS_GLOBALS_GROUPS.web` and `.dom` is already on the browser's `globalThis`
// (fetch, Headers, ReadableStream, Event, document, …). Only a handful of
// Node-group identifiers (Buffer, process, setImmediate, clearImmediate)
// need a polyfill register entry.
//
// The split below mirrors the T-Plan section 5b distinction:
//   - `BROWSER_NATIVE_IDENTS` — identifier set that resolves to no-op
//     register entries for `--app browser`. Used by both the audit-runtimes
//     `BROWSER_NATIVE_RE_EXPORTS` probe (T-Plan 5b-i) and the future
//     esbuild/rolldown `--globals` consumer to recognise that the identifier
//     does NOT need an injected register module on the browser target.
//   - `BROWSER_GLOBALS_MAP` — the strict subset of `GJS_GLOBALS_MAP` that
//     still needs a polyfill register path on the browser target. Today only
//     `Buffer` (`@gjsify/buffer/register`) and `process` (no `/register`
//     subpath shipped yet — placeholder string mirrored from GJS map until
//     `@gjsify/process` lands a browser-runnable register module).

/**
 * Identifiers that are natively present on a browser's `globalThis` and
 * therefore need no `/register` injection when `--app browser` is targeting
 * the bundle. Consumed by:
 *
 *   - `scripts/audit-runtimes.mjs` `BROWSER_NATIVE_RE_EXPORTS` probe
 *     (T-Plan section 1b) to decide whether a `globals.mjs` re-export source
 *     is recognisable as a browser-resolvable specifier.
 *   - `@gjsify/cli` `--globals` flag indirection — future browser-target
 *     consumer (T-Plan section 5b-iii `getGlobalsMapFor(target)`) maps these
 *     to a no-op register entry instead of injecting a `/register` shim.
 *
 * Drawn from `GJS_GLOBALS_GROUPS.web` and `.dom` (every entry there is
 * browser-native) plus a small set of shared identifiers from `.node`
 * (`queueMicrotask`, `structuredClone`, `btoa`, `atob`, `URL`,
 * `URLSearchParams`, and the unprefixed timer family).
 */
export const BROWSER_NATIVE_IDENTS = new Set([
    // Web group — all browser-native
    'fetch',
    'Headers',
    'Request',
    'Response',
    'FormData',
    'Blob',
    'File',
    'ReadableStream',
    'WritableStream',
    'TransformStream',
    'ReadableStreamBYOBReader',
    'ReadableStreamBYOBRequest',
    'ReadableByteStreamController',
    'ReadableStreamDefaultController',
    'ReadableStreamDefaultReader',
    'TextEncoderStream',
    'TextDecoderStream',
    'ByteLengthQueuingStrategy',
    'CountQueuingStrategy',
    'CompressionStream',
    'DecompressionStream',
    'crypto',
    'AbortController',
    'AbortSignal',
    'MessageChannel',
    'MessagePort',
    'Event',
    'EventTarget',
    'CustomEvent',
    'MessageEvent',
    'ErrorEvent',
    'CloseEvent',
    'ProgressEvent',
    'UIEvent',
    'MouseEvent',
    'PointerEvent',
    'KeyboardEvent',
    'WheelEvent',
    'FocusEvent',
    'EventSource',
    'WebSocket',
    'WebAssembly',
    'DOMException',
    'performance',
    'PerformanceObserver',
    'XMLHttpRequest',
    'XMLHttpRequestUpload',
    'DOMParser',
    'AudioContext',
    'webkitAudioContext',
    'Audio',
    'HTMLAudioElement',
    'GamepadEvent',
    'MediaDevices',
    'RTCPeerConnection',
    'RTCSessionDescription',
    'RTCIceCandidate',
    'RTCPeerConnectionIceEvent',
    'RTCDataChannel',
    'RTCDataChannelEvent',
    'RTCError',
    'RTCErrorEvent',
    'MediaStream',
    'MediaStreamTrack',
    'RTCTrackEvent',
    // DOM group — all browser-native
    'document',
    'Image',
    'HTMLCanvasElement',
    'HTMLImageElement',
    'HTMLElement',
    'MutationObserver',
    'ResizeObserver',
    'IntersectionObserver',
    'FontFace',
    'matchMedia',
    'location',
    'navigator',
    // Shared Node-group identifiers that are also browser-native
    'queueMicrotask',
    'structuredClone',
    'btoa',
    'atob',
    'URL',
    'URLSearchParams',
    'setTimeout',
    'setInterval',
    'clearTimeout',
    'clearInterval',
]);

/**
 * Identifier → register-subpath map for the `--app browser` target. Strict
 * subset of `GJS_GLOBALS_MAP`: only identifiers that do NOT exist natively
 * on `globalThis` in a browser need a polyfill register injection.
 *
 * Today: `Buffer` (the sole Node-group identifier with a shipped
 * `@gjsify/<X>/register` subpath that ALSO has a browser-runnable polyfill
 * landed on `main`). `process`, `setImmediate`, and `clearImmediate` will
 * join the map as `@gjsify/{process,timers}/register` granular subpaths
 * land (browser polyfill wave 3-A onwards).
 */
export const BROWSER_GLOBALS_MAP = {
    Buffer: '@gjsify/buffer/register',
};

/**
 * NativeScript globals map. NS' bundled V8 already provides every Web /
 * Node-runtime global that `GJS_GLOBALS_MAP` covers — `fetch`, `URL`,
 * `URLSearchParams`, `crypto` (incl. `crypto.getRandomValues`), `Promise`,
 * `setTimeout` / `setInterval`, `console`, `TextEncoder` / `TextDecoder`,
 * `atob` / `btoa`, `Blob`, `File`, `FormData`, `WebSocket`,
 * `XMLHttpRequest`, `structuredClone`, etc. — so no register-subpath
 * injection is needed for the default surface.
 *
 * `Buffer` is the one exception: NS does not ship `Buffer` as a global
 * (it's a Node-specific concept). Apps that consume `node:buffer` get the
 * polyfill via the alias layer; this map covers the bare `Buffer`
 * free-identifier case (parallel to the BROWSER_GLOBALS_MAP entry).
 *
 * Per-pillar Welle-5 PRs will extend this map as packages declare
 * `runtimes.nativescript = "polyfill"` and need a specific global stubbed.
 */
export const NATIVESCRIPT_GLOBALS_MAP = {
    Buffer: '@gjsify/buffer/register',
};

/**
 * Helper for consumers (esbuild/rolldown plugins, future audit consumers)
 * to fetch the right identifier → register-subpath map for a given build
 * target. Centralises the per-target choice so a consumer with a `target`
 * variable does not need to branch on the strings itself.
 *
 *   - `'gjs'`          → full `GJS_GLOBALS_MAP` (every identifier needs a register)
 *   - `'node'`         → `{}` (every GJS-mapped identifier is Node-native)
 *   - `'browser'`      → `BROWSER_GLOBALS_MAP` (subset that still needs a polyfill)
 *   - `'nativescript'` → `NATIVESCRIPT_GLOBALS_MAP` (subset NS V8 doesn't ship)
 *   - default          → `GJS_GLOBALS_MAP` (safer fallback for unknown targets)
 */
export function getGlobalsMapFor(target) {
    if (target === 'gjs') return GJS_GLOBALS_MAP;
    if (target === 'node') return {};
    if (target === 'browser') return BROWSER_GLOBALS_MAP;
    if (target === 'nativescript') return NATIVESCRIPT_GLOBALS_MAP;
    return GJS_GLOBALS_MAP;
}
