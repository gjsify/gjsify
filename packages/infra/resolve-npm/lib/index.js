/** Array of Node.js build in module names */
export const EXTERNALS_NODE = [
    'cluster',
    'domain',
    'stream',
    'util',
    'assertion_error',
    'console',
    'module',
    'process',
    'v8',
    'assert',
    'constants',
    'events',
    'https',
    'net',
    'punycode',
    'string_decoder',
    'tty',
    'async_hooks',
    'fs',
    'sys',
    'vm',
    'http',
    'querystring',
    'upstream_modules',
    'wasi',
    'crypto',
    'inspector',
    'os',
    'timers',
    'buffer',
    'dgram',
    'path',
    'readline',
    'url',
    'worker_threads',
    'diagnostics_channel',
    'http2',
    'module_all',
    'repl',
    'zlib',
    'child_process',
    'dns',
    'module_esm',
    'perf_hooks',
    'tls',
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
    // 'cluster': '@gjsify/deno_std/node/cluster',
    // 'domain': '@gjsify/deno_std/node/domain',
    // 'stream': '@gjsify/deno_std/node/stream',
    'stream': '@gjsify/stream',
    'util': '@gjsify/util',
    // 'assertion_error': '@gjsify/deno_std/node/assertion_error',
    'console': '@gjsify/console',
    // 'console': '@@gjsify/deno_std/nodeconsole',
    // 'module': '@gjsify/deno_std/node/module',
    'process': '@gjsify/process',
    // 'v8': '@gjsify/deno_std/node/v8',
    // assert: 'assert', // https://github.com/browserify/commonjs-assert
    'assert': '@gjsify/assert',
    constants: 'constants-browserify', // https://github.com/juliangruber/constants-browserify
    events: '@gjsify/events',
    // 'https': '@gjsify/deno_std/node/https',
    net: '@gjsify/net',
    punycode: 'punycode',
    string_decoder: 'string_decoder', // https://github.com/nodejs/string_decoder
    tty: '@gjsify/tty',
    // 'async_hooks': '@gjsify/deno_std/node/async_hooks',
    'fs': '@gjsify/fs',
    'fs/promises': '@gjsify/fs/lib/esm/promises.js',
    // 'sys': '@gjsify/deno_std/node/sys',
    // 'vm': '@gjsify/deno_std/node/vm',
    http: '@gjsify/http',
    querystring: '@gjsify/querystring',
    // 'upstream_modules': '@gjsify/deno_std/node/upstream_modules',
    // 'wasi': '@gjsify/deno_std/node/wasi',
    crypto: 'crypto-browserify',
    // 'inspector': '@gjsify/deno_std/node/inspector',
    'os': '@gjsify/os',
    // 'timers': '@gjsify/deno_std/node/timers',
    buffer: '@gjsify/buffer',
    // 'dgram': '@gjsify/deno_std/node/dgram',
    path: 'path-browserify',
    // 'readline': '@gjsify/deno_std/node/readline',
    'url': '@gjsify/url',
    // 'worker_threads': '@gjsify/deno_std/node/worker_threads',
    // 'diagnostics_channel': '@gjsify/deno_std/node/diagnostics_channel',
    // 'http2': '@gjsify/deno_std/node/http2',
    // 'module_all': '@gjsify/deno_std/node/module_all',
    // 'repl': '@gjsify/deno_std/node/repl',
    zlib: '@gjsify/zlib',
    // 'child_process': '@gjsify/deno_std/node/child_process',
    // 'dns': '@gjsify/deno_std/node/dns',
    // 'module_esm': '@gjsify/deno_std/node/module_esm',
    // 'perf_hooks': '@gjsify/deno_std/node/perf_hooks',
    // 'tls': '@gjsify/deno_std/node/tls',

    // Node and Web
    'stream/web': 'web-streams-polyfill/ponyfill',
}

/** Record of Web modules and his replacement for Gjs */
export const ALIASES_WEB_FOR_GJS = {
    'abort-controller': '@gjsify/abort-controller',
    'event-target-shim': '@gjsify/event-target',
}

/** General record of modules for Deno */
export const ALIASES_GENERAL_FOR_DENO = {
    '@gjsify/deno-runtime/globals': '@gjsify/empty',
    '@gjsify/deno-globals': '@gjsify/empty',
}

