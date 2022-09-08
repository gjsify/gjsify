import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
import { merge } from "lodash";
import { aliasesNode, aliasesWeb, resolvePackageByType } from "../alias";
import aliasPlugin from 'esbuild-plugin-alias';

export const setupForGjs = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    const inject = [
        '@gjsify/require',
        // TODO: Move to web
        'core-js/features/url-search-params/',
        'core-js/features/url/',
        '@gjsify/abort-controller',
        '@gjsify/web-events',
        '@gjsify/globals',
        // '@gjsify/deno_globals/',
    ].map(inj => resolvePackageByType(inj, 'module'));

    // Set default options
    const esbuildOptions: BuildOptions = {
        format: 'esm', // On Gjs we only support esm
        bundle: true,
        minify: false,
        sourcemap: false,
        // firefox60"  // Since GJS 1.53.90
        // firefox68"  // Since GJS 1.63.90
        // firefox78"  // Since GJS 1.65.90
        // firefox91 // Since GJS 1.71.1
        // firefox102" // Since GJS 1.73.2
        target: [ "firefox91" ],
        platform: "browser",
        mainFields: ['module', 'main'],
        external: ['gi://*'],
        loader: {
            '.ts': 'ts',
            '.mts': 'ts',
            '.cts': 'ts',
            '.tsx': 'ts',
            '.mtsx': 'ts',
            '.ctsx': 'ts',
        },
        inject,
        define: {
            global: 'globalThis',
            // WORKAROUND
            'process.env.NODE_DEBUG': 'false',
        }
    };

    merge(build.initialOptions, esbuildOptions);

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    const aliases = {...aliasesNode, ...aliasesWeb, ...pluginOptions.aliases};

    for (const aliasKey of Object.keys(aliases)) {
        if(pluginOptions.exclude.includes(aliasKey)) {
            delete aliases[aliasKey];
        }
    }

    await aliasPlugin(aliases).setup(build);
}