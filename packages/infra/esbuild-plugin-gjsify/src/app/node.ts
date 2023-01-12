
import { aliasPlugin } from '../alias-plugin.js';
import { denoPlugin } from '@gjsify/esbuild-plugin-deno-loader';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import fastGlob from 'fast-glob';
import { merge } from "lodash";
import { getAliasesForNode } from "../utils/index.js";
import { EXTERNALS_NODE } from "@gjsify/resolve-npm";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForNode = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    const external = [...EXTERNALS_NODE, 'gi://*'];

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    const format = pluginOptions.format || 'esm';

    // Set default options
    const esbuildOptions: BuildOptions = {
        format,
        bundle: true,
        minify: false,
        sourcemap: false,
        treeShaking: true,
        target: [ "node18" ],
        platform: "node",
        mainFields: format === 'esm' ? ['module', 'main'] : ['main', 'module', 'browser'],
        conditions: format === 'esm' ? ['import'] : ['require'],
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
        }
    };

    merge(build.initialOptions, esbuildOptions);

    if(Array.isArray(build.initialOptions.entryPoints)) {
        build.initialOptions.entryPoints = await fastGlob(build.initialOptions.entryPoints, {ignore: pluginOptions.exclude})
    }

    const aliases = {...getAliasesForNode({external}), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await denoPlugin({reflection: pluginOptions.reflection}).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}