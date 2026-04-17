import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import { blueprintPlugin } from '@gjsify/esbuild-plugin-blueprint';
import { cssPlugin } from '@gjsify/esbuild-plugin-css';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { globToEntryPoints } from "../utils/index.js";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

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
            'process.env.NODE_DEBUG': '""',
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
    };

    const aliases = {...browserPolyfillAliases, ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await blueprintPlugin().setup(build);
    await cssPlugin(pluginOptions.css ?? {}).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);
}