import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
import { merge } from "lodash";
import aliasPlugin from 'esbuild-plugin-alias';
import { externalNode, externalNPM } from "../alias";

export const setupCjsLib = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    const esbuildOptions: BuildOptions = {
        bundle: true,
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
        external: [...externalNode, ...externalNPM, 'gi://*', '@gjsify/*'],
        format: 'cjs',
    };

    merge(build.initialOptions, esbuildOptions);

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(pluginOptions.aliases).setup(build);
}