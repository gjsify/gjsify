import { aliasPlugin } from '../alias-plugin.js';
import { transformExtPlugin } from '@gjsify/esbuild-plugin-transform-ext';
import { merge } from "lodash";
import { getJsExtensions, globToEntryPoints } from "../utils/index.js";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupEsmLib = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    const esbuildOptions: BuildOptions = {
        bundle: false,
        minify: false,
        sourcemap: false, 
        splitting: true, // Works only on esm
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
        platform: "browser",
        conditions: ['import'],
        format: 'esm'
    };

    merge(build.initialOptions, esbuildOptions);

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude);

    await aliasPlugin(pluginOptions.aliases).setup(build);
    await transformExtPlugin({ outExtension: getJsExtensions(pluginOptions.jsExtension) }).setup(build);
}