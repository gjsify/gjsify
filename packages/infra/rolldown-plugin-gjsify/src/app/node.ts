// `--app node` Rolldown configuration factory.

import { aliasPlugin } from '../plugins/alias.js';
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';

import blueprintPlugin from '@gjsify/vite-plugin-blueprint';
import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';
import { EXTERNALS_NODE, ALIASES_GJS_FOR_NODE, ALIASES_WEB_FOR_GJS } from '@gjsify/resolve-npm';

import type { PluginOptions } from '../types/plugin-options.js';
import { getAliasesForNode } from '../utils/alias.js';
import { globToEntryPoints } from '../utils/entry-points.js';
import { nodeModulesPathRewritePlugin, getBundleDirFromOutput } from '../plugins/rewrite-node-modules-paths.js';
import { cssAsStringPlugin } from '../plugins/css-as-string.js';
import { gjsImportsEmptyPlugin } from '../plugins/gjs-imports-empty.js';
import { gjsGiNodePlugin, gjsBuiltinModulesNodePlugin } from '../plugins/gjs-gi-node.js';
import { unresolvedWorkspaceImportPlugin } from '../plugins/unresolved-workspace-import.js';
import { wrapInputWithSideEffects } from '../utils/entry-wrapper.js';

/**
 * Side-effect specifier the node target injects when GJS ambient globals
 * (`print`/`imports`/…) are detected in the bundled output; importing it seeds
 * them on `globalThis` via the node-gi backend. Kept EXTERNAL — it loads the
 * native addon and must never be bundled.
 */
const NODE_GI_GLOBALS_SPECIFIER = '@gjsify/node-gi/globals';

/**
 * The node-gi standalone GJS built-in modules — the targets `ALIASES_GJS_FOR_NODE`
 * rewrites a GJS source's bare `system`/`gettext`/`cairo` imports to (node-target
 * only, via `gjsBuiltinModulesNodePlugin`). Kept EXTERNAL like
 * `@gjsify/node-gi/gi`: they load the native node-gi backend and must resolve at
 * runtime against the consumer's node_modules.
 *
 * DERIVED from the alias map's VALUES so the two cannot drift. That completeness
 * is LOAD-BEARING under `@gjsify/rolldown-native`: its JSON options boundary drops
 * the resolveId `{ external: true }` flag `gjsBuiltinModulesNodePlugin` returns
 * (only the plain `external` string array survives), so a rewritten
 * `@gjsify/node-gi/<mod>` stays external ONLY if it is in this array. A hardcoded
 * list missing `cairo` left it bare and unresolvable under the GJS bundler,
 * breaking every Cairo/PangoCairo reverse-bridge consumer — invisible under npm
 * `rolldown`, which does honour the flag. e2e `tests/e2e/node-gi-build`; unit
 * `packages/infra/cli/src/node-gi-externals.spec.ts`.
 */
const NODE_GI_BARE_MODULE_SPECIFIERS = Object.values(ALIASES_GJS_FOR_NODE);

/** Matches a register subpath in an alias key: `<pkg>/register` or `<pkg>/register/<feature>`. */
const REGISTER_SUBPATH_RE = /\/register(\/|$)/;

/**
 * Reverse-bridge register routing: a node build of a GENUINE GJS SOURCE needs the
 * REAL `@gjsify/*` register bodies (document, HTMLCanvasElement, the `'2d'` context
 * factory, matchMedia, …) over `@gjsify/node-gi`, not the default `@gjsify/empty`
 * stubs that keep CROSS-PLATFORM node bundles loadable on plain Node.
 *
 * Two adjustments over the standard node alias map:
 *  1. every `<pkg>/register…` → `@gjsify/empty` entry is DROPPED so the register
 *     import resolves to its real body;
 *  2. the gjs target's bare→scoped register routes (`xmlhttprequest/register` →
 *     `@gjsify/fetch/register/xhr`, …) are merged in so the inject stub's bare
 *     specifiers resolve on node exactly as they do on gjs.
 *
 * Applied to the BASE map only, when `isGjsSourceBuild` — `pluginOptions.aliases` /
 * user aliases still override, and a non-reverse-bridge build is untouched.
 */
export function enableGjsRegistersForNode(baseAliases: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(baseAliases)) {
        if (value === '@gjsify/empty' && REGISTER_SUBPATH_RE.test(key)) continue;
        out[key] = value;
    }
    for (const [key, value] of Object.entries(ALIASES_WEB_FOR_GJS)) {
        if (REGISTER_SUBPATH_RE.test(key)) out[key] = value;
    }
    return out;
}

