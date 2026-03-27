import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { getAliasesForGjs, globToEntryPoints } from "../utils/index.js";
import { registerToCommonJSPatch } from "../utils/patch-to-common-js.js";
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

const _shimDir = dirname(fileURLToPath(import.meta.url));

export const setupForGjs = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    const external = ['gi://*', 'cairo', 'gettext', 'system'];
    const format = pluginOptions.format || 'esm';

    pluginOptions.aliases ||= {};
    pluginOptions.exclude ||= [];

    // Set default options
    const esbuildOptions: BuildOptions = {
        format,
        bundle: true,
        metafile: false,
        minify: false,
        sourcemap: false,
        treeShaking: true,
        preserveSymlinks: false, // false means follow symlinks
        // firefox60  // Since GJS 1.53.90
        // firefox68  // Since GJS 1.63.90
        // firefox78  // Since GJS 1.65.90
        // firefox91  // Since GJS 1.71.1
        // firefox102 // Since GJS 1.73.2
        // firefox128 // Since GJS 1.86.0
        target: [ "firefox128" ],
        platform: 'neutral',
        // 'browser' field is needed so packages like create-hash, create-hmac, randombytes
        // use their pure-JS browser entry instead of index.js (which does require('crypto')
        // and causes circular dependencies via the crypto → @gjsify/crypto alias).
        mainFields: format === 'esm' ? ['browser', 'module', 'main'] : ['browser', 'main', 'module'],
        // https://esbuild.github.io/api/#conditions
        conditions: format === 'esm' ? ['browser', 'import', 'require'] : ['browser', 'require', 'import'],
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
            // Make readable-stream delegate to @gjsify/stream instead of using
            // its own implementation (avoids 'process is not defined' at load time)
            'process.env.READABLE_STREAM': '"disable"',
        },
    };

    // Inject the console shim for GJS builds (default: enabled).
    // The shim replaces all `console` references in the bundle with print()/printerr()-based
    // implementations that bypass GLib.log_structured() — no prefix, ANSI codes work.
    if (pluginOptions.consoleShim !== false) {
        // Resolve relative to the compiled shims/ directory next to this file
        esbuildOptions.inject = [resolve(_shimDir, '../shims/console-gjs.js')];
    }

    merge(build.initialOptions, esbuildOptions);

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude);

    const aliases = {...getAliasesForGjs({external}), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);

    registerToCommonJSPatch(build);
}
