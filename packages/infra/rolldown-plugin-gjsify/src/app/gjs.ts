// `--app gjs` Rolldown configuration factory.
//
// Mirrors the esbuild predecessor's `setupForGjs` exactly in terms of the
// effective build behaviour: same externals, same alias map, same target
// (firefox128 for JS, firefox60 for CSS), same console-shim injection,
// same process-stub banner, same `random-access-file` fs-backed-fallback.
//
// Returns a partial `RolldownOptions` template plus the plugin array the
// caller should compose with their user-supplied options. Library mode is
// handled separately by `setupLib`.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import alias from '@rollup/plugin-alias';
import type { Plugin, RolldownOptions, RolldownPluginOption } from 'rolldown';

import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';

import type { PluginOptions } from '../types/plugin-options.js';
import { getAliasesForGjs } from '../utils/alias.js';
import { globToEntryPoints } from '../utils/entry-points.js';
import {
    nodeModulesPathRewritePlugin,
    getBundleDirFromOutput,
} from '../plugins/rewrite-node-modules-paths.js';
import { processStubPlugin } from '../plugins/process-stub.js';
import { cssAsStringPlugin } from '../plugins/css-as-string.js';
import { shebangPlugin, GJS_SHEBANG } from '../plugins/shebang.js';

const _shimDir = dirname(fileURLToPath(import.meta.url));

/** Resolved Rolldown configuration template + plugins for `--app gjs`. */
export interface GjsBuildConfig {
    options: RolldownOptions;
    plugins: RolldownPluginOption[];
}

export interface GjsFactoryInput {
    /** User entry points after CLI / config merging. */
    input?: RolldownOptions['input'];
    /** Output `file` or `dir` so `import.meta.url` rewriter knows the bundle path. */
    output: { file?: string; dir?: string };
    /** Caller-supplied externals (`gjsify build --external`). */
    userExternal?: string[];
    /** User-supplied banner string (may contain a leading `#!shebang`). */
    userBanner?: string;
    /** User-supplied resolve.alias overrides. */
    userAliases?: Record<string, string>;
    /** Whether to prepend the `#!/usr/bin/env -S gjs -m` shebang. */
    shebang?: boolean;
    /** Plugin options forwarded to sub-plugins (deepkit, css, …). */
    pluginOptions: PluginOptions;
}

export const setupForGjs = async (input: GjsFactoryInput): Promise<GjsBuildConfig> => {
    const userExternal = input.userExternal ?? [];
    const external = ['gi://*', 'cairo', 'gettext', 'system', ...userExternal];
    const format = input.pluginOptions.format ?? 'esm';

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    const aliasMap = {
        ...getAliasesForGjs({ external }),
        ...(input.pluginOptions.aliases ?? {}),
        ...(input.userAliases ?? {}),
    };

    // The console shim replaces all `console` references with print()/printerr()-
    // based implementations that bypass GLib.log_structured() — no prefix,
    // ANSI codes work. Disabled via `pluginOptions.consoleShim === false`.
    const consoleShimEnabled = input.pluginOptions.consoleShim !== false;
    const consoleShimPath = consoleShimEnabled
        ? resolve(_shimDir, '../shims/console-gjs.js')
        : null;

    // Auto-globals inject path is appended as an additional entry (not as
    // Rolldown's `transform.inject`, which is the source-AST per-identifier
    // rewrite forbidden by the auto-globals invariant).
    const extraEntries: string[] = [];
    if (consoleShimPath) extraEntries.push(consoleShimPath);
    if (input.pluginOptions.autoGlobalsInject) extraEntries.push(input.pluginOptions.autoGlobalsInject);

    const finalInput = appendExtraEntries(entryPoints, extraEntries);

    const options: RolldownOptions = {
        input: finalInput,
        platform: 'neutral',
        external,
        // 'browser' field is needed so packages like create-hash, create-hmac,
        // randombytes use their pure-JS browser entry instead of index.js
        // (which does require('crypto') and causes circular dependencies via
        // the crypto → @gjsify/crypto alias).
        resolve: {
            mainFields: format === 'esm' ? ['browser', 'module', 'main'] : ['browser', 'main', 'module'],
            // ESM: omit 'require' — packages listing 'require' before 'import'
            // would silently route through their CJS entry.
            conditionNames: format === 'esm' ? ['browser', 'import'] : ['browser', 'require', 'import'],
        },
        transform: {
            // Compile target: GJS 1.86 / SpiderMonkey 128 ≈ firefox128.
            target: 'firefox128',
            define: {
                global: 'globalThis',
                window: 'globalThis',
                'process.env.READABLE_STREAM': '"disable"',
            },
        },
        output: {
            ...input.output,
            format,
            minify: false,
            sourcemap: false,
        },
        treeshake: true,
    };

    const bundleDir = getBundleDirFromOutput(input.output);

    const plugins: RolldownPluginOption[] = [
        // random-access-file's 'browser' field maps to a throwing stub; force
        // the fs-backed Node entry. Implemented via @rollup/plugin-alias as a
        // direct entry-table override.
        alias({
            entries: {
                'random-access-file': 'random-access-file/index.js',
                ...flattenAliases(aliasMap),
            },
        }) as unknown as Plugin,
        blueprintPlugin() as RolldownPluginOption,
        deepkitPlugin({ reflection: input.pluginOptions.reflection }),
        cssAsStringPlugin(),
        nodeModulesPathRewritePlugin({ bundleDir }),
        processStubPlugin({ userBanner: input.userBanner }),
        shebangPlugin({ enabled: input.shebang === true, line: GJS_SHEBANG }),
    ];

    return { options, plugins };
};

function appendExtraEntries(
    input: RolldownOptions['input'],
    extras: string[],
): RolldownOptions['input'] {
    if (extras.length === 0) return input;
    if (input === undefined) return [...extras];
    if (typeof input === 'string') return [input, ...extras];
    if (Array.isArray(input)) return [...input, ...extras];
    const merged: Record<string, string> = { ...input };
    extras.forEach((p, i) => {
        merged[`__gjsify_extra_${i}`] = p;
    });
    return merged;
}

/**
 * Flatten the legacy `Record<string, string>` alias map into the
 * `@rollup/plugin-alias` `entries` array shape, dropping empty values.
 */
function flattenAliases(map: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [from, to] of Object.entries(map)) {
        if (to) out[from] = to;
    }
    return out;
}
