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
    'async_hooks': '@gjsify/async_hooks', // TODO: refs/bun/src/js/node/async_hooks.ts, refs/deno/ext/node/polyfills/async_hooks.ts, refs/node/lib/async_hooks.js
    'buffer': '@gjsify/buffer',
    'child_process': '@gjsify/child_process', // TODO: refs/bun/src/js/node/child_process.ts, refs/deno/ext/node/polyfills/child_process.ts, refs/node/lib/child_process.js
    'cluster': '@gjsify/cluster', // TODO: refs/bun/src/js/node/cluster.ts, refs/deno/ext/node/polyfills/cluster.ts, refs/node/lib/cluster.js
    'console': '@gjsify/console',
    'constants': '@gjsify/constants', // TODO: refs/bun/src/js/node/constants.ts, refs/deno/ext/node/polyfills/constants.ts, refs/node/lib/constants.js
    'crypto': '@gjsify/crypto', // TODO: refs/bun/src/js/node/crypto.ts, refs/deno/ext/node/polyfills/crypto.ts, refs/node/lib/crypto.js
    'dgram': '@gjsify/dgram', // TODO: refs/bun/src/js/node/dgram.ts, refs/deno/ext/node/polyfills/dgram.ts, refs/node/lib/dgram.js
    'diagnostics_channel': '@gjsify/diagnostics_channel', // TODO: refs/bun/src/js/node/diagnostics_channel.ts, refs/deno/ext/node/polyfills/diagnostics_channel.js, refs/node/lib/diagnostics_channel.js
    'dns': '@gjsify/dns', // TODO: refs/bun/src/js/node/dns.ts, refs/deno/ext/node/polyfills/dns.ts, refs/node/lib/dns.js
    'dns/promises': '@gjsify/dns/promises', // TODO: refs/bun/src/js/node/dns.promises.ts, refs/deno/ext/node/polyfills/dns.ts, refs/node/lib/dns.js
    'domain': '@gjsify/domain', // TODO: refs/bun/src/js/node/domain.ts, refs/deno/ext/node/polyfills/domain.ts, refs/node/lib/domain.js
    'events': '@gjsify/events',
    'fs': '@gjsify/fs',
    'fs/promises': '@gjsify/fs/promises',
    'http': '@gjsify/http',
    'http2': '@gjsify/http2', // TODO: refs/bun/src/js/node/http2.ts, refs/deno/ext/node/polyfills/http2.ts, refs/node/lib/http2.js
    'https': '@gjsify/https', // TODO: refs/bun/src/js/node/https.ts, refs/deno/ext/node/polyfills/https.ts, refs/node/lib/https.js
    'inspector': '@gjsify/inspector', // TODO: refs/bun/src/js/node/inspector.ts, refs/deno/ext/node/polyfills/inspector.js, refs/node/lib/inspector.js
    'module': '@gjsify/module', // TODO: refs/node/lib/module.js
    'net': '@gjsify/net',
    'os': '@gjsify/os',
    'path': '@gjsify/path',
    'path/common': '@gjsify/path/common', // TODO: refs/deno/ext/node/polyfills/path/common.ts
    'path/glob': '@gjsify/path/glob', // TODO: refs/node/lib/path.js
    'path/posix': '@gjsify/path/posix',
    'path/separator': '@gjsify/path/separator', // TODO: refs/deno/ext/node/polyfills/path/separator.ts
    'path/win32': '@gjsify/path/win32',
    'perf_hooks': '@gjsify/perf_hooks', // TODO: refs/bun/src/js/node/perf_hooks.ts, refs/deno/ext/node/polyfills/perf_hooks.js, refs/node/lib/perf_hooks.js
    'process': '@gjsify/process',
    'punycode': '@gjsify/punycode', // TODO: refs/bun/src/js/node/punycode.ts, refs/deno/ext/node/polyfills/punycode.ts, refs/node/lib/punycode.js
    'querystring': '@gjsify/querystring',
    'readline': '@gjsify/readline', // TODO: refs/bun/src/js/node/readline.ts, refs/deno/ext/node/polyfills/readline.ts, refs/node/lib/readline.js
    'readline/promises': '@gjsify/readline/promises', // TODO: refs/bun/src/js/node/readline.promises.ts, refs/deno/ext/node/polyfills/readline/promises.ts, refs/node/lib/readline.js
    'repl': '@gjsify/repl', // TODO: refs/bun/src/js/node/repl.ts, refs/deno/ext/node/polyfills/repl.ts, refs/node/lib/repl.js
    'stream': '@gjsify/stream',
    'stream/web': '@gjsify/stream/web',
    'stream/consumers': '@gjsify/stream/consumers', // TODO: refs/bun/src/js/node/stream.consumers.ts, refs/deno/ext/node/polyfills/stream/consumers.js, refs/node/lib/stream.js
    'stream/promises': '@gjsify/stream/promises', // TODO: refs/bun/src/js/node/stream.promises.ts, refs/deno/ext/node/polyfills/stream/promises.js, refs/node/lib/stream.js
    'string_decoder': '@gjsify/string_decoder',
    'sys': '@gjsify/sys', // TODO: refs/deno/ext/node/polyfills/sys.ts, refs/node/lib/sys.js
    // 'test': '@gjsify/test', // TODO: refs/bun/src/js/node/test.ts, refs/deno/ext/node/polyfills/testing.ts, refs/node/lib/test.js
    'timers': '@gjsify/timers', // TODO: refs/bun/src/js/node/timers.ts, refs/deno/ext/node/polyfills/timers.ts, refs/node/lib/timers.js
    'timers/promises': '@gjsify/timers/promises', // TODO: refs/bun/src/js/node/timers.promises.ts, refs/deno/ext/node/polyfills/timers/promises.ts, refs/node/lib/timers.js
    'tls': '@gjsify/tls', // TODO: refs/bun/src/js/node/tls.ts, refs/deno/ext/node/polyfills/tls.ts, refs/node/lib/tls.js
    'tty': '@gjsify/tty',
    'url': '@gjsify/url',
    'util': '@gjsify/util',
    'util/types': '@gjsify/util/types',
    'v8': '@gjsify/v8', // TODO: refs/bun/src/js/node/v8.ts, refs/deno/ext/node/polyfills/v8.ts, refs/node/lib/v8.js
    'vm': '@gjsify/vm', // TODO: refs/bun/src/js/node/vm.ts, refs/deno/ext/node/polyfills/vm.js, refs/node/lib/vm.js
    'wasi': '@gjsify/wasi', // TODO: refs/bun/src/js/node/wasi.ts, refs/deno/ext/node/polyfills/wasi.ts, refs/node/lib/wasi.js
    'worker_threads': '@gjsify/worker_threads', // TODO: refs/bun/src/js/node/worker_threads.ts, refs/deno/ext/node/polyfills/worker_threads.ts, refs/node/lib/worker_threads.js
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

