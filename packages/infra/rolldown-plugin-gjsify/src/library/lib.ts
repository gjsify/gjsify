// Library mode — multi-entry, unbundled output for republication on npm.
//
// Equivalent to esbuild's `bundle: false`: every input file is emitted
// 1:1 with its imports preserved as-is (resolved by Rolldown). The user
// alias map is applied so `node:fs` → `fs/promises` style remappings still
// work, and the JS extension table mirrors the esbuild predecessor.
//
// Targeting `esnext` and `platform: 'neutral'` matches the original
// library config: consumers downstream (downstream apps using `gjsify
// build --app gjs|node|browser`) re-bundle and apply their own target
// lowering. Library output stays maximally portable.

import { aliasPlugin } from '../plugins/alias.js';
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';

import type { PluginOptions } from '../types/plugin-options.js';
import { globToEntryPoints } from '../utils/entry-points.js';

export interface LibBuildConfig {
    options: RolldownOptions;
    plugins: RolldownPluginOption[];
}

export interface LibFactoryInput {
    input?: RolldownOptions['input'];
    output: { file?: string; dir?: string };
    userAliases?: Record<string, string>;
    pluginOptions: PluginOptions;
}

export const setupLib = async (input: LibFactoryInput): Promise<LibBuildConfig> => {
    // Derive output format from `library: 'esm' | 'cjs'` when the caller
    // didn't pass `format` explicitly. The library type and the emitted
    // module format are inseparable: a CJS-library build that emits ESM
    // (or vice versa) is broken by definition.
    const format = input.pluginOptions.format ?? input.pluginOptions.library ?? 'esm';

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    const aliasMap = {
        ...(input.pluginOptions.aliases ?? {}),
        ...(input.userAliases ?? {}),
    };

    const options: RolldownOptions = {
        input: entryPoints,
        platform: 'neutral',
        resolve: {
            mainFields: format === 'esm' ? ['module', 'main'] : ['main'],
            conditionNames: format === 'esm' ? ['module', 'import'] : ['require'],
        },
        transform: { target: 'esnext' },
        output: {
            ...input.output,
            format,
            // Library mode = preserve module structure (multi-file output,
            // imports resolved but not bundled).
            preserveModules: true,
            minify: false,
            sourcemap: false,
        },
        treeshake: false,
    };

    const plugins: RolldownPluginOption[] = [
        aliasPlugin({ entries: flattenAliases(aliasMap) }),
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
