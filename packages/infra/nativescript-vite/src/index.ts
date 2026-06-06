// `@gjsify/nativescript-vite` — Vite 8 / Rolldown compatibility + gjsify
// transforms for building NativeScript apps.
//
// `@nativescript/vite` (the upstream NativeScript Vite integration) does not
// build under Vite 8 / Rolldown: its config uses two constructs Rolldown
// rejects. This package COMPOSES the upstream config and fixes exactly those
// two pieces on the returned config object, then layers gjsify's NS transforms
// on top — so a NativeScript app builds under Vite 8 with `gjsify`'s stack.
//
// The two upstream incompatibilities (verified by running real builds):
//   1. Function-replacement `resolve.alias` entries (platform-`main` + tsconfig
//      wildcard + `@nativescript/core/.../index` canonicalization) →
//      `Failed to convert builtin plugin 'ViteAlias' … function replacement
//      into rust type String`. They are DROPPED — the upstream
//      `nativescript-package-resolver` plugin (a `resolveId` hook, kept) and the
//      string `~/` / `@` aliases (kept) already cover the same resolution.
//   2. The explicit `@rollup/plugin-commonjs` plugin → `Cannot read properties
//      of undefined (reading 'currentLoadingModule')`. It is DROPPED — Rolldown
//      handles CommonJS (`@nativescript/core`'s modules) natively.
//
// On top, it spreads `@gjsify/vite-plugin-gjsify`'s `gjsifyNativescript()`
// preset (gi:// → empty, platform file resolution, platform defines, the
// node-builtin alias routing incl. `module` → `@gjsify/module`).
//
// `@nativescript/vite`, `@nativescript/core`, the `nativescript` CLI, the
// optional `@nativescript/canvas*` plugins and `vite` are all OPTIONAL peer
// dependencies — installed by the consumer only when targeting NativeScript.

import { mergeConfig } from 'vite';
import type { ConfigEnv, UserConfig, Plugin, AliasOptions, Alias } from 'vite';
import { gjsifyNativescript as gjsifyNativescriptTransforms } from '@gjsify/vite-plugin-gjsify';
import type { GjsifyNativescriptOptions } from '@gjsify/vite-plugin-gjsify';

export type GjsifyNativescriptViteOptions = GjsifyNativescriptOptions;

/** A user-supplied Vite config (or config factory) merged in as the final layer. */
export type UserConfigInput = UserConfig | ((env: ConfigEnv) => UserConfig | Promise<UserConfig>);

/**
 * Build a NativeScript Vite config that works under Vite 8 / Rolldown with
 * gjsify's transforms. Use it as your app's `vite.config.ts`:
 *
 * ```ts
 * import { defineNativescriptConfig } from '@gjsify/nativescript-vite';
 * export default defineNativescriptConfig();
 * ```
 *
 * Compose your own Vite config on top (e.g. externalize a canvas/WebGL app's
 * unused `@nativescript/audio-context`) by passing a second argument — it is
 * `mergeConfig`'d in last, so it wins:
 *
 * ```ts
 * export default defineNativescriptConfig({}, {
 *   build: { rollupOptions: { external: [/@nativescript\/audio-context/] } },
 * });
 * ```
 *
 * Returns an async Vite config FUNCTION (Vite resolves the `mode` and passes it
 * through), so the upstream `@nativescript/vite` config is built for the right
 * mode before the fixes + gjsify transforms are applied.
 *
 * @param options  forwarded to `@gjsify/vite-plugin-gjsify`'s `gjsifyNativescript()` preset.
 * @param userConfig  optional final-layer Vite config (object or `(env) => config`).
 */
export function defineNativescriptConfig(
    options: GjsifyNativescriptViteOptions = {},
    userConfig?: UserConfigInput,
): (env: ConfigEnv) => Promise<UserConfig> {
    return async (env: ConfigEnv): Promise<UserConfig> => {
        const base = await loadUpstreamConfig(env);
        const fixed = applyVite8Fixes(base);
        // Layer gjsify's NS transforms (a Vite plugin array whose `config()` hook
        // supplies the gi:// → empty redirect, platform resolution, defines, and
        // node-builtin aliases) — the same composition proven to produce a
        // working Vite 8 bundle.
        const withTransforms = mergeConfig(fixed, {
            plugins: [...gjsifyNativescriptTransforms(options)] satisfies Plugin[],
        });
        if (userConfig === undefined) return withTransforms;
        const resolved = typeof userConfig === 'function' ? await userConfig(env) : userConfig;
        return mergeConfig(withTransforms, resolved);
    };
}

export default defineNativescriptConfig;

/**
 * Resolve `@nativescript/vite`'s TypeScript config factory (an optional peer).
 * Prefers the documented root entry (`@nativescript/vite`) and falls back to the
 * `./typescript` subpath that some published versions expose; throws a clear,
 * actionable error if neither resolves or the export is missing.
 */
async function loadUpstreamConfig(env: ConfigEnv): Promise<UserConfig> {
    // String-variable specifiers: `@nativescript/vite` is an OPTIONAL peer, not
    // installed in this repo, so a literal `import('@nativescript/vite')` would
    // fail type resolution. Non-literal specifiers resolve at runtime only (the
    // consumer's NS app provides the package). Root is the documented entry
    // (`export { typescriptConfig }`); the subpath is a fallback for versions
    // whose `exports` map exposes `./typescript` but not the root re-export.
    const candidates = ['@nativescript/vite', '@nativescript/vite/typescript'];
    let lastError: unknown;
    for (const specifier of candidates) {
        let mod: { typescriptConfig?: unknown };
        try {
            mod = (await import(specifier)) as { typescriptConfig?: unknown };
        } catch (cause) {
            lastError = cause;
            continue;
        }
        const { typescriptConfig } = mod;
        if (typeof typescriptConfig === 'function') {
            return (typescriptConfig as (opts: { mode: string }) => UserConfig)({ mode: env.mode });
        }
        lastError = new Error(`"${specifier}" resolved but did not export a "typescriptConfig" function`);
    }
    throw new Error(
        '@gjsify/nativescript-vite requires the optional peer "@nativescript/vite" exporting `typescriptConfig` ' +
            '(install it alongside @nativescript/core in your NativeScript app).',
        { cause: lastError },
    );
}

/** Upstream `@nativescript/vite` TypeScript-check plugin name (see `helpers/typescript-check.js`). */
const TS_CHECK_PLUGIN = 'ns-typescript-check';

/**
 * Apply the Vite 8 / Rolldown + type-check fixes to a returned `@nativescript/vite`
 * config: drop function-replacement aliases, the explicit `@rollup/plugin-commonjs`,
 * and the vite-side `ns-typescript-check` (gjsify type-checks via `gjsify tsc`).
 * Returns a shallow copy with the fixed `resolve` and `plugins` — the input is not
 * mutated.
 */
export function applyVite8Fixes(config: UserConfig): UserConfig {
    const out: UserConfig = { ...config };
    if (config.resolve?.alias) {
        out.resolve = { ...config.resolve, alias: dropFunctionAliases(config.resolve.alias) };
    }
    if (Array.isArray(config.plugins)) {
        const before = countPluginByName(config.plugins, 'commonjs');
        out.plugins = stripPluginByName(config.plugins, 'commonjs');
        // Observability: the strip depends on `@rollup/plugin-commonjs` registering
        // exactly `name: 'commonjs'` as a synchronous, top-level (or nested-array)
        // plugin object. If a future `@nativescript/vite` renames it or wraps it in
        // a Promise, the strip silently misses and Rolldown crashes again with the
        // `currentLoadingModule` error this package exists to prevent — so warn loud
        // when the plugin we expect to remove was NOT found.
        if (before === 0) {
            // one-time build-time diagnostic — surfaces a silent upstream rename
            console.warn(
                '[@gjsify/nativescript-vite] no plugin named "commonjs" found in the upstream config — ' +
                    'if your @nativescript/vite version renamed/wrapped @rollup/plugin-commonjs, the Rolldown ' +
                    'CommonJS fix may not have applied.',
            );
        }

        // Drop the vite-side `ns-typescript-check` plugin. A bundler should bundle,
        // not type-check — gjsify defers the authoritative TypeScript gate to
        // `gjsify tsc` / the app's own `check` script (the same separation Vite's
        // esbuild/SWC pipeline already makes). The vite-side check additionally runs
        // a SEPARATE program that loads the full `@nativescript/types` android
        // globals and, under TS 6+, fails the build on the *standard* NativeScript
        // `createNativeView(): android.view.View` override — a covariance the app's
        // own `tsc --noEmit` accepts. Removing it (not silencing it) keeps the build
        // honest; type errors surface in `gjsify tsc`, the real gate.
        const tsCheckBefore = countPluginByName(out.plugins, TS_CHECK_PLUGIN);
        out.plugins = stripPluginByName(out.plugins, TS_CHECK_PLUGIN);
        if (tsCheckBefore > 0) {
            console.warn(
                `[@gjsify/nativescript-vite] removed the vite-side "${TS_CHECK_PLUGIN}" plugin — gjsify defers ` +
                    "TypeScript checking to `gjsify tsc` / the app's own `check` script (the vite-side check fails " +
                    'the build on the standard NativeScript `createNativeView` override under TS 6+, which the ' +
                    "app's own tsc accepts). Run `gjsify tsc` for the authoritative type gate.",
            );
        }
    }
    return out;
}

/**
 * Keep only `resolve.alias` entries Vite 8 / Rolldown accepts. The array form
 * may carry function `replacement`s (Vite types `Alias.replacement` as `string`,
 * but `@nativescript/vite` sets functions at runtime — so this check is
 * LOAD-BEARING; do not remove it as "always true"). Malformed/holey entries are
 * skipped. The object/record form only ever holds strings, so it passes through.
 */
function dropFunctionAliases(alias: AliasOptions): AliasOptions {
    if (!Array.isArray(alias)) return alias;
    return (alias as Alias[]).filter(
        (entry) => entry != null && typeof (entry as { replacement?: unknown }).replacement !== 'function',
    );
}

/**
 * Remove every plugin with the given `name` from a (possibly nested) Vite
 * plugins array, preserving order and nesting of the rest. Assumes plugins are
 * synchronous objects (not `Promise<Plugin>`); `@nativescript/vite` registers
 * `@rollup/plugin-commonjs` synchronously, so this holds for the supported
 * versions.
 */
function stripPluginByName(plugins: UserConfig['plugins'], name: string): UserConfig['plugins'] {
    if (!Array.isArray(plugins)) return plugins;
    const out: NonNullable<UserConfig['plugins']> = [];
    for (const entry of plugins) {
        if (Array.isArray(entry)) {
            out.push(stripPluginByName(entry, name) as never);
        } else if (entry && typeof entry === 'object' && 'name' in entry && (entry as Plugin).name === name) {
            // dropped
        } else {
            out.push(entry as never);
        }
    }
    return out;
}

/** Count plugins with the given `name` across a (possibly nested) plugins array. */
function countPluginByName(plugins: UserConfig['plugins'], name: string): number {
    if (!Array.isArray(plugins)) return 0;
    let n = 0;
    for (const entry of plugins) {
        if (Array.isArray(entry)) n += countPluginByName(entry, name);
        else if (entry && typeof entry === 'object' && 'name' in entry && (entry as Plugin).name === name) n += 1;
    }
    return n;
}
