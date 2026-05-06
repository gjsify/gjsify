// Iterative multi-pass build orchestrator for `--globals auto`.
//
// Architecturally identical to the esbuild predecessor — only the inner
// build call swaps `esbuild.build()` for `rolldown()`. The "after
// tree-shaking" analysis property is bundler-agnostic and load-bearing
// per AGENTS.md "Tree-shakeability invariants — permanent". See the
// rationale block at the top of `detect-free-globals.ts`.
//
// Pass 1: rolldown() with no globals injection
//         → in-memory bundle parsed by acorn for free globals
// Pass 2: rolldown() with detected globals injected
//         → some injected register modules pull in MORE code that
//           references additional globals (tree-shaking dependency cycle)
// Pass N: repeat until the detected set converges (typically 2–3 iterations,
//         capped at MAX_ITERATIONS=5)
//
// We deliberately do NOT minify the analysis builds: minification can
// alias `globalThis` to a short variable and defeat MemberExpression
// detection in detect-free-globals.ts.

import { rolldown, type InputOptions, type OutputChunk, type RolldownPluginOption, type TransformOptions } from 'rolldown';
import { detectFreeGlobals } from './detect-free-globals.js';
import { resolveGlobalsList, writeRegisterInjectFile } from './scan-globals.js';
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

async function applyExcludeGlobals(
    detected: Set<string>,
    currentInject: string | undefined,
    extraRegisterPaths: Set<string>,
    excludeGlobals: string[] | undefined,
): Promise<AutoGlobalsResult> {
    if (!excludeGlobals?.length) return { detected, injectPath: currentInject };

    for (const id of excludeGlobals) detected.delete(id);
    const filtered = detectedToRegisterPaths(detected);
    for (const p of extraRegisterPaths) filtered.add(p);
    const injectPath = filtered.size > 0 ? (await writeRegisterInjectFile(filtered)) ?? undefined : undefined;
    return { detected, injectPath };
}

function detectedToRegisterPaths(detected: Set<string>): Set<string> {
    const paths = new Set<string>();
    for (const name of detected) {
        const path = GLOBALS_MAP[name];
        if (path) paths.add(path);
    }
    return paths;
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
    /**
     * Identifiers to remove from the auto-detected set before writing the
     * inject stub. Useful for globals that appear as false positives from
     * dead browser-compat code in npm dependencies whose polyfills require
     * unavailable native libraries.
     */
    excludeGlobals?: string[];
}

/**
 * Build options accepted by the analyser. A subset of Rolldown's
 * `InputOptions` plus the `output` shape used by `RolldownBuild.generate`.
 *
 * The caller passes the same input + output options it would use for the
 * final build (input, plugins, external, define, …). We strip output-side
 * fields that would force a write-to-disk and replace them with in-memory
 * settings.
 */
export interface AnalysisOptions {
    input: InputOptions['input'];
    plugins?: RolldownPluginOption[];
    external?: InputOptions['external'];
    resolve?: InputOptions['resolve'];
    /**
     * Pass-through to Rolldown's `transform` (Oxc-driven) — `define`,
     * `dropLabels`, `treeShake`, etc. live here in Rolldown's shape.
     */
    transform?: TransformOptions;
    /** Format for the analysis bundle output. Use 'esm' to match the final build. */
    format?: 'esm' | 'cjs' | 'iife';
}

/**
 * Build a `gjsifyPlugin` for the analyser to insert into the plugin array.
 * Late-imported via dynamic `await import()` to break the cyclic dep
 * between this file and `../plugin.ts`.
 */
type GjsifyPluginFactory = (
    options: PluginOptions,
) => RolldownPluginOption | Promise<RolldownPluginOption>;

/**
 * Run an iterative Rolldown build (in-memory) with acorn-based global
 * detection. Each pass uses the globals discovered by the previous pass,
 * stopping once the detected set is stable (fixpoint reached).
 *
 * Returns the inject stub path that the caller should pass to the
 * final (real) build via `pluginOptions.autoGlobalsInject`.
 *
 * @param analysisOptions Rolldown input options for the in-memory build.
 * @param pluginOptions Gjsify plugin options (without `autoGlobalsInject`,
 *   which this function computes).
 * @param gjsifyPluginFactory Factory returning the gjsify plugin instance
 *   for a given set of plugin options. Provided by the caller to avoid a
 *   cyclic import between this module and `../plugin.ts`.
 * @param verbose Emit per-iteration debug output to console.
 * @param options Optional `extraGlobalsList` / `excludeGlobals`.
 */
