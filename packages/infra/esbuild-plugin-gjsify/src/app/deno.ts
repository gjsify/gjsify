import { aliasPlugin } from '../alias-plugin.js';
import { denoPlugin } from '../deno-plugin.js';
import { globPlugin } from 'esbuild-plugin-glob';
import { merge } from "lodash";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
import { getAliasesDeno } from "../alias.js";

export const setupForDeno = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format: 'esm',
        bundle: true,
        minify: false,
        sourcemap: false,
        target: [ "esnext" ],
        platform: "neutral",
        mainFields: ['module', 'main'],
        conditions: ['import'],
        external: ['https://*', 'http://*'],
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
            window: 'globalThis',
        },
        plugins: [
            globPlugin(),
        ]
    };

    merge(build.initialOptions, esbuildOptions);

    const aliases = {...getAliasesDeno(), ...pluginOptions.aliases};

    for (const aliasKey of Object.keys(aliases)) {
        if(pluginOptions.exclude.includes(aliasKey)) {
            delete aliases[aliasKey];
        }
    }

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
}