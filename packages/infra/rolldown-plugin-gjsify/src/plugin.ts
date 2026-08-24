// `gjsifyPlugin` — orchestrator entry point.
//
// Picks the platform-specific factory based on `pluginOptions.app`
// (or `library` for library mode) and returns the resolved Rolldown
// configuration. Unlike the esbuild predecessor, this is NOT a single
// `Plugin` object — it returns a *config bundle* the caller composes into
// `rolldown(opts)`, because Rolldown does not have esbuild's `setup(build)`
// hook through which a single plugin can mutate `build.initialOptions`.
//
// The CLI consumer (`@gjsify/cli`) calls `gjsifyPlugin(...)` to get back
// `{ options, plugins }`, then calls `rolldown({ ...options, plugins:
// [...userPlugins, ...plugins] })`.

import type { RolldownOptions, RolldownPluginOption } from 'rolldown';
import type { PluginOptions } from './types/plugin-options.js';
import { setupForGjs, setupForNode, setupForBrowser, setupForNativescript } from './app/index.js';
import { setupLib } from './library/index.js';
import type { GiSystemProbe } from './plugins/gi-runtime-paths.js';

export interface GjsifyConfig {
    options: RolldownOptions;
    /**
     * Transforms that must see the ORIGINAL module source — composed BEFORE the
     * caller's own plugins, while `plugins` stays after them.
     *
     * The split exists because the two positions answer different questions. User
     * plugins go first so their `resolveId`/`load` wins over gjsify's alias and
     * externals chain. But a user `transform: { order: 'pre' }` that REWRITES the
     * source then also beats gjsify's own pre-transforms, and Deepkit's type
     * compiler is one of them: `@gjsify/rolldown-plugin-solid` runs
     * `@babel/preset-typescript` over every `.tsx`, so Deepkit was handed a file
     * with no type annotations left. MEASURED on one `.tsx` carrying both a
     * `typeOf<T>()` and a JSX tag: `const reflected = typeOf()` in the artifact,
     * exit 0, not one diagnostic, and `Error: No type given` thrown at runtime.
     */
    prePlugins: RolldownPluginOption[];
    plugins: RolldownPluginOption[];
}

export interface GjsifyPluginInput {
    input?: RolldownOptions['input'];
    output: { file?: string; dir?: string };
    userExternal?: string[];
    userBanner?: string;
    userAliases?: Record<string, string>;
    /**
     * Shebang to prepend to the GJS bundle.
     *   `true`  → default `#!/usr/bin/env -S gjs -m`
     *   `false` → no shebang
     *   `"…"`   → custom line, supports `${env:NAME[:-default]}` placeholders
     */
    shebang?: boolean | string;
    /**
     * `--app gjs` only: system GI library dirs the byte-1 prologue probes on the RUNNING
     * host. The bundle-relative half of that prologue is deliberately NOT plumbed here —
     * `processStubPlugin`'s `giRuntimePaths` still takes it, but nothing in this repo can
     * fill it with a path that is true on the machine a shipped bundle runs on
     * (`packages/infra/cli/src/utils/gi-runtime-paths.ts` records what was measured), and
     * an option no caller fills is the defect this wiring was added to remove.
     */
    giSystemProbes?: readonly GiSystemProbe[];
}

/**
 * Build the Rolldown configuration template + plugin array for the given
 * pluginOptions. The caller composes the returned `options.plugins` with
 * its own user plugins and passes the merged options to `rolldown(...)`.
 */
export const gjsifyPlugin = async (
    input: GjsifyPluginInput,
    pluginOptions: PluginOptions = {},
): Promise<GjsifyConfig> => {
    if (pluginOptions.library) {
        switch (pluginOptions.library) {
            case 'esm':
            case 'cjs':
                return await setupLib({
                    input: input.input,
                    output: input.output,
                    userAliases: input.userAliases,
                    pluginOptions,
                });
            default:
                throw new TypeError('Unknown library type: ' + pluginOptions.library);
        }
    }

    const app = pluginOptions.app ?? 'gjs';
    switch (app) {
        case 'gjs':
            return await setupForGjs({
                input: input.input,
                output: input.output,
                userExternal: input.userExternal,
                userBanner: input.userBanner,
                userAliases: input.userAliases,
                shebang: input.shebang,
                giSystemProbes: input.giSystemProbes,
                pluginOptions,
            });
        case 'node':
            return await setupForNode({
                input: input.input,
                output: input.output,
                userExternal: input.userExternal,
                userAliases: input.userAliases,
                pluginOptions,
            });
        case 'browser':
            return await setupForBrowser({
                input: input.input,
                output: input.output,
                userExternal: input.userExternal,
                userAliases: input.userAliases,
                pluginOptions,
            });
        case 'nativescript':
            return await setupForNativescript({
                input: input.input,
                output: input.output,
                userExternal: input.userExternal,
                userAliases: input.userAliases,
                pluginOptions,
            });
        default:
            throw new TypeError('Unknown app platform: ' + app);
    }
};

export default gjsifyPlugin;
