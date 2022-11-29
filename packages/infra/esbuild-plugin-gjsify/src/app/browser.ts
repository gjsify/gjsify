import { aliasPlugin } from '../alias-plugin.js';
import { denoPlugin } from '@gjsify/esbuild-plugin-deno-loader';
import { deepkitPlugin } from '@gjsify/esbuild-plugin-deepkit';
import { globPlugin } from 'esbuild-plugin-glob';
import { merge } from "lodash";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForBrowser = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format: 'esm',
        bundle: true,
        minify: false,
        sourcemap: false,
        target: [ "esnext" ],
        platform: "browser",
        mainFields: ['browser', 'module', 'main'],
        conditions: ['import'],
        external: [],
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
            // globPlugin(),
            // deepkitPlugin({reflection: pluginOptions.reflection}),
            // denoPlugin({reflection: pluginOptions.reflection}),
        ]
    };

    merge(build.initialOptions, esbuildOptions);

    const aliases = {...pluginOptions.aliases};

    for (const aliasKey of Object.keys(aliases)) {
        if(pluginOptions.exclude.includes(aliasKey)) {
            delete aliases[aliasKey];
        }
    }

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await globPlugin().setup(build);
    await denoPlugin({reflection: pluginOptions.reflection}).setup(build);
    await deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}