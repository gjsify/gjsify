import type { RolldownOptions, OutputOptions } from 'rolldown';
import type { ConfigDataLibrary, ConfigDataTypescript } from './index.js';

/**
 * Subset of `RolldownOptions` accepted in `.gjsifyrc.js`. Mirrors the legacy
 * `esbuild?: BuildOptions` field — a thin pass-through. The orchestrator
 * applies platform defaults on top of these, so most projects only need
 * `output.file` / `output.dir` here.
 *
 * `output` is constrained to a single `OutputOptions` object (Rolldown also
 * accepts an array for multi-output builds, but the CLI surface targets the
 * single-output use case).
 */
export type BundlerOptions = Omit<RolldownOptions, 'output'> & {
    output?: OutputOptions;
};

/**
 * Legacy `esbuild?: BuildOptions` shape — kept as a compatibility shim for
 * one minor release. Setting it logs a deprecation warning; the supported
 * subset of fields is mapped into `bundler` at config-load time.
 *
 * Drop in 0.5.0.
 */
export interface LegacyEsbuildOptions {
    outfile?: string;
    outdir?: string;
    format?: 'esm' | 'cjs' | 'iife';
    external?: string[];
    define?: Record<string, string>;
    inject?: string[];
    banner?: { js?: string };
    target?: string | string[];
    minify?: boolean;
    sourcemap?: boolean | 'inline' | 'external' | 'both';
    mainFields?: string[];
    conditions?: string[];
    platform?: 'browser' | 'node' | 'neutral';
    loader?: Record<string, string>;
}

export interface ConfigData {
    /** Switch on the verbose mode */
    verbose?: boolean;
    /**
     * Bundler-level options forwarded to Rolldown. Replaces the legacy
     * `esbuild` field. The orchestrator applies platform-specific defaults
     * on top — most projects only need to set `output.file` / `output.dir`.
     */
    bundler?: BundlerOptions;
    /**
     * @deprecated Use `bundler` instead. Will be removed in 0.5.0. The shim
     * maps the supported subset of esbuild fields into the equivalent
     * Rolldown shape and logs a deprecation warning.
     */
    esbuild?: LegacyEsbuildOptions;
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
}
