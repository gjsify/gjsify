import { aliasPlugin } from '../alias-plugin.js';
import { denoPlugin } from '@gjsify/esbuild-plugin-deno-loader';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import fastGlob from 'fast-glob';
import { merge } from "lodash";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForBrowser = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    const external = [];

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format: 'esm',
        bundle: true,
        minify: false,
        sourcemap: false,
        treeShaking: true,
        target: [ "esnext" ],
        platform: "browser",
        mainFields: ['browser', 'module', 'main'],
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
        inject: [],
        define: {
            global: 'globalThis',
            window: 'globalThis',
        }
    };

    merge(build.initialOptions, esbuildOptions);

    if(Array.isArray(build.initialOptions.entryPoints)) {
        build.initialOptions.entryPoints = await fastGlob(build.initialOptions.entryPoints, {ignore: pluginOptions.exclude})
    }

    const aliases = {...pluginOptions.aliases};

    for (const aliasKey of Object.keys(aliases)) {
        if(pluginOptions.exclude.includes(aliasKey)) {
            delete aliases[aliasKey];
        }
    }

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await denoPlugin({reflection: pluginOptions.reflection}).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}