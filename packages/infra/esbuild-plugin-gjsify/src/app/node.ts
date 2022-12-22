
import { aliasPlugin } from '../alias-plugin.js';
import { denoPlugin } from '@gjsify/esbuild-plugin-deno-loader';
import { deepkitPlugin } from '@gjsify/esbuild-plugin-deepkit';
import { globPlugin } from 'esbuild-plugin-glob';
import { merge } from "lodash";
import { resolvePackageByType, getAliasesForNode } from "../alias.js";
import { EXTERNALS_NODE } from "@gjsify/resolve-npm";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForNode = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    const format = pluginOptions.format || 'esm';

    const inject = [
        // '@gjsify/abort-controller',
        // '@gjsify/web-events',
    ].map(inj => resolvePackageByType(inj, format === 'cjs' ? 'main' : 'module'));

    // Set default options
    const esbuildOptions: BuildOptions = {
        format,
        bundle: true,
        minify: false,
        sourcemap: false,
        target: [ "node16" ],
        platform: "node",
        mainFields: format === 'esm' ? ['module', 'main'] : ['main', 'module', 'browser'],
        conditions: format === 'esm' ? ['import'] : ['require'],
        external: [...EXTERNALS_NODE, 'gi://*'],
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
        inject,
        define: {
            global: 'globalThis',
            window: 'globalThis',
        },
        plugins: [
            // globPlugin({ignore: pluginOptions.exclude}),
            // denoPlugin({reflection: pluginOptions.reflection}),
            // deepkitPlugin({reflection: pluginOptions.reflection}),
        ]
    };

    merge(build.initialOptions, esbuildOptions);

    const aliases = {...getAliasesForNode(), ...pluginOptions.aliases};

    for (const aliasKey of Object.keys(aliases)) {
        if(pluginOptions.exclude.includes(aliasKey)) {
            delete aliases[aliasKey];
        }
    }

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await globPlugin({ignore: pluginOptions.exclude}).setup(build);
    await denoPlugin({reflection: pluginOptions.reflection}).setup(build);
    await deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}