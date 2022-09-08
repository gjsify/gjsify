import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
import { merge } from "lodash";

export const setupForDeno = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format: 'esm',
        bundle: true,
        minify: false,
        sourcemap: false,
        target: [ "esnext" ], // TODO?
        platform: "browser",
        external: [],
        loader: {
            '.ts': 'ts',
            '.mts': 'ts',
            '.cts': 'ts',
            '.tsx': 'ts',
            '.mtsx': 'ts',
            '.ctsx': 'ts',
        },
        inject: [],
        define: {
            global: 'globalThis',
        }
    };

    merge(build.initialOptions, esbuildOptions);

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);
}