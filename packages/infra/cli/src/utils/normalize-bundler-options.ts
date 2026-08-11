// Deprecation shim: maps the legacy `esbuild?: BuildOptions` field on `.gjsifyrc.js` /
// `package.json#gjsify` into the equivalent `bundler?: RolldownOptions` shape, warning once per
// build. It was slated for removal in 0.5.0 and is still here at 0.35.0 — the warning text it
// prints still names 0.5.0, so removing the shim means fixing that string too.
//
// Also handles the top-level `bundler.define` alias, which is PERMANENT: Rolldown reads
// `transform.define`, so a user who flat-renames `esbuild: { define }` → `bundler: { define }`
// lands `define` at the top level where Rolldown silently ignores it, producing
// `ReferenceError: <TOKEN> is not defined` at GJS load time.

import type { OutputOptions } from 'rolldown';
import type { ConfigData, BundlerOptions, LegacyEsbuildOptions } from '../types/config-data.js';

let warnedOnce = false;
let warnedDefineOnce = false;

export function normalizeBundlerOptions(configData: ConfigData): BundlerOptions {
    const raw = (configData.bundler ?? {}) as BundlerOptions & { define?: Record<string, string> };

    // Rolldown reads only `transform.define`, so a top-level `define` is moved there (warning
    // once) rather than being silently ignored — see the header.
    let fromBundler: BundlerOptions = raw;
    if (
        typeof (raw as Record<string, unknown>)['define'] === 'object' &&
        (raw as Record<string, unknown>)['define'] !== null
    ) {
        if (!warnedDefineOnce) {
            warnedDefineOnce = true;
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
        console.warn(
            "[gjsify] DEPRECATION: the 'esbuild' config key is deprecated and will be removed in 0.5.0. " +
                "Rename it to 'bundler' (typed as RolldownOptions). See the migration notes in the gjsify CHANGELOG.",
        );
    }

    const fromEsbuild = legacyEsbuildToRolldown(configData.esbuild);
    // Deliberately NOT `mergeBundlerOptions`: that strips `input`/`external` from its overrides
    // arg because it assumes the ORCHESTRATOR is the override source. Here both sides are user
    // config, and `input` must survive the merge.
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

    // Discarded, handled elsewhere: `esb.inject` (surfaced at the CLI layer via input
    // expansion) and `esb.loader` (replaced by top-level `gjsify.loaders`, see ConfigData).
    return out;
}

/**
 * Shallow merge with deep-merge of `output`, `transform` and `resolve`; `overrides` wins,
 * matching `merge(target, ...sources)` from `@gjsify/rolldown-plugin-gjsify/utils/merge`. `base`
 * is the orchestrator's Rolldown-generic shape, `overrides` the user's config plus CLI flags.
 *
 * The orchestrator's `input` is authoritative because it is the post-glob-expansion value —
 * taking the user's raw glob string would re-introduce unresolved patterns into the Rolldown
 * call. Same for `external`, which the orchestrator has already concatenated with the platform
 * defaults.
 */
export function mergeBundlerOptions(base: BundlerOptions, overrides: BundlerOptions): BundlerOptions {
    // Strip the fields the orchestrator owns: the user already had their say through
    // `userExternal` / input expansion, and merging the raw values back would clobber it.
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
