import { dirname, join, relative, resolve, sep } from 'node:path';
import { readFile, cp, mkdir } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';

import type { OnLoadArgs, OnLoadResult, PluginBuild } from 'esbuild';

// Rewrite node_modules files that use:
//   - import.meta.url  (ESM packages that locate their own resources via FS path)
//   - __dirname / __filename  (CJS packages; esbuild platform:'neutral' omits them,
//                              and the Node ESM target doesn't auto-shim them either)
//
// Two emission modes for the rewritten URL — picked per build via the
// `assetRegistry` argument:
//
//   1. Source-relative (default, registry undefined). Preserves the legacy
//      behaviour: `new URL("../../node_modules/foo/x.js", import.meta.url)`.
//      Stable when the bundle is consumed from the same on-disk layout it
//      was built from. Fails when shipped through `gjsify dlx`, npm tarballs
//      that get extracted into a different layout, or Yarn-PnP zip caches.
//
//   2. Asset-extracted (registry defined). For every node_modules file whose
//      bytes we touched, emit a URL pointing at a co-located asset path:
//        `new URL("./_node_modules/<safe-id>/<rel-from-pkg-root>", import.meta.url)`
//      and register the package root for `build.onEnd` to copy into
//      `<bundleDir>/_node_modules/<safe-id>/`. The bundle plus the sibling
//      `_node_modules/` directory is then portable to any layout.
//
// CJS path (no `import.meta.url`): inject `__dirname`/`__filename` as absolute
// string literals.  Do NOT introduce `import.meta.url` here — esbuild would
// treat the module as ESM, conflicting with `module.exports`/`require`
// (typescript.js triggered this).
//
// Self-declarations are detected and skipped: some ESM packages declare
// `var __dirname = dirname(fileURLToPath(import.meta.url))` themselves;
// injecting a second declaration causes a duplicate-binding error.

export const REWRITE_FILTER = /\.(m?js|cjs|[cm]?tsx?)$/;
const DIRNAME_DECL_RE = /(?:var|let|const)\s+__dirname\b|export\s+(?:var|let|const)\s+__dirname\b/;
const FILENAME_DECL_RE = /(?:var|let|const)\s+__filename\b|export\s+(?:var|let|const)\s+__filename\b/;

// Module-scope flag: emit the PnP-zip-path runtime-portability warning at
// most once per build, otherwise every transitive file inside the same zip
// floods the terminal.
let zipPathWarningEmitted = false;

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
 * Tracks `(pkgRoot → safeId)` pairs to copy at `build.onEnd`. One registry
 * lives per build; pass it through to every `rewriteContents` call to opt
 * into asset-extracted URL rewriting.
 */
export interface AssetRegistry {
    /**
     * Register that `pkgRoot` (an absolute path to a node_modules package
     * directory containing a `package.json`) should be copied to
     * `<bundleDir>/_node_modules/<safeId>/` at the end of the build.
     * Idempotent — same `pkgRoot` adds at most one entry.
     */
    register(pkgRoot: string): { safeId: string };
    /** Iterate registered packages. */
    entries(): IterableIterator<[string, string]>;
}

/**
 * Per-build registry, keyed by the esbuild `PluginBuild` instance. Lets
 * multiple call-sites in the same build (the file-namespace rewriter, the
 * pnp-relay's `transformContents`, …) write into one shared registry so the
 * single `build.onEnd` copy hook sees every package.
 */
const buildRegistries = new WeakMap<PluginBuild, AssetRegistry>();

/**
 * Get or create the shared `AssetRegistry` for this build. Returns
 * `undefined` when asset extraction is opt-out (`extractAssets: false` /
 * not set on any caller). Subsequent calls with `extractAssets: true`
 * yield the same registry instance for the same build.
 */
export function getOrCreateAssetRegistry(
    build: PluginBuild,
    options: { extractAssets?: boolean } = {},
): AssetRegistry | undefined {
    if (!options.extractAssets) return buildRegistries.get(build);
    let registry = buildRegistries.get(build);
    if (!registry) {
        registry = createAssetRegistry();
        buildRegistries.set(build, registry);
    }
    return registry;
}

export function createAssetRegistry(): AssetRegistry {
    // pkgRoot → safeId. Insertion order = registration order. Detected
    // collisions on safeId (different versions of same name) get a -<n> suffix.
    const map = new Map<string, string>();
    const usedIds = new Set<string>();
    return {
        register(pkgRoot: string) {
            const cached = map.get(pkgRoot);
            if (cached !== undefined) return { safeId: cached };
            const baseName = readPackageName(pkgRoot) ?? pkgRoot.split(sep).filter(Boolean).pop() ?? 'pkg';
            // Replace `/` (scoped names) and any unsafe filesystem chars with `-`.
            const baseSafe = baseName.replace(/[^a-zA-Z0-9._-]/g, '-').replace(/^-+|-+$/g, '') || 'pkg';
            let safeId = baseSafe;
            let suffix = 2;
            while (usedIds.has(safeId)) {
                safeId = `${baseSafe}-${suffix++}`;
            }
            map.set(pkgRoot, safeId);
            usedIds.add(safeId);
            return { safeId };
        },
        entries() {
            return map.entries();
        },
    };
}

/**
 * Walk up from `filePath` looking for the nearest `package.json`, stopping at
 * the deepest `node_modules/` ancestor (so `node_modules/foo/dist/x.js`
 * resolves to `node_modules/foo`, not the workspace root).
 *
 * Returns `undefined` for paths whose nearest package.json sits *outside*
 * any `node_modules/` directory — caller treats those as "not extractable".
 */
export function findNodeModulesPackageRoot(filePath: string): string | undefined {
    const norm = filePath.replace(/\\/g, '/');
    const lastNm = norm.lastIndexOf('/node_modules/');
    if (lastNm < 0) return undefined;
    const afterNm = norm.slice(lastNm + '/node_modules/'.length);
    const segments = afterNm.split('/');
    if (segments.length === 0) return undefined;
    // Scoped: `@scope/name/...` → take 2 segments. Unscoped: 1.
    const head = segments[0];
    const pkgSegs = head.startsWith('@') ? segments.slice(0, 2) : segments.slice(0, 1);
    if (head.startsWith('@') && segments.length < 2) return undefined;
    const pkgRoot = norm.slice(0, lastNm + '/node_modules/'.length) + pkgSegs.join('/');
    // Require a package.json at that location; otherwise we don't know the
    // boundaries of the package and can't safely extract.
    if (!existsSync(join(pkgRoot, 'package.json'))) return undefined;
    return pkgRoot;
}

function readPackageName(pkgRoot: string): string | undefined {
    try {
        const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf8'));
        if (typeof pkg?.name === 'string' && pkg.name.length > 0) return pkg.name;
    } catch {
        /* ignore */
    }
    return undefined;
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
 * When `assetRegistry` is provided AND the file has a node_modules package
 * root we can locate, the URL rewrites point at a portable `_node_modules`
 * sibling instead of a relative path back to the original source — see the
 * mode comment at the top of this file.
 */
export function rewriteContents(
    args: { path: string },
    src: string,
    bundleDir: string,
    assetRegistry?: AssetRegistry,
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
        // Decide URL emission mode: asset-extracted or source-relative.
        let fileUrl: string;
        let dirUrl: string;
        let isZip = false;

        const pkgRoot = assetRegistry ? findNodeModulesPackageRoot(args.path) : undefined;
        if (assetRegistry && pkgRoot) {
            const { safeId } = assetRegistry.register(pkgRoot);
            const relFromPkg = relative(pkgRoot, args.path).replace(/\\/g, '/');
            const fileAsset = `./_node_modules/${safeId}/${relFromPkg}`;
            const dirAsset = `./_node_modules/${safeId}/${relFromPkg.split('/').slice(0, -1).join('/')}`.replace(/\/$/, '') || `./_node_modules/${safeId}`;
            fileUrl = `new URL(${JSON.stringify(fileAsset)}, import.meta.url)`;
            dirUrl  = `new URL(${JSON.stringify(dirAsset + '/')}, import.meta.url)`;
        } else {
            const relPath = relative(bundleDir, args.path);
            const relDir = relative(bundleDir, dir) || '.';
            isZip = relPath.includes('.zip/');
            if (isZip && !zipPathWarningEmitted) {
                // Asset extraction reaches into PnP zips by way of the pnp
                // plugin's onLoad (the bytes were already read for us); the
                // copy step in build.onEnd uses a real filesystem path, so
                // it cannot find the package directory inside a zip and
                // skips it. Emit the legacy warning so the user knows the
                // bundle is non-portable until they switch to nodeLinker:
                // node-modules.
                zipPathWarningEmitted = true;
                console.warn(
                    `[gjsify] rewriter: bundling code from inside a PnP virtual zip ` +
                    `(${relPath}). import.meta.url-relative paths in this file won't ` +
                    `resolve at runtime. Switch to "nodeLinker: node-modules" or unplug ` +
                    `the offending package(s) until the rewriter learns to inline zip-` +
                    `resident reads.`,
                );
            }
            fileUrl = `new URL(${JSON.stringify(relPath)}, import.meta.url)`;
            dirUrl  = `new URL(${JSON.stringify(relDir + '/')}, import.meta.url)`;
        }

        contents = contents.replace(/\bimport\.meta\.url\b/g, `${fileUrl}.href`);
        if (hasDirname && !dirnameDeclared) {
            preamble.push(`var __dirname = ${dirUrl}.pathname.replace(/\\/$/, "");`);
        }
        if (hasFilename && !filenameDeclared) {
            preamble.push(`var __filename = ${fileUrl}.pathname;`);
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

async function loadAndRewrite(
    args: OnLoadArgs,
    build: PluginBuild,
    assetRegistry: AssetRegistry | undefined,
): Promise<OnLoadResult | undefined> {
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
    return rewriteContents(args, src, getBundleDir(build), assetRegistry);
}

/**
 * Drive the asset-extraction copy phase. Runs at `build.onEnd`. For each
 * registered package root, recursively copies its on-disk contents into
 * `<bundleDir>/_node_modules/<safe-id>/`. Quietly skips packages whose root
 * does not exist on disk (e.g. PnP zip-resident packages — those are still
 * surfaced via the warning emitted by `rewriteContents`).
 */
export async function extractRegisteredAssets(
    bundleDir: string,
    registry: AssetRegistry,
): Promise<void> {
    const targets: Promise<void>[] = [];
    for (const [pkgRoot, safeId] of registry.entries()) {
        if (!existsSync(pkgRoot)) continue;
        const dest = join(bundleDir, '_node_modules', safeId);
        targets.push((async () => {
            await mkdir(dirname(dest), { recursive: true });
            // `cp` follows symlinks by default → resolves workspace symlinks
            // into a real directory copy at the destination. `force: true`
            // lets re-runs overwrite stale extraction.
            await cp(pkgRoot, dest, { recursive: true, force: true, dereference: true });
        })());
    }
    await Promise.all(targets);
}

/**
 * Wire the rewriter into the current build's "file" namespace, optionally
 * with asset extraction. Returns the registry so callers that compose the
 * rewriter into other plugins (PnP relay) can share it.
 */
export function registerNodeModulesPathRewrite(
    build: PluginBuild,
    options: { extractAssets?: boolean } = {},
): AssetRegistry | undefined {
    const registry = getOrCreateAssetRegistry(build, options);

    // Default "file" namespace covers regular node_modules + workspace files.
    // The "pnp" namespace is intentionally NOT registered here — esbuild's
    // first-matching-onLoad rule means @yarnpkg/esbuild-plugin-pnp's own
    // onLoad always wins (it's registered before this plugin to provide
    // zip-aware reads). Callers that need PnP rewriting compose
    // `rewriteContents` into the pnpPlugin's `onLoad` callback directly —
    // see `@gjsify/resolve-npm/pnp-relay`.
    build.onLoad({ filter: REWRITE_FILTER }, (args) => loadAndRewrite(args, build, registry));

    if (registry && !buildEndHooked.has(build)) {
        buildEndHooked.add(build);
        const bundleDir = getBundleDir(build);
        build.onEnd(async () => {
            await extractRegisteredAssets(bundleDir, registry);
        });
    }

    return registry;
}

/** Tracks builds that already have an `onEnd` extraction hook installed. */
const buildEndHooked = new WeakSet<PluginBuild>();
