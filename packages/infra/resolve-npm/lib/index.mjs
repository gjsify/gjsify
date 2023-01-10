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
    'path': '@gjsify/deno_std/node/path', // TODO
    'path/common': '@gjsify/deno_std/node/path/common', // TODO
    'path/glob': '@gjsify/deno_std/node/path/glob', // TODO
    'path/posix': '@gjsify/deno_std/node/path/posix', // TODO
    'path/separator': '@gjsify/deno_std/node/path/separator', // TODO
    'path/win32': '@gjsify/deno_std/node/path/win32', // TODO
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
    'string_decoder': '@gjsify/deno_std/node/string_decoder', // TODO
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
    // 'test': 'https://deno.land/std/node/test.ts',
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
    '@gjsify/require': '@gjsify/empty',

    // TODO we need a real replacement for this in the future
    '@gjsify/deno-runtime/globals': '@gjsify/empty',
    '@gjsify/deno-globals': '@gjsify/empty',
}

/** Record of Gjs modules (build in or not) and his replacement for Node */
const ALIASES_GJS_FOR_NODE = {}

// Revert the alias
for (const ALIAS_NODE_FOR_GJS in ALIASES_NODE_FOR_GJS) {
    ALIASES_GJS_FOR_NODE[ALIASES_NODE_FOR_GJS[ALIAS_NODE_FOR_GJS]] = ALIAS_NODE_FOR_GJS
}

export { ALIASES_GJS_FOR_NODE };

/** Record of Web modules and his replacement for Node */
export const ALIASES_WEB_FOR_NODE = {}

