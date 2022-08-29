import type { Plugin } from "esbuild";
import alias from 'esbuild-plugin-alias';
import { createRequire } from "module";

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

export const gjsify = (pluginOptions: { debug?: boolean, aliases?: Record<string, string>, exclude?: string[]} = {}) => {

    const require = globalThis.require || createRequire(import.meta.url);

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
            esbuildOptions.inject.push(require.resolve('@gjsify/require/'))
            esbuildOptions.inject.push(require.resolve('@gjsify/globals/'))
            esbuildOptions.inject.push(require.resolve('core-js/features/url/'))
            esbuildOptions.inject.push(require.resolve('core-js/features/url-search-params/'))

            esbuildOptions.define = esbuildOptions.define || {}
            esbuildOptions.define.global = 'globalThis';
            esbuildOptions.define['process.env.NODE_DEBUG'] = 'false'; // WORKAROUND

            esbuildOptions.format = 'esm';

            esbuildOptions.bundle = true;

            // esbuildOptions.target = "firefox60", // Since GJS 1.53.90
            // esbuildOptions.target = "firefox68", // Since GJS 1.63.90
            // esbuildOptions.target = "firefox78", // Since GJS 1.65.90
            esbuildOptions.target = "firefox91"; // Since GJS 1.71.1

            const defaultAliases = {
                path: require.resolve('path-browserify/'),
                util: require.resolve('util/'), // https://github.com/browserify/node-util
                buffer: require.resolve('buffer/'), // https://www.npmjs.com/package/buffer
                assert: require.resolve('assert/'), // https://github.com/browserify/commonjs-assert
                constants: require.resolve('constants-browserify/'), // https://github.com/juliangruber/constants-browserify
                crypto: require.resolve('crypto-browserify/'),
                domain: require.resolve('domain-browser/'),
                events: require.resolve('events/'),
                url: require.resolve('@gjsify/url/'), // https://github.com/defunctzombie/node-url
                stream: require.resolve('@gjsify/stream/'),
                'stream/web': require.resolve('web-streams-polyfill/ponyfill/'),
                string_decoder: require.resolve('string_decoder/'), // https://github.com/nodejs/string_decoder
                querystring: require.resolve('querystring-es3/'),
                zlib: require.resolve('@gjsify/zlib/'),
                tty: require.resolve('@gjsify/tty/'),
                fs: require.resolve('@gjsify/fs/'),
                'fs/promises': require.resolve('@gjsify/fs/lib/promises.mjs'),
                os: require.resolve('@gjsify/os/'),
                process: require.resolve('@gjsify/process/'),
                punycode: require.resolve('punycode/'),
                http: require.resolve('@gjsify/http/'),
                net: require.resolve('@gjsify/net/'),

                // Third party
                // 'node-fetch': require.resolve('@gjsify/fetch/'),
            }
        
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