/** Record of Node.js modules (build in or not) and his replacement for Deno */
export const ALIASES_NODE_FOR_DENO = {
    // Node packages
    'assert': 'https://deno.land/std/node/assert.ts',
    'assert/strict': 'https://deno.land/std/node/assert/strict.ts',
    'async_hooks': 'https://deno.land/std/node/async_hooks.ts',
    'buffer': 'https://deno.land/std/node/buffer.ts',
    'child_process': 'https://deno.land/std/node/child_process.ts',
    'cluster': 'https://deno.land/std/node/cluster.ts',
    'console': 'https://deno.land/std/node/console.ts',
    'constants': 'https://deno.land/std/node/constants.ts',
    'crypto': 'https://deno.land/std/node/crypto.ts',
    'dgram': 'https://deno.land/std/node/dgram.ts',
    'diagnostics_channel': 'https://deno.land/std/node/diagnostics_channel.ts',
    'dns': 'https://deno.land/std/node/dns.ts',
    'dns/promises': 'https://deno.land/std/node/dns/promises.ts',
    'domain': 'https://deno.land/std/node/domain.ts',
    'events': 'https://deno.land/std/node/events.ts',
    'fs': 'https://deno.land/std/node/fs.ts',
    'fs/promises': 'https://deno.land/std/node/fs/promises.ts',
    'http': 'https://deno.land/std/node/http.ts',
    'http2': 'https://deno.land/std/node/http2.ts',
    'https': 'https://deno.land/std/node/https.ts',
    'inspector': 'https://deno.land/std/node/inspector.ts',
    'module': 'https://deno.land/std/node/module.ts',
    'net': 'https://deno.land/std/node/net.ts',
    'os': 'https://deno.land/std/node/os.ts',
    'path': 'https://deno.land/std/node/path.ts',
    'path/common': 'https://deno.land/std/node/path/common.ts',
    'path/glob': 'https://deno.land/std/node/path/glob.ts',
    'path/posix': 'https://deno.land/std/node/path/posix.ts',
    'path/separator': 'https://deno.land/std/node/path/separator.ts',
    'path/win32': 'https://deno.land/std/node/path/win32.ts',
    'perf_hooks': 'https://deno.land/std/node/perf_hooks.ts',
    'process': 'https://deno.land/std/node/process.ts',
    'punycode': 'https://deno.land/std/node/punycode.ts',
    'querystring': 'https://deno.land/std/node/querystring.ts',
    'readline': 'https://deno.land/std/node/readline.ts',
    'readline/promises': 'https://deno.land/std/node/readline/promises.ts',
    'repl': 'https://deno.land/std/node/repl.ts',
    'stream': 'https://deno.land/std/node/stream.ts',
    'stream/web': 'https://deno.land/std/node/stream/web.ts',
    'stream/consumers': 'https://deno.land/std/node/stream/consumers.mjs',
    'stream/promises': 'https://deno.land/std/node/stream/promises.mjs',
    'string_decoder': 'https://deno.land/std/node/string_decoder.ts',
    'sys': 'https://deno.land/std/node/sys.ts',
    'test': 'https://deno.land/std/node/test.ts',
    'timers': 'https://deno.land/std/node/timers.ts',
    'timers/promises': 'https://deno.land/std/node/timers/promises.ts',
    'tls': 'https://deno.land/std/node/tls.ts',
    'tty': 'https://deno.land/std/node/tty.ts',
    'url': 'https://deno.land/std/node/url.ts',
    'util': 'https://deno.land/std/node/util.ts',
    'util/types': 'https://deno.land/std/node/util/types.ts',
    'v8': 'https://deno.land/std/node/v8.ts',
    'vm': 'https://deno.land/std/node/vm.ts',
    'wasi': 'https://deno.land/std/node/wasi.ts',
    'worker_threads': 'https://deno.land/std/node/worker_threads.ts',
    'zlib': 'https://deno.land/std/node/zlib.ts',
}

/** Record of Gjs modules (build in or not) and his replacement for Deno */
export const ALIASES_GJS_FOR_DENO = {
    '@gjsify/node-globals': 'https://deno.land/std/node/global.ts',
}

/** Record of Web modules and his replacement for Deno */
export const ALIASES_WEB_FOR_DENO = {}


/** General record of modules for Node */
export const ALIASES_GENERAL_FOR_NODE = {
    '@gjsify/node-globals': '@gjsify/empty',
}

/** Record of Gjs modules (build in or not) and his replacement for Node */
export const ALIASES_GJS_FOR_NODE = {}

/** Record of Web modules and his replacement for Node */
export const ALIASES_WEB_FOR_NODE = {}

