// `--app browser` Rolldown configuration factory.
//
// Browser builds redirect `@girs/*` and `gi://*` to an empty virtual module
// (they appear transitively via `@gjsify/unit` and similar packages with
// GJS-specific code paths). Standard Node.js → browser polyfill aliases
// for `process` and `assert` keep `@gjsify/unit`'s top-level imports
// resolvable in a browser bundle.

import { aliasPlugin } from '../plugins/alias.js';
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';

import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';

import type { PluginOptions } from '../types/plugin-options.js';
import { globToEntryPoints } from '../utils/entry-points.js';
import { gjsImportsEmptyPlugin } from '../plugins/gjs-imports-empty.js';
import { cssAsStringPlugin } from '../plugins/css-as-string.js';

export interface BrowserBuildConfig {
    options: RolldownOptions;
    plugins: RolldownPluginOption[];
}

export interface BrowserFactoryInput {
    input?: RolldownOptions['input'];
    output: { file?: string; dir?: string };
    userExternal?: string[];
    userAliases?: Record<string, string>;
    pluginOptions: PluginOptions;
}

export const setupForBrowser = async (input: BrowserFactoryInput): Promise<BrowserBuildConfig> => {
    const userExternal = input.userExternal ?? [];
    const external = [...userExternal];

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    // `@gjsify/unit` has `await import('process')` inside a try-catch that
    // is unreachable in browser (typeof document check comes first), but
    // Rolldown still resolves it statically. Map to `@gjsify/empty` so the
    // build succeeds. `assert` → `@gjsify/assert` because `@gjsify/unit`
    // imports `node:assert` at the top level.
    const browserPolyfillAliases: Record<string, string> = {
        process: '@gjsify/empty',
        'node:process': '@gjsify/empty',
        assert: '@gjsify/assert',
        'node:assert': '@gjsify/assert',
    };

    const aliasMap: Record<string, string> = {
        ...browserPolyfillAliases,
        ...(input.pluginOptions.aliases ?? {}),
        ...(input.userAliases ?? {}),
    };

    const options: RolldownOptions = {
        input: entryPoints,
        platform: 'browser',
        external,
        resolve: {
            mainFields: ['browser', 'module', 'main'],
            conditionNames: ['import', 'browser'],
        },
        transform: {
            target: 'esnext',
            define: {
                global: 'globalThis',
                window: 'globalThis',
            },
        },
        output: {
            ...input.output,
            format: 'esm',
            minify: false,
            sourcemap: false,
            inlineDynamicImports: true,
        },
        treeshake: true,
    };

    const plugins: RolldownPluginOption[] = [
        gjsImportsEmptyPlugin(),
        aliasPlugin({ entries: flattenAliases(aliasMap) }),
        blueprintPlugin() as RolldownPluginOption,
        deepkitPlugin({ reflection: input.pluginOptions.reflection }),
        cssAsStringPlugin(),
    ];

    return { options, plugins };
};

function flattenAliases(map: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [from, to] of Object.entries(map)) {
        if (to) out[from] = to;
    }
    return out;
}
