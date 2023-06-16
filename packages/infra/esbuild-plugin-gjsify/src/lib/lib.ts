import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import { transformExtPlugin } from '@gjsify/esbuild-plugin-transform-ext';
import { merge } from "lodash";
import { getJsExtensions, globToEntryPoints } from "../utils/index.js";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupLib = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    const format = pluginOptions.format || 'esm';

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    const esbuildOptions: BuildOptions = {
        format,
        bundle: false,
        minify: false,
        sourcemap: false, 
        splitting: format === 'esm' ? true : false, // Works only on esm
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
        target: [ "esnext" ],
        platform: "neutral",
        mainFields: format === 'esm' ? ['module', 'main'] : ['main'],
        // https://esbuild.github.io/api/#conditions
        conditions: format === 'esm' ? ['module','import'] : ['require'],
    };

    merge(build.initialOptions, esbuildOptions);

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude);

    await aliasPlugin(pluginOptions.aliases).setup(build);
    await transformExtPlugin({ outExtension: getJsExtensions(pluginOptions.jsExtension) }).setup(build);
}