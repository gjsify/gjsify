/**
 * Map from global identifier → bare-specifier register subpath.
 *
 * Used by the `@gjsify/cli` `--globals` flag (via `@gjsify/esbuild-plugin-gjsify/globals`)
 * to resolve the user's explicit list of globals into the set of `/register`
 * modules that must be injected into the bundle.
 *
 * The register paths use bare specifiers ("fetch/register" rather than
 * "@gjsify/fetch/register") so they go through the normal ALIASES_WEB_FOR_GJS
 * / ALIASES_WEB_FOR_NODE resolution — which means they become no-ops on Node
 * (where native globals already exist) and resolve to the real
 * `@gjsify/<pkg>/register` modules on GJS.
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
    ],
    dom: [
        'document', 'Image', 'HTMLCanvasElement', 'HTMLImageElement',
        'HTMLElement', 'MutationObserver', 'ResizeObserver', 'IntersectionObserver',
    ],
};

export const GJS_GLOBALS_MAP = {
    // --- Node.js globals ------------------------------------------------
    Buffer:               '@gjsify/buffer/register',
    process:              '@gjsify/node-globals/register',
    setImmediate:         '@gjsify/node-globals/register',
    clearImmediate:       '@gjsify/node-globals/register',
    queueMicrotask:       '@gjsify/node-globals/register',
    structuredClone:      '@gjsify/node-globals/register',
    btoa:                 '@gjsify/node-globals/register',
    atob:                 '@gjsify/node-globals/register',

    // --- URL (shared Node + Web) ---------------------------------------
    URL:                  '@gjsify/node-globals/register',
    URLSearchParams:      '@gjsify/node-globals/register',

    // --- Blob / File (exposed via node:buffer and Web File API) --------
    Blob:                 '@gjsify/buffer/register',
    File:                 '@gjsify/buffer/register',

    // --- Fetch stack ----------------------------------------------------
    fetch:                'fetch/register',
    Headers:              'fetch/register',
    Request:              'fetch/register',
    Response:             'fetch/register',

    // --- FormData ------------------------------------------------------
    FormData:             '@gjsify/web-globals/register',

    // --- WHATWG Streams ------------------------------------------------
    ReadableStream:       'web-streams/register',
    WritableStream:       'web-streams/register',
    TransformStream:      'web-streams/register',
    TextEncoderStream:    'web-streams/register',
    TextDecoderStream:    'web-streams/register',
    ByteLengthQueuingStrategy: 'web-streams/register',
    CountQueuingStrategy: 'web-streams/register',

    // --- Compression Streams -------------------------------------------
    CompressionStream:    'compression-streams/register',
    DecompressionStream:  'compression-streams/register',

    // --- WebCrypto -----------------------------------------------------
    crypto:               'webcrypto/register',

    // --- Events + Abort ------------------------------------------------
    AbortController:      'abort-controller/register',
    AbortSignal:          'abort-controller/register',
    Event:                'dom-events/register',
    EventTarget:          'dom-events/register',
    CustomEvent:          'dom-events/register',
    MessageEvent:         'dom-events/register',
    ErrorEvent:           'dom-events/register',
    CloseEvent:           'dom-events/register',
    ProgressEvent:        'dom-events/register',
    UIEvent:              'dom-events/register',
    MouseEvent:           'dom-events/register',
    PointerEvent:         'dom-events/register',
    KeyboardEvent:        'dom-events/register',
    WheelEvent:           'dom-events/register',
    FocusEvent:           'dom-events/register',
    EventSource:          'eventsource/register',

    // --- Performance ---------------------------------------------------
    performance:          '@gjsify/web-globals/register',
    PerformanceObserver:  '@gjsify/web-globals/register',

    // --- DOMException --------------------------------------------------
    DOMException:         'dom-exception/register',

    // --- DOM elements (browser-compat) ---------------------------------
    document:             '@gjsify/dom-elements/register',
    Image:                '@gjsify/dom-elements/register',
    HTMLCanvasElement:    '@gjsify/dom-elements/register',
    HTMLImageElement:     '@gjsify/dom-elements/register',
    HTMLElement:          '@gjsify/dom-elements/register',
    MutationObserver:     '@gjsify/dom-elements/register',
    ResizeObserver:       '@gjsify/dom-elements/register',
    IntersectionObserver: '@gjsify/dom-elements/register',
};
