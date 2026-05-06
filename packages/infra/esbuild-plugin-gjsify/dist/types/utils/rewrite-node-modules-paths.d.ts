import type { OnLoadResult, PluginBuild } from 'esbuild';
export declare const REWRITE_FILTER: RegExp;
/** True when the rewriter wants to look at this path — node_modules + supported ext. */
export declare function shouldRewrite(path: string): boolean;
/** Compute the directory where the build's outfile/outdir lives. */
export declare function getBundleDir(build: PluginBuild): string;
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
    register(pkgRoot: string): {
        safeId: string;
    };
    /** Iterate registered packages. */
    entries(): IterableIterator<[string, string]>;
}
/**
 * Get or create the shared `AssetRegistry` for this build. Returns
 * `undefined` when asset extraction is opt-out (`extractAssets: false` /
 * not set on any caller). Subsequent calls with `extractAssets: true`
 * yield the same registry instance for the same build.
 */
export declare function getOrCreateAssetRegistry(build: PluginBuild, options?: {
    extractAssets?: boolean;
}): AssetRegistry | undefined;
export declare function createAssetRegistry(): AssetRegistry;
/**
 * Walk up from `filePath` looking for the nearest `package.json`, stopping at
 * the deepest `node_modules/` ancestor (so `node_modules/foo/dist/x.js`
 * resolves to `node_modules/foo`, not the workspace root).
 *
 * Returns `undefined` for paths whose nearest package.json sits *outside*
 * any `node_modules/` directory — caller treats those as "not extractable".
 */
export declare function findNodeModulesPackageRoot(filePath: string): string | undefined;
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
export declare function rewriteContents(args: {
    path: string;
}, src: string, bundleDir: string, assetRegistry?: AssetRegistry): OnLoadResult | undefined;
/**
 * Drive the asset-extraction copy phase. Runs at `build.onEnd`. For each
 * registered package root, recursively copies its on-disk contents into
 * `<bundleDir>/_node_modules/<safe-id>/`. Quietly skips packages whose root
 * does not exist on disk (e.g. PnP zip-resident packages — those are still
 * surfaced via the warning emitted by `rewriteContents`).
 */
export declare function extractRegisteredAssets(bundleDir: string, registry: AssetRegistry): Promise<void>;
/**
 * Wire the rewriter into the current build's "file" namespace, optionally
 * with asset extraction. Returns the registry so callers that compose the
 * rewriter into other plugins (PnP relay) can share it.
 */
export declare function registerNodeModulesPathRewrite(build: PluginBuild, options?: {
    extractAssets?: boolean;
}): AssetRegistry | undefined;
