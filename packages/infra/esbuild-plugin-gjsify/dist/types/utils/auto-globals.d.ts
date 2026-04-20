import { type BuildOptions } from 'esbuild';
import type { PluginOptions } from '../types/plugin-options.js';
export interface AutoGlobalsResult {
    /** Global identifiers detected in the bundle */
    detected: Set<string>;
    /** Path to the generated inject stub, or undefined if no globals needed */
    injectPath: string | undefined;
}
export interface DetectAutoGlobalsOptions {
    /**
     * Extra explicit identifiers (or group aliases like `dom`/`web`/`node`)
     * that should always be injected, in addition to whatever the iterative
     * detection finds. Used by `--globals auto,<extras>` for cases where
     * the detector cannot statically see a global because it's accessed via
     * indirection (e.g. Excalibur's `BrowserComponent.nativeComponent.matchMedia`).
     */
    extraGlobalsList?: string;
}
/**
 * Run an iterative esbuild build (in-memory) with acorn-based global
 * detection. Each pass uses the globals discovered by the previous pass,
 * stopping once the detected set is stable (fixpoint reached).
 *
 * Returns the inject stub path that the caller should pass to the
 * final (real) build via `pluginOptions.autoGlobalsInject`.
 *
 * We deliberately do NOT minify the analysis builds: minification can
 * wrap the bundle in an IIFE and alias `globalThis` to a short variable
 * (e.g. `g.Blob` instead of `globalThis.Blob`), defeating the
 * MemberExpression detection in detect-free-globals.ts.
 */
export declare function detectAutoGlobals(esbuildUserOptions: BuildOptions, pluginOptions: Omit<PluginOptions, 'autoGlobalsInject'>, verbose?: boolean, options?: DetectAutoGlobalsOptions): Promise<AutoGlobalsResult>;
