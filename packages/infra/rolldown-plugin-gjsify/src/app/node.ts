// `--app node` Rolldown configuration factory.
//
// Same external set + alias map as the esbuild predecessor. The
// `createRequire` banner that esbuild needed for ESM-output CJS interop
// translates to Rolldown's `output.banner` directly — Rolldown itself does
// not synthesise a `require()` shim for ESM consumers of bundled CJS code.

import alias from '@rollup/plugin-alias';
import type { Plugin, RolldownOptions, RolldownPluginOption } from 'rolldown';

import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';
import { EXTERNALS_NODE } from '@gjsify/resolve-npm';

import type { PluginOptions } from '../types/plugin-options.js';
import { getAliasesForNode } from '../utils/alias.js';
import { globToEntryPoints } from '../utils/entry-points.js';
import {
    nodeModulesPathRewritePlugin,
    getBundleDirFromOutput,
} from '../plugins/rewrite-node-modules-paths.js';
import { cssAsStringPlugin } from '../plugins/css-as-string.js';

export interface NodeBuildConfig {
    options: RolldownOptions;
    plugins: RolldownPluginOption[];
}

export interface NodeFactoryInput {
    input?: RolldownOptions['input'];
    output: { file?: string; dir?: string };
    userExternal?: string[];
    userAliases?: Record<string, string>;
    pluginOptions: PluginOptions;
}

export const setupForNode = async (input: NodeFactoryInput): Promise<NodeBuildConfig> => {
    const userExternal = input.userExternal ?? [];
    // node-datachannel is a native C++ addon that cannot be bundled — its
    // `require('../build/Release/node_datachannel.node')` must resolve at
    // runtime against the real node_modules tree.
    const external = [
        ...EXTERNALS_NODE as string[],
        'gi://*',
        '@girs/*',
        'node-datachannel',
        ...userExternal,
    ];
    const format = input.pluginOptions.format ?? 'esm';

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    const aliasMap = {
        ...getAliasesForNode({ external }),
        ...(input.pluginOptions.aliases ?? {}),
        ...(input.userAliases ?? {}),
    };

    const bundleDir = getBundleDirFromOutput(input.output);

    // ESM output of bundled CJS code still needs `require()` (Rolldown emits
    // calls to it for external Node builtins). Node ESM has no `require`
    // natively, so we synthesize one via `module.createRequire`. This banner
    // is harmless on CJS output (the line is parsed and discarded if the
    // file is required as CJS).
    const banner = format === 'esm'
        ? "import { createRequire as __gjsifyCreateRequire } from 'module';\nconst require = __gjsifyCreateRequire(import.meta.url);"
        : undefined;

    const options: RolldownOptions = {
        input: entryPoints,
        platform: 'node',
        external,
        resolve: {
            mainFields: format === 'esm' ? ['module', 'main', 'browser'] : ['main', 'module', 'browser'],
            // CJS-priority conditions for Node bundles. Rolldown uses the first
            // matching key, so including 'import' would route packages like ws
            // v8 (whose exports map lists 'import' before 'require') through
            // their incomplete ESM wrapper.
            conditionNames: format === 'esm' ? ['require', 'node', 'module'] : ['require'],
        },
        transform: {
            target: 'node24',
            define: {
                global: 'globalThis',
                window: 'globalThis',
            },
        },
        output: {
            ...input.output,
            format,
            minify: false,
            sourcemap: false,
            banner,
        },
        treeshake: true,
    };

    const plugins: RolldownPluginOption[] = [
        alias({ entries: flattenAliases(aliasMap) }) as unknown as Plugin,
        deepkitPlugin({ reflection: input.pluginOptions.reflection }),
        cssAsStringPlugin(),
        nodeModulesPathRewritePlugin({ bundleDir }),
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
