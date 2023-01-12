import { aliasPlugin } from '../alias-plugin.js';
import { denoPlugin } from '@gjsify/esbuild-plugin-deno-loader';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import fastGlob from 'fast-glob';
import { merge } from "lodash";
import { getAliasesForGjs, getJsExtensions } from "../utils/index.js";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForGjs = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    const external = ['gi://*'];

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format: 'esm', // On Gjs we only support esm
        bundle: true,
        metafile: true,
        minify: false,
        sourcemap: false,
        treeShaking: true,
        preserveSymlinks: true,
        // firefox60"  // Since GJS 1.53.90
        // firefox68"  // Since GJS 1.63.90
        // firefox78"  // Since GJS 1.65.90
        // firefox91 // Since GJS 1.71.1
        // firefox102" // Since GJS 1.73.2
        target: [ "firefox102" ],
        platform: "neutral",
        mainFields: ['module', 'main'],
        conditions: ['import'],
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
        define: {
            global: 'globalThis',
            window: 'globalThis',
        },
    };

    merge(build.initialOptions, esbuildOptions);

    if(Array.isArray(build.initialOptions.entryPoints)) {
        build.initialOptions.entryPoints = await fastGlob(build.initialOptions.entryPoints, {ignore: pluginOptions.exclude})
    }

    const aliases = {...getAliasesForGjs({external}), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await denoPlugin({reflection: pluginOptions.reflection}).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}