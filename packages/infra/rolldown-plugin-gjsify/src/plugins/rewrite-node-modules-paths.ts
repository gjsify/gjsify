// Per-source rewriter for `node_modules` files that reference `import.meta.url`,
// `__dirname`, or `__filename`. These tokens normally point at the file's own
// on-disk location; once the file is bundled, the bundler must rewrite them so
// runtime data-file reads (a dep loading its own i18n JSON, `package.json`,
// templates, …) still resolve.
//
// Cases, each with its own strategy:
//
//   1. on-disk ESM, runtime-resolve (`import.meta.url` present, not zip-resident,
//      `format === 'esm'`)
//      → rewrite to RUNTIME resolution via the `module-resolve` shim. The shim
//        resolves the file's `<pkg>/<subpath>` from the bundle's actual location
//        at run time, so the bundle works wherever it ends up — crucially, after
//        being PUBLISHED in an npm package (where it sits at a different
//        `node_modules` depth than at build time). See module-resolve.ts. Relies
//        on the bundle-URL banner (bundle-url-banner.ts) having captured the
//        anchor, hence the `runtimeResolve` gate.
//
//   2. on-disk ESM, legacy (same, but a non-ESM output format where the banner
//      can't run)
//      → the original behavior: rewrite to a path relative to the bundle's BUILD
//        location. Correct only while bundle ↔ node_modules keep their build-time
//        arrangement; preserved unchanged for the rare `--format iife|cjs` app
//        build that can't host the `import.meta.url` anchor banner.
//
//   3. PnP zip-resident (`import.meta.url`, path inside a `.zip/`)
//      → the file lives inside a Yarn-PnP zip; `import.meta.url` stays the
//        bundle's own URL and `__dirname`/`__filename` derive from it.
//
//   4. CJS (`__dirname`/`__filename` only, no `import.meta.url`)
//      → declare them from the file's absolute build path. NOTE: still
//        build-location-coupled and shares the "breaks when published" class of
//        bug case (1) fixes; injecting an ESM import into a CJS module is unsafe,
//        so a CJS-safe runtime-resolve is tracked as a follow-up. ESM deps (the
//        common data-reader shape, e.g. typedoc) take path (1).
//
// Hosting: a Rolldown `transform(code, id)` hook with `order: 'post'` — runs
// after deepkit/blueprint/css pre-transforms but still during module loading,
// before chunking.

import { dirname, join, relative, resolve } from 'node:path';
import type { Plugin } from 'rolldown';

import { inlineStaticReads } from '../utils/inline-static-reads.js';

export const REWRITE_FILTER = /\.(m?js|cjs|[cm]?tsx?)$/;
const DIRNAME_DECL_RE = /(?:var|let|const)\s+__dirname\b|export\s+(?:var|let|const)\s+__dirname\b/;
const FILENAME_DECL_RE = /(?:var|let|const)\s+__filename\b|export\s+(?:var|let|const)\s+__filename\b/;

// Bare specifier of the runtime module-path resolver shim (see module-resolve.ts).
// No `.js` — must match the package's `exports` subpath key (exports maps are
// exact-match), mirroring the `./shims/console-gjs` convention.
const MODULE_RESOLVE_SHIM = '@gjsify/rolldown-plugin-gjsify/shims/module-resolve';

// Our own shims (module-resolve, console-gjs) get bundled into user output, so
// they live in `node_modules/@gjsify/rolldown-plugin-gjsify/{lib,src}/shims/`
// when consumed — but they must NEVER be rewritten. In particular the
// module-resolve shim DECLARES `__gjsifyModule*` and its comments mention
// `import.meta.url`; the naive token check below would otherwise treat that as
// a rewrite target and prepend a self-import that collides with its exports.
const GJSIFY_SHIM_RE = /[\\/]rolldown-plugin-gjsify[\\/](?:lib|src)[\\/]shims[\\/]/;

/** True when the rewriter wants to look at this path — node_modules + supported ext. */
export function shouldRewrite(path: string): boolean {
    if (!path.includes('node_modules') || !REWRITE_FILTER.test(path)) return false;
    if (GJSIFY_SHIM_RE.test(path)) return false;
    return true;
}

/**
 * Compute the directory the bundle's outfile lives in (used for the zip-resident
 * check and the legacy relative paths). Both `output.file` and `output.dir` are
 * accepted.
 */
export function getBundleDirFromOutput(opts: { file?: string; dir?: string }): string {
    const outFile = opts.file ?? join(opts.dir ?? '.', 'bundle.mjs');
    return dirname(resolve(outFile));
}

/** Pick the per-file loader Rolldown should re-parse the rewritten code with. */
function moduleTypeForPath(path: string): 'ts' | 'js' {
    const ext = path.split('.').pop() ?? 'js';
    return ['ts', 'mts', 'cts', 'tsx'].includes(ext) ? 'ts' : 'js';
}

/**
 * The package-qualified spec for a node_modules file: everything after the LAST
 * `node_modules/` segment. This is what the runtime resolver feeds to
 * `createRequire(...).resolve` (via the package root).
 *
 *   ".../node_modules/typedoc/dist/lib/app.js"   → "typedoc/dist/lib/app.js"
 *   ".../node_modules/@scope/name/sub.js"        → "@scope/name/sub.js"
 *   ".../node_modules/a/node_modules/b/file.js"  → "b/file.js"
 */
export function extractPackageSpec(path: string): string {
    const marker = 'node_modules/';
    const idx = path.lastIndexOf(marker);
    return idx < 0 ? path : path.slice(idx + marker.length);
}

export interface RewriteResult {
    code: string;
    moduleType?: 'ts' | 'js';
    map?: null;
}

interface TokenFlags {
    hasMetaUrl: boolean;
    hasDirname: boolean;
    hasFilename: boolean;
}

/** Whether the file needs a `var __dirname`/`__filename` declaration injected. */
function needsDirnameDecl(src: string, flags: TokenFlags): boolean {
    return flags.hasDirname && !DIRNAME_DECL_RE.test(src);
}
function needsFilenameDecl(src: string, flags: TokenFlags): boolean {
    return flags.hasFilename && !FILENAME_DECL_RE.test(src);
}

/** Prepend preamble + (optional) shim import to the source. */
function withPreamble(src: string, lines: string[], importHeader?: string): string {
    const parts = importHeader ? [importHeader, ...lines, src] : [...lines, src];
    return parts.join('\n');
}

/**
 * Case 1 — on-disk ESM, runtime-resolve. Rewrite the file to resolve its own
 * location at runtime via the module-resolve shim — location-independent, so it
 * survives being published/relocated. The fix for the "works in the workspace,
 * crashes once installed" class of bug.
 */
function rewriteOnDiskEsm(src: string, path: string, flags: TokenFlags): RewriteResult {
    const spec = JSON.stringify(extractPackageSpec(path));

    // Collect only the named imports we actually use — tree-shaking has nothing
    // to prune and the import line stays honest.
    const used = ['__gjsifyModuleUrl'];
    const preamble: string[] = [];
    if (needsDirnameDecl(src, flags)) {
        preamble.push(`var __dirname = __gjsifyModuleDir(${spec});`);
        used.push('__gjsifyModuleDir');
    }
    if (needsFilenameDecl(src, flags)) {
        preamble.push(`var __filename = __gjsifyModuleFile(${spec});`);
        used.push('__gjsifyModuleFile');
    }

    const code = src.replace(/\bimport\.meta\.url\b/g, `__gjsifyModuleUrl(${spec})`);
    const header = `import { ${used.join(', ')} } from ${JSON.stringify(MODULE_RESOLVE_SHIM)};`;
    return { code: withPreamble(code, preamble, header), moduleType: moduleTypeForPath(path) };
}

/**
 * Case 2 — on-disk ESM, legacy. Original build-relative behavior, kept for the
 * rare non-ESM output format that can't host the bundle-URL anchor banner.
 */
function rewriteOnDiskEsmLegacy(src: string, path: string, bundleDir: string, flags: TokenFlags): RewriteResult {
    const relPath = relative(bundleDir, path);
    const relDirWithSlash = (relative(bundleDir, dirname(path)) || '.') + '/';

    const preamble: string[] = [];
    if (needsDirnameDecl(src, flags)) {
        preamble.push(
            `var __dirname = new URL(${JSON.stringify(relDirWithSlash)}, import.meta.url).pathname.replace(/\\/$/, "");`,
        );
    }
    if (needsFilenameDecl(src, flags)) {
        preamble.push(`var __filename = new URL(${JSON.stringify(relPath)}, import.meta.url).pathname;`);
    }

    const code = src.replace(/\bimport\.meta\.url\b/g, `new URL(${JSON.stringify(relPath)}, import.meta.url).href`);
    return { code: withPreamble(code, preamble), moduleType: moduleTypeForPath(path) };
}

