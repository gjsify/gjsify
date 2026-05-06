// One-release deprecation shim: maps the legacy `esbuild?: BuildOptions`
// field on `.gjsifyrc.js` / `package.json#gjsify` into the equivalent
// `bundler?: RolldownOptions` shape. Logs a single warning per build.
//
// Drop in 0.5.0.

import type { OutputOptions } from 'rolldown';
import type { ConfigData, BundlerOptions, LegacyEsbuildOptions } from '../types/config-data.js';

let warnedOnce = false;

export function normalizeBundlerOptions(configData: ConfigData): BundlerOptions {
    const fromBundler: BundlerOptions = (configData.bundler ?? {}) as BundlerOptions;
    if (!configData.esbuild) return fromBundler;

    if (!warnedOnce) {
        warnedOnce = true;
        // eslint-disable-next-line no-console
        console.warn(
            "[gjsify] DEPRECATION: the 'esbuild' config key is deprecated and will be removed in 0.5.0. " +
                "Rename it to 'bundler' (typed as RolldownOptions). See the migration notes in the gjsify CHANGELOG.",
        );
    }

    const fromEsbuild = legacyEsbuildToRolldown(configData.esbuild);
    return mergeBundlerOptions(fromEsbuild, fromBundler);
}

/** Map the supported subset of esbuild BuildOptions into RolldownOptions. */
function legacyEsbuildToRolldown(esb: LegacyEsbuildOptions): BundlerOptions {
    const out: BundlerOptions = {};
    const output: OutputOptions = {};
    const transform: NonNullable<BundlerOptions['transform']> = {};
    const resolve: NonNullable<BundlerOptions['resolve']> = {};

    if (esb.outfile !== undefined) output.file = esb.outfile;
    if (esb.outdir !== undefined) output.dir = esb.outdir;
    if (esb.format !== undefined) output.format = esb.format;
    if (esb.minify !== undefined) output.minify = esb.minify;
    if (esb.sourcemap !== undefined) {
        // esbuild has 'external' / 'both' which Rolldown doesn't — coerce to boolean.
        output.sourcemap =
            esb.sourcemap === 'inline'
                ? 'inline'
                : Boolean(esb.sourcemap);
    }
    if (esb.banner?.js !== undefined) output.banner = esb.banner.js;

    if (esb.target !== undefined) {
        transform.target = Array.isArray(esb.target) ? esb.target.join(',') : esb.target;
    }
    if (esb.define !== undefined) transform.define = esb.define;

    if (esb.mainFields !== undefined) resolve.mainFields = esb.mainFields;
    if (esb.conditions !== undefined) resolve.conditionNames = esb.conditions;

    if (esb.external !== undefined) out.external = esb.external;
    if (esb.platform !== undefined) out.platform = esb.platform;

    if (Object.keys(output).length > 0) out.output = output;
    if (Object.keys(transform).length > 0) out.transform = transform;
    if (Object.keys(resolve).length > 0) out.resolve = resolve;

    // Discarded silently:
    //   esb.inject  — esbuild's array-of-side-effect-files; surfaced at the
    //                 CLI layer instead, via input expansion.
    //   esb.loader  — Rolldown infers module types from extensions natively.
    return out;
}

/**
 * Shallow merge with deep-merge of `output`, `transform`, and `resolve`. The
 * second argument wins on conflicts, matching `merge(target, ...sources)`
 * semantics from `@gjsify/rolldown-plugin-gjsify/utils/merge`.
 *
 * `base` is typically the Rolldown-generic shape returned by the orchestrator;
 * `overrides` is the user's `BundlerOptions` from `.gjsifyrc.js` plus CLI
 * flag merges. Single-output assumption matches `BundlerOptions['output']`.
 *
 * The orchestrator-side `input` is authoritative — it's the post-glob-expansion
 * value. Overriding it with the user's raw glob string would re-introduce
 * unresolved glob patterns into the final Rolldown call. Same for `external`,
 * which the orchestrator concatenates with platform defaults already.
 */
export function mergeBundlerOptions(
    base: BundlerOptions,
    overrides: BundlerOptions,
): BundlerOptions {
    // Strip fields the orchestrator owns authoritatively — the user has
    // already had their say via the orchestrator's `userExternal` / input
    // expansion; merging the raw values back on top would clobber the
    // post-processing.
    const { input: _ignoredInput, external: _ignoredExternal, ...overridesRest } = overrides;
    const out: BundlerOptions = { ...base, ...overridesRest };
    if (base.output || overrides.output) {
        out.output = { ...(base.output ?? {}), ...(overrides.output ?? {}) };
    }
    if (base.transform || overrides.transform) {
        out.transform = { ...(base.transform ?? {}), ...(overrides.transform ?? {}) };
        if (base.transform?.define || overrides.transform?.define) {
            out.transform.define = { ...(base.transform?.define ?? {}), ...(overrides.transform?.define ?? {}) };
        }
    }
    if (base.resolve || overrides.resolve) {
        out.resolve = { ...(base.resolve ?? {}), ...(overrides.resolve ?? {}) };
    }
    return out;
}
