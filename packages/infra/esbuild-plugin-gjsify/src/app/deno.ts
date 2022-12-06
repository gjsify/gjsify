import { aliasPlugin } from '../alias-plugin.js';
import { deepkitPlugin } from '@gjsify/esbuild-plugin-deepkit';
// import { denoPlugin } from '@gjsify/esbuild-plugin-deno-loader';
import { globPlugin } from 'esbuild-plugin-glob';
import { merge } from "lodash";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
import { getAliasesForDeno } from "../alias.js";

export const setupForDeno = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format: 'esm',
        bundle: true,
        minify: false,
        sourcemap: false,
        target: [ "esnext" ],
        platform: "neutral",
        mainFields: ['module', 'main'],
        conditions: ['import'],
        external: ['https://*', 'http://*'],
        loader: {
            '.ts': 'ts',
            '.mts': 'ts',
            '.cts': 'ts',
            '.tsx': 'ts',
            '.mtsx': 'ts',
            '.ctsx': 'ts',
        },
        inject: [],
        define: {
            global: 'globalThis',
            window: 'globalThis',
        },
        plugins: [
            // globPlugin({ignore: pluginOptions.exclude}),
            // deepkitPlugin({reflection: pluginOptions.reflection}),
        ]
    };

    merge(build.initialOptions, esbuildOptions);

    const aliases = {...getAliasesForDeno(), ...pluginOptions.aliases};

    for (const aliasKey of Object.keys(aliases)) {
        if(pluginOptions.exclude.includes(aliasKey)) {
            delete aliases[aliasKey];
        }
    }

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await globPlugin({ignore: pluginOptions.exclude}).setup(build);
    // await denoPlugin({reflection: pluginOptions.reflection}).setup(build);
    await deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}