/**
 * Is this `--app node` build a GENUINE GJS SOURCE going through the node-gi
 * reverse bridge, rather than the node target of a cross-platform package?
 *
 * Two signals qualify, and BOTH must gate the same things:
 *  - `nodeGiGlobalsInject` — the CLI's post-tree-shake detection found bare GJS
 *    ambient globals (`print`/`imports`/`ARGV`/…) or a static `@gjsify/node-gi/*`
 *    import (the externalised spelling of the bare built-ins) in the output;
 *  - `registerInject` — the `--globals` inject stub, i.e. the user asked for GJS
 *    registers on the node target explicitly.
 *
 * ONE named function because the two consumers used to ask separately and
 * disagree: with `emitGirs` taking the union and the register-alias lift taking
 * only the explicit stub, a reverse-bridge build got `@girs/*` routed to
 * `requireGi` while a `/register` import in the SAME graph was still emptied to
 * `@gjsify/empty` — silently dropping `@gjsify/dom-elements/register/canvas`'s
 * `'2d'` context factory, so `@gjsify/canvas2d`'s `Canvas2DBridge` never fired
 * `onReady`.
 *
 * A build with NEITHER signal is byte-unchanged: register routing and `@girs/*`
 * emptying both stay, so a cross-platform package's node bundle keeps loading on
 * plain Node without node-gi installed.
 *
 * KNOWN NARROWNESS (tracked in status/open-todos.md): a genuine GJS source whose
 * ONLY platform reach is `gi://` (no ambient global, no bare built-in) is not
 * recognised — its `@girs/*` and its registers are both emptied. A surviving
 * `gi://` import cannot simply become a third signal: its shim loads node-gi
 * lazily precisely so a gjs-gated `gi://` import keeps a cross-platform package's
 * node bundle loadable on plain Node (#641, pinned by
 * `tests/e2e/node-gi-globals-inject`), and injecting the eager globals shim would
 * break exactly that.
 */
export function isGjsSourceBuild(options: {
    nodeGiGlobalsInject?: boolean;
    registerInject?: string | undefined;
}): boolean {
    return Boolean(options.nodeGiGlobalsInject || options.registerInject);
}

export interface NodeBuildConfig {
    /** Transforms that must see the ORIGINAL source; composed before the caller's plugins. */
    prePlugins: RolldownPluginOption[];
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
    // node-datachannel and `@gjsify/node-gi` are native addons that cannot be
    // bundled — their loaders resolve a `.node` binary relative to their own
    // installed location, so both must stay external.
    //
    // GJS-specific specifiers (`gi://*`, `@girs/*`) are deliberately NOT
    // externalised: `gjsGiNodePlugin` rewrites `gi://` to `requireGi`, and
    // `@girs/*` is handled by `gjsGiNodePlugin` + `gjsImportsEmptyPlugin`.
    // Externalising them would leave bare `import 'gi://Gio?version=2.0'` in the
    // output, which Node's ESM loader rejects with
    // `ERR_UNSUPPORTED_ESM_URL_SCHEME`.
    const exactExternal = [
        ...(EXTERNALS_NODE as string[]),
        'node-datachannel',
        '@gjsify/node-gi',
        '@gjsify/node-gi/gi',
        NODE_GI_GLOBALS_SPECIFIER,
        ...NODE_GI_BARE_MODULE_SPECIFIERS,
        ...userExternal,
    ];
    const external = (id: string): boolean => {
        if (exactExternal.includes(id)) return true;
        if (id === '@gjsify/node-gi' || id.startsWith('@gjsify/node-gi/')) return true;
        return false;
    };
    const format = input.pluginOptions.format ?? 'esm';

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    // When `detectNodeGiGlobals` recognised a genuine GJS source, wrap the entry
    // so it side-effect imports the node-gi globals shim before user code runs —
    // ONLY then, so an undetected bundle stays free of `@gjsify/node-gi/globals`
    // and loads on plain Node without node-gi installed (the eager-native-load
    // guard, same lesson as the lazy `gi://` shim in #641).
    const sideEffectImports: string[] = [];
    if (input.pluginOptions.nodeGiGlobalsInject) sideEffectImports.push(NODE_GI_GLOBALS_SPECIFIER);
    // The explicit `--globals` register-inject stub (reverse bridge, see
    // enableGjsRegistersForNode). Ordered AFTER the ambient-globals shim so
    // registers may rely on `print`/`imports` being installed.
    const registerInject = input.pluginOptions.autoGlobalsInject;
    if (registerInject) sideEffectImports.push(registerInject);
    const virtualEntries = wrapInputWithSideEffects(entryPoints, sideEffectImports);
    const finalInput = virtualEntries.input;

    // Gates both the register-alias lift and `emptyGirs` below — see the
    // predicate's doc comment. The node-gi golden `test/canvas2d-bridge.test.mjs`
    // pins the asymmetry it fixed.
    const gjsSourceBuild = isGjsSourceBuild({ ...input.pluginOptions, registerInject });

    const baseAliases = getAliasesForNode({ external });
    const aliasMap = {
        ...(gjsSourceBuild ? enableGjsRegistersForNode(baseAliases) : baseAliases),
        ...input.pluginOptions.aliases,
        ...input.userAliases,
    };

    // The substitution table exactly as `aliasPlugin` receives it — shared with
    // the unresolved-workspace-import guard below so the guard reports the same
    // promise the alias layer made.
    const aliasEntries = flattenAliases(aliasMap);

    const bundleDir = getBundleDirFromOutput(input.output);

