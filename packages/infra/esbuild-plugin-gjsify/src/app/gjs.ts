import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import { blueprintPlugin } from '@gjsify/esbuild-plugin-blueprint';
import { cssPlugin } from '@gjsify/esbuild-plugin-css';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { getAliasesForGjs, globToEntryPoints } from "../utils/index.js";
import { registerToCommonJSPatch } from "../utils/patch-to-common-js.js";
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';
import { readFile } from 'fs/promises';

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

const _shimDir = dirname(fileURLToPath(import.meta.url));

export const setupForGjs = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    // User-supplied externals (`gjsify build --external <name>`) merge in so
    // they survive the merge-overwrite of `build.initialOptions.external`.
    const userExternal = build.initialOptions.external ?? [];
    const external = ['gi://*', 'cairo', 'gettext', 'system', ...userExternal];
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
        // ESM: omit 'require' — esbuild uses the first matching condition, so packages
        // listing 'require' before 'import' would silently route through their CJS entry.
        conditions: format === 'esm' ? ['browser', 'import'] : ['browser', 'require', 'import'],
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

    // Append pre-computed globals stub (from --globals CLI flag) if present.
    if (pluginOptions.autoGlobalsInject) {
        esbuildOptions.inject = [
            ...(esbuildOptions.inject ?? []),
            pluginOptions.autoGlobalsInject,
        ];
    }

    // random-access-file's 'browser' field maps to a throwing stub; force the fs-backed Node entry.
    build.onResolve({ filter: /^random-access-file$/ }, async (args) => {
        const result = await build.resolve('random-access-file/index.js', {
            kind: args.kind,
            resolveDir: args.resolveDir,
        });
        if (result.errors.length > 0) return undefined;
        return { path: result.path };
    });

    // Inject __dirname/__filename as compile-time constants for CJS node_modules (platform:'neutral' omits them).
    build.onLoad({ filter: /\.(js|cjs)$/ }, async (args) => {
        if (!args.path.includes('node_modules')) return undefined;
        const src = await readFile(args.path, 'utf8');
        if (!src.includes('__dirname') && !src.includes('__filename')) return undefined;
        const dir = dirname(args.path);
        const preamble =
            `var __dirname = ${JSON.stringify(dir)};\n` +
            `var __filename = ${JSON.stringify(args.path)};\n`;
        return { contents: preamble + src, loader: 'js', resolveDir: dir };
    });

    merge(build.initialOptions, esbuildOptions);

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude);

    const aliases = {...getAliasesForGjs({external}), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await blueprintPlugin().setup(build);
    // Default CSS target: firefox60. This triggers esbuild's CSS lowering for
    // features GTK4's CSS parser does not understand — most importantly CSS
    // Nesting. Modern features GTK4 *does* support (var(), calc(), :is(),
    // :where(), :not()) are preserved at this target. Override via
    // `gjsify.config.js` → `esbuild.css.target` if your GTK version differs.
    await cssPlugin({
        minify: pluginOptions.css?.minify,
        target: pluginOptions.css?.target ?? ['firefox60'],
    }).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);

    registerToCommonJSPatch(build);
}
