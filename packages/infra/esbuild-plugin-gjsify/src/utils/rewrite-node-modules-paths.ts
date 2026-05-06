import { dirname, join, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

import type { OnLoadArgs, OnLoadResult, PluginBuild } from 'esbuild';

import { inlineStaticReads } from './inline-static-reads.js';

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

/** Pick esbuild's loader from a file path. TS extensions parse as TS. */
function loaderForPath(path: string): 'ts' | 'js' {
    const ext = path.split('.').pop() ?? 'js';
    return ['ts', 'mts', 'cts', 'tsx'].includes(ext) ? 'ts' : 'js';
}

/**
 * Compute the `var __dirname` / `var __filename` preamble for a file based on
 * how its `import.meta.url` resolves at runtime:
 *
 *   - regular node_modules path (`relPath` does NOT contain `.zip/`):
 *       __dirname / __filename derived from a relative URL whose base is the
 *       bundle's `import.meta.url`.
 *
 *   - Yarn-PnP zip-resident path (`relPath` contains `.zip/`):
 *       the original source path doesn't physically exist outside the PnP
 *       runtime, so we can't emit a useful relative URL for it. Derive
 *       __dirname / __filename from the bundle's own URL instead. Downstream
 *       heuristics (e.g. yargs walking the path string for a `node_modules`
 *       segment) get a valid file:// URL to inspect.
 *
 *   - source has no `import.meta.url` at all (CJS):
 *       inject absolute string literals for the source path.
 *
 * `dirnameDeclared` / `filenameDeclared` cover packages that already declare
 * `var __dirname = dirname(fileURLToPath(import.meta.url))` themselves —
 * we'd produce a duplicate-binding error otherwise.
 */
function buildDirFilenamePreamble(args: {
    needDirname: boolean;
    needFilename: boolean;
    dirnameDeclared: boolean;
    filenameDeclared: boolean;
    /** kind of rewrite: 'esm-relative' | 'esm-zip' | 'cjs-absolute' */
    kind: 'esm-relative' | 'esm-zip' | 'cjs-absolute';
    /** path of the source file (only used for cjs-absolute) */
    sourcePath: string;
    /** dir of the source file (only used for cjs-absolute) */
    sourceDir: string;
    /** rel from bundleDir to sourceDir + trailing '/' (only used for esm-relative) */
    relDirWithSlash: string;
    /** rel from bundleDir to sourcePath (only used for esm-relative) */
    relPath: string;
}): string[] {
    const lines: string[] = [];
    if (args.needDirname && !args.dirnameDeclared) {
        if (args.kind === 'esm-zip') {
            lines.push(`var __dirname = new URL(".", import.meta.url).pathname.replace(/\\/$/, "");`);
        } else if (args.kind === 'esm-relative') {
            lines.push(`var __dirname = new URL(${JSON.stringify(args.relDirWithSlash)}, import.meta.url).pathname.replace(/\\/$/, "");`);
        } else {
            lines.push(`var __dirname = ${JSON.stringify(args.sourceDir)};`);
        }
    }
    if (args.needFilename && !args.filenameDeclared) {
        if (args.kind === 'esm-zip') {
            lines.push(`var __filename = new URL(import.meta.url).pathname;`);
        } else if (args.kind === 'esm-relative') {
            lines.push(`var __filename = new URL(${JSON.stringify(args.relPath)}, import.meta.url).pathname;`);
        } else {
            lines.push(`var __filename = ${JSON.stringify(args.sourcePath)};`);
        }
    }
    return lines;
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
 *
 * Pipeline:
 *   1. inline static FS reads (build-time evaluation of `readFileSync(new
 *      URL(<lit>, import.meta.url), "utf8")` and friends)
 *   2. classify the remaining import.meta.url / __dirname / __filename uses
 *      and inject a per-file preamble
 *   3. rewrite import.meta.url tokens (only in the regular esm-relative case;
 *      zip-resident files keep their bare import.meta.url)
 */
export function rewriteContents(
    args: { path: string },
    srcInput: string,
    bundleDir: string,
): OnLoadResult | undefined {
    if (!shouldRewrite(args.path)) return undefined;

    // Step 1: inline statically-resolvable filesystem reads. These become
    // literal contents in the bundle — self-contained, no runtime FS access
    // needed. Calls that can't be statically resolved fall through to the
    // legacy import.meta.url rewrite in step 3.
    const inlined = inlineStaticReads(srcInput, args.path);
    const src = inlined.contents;

    const hasMetaUrl = src.includes('import.meta.url');
    const hasDirname = src.includes('__dirname');
    const hasFilename = src.includes('__filename');

    // Nothing left to rewrite after step 1: either return the inlined source
    // (so esbuild sees the new contents) or skip entirely.
    if (!hasMetaUrl && !hasDirname && !hasFilename) {
        if (inlined.inlined === 0) return undefined;
        return {
            contents: src,
            loader: loaderForPath(args.path),
            resolveDir: dirname(args.path),
        };
    }

    // Step 2: classify the rewrite kind and build a __dirname/__filename
    // preamble that matches.
    const dir = dirname(args.path);
    const relPath = hasMetaUrl ? relative(bundleDir, args.path) : '';
    const isZipResident = hasMetaUrl && relPath.includes('.zip/');
    const kind: 'esm-relative' | 'esm-zip' | 'cjs-absolute' =
        !hasMetaUrl ? 'cjs-absolute' : isZipResident ? 'esm-zip' : 'esm-relative';

    const preamble = buildDirFilenamePreamble({
        needDirname: hasDirname,
        needFilename: hasFilename,
        dirnameDeclared: DIRNAME_DECL_RE.test(src),
        filenameDeclared: FILENAME_DECL_RE.test(src),
        kind,
        sourcePath: args.path,
        sourceDir: dir,
        relPath,
        relDirWithSlash: (relative(bundleDir, dir) || '.') + '/',
    });

    // Step 3: rewrite `import.meta.url` to a bundle-relative URL — only for
    // regular node_modules files. Zip-resident files keep the bare token so
    // it resolves at runtime to the bundle's own URL.
    let contents = src;
    if (kind === 'esm-relative') {
        const runtimeFileUrl = `new URL(${JSON.stringify(relPath)}, import.meta.url)`;
        contents = contents.replace(/\bimport\.meta\.url\b/g, `${runtimeFileUrl}.href`);
    }
    if (preamble.length > 0) contents = preamble.join('\n') + '\n' + contents;

    return { contents, loader: loaderForPath(args.path), resolveDir: dir };
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
