// Per-source rewriter for `node_modules` files that reference `import.meta.url`,
// `__dirname`, or `__filename`. These tokens normally point at the file's own
// on-disk location; once the file is bundled, the bundler must rewrite them so
// runtime data-file reads (a dep loading its own i18n JSON, `package.json`,
// templates, …) still resolve.
//
// Four cases, dispatched in `rewriteContents`; each strategy's rationale sits on its
// `rewrite*` function:
//
//   1. on-disk ESM + `runtimeResolve` → resolve at RUNTIME via the module-resolve shim
//      (location-independent, survives publishing). Needs the bundle-URL banner, hence
//      the gate.
//   2. on-disk ESM, non-ESM output (no banner) → legacy path relative to the bundle's
//      BUILD location.
//   3. PnP zip-resident → `import.meta.url` stays the bundle's own URL.
//   4. CJS (no `import.meta.url`) → 4a runtime-resolve when the banner is available AND
//      the file is a genuinely installed package, else 4b baked absolute path.
//
// Hosted as a `transform(code, id)` hook with `order: 'post'`: after the
// deepkit/blueprint/css pre-transforms, still during module loading, before chunking.

import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import type { Plugin } from 'rolldown';

import { inlineStaticReads } from '../utils/inline-static-reads.js';

export const REWRITE_FILTER = /\.(m?js|cjs|[cm]?tsx?)$/;
const DIRNAME_DECL_RE = /(?:var|let|const)\s+__dirname\b|export\s+(?:var|let|const)\s+__dirname\b/;
const FILENAME_DECL_RE = /(?:var|let|const)\s+__filename\b|export\s+(?:var|let|const)\s+__filename\b/;

// No `.js`: must match the package's `exports` subpath key, which is exact-match.
const MODULE_RESOLVE_SHIM = '@gjsify/rolldown-plugin-gjsify/shims/module-resolve';

// Our own shims are bundled into user output and so live under a `node_modules/…/shims/`
// path when consumed, but must NEVER be rewritten: the module-resolve shim DECLARES
// `__gjsifyModule*` and mentions `import.meta.url`, so the token check below would
// prepend a self-import that collides with its own exports.
const GJSIFY_SHIM_RE = /[\\/]rolldown-plugin-gjsify[\\/](?:lib|src)[\\/]shims[\\/]/;

/** True when the rewriter wants to look at this path — node_modules + supported ext. */
export function shouldRewrite(path: string): boolean {
    if (!path.includes('node_modules') || !REWRITE_FILTER.test(path)) return false;
    if (GJSIFY_SHIM_RE.test(path)) return false;
    return true;
}

/** The directory the bundle's outfile lives in, from `output.file` or `output.dir`. */
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
 * The package-qualified spec for a node_modules file — everything after the LAST
 * `node_modules/` segment, which is what the runtime resolver feeds to
 * `createRequire(...).resolve`. Always a module SPECIFIER, so always `/`-separated:
 *
 *   ".../node_modules/@scope/name/sub.js"        → "@scope/name/sub.js"
 *   ".../node_modules/a/node_modules/b/file.js"  → "b/file.js"
 *
 * The separator conversion is win32-ONLY (on POSIX a backslash is a legitimate FILENAME
 * character). Without it a win32 path never matched the `node_modules/` marker and this
 * returned the absolute BUILD-MACHINE path — which `shouldRewrite`, testing
 * `includes('node_modules')` with no separator, still let through into the bundle as
 * the runtime resolve spec. `platform` is injected so both branches are unit-testable
 * from either host.
 */
export function extractPackageSpec(path: string, platform: string = process.platform): string {
    const normalized = platform === 'win32' ? path.replaceAll('\\', '/') : path;
    const marker = 'node_modules/';
    const idx = normalized.lastIndexOf(marker);
    return idx < 0 ? normalized : normalized.slice(idx + marker.length);
}

/**
 * The bare package name of a node_modules file spec (scoped names kept whole):
 *   "typedoc/dist/lib/app.js"  → "typedoc"
 *   "@scope/name/sub/file.js"  → "@scope/name"
 */
function packageNameOf(spec: string): string {
    const parts = spec.split('/');
    const segments = spec.startsWith('@') ? 2 : 1;
    return parts.slice(0, segments).join('/');
}

/**
 * Can the runtime module-resolve shim actually resolve this file's package — is it a
 * genuinely INSTALLED package rather than a file merely living under a
 * `node_modules`-named directory?
 *
 * Case 4a resolves `__dirname`/`__filename` through the dep's package root, which only
 * works for a real installed package. A file reached by a relative import into a
 * `node_modules`-named folder outside the package manager's resolution graph (a test
 * fixture; Yarn PnP especially rejects these) would resolve to the BUNDLE's own location
 * at runtime, so those take the build-location-coupled case 4b instead.
 *
 * Probed at BUILD time via `createRequire(<file>).resolve(...)` anchored at the file, so
 * it honours node_modules walking AND Yarn PnP. Best-effort: any throw counts as not
 * resolvable rather than crashing the build.
 */
function isRuntimeResolvable(path: string): boolean {
    const pkg = packageNameOf(extractPackageSpec(path));
    if (!pkg) return false;
    try {
        createRequire(path).resolve(`${pkg}/package.json`);
        return true;
    } catch {
        try {
            // Some strict `exports` maps block `<pkg>/package.json`; the main entry is
            // always exported.
            createRequire(path).resolve(pkg);
            return true;
        } catch {
            return false;
        }
    }
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
 * Case 1 — on-disk ESM, runtime-resolve. The file resolves its own location at runtime
 * via the module-resolve shim, so it survives being published or relocated: the fix for
 * the "works in the workspace, crashes once installed" class of bug.
 */
function rewriteOnDiskEsm(src: string, path: string, flags: TokenFlags): RewriteResult {
    const spec = JSON.stringify(extractPackageSpec(path));

    // Import only what is used, so tree-shaking has nothing to prune.
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
 * Case 2 — on-disk ESM, build-relative. Only correct while bundle ↔ node_modules keep
 * their build-time arrangement; used for the non-ESM output formats that cannot host
 * the bundle-URL anchor banner.
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
 * Case 4a — CJS, runtime-resolve. `__dirname`/`__filename` come from the module-resolve
 * shim, so they point at the file's location relative to the INSTALLED bundle rather
 * than the build machine — what lets `@gjsify/tsc` find its `lib.*.d.ts` files beside
 * the shipped `typescript/lib/_tsc.js`. Mirrors `rewriteOnDiskEsm` minus the
 * `import.meta.url` rewrite (a CJS file has none).
 *
 * The shim comes in via a CJS `require(...)`, NOT an ESM `import` header: Rolldown
 * classifies a node_modules file by its own heuristics, and a genuine CommonJS file is
 * parsed as a script, where a prepended `import` throws `[PARSE_ERROR] Cannot use import
 * statement outside a module`. `require(...)` parses under either classification.
 */
function rewriteCjsRuntime(src: string, path: string, flags: TokenFlags): RewriteResult {
    const spec = JSON.stringify(extractPackageSpec(path));
    const used: string[] = [];
    const preamble: string[] = [];
    if (needsDirnameDecl(src, flags)) {
        preamble.push(`var __dirname = __gjsifyModuleDir(${spec});`);
        used.push('__gjsifyModuleDir');
    }
    if (needsFilenameDecl(src, flags)) {
        preamble.push(`var __filename = __gjsifyModuleFile(${spec});`);
        used.push('__gjsifyModuleFile');
    }
    // Nothing to declare (both tokens already locally bound) — leave untouched.
    if (used.length === 0) return { code: src, moduleType: moduleTypeForPath(path) };
    const header = `var { ${used.join(', ')} } = require(${JSON.stringify(MODULE_RESOLVE_SHIM)});`;
    return { code: withPreamble(src, preamble, header), moduleType: moduleTypeForPath(path) };
}

/**
 * Case 4b — CJS, baked absolute build path. Build-location-coupled, but correct for an
 * in-place run, and a file that is not an installed package cannot be published anyway.
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
 * Pure rewriter: the rewritten code plus the module type to re-parse it with, or `null`
 * when the file references none of the tokens.
 */
export function rewriteContents(
    args: { path: string },
    srcInput: string,
    bundleDir: string,
    runtimeResolve: boolean,
): RewriteResult | null {
    if (!shouldRewrite(args.path)) return null;

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
    // CJS (no `import.meta.url`). Runtime-resolve only when the output can host
    // the bundle-URL banner (ESM output) AND the file is a genuinely resolvable
    // installed package — otherwise the shim would resolve `__filename` to the
    // bundle's own location at runtime. A file under a `node_modules`-named dir
    // that is not actually installed (a relative-imported fixture, a non-PnP
    // path) keeps the legacy baked-absolute-path rewrite.
    return runtimeResolve && isRuntimeResolvable(args.path)
        ? rewriteCjsRuntime(src, args.path, flags)
        : rewriteCjsAbsolute(src, args.path, flags);
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
