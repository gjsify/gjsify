// `--app nativescript` Rolldown configuration factory.
//
// NativeScript builds target the V8 engine bundled into the NS Android (JNI)
// and iOS (Objective-C bridge) runtimes. Both runtimes have aligned V8
// versions since NS 8.5 (V8 10.3.22+) and ship full ES2024 surface, so the
// transform target is `esnext`.
//
// Native bridges (`java.*`, `android.*`, `androidx.*`, `kotlin.*`, `NS*`,
// `UI*`, `CG*`, `NSObject`, etc.) are exposed as GLOBAL identifiers by the
// NativeScript runtime at load time — like GJS's `imports.gi.*`, but ambient
// rather than module-namespaced. They are NOT aliased and NOT externalized;
// any value reference resolves at runtime against the host globals.
//
// `@girs/*` and `gi://*` imports are silenced via `gjsImportsEmptyPlugin` —
// they appear transitively through `@gjsify/unit` and similar packages with
// GJS-specific code paths that never execute on NS.
//
// Bare Node specifiers + their `node:*` prefix variants are routed to
// `@gjsify/<X>` via the curated `ALIASES_NODE_FOR_NATIVESCRIPT` table — the
// dynamic per-runtimes-triplet resolver (`getDerivedAliasesSync`) finishes
// the routing in a second pass (`@gjsify/<X>` → `@gjsify/<X>/globals` /
// `@gjsify/empty` depending on the slot declaration).
//
// No `cssAsStringPlugin` (NativeScript ships its own CSS pipeline as part
// of `@nativescript/core`) and no `blueprintPlugin` (Blueprint is GTK-only).

import { aliasPlugin } from '../plugins/alias.js';
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';

import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';
import { ALIASES_NODE_FOR_NATIVESCRIPT, getDerivedAliasesSync } from '@gjsify/resolve-npm';

import type { PluginOptions } from '../types/plugin-options.js';
import { globToEntryPoints } from '../utils/entry-points.js';
import { gjsImportsEmptyPlugin } from '../plugins/gjs-imports-empty.js';

export interface NativescriptBuildConfig {
    options: RolldownOptions;
    plugins: RolldownPluginOption[];
}

export interface NativescriptFactoryInput {
    input?: RolldownOptions['input'];
    output: { file?: string; dir?: string };
    userExternal?: string[];
    userAliases?: Record<string, string>;
    pluginOptions: PluginOptions;
}

export const setupForNativescript = async (
    input: NativescriptFactoryInput,
): Promise<NativescriptBuildConfig> => {
    const userExternal = input.userExternal ?? [];
    const external = [...userExternal];

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    // Bare Node-builtin + `node:*` prefix aliases — both forms route to the
    // same `@gjsify/<X>` target. Generated deterministically from
    // `ALIASES_NODE_FOR_NATIVESCRIPT` so a single source-of-truth in
    // `@gjsify/resolve-npm` drives every NS-app build (no per-target
    // hand-curation drift).
    const nodePrefixAliases: Record<string, string> = {};
    for (const [bare, target] of Object.entries(ALIASES_NODE_FOR_NATIVESCRIPT)) {
        nodePrefixAliases[bare] = target;
        nodePrefixAliases[`node:${bare}`] = target;
    }

    // Legacy / per-target overrides — kept as a separate Record so future
    // mobile-specific shims (e.g. an NS-equivalent of `@gjsify/process`)
    // have an explicit landing pad. Today: empty. New entries SHOULD go
    // into `ALIASES_NODE_FOR_NATIVESCRIPT` so the same wiring is reachable
    // from the Vite-plugin track (`gjsifyNativescript()` preset) too.
    const nativescriptOverrideAliases: Record<string, string> = {};

    // Derived `@gjsify/<X>` aliases driven by per-package `gjsify.runtimes`
    // triplet declarations. Merge order: derived (lowest priority) → curated
    // bare/`node:*` Node-builtin map → per-target overrides → user.
    // Higher tiers WIN on conflict — the user always retains final say.
    const aliasMap: Record<string, string> = {
        ...getDerivedAliasesSync('nativescript'),
        ...nodePrefixAliases,
        ...nativescriptOverrideAliases,
        ...input.pluginOptions.aliases,
        ...input.userAliases,
    };

    const options: RolldownOptions = {
        input: entryPoints,
        // NS's V8 is a "browser-shaped" runtime from Rolldown's perspective:
        // no Node-builtin auto-externals, no globalThis-shaped node-only
        // semantics. `browser` platform is the closest match — the actual
        // host environment is provided by the NS runtime at load time, not
        // by V8 itself.
        platform: 'browser',
        external,
        resolve: {
            mainFields: ['nativescript', 'module', 'main'],
            conditionNames: ['import', 'nativescript'],
        },
        transform: {
            target: 'esnext',
            define: {
                global: 'globalThis',
                // NO `window` define — NativeScript apps don't have a DOM
                // and rely on the canonical absence of `window` to gate
                // their cross-platform branches.
            },
        },
        output: {
            ...input.output,
            format: 'esm',
            sourcemap: false,
            // Single-bundle output. The NS bundler (@nativescript/webpack or
            // @nativescript/vite) consumes the resulting `.mjs` as an entry
            // file and produces the final app bundle from there.
            codeSplitting: false,
        },
        treeshake: true,
    };

    const plugins: RolldownPluginOption[] = [
        gjsImportsEmptyPlugin(),
        aliasPlugin({ entries: flattenAliases(aliasMap) }),
        // NO blueprintPlugin — Blueprint is a GTK-specific UI DSL
        // NO cssAsStringPlugin — NS ships its own CSS pipeline via
        // @nativescript/core; .css imports are handled by the consuming
        // @nativescript/webpack or @nativescript/vite build
        deepkitPlugin({ reflection: input.pluginOptions.reflection }),
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
