/** Array of Node.js build in module names */
export const EXTERNALS_NODE = [
    'assert',
    'assert/strict',
    'async_hooks',
    'buffer',
    'child_process',
    'cluster',
    'console',
    'constants',
    'crypto',
    'dgram',
    'diagnostics_channel',
    'dns',
    'dns/promises',
    'domain',
    'events',
    'fs',
    'fs/promises',
    'http',
    'http2',
    'https',
    'inspector',
    'module',
    'net',
    'os',
    'path',
    'path/posix',
    'path/win32',
    'perf_hooks',
    'process',
    'punycode',
    'querystring',
    'readline',
    'readline/promises',
    'repl',
    'stream',
    'stream/web',
    'stream/consumers',
    'stream/promises',
    'string_decoder',
    'sys',
    'test',
    'timers',
    'timers/promises',
    'tls',
    'tty',
    'url',
    'util',
    'util/types',
    'v8',
    'vm',
    'wasi',
    'sqlite',
    'worker_threads',
    'zlib',
]

/** Array of NPM module names for which we have our own implementation */
export const EXTERNALS_NPM = [
    'readable-stream',
    'node-fetch'
]

/** General record of modules for Gjs */
export const ALIASES_GENERAL_FOR_GJS = {
    // Third-party Node-only packages that must be stripped from GJS bundles.
    // jsdom is pulled in by @excaliburjs/plugin-tiled as a fallback when
    // DOMParser is not available; on GJS we provide DOMParser via
    // @gjsify/domparser, so jsdom and its whatwg-url/webidl-conversions
    // deps (which use SharedArrayBuffer — unavailable in GJS) are never needed.
    'jsdom': '@gjsify/empty',

    // engine.io-client ships both polling-xhr.node.js (uses xmlhttprequest-ssl /
    // Node http.request) and polling-xhr.js (uses globalThis.XMLHttpRequest).
    // The package.json `browser` field maps .node.js → .js for browser builds, but
    // esbuild with platform:neutral does not apply browser-field path maps.
    // We apply them explicitly here: the aliasPlugin matches the relative import
    // specifier exactly (since onResolve args.path = the original import string)
    // and resolves ./polling-xhr.js relative to the importer's directory.
    // @gjsify/fetch provides a proper XMLHttpRequest on globalThis via register/xhr.
    './polling-xhr.node.js': './polling-xhr.js',
    './websocket.node.js': './websocket.js',
    './globals.node.js': './globals.js',

}

/** Record of Node.js modules (build in or not) and his replacement for Gjs */
export const ALIASES_NODE_FOR_GJS = {
    // Internal Node.js modules
    'assert': '@gjsify/assert',
    'assert/strict': '@gjsify/assert/strict',
    'async_hooks': '@gjsify/async_hooks',
    'buffer': '@gjsify/buffer',
    'child_process': '@gjsify/child_process',
    'cluster': '@gjsify/cluster',
    'console': '@gjsify/console',
    'constants': '@gjsify/constants',
    'crypto': '@gjsify/crypto',
    'dgram': '@gjsify/dgram',
    'diagnostics_channel': '@gjsify/diagnostics_channel',
    'dns': '@gjsify/dns',
    'dns/promises': '@gjsify/dns/promises',
    'domain': '@gjsify/domain',
    'events': '@gjsify/events',
    'fs': '@gjsify/fs',
    'fs/promises': '@gjsify/fs/promises',
    'http': '@gjsify/http',
    'http2': '@gjsify/http2',
    'https': '@gjsify/https',
    'inspector': '@gjsify/inspector',
    'module': '@gjsify/module',
    'net': '@gjsify/net',
    'os': '@gjsify/os',
    'path': '@gjsify/path',
    'path/posix': '@gjsify/path/posix',
    'path/win32': '@gjsify/path/win32',
    'perf_hooks': '@gjsify/perf_hooks',
    'process': '@gjsify/process',
    'punycode': '@gjsify/punycode', // stub — deprecated, low priority
    'querystring': '@gjsify/querystring',
    'readline': '@gjsify/readline',
    'readline/promises': '@gjsify/readline/promises',
    'repl': '@gjsify/repl', // stub — low priority
    'stream': '@gjsify/stream',
    'stream/web': '@gjsify/stream/web',
    'stream/consumers': '@gjsify/stream/consumers',
    'stream/promises': '@gjsify/stream/promises',
    'string_decoder': '@gjsify/string_decoder',
    'sys': '@gjsify/sys',
    // 'test': '@gjsify/test', // not planned — use @gjsify/unit instead
    'timers': '@gjsify/timers',
    'timers/promises': '@gjsify/timers/promises',
    'tls': '@gjsify/tls',
    'tty': '@gjsify/tty',
    'url': '@gjsify/url',
    'util': '@gjsify/util',
    'util/types': '@gjsify/util/types',
    'v8': '@gjsify/v8',
    'vm': '@gjsify/vm',
    'wasi': '@gjsify/wasi', // stub — low priority (WebAssembly System Interface)
    'sqlite': '@gjsify/sqlite',
    'worker_threads': '@gjsify/worker_threads',
    'zlib': '@gjsify/zlib',

    // Third party Node Modules
    'node-fetch': '@gjsify/fetch',
    // `ws` npm package — drop-in CLIENT+SERVER wrapper. The client side
    // delegates to globalThis.WebSocket (Soup.WebsocketConnection via
    // @gjsify/websocket); the server side wraps Soup.Server. Aliasing
    // `ws` here replaces the broken browser-field stub in the upstream
    // package ("ws does not work in the browser") that esbuild's
    // "browser" condition would otherwise load. Consumer code like
    //   import ws, { WebSocket, WebSocketServer } from 'ws'
    // resolves to @gjsify/ws unchanged, including the `typeof ws ===
    // 'function'` heuristic used by @thaunknown/simple-websocket and
    // similar transitive users.
    'ws': '@gjsify/ws',

    // isomorphic-ws's browser.js is literally `module.exports = WebSocket`
    // — just the native class. On GJS that native class is @gjsify/websocket
    // (Soup.WebsocketConnection), so skip the @gjsify/ws ws-API wrapper
    // entirely and route isomorphic-ws directly to @gjsify/websocket.
    // Consumers who do `import WS from 'isomorphic-ws'` get our class
    // unchanged — one less delegation hop than going through @gjsify/ws.
    'isomorphic-ws': '@gjsify/websocket',
}

/** Record of Web modules and his replacement for Gjs */
export const ALIASES_WEB_FOR_GJS = {
    // Bare specifiers (named imports, pure — no side-effects after Stage 2)
    'abort-controller': '@gjsify/abort-controller',
    'compression-streams': '@gjsify/compression-streams',
    'dom-events': '@gjsify/dom-events',
    'dom-exception': '@gjsify/dom-exception',
    'event-target-shim': '@gjsify/dom-events',
    'eventsource': '@gjsify/eventsource',
    'fetch': '@gjsify/fetch',
    'formdata': '@gjsify/formdata',
    'html-image-element': '@gjsify/html-image-element',
    'webcrypto': '@gjsify/webcrypto',
    'webgl': '@gjsify/webgl',
    'websocket': '@gjsify/websocket',
    'webstorage': '@gjsify/webstorage',

    // /register subpaths (side-effect only — opt-in to global registration)
    'abort-controller/register': '@gjsify/abort-controller/register',
    'compression-streams/register': '@gjsify/compression-streams/register',
    'dom-events/register': '@gjsify/dom-events/register',
    'dom-events/register/event-target': '@gjsify/dom-events/register/event-target',
    'dom-events/register/custom-events': '@gjsify/dom-events/register/custom-events',
    'dom-events/register/ui-events': '@gjsify/dom-events/register/ui-events',
    'dom-exception/register': '@gjsify/dom-exception/register',
    'eventsource/register': '@gjsify/eventsource/register',
    'websocket/register': '@gjsify/websocket/register',
    'fetch/register': '@gjsify/fetch/register',
    'fetch/register/fetch': '@gjsify/fetch/register/fetch',
    'fetch/register/xhr': '@gjsify/fetch/register/xhr',
    'webcrypto/register': '@gjsify/webcrypto/register',
    'web-streams/register': '@gjsify/web-streams/register',
    'web-streams/register/readable': '@gjsify/web-streams/register/readable',
    'web-streams/register/writable': '@gjsify/web-streams/register/writable',
    'web-streams/register/transform': '@gjsify/web-streams/register/transform',
    'web-streams/register/text-streams': '@gjsify/web-streams/register/text-streams',
    'web-streams/register/queuing': '@gjsify/web-streams/register/queuing',

    // xmlhttprequest (implemented in @gjsify/fetch)
    'xmlhttprequest': '@gjsify/fetch',
    'xmlhttprequest/register': '@gjsify/fetch/register/xhr',
    '@gjsify/xmlhttprequest': '@gjsify/fetch',
    '@gjsify/xmlhttprequest/register': '@gjsify/fetch/register/xhr',
    'domparser': '@gjsify/domparser',
    'domparser/register': '@gjsify/domparser/register',

    // Web Audio API (GStreamer backend)
    'webaudio': '@gjsify/webaudio',
    'webaudio/register': '@gjsify/webaudio/register',

    // Gamepad API (libmanette backend)
    'gamepad': '@gjsify/gamepad',
    'gamepad/register': '@gjsify/gamepad/register',

    // WebRTC API (GStreamer webrtcbin backend)
    'webrtc': '@gjsify/webrtc',
    'webrtc/register': '@gjsify/webrtc/register',
    'webrtc/register/peer-connection': '@gjsify/webrtc/register/peer-connection',
    'webrtc/register/data-channel': '@gjsify/webrtc/register/data-channel',
    'webrtc/register/error': '@gjsify/webrtc/register/error',
    'webrtc/register/media': '@gjsify/webrtc/register/media',
    'webrtc/register/media-devices': '@gjsify/webrtc/register/media-devices',

    // WebAssembly Promise APIs polyfill — wraps the synchronous Module/Instance
    // constructors so WebAssembly.{compile,instantiate,validate,...} resolve
    // instead of throwing the SpiderMonkey 128 stub error.
    'webassembly': '@gjsify/webassembly',
    'webassembly/register': '@gjsify/webassembly/register',
    'webassembly/register/promise': '@gjsify/webassembly/register/promise',
}

