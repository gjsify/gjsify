import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import { blueprintPlugin } from '@gjsify/esbuild-plugin-blueprint';
import { cssPlugin } from '@gjsify/esbuild-plugin-css';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { globToEntryPoints, getAliasesForBrowser } from "../utils/index.js";

// Types
import type { Plugin, PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

// Redirect @girs/* and gi://* imports to an empty module.
// These are GJS-specific (GObject introspection bindings / GI protocol) with
// no browser equivalent. They appear transitively via @gjsify/unit and similar
// packages that have GJS-specific code paths. Marking them external would leave
// bare specifiers in the bundle that the browser cannot resolve at runtime;
// instead we return an empty ESM module so the bundle is self-contained.
const gjsImportsEmptyPlugin: Plugin = {
    name: 'gjs-imports-empty',
    setup(build) {
        build.onResolve({ filter: /^@girs\// }, () => ({ path: '__girs_empty__', namespace: 'gjs-imports-empty' }));
        build.onResolve({ filter: /^gi:\/\// }, () => ({ path: '__gi_empty__', namespace: 'gjs-imports-empty' }));
        build.onLoad({ filter: /.*/, namespace: 'gjs-imports-empty' }, () => ({ contents: 'export {}; export default {};', loader: 'js' }));
    },
};

export const setupForBrowser = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    const external: string[] = [];

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format: 'esm',
        bundle: true,
        minify: false,
        sourcemap: false,
        treeShaking: true,
        preserveSymlinks: false, // false means follow symlinks
        target: [ "esnext" ],
        platform: "browser",
        mainFields: ['browser', 'module', 'main'],
        conditions: ['import', 'browser'],
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
            '.ttf': 'file',
            '.woff': 'file',
            '.woff2': 'file',
        },
        inject: [],
        define: {
            global: 'globalThis',
            window: 'globalThis',
        }
    };

    merge(build.initialOptions, esbuildOptions);

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude)

    // Standard Node.js → browser polyfill aliases.
    // When bundling for the browser, npm packages that import Node builtins
    // (events, path, crypto, etc.) need browser-compatible replacements —
    // same mappings that webpack/browserify provide by default.
    // Projects must install the polyfill packages they need (e.g. path-browserify).
    // Uninstalled polyfills are skipped — esbuild errors as usual if the
    // builtin is actually imported.
    const browserPolyfillAliases: Record<string, string> = {
        'path': 'path-browserify',
        'crypto': 'crypto-browserify',
        'stream': 'stream-browserify',
        'process': 'process/browser',
    };

    const aliases = {...browserPolyfillAliases, ...getAliasesForBrowser(), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await gjsImportsEmptyPlugin.setup(build);
    await aliasPlugin(aliases).setup(build);
    await blueprintPlugin().setup(build);
    await cssPlugin(pluginOptions.css ?? {}).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}