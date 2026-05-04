import { aliasPlugin } from '@gjsify/esbuild-plugin-alias';
import { blueprintPlugin } from '@gjsify/esbuild-plugin-blueprint';
import { cssPlugin } from '@gjsify/esbuild-plugin-css';
import * as deepkitPlugin from '@gjsify/esbuild-plugin-deepkit';
import { merge } from "../utils/merge.js";
import { getAliasesForGjs, globToEntryPoints } from "../utils/index.js";
import { registerToCommonJSPatch } from "../utils/patch-to-common-js.js";
import { fileURLToPath, pathToFileURL } from 'url';
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
    'has(_,p){return typeof p==="string"&&_G.getenv(p)!==null},',
    'deleteProperty(_,p){if(typeof p==="string")_G.unsetenv(p);return true},',
    'ownKeys(){return _G.listenv()??[]},',
    'getOwnPropertyDescriptor(_,p){const v=_G.getenv(p);return v!==null?{value:v,writable:true,enumerable:true,configurable:true}:undefined}',
    '}),',
    'argv:_s?.programArgs?["gjs",_s.programInvocationName||"",..._s.programArgs]:["gjs"],',
    'versions:{},config:{},',
    'cwd(){return _G.get_current_dir()||"/"},',
    'exit(c){_s.exit(c??0)},',
    'stderr:{write(s){printerr(s)}},stdout:{write(s){print(s)}},stdin:null,',
    'exitCode:undefined,',
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

    // The shim replaces all `console` references with print()/printerr()-based
    // implementations that bypass GLib.log_structured() — no prefix, ANSI codes work.
    if (pluginOptions.consoleShim !== false) {
        // Resolve relative to the compiled shims/ directory next to this file
        esbuildOptions.inject = [resolve(_shimDir, '../shims/console-gjs.js'), ...userInject];
    } else if (userInject.length > 0) {
        esbuildOptions.inject = [...userInject];
    }

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

    // Rewrite build-time constants for node_modules that use:
    //   - import.meta.url  (ESM packages that locate their own resources via FS path)
    //   - __dirname / __filename  (CJS packages; esbuild platform:'neutral' omits them)
    //
    // In a GJS bundle, import.meta.url resolves to the *bundle* file URL — not the
    // original package path. Replacing it with the build-time-known file URL lets
    // Path.join(fileURLToPath(…), '../package.json') and similar patterns resolve
    // into node_modules correctly; gjsify's GLib-backed fs polyfill handles the
    // actual I/O at runtime. Analogous to Rollup's CJS-target import.meta.url
    // polyfill: substitute the runtime-unknowable value with the build-time-known path.
    //
    // __dirname/__filename preamble is only injected when the file doesn't already
    // declare them (some ESM packages declare __dirname = dirname(fileURLToPath(
    // import.meta.url)) themselves — injecting again causes a duplicate-declaration
    // error). After import.meta.url is rewritten those self-declarations resolve
    // to the correct path automatically.
    build.onLoad({ filter: /\.(m?js|cjs|[cm]?tsx?)$/ }, async (args) => {
        if (!args.path.includes('node_modules')) return undefined;
        const src = await readFile(args.path, 'utf8');
        const hasMetaUrl = src.includes('import.meta.url');
        const hasDirnameUse = src.includes('__dirname');
        const hasFilenameUse = src.includes('__filename');
        if (!hasMetaUrl && !hasDirnameUse && !hasFilenameUse) return undefined;
        const dir = dirname(args.path);
        let contents = src;
        if (hasMetaUrl) {
            const originalUrl = pathToFileURL(args.path).href;
            contents = contents.replace(/\bimport\.meta\.url\b/g, JSON.stringify(originalUrl));
        }
        // Only inject the preamble when __dirname/__filename are used but not
        // already declared in the file (avoids duplicate-declaration errors in
        // packages that set them from import.meta.url themselves).
        const dirnameDecl = /(?:var|let|const)\s+__dirname\b|export\s+(?:var|let|const)\s+__dirname\b/.test(src);
        const filenameDecl = /(?:var|let|const)\s+__filename\b|export\s+(?:var|let|const)\s+__filename\b/.test(src);
        const injectDirname = hasDirnameUse && !dirnameDecl;
        const injectFilename = hasFilenameUse && !filenameDecl;
        if (injectDirname || injectFilename) {
            const lines: string[] = [];
            if (injectDirname) lines.push(`var __dirname = ${JSON.stringify(dir)};`);
            if (injectFilename) lines.push(`var __filename = ${JSON.stringify(args.path)};`);
            contents = lines.join('\n') + '\n' + contents;
        }
        const ext = args.path.split('.').pop() ?? 'js';
        const loader = ['ts', 'mts', 'cts', 'tsx'].includes(ext) ? 'ts' : 'js';
        return { contents, loader, resolveDir: dir };
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
