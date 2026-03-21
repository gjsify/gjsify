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
    'path/common',
    'path/glob',
    'path/posix',
    'path/separator',
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
    'worker_threads',
    'zlib',
]

/** Array of NPM module names for which we have our own implementation */
export const EXTERNALS_NPM = [
    'readable-stream',
    'node-fetch'
]

/** General record of modules for Gjs */
export const ALIASES_GENERAL_FOR_GJS = {}

/** Record of Node.js modules (build in or not) and his replacement for Gjs */
export const ALIASES_NODE_FOR_GJS = {
    // Internal Node.js modules
    'assert': '@gjsify/assert',
    'assert/strict': '@gjsify/assert/strict',
    'async_hooks': '@gjsify/deno_std/node/async_hooks', // TODO
    'buffer': '@gjsify/buffer',
    'child_process': '@gjsify/deno_std/node/child_process', // TODO
    'cluster': '@gjsify/deno_std/node/cluster', // TODO
    'console': '@gjsify/console',
    'constants': '@gjsify/deno_std/node/constants', // TODO
    'crypto': '@gjsify/deno_std/node/crypto', // TODO
    'dgram': '@gjsify/deno_std/node/dgram', // TODO
    'diagnostics_channel': '@gjsify/deno_std/node/diagnostics_channel', // TODO
    'dns': '@gjsify/deno_std/node/dns', // TODO
    'dns/promises': '@gjsify/deno_std/node/dns/promises', // TODO
    'domain': '@gjsify/deno_std/node/domain', // TODO
    'events': '@gjsify/events',
    'fs': '@gjsify/fs',
    'fs/promises': '@gjsify/fs/promises',
    'http': '@gjsify/http',
    'http2': '@gjsify/deno_std/node/http2', // TODO
    'https': '@gjsify/deno_std/node/https', // TODO
    'inspector': '@gjsify/deno_std/node/inspector', // TODO
    'module': '@gjsify/deno_std/node/module', // TODO
    'net': '@gjsify/net',
    'os': '@gjsify/os',
    'path': '@gjsify/path',
    'path/common': '@gjsify/deno_std/node/path/common', // TODO
    'path/glob': '@gjsify/deno_std/node/path/glob', // TODO
    'path/posix': '@gjsify/path/posix',
    'path/separator': '@gjsify/deno_std/node/path/separator', // TODO
    'path/win32': '@gjsify/path/win32',
    'perf_hooks': '@gjsify/deno_std/node/perf_hooks', // TODO
    'process': '@gjsify/process',
    'punycode': '@gjsify/deno_std/node/punycode', // TODO
    'querystring': '@gjsify/querystring',
    'readline': '@gjsify/deno_std/node/readline', // TODO
    'readline/promises': '@gjsify/deno_std/node/readline/promises', // TODO
    'repl': '@gjsify/deno_std/node/repl', // TODO
    'stream': '@gjsify/stream',
    'stream/web': '@gjsify/stream/web',
    'stream/consumers': '@gjsify/stream/consumers', // TODO
    'stream/promises': '@gjsify/stream/promises', // TODO
    'string_decoder': '@gjsify/string_decoder',
    'sys': '@gjsify/deno_std/node/sys', // TODO
    // 'test': '@gjsify/deno_std/node/test', // TODO
    'timers': '@gjsify/deno_std/node/timers', // TODO
    'timers/promises': '@gjsify/deno_std/node/timers/promises', // TODO
    'tls': '@gjsify/deno_std/node/tls', // TODO
    'tty': '@gjsify/tty',
    'url': '@gjsify/url',
    'util': '@gjsify/util',
    'util/types': '@gjsify/util/types',
    'v8': '@gjsify/deno_std/node/v8', // TODO
    'vm': '@gjsify/deno_std/node/vm', // TODO
    'wasi': '@gjsify/deno_std/node/wasi', // TODO
    'worker_threads': '@gjsify/deno_std/node/worker_threads', // TODO
    'zlib': '@gjsify/zlib',



    // 'cluster': '@gjsify/deno_std/node/cluster',
    // 'domain': '@gjsify/deno_std/node/domain',
    // 'stream': '@gjsify/deno_std/node/stream',
    // 'assertion_error': '@gjsify/deno_std/node/assertion_error',
    // 'console': '@@gjsify/deno_std/nodeconsole',
    // 'module': '@gjsify/deno_std/node/module',
    // 'v8': '@gjsify/deno_std/node/v8',
    // assert: 'assert', // https://github.com/browserify/commonjs-assert
    // constants: 'constants-browserify', // https://github.com/juliangruber/constants-browserify
    // punycode: 'punycode',
    // string_decoder: 'string_decoder', // https://github.com/nodejs/string_decoder
    // 'async_hooks': '@gjsify/deno_std/node/async_hooks',
    // 'sys': '@gjsify/deno_std/node/sys',
    // 'vm': '@gjsify/deno_std/node/vm',
    // 'upstream_modules': '@gjsify/deno_std/node/upstream_modules',
    // 'wasi': '@gjsify/deno_std/node/wasi',
    // crypto: 'crypto-browserify',
    // 'inspector': '@gjsify/deno_std/node/inspector',
    // 'timers': '@gjsify/deno_std/node/timers',
    // 'dgram': '@gjsify/deno_std/node/dgram',
    // path: 'path-browserify',
    // 'readline': '@gjsify/deno_std/node/readline',
    // 'worker_threads': '@gjsify/deno_std/node/worker_threads',
    // 'diagnostics_channel': '@gjsify/deno_std/node/diagnostics_channel',
    // 'http2': '@gjsify/deno_std/node/http2',
    // 'module_all': '@gjsify/deno_std/node/module_all',
    // 'repl': '@gjsify/deno_std/node/repl',
    // 'child_process': '@gjsify/deno_std/node/child_process',
    // 'dns': '@gjsify/deno_std/node/dns',
    // 'module_esm': '@gjsify/deno_std/node/module_esm',
    // 'perf_hooks': '@gjsify/deno_std/node/perf_hooks',
    // 'tls': '@gjsify/deno_std/node/tls',

    // Third party Node Modules
    'node-fetch': '@gjsify/fetch',
}

/** Record of Web modules and his replacement for Gjs */
export const ALIASES_WEB_FOR_GJS = {
    'abort-controller': '@gjsify/abort-controller',
    'event-target-shim': '@gjsify/dom-events',
}

/** General record of modules for Node */
export const ALIASES_GENERAL_FOR_NODE = {
    '@gjsify/node-globals': '@gjsify/empty',
    '@gjsify/require': '@gjsify/empty',
}

/** Record of Gjs modules (build in or not) and his replacement for Node */
const ALIASES_GJS_FOR_NODE = {}

export { ALIASES_GJS_FOR_NODE };

/** Record of Web modules and his replacement for Node */
export const ALIASES_WEB_FOR_NODE = {}