    // No banner on purpose: Rolldown injects its own CJS interop (`__commonJSMin`,
    // `__require`), so a top-of-bundle `const require = createRequire(...)` is both
    // unnecessary and harmful — it collides with bundled CJS sources declaring
    // their own (yargs's ESM platform shim): `SyntaxError: Identifier 'require'
    // has already been declared`.
    const banner: string | undefined = undefined;

    const options: RolldownOptions = {
        input: finalInput,
        platform: 'node',
        // A plain string array, never the `external` predicate function:
        // `@gjsify/rolldown-native` JSON.stringify's the options to its Rust core,
        // so a function value is silently dropped and every `EXTERNALS_NODE` entry
        // gets bundled — the build then descends into node-datachannel's
        // `require('…/node_datachannel.node')` and fails with `Module not found`.
        // Exact membership makes the array behaviourally identical on both engines.
        // The function form survives only for `getAliasesForNode({ external })`,
        // which runs in-process and is never serialized.
        external: exactExternal,
        resolve: {
            mainFields: format === 'esm' ? ['module', 'main', 'browser'] : ['main', 'module', 'browser'],
            // CJS-priority conditions. Rolldown takes the package's first matching
            // key, so adding 'import' would route ws v8 (which lists 'import'
            // before 'require') through its incomplete ESM wrapper.
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
            // Single-bundle output.
            codeSplitting: false,
        },
        treeshake: true,
    };

    // Reflection reads the ORIGINAL TypeScript, so it runs before any user
    // transform can strip the annotations out from under it (see `GjsifyConfig`).
    const prePlugins: RolldownPluginOption[] = [deepkitPlugin({ reflection: input.pluginOptions.reflection })];

    const plugins: RolldownPluginOption[] = [
        // Virtual-entry plugin runs FIRST so its resolveId/load match the synthetic
        // `\0gjsify-entry:` ids `wrapInputWithSideEffects` produces (no-op when
        // nothing was injected).
        ...(virtualEntries.plugin ? [virtualEntries.plugin] : []),
        // Claims `gi://Ns?version=X` (resolveId `pre` + array order) and rewrites it
        // onto the `@gjsify/node-gi` runtime so a real GJS/GI source builds and runs
        // on Node. Returns null for `@girs/*`.
        gjsGiNodePlugin(),
        // Bare GJS built-ins: claimed BEFORE aliasPlugin so they resolve to the
        // EXTERNAL `@gjsify/node-gi/<mod>` shims without touching disk (works
        // without node-gi installed, like gi://). Node-target-only. The
        // externalisation itself rides `NODE_GI_BARE_MODULE_SPECIFIERS` in
        // `exactExternal` — see that const's doc comment.
        gjsBuiltinModulesNodePlugin(ALIASES_GJS_FOR_NODE),
        // Decides the fate of `@girs/*` before `aliasPlugin` and the default
        // resolver (same composition order as `app/browser.ts`). `emptyGirs` is
        // gated on `gjsSourceBuild`:
        //   • plain Node build → `@girs/*` → empty module, so a cross-platform
        //     polyfill whose GJS-only paths import `@girs/*` transitively (e.g. via
        //     `@gjsify/unit`) stays loadable without node-gi installed.
        //   • reverse-bridge build → `@girs/<ns>-<ver>` falls through to its real
        //     package body (`import Adw from 'gi://Adw?version=1'`), whose inner
        //     `gi://` gjsGiNodePlugin already rewrote — so `@girs/adw-1` reaches
        //     `requireGi('Adw','1')` with no lowercased-pkg→namespace map needed.
        //     This plugin's own `gi://` branch is dead on the node target.
        gjsImportsEmptyPlugin({ emptyGirs: !gjsSourceBuild }),
        aliasPlugin({ entries: aliasEntries }),
        // Blueprint (.blp → XML string): the reverse bridge runs REAL GTK on Node,
        // so a GJS app entry with composite-template windows must build for
        // `--app node` too. Claims only `.blp` — inert for plain-Node bundles.
        blueprintPlugin() as RolldownPluginOption,
        // On a node-gi build (REAL GTK on Node) lower the CSS to GTK 4's subset just
        // as `--app gjs` does, so nesting/`&` is FLATTENED before it reaches
        // `Gtk.CssProvider.load_from_string` — GTK 4's parser otherwise rejects
        // nested rules at runtime and silently drops the styles (the Learn6502
        // app-gnome symptom). A plain-Node bundle keeps the CSS pristine.
        cssAsStringPlugin(input.pluginOptions.nodeGiGlobalsInject ? { targets: { firefox: 60 << 16 } } : {}),
        nodeModulesPathRewritePlugin({ bundleDir }),
        // `order: 'post'` — fires only for ids headed to Rolldown's
        // unresolved-import → external fallback. The node target has no
        // `node:`-shaped symptom the emit-time guard could detect (its `node:`
        // builtins ARE external by policy), so this is the ONLY thing between an
        // unbuilt `@gjsify/*` workspace edge and a bundle that re-imports the bare
        // specifier at runtime.
        unresolvedWorkspaceImportPlugin({ target: 'node', aliases: aliasEntries, isExternal: external }),
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
