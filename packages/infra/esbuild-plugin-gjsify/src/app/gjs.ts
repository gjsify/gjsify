import { readFileSync, writeFileSync } from 'fs';
import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { getAliasesForGjs, globToEntryPoints } from "../utils/index.js";

// Types
import type { PluginBuild, BuildOptions } from "esbuild";
import type { PluginOptions } from '../types/plugin-options.js';

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

    merge(build.initialOptions, esbuildOptions);

    build.initialOptions.entryPoints = await globToEntryPoints(build.initialOptions.entryPoints, pluginOptions.exclude);

    const aliases = {...getAliasesForGjs({external}), ...pluginOptions.aliases};

    if(pluginOptions.debug) console.debug("initialOptions", build.initialOptions);

    await aliasPlugin(aliases).setup(build);
    await deepkitPlugin.deepkitPlugin({reflection: pluginOptions.reflection}).setup(build);

    // Fix CJS-ESM interop: esbuild's __toCommonJS wraps ESM modules in a
    // namespace object { __esModule, default, ...namedExports }. CJS code that
    // does `var fn = require('esm-pkg')` gets the namespace instead of the
    // default export. This breaks npm packages like is-promise, depd, etc.
    // that export a single default function consumed by CJS require().
    //
    // The patch makes __toCommonJS return the default export directly when
    // the module has no named exports (only __esModule + default).
    build.onEnd((result) => {
        if (result.errors.length > 0) return;

        const outfile = build.initialOptions.outfile;
        if (!outfile) return;

        try {
            let content = readFileSync(outfile, 'utf-8');

            const toCommonJSPattern =
                /var __toCommonJS = \(mod\d?\) => __copyProps\(__defProp\(\{\}, "__esModule", \{ value: true \}\), mod\d?\);/;

            if (toCommonJSPattern.test(content)) {
                content = content.replace(toCommonJSPattern,
                    `var __toCommonJS = (mod) => {
  var ns = __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  if (typeof ns.default !== "undefined") {
    var keys = Object.keys(ns);
    if (keys.length === 1 || (keys.length === 2 && keys.includes("__esModule"))) return ns.default;
  }
  return ns;
};`
                );
                writeFileSync(outfile, content);
            }
        } catch {
            // Non-critical: if patching fails, CJS-ESM interop issues may
            // surface at runtime but the build itself is not broken.
        }
    });
}