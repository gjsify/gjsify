import type { Plugin, BuildOptions } from "esbuild";
import { extname } from "path";
import alias from 'esbuild-plugin-alias';
import { createRequire } from "module";
import deepmerge from "deepmerge";
const require = globalThis.require || createRequire(import.meta.url);

export const NODE_EXTERNALS = [
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

const RESOLVE_ALIASES = {
 
    // Web
    'abort-controller': '@gjsify/abort-controller',    
    
    // Node
    'cluster': '@gjsify/deno_std/node/cluster',
    'domain': '@gjsify/deno_std/node/domain',
    // 'stream': '@gjsify/deno_std/node/stream',
    'stream': '@gjsify/stream',
    'util': '@gjsify/util',
    'assertion_error': '@gjsify/deno_std/node/assertion_error',
    'console': '@gjsify/console',
    // 'console': '@@gjsify/deno_std/nodeconsole',
    'module': '@gjsify/deno_std/node/module',
    'process': '@gjsify/process',
    'v8': '@gjsify/deno_std/node/v8',
    // assert: 'assert', // https://github.com/browserify/commonjs-assert
    'assert': '@gjsify/deno_std/node/assert',
    // constants: 'constants-browserify', // https://github.com/juliangruber/constants-browserify
    'constants': '@gjsify/deno_std/node/constants',
    // events: '@gjsify/events',
    'events': '@gjsify/deno_std/node/events',
    'https': '@gjsify/deno_std/node/https',
    // net: '@gjsify/net',
    'net': '@gjsify/deno_std/node/net',
    // punycode: 'punycode',
    'punycode': '@gjsify/deno_std/node/punycode',
    // string_decoder: 'string_decoder', // https://github.com/nodejs/string_decoder
    'string_decoder': '@gjsify/deno_std/node/string_decoder',
    // tty: '@gjsify/tty',
    'tty': '@gjsify/deno_std/node/tty',
    'async_hooks': '@gjsify/deno_std/node/async_hooks',
    'fs': '@gjsify/fs',
    // 'fs': '@gjsify/deno_std/node/fs',
    'fs/promises': '@gjsify/fs/lib/promises.mjs',
    'sys': '@gjsify/deno_std/node/sys',
    'vm': '@gjsify/deno_std/node/vm',
    // http: '@gjsify/http',
    'http': '@gjsify/deno_std/node/http',
    // querystring: 'querystring-es3',
    'querystring': '@gjsify/deno_std/node/querystring',
    'upstream_modules': '@gjsify/deno_std/node/upstream_modules',
    'wasi': '@gjsify/deno_std/node/wasi',
    // crypto: 'crypto-browserify',
    'crypto': '@gjsify/deno_std/node/crypto',
    'inspector': '@gjsify/deno_std/node/inspector',
    // 'os': '@gjsify/deno_std/node/os',
    'os': '@gjsify/os',
    'timers': '@gjsify/deno_std/node/timers',
    // buffer: 'buffer', // https://www.npmjs.com/package/buffer
    'buffer': '@gjsify/deno_std/node/buffer',
    'dgram': '@gjsify/deno_std/node/dgram',
    // path: 'path-browserify',
    'path': '@gjsify/deno_std/node/path',
    'readline': '@gjsify/deno_std/node/readline',
    // 'url': '@gjsify/deno_std/node/url', 
    'url': '@gjsify/url',
    'worker_threads': '@gjsify/deno_std/node/worker_threads',
    'diagnostics_channel': '@gjsify/deno_std/node/diagnostics_channel',
    'http2': '@gjsify/deno_std/node/http2',
    'module_all': '@gjsify/deno_std/node/module_all',
    'repl': '@gjsify/deno_std/node/repl',
    // zlib: '@gjsify/zlib',
    'zlib': '@gjsify/deno_std/node/zlib',
    'child_process': '@gjsify/deno_std/node/child_process',
    'dns': '@gjsify/deno_std/node/dns',
    'module_esm': '@gjsify/deno_std/node/module_esm',
    'perf_hooks': '@gjsify/deno_std/node/perf_hooks',
    'tls': '@gjsify/deno_std/node/tls',

    // Node and Web
    'stream/web': 'web-streams-polyfill/ponyfill',
}

const resolveAliases = () => {
    const aliases: Record<string, string> = {}
    for (const RESOLVE_ALIAS in RESOLVE_ALIASES) {
        const RESOLVE_TARGET = RESOLVE_ALIASES[RESOLVE_ALIAS];
        let resolveTo = RESOLVE_TARGET;
        if(!resolveTo.startsWith('@gjsify/deno_std/') && !resolveTo.endsWith('/') && !extname(resolveTo) ) {
            resolveTo = resolveTo + '/'
        }
        aliases[RESOLVE_ALIAS] = require.resolve(resolveTo);
    }
    return aliases
}

export const gjsify = (pluginOptions: { debug?: boolean, aliases?: Record<string, string>, exclude?: string[]} = {}) => {
    const plugin: Plugin = {
        name: 'gjsify',
        async setup(build) {

            pluginOptions.aliases ||= {};
            pluginOptions.exclude ||= [];

            // Set default options
            const esbuildOptions: BuildOptions = {
                format: 'esm',
                bundle: true,
                // firefox60"  // Since GJS 1.53.90
                // firefox68"  // Since GJS 1.63.90
                // firefox78"  // Since GJS 1.65.90
                // firefox91 // Since GJS 1.71.1
                // firefox102" // Since GJS 1.73.2
                target: [ "firefox91" ],
                external: ['gi://*'],
                loader: {
                    '.ts': 'ts',
                    '.mts': 'ts',
                    '.cts': 'ts',
                    '.tsx': 'ts',
                    '.mtsx': 'ts',
                    '.ctsx': 'ts',
                },
                inject: [
                    require.resolve('@gjsify/globals/'),
                    require.resolve('@gjsify/abort-controller/'),
                    require.resolve('core-js/features/url/'),
                    require.resolve('@gjsify/deno_globals/'),
                    // TODO: Move to web
                    require.resolve('core-js/features/url-search-params/'),
                    require.resolve('@gjsify/require/'),
                ],
                define: {
                    global: 'globalThis',
                    // WORKAROUND
                    'process.env.NODE_DEBUG': 'false',
                    // FIXME:
                    // 'RESOLVE_ALIASES': JSON.stringify(RESOLVE_ALIASES), // Used in @gjsify/require
                }
            };

            build.initialOptions = deepmerge<BuildOptions>(build.initialOptions, esbuildOptions);

            const defaultAliases = resolveAliases();
            const aliases = {...defaultAliases, ...pluginOptions.aliases};

            for (const aliasKey of Object.keys(aliases)) {
                if(pluginOptions.exclude.includes(aliasKey)) {
                    delete aliases[aliasKey];
                }
            }

            if(pluginOptions.debug) console.debug("aliases", aliases);
        
            await alias(aliases).setup(build);
        }
    }
    return plugin;
};
