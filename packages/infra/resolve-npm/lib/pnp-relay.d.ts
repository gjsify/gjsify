import type { Plugin, PluginBuild, OnLoadResult } from 'esbuild';

export type TransformContents = (
    args: { path: string; namespace?: string },
    contents: string,
) => Promise<OnLoadResult | undefined> | OnLoadResult | undefined;

export interface GetPnpPluginOptions {
    /**
     * Called once per esbuild `setup(build)` invocation. Returns the actual
     * per-file transformer that runs after the file is read but before
     * returning to esbuild. The factory pattern gives the transformer access
     * to `build.initialOptions` (e.g. for computing bundle-relative paths)
     * which isn't available at plugin-construction time.
     */
    transformContentsFactory?: (build: PluginBuild) => TransformContents;

    /**
     * `import.meta.url` of the caller. Used to anchor relay issuer resolution
     * on the caller's installation rather than `@gjsify/resolve-npm`'s.
     * Defaults to this module's own URL.
     */
    issuerUrl?: string;
}

/**
 * Build the gjsify-flavoured PnP plugin.
 *
 * Returns null when not running under Yarn PnP (no `.pnp.cjs` ancestor of cwd
 * or `@yarnpkg/esbuild-plugin-pnp` not installed).
 */
export function getPnpPlugin(opts?: GetPnpPluginOptions): Promise<Plugin | null>;
