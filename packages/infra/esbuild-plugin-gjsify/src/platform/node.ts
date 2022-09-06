import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';
import { merge } from "lodash";
// import { aliasesWeb } from "../alias";
import aliasPlugin from 'esbuild-plugin-alias';
import { EXTERNALS_NODE } from "@gjsify/resolve-npm";

export const setupForNode = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format: 'esm',
        bundle: true,
        minify: false,
        sourcemap: false,
        target: [ "node16" ],
        platform: "node",
        mainFields: ['module', 'main'],
        external: [...EXTERNALS_NODE, 'gi://*'],
        loader: {
            '.ts': 'ts',
            '.mts': 'ts',
            '.cts': 'ts',
            '.tsx': 'ts',
            '.mtsx': 'ts',
            '.ctsx': 'ts',
        },
        inject: [
            // require.resolve('@gjsify/abort-controller/'),
            // require.resolve('@gjsify/web-events/'),
            // require.resolve('@gjsify/globals/')
        ],
        define: {
            global: 'globalThis',
        }
    };

    merge(build.initialOptions, esbuildOptions);

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    const aliases = {/*...aliasesWeb,*/ ...pluginOptions.aliases};

    for (const aliasKey of Object.keys(aliases)) {
        if(pluginOptions.exclude.includes(aliasKey)) {
            delete aliases[aliasKey];
        }
    }

    if(pluginOptions.debug) console.debug("aliases", aliases);

    await aliasPlugin(aliases).setup(build);
}