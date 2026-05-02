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

/**
 * Minimal synchronous process stub injected as a GJS bundle banner.
 *
 * Some npm packages (glob, path-scurry, readable-stream, …) access
 * `globalThis.process.platform` at their top-level during lazy __esm
 * initialisation — BEFORE any `import`-triggered side effects fire.
 * A banner runs before everything, including esbuild helpers and all
 * bundled module code, making it the only reliable injection point for
 * a synchronous global that must exist from byte 1 of execution.
 *
 * Only installed if process is absent; the full @gjsify/process
 * implementation (with EventEmitter, real streams, etc.) is wired up
 * later via --globals auto (which injects @gjsify/node-globals/register/process).
 */
const GJS_PROCESS_STUB = [
    'if(typeof globalThis.process==="undefined"){',
    'const _s=imports.system,_G=imports.gi.GLib;',
    'globalThis.process={',
    'platform:"linux",arch:"x64",version:"v20.0.0",',
    'env:new Proxy({},{',
    'get(_,p){return typeof p==="string"?(_G.getenv(p)??undefined):undefined},',
    'set(_,p,v){if(typeof p==="string")_G.setenv(p,String(v),true);return true},',
    'has(_,p){return typeof p==="string"&&_G.getenv(p)!==null}',
    '}),',
    'argv:_s?.programArgs?["gjs",_s.programInvocationName||"",..._s.programArgs]:["gjs"],',
    'versions:{node:"20.0.0"},config:{},',
    'cwd(){return _G.get_current_dir()||"/"},',
    'exit(c){_s.exit(c??0)},',
    'stderr:{write(s){printerr(s)}},stdout:{write(s){print(s)}},stdin:null,',
    'pid:0,ppid:0,exitCode:undefined,',
    'nextTick(fn,...a){Promise.resolve().then(()=>fn(...a))},',
    'hrtime(t){return t?[0,0]:[0,0]},',
    '};',
    '}',
].join('');

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

    // Capture user inject (from .gjsifyrc.js `esbuild.inject`) before merge() overwrites it.
    const userInject: string[] = Array.isArray(build.initialOptions.inject)
        ? build.initialOptions.inject as string[]
        : build.initialOptions.inject
        ? [build.initialOptions.inject as string]
        : [];

    // Inject the console shim for GJS builds (default: enabled).
    // The shim replaces all `console` references in the bundle with print()/printerr()-based
    // implementations that bypass GLib.log_structured() — no prefix, ANSI codes work.
    if (pluginOptions.consoleShim !== false) {
        // Resolve relative to the compiled shims/ directory next to this file
        esbuildOptions.inject = [resolve(_shimDir, '../shims/console-gjs.js'), ...userInject];
    } else if (userInject.length > 0) {
        esbuildOptions.inject = [...userInject];
    }

    // Append pre-computed globals stub (from --globals CLI flag) if present.
    if (pluginOptions.autoGlobalsInject) {
        esbuildOptions.inject = [
            ...(esbuildOptions.inject ?? []),
            pluginOptions.autoGlobalsInject,
        ];
    }

    // Prepend the synchronous process stub banner so globalThis.process exists
    // before any bundled module code runs. Combines with any user-supplied banner.
    const userBannerJs = typeof (build.initialOptions.banner as Record<string, string> | undefined)?.js === 'string'
        ? (build.initialOptions.banner as Record<string, string>).js
        : '';
    esbuildOptions.banner = { js: GJS_PROCESS_STUB + (userBannerJs ? '\n' + userBannerJs : '') };

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
