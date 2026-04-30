import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import { cssPlugin } from '@gjsify/esbuild-plugin-css';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { getAliasesForNode, globToEntryPoints } from "../utils/index.js";
import { registerToCommonJSPatch } from "../utils/patch-to-common-js.js";
import { EXTERNALS_NODE } from "@gjsify/resolve-npm";
import { dirname } from 'node:path';
import { readFile } from 'node:fs/promises';

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

export const setupForNode = async (build: PluginBuild, pluginOptions: PluginOptions) => {

    // node-datachannel is a native C++ addon that cannot be bundled —
    // its require('../build/Release/node_datachannel.node') must resolve
    // at runtime against the real node_modules tree.
    // User-supplied externals (`gjsify build --external <name>`) are merged in
    // so they survive the merge-overwrite of `build.initialOptions.external`.
    const userExternal = build.initialOptions.external ?? [];
    const external = [...EXTERNALS_NODE, 'gi://*', '@girs/*', 'node-datachannel', ...userExternal];
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
        // ESM output of bundled CJS code still needs `require()` (esbuild emits
        // calls to it for external Node builtins). Node ESM has no `require`
        // natively, so we synthesize one via `module.createRequire`.
        //
        // We deliberately do NOT shim `__filename` / `__dirname` here even
        // though some bundled CJS consumers (e.g. typescript's
        // `isFileSystemCaseSensitive`) reach for them. esbuild already emits
        // per-source-file `var __filename = fileURLToPath(import.meta.url)`
        // for ESM input that uses these identifiers, and a top-of-bundle
        // `const __filename = …` collides with those declarations. CJS
        // modules wrapped in `__commonJS()` get their own scope and are
        // handled separately — see `cjsFilenameDirnamePatch` below.
        ...(format === 'esm' ? {
            banner: {
                js: "import { createRequire as __gjsifyCreateRequire } from 'module';\nconst require = __gjsifyCreateRequire(import.meta.url);",
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

    // Inject `__filename` / `__dirname` as compile-time constants for any CJS
    // file in `node_modules` that references them. esbuild wraps such files in
    // `__commonJS()` closures but does NOT auto-shim these CJS-only globals
    // for ESM output. Bundled `typescript` (`isFileSystemCaseSensitive` calls
    // `swapCase(__filename)`) is the canonical consumer that breaks without
    // this. Mirrors the GJS target's identical injection.
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

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude)

    const aliases = {...getAliasesForNode({external}), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await cssPlugin(pluginOptions.css ?? {}).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);

    registerToCommonJSPatch(build);
}