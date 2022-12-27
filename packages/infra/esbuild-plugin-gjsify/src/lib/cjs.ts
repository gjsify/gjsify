import { aliasPlugin } from '../alias-plugin.js';
import fastGlob from 'fast-glob';
import { transformExtPlugin } from '@gjsify/esbuild-plugin-transform-ext';
import { merge } from "lodash";
import { getJsExtensions } from "../utils/index.js";

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
            '.mjs': 'ts',
            '.cjs': 'ts',
            '.js': 'ts',
        },
        target: ['node16'],
        platform: "browser",
        conditions: ['require'],
        format: 'cjs'
    };

    merge(build.initialOptions, esbuildOptions);

    if(Array.isArray(build.initialOptions.entryPoints)) {
        build.initialOptions.entryPoints = await fastGlob(build.initialOptions.entryPoints, {ignore: pluginOptions.exclude})
    }

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(pluginOptions.aliases).setup(build);
    await transformExtPlugin({ outExtension: getJsExtensions(pluginOptions.jsExtension) }).setup(build);
}