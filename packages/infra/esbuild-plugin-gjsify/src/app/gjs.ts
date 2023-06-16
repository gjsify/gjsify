import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import { denoPlugin } from '@gjsify/esbuild-plugin-deno-loader';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "lodash";
import { getAliasesForGjs, globToEntryPoints } from "../utils/index.js";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForGjs = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    const external = ['gi://*', 'cairo', 'gettext', 'system'];
    const format = pluginOptions.format || 'esm';

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format, 
        bundle: true,
        metafile: false,
        minify: false,
        sourcemap: false,
        treeShaking: true,
        preserveSymlinks: false, // false means follow symlinks
        // firefox60  // Since GJS 1.53.90
        // firefox68  // Since GJS 1.63.90
        // firefox78  // Since GJS 1.65.90
        // firefox91  // Since GJS 1.71.1
        // firefox102 // Since GJS 1.73.2
        target: [ "firefox102" ],
        platform: 'neutral',
        mainFields: format === 'esm' ? ['module', 'main'] : ['main', 'module'],
        // https://esbuild.github.io/api/#conditions
        conditions: format === 'esm' ? ['import', 'require'] : ['require', 'import'],
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

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude);

    const aliases = {...getAliasesForGjs({external}), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await denoPlugin({reflection: pluginOptions.reflection}).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}