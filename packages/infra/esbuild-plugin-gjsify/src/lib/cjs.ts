import { aliasPlugin } from '../alias-plugin.js';
import { globPlugin } from 'esbuild-plugin-glob';
import { deepkitPlugin } from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "lodash";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupCjsLib = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    const esbuildOptions: BuildOptions = {
        bundle: false,
        splitting: false, // only works with esm, see https://esbuild.github.io/api/#splitting
        minify: false,
        sourcemap: false,
        loader: {
            '.ts': 'ts',
            '.mts': 'ts',
            '.cts': 'ts',
            '.tsx': 'ts',
            '.mtsx': 'ts',
            '.ctsx': 'ts',
        },
        target: ['node16'],
        platform: "browser",
        conditions: ['require'],
        format: 'cjs',
        plugins: [
            globPlugin({ignore: pluginOptions.exclude}),
            deepkitPlugin({reflection: pluginOptions.reflection}),
        ]
    };

    merge(build.initialOptions, esbuildOptions);

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(pluginOptions.aliases).setup(build);
}