export async function detectAutoGlobals(
    analysisOptions: AnalysisOptions,
    pluginOptions: Omit<PluginOptions, 'autoGlobalsInject'>,
    gjsifyPluginFactory: GjsifyPluginFactory,
    verbose?: boolean,
    options: DetectAutoGlobalsOptions = {},
): Promise<AutoGlobalsResult> {
    const extraRegisterPaths = options.extraGlobalsList
        ? resolveGlobalsList(options.extraGlobalsList)
        : new Set<string>();

    const excludeSet = new Set(options.excludeGlobals ?? []);

    let detected = new Set<string>();
    let currentInject: string | undefined = undefined;

    if (extraRegisterPaths.size > 0) {
        currentInject = (await writeRegisterInjectFile(extraRegisterPaths)) ?? undefined;
    }

    // Caller-provided plugins (e.g. PnP relay) survive every pass; the
    // gjsify plugin appended last so its hooks run after any custom
    // resolvers / loaders.
    const callerPlugins = (analysisOptions.plugins ?? []).filter((p) => {
        const name = p && typeof p === 'object' && 'name' in p ? p.name : undefined;
        return name !== 'gjsify' && name !== 'gjsify-orchestrator';
    });

    for (let iteration = 1; iteration <= MAX_ITERATIONS; iteration++) {
        const gjsifyInstance = await gjsifyPluginFactory({
            ...pluginOptions,
            autoGlobalsInject: currentInject,
        } as PluginOptions);

        // The auto-globals inject stub is a side-effect-only ESM file that
        // imports `<pkg>/register/<feature>` paths. Rolldown's `transform.inject`
        // is the source-AST per-identifier rewrite we MUST NOT use (see
        // AGENTS.md "Tree-shakeability invariants"). Instead, when the
        // analyser has produced an inject path, append it as an additional
        // entry — Rolldown bundles its side effects into the output and the
        // detector sees the resulting identifier references.
        const inputWithInject = currentInject
            ? appendInjectAsEntry(analysisOptions.input, currentInject)
            : analysisOptions.input;

        const build = await rolldown({
            input: inputWithInject,
            external: analysisOptions.external,
            resolve: analysisOptions.resolve,
            transform: analysisOptions.transform,
            plugins: [...callerPlugins, gjsifyInstance],
            logLevel: 'silent',
        });

        let bundledCode = '';
        try {
            const result = await build.generate({
                format: analysisOptions.format ?? 'esm',
                minify: false,
                sourcemap: false,
            });
            bundledCode = result.output
                .filter((entry): entry is OutputChunk => entry.type === 'chunk')
                .map((chunk) => chunk.code)
                .join('\n');
        } finally {
            await build.close();
        }

        if (!bundledCode) {
            return { detected: new Set(), injectPath: currentInject };
        }

        const newDetected = detectFreeGlobals(bundledCode);

        // Apply excludeGlobals BEFORE writing the next iteration's inject file.
        // Otherwise an excluded identifier would still appear in the inject
        // import list and the analysis build itself would fail when the
        // corresponding `@gjsify/<pkg>/register/<feature>` is not in the
        // project's resolvable dep tree.
        if (excludeSet.size > 0) {
            for (const id of excludeSet) newDetected.delete(id);
        }

        // Fixpoint check: detection is monotonic — once a global is needed,
        // more code gets pulled in by the next pass, which can only ADD
        // requirements. So a set that didn't grow is a converged set.
        if (setsEqual(detected, newDetected)) {
            if (verbose) {
                const sorted = [...detected].sort();
                const extras = extraRegisterPaths.size > 0 ? ` (+ ${extraRegisterPaths.size} extra register module(s))` : '';
                console.debug(
                    `[gjsify] --globals auto: converged after ${iteration - 1} iteration(s), ${detected.size} global(s)${sorted.length ? ': ' + sorted.join(', ') : ''}${extras}`,
                );
            }
            return applyExcludeGlobals(detected, currentInject, extraRegisterPaths, options.excludeGlobals);
        }

        detected = newDetected;
        const registerPaths = detectedToRegisterPaths(detected);
        for (const p of extraRegisterPaths) registerPaths.add(p);

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
    return applyExcludeGlobals(detected, currentInject, extraRegisterPaths, options.excludeGlobals);
}

/**
 * Append an additional entry path to a Rolldown `input` value while
 * preserving its shape (string → array, array → array, record → record).
 * The new entry is given the synthetic name `__gjsify_inject` when the
 * record form is used so it doesn't collide with user-named outputs.
 */
function appendInjectAsEntry(
    input: InputOptions['input'],
    injectPath: string,
): InputOptions['input'] {
    if (input === undefined) return [injectPath];
    if (typeof input === 'string') return [input, injectPath];
    if (Array.isArray(input)) {
        return [...input, injectPath];
    }
    return { ...input, __gjsify_inject: injectPath };
}
