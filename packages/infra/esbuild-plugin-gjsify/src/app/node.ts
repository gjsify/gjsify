import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { getAliasesForNode, globToEntryPoints } from "../utils/index.js";
import { registerToCommonJSPatch } from "../utils/patch-to-common-js.js";
import { EXTERNALS_NODE } from "@gjsify/resolve-npm";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForNode = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    const external = [...EXTERNALS_NODE, 'gi://*', '@girs/*'];
    const format = pluginOptions.format || 'esm';

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format,
        bundle: true,
        minify: false,
        sourcemap: false,
        treeShaking: true,
        preserveSymlinks: false, // false means follow symlinks
        target: [ "node24" ],
        platform: "node",
        mainFields: format === 'esm' ? ['module', 'main', 'browser'] : ['main', 'module', 'browser'],
        conditions: format === 'esm' ? ['module', 'import'] : ['require'],
        // In ESM output, CJS require() calls to external modules (Node.js
        // builtins) need a real require function. Node.js ESM doesn't provide
        // one natively, so we create it via createRequire().
        ...(format === 'esm' ? {
            banner: {
                js: "import { createRequire as __gjsify_createRequire } from 'module';\nconst require = __gjsify_createRequire(import.meta.url);",
            },
        } : {}),
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
        define: {
            global: 'globalThis',
            window: 'globalThis',
        }
    };

    merge(build.initialOptions, esbuildOptions);

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude)

    const aliases = {...getAliasesForNode({external}), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);

    registerToCommonJSPatch(build);
}