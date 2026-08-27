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
// `@gjsify/<X>` via the curated `ALIASES_NODE_FOR_NATIVESCRIPT` table. Unlike
// the browser table, this one is NOT passed through `withDerivedSlotRouting`:
// slot routing would only change 4 of its 122 entries and all four are
// regressions — `fs`/`fs/promises` (+ their `node:` forms) deliberately point
// at `@gjsify/native-fs-bridge`, which declares `nativescript: "native"` in the
// "this package IS the native implementation" sense and therefore promises a
// `globals.mjs` it does not ship. The slot vocabulary's `native` means "the
// RUNTIME provides this, use its value", so the bridge packages are
// mis-declared; that is tracked in status/open-todos.md and must be settled
// before this table is composed.
//
// Derived `@gjsify/<X>` entries are merged into the map below, so an import by
// PACKAGE NAME still routes per its declared slot in a single hop.
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
import {
    platformResolvePlugin,
    nativescriptSuffixChain,
    detectNativescriptPlatform,
    nativescriptPlatformDefines,
} from '../plugins/platform-resolve.js';
import { unresolvedWorkspaceImportPlugin } from '../plugins/unresolved-workspace-import.js';

export interface NativescriptBuildConfig {
    /** Transforms that must see the ORIGINAL source; composed before the caller's plugins. */
    prePlugins: RolldownPluginOption[];
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

// Never bundled: an app works only with the ONE core instance the runtime boots, and what
// this target emits is an ENTRY the NS bundler resolves it for. An optional peer absent from
// the workspace install, it was not resolvable either — every UI-widget bridge failed to build.
const NATIVESCRIPT_CORE = /^@nativescript\/core(?:\/|$)/;

export const setupForNativescript = async (input: NativescriptFactoryInput): Promise<NativescriptBuildConfig> => {
    const userExternal = input.userExternal ?? [];
    const external: (string | RegExp)[] = [...userExternal, NATIVESCRIPT_CORE];
    const isExternal = (id: string): boolean =>
        external.some((entry) => (typeof entry === 'string' ? entry === id : entry.test(id)));

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    // Target platform — discovered from the env NS' CLI sets when it spawns a
    // bundler (else `undefined` → `.native`-only resolution + neutral defines).
    // `gjsify build` is a production bundler, so `__DEV__` is `false` here.
    const platform = detectNativescriptPlatform();

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
                //
                // Standard NS compile-time platform flags (`__ANDROID__` /
                // `__IOS__` / `__APPLE__` / `__VISIONOS__` / `__DEV__`) so app
                // code branching on them is statically resolved + dead-code
                // eliminated per target — matching the globals
                // `@nativescript/vite` seeds in its main entry.
                ...nativescriptPlatformDefines(platform, { dev: false }),
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

    // The substitution table exactly as `aliasPlugin` receives it — shared with
    // the unresolved-workspace-import guard below so the guard reports the same
    // promise the alias layer made.
    const aliasEntries = flattenAliases(aliasMap);

    // Reflection reads the ORIGINAL TypeScript, so it runs before any user
    // transform can strip the annotations out from under it (see `GjsifyConfig`).
    const prePlugins: RolldownPluginOption[] = [deepkitPlugin({ reflection: input.pluginOptions.reflection })];

    const plugins: RolldownPluginOption[] = [
        gjsImportsEmptyPlugin(),
        // Platform-specific source variants (`*.android` / `*.ios` /
        // `*.native`) win over the base file — resolved BEFORE the Node-builtin
        // alias routing so a platform fork of a portable module is honored.
        platformResolvePlugin({ suffixes: nativescriptSuffixChain(platform) }),
        aliasPlugin({ entries: aliasEntries }),
        // NO blueprintPlugin — Blueprint is a GTK-specific UI DSL
        // NO cssAsStringPlugin — NS ships its own CSS pipeline via
        // @nativescript/core; .css imports are handled by the consuming
        // @nativescript/webpack or @nativescript/vite build
        // `order: 'post'` — see app/gjs.ts. Native-bridge identifiers
        // (`java.*`, `NS*`, …) are ambient GLOBALS on this target, never
        // imports, so they never reach this hook; only a `@gjsify/*` edge does,
        // and on NS as everywhere else an unresolvable one is a broken bundle
        // rather than something the runtime will provide.
        unresolvedWorkspaceImportPlugin({
            target: 'nativescript',
            aliases: aliasEntries,
            isExternal,
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
