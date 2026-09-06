// `--app browser` Rolldown configuration factory.
//
// Browser builds redirect `@girs/*` and `gi://*` to an empty virtual module
// (they appear transitively via `@gjsify/unit` and similar packages with
// GJS-specific code paths) — unless `--gi-renderer` composes the ADR 0034
// stage 9 arm, which answers `gi://Adw` / `gi://Gtk` out of `@gjsify/adwaita-web`
// and carves `@girs/*` out of the empty redirect so they reach it.
//
// Bare Node specifiers + their `node:*` prefix
// variants are routed to `@gjsify/<X>` via the curated
// `ALIASES_NODE_FOR_BROWSER` table, whose VALUES already carry the
// per-runtimes-triplet slot routing (`@gjsify/<X>` → `@gjsify/<X>/browser` /
// `/globals` / `@gjsify/empty`): that table is exported through
// `withDerivedSlotRouting` in `@gjsify/resolve-npm`. Composition happens THERE,
// not as a resolver second pass here — `aliasPlugin` resolves an alias target
// in exactly one hop, because the map it receives is merged flat across tiers
// and a chain would re-route user `--alias` targets too (full argument in
// `withDerivedSlotRouting`'s doc comment and `plugins/alias.ts`).

import { aliasPlugin } from '../plugins/alias.js';
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';

import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';
import { ALIASES_NODE_FOR_BROWSER, GI_RENDERERS, getDerivedAliasesSync } from '@gjsify/resolve-npm';

import type { PluginOptions } from '../types/plugin-options.js';
import { globToEntryPoints } from '../utils/entry-points.js';
import { gjsImportsEmptyPlugin } from '../plugins/gjs-imports-empty.js';
import { giRendererPlugin } from '../plugins/gi-renderer.js';
import { cssAsStringPlugin } from '../plugins/css-as-string.js';
import { unresolvedWorkspaceImportPlugin } from '../plugins/unresolved-workspace-import.js';

export interface BrowserBuildConfig {
    /** Transforms that must see the ORIGINAL source; composed before the caller's plugins. */
    prePlugins: RolldownPluginOption[];
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
    // The arm is composed only when asked for. `config.ts` already refuses the flag
    // on a target with no row, so an undefined row here means the flag was not passed.
    const giRenderer = input.pluginOptions.giRenderer ? GI_RENDERERS['browser'] : undefined;

    // Bare Node-builtin + `node:*` prefix aliases — both forms route to the
    // same `@gjsify/<X>` target. Generated deterministically from
    // `ALIASES_NODE_FOR_BROWSER` so a single source-of-truth in
    // `@gjsify/resolve-npm` drives every browser-app build (no per-target
    // hand-curation drift). The `process` entry here flips today's
    // accidental `@gjsify/empty` to the polyfill (`@gjsify/process`) —
    // `@gjsify/unit`'s `await import('process')` is unreachable in browser
    // (typeof document check comes first), but Rolldown still resolves it
    // statically; the polyfill is the more honest target.
    const nodePrefixAliases: Record<string, string> = {};
    for (const [bare, target] of Object.entries(ALIASES_NODE_FOR_BROWSER)) {
        nodePrefixAliases[bare] = target;
        nodePrefixAliases[`node:${bare}`] = target;
    }

    // Legacy overrides — kept as a separate Record so future per-target
    // shims have an explicit landing pad. Today: empty. The `process` /
    // `assert` entries that lived here historically have moved into
    // `ALIASES_NODE_FOR_BROWSER` (assert → `@gjsify/assert`, process →
    // `@gjsify/process`) — pulling them out of this layer means the new
    // tabular values are not silently shadowed by a stale `@gjsify/empty`.
    const browserPolyfillAliases: Record<string, string> = {};

    // Derived `@gjsify/<X>` aliases driven by per-package `gjsify.runtimes`
    // triplet declarations. Merge order: derived (lowest priority) → curated
    // bare/`node:*` Node-builtin map → legacy per-target overrides → user.
    // Higher tiers WIN on conflict — the user always retains final say.
    const aliasMap: Record<string, string> = {
        ...getDerivedAliasesSync('browser'),
        ...nodePrefixAliases,
        ...browserPolyfillAliases,
        ...input.pluginOptions.aliases,
        ...input.userAliases,
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
            sourcemap: false,
            // Single-bundle output. `codeSplitting: false` replaces the
            // deprecated `inlineDynamicImports: true`.
            codeSplitting: false,
        },
        treeshake: true,
    };

    // The substitution table exactly as `aliasPlugin` receives it — shared with
    // the unresolved-workspace-import guard below so the guard reports the same
    // promise the alias layer made.
    const aliasEntries = flattenAliases(aliasMap);

    // Reflection reads the ORIGINAL TypeScript, so it runs before any user
    // transform can strip the annotations out from under it (see `GjsifyConfig`).
    const prePlugins: RolldownPluginOption[] = [deepkitPlugin({ reflection: input.pluginOptions.reflection })];

    const plugins: RolldownPluginOption[] = [
        // ADR 0034 stage 9 — the `gi://` arm, ahead of the empty redirect so it
        // claims the specifier first, exactly as `gjsGiNodePlugin` does on the node
        // target. `emptyGirs` follows it: with the arm on, `@girs/<ns>-<ver>` must
        // reach its real body so its inner `gi://` lands here instead of being
        // stranded as `{}`.
        ...(giRenderer ? [giRendererPlugin({ app: 'browser', ...giRenderer })] : []),
        gjsImportsEmptyPlugin({ emptyGirs: !giRenderer }),
        aliasPlugin({ entries: aliasEntries }),
        blueprintPlugin() as RolldownPluginOption,
        cssAsStringPlugin(),
        // `order: 'post'` — see app/gjs.ts. The browser target's whole job is to
        // replace Node builtins with their `@gjsify/*` browser entries; when one
        // of those cannot be resolved, Rolldown externalises the ORIGINAL bare
        // specifier and a browser cannot resolve it at all. There is no
        // `node:`-shaped emit-time symptom here, so this guard is the only signal.
        unresolvedWorkspaceImportPlugin({
            target: 'browser',
            aliases: aliasEntries,
            isExternal: (id) => external.includes(id),
        }),
    ];

    return { options, prePlugins, plugins };
};

function flattenAliases(map: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [from, to] of Object.entries(map)) {
        if (to) out[from] = to;
    }
    return out;
}
