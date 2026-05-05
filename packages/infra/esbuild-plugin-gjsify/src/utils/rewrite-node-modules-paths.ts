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

export const REWRITE_FILTER = /\.(m?js|cjs|[cm]?tsx?)$/;
const DIRNAME_DECL_RE = /(?:var|let|const)\s+__dirname\b|export\s+(?:var|let|const)\s+__dirname\b/;
const FILENAME_DECL_RE = /(?:var|let|const)\s+__filename\b|export\s+(?:var|let|const)\s+__filename\b/;

/** True when the rewriter wants to look at this path — node_modules + supported ext. */
export function shouldRewrite(path: string): boolean {
    return path.includes('node_modules') && REWRITE_FILTER.test(path);
}

/** Compute the directory where the build's outfile/outdir lives. */
export function getBundleDir(build: PluginBuild): string {
    const outFile = build.initialOptions.outfile
        ?? join(build.initialOptions.outdir ?? '.', 'bundle.mjs');
    return dirname(resolve(outFile));
}

/**
 * Pure rewriter: takes the source contents of a node_modules file and returns
 * a rewritten OnLoadResult, or `undefined` when the file doesn't reference any
 * of the patterns we rewrite. Caller is responsible for reading the file via
 * a runtime that understands its namespace (regular fs, PnP zip-aware fs, ...).
 *
 * Centralised so both:
 *   - the gjsify plugin's `onLoad` for the `file` namespace, and
 *   - the @yarnpkg/esbuild-plugin-pnp custom `onLoad` for the `pnp` namespace
 * apply the same transformation, regardless of which loader read the bytes.
 */
export function rewriteContents(
    args: { path: string },
    src: string,
    bundleDir: string,
): OnLoadResult | undefined {
    if (!shouldRewrite(args.path)) return undefined;

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

async function loadAndRewrite(args: OnLoadArgs, build: PluginBuild): Promise<OnLoadResult | undefined> {
    if (!args.path.includes('node_modules')) return undefined;
    let src: string;
    try {
        src = await readFile(args.path, 'utf8');
    } catch {
        // Some Yarn PnP virtual paths are not readable via Node's native fs in
        // every runtime context. Fall through so the @yarnpkg/esbuild-plugin-pnp's
        // own onLoad (or the wrapped one composed in @gjsify/resolve-npm/pnp-relay)
        // handles them.
        return undefined;
    }
    return rewriteContents(args, src, getBundleDir(build));
}

export function registerNodeModulesPathRewrite(build: PluginBuild): void {
    // Default "file" namespace covers regular node_modules + workspace files.
    // The "pnp" namespace is intentionally NOT registered here — esbuild's
    // first-matching-onLoad rule means @yarnpkg/esbuild-plugin-pnp's own
    // onLoad always wins (it's registered before this plugin to provide
    // zip-aware reads). Callers that need PnP rewriting compose
    // `rewriteContents` into the pnpPlugin's `onLoad` callback directly —
    // see `@gjsify/resolve-npm/pnp-relay`.
    build.onLoad({ filter: REWRITE_FILTER }, (args) => loadAndRewrite(args, build));
}
