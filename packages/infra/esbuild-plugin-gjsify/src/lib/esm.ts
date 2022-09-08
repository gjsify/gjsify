import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
import { merge } from "lodash";
import aliasPlugin from 'esbuild-plugin-alias';
import { externalNode } from "../alias";

export const setupEsmLib = async (build: PluginBuild, pluginOptions: PluginOptions) => {

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
        // firefox60"  // Since GJS 1.53.90
        // firefox68"  // Since GJS 1.63.90
        // firefox78"  // Since GJS 1.65.90
        // firefox91 // Since GJS 1.71.1
        // firefox102" // Since GJS 1.73.2
        target: [ "firefox91" ],
        platform: "browser",
        external: [...externalNode, 'gi://*'],
        format: 'esm',
    };

    merge(build.initialOptions, esbuildOptions);

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(pluginOptions.aliases).setup(build);
}