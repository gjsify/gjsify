import type { Plugin } from "esbuild";
import alias from 'esbuild-plugin-alias';

export const gjsify = (aliases: Record<string, string>, options: { debug: boolean }) => {
    const plugin: Plugin = {
        name: 'gjsify',
        async setup(build) {

            // Set default options
            const esbuildOptions = build.initialOptions;

            esbuildOptions.external = esbuildOptions.external || [];
            esbuildOptions.external.push('gi://*');

            esbuildOptions.define = esbuildOptions.define || {}
            esbuildOptions.define.global = 'globalThis';
            esbuildOptions.define['process.env.NODE_DEBUG'] = 'false'; // WORKAROUND

            esbuildOptions.inject = esbuildOptions.inject || [];
            esbuildOptions.inject.push(require.resolve('core-js/features/url/'))
            esbuildOptions.inject.push(require.resolve('core-js/features/url-search-params/'))
            esbuildOptions.inject.push(require.resolve('@gjsify/globals/'))

            esbuildOptions.format = 'esm';

            esbuildOptions.bundle = true;

            // esbuildOptions.target = "firefox60", // Since GJS 1.53.90
            // esbuildOptions.target = "firefox68", // Since GJS 1.63.90
            // esbuildOptions.target = "firefox78", // Since GJS 1.65.90
            esbuildOptions.target = "firefox91"; // Since GJS 1.71.1

            if(options.debug) console.debug("esbuild options", build.initialOptions);


            const defaultAliases = {
                path: require.resolve('path-browserify/'),
                util: require.resolve('util/'), // https://github.com/browserify/node-util
                buffer: require.resolve('buffer/'), // https://www.npmjs.com/package/buffer
                assert: require.resolve('assert/'), // https://github.com/browserify/commonjs-assert
                constants: require.resolve('constants-browserify/'), // https://github.com/juliangruber/constants-browserify
                crypto: require.resolve('crypto-browserify/'),
                domain: require.resolve('domain-browser/'),
                events: require.resolve('events/'),
                url: require.resolve('url/'), // https://github.com/defunctzombie/node-url
                stream: require.resolve('stream-browserify/'),
                string_decoder: require.resolve('string_decoder/'), // https://github.com/nodejs/string_decoder
                querystring: require.resolve('querystring-es3/'),
                zlib: require.resolve('browserify-zlib/'),
                tty: require.resolve('@gjsify/tty/'),
                fs: require.resolve('@gjsify/fs/'),
                os: require.resolve('@gjsify/os/'),
                process: require.resolve('@gjsify/process/'),
            }
        
            aliases = {...defaultAliases, ...aliases};
        
            if(options.debug) console.debug("aliases", aliases);
        
            const gjsifyAlias = await alias(aliases).setup(build);
            return gjsifyAlias;
        }
    }
    return plugin;
};