/** General record of modules for Node */
export const ALIASES_GENERAL_FOR_NODE = {
    '@gjsify/node-globals': '@gjsify/empty',
    '@gjsify/node-globals/register': '@gjsify/empty',
    '@gjsify/node-globals/register/process': '@gjsify/empty',
    '@gjsify/node-globals/register/buffer': '@gjsify/empty',
    '@gjsify/node-globals/register/timers': '@gjsify/empty',
    '@gjsify/node-globals/register/encoding': '@gjsify/empty',
    '@gjsify/node-globals/register/url': '@gjsify/empty',
    '@gjsify/node-globals/register/structured-clone': '@gjsify/empty',
    '@gjsify/node-globals/register/microtask': '@gjsify/empty',
    '@gjsify/web-globals': '@gjsify/empty',
    '@gjsify/web-globals/register': '@gjsify/empty',
    '@gjsify/web-globals/register/performance': '@gjsify/empty',
    '@gjsify/web-globals/register/formdata': '@gjsify/empty',
}

/** Record of Gjs modules (build in or not) and his replacement for Node */
const ALIASES_GJS_FOR_NODE = {}

export { ALIASES_GJS_FOR_NODE };

/** Record of Web modules and his replacement for Node */
export const ALIASES_WEB_FOR_NODE = {
    // Bare specifiers → native re-exports (works for both named and side-effect imports)
    'abort-controller': '@gjsify/abort-controller/globals',
    'compression-streams': '@gjsify/compression-streams/globals',
    'dom-events': '@gjsify/dom-events/globals',
    'dom-exception': '@gjsify/dom-exception/globals',
    'eventsource': '@gjsify/eventsource/globals',
    // 'fetch' bare specifier is intentionally not aliased on Node:
    // fetch/Headers/Request/Response/FormData are native globals since Node 18,
    // so specs / app code should read them off globalThis. Users who need the
    // value form should `import { fetch } from '@gjsify/fetch'` explicitly.
    // 'fetch': '@gjsify/fetch/globals',
    'formdata': '@gjsify/formdata/globals',
    'html-image-element': '@gjsify/html-image-element',
    'webcrypto': '@gjsify/webcrypto/globals',
    'webgl': '@gjsify/webgl',
    'websocket': '@gjsify/websocket/globals',
    'webstorage': '@gjsify/webstorage',

    // /register subpaths — no-op on Node (native globals are already set)
    'abort-controller/register': '@gjsify/empty',
    'compression-streams/register': '@gjsify/empty',
    'dom-events/register': '@gjsify/empty',
    'dom-events/register/event-target': '@gjsify/empty',
    'dom-events/register/custom-events': '@gjsify/empty',
    'dom-events/register/ui-events': '@gjsify/empty',
    'dom-exception/register': '@gjsify/empty',
    'eventsource/register': '@gjsify/empty',
    'websocket/register': '@gjsify/empty',
    'fetch/register': '@gjsify/empty',
    'fetch/register/fetch': '@gjsify/empty',
    'fetch/register/xhr': '@gjsify/empty',
    'webcrypto/register': '@gjsify/empty',
    'web-streams/register': '@gjsify/empty',
    'web-streams/register/readable': '@gjsify/empty',
    'web-streams/register/writable': '@gjsify/empty',
    'web-streams/register/transform': '@gjsify/empty',
    'web-streams/register/text-streams': '@gjsify/empty',
    'web-streams/register/queuing': '@gjsify/empty',
    '@gjsify/abort-controller/register': '@gjsify/empty',
    '@gjsify/compression-streams/register': '@gjsify/empty',
    '@gjsify/dom-events/register': '@gjsify/empty',
    '@gjsify/dom-events/register/event-target': '@gjsify/empty',
    '@gjsify/dom-events/register/custom-events': '@gjsify/empty',
    '@gjsify/dom-events/register/ui-events': '@gjsify/empty',
    '@gjsify/dom-exception/register': '@gjsify/empty',
    '@gjsify/eventsource/register': '@gjsify/empty',
    '@gjsify/websocket/register': '@gjsify/empty',
    '@gjsify/fetch/register': '@gjsify/empty',
    '@gjsify/fetch/register/fetch': '@gjsify/empty',
    '@gjsify/fetch/register/xhr': '@gjsify/empty',
    '@gjsify/webcrypto/register': '@gjsify/empty',
    '@gjsify/web-streams/register': '@gjsify/empty',
    '@gjsify/web-streams/register/readable': '@gjsify/empty',
    '@gjsify/web-streams/register/writable': '@gjsify/empty',
    '@gjsify/web-streams/register/transform': '@gjsify/empty',
    '@gjsify/web-streams/register/text-streams': '@gjsify/empty',
    '@gjsify/web-streams/register/queuing': '@gjsify/empty',
    '@gjsify/dom-elements/register': '@gjsify/empty',
    '@gjsify/dom-elements/register/document': '@gjsify/empty',
    '@gjsify/dom-elements/register/canvas': '@gjsify/empty',
    '@gjsify/dom-elements/register/image': '@gjsify/empty',
    '@gjsify/dom-elements/register/observers': '@gjsify/empty',
    '@gjsify/dom-elements/register/font-face': '@gjsify/empty',
    '@gjsify/dom-elements/register/match-media': '@gjsify/empty',
    '@gjsify/dom-elements/register/location': '@gjsify/empty',
    '@gjsify/dom-elements/register/navigator': '@gjsify/empty',
    '@gjsify/buffer/register': '@gjsify/empty',

    // xmlhttprequest + DOMParser — no-op on Node
    'xmlhttprequest': '@gjsify/empty',
    'xmlhttprequest/register': '@gjsify/empty',
    '@gjsify/xmlhttprequest': '@gjsify/empty',
    '@gjsify/xmlhttprequest/register': '@gjsify/empty',
    'domparser': '@gjsify/empty',
    'domparser/register': '@gjsify/empty',
    '@gjsify/domparser/register': '@gjsify/empty',

    // Web Audio API — no-op on Node (experimental --experimental-web-audio not widely available)
    'webaudio': '@gjsify/empty',
    'webaudio/register': '@gjsify/empty',
    '@gjsify/webaudio/register': '@gjsify/empty',

    // Gamepad API — no-op on Node
    'gamepad': '@gjsify/empty',
    'gamepad/register': '@gjsify/empty',
    '@gjsify/gamepad/register': '@gjsify/empty',

    // WebRTC API — no-op on Node (Phase 1 is GStreamer-only, no fallback)
    'webrtc': '@gjsify/empty',
    'webrtc/register': '@gjsify/empty',
    'webrtc/register/peer-connection': '@gjsify/empty',
    'webrtc/register/data-channel': '@gjsify/empty',
    'webrtc/register/error': '@gjsify/empty',
    'webrtc/register/media': '@gjsify/empty',
    'webrtc/register/media-devices': '@gjsify/empty',
    '@gjsify/webrtc': '@gjsify/empty',
    '@gjsify/webrtc/register': '@gjsify/empty',
    '@gjsify/webrtc/register/peer-connection': '@gjsify/empty',
    '@gjsify/webrtc/register/data-channel': '@gjsify/empty',
    '@gjsify/webrtc/register/error': '@gjsify/empty',
    '@gjsify/webrtc/register/media': '@gjsify/empty',
    '@gjsify/webrtc/register/media-devices': '@gjsify/empty',

    // WebAssembly Promise APIs — native on Node (no polyfill needed); the
    // bare `webassembly` specifier maps to /globals so consumers can import
    // typed helpers without dragging the polyfill into the bundle.
    'webassembly': '@gjsify/webassembly/globals',
    'webassembly/register': '@gjsify/empty',
    'webassembly/register/promise': '@gjsify/empty',
    '@gjsify/webassembly/register': '@gjsify/empty',
    '@gjsify/webassembly/register/promise': '@gjsify/empty',
}
