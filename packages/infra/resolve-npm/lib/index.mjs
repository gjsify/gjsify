// Runtime-aware alias derivation — driven by per-package `gjsify.runtimes`
// triplet declarations. See `./runtime-aliases.mjs` for the routing rules.
// These helpers AUGMENT the hardcoded `ALIASES_*` maps below: a package
// without a declared triplet falls through to the hardcoded map for that
// specifier, preserving backwards-compatible behavior for the 21 infra/gjs
// packages that opted out of the triplet model.
export {
    getDerivedAliases,
    getDerivedAliasesSync,
    listDeclaredRuntimes,
    resetRuntimeAliasesCache,
} from './runtime-aliases.mjs';

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

/**
 * Record of Node.js modules (built-in or 3rd-party) and their `@gjsify/<X>`
 * replacement for `--app browser` builds. Mirrors `ALIASES_NODE_FOR_GJS` in
 * shape — bare bridge from the NPM-specifier namespace into `@gjsify/*` so the
 * dynamic per-runtimes-triplet resolver (`getDerivedAliasesSync`) can finish
 * the routing in a second pass (`@gjsify/<X>` → `@gjsify/<X>/globals` or
 * `@gjsify/empty` depending on the slot declaration).
 *
 * `none`-slot entries are deliberately hardcoded to `@gjsify/empty` here
 * (e.g. `child_process`, `fs`, `net`, ...) rather than relying on the dynamic
 * runtime layer — bare `fs` / `net` / ... do NOT start with `@gjsify/` and
 * therefore never enter `getDerivedAliasesSync`. This table is the bridge.
 *
 * NOTE — UNWIRED IN THIS PR. The browser-app orchestrator
 * (`packages/infra/rolldown-plugin-gjsify/src/app/browser.ts`) does NOT
 * consume this map yet. PR-D (T-Plan Sektion 2b-ii + 2b-iii, Welle 3) flips
 * `browser.ts` to spread `ALIASES_NODE_FOR_BROWSER` (+ generated `node:*`
 * prefix-map) into its `aliasMap` UNDER `browserPolyfillAliases` and the user
 * aliases. Decoupled here so the table is exportable / reviewable in
 * isolation, while consumer wiring waits on the R1 wave delivering browser-
 * baubable `@gjsify/{process,buffer,stream,...}` builds. Adopt only when the
 * per-package browser slots are R1-validated.
 */
export const ALIASES_NODE_FOR_BROWSER = {
    'assert':              '@gjsify/assert',
    'assert/strict':       '@gjsify/assert/strict',
    'async_hooks':         '@gjsify/async_hooks',
    'buffer':              '@gjsify/buffer',
    'child_process':       '@gjsify/empty',        // none-slot — browser has no process model
    'cluster':             '@gjsify/empty',
    'console':             '@gjsify/console',
    'constants':           '@gjsify/constants',
    'crypto':              '@gjsify/crypto',
    'dgram':               '@gjsify/empty',
    'diagnostics_channel': '@gjsify/diagnostics_channel',
    'dns':                 '@gjsify/empty',
    'dns/promises':        '@gjsify/empty',
    'domain':              '@gjsify/domain',
    'events':              '@gjsify/events',
    'fs':                  '@gjsify/empty',        // phase 1: stub; later @gjsify/fs/browser
    'fs/promises':         '@gjsify/empty',
    'http':                '@gjsify/empty',        // browser fetch covers most cases
    'http2':               '@gjsify/empty',
    'https':               '@gjsify/empty',
    'inspector':           '@gjsify/empty',
    'module':              '@gjsify/empty',
    'net':                 '@gjsify/empty',
    'os':                  '@gjsify/os',
    'path':                '@gjsify/path',
    'path/posix':          '@gjsify/path/posix',
    'path/win32':          '@gjsify/path/win32',
    'perf_hooks':          '@gjsify/perf_hooks',
    'process':             '@gjsify/process',      // PR-D: flips today's `@gjsify/empty`
    'punycode':            '@gjsify/punycode',
    'querystring':         '@gjsify/querystring',
    'readline':            '@gjsify/empty',
    'readline/promises':   '@gjsify/empty',
    'repl':                '@gjsify/empty',
    'stream':              '@gjsify/stream',
    'stream/web':          '@gjsify/stream/web',
    'stream/consumers':    '@gjsify/stream/consumers',
    'stream/promises':     '@gjsify/stream/promises',
    'string_decoder':      '@gjsify/string_decoder',
    'sys':                 '@gjsify/sys',
    'timers':              '@gjsify/timers',
    'timers/promises':     '@gjsify/timers/promises',
    'tls':                 '@gjsify/empty',
    'tty':                 '@gjsify/empty',
    'url':                 '@gjsify/url',
    'util':                '@gjsify/util',
    'util/types':          '@gjsify/util/types',
    'v8':                  '@gjsify/empty',
    'vm':                  '@gjsify/vm',
    'wasi':                '@gjsify/empty',
    'sqlite':              '@gjsify/empty',
    'worker_threads':      '@gjsify/empty',
    'zlib':                '@gjsify/zlib',

    // Third-party
    'node-fetch':          '@gjsify/empty',        // browser native fetch
    'ws':                  '@gjsify/empty',        // browser native WebSocket
    'isomorphic-ws':       '@gjsify/empty',
}

/**
 * Bare Node-builtin specifier → polyfill / empty-stub mapping for `--app
 * nativescript` builds. Mirrors `ALIASES_NODE_FOR_BROWSER` in shape, with
 * different per-module decisions reflecting what makes sense on a mobile-V8
 * runtime (NativeScript on iOS + Android):
 *
 * - **Server-only Node built-ins → `@gjsify/empty`.** There is no listening
 *   socket / process model on a mobile-app runtime, so `child_process`,
 *   `cluster`, `dgram`, `dns`, `inspector`, `net`, `tls`, `tty`, `http*`
 *   resolve to an empty stub. NativeScript apps that need network I/O use
 *   the runtime-native `fetch` / `XMLHttpRequest` / `WebSocket`.
 * - **Mobile-tractable Node built-ins → `@gjsify/<X>`.** `assert`,
 *   `async_hooks`, `buffer`, `crypto`, `events`, `fs`, `os`, `path`,
 *   `process`, `stream`, `string_decoder`, `url`, `util`, `querystring`
 *   route to their gjsify polyfills. The polyfills themselves may declare
 *   `runtimes.nativescript = "polyfill" | "partial" | "none"`; the
 *   triplet-driven `getDerivedAliasesSync('nativescript')` second pass
 *   reads the declaration and either keeps the resolution as-is (polyfill /
 *   partial) or redirects to `/globals` (native) or `@gjsify/empty` (none).
 * - **`ws` / `isomorphic-ws` → `@gjsify/empty`.** NS apps use `WebSocket`
 *   from the global runtime, not the `ws` package.
 *
 * Entries here are PROVISIONAL — per-pillar Welle-5 PRs will refine them as
 * each `@gjsify/<X>` package lands an explicit `nativescript` slot.
 */
export const ALIASES_NODE_FOR_NATIVESCRIPT = {
    // Server-only Node built-ins → empty stub
    'child_process':       '@gjsify/empty',
    'cluster':             '@gjsify/empty',
    'dgram':               '@gjsify/empty',
    'dns':                 '@gjsify/empty',
    'dns/promises':        '@gjsify/empty',
    'inspector':           '@gjsify/empty',
    'net':                 '@gjsify/empty',
    'tls':                 '@gjsify/empty',
    'tty':                 '@gjsify/empty',
    'http':                '@gjsify/empty',
    'https':               '@gjsify/empty',
    'http2':               '@gjsify/empty',
    'readline':            '@gjsify/empty',
    'repl':                '@gjsify/empty',
    'v8':                  '@gjsify/empty',
    'vm':                  '@gjsify/empty',
    'worker_threads':      '@gjsify/empty',
    'perf_hooks':          '@gjsify/empty',
    'diagnostics_channel': '@gjsify/empty',
    'domain':              '@gjsify/empty',
    'sqlite':              '@gjsify/empty',
    'sys':                 '@gjsify/empty',
    'zlib':                '@gjsify/empty',

    // Mobile-tractable Node built-ins → @gjsify/<X>
    'assert':              '@gjsify/assert',
    'assert/strict':       '@gjsify/assert',
    'async_hooks':         '@gjsify/async_hooks',
    'buffer':              '@gjsify/buffer',
    // `@gjsify/module` (not `@gjsify/empty`): provides the named exports
    // `createRequire` / `builtinModules` / `isBuiltin`, so `import { createRequire }
    // from 'module'` in deps (e.g. css-tree) resolves instead of failing the build.
    'module':              '@gjsify/module',
    'crypto':              '@gjsify/crypto',
    'events':              '@gjsify/events',
    // @gjsify/fs uses gi://Gio (GJS-only). On NS, route to the native bridge.
    'fs':                  '@gjsify/native-fs-bridge',
    'fs/promises':         '@gjsify/native-fs-bridge',
    'os':                  '@gjsify/os',
    'path':                '@gjsify/path',
    'path/posix':          '@gjsify/path/posix',
    'path/win32':          '@gjsify/path/win32',
    'process':             '@gjsify/process',
    'stream':              '@gjsify/stream',
    'stream/promises':     '@gjsify/stream/promises',
    'stream/web':          '@gjsify/stream/web',
    'string_decoder':      '@gjsify/string_decoder',
    'url':                 '@gjsify/url',
    'util':                '@gjsify/util',
    'util/types':          '@gjsify/util/types',
    'querystring':         '@gjsify/querystring',
    'console':             '@gjsify/console',
    'timers':              '@gjsify/timers',
    'timers/promises':     '@gjsify/timers/promises',

    // Third-party
    'node-fetch':          '@gjsify/empty',        // NS has native fetch
    'ws':                  '@gjsify/empty',        // NS has its own WebSocket
    'isomorphic-ws':       '@gjsify/empty',
}

/** Record of Web modules and his replacement for Gjs */
export const ALIASES_WEB_FOR_GJS = {
    // Bare specifiers (named imports, pure — no side-effects after Stage 2)
    'abort-controller': '@gjsify/abort-controller',
    'compression-streams': '@gjsify/compression-streams',
    'dom-events': '@gjsify/dom-events',
    'dom-exception': '@gjsify/dom-exception',
    'event-target-shim': '@gjsify/dom-events',
    'message-channel': '@gjsify/message-channel',
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
    'message-channel/register': '@gjsify/message-channel/register',
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

/**
 * Record of GJS built-in module specifiers and their replacement for the
 * `--app node` target. These are the bare ESM module names a GJS source imports
 * (`import System from 'system'`, `import Gettext from 'gettext'`, `import cairo
 * from 'cairo'`) — GJS exposes them as built-in modules; Node has no equivalent,
 * so on the node target they route to the `@gjsify/node-gi` reverse-bridge shims,
 * which are kept EXTERNAL (resolved at runtime against the consumer's node_modules
 * — see `app/node.ts`'s external set), never bundled. This is the analogue of the
 * `gi://` rewrite + `@gjsify/node-gi/globals` injection, and like them it is
 * NODE-TARGET-ONLY: the gjs/browser/nativescript alias maps do not include this
 * record, so a bare `system` / `gettext` / `cairo` import keeps resolving natively
 * (GJS built-in / npm package) on every other target. The risk of hijacking a real
 * npm package literally named `system`/`gettext`/`cairo` is identical to (and
 * bounded the same way as) the `gi://` design: it only applies when building a
 * GJS/GI source for Node.
 *
 * `cairo` maps to `@gjsify/node-gi/cairo`, the native cairo binding (a FOREIGN
 * struct in GObject-Introspection — an npm cairo package cannot stand in, since a
 * GI function taking/returning a cairo_t must marshal through the SAME cairo module
 * the engine's foreign-struct seam knows about).
 */
const ALIASES_GJS_FOR_NODE = {
    'system': '@gjsify/node-gi/system',
    'gettext': '@gjsify/node-gi/gettext',
    'cairo': '@gjsify/node-gi/cairo',
}

export { ALIASES_GJS_FOR_NODE };

/** Record of Web modules and his replacement for Node */
export const ALIASES_WEB_FOR_NODE = {
    // Bare specifiers → native re-exports (works for both named and side-effect imports)
    'abort-controller': '@gjsify/abort-controller/globals',
    'compression-streams': '@gjsify/compression-streams/globals',
    // dom-events deliberately routes to the polyfill on Node — globals.mjs
    // is browser-targeted (re-exports the full lib.dom event class hierarchy
    // from globalThis), but Node 22 only ships Event/EventTarget/CustomEvent
    // natively (no UIEvent / MouseEvent / KeyboardEvent / WheelEvent /
    // PointerEvent / InputEvent / FocusEvent / …). Routing the bare specifier
    // to the polyfill keeps the full class hierarchy available on Node; the
    // polyfill subclasses native Event/EventTarget where present and supplies
    // the rest. The `/globals` path remains reachable for browser builds via
    // the dynamic per-runtimes-triplet resolver in `runtime-aliases.mjs`.
    'dom-events': '@gjsify/dom-events',
    'dom-exception': '@gjsify/dom-exception/globals',
    'message-channel': '@gjsify/message-channel/globals',
    // eventsource deliberately routes to the polyfill on Node — globals.mjs
    // re-exports `globalThis.EventSource`, but Node 24.x doesn't ship native
    // EventSource at all (added experimentally in 22.3, requires the
    // --experimental-eventsource flag on many distributions). The polyfill
    // itself uses `fetch` + ReadableStream — both native on Node 18+ — and
    // works without any GJS deps; routing to it gives consumers a working
    // EventSource on Node out of the box. Same fix pattern as the `dom-events`
    // entry above.
    'eventsource': '@gjsify/eventsource',
    // 'fetch' routes to @gjsify/fetch/globals on Node — the globals.mjs
    // re-exports the native globalThis.{fetch,Request,Response,Headers,
    // FormData} as named exports. The dynamic resolver routes
    // @gjsify/fetch to the same /globals subpath via its runtimes
    // triplet declaration (`node:"native"`), so both entry forms converge.
    'fetch': '@gjsify/fetch/globals',
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
    'message-channel/register': '@gjsify/empty',
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
    '@gjsify/message-channel/register': '@gjsify/empty',
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
