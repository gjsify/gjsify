// One-release deprecation shim: maps the legacy `esbuild?: BuildOptions`
// field on `.gjsifyrc.js` / `package.json#gjsify` into the equivalent
// `bundler?: RolldownOptions` shape. Logs a single warning per build.
//
// Also handles the top-level `bundler.define` alias: Rolldown reads
// `transform.define`, not a top-level `define`. A user who flat-renames
// `esbuild: { define: {...} }` → `bundler: { define: {...} }` puts `define`
// at the top level where Rolldown silently ignores it, causing
// `ReferenceError: <TOKEN> is not defined` at GJS load time. We auto-map
// top-level `bundler.define` into `bundler.transform.define` and emit a
// one-time warning so the user can correct their config.
//
// Drop `esbuild` shim in 0.5.0; the `bundler.define` alias is permanent.

import type { OutputOptions } from 'rolldown';
import type { ConfigData, BundlerOptions, LegacyEsbuildOptions } from '../types/config-data.js';

let warnedOnce = false;
let warnedDefineOnce = false;

export function normalizeBundlerOptions(configData: ConfigData): BundlerOptions {
    const raw = (configData.bundler ?? {}) as BundlerOptions & { define?: Record<string, string> };

    // --- Top-level bundler.define alias ------------------------------------------
    // Rolldown only reads `transform.define`; a top-level `define` key is silently
    // ignored. Detect it, warn once, and move it into `transform.define` so the
    // user's flat esbuild→bundler rename of `define` Just Works.
    let fromBundler: BundlerOptions = raw;
    if (
        typeof (raw as Record<string, unknown>)['define'] === 'object' &&
        (raw as Record<string, unknown>)['define'] !== null
    ) {
        if (!warnedDefineOnce) {
            warnedDefineOnce = true;
            // eslint-disable-next-line no-console
            console.warn(
                "[gjsify] WARNING: 'bundler.define' is not a valid Rolldown option and would be " +
                    "silently ignored — it has been auto-mapped to 'bundler.transform.define'. " +
                    "Move 'define' under 'bundler.transform.define' in your config to suppress " +
                    'this warning and avoid a ReferenceError at GJS load time.',
            );
        }
        const { define: topLevelDefine, ...rest } = raw as BundlerOptions & { define: Record<string, string> };
        fromBundler = {
            ...rest,
            transform: {
                ...rest.transform,
                define: {
                    ...topLevelDefine,
                    ...rest.transform?.define,
                },
            },
        };
    }

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
    // Plain user-config merge — we deliberately do NOT call
    // `mergeBundlerOptions` here, because that function strips `input` and
    // `external` from its overrides arg (it assumes the *orchestrator* is
    // the override source and the user the base). Here both inputs are
    // user-provided config and `input` must survive the merge.
    const out: BundlerOptions = { ...fromEsbuild, ...fromBundler };
    if (fromEsbuild.output || fromBundler.output) {
        out.output = { ...fromEsbuild.output, ...fromBundler.output };
    }
    if (fromEsbuild.transform || fromBundler.transform) {
        out.transform = { ...fromEsbuild.transform, ...fromBundler.transform };
        if (fromEsbuild.transform?.define || fromBundler.transform?.define) {
            out.transform.define = {
                ...fromEsbuild.transform?.define,
                ...fromBundler.transform?.define,
            };
        }
    }
    if (fromEsbuild.resolve || fromBundler.resolve) {
        out.resolve = { ...fromEsbuild.resolve, ...fromBundler.resolve };
    }
    return out;
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
        output.sourcemap = esb.sourcemap === 'inline' ? 'inline' : Boolean(esb.sourcemap);
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

    // Discarded (handled elsewhere):
    //   esb.inject  — esbuild's array-of-side-effect-files; surfaced at the
    //                 CLI layer instead, via input expansion.
    //   esb.loader  — replaced by top-level `gjsify.loaders` (see ConfigData);
    //                 migration: `esbuild.loader: { '.png': 'dataurl', '.glsl': 'text' }`
    //                 → `loaders: { '.png': 'dataurl', '.glsl': 'text' }`.
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
export function mergeBundlerOptions(base: BundlerOptions, overrides: BundlerOptions): BundlerOptions {
    // Strip fields the orchestrator owns authoritatively — the user has
    // already had their say via the orchestrator's `userExternal` / input
    // expansion; merging the raw values back on top would clobber the
    // post-processing.
    const { input: _ignoredInput, external: _ignoredExternal, ...overridesRest } = overrides;
    const out: BundlerOptions = { ...base, ...overridesRest };
    if (base.output || overrides.output) {
        out.output = { ...base.output, ...overrides.output };
    }
    if (base.transform || overrides.transform) {
        out.transform = { ...base.transform, ...overrides.transform };
        if (base.transform?.define || overrides.transform?.define) {
            out.transform.define = { ...base.transform?.define, ...overrides.transform?.define };
        }
    }
    if (base.resolve || overrides.resolve) {
        out.resolve = { ...base.resolve, ...overrides.resolve };
    }
    return out;
}
