import { aliasPlugin } from '../alias-plugin.js';
import fastGlob from 'fast-glob';
import { transformExtPlugin } from '@gjsify/esbuild-plugin-transform-ext';
import { merge } from "lodash";
import { getJsExtensions } from "../utils/index.js";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupEsmLib = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    const esbuildOptions: BuildOptions = {
        bundle: false,
        splitting: true, // only works with esm, see https://esbuild.github.io/api/#splitting
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
        // firefox60"  // Since GJS 1.53.90
        // firefox68"  // Since GJS 1.63.90
        // firefox78"  // Since GJS 1.65.90
        // firefox91 // Since GJS 1.71.1
        // firefox102" // Since GJS 1.73.2
        target: [ "firefox102" ],
        platform: "browser",
        conditions: ['import'],
        format: 'esm'
    };

    merge(build.initialOptions, esbuildOptions);

    if(Array.isArray(build.initialOptions.entryPoints)) {
        build.initialOptions.entryPoints = await fastGlob(build.initialOptions.entryPoints, {ignore: pluginOptions.exclude})
    }

    await aliasPlugin(pluginOptions.aliases).setup(build);
    await transformExtPlugin({ outExtension: getJsExtensions(pluginOptions.jsExtension) }).setup(build);
}