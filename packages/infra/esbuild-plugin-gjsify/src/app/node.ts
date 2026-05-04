import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import { cssPlugin } from '@gjsify/esbuild-plugin-css';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { getAliasesForNode, globToEntryPoints } from "../utils/index.js";
import { registerToCommonJSPatch } from "../utils/patch-to-common-js.js";
import { EXTERNALS_NODE } from "@gjsify/resolve-npm";
import { dirname, join, relative, resolve } from 'node:path';
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

    // Rewrite node_modules files that use import.meta.url or __dirname/__filename.
    //
    // For ESM files (containing import.meta.url): replace with a runtime-relative URL.
    //   new URL("<relPathFromBundleDir>", import.meta.url).href
    // This is stable across machines when the bundle / node_modules layout is preserved.
    //
    // For CJS files (no import.meta.url): inject __dirname/__filename as absolute
    // string literals. Introducing import.meta.url into CJS would make esbuild treat
    // the module as ESM, conflicting with module.exports/require. Bundled `typescript`
    // (isFileSystemCaseSensitive calls swapCase(__filename)) is the canonical consumer.
    //
    // Mirrors the GJS target's logic in gjs.ts — consistent across both targets.
    build.onLoad({ filter: /\.(m?js|cjs|[cm]?tsx?)$/ }, async (args) => {
        if (!args.path.includes('node_modules')) return undefined;
        const src = await readFile(args.path, 'utf8');
        const hasMetaUrl = src.includes('import.meta.url');
        const hasDirname = src.includes('__dirname');
        const hasFilename = src.includes('__filename');
        if (!hasMetaUrl && !hasDirname && !hasFilename) return undefined;
        const dir = dirname(args.path);
        let contents = src;
        if (hasMetaUrl) {
            const outFile = build.initialOptions.outfile
                ?? join(build.initialOptions.outdir ?? '.', 'bundle.mjs');
            const bundleDir = dirname(resolve(outFile));
            const relPath = relative(bundleDir, args.path);
            const relDir = relative(bundleDir, dir) || '.';
            const runtimeFileUrl = `new URL(${JSON.stringify(relPath)}, import.meta.url)`;
            contents = contents.replace(/\bimport\.meta\.url\b/g, `${runtimeFileUrl}.href`);
            const dirnameDecl = /(?:var|let|const)\s+__dirname\b|export\s+(?:var|let|const)\s+__dirname\b/.test(src);
            const filenameDecl = /(?:var|let|const)\s+__filename\b|export\s+(?:var|let|const)\s+__filename\b/.test(src);
            const lines: string[] = [];
            if (hasDirname && !dirnameDecl) lines.push(`var __dirname = new URL(${JSON.stringify(relDir + '/')}, import.meta.url).pathname.replace(/\\/$/, "");`);
            if (hasFilename && !filenameDecl) lines.push(`var __filename = ${runtimeFileUrl}.pathname;`);
            if (lines.length > 0) contents = lines.join('\n') + '\n' + contents;
        } else {
            // CJS-only file: absolute string literals, no import.meta.url injection.
            const dirnameDecl = /(?:var|let|const)\s+__dirname\b|export\s+(?:var|let|const)\s+__dirname\b/.test(src);
            const filenameDecl = /(?:var|let|const)\s+__filename\b|export\s+(?:var|let|const)\s+__filename\b/.test(src);
            const lines: string[] = [];
            if (hasDirname && !dirnameDecl) lines.push(`var __dirname = ${JSON.stringify(dir)};`);
            if (hasFilename && !filenameDecl) lines.push(`var __filename = ${JSON.stringify(args.path)};`);
            if (lines.length > 0) contents = lines.join('\n') + '\n' + contents;
        }
        const ext = args.path.split('.').pop() ?? 'js';
        const loader = ['ts', 'mts', 'cts', 'tsx'].includes(ext) ? 'ts' : 'js';
        return { contents, loader, resolveDir: dir };
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