// Two-pass build orchestrator for `--globals auto`.
//
// Pass 1: esbuild.build() with write:false + minify:true, no globals injection
//         → produces in-memory bundle
// Parse:  acorn analyses the bundle for free global identifiers
// Pass 2: caller runs the real esbuild.build() with the discovered globals
//         injected via the returned stub path

import { build, type BuildOptions } from 'esbuild';
import { gjsifyPlugin } from '../plugin.js';
import { detectFreeGlobals } from './detect-free-globals.js';
import { writeRegisterInjectFile } from './scan-globals.js';
import { GJS_GLOBALS_MAP } from '@gjsify/resolve-npm/globals-map';
import type { PluginOptions } from '../types/plugin-options.js';

const GLOBALS_MAP: Record<string, string> = GJS_GLOBALS_MAP;

export interface AutoGlobalsResult {
    /** Global identifiers detected in the bundle */
    detected: Set<string>;
    /** Path to the generated inject stub, or undefined if no globals needed */
    injectPath: string | undefined;
}

/**
 * Run a first-pass esbuild build (in-memory, minified, no globals) and
 * analyse the output for free references to known GJS globals.
 *
 * Returns the inject stub path that the caller should pass to the second
 * (real) build via `pluginOptions.autoGlobalsInject`.
 */
export async function detectAutoGlobals(
    esbuildUserOptions: BuildOptions,
    pluginOptions: Omit<PluginOptions, 'autoGlobalsInject'>,
    verbose?: boolean,
): Promise<AutoGlobalsResult> {
    // First pass: in-memory build, minified, no globals injection.
    // The full plugin pipeline (aliases, blueprint, deepkit) runs — only
    // the autoGlobalsInject option is omitted.
    const firstPassResult = await build({
        ...esbuildUserOptions,
        write: false,
        minify: true,
        sourcemap: false,
        metafile: false,
        logLevel: 'silent',
        plugins: [
            gjsifyPlugin({
                ...pluginOptions,
                autoGlobalsInject: undefined,
            } as PluginOptions),
        ],
    });

    // Concatenate all output files (typically one for app builds)
    const bundledCode = firstPassResult.outputFiles
        ?.map((f) => f.text)
        .join('\n') ?? '';

    if (!bundledCode) {
        return { detected: new Set(), injectPath: undefined };
    }

    // Analyse the bundled output for free global references
    const detected = detectFreeGlobals(bundledCode);

    if (verbose) {
        const sorted = [...detected].sort();
        console.debug(
            `[gjsify] --globals auto: detected ${detected.size} global(s)${sorted.length ? ': ' + sorted.join(', ') : ''}`,
        );
    }

    if (detected.size === 0) {
        return { detected, injectPath: undefined };
    }

    // Map detected identifiers → register paths
    const registerPaths = new Set<string>();
    for (const name of detected) {
        const path = GLOBALS_MAP[name];
        if (path) registerPaths.add(path);
    }

    const injectPath = await writeRegisterInjectFile(registerPaths) ?? undefined;

    return { detected, injectPath };
}