/**
 * Case 3 — PnP zip-resident. Keep `import.meta.url` as the bundle's own URL and
 * derive `__dirname`/`__filename` from it.
 */
function rewriteZipResident(src: string, path: string, flags: TokenFlags): RewriteResult {
    const preamble: string[] = [];
    if (needsDirnameDecl(src, flags)) {
        preamble.push(`var __dirname = new URL(".", import.meta.url).pathname.replace(/\\/$/, "");`);
    }
    if (needsFilenameDecl(src, flags)) {
        preamble.push(`var __filename = new URL(import.meta.url).pathname;`);
    }
    return { code: withPreamble(src, preamble), moduleType: moduleTypeForPath(path) };
}

/**
 * Case 4 — CJS (no `import.meta.url`). Declare `__dirname`/`__filename` from the
 * absolute build path. Build-location-coupled — see file header note.
 */
function rewriteCjsAbsolute(src: string, path: string, flags: TokenFlags): RewriteResult {
    const preamble: string[] = [];
    if (needsDirnameDecl(src, flags)) {
        preamble.push(`var __dirname = ${JSON.stringify(dirname(path))};`);
    }
    if (needsFilenameDecl(src, flags)) {
        preamble.push(`var __filename = ${JSON.stringify(path)};`);
    }
    return { code: withPreamble(src, preamble), moduleType: moduleTypeForPath(path) };
}

/**
 * Pure rewriter. Returns the rewritten code (and module type for re-parsing) or
 * `null` if the file references none of the patterns we care about.
 *
 * @param runtimeResolve  When true (ESM output, banner present), on-disk ESM
 *   files resolve their location at runtime (case 1). When false, they fall back
 *   to the legacy build-relative rewrite (case 2).
 */
export function rewriteContents(
    args: { path: string },
    srcInput: string,
    bundleDir: string,
    runtimeResolve: boolean,
): RewriteResult | null {
    if (!shouldRewrite(args.path)) return null;

    // Step 1: inline statically-resolvable filesystem reads.
    const inlined = inlineStaticReads(srcInput, args.path);
    const src = inlined.contents;

    const flags: TokenFlags = {
        hasMetaUrl: src.includes('import.meta.url'),
        hasDirname: src.includes('__dirname'),
        hasFilename: src.includes('__filename'),
    };

    if (!flags.hasMetaUrl && !flags.hasDirname && !flags.hasFilename) {
        // No tokens to rewrite — emit only if inlining changed something.
        return inlined.inlined > 0 ? { code: src, moduleType: moduleTypeForPath(args.path) } : null;
    }

    // Step 2: dispatch by case (see file header).
    if (flags.hasMetaUrl) {
        if (relative(bundleDir, args.path).includes('.zip/')) {
            return rewriteZipResident(src, args.path, flags);
        }
        return runtimeResolve
            ? rewriteOnDiskEsm(src, args.path, flags)
            : rewriteOnDiskEsmLegacy(src, args.path, bundleDir, flags);
    }
    return rewriteCjsAbsolute(src, args.path, flags);
}

export interface NodeModulesPathRewriteOptions {
    /** Bundle output directory, derived from `output.file` / `output.dir`. */
    bundleDir: string;
    /**
     * Use runtime resolution for on-disk ESM files (case 1). Requires the
     * bundle-URL banner — set by the orchestrator only for `format === 'esm'`.
     * Defaults to false (legacy build-relative behavior).
     */
    runtimeResolve?: boolean;
}

/**
 * Build a Rolldown plugin that runs the path rewriter as a `transform(code, id)`
 * hook with `order: 'post'`.
 */
export function nodeModulesPathRewritePlugin(options: NodeModulesPathRewriteOptions): Plugin {
    const runtimeResolve = options.runtimeResolve ?? false;
    return {
        name: 'gjsify-node-modules-path-rewrite',
        transform: {
            order: 'post' as const,
            filter: { id: REWRITE_FILTER },
            handler(code: string, id: string) {
                if (!id.includes('node_modules')) return null;
                const result = rewriteContents({ path: id }, code, options.bundleDir, runtimeResolve);
                if (!result) return null;
                return { code: result.code, map: null };
            },
        },
    };
}
