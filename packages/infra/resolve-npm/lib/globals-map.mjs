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
        'Buffer', 'Blob', 'File',
        'process', 'setImmediate', 'clearImmediate', 'queueMicrotask',
        'structuredClone', 'btoa', 'atob', 'URL', 'URLSearchParams',
    ],
    web: [
        'fetch', 'Headers', 'Request', 'Response',
        'FormData',
        'ReadableStream', 'WritableStream', 'TransformStream',
        'TextEncoderStream', 'TextDecoderStream',
        'ByteLengthQueuingStrategy', 'CountQueuingStrategy',
        'CompressionStream', 'DecompressionStream',
        'crypto',
        'AbortController', 'AbortSignal',
        'Event', 'EventTarget', 'CustomEvent', 'MessageEvent',
        'ErrorEvent', 'CloseEvent', 'ProgressEvent', 'UIEvent',
        'MouseEvent', 'PointerEvent', 'KeyboardEvent', 'WheelEvent', 'FocusEvent',
        'EventSource',
        'DOMException',
        'performance', 'PerformanceObserver',
        'XMLHttpRequest',
        'DOMParser',
        'AudioContext', 'webkitAudioContext', 'Audio', 'HTMLAudioElement',
        'GamepadEvent',
        'MediaDevices',
        'RTCPeerConnection', 'RTCSessionDescription', 'RTCIceCandidate',
        'RTCPeerConnectionIceEvent', 'RTCDataChannel', 'RTCDataChannelEvent',
        'RTCError', 'RTCErrorEvent',
        'MediaStream', 'MediaStreamTrack', 'RTCTrackEvent',
    ],
    dom: [
        'document', 'Image', 'HTMLCanvasElement', 'HTMLImageElement',
        'HTMLElement', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
        'FontFace', 'matchMedia', 'location', 'navigator',
    ],
};

export const GJS_GLOBALS_MAP = {
    // --- Node.js globals (granular register subpaths) ----------------------
    Buffer:               '@gjsify/node-globals/register/buffer',
    process:              '@gjsify/node-globals/register/process',
    setImmediate:         '@gjsify/node-globals/register/timers',
    clearImmediate:       '@gjsify/node-globals/register/timers',
    queueMicrotask:       '@gjsify/node-globals/register/microtask',
    structuredClone:      '@gjsify/node-globals/register/structured-clone',
    btoa:                 '@gjsify/node-globals/register/encoding',
    atob:                 '@gjsify/node-globals/register/encoding',

    // --- URL (shared Node + Web) -------------------------------------------
    URL:                  '@gjsify/node-globals/register/url',
    URLSearchParams:      '@gjsify/node-globals/register/url',

    // --- Blob / File (exposed via node:buffer and Web File API) ------------
    Blob:                 '@gjsify/buffer/register',
    File:                 '@gjsify/buffer/register',

    // --- Fetch stack -------------------------------------------------------
    fetch:                'fetch/register/fetch',
    Headers:              'fetch/register/fetch',
    Request:              'fetch/register/fetch',
    Response:             'fetch/register/fetch',

    // --- FormData ----------------------------------------------------------
    FormData:             '@gjsify/web-globals/register/formdata',

    // --- WHATWG Streams (granular register subpaths) ------------------------
    ReadableStream:       'web-streams/register/readable',
    WritableStream:       'web-streams/register/writable',
    TransformStream:      'web-streams/register/transform',
    TextEncoderStream:    'web-streams/register/text-streams',
    TextDecoderStream:    'web-streams/register/text-streams',
    ByteLengthQueuingStrategy: 'web-streams/register/queuing',
    CountQueuingStrategy: 'web-streams/register/queuing',

    // --- Compression Streams -----------------------------------------------
    CompressionStream:    'compression-streams/register',
    DecompressionStream:  'compression-streams/register',

    // --- WebCrypto ---------------------------------------------------------
    crypto:               'webcrypto/register',

    // --- Events + Abort (granular register subpaths) -----------------------
    AbortController:      'abort-controller/register',
    AbortSignal:          'abort-controller/register',
    Event:                'dom-events/register/event-target',
    EventTarget:          'dom-events/register/event-target',
    CustomEvent:          'dom-events/register/custom-events',
    MessageEvent:         'dom-events/register/custom-events',
    ErrorEvent:           'dom-events/register/custom-events',
    CloseEvent:           'dom-events/register/custom-events',
    ProgressEvent:        'dom-events/register/custom-events',
    UIEvent:              'dom-events/register/ui-events',
    MouseEvent:           'dom-events/register/ui-events',
    PointerEvent:         'dom-events/register/ui-events',
    KeyboardEvent:        'dom-events/register/ui-events',
    WheelEvent:           'dom-events/register/ui-events',
    FocusEvent:           'dom-events/register/ui-events',
    EventSource:          'eventsource/register',

    // --- Performance -------------------------------------------------------
    performance:          '@gjsify/web-globals/register/performance',
    PerformanceObserver:  '@gjsify/web-globals/register/performance',

    // --- DOMException ------------------------------------------------------
    DOMException:         'dom-exception/register',

    // --- XMLHttpRequest + URL.createObjectURL ------------------------------
    XMLHttpRequest:       '@gjsify/xmlhttprequest/register',

    // --- DOMParser ---------------------------------------------------------
    DOMParser:            '@gjsify/domparser/register',

    // --- Web Audio API (GStreamer backend) ----------------------------------
    AudioContext:         '@gjsify/webaudio/register',
    webkitAudioContext:   '@gjsify/webaudio/register',
    Audio:                '@gjsify/webaudio/register',
    HTMLAudioElement:     '@gjsify/webaudio/register',

    // --- Gamepad API (libmanette backend) -----------------------------------
    GamepadEvent:         '@gjsify/gamepad/register',

    // --- WebRTC (GStreamer webrtcbin backend) -------------------------------
    MediaDevices:               '@gjsify/webrtc/register/media-devices',
    RTCPeerConnection:          '@gjsify/webrtc/register/peer-connection',
    RTCSessionDescription:      '@gjsify/webrtc/register/peer-connection',
    RTCIceCandidate:            '@gjsify/webrtc/register/peer-connection',
    RTCPeerConnectionIceEvent:  '@gjsify/webrtc/register/peer-connection',
    RTCDataChannel:             '@gjsify/webrtc/register/data-channel',
    RTCDataChannelEvent:        '@gjsify/webrtc/register/data-channel',
    RTCError:                   '@gjsify/webrtc/register/error',
    RTCErrorEvent:              '@gjsify/webrtc/register/error',
    MediaStream:                '@gjsify/webrtc/register/media',
    MediaStreamTrack:           '@gjsify/webrtc/register/media',
    RTCTrackEvent:              '@gjsify/webrtc/register/media',

    // --- DOM elements (granular register subpaths) -------------------------
    document:             '@gjsify/dom-elements/register/document',
    Image:                '@gjsify/dom-elements/register/image',
    HTMLCanvasElement:    '@gjsify/dom-elements/register/canvas',
    HTMLImageElement:     '@gjsify/dom-elements/register/image',
    HTMLElement:          '@gjsify/dom-elements/register/document',
    MutationObserver:     '@gjsify/dom-elements/register/observers',
    ResizeObserver:       '@gjsify/dom-elements/register/observers',
    IntersectionObserver: '@gjsify/dom-elements/register/observers',
    FontFace:             '@gjsify/dom-elements/register/font-face',
    matchMedia:           '@gjsify/dom-elements/register/match-media',
    location:             '@gjsify/dom-elements/register/location',
    navigator:            '@gjsify/dom-elements/register/navigator',
};
