// `--app node` Rolldown configuration factory.
//
// Same external set + alias map as the esbuild predecessor. The
// `createRequire` banner that esbuild needed for ESM-output CJS interop
// translates to Rolldown's `output.banner` directly — Rolldown itself does
// not synthesise a `require()` shim for ESM consumers of bundled CJS code.

import { aliasPlugin } from '../plugins/alias.js';
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';

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
    //
    // Note: Rolldown's `external` array does NOT support glob patterns the
    // way esbuild's did (`gi://*`, `@girs/*`). We use a function predicate
    // instead so the gi:// URI scheme and the @girs/ namespace are matched
    // by prefix.
    const exactExternal = [
        ...EXTERNALS_NODE as string[],
        'node-datachannel',
        ...userExternal,
    ];
    const external = (id: string): boolean => {
        if (id.startsWith('gi://')) return true;
        if (id.startsWith('@girs/')) return true;
        if (exactExternal.includes(id)) return true;
        return false;
    };
    const format = input.pluginOptions.format ?? 'esm';

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    const aliasMap = {
        ...getAliasesForNode({ external }),
        ...(input.pluginOptions.aliases ?? {}),
        ...(input.userAliases ?? {}),
    };

    const bundleDir = getBundleDirFromOutput(input.output);

    // Rolldown's CJS interop wraps bundled CJS via `__commonJSMin` and
    // routes external Node-builtin `require()` through `__require` —
    // both injected internally. Unlike esbuild we therefore don't need a
    // top-of-bundle `const require = createRequire(...)` shim. Keeping
    // one collides with bundled CJS sources that declare their own
    // `const require = createRequire(...)` (e.g. yargs's ESM platform
    // shim) — `SyntaxError: Identifier 'require' has already been
    // declared`.
    const banner: string | undefined = undefined;

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
            sourcemap: false,
            banner,
            // Single-bundle output. `codeSplitting: false` replaces the
            // deprecated `inlineDynamicImports: true`.
            codeSplitting: false,
        },
        treeshake: true,
    };

    const plugins: RolldownPluginOption[] = [
        aliasPlugin({ entries: flattenAliases(aliasMap) }),
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
