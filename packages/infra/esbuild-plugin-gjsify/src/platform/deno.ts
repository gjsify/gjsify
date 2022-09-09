import aliasPlugin from 'esbuild-plugin-alias';
import { globPlugin } from 'esbuild-plugin-glob';
import { merge } from "lodash";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

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
        },
        plugins: [
            globPlugin()
        ]
    };

    merge(build.initialOptions, esbuildOptions);

    const aliases = {...pluginOptions.aliases};

    for (const aliasKey of Object.keys(aliases)) {
        if(pluginOptions.exclude.includes(aliasKey)) {
            delete aliases[aliasKey];
        }
    }

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
}