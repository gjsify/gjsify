import type { BuildOptions as EsbuildOptions} from 'esbuild';
import type { ConfigDataLibrary, ConfigDataTypescript } from './index.js';

export interface ConfigData {
    /** Switch on the verbose mode */
    verbose?: boolean;
    esbuild?: EsbuildOptions;
    library?: ConfigDataLibrary;
    typescript?: ConfigDataTypescript;
    /** An array of glob patterns to exclude matches and aliases */
    exclude?: string[];
    /**
     * Inject a console shim into GJS builds for clean output (no GLib prefix, ANSI colors work).
     * Only applies to GJS app builds. Default: true.
     */
    consoleShim?: boolean;
    /**
     * Comma-separated list of global identifiers to register in the bundle.
     * See CliBuildOptions for format.
     */
    globals?: string;
    /**
     * Prepend GJS shebang to output and mark executable. See CliBuildOptions.
     */
    shebang?: boolean;
    /**
     * Extra module aliases layered on top of the built-in alias map.
     * Comes from `gjsify build --alias FROM=TO`.
     */
    aliases?: Record<string, string>;
    /**
     * Global identifiers to remove from the auto-detected set before writing
     * the inject stub. Useful for false positives from dead browser-compat
     * code in npm dependencies whose polyfills require unavailable native libs.
     * Example: `["fetch", "XMLHttpRequest"]` excludes the HTTP polyfill stack.
     */
    excludeGlobals?: string[];
    /**
     * When `true`, the rewriter copies every `node_modules/<pkg>/` directory
     * it touches to `<bundleDir>/_node_modules/<safe-id>/` and rewrites the
     * `import.meta.url`-relative paths in the bundle to point at the copies.
     * The bundle plus the sibling `_node_modules/` directory is then portable
     * across machines and layouts (`gjsify dlx` cache, manual tarball
     * extracts, Yarn-PnP node-modules linker).
     *
     * Off by default. Set to `true` for distribution bundles. Local-dev
     * builds typically don't need this — the source-relative paths resolve
     * back to the live `node_modules/`, so re-runs reflect dependency edits
     * without a copy step.
     */
    extractNodeModulesAssets?: boolean;
}
