// esbuild plugin that bundles CSS imports into a JS string export.
//
// GTK apps built with `gjsify build` typically load application styles via
// `Gtk.CssProvider.load_from_string(applicationStyle)`, which requires the
// CSS to be inlined into the JS bundle as a string literal. The default
// `text` loader preserves the source verbatim but does not resolve `@import`
// statements — so `@import "@pixelrpg/gjs/index.css"` stays as-is and GTK's
// CSS parser cannot follow it into `node_modules` at runtime.
//
// This plugin runs each `.css` import through a recursive `esbuild.build()`
// with `loader: { '.css': 'css' }` + `bundle: true`. That reuses esbuild's
// own resolver (which understands `package.json#exports`, `conditions`, etc.),
// follows `@import`s across workspace and `node_modules` boundaries, and
// returns the concatenated CSS as a single `.css` output file. We grab the
// text of that output file and wrap it as a JS default export so the parent
// build (which is bundling JS) receives a plain string.
//
// Assets referenced via `url(...)` inside the CSS (fonts, images) are inlined
// as data URLs in the sub-build so the resulting string is self-contained
// and works regardless of how the JS bundle is deployed.
//
// Copyright (c) gjsify contributors. MIT license.

import type { Plugin, BuildOptions, Loader } from 'esbuild';
import { build as esbuildBuild } from 'esbuild';

export interface CssPluginOptions {
    /** Minify output CSS. Default: inherit from parent build's `minify`. */
    minify?: boolean;
    /** esbuild target(s) for CSS lowering. Default: inherit from parent. */
    target?: string | string[];
}

// Asset extensions that may appear inside `url(...)` in CSS. Inlined as data
// URLs so the produced JS string is self-contained.
const CSS_ASSET_LOADERS: Record<string, Loader> = {
    '.ttf': 'dataurl',
    '.woff': 'dataurl',
    '.woff2': 'dataurl',
    '.otf': 'dataurl',
    '.eot': 'dataurl',
    '.png': 'dataurl',
    '.jpg': 'dataurl',
    '.jpeg': 'dataurl',
    '.gif': 'dataurl',
    '.svg': 'dataurl',
    '.webp': 'dataurl',
};

export function cssPlugin(options: CssPluginOptions = {}): Plugin {
    return {
        name: 'gjsify-css',
        setup(build) {
            const minify = options.minify ?? build.initialOptions.minify ?? false;
            const target = options.target ?? build.initialOptions.target;

            // No onResolve hook — we let esbuild resolve the CSS import via its
            // normal algorithm (which handles node_modules, package.json#exports,
            // conditions, etc.). `args.path` in onLoad is the absolute resolved
            // path. Sub-builds spawned inside onLoad are separate esbuild
            // instances and do not invoke this plugin, so no recursion guard
            // is needed.
            build.onLoad({ filter: /\.css$/ }, async (args) => {
                const subBuildOpts: BuildOptions = {
                    entryPoints: [args.path],
                    bundle: true,
                    write: false,
                    loader: {
                        ...CSS_ASSET_LOADERS,
                        '.css': 'css',
                    },
                    minify,
                    // Inherit the parent's resolver configuration so CSS @imports
                    // resolve identically to JS imports (package.json#exports honored).
                    conditions: build.initialOptions.conditions,
                    resolveExtensions: build.initialOptions.resolveExtensions,
                    mainFields: build.initialOptions.mainFields,
                    preserveSymlinks: build.initialOptions.preserveSymlinks,
                    logLevel: 'silent',
                };
                if (target) {
                    subBuildOpts.target = target;
                }

                const result = await esbuildBuild(subBuildOpts);
                // The sub-build has exactly one CSS entry and `write: false`,
                // so the concatenated CSS is always the first (and only) output
                // file. esbuild uses `<stdout>` as the path when no outfile is
                // specified, so we can't filter by `.css` extension.
                const bundled = result.outputFiles?.[0]?.text ?? '';

                return {
                    contents: `export default ${JSON.stringify(bundled)};`,
                    loader: 'js',
                };
            });
        },
    };
}
