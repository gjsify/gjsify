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
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';
import { aliasPlugin } from '../plugins/alias.js';

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

    // Side-effect-only files we need to land in the bundle alongside the
    // user's entry: the console shim and (when present) the auto-globals
    // inject stub. We can't use Rolldown's `transform.inject` (source-AST
    // rewrite, forbidden by the auto-globals invariant) and we can't add
    // them as additional `input` entries because Rolldown then either emits
    // multiple chunks (incompatible with `--outfile`) or rejects
    // `codeSplitting: false` for multi-input builds.
    //
    // Instead we wrap the user entry in a virtual module that side-effect-
    // imports each shim then re-exports the entry. One real entry, all the
    // bytes land in one bundle.
    const sideEffectImports: string[] = [];
    if (consoleShimPath) sideEffectImports.push(consoleShimPath);
    if (input.pluginOptions.autoGlobalsInject) sideEffectImports.push(input.pluginOptions.autoGlobalsInject);

    const virtualEntries = wrapInputWithSideEffects(entryPoints, sideEffectImports);
    const finalInput = virtualEntries.input;

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
            // App builds emit a single bundle file. Disable code-splitting
            // and inline dynamic imports so the entire program lands in
            // one chunk that matches `gjsify build --outfile foo.js`.
            inlineDynamicImports: true,
        },
        treeshake: true,
    };

    const bundleDir = getBundleDirFromOutput(input.output);

    const plugins: RolldownPluginOption[] = [
        // Virtual-entry plugin runs FIRST so its resolveId/load match the
        // synthetic input ids that `wrapInputWithSideEffects` produces.
        ...(virtualEntries.plugin ? [virtualEntries.plugin] : []),
        // random-access-file's 'browser' field maps to a throwing stub; force
        // the fs-backed Node entry. Implemented via the gjsify alias plugin
        // as a direct entry-table override.
        aliasPlugin({
            entries: {
                'random-access-file': 'random-access-file/index.js',
                ...flattenAliases(aliasMap),
            },
        }),
        blueprintPlugin() as RolldownPluginOption,
        deepkitPlugin({ reflection: input.pluginOptions.reflection }),
        cssAsStringPlugin(),
        nodeModulesPathRewritePlugin({ bundleDir }),
        processStubPlugin({ userBanner: input.userBanner }),
        shebangPlugin({ enabled: input.shebang === true, line: GJS_SHEBANG }),
    ];

    return { options, plugins };
};

interface VirtualEntriesResult {
    input: RolldownOptions['input'];
    plugin: RolldownPluginOption | null;
}

/**
 * If there are side-effect imports to land alongside the user's entry,
 * wrap each entry in a virtual module that imports them first then
 * re-exports the entry. Returns the rewritten `input` plus the resolveId/load
 * plugin that resolves the virtual ids.
 *
 * Single-input case: `'src/index.ts'` → `'\0gjsify-entry:src/index.ts'`.
 * Array-input case: each element gets the same wrapper id.
 * Record-input case: values get wrapped, keys preserved.
 *
 * `\0`-prefixed ids are Rollup's convention for synthetic modules — Rolldown
 * recognises and treats them as not-from-disk, skipping the default loader.
 */
function wrapInputWithSideEffects(
    input: RolldownOptions['input'],
    sideEffects: string[],
): VirtualEntriesResult {
    if (sideEffects.length === 0 || input === undefined) {
        return { input, plugin: null };
    }

    const userEntries = new Map<string, string>(); // virtualId → realPath
    const PREFIX = '\0gjsify-entry:';

    function wrap(realPath: string): string {
        const id = PREFIX + realPath;
        userEntries.set(id, realPath);
        return id;
    }

    let wrappedInput: RolldownOptions['input'];
    if (typeof input === 'string') {
        wrappedInput = wrap(input);
    } else if (Array.isArray(input)) {
        wrappedInput = input.map(wrap);
    } else {
        const out: Record<string, string> = {};
        for (const [name, path] of Object.entries(input)) {
            out[name] = wrap(path);
        }
        wrappedInput = out;
    }

    const sideEffectImports = sideEffects
        .map((p) => `import ${JSON.stringify(p)};`)
        .join('\n');

    const plugin: RolldownPluginOption = {
        name: 'gjsify-virtual-entry',
        async resolveId(source, importer) {
            if (source.startsWith(PREFIX)) return source;
            return null;
        },
        async load(id) {
            if (!id.startsWith(PREFIX)) return null;
            const realPath = userEntries.get(id);
            if (!realPath) return null;
            // Resolve the user-provided entry path through the full
            // resolver chain so the re-export targets a real on-disk
            // module — otherwise Rolldown treats `src/foo.ts` as a bare
            // specifier and emits it as an external import.
            const resolved = await this.resolve(realPath, undefined, { skipSelf: true });
            const target = resolved?.id ?? realPath;
            return {
                code: `${sideEffectImports}\nexport * from ${JSON.stringify(target)};\n`,
                moduleSideEffects: true,
            };
        },
    };

    return { input: wrappedInput, plugin };
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
