import type { Plugin, BuildOptions } from "esbuild";
import { ALIASES_NODE, ALIASES_WEB, EXTERNALS_NODE } from "@gjsify/resolve-npm";
import { extname } from "path";
import alias from 'esbuild-plugin-alias';
import { createRequire } from "module";
import { merge } from "lodash";
const require = globalThis.require || createRequire(import.meta.url);

const RESOLVE_ALIASES = {...ALIASES_NODE, ...ALIASES_WEB};

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

const gjsify = (pluginOptions: { debug?: boolean, aliases?: Record<string, string>, exclude?: string[]} = {}) => {
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
                    require.resolve('@gjsify/require/'),
                    // TODO: Move to web
                    require.resolve('core-js/features/url-search-params/'),
                    require.resolve('core-js/features/url/'),
                    require.resolve('@gjsify/abort-controller/'),
                    require.resolve('@gjsify/web-events/'),
                    require.resolve('@gjsify/globals/'),
                    require.resolve('@gjsify/deno_globals/'),
                ],
                define: {
                    global: 'globalThis',
                    // WORKAROUND
                    'process.env.NODE_DEBUG': 'false',
                    // FIXME:
                    // 'RESOLVE_ALIASES': JSON.stringify(RESOLVE_ALIASES), // Used in @gjsify/require
                }
            };

            merge(build.initialOptions, esbuildOptions);

            if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

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

export { EXTERNALS_NODE, RESOLVE_ALIASES, gjsify };