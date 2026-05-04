import { dirname, join, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

import type { OnLoadArgs, OnLoadResult, PluginBuild } from 'esbuild';

// Rewrite node_modules files that use:
//   - import.meta.url  (ESM packages that locate their own resources via FS path)
//   - __dirname / __filename  (CJS packages; esbuild platform:'neutral' omits them,
//                              and the Node ESM target doesn't auto-shim them either)
//
// Strategy depends on whether the source file is ESM or CJS, detected by the
// presence of `import.meta.url`:
//
// ESM file (has import.meta.url):
//   replace each `import.meta.url` occurrence with
//     new URL("<relPathFromBundleDirToSource>", import.meta.url).href
//   Stable across machines as long as the bundle/node_modules layout is preserved
//   at the deploy site (true for locally-built and npm-distributed packages).
//   At runtime, .pathname yields the absolute FS path; gjsify's GLib-backed fs
//   polyfill reads package.json, locales, and static assets from node_modules.
//   __dirname/__filename — when used but not declared — get an ESM-safe preamble
//   derived from the same relative URL.
//
// CJS file (no import.meta.url):
//   inject __dirname/__filename as absolute string literals.  Do NOT introduce
//   import.meta.url here — esbuild would treat the module as ESM, conflicting
//   with module.exports/require (typescript.js triggered this).
//
// Self-declarations are detected and skipped: some ESM packages declare
// `var __dirname = dirname(fileURLToPath(import.meta.url))` themselves; injecting
// a second declaration causes a duplicate-binding error.  After import.meta.url
// is rewritten, those self-declarations resolve to the correct path automatically.

const DIRNAME_DECL_RE = /(?:var|let|const)\s+__dirname\b|export\s+(?:var|let|const)\s+__dirname\b/;
const FILENAME_DECL_RE = /(?:var|let|const)\s+__filename\b|export\s+(?:var|let|const)\s+__filename\b/;

function getBundleDir(build: PluginBuild): string {
    const outFile = build.initialOptions.outfile
        ?? join(build.initialOptions.outdir ?? '.', 'bundle.mjs');
    return dirname(resolve(outFile));
}

async function loadAndRewrite(args: OnLoadArgs, build: PluginBuild): Promise<OnLoadResult | undefined> {
    if (!args.path.includes('node_modules')) return undefined;
    let src: string;
    try {
        src = await readFile(args.path, 'utf8');
    } catch (err) {
        // Yarn PnP virtual paths (e.g. `pnp:/.../typescript-zip.zip/...` or
        // unhydrated `.zip/...` cache paths) are not readable via Node's
        // native fs. Fall through so the @yarnpkg/esbuild-plugin-pnp's own
        // onLoad (which knows how to read zip-cached files) handles them.
        // Without this guard the plugin chain aborts the whole build.
        return undefined;
    }
    const hasMetaUrl = src.includes('import.meta.url');
    const hasDirname = src.includes('__dirname');
    const hasFilename = src.includes('__filename');
    if (!hasMetaUrl && !hasDirname && !hasFilename) return undefined;

    const dir = dirname(args.path);
    const dirnameDeclared = DIRNAME_DECL_RE.test(src);
    const filenameDeclared = FILENAME_DECL_RE.test(src);
    const preamble: string[] = [];
    let contents = src;

    if (hasMetaUrl) {
        const bundleDir = getBundleDir(build);
        const relPath = relative(bundleDir, args.path);
        const relDir = relative(bundleDir, dir) || '.';
        const runtimeFileUrl = `new URL(${JSON.stringify(relPath)}, import.meta.url)`;
        contents = contents.replace(/\bimport\.meta\.url\b/g, `${runtimeFileUrl}.href`);
        if (hasDirname && !dirnameDeclared) {
            preamble.push(`var __dirname = new URL(${JSON.stringify(relDir + '/')}, import.meta.url).pathname.replace(/\\/$/, "");`);
        }
        if (hasFilename && !filenameDeclared) {
            preamble.push(`var __filename = ${runtimeFileUrl}.pathname;`);
        }
    } else {
        if (hasDirname && !dirnameDeclared) preamble.push(`var __dirname = ${JSON.stringify(dir)};`);
        if (hasFilename && !filenameDeclared) preamble.push(`var __filename = ${JSON.stringify(args.path)};`);
    }
    if (preamble.length > 0) contents = preamble.join('\n') + '\n' + contents;

    const ext = args.path.split('.').pop() ?? 'js';
    const loader = ['ts', 'mts', 'cts', 'tsx'].includes(ext) ? 'ts' : 'js';
    return { contents, loader, resolveDir: dir };
}

export function registerNodeModulesPathRewrite(build: PluginBuild): void {
    const filter = /\.(m?js|cjs|[cm]?tsx?)$/;
    // Default "file" namespace covers regular node_modules + workspace files.
    build.onLoad({ filter }, (args) => loadAndRewrite(args, build));
    // "pnp" namespace covers zip-cached packages resolved by
    // @yarnpkg/esbuild-plugin-pnp. Without this, ESM packages in PnP zips
    // skip our `import.meta.url` rewrite, and CJS packages skip the
    // `__dirname` / `__filename` injection — leading to runtime
    // ReferenceError in the bundle (e.g. typescript.js).
    build.onLoad({ filter, namespace: "pnp" }, (args) => loadAndRewrite(args, build));
}
