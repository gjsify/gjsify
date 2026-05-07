// Per-source rewriter for node_modules files that reference
// `import.meta.url`, `__dirname`, or `__filename`. Mirrors the esbuild
// predecessor's logic — body is identical because the rewrite is purely
// a string transform on already-loaded source. The only delta is the
// host: a Rolldown `transform(code, id)` plugin instead of an esbuild
// `onLoad` registered inside the PnP plugin.
//
// Why a separate plugin and not nested in the PnP loader, like esbuild?
// Rolldown / Rollup's `transform` hooks all run in sequence on every
// loaded module — there is no first-onLoad-wins race. So the PnP loader
// (`@gjsify/rolldown-plugin-pnp`) is solely responsible for reading
// zip-resident bytes; this plugin runs as a separate `transform` step
// after the bytes have been loaded, regardless of which loader produced
// them. No more F5-bug folklore.

import { dirname, join, relative, resolve } from 'node:path';
import type { Plugin } from 'rolldown';

import { inlineStaticReads } from '../utils/inline-static-reads.js';

export const REWRITE_FILTER = /\.(m?js|cjs|[cm]?tsx?)$/;
const DIRNAME_DECL_RE = /(?:var|let|const)\s+__dirname\b|export\s+(?:var|let|const)\s+__dirname\b/;
const FILENAME_DECL_RE = /(?:var|let|const)\s+__filename\b|export\s+(?:var|let|const)\s+__filename\b/;

/** True when the rewriter wants to look at this path — node_modules + supported ext. */
export function shouldRewrite(path: string): boolean {
    return path.includes('node_modules') && REWRITE_FILTER.test(path);
}

/**
 * Compute the directory the bundle's outfile lives in.
 *
 * For `import.meta.url` rewriting we emit a relative URL whose base is the
 * bundle's `import.meta.url` — so we need to know where the bundle will be
 * written. Both `output.file` and `output.dir` are accepted.
 */
export function getBundleDirFromOutput(opts: { file?: string; dir?: string }): string {
    const outFile = opts.file ?? join(opts.dir ?? '.', 'bundle.mjs');
    return dirname(resolve(outFile));
}

/** Pick the per-file loader Rolldown should re-parse with. */
function moduleTypeForPath(path: string): 'ts' | 'js' {
    const ext = path.split('.').pop() ?? 'js';
    return ['ts', 'mts', 'cts', 'tsx'].includes(ext) ? 'ts' : 'js';
}

interface PreambleArgs {
    needDirname: boolean;
    needFilename: boolean;
    dirnameDeclared: boolean;
    filenameDeclared: boolean;
    /** kind of rewrite: 'esm-relative' | 'esm-zip' | 'cjs-absolute' */
    kind: 'esm-relative' | 'esm-zip' | 'cjs-absolute';
    sourcePath: string;
    sourceDir: string;
    relDirWithSlash: string;
    relPath: string;
}

function buildDirFilenamePreamble(args: PreambleArgs): string[] {
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

export interface RewriteResult {
    code: string;
    moduleType?: 'ts' | 'js';
    map?: null;
}

/**
 * Pure rewriter — same body as the esbuild predecessor. Returns the rewritten
 * code (and module type for re-parsing) or `null` if the file doesn't reference
 * any of the patterns we care about.
 */
export function rewriteContents(
    args: { path: string },
    srcInput: string,
    bundleDir: string,
): RewriteResult | null {
    if (!shouldRewrite(args.path)) return null;

    // Step 1: inline statically-resolvable filesystem reads.
    const inlined = inlineStaticReads(srcInput, args.path);
    const src = inlined.contents;

    const hasMetaUrl = src.includes('import.meta.url');
    const hasDirname = src.includes('__dirname');
    const hasFilename = src.includes('__filename');

    if (!hasMetaUrl && !hasDirname && !hasFilename) {
        if (inlined.inlined === 0) return null;
        return { code: src, moduleType: moduleTypeForPath(args.path) };
    }

    // Step 2: classify rewrite kind.
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

    // Step 3: rewrite import.meta.url for the regular esm-relative case.
    let code = src;
    if (kind === 'esm-relative') {
        const runtimeFileUrl = `new URL(${JSON.stringify(relPath)}, import.meta.url)`;
        code = code.replace(/\bimport\.meta\.url\b/g, `${runtimeFileUrl}.href`);
    }
    if (preamble.length > 0) code = preamble.join('\n') + '\n' + code;

    return { code, moduleType: moduleTypeForPath(args.path) };
}

export interface NodeModulesPathRewriteOptions {
    /** Bundle output directory, derived from `output.file` / `output.dir`. */
    bundleDir: string;
}

/**
 * Build a Rolldown plugin that runs the path rewriter as a `transform(code, id)`
 * hook with `order: 'post'` — runs after the deepkit/blueprint/css pre-transforms
 * but still during module loading, before chunking.
 */
export function nodeModulesPathRewritePlugin(options: NodeModulesPathRewriteOptions): Plugin {
    return {
        name: 'gjsify-node-modules-path-rewrite',
        transform: {
            order: 'post' as const,
            filter: { id: REWRITE_FILTER },
            handler(code: string, id: string) {
                if (!id.includes('node_modules')) return null;
                const result = rewriteContents({ path: id }, code, options.bundleDir);
                if (!result) return null;
                return { code: result.code, map: null };
            },
        },
    };
}
