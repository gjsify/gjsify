import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import { cssPlugin } from '@gjsify/esbuild-plugin-css';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { getAliasesForNode, globToEntryPoints } from "../utils/index.js";
import { registerToCommonJSPatch } from "../utils/patch-to-common-js.js";
import { EXTERNALS_NODE } from "@gjsify/resolve-npm";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForNode = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    // node-datachannel is a native C++ addon that cannot be bundled —
    // its require('../build/Release/node_datachannel.node') must resolve
    // at runtime against the real node_modules tree.
    const external = [...EXTERNALS_NODE, 'gi://*', '@girs/*', 'node-datachannel'];
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
        // Use CJS-priority conditions for Node.js bundles. esbuild picks the
        // first matching key in the exports map (not the first in this array),
        // so including 'import' would cause packages like ws v8 — whose exports
        // map lists "import" before "require" — to resolve to an incomplete ESM
        // wrapper (missing the Server alias). Omitting 'import' forces fallback
        // to 'require' → the authoritative CJS entry. Packages with no 'require'
        // condition fall back to mainFields ['module', 'main', 'browser'].
        conditions: format === 'esm' ? ['require', 'node', 'module'] : ['require'],
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
    await cssPlugin(pluginOptions.css ?? {}).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);

    registerToCommonJSPatch(build);
}