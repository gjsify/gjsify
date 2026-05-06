import type { OnLoadResult, PluginBuild } from 'esbuild';
export declare const REWRITE_FILTER: RegExp;
/** True when the rewriter wants to look at this path — node_modules + supported ext. */
export declare function shouldRewrite(path: string): boolean;
/** Compute the directory where the build's outfile/outdir lives. */
export declare function getBundleDir(build: PluginBuild): string;
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
export declare function rewriteContents(args: {
    path: string;
}, srcInput: string, bundleDir: string): OnLoadResult | undefined;
export declare function registerNodeModulesPathRewrite(build: PluginBuild): void;
