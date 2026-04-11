// Iterative multi-pass build orchestrator for `--globals auto`.
//
// Pass 1: esbuild.build() with write:false, no globals injection
//         → produces in-memory bundle, parsed by acorn for free globals
// Pass 2: esbuild.build() with detected globals injected
//         → some injected register modules pull in MORE code that
//           references additional globals (tree-shaking dependency cycle)
// Pass N: repeat until the detected set converges (typically 2–3 iterations)
//
// The fixpoint approach handles cases like @gjsify/eventsource where
// injecting `fetch/register` brings in code that uses `globalThis.Blob`
// — code that wasn't reachable in pass 1 because nothing pulled it in.

import { build, type BuildOptions } from 'esbuild';
import { gjsifyPlugin } from '../plugin.js';
import { detectFreeGlobals } from './detect-free-globals.js';
import { writeRegisterInjectFile } from './scan-globals.js';
import { GJS_GLOBALS_MAP } from '@gjsify/resolve-npm/globals-map';
import type { PluginOptions } from '../types/plugin-options.js';

const GLOBALS_MAP: Record<string, string> = GJS_GLOBALS_MAP;

/** Maximum iterations to prevent runaway loops on pathological inputs. */
const MAX_ITERATIONS = 5;

export interface AutoGlobalsResult {
    /** Global identifiers detected in the bundle */
    detected: Set<string>;
    /** Path to the generated inject stub, or undefined if no globals needed */
    injectPath: string | undefined;
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
    if (a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
}

function detectedToRegisterPaths(detected: Set<string>): Set<string> {
    const paths = new Set<string>();
    for (const name of detected) {
        const path = GLOBALS_MAP[name];
        if (path) paths.add(path);
    }
    return paths;
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
export async function detectAutoGlobals(
    esbuildUserOptions: BuildOptions,
    pluginOptions: Omit<PluginOptions, 'autoGlobalsInject'>,
    verbose?: boolean,
): Promise<AutoGlobalsResult> {
    let detected = new Set<string>();
    let currentInject: string | undefined = undefined;

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        const result = await build({
            ...esbuildUserOptions,
            write: false,
            minify: false,
            sourcemap: false,
            metafile: false,
            logLevel: 'silent',
            plugins: [
                gjsifyPlugin({
                    ...pluginOptions,
                    autoGlobalsInject: currentInject,
                } as PluginOptions),
            ],
        });

        const bundledCode = result.outputFiles?.map((f) => f.text).join('\n') ?? '';
        if (!bundledCode) {
            return { detected: new Set(), injectPath: undefined };
        }

        const newDetected = detectFreeGlobals(bundledCode);

        // Fixpoint check: if the set didn't grow, we're done.
        // (Detection is monotonic — once a global is needed, more code
        // gets pulled in by the next pass, which can only ADD requirements.)
        if (setsEqual(detected, newDetected)) {
            if (verbose) {
                const sorted = [...detected].sort();
                console.debug(
                    `[gjsify] --globals auto: converged after ${iteration - 1} iteration(s), ${detected.size} global(s)${sorted.length ? ': ' + sorted.join(', ') : ''}`,
                );
            }
            return { detected, injectPath: currentInject };
        }

        detected = newDetected;
        const registerPaths = detectedToRegisterPaths(detected);

        if (registerPaths.size === 0) {
            return { detected, injectPath: undefined };
        }

        currentInject = (await writeRegisterInjectFile(registerPaths)) ?? undefined;

        if (verbose) {
            const sorted = [...detected].sort();
            console.debug(
                `[gjsify] --globals auto: iteration ${iteration}, ${detected.size} global(s)${sorted.length ? ': ' + sorted.join(', ') : ''}`,
            );
        }
    }

    if (verbose) {
        console.debug(
            `[gjsify] --globals auto: hit max iterations (${MAX_ITERATIONS}), using last detected set`,
        );
    }
    return { detected, injectPath: currentInject };
}
