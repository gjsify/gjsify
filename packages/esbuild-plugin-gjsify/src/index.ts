import type { Plugin } from "esbuild";
import { extname } from "path";
import alias from 'esbuild-plugin-alias';
import { createRequire } from "module";
const require = globalThis.require || createRequire(import.meta.url);

export const NODE_EXTERNALS = [
    'zlib',
    'worker_threads',
    'stream',
    'crypto',
    'wasi',
    'vm',
    'v8',
    'util',
    'url',
    'dgram',
    'tty',
    'trace_events',
    'tls',
    'timers',
    'test',
    'string_decoder',
    'repl',
    'readline',
    'querystring',
    'punycode',
    'process',
    'perf_hooks',
    'path',
    'os',
    'net',
    'inspector',
    'https',
    'http2',
    'http',
    'fs',
    'events',
    'domain',
    'dns',
    'diagnostics_channel',
    'crypto',
    'cluster',
    'child_process',
    'buffer',
    'async_hooks',
    'assert'
]

const RESOLVE_ALIASES = {
    path: 'path-browserify',
    util: 'util', // https://github.com/browserify/node-util
    buffer: 'buffer', // https://www.npmjs.com/package/buffer
    assert: 'assert', // https://github.com/browserify/commonjs-assert
    constants: 'constants-browserify', // https://github.com/juliangruber/constants-browserify
    crypto: 'crypto-browserify',
    domain: 'domain-browser',
    events: '@gjsify/events',
    url: '@gjsify/url', // https://github.com/defunctzombie/node-url
    stream: '@gjsify/stream',
    'stream/web': 'web-streams-polyfill/ponyfill',
    string_decoder: 'string_decoder', // https://github.com/nodejs/string_decoder
    querystring: 'querystring-es3',
    zlib: '@gjsify/zlib',
    tty: '@gjsify/tty',
    fs: '@gjsify/fs',
    'fs/promises': '@gjsify/fs/lib/promises.mjs',
    os: '@gjsify/os',
    process: '@gjsify/process',
    punycode: 'punycode',
    http: '@gjsify/http',
    net: '@gjsify/net',
    'abort-controller': '@gjsify/abort-controller',
}

const resolveAliases = () => {
    const aliases: Record<string, string> = {}
    for (const RESOLVE_ALIAS in RESOLVE_ALIASES) {
        let resolveTo = RESOLVE_ALIASES[RESOLVE_ALIAS];
        if(!resolveTo.endsWith('/') && !extname(resolveTo) ) {
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
            const esbuildOptions = build.initialOptions;

            esbuildOptions.external = esbuildOptions.external || [];
            esbuildOptions.external.push('gi://*');

            esbuildOptions.inject = esbuildOptions.inject || [];

            esbuildOptions.inject = esbuildOptions.inject || [];
            
            esbuildOptions.inject.push(require.resolve('@gjsify/abort-controller/'))
            esbuildOptions.inject.push(require.resolve('@gjsify/globals/'))
            esbuildOptions.inject.push(require.resolve('core-js/features/url/'))
            esbuildOptions.inject.push(require.resolve('core-js/features/url-search-params/'))
            esbuildOptions.inject.push(require.resolve('@gjsify/require/'))

            esbuildOptions.define = esbuildOptions.define || {}
            esbuildOptions.define.global = 'globalThis';
            esbuildOptions.define['process.env.NODE_DEBUG'] = 'false'; // WORKAROUND
            
            // FIXME:
            // esbuildOptions.define['RESOLVE_ALIASES'] = JSON.stringify(RESOLVE_ALIASES); // Used in @gjsify/require

            esbuildOptions.format = 'esm';

            esbuildOptions.bundle = true;

            // esbuildOptions.target = "firefox60", // Since GJS 1.53.90
            // esbuildOptions.target = "firefox68", // Since GJS 1.63.90
            // esbuildOptions.target = "firefox78", // Since GJS 1.65.90
            esbuildOptions.target = "firefox91"; // Since GJS 1.71.1

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
