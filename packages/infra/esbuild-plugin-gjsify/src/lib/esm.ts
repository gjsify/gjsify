import { aliasPlugin } from '../alias-plugin.js';
import { globPlugin } from 'esbuild-plugin-glob';
import { merge } from "lodash";

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
        },
        // firefox60"  // Since GJS 1.53.90
        // firefox68"  // Since GJS 1.63.90
        // firefox78"  // Since GJS 1.65.90
        // firefox91 // Since GJS 1.71.1
        // firefox102" // Since GJS 1.73.2
        target: [ "firefox91" ],
        platform: "browser",
        conditions: ['import'],
        format: 'esm',
        plugins: [
            globPlugin()
        ]
    };

    merge(build.initialOptions, esbuildOptions);

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(pluginOptions.aliases).setup(build);
}