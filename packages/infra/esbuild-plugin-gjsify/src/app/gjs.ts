import { aliasPlugin } from '../alias-plugin.js';
import { denoPlugin } from '@gjsify/esbuild-plugin-deno-loader';
import { deepkitPlugin } from '@gjsify/esbuild-plugin-deepkit';
import { globPlugin } from 'esbuild-plugin-glob';
import { merge } from "lodash";
import { getAliasesForGjs, resolvePackageByType } from "../alias.js";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForGjs = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    const inject = [
        // '@gjsify/deno-globals',
        // '@gjsify/node-globals',
        // '@gjsify/web-globals',
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
        platform: "neutral",
        mainFields: ['module', 'main'],
        conditions: ['import'],
        external: ['gi://*'],
        loader: {
            '.ts': 'ts',
            '.mts': 'ts',
            '.cts': 'ts',
            '.tsx': 'ts',
            '.mtsx': 'ts',
            '.ctsx': 'ts',
            '.mjs': 'ts',
            '.cjs': 'ts',
            '.js': 'ts',
        },
        inject,
        define: {
            global: 'globalThis',
            window: 'globalThis',
            // WORKAROUND
            // 'process.env.NODE_DEBUG': 'false',
        },
        plugins: [
            // globPlugin({ignore: pluginOptions.exclude}),
            // deepkitPlugin({reflection: pluginOptions.reflection}),
            // denoPlugin({reflection: pluginOptions.reflection}),
        ]
    };

    merge(build.initialOptions, esbuildOptions);

    const aliases = {...getAliasesForGjs(), ...pluginOptions.aliases};

    for (const aliasKey of Object.keys(aliases)) {
        if(pluginOptions.exclude.includes(aliasKey)) {
            delete aliases[aliasKey];
        }
    }

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await globPlugin({ignore: pluginOptions.exclude}).setup(build);
    await denoPlugin({reflection: pluginOptions.reflection}).setup(build);
    await deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}