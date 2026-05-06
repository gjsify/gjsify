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
import { setupForGjs, setupForNode, setupForBrowser } from './app/index.js';
import { setupLib } from './library/index.js';

export interface GjsifyConfig {
    options: RolldownOptions;
    plugins: RolldownPluginOption[];
}

export interface GjsifyPluginInput {
    input?: RolldownOptions['input'];
    output: { file?: string; dir?: string };
    userExternal?: string[];
    userBanner?: string;
    userAliases?: Record<string, string>;
    /** Whether to prepend `#!/usr/bin/env -S gjs -m` to the GJS bundle. */
    shebang?: boolean;
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
        default:
            throw new TypeError('Unknown app platform: ' + app);
    }
};

export default gjsifyPlugin;
