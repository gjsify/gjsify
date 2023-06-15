import { aliasPlugin } from '../alias-plugin.js';
import { denoPlugin } from '@gjsify/esbuild-plugin-deno-loader';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "lodash";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
import { getAliasesForDeno, globToEntryPoints } from "../utils/index.js";

export const setupForDeno = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    const external = [];
    const format = pluginOptions.format || 'esm';

    if(format !== 'esm') throw new TypeError('Only ESM format is supported for Deno');

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format, // Only 'esm' is supported for Deno
        bundle: true,
        minify: false,
        sourcemap: false,
        treeShaking: true,
        preserveSymlinks: false, // false means follow symlinks
        target: [ "esnext" ],
        platform: "neutral",
        mainFields: ['module', 'main'],
        conditions: ['module','import'],
        external,
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
        inject: [],
        define: {
            global: 'globalThis',
            window: 'globalThis',
        },
    };

    merge(build.initialOptions, esbuildOptions);

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude)

    const aliases = {...getAliasesForDeno({external}), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await denoPlugin({reflection: pluginOptions.reflection}).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}