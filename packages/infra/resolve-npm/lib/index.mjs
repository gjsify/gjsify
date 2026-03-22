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
    'async_hooks': '@gjsify/async_hooks',
    'buffer': '@gjsify/buffer',
    'child_process': '@gjsify/child_process',
    'cluster': '@gjsify/cluster',
    'console': '@gjsify/console',
    'constants': '@gjsify/constants', // TODO
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
    'path/common': '@gjsify/path/common', // TODO
    'path/glob': '@gjsify/path/glob', // TODO
    'path/posix': '@gjsify/path/posix',
    'path/separator': '@gjsify/path/separator', // TODO
    'path/win32': '@gjsify/path/win32',
    'perf_hooks': '@gjsify/perf_hooks',
    'process': '@gjsify/process',
    'punycode': '@gjsify/punycode', // TODO
    'querystring': '@gjsify/querystring',
    'readline': '@gjsify/readline',
    'readline/promises': '@gjsify/readline/promises', // TODO
    'repl': '@gjsify/repl', // TODO
    'stream': '@gjsify/stream',
    'stream/web': '@gjsify/stream/web',
    'stream/consumers': '@gjsify/stream/consumers', // TODO
    'stream/promises': '@gjsify/stream/promises', // TODO
    'string_decoder': '@gjsify/string_decoder',
    'sys': '@gjsify/sys', // TODO
    // 'test': '@gjsify/test', // TODO
    'timers': '@gjsify/timers',
    'timers/promises': '@gjsify/timers/promises',
    'tls': '@gjsify/tls',
    'tty': '@gjsify/tty',
    'url': '@gjsify/url',
    'util': '@gjsify/util',
    'util/types': '@gjsify/util/types',
    'v8': '@gjsify/v8',
    'vm': '@gjsify/vm',
    'wasi': '@gjsify/wasi', // TODO
    'worker_threads': '@gjsify/worker_threads',
    'zlib': '@gjsify/zlib',

    // Third party Node Modules
    'node-fetch': '@gjsify/fetch',
}

/** Record of Web modules and his replacement for Gjs */
export const ALIASES_WEB_FOR_GJS = {
    'abort-controller': '@gjsify/abort-controller',
    'event-target-shim': '@gjsify/dom-events',
    'fetch': '@gjsify/fetch',
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
export const ALIASES_WEB_FOR_NODE = {
    'fetch': '@gjsify/fetch/globals',
}
