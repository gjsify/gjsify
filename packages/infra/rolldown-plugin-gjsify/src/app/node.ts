// `--app node` Rolldown configuration factory.
//
// Same external set + alias map as the esbuild predecessor. The
// `createRequire` banner that esbuild needed for ESM-output CJS interop
// translates to Rolldown's `output.banner` directly — Rolldown itself does
// not synthesise a `require()` shim for ESM consumers of bundled CJS code.

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
import { wrapInputWithSideEffects } from '../utils/entry-wrapper.js';

/**
 * Side-effect specifier the node target injects when GJS ambient globals
 * (`print`/`imports`/…) are detected in the bundled output. Importing it seeds
 * those globals on `globalThis` via the node-gi backend. Kept EXTERNAL (see the
 * external set below) — it loads the native addon and must never be bundled.
 */
const NODE_GI_GLOBALS_SPECIFIER = '@gjsify/node-gi/globals';

/**
 * The node-gi standalone GJS built-in modules. The bare `system` / `gettext` /
 * `cairo` specifiers a GJS source imports are aliased to these (via
 * `ALIASES_GJS_FOR_NODE`, applied node-target-only by `gjsBuiltinModulesNodePlugin`)
 * and, like `@gjsify/node-gi/gi`, kept EXTERNAL — they load the native node-gi
 * backend and must resolve at runtime against the consumer's node_modules, never
 * be bundled.
 *
 * DERIVED from `ALIASES_GJS_FOR_NODE`'s VALUES so this set can never drift from
 * the alias map again — a new bare built-in added there is externalised
 * automatically. That completeness is LOAD-BEARING under `@gjsify/rolldown-native`
 * (the GJS bundler engine): its JSON options boundary silently DROPS the resolveId
 * `{ external: true }` flag that `gjsBuiltinModulesNodePlugin` returns (only the
 * plain `external` string array survives serialization — the same reason
 * `app/gjs.ts` routes its externals through a resolveId hook AND filters the array).
 * So the rewritten `@gjsify/node-gi/<mod>` target stays external ONLY if it is in
 * this array. `@gjsify/node-gi/cairo` was previously MISSING here (only `system` +
 * `gettext` were listed), so under the GJS bundler `cairo` was left as a bare,
 * unresolvable specifier — breaking every Cairo/PangoCairo consumer
 * (`@gjsify/canvas2d-core`) built via the reverse bridge. Under npm `rolldown`
 * (Node) the resolveId `external` flag IS honoured, so the gap was invisible until
 * a Cairo consumer was built on the GJS bundler. e2e: `tests/e2e/node-gi-build`;
 * unit: `packages/infra/cli/src/node-gi-externals.spec.ts`.
 */
const NODE_GI_BARE_MODULE_SPECIFIERS = Object.values(ALIASES_GJS_FOR_NODE);

/** Matches a register subpath in an alias key: `<pkg>/register` or `<pkg>/register/<feature>`. */
const REGISTER_SUBPATH_RE = /\/register(\/|$)/;

/**
 * Reverse-bridge register routing: a node build with an EXPLICIT `--globals`
 * register-inject stub (`pluginOptions.autoGlobalsInject`, set by the CLI for
 * `--app node` when the user names globals — e.g. `--globals auto,dom`) is a
 * genuine GJS source that needs the REAL `@gjsify/*` register bodies (document,
 * HTMLCanvasElement, matchMedia, …) running over `@gjsify/node-gi`, not the
 * default `@gjsify/empty` stubs that keep cross-platform node bundles loadable
 * on plain Node.
 *
 * Two adjustments over the standard node alias map:
 *  1. every `<pkg>/register…` → `@gjsify/empty` entry is DROPPED so the
 *     register import resolves to its real body;
 *  2. the gjs target's bare→scoped register routes (`fetch/register/fetch` →
 *     `@gjsify/fetch/register/fetch`, `xmlhttprequest/register` →
 *     `@gjsify/fetch/register/xhr`, …) are merged in so the inject stub's bare
 *     specifiers resolve on node exactly as they do on gjs.
 *
 * Applied to the BASE map only — `pluginOptions.aliases` / user aliases still
 * override. Without the inject stub the map is untouched (the plain-Node
 * loadability guarantee for cross-platform packages is not regressed).
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
    // GJS-specific specifiers (`gi://*`, `@girs/*`) are NOT externalised —
    // `gi://*` is rewritten to `requireGi` by `gjsGiNodePlugin`, and `@girs/*`
    // is handled by `gjsGiNodePlugin` + `gjsImportsEmptyPlugin` (both in the
    // plugins array below). Marking them external would leave bare
    // `import 'gi://Gio?version=2.0'` strings in the output that Node's default
    // ESM loader rejects with `ERR_UNSUPPORTED_ESM_URL_SCHEME`. For a
    // cross-platform package the `@girs/*` empty-module redirect makes node
    // bundles (which transitively import @girs/* via *.gjs.spec / direct
    // internal imports) loadable on Node — the GJS-only code paths are still
    // gated at runtime by `on('Gjs', …)` or `typeof globalThis.imports` guards.
    // For a GENUINE GJS source built via the node-gi reverse bridge (detected
    // by `nodeGiGlobalsInject`) the `@girs/*` empty redirect is OFF so the
    // namespace resolves through to `requireGi` — see the plugins array.
    // `@gjsify/node-gi` is the Axis-5 GI runtime the `gjsGiNodePlugin` rewrites
    // `gi://` onto. It is a native (node-gyp) addon whose loader resolves its
    // `.node` binary relative to its own installed location, so it must NOT be
    // bundled — keep it external so the `import … from '@gjsify/node-gi/gi'` the
    // virtual shim emits resolves at runtime against the consumer's node_modules.
    const exactExternal = [
        ...(EXTERNALS_NODE as string[]),
        'node-datachannel',
        '@gjsify/node-gi',
        '@gjsify/node-gi/gi',
        // The GJS-ambient-globals shim (auto-injected below when `print`/
        // `imports`/… are referenced). Like `@gjsify/node-gi/gi` it loads the
        // native addon and must resolve at runtime, never be bundled.
        NODE_GI_GLOBALS_SPECIFIER,
        // The node-gi standalone GJS built-in modules (`system`/`gettext`),
        // reached when the alias layer rewrites the bare specifiers. Kept
        // external for the same reason as the gi/globals shims above.
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

    // When the CLI's pre-build detection (`detectNodeGiGlobals`) found GJS
    // ambient globals in the bundled output, wrap the entry so it side-effect
    // imports the node-gi globals shim BEFORE the user code runs. The import is
    // injected ONLY when detected — a bundle that never touches `print`/`imports`
    // stays free of `@gjsify/node-gi/globals`, so it loads on plain Node without
    // node-gi installed (the eager-native-load regression guard, same lesson as
    // the lazy `gi://` shim in #641). Reuses the SAME virtual-entry wrapper the
    // GJS `--globals auto` machinery uses.
    const sideEffectImports: string[] = [];
    if (input.pluginOptions.nodeGiGlobalsInject) sideEffectImports.push(NODE_GI_GLOBALS_SPECIFIER);
    // The explicit `--globals` register-inject stub (reverse bridge, see
    // enableGjsRegistersForNode). Ordered AFTER the ambient-globals shim so
    // registers may rely on `print`/`imports` being installed.
    const registerInject = input.pluginOptions.autoGlobalsInject;
    if (registerInject) sideEffectImports.push(registerInject);
    const virtualEntries = wrapInputWithSideEffects(entryPoints, sideEffectImports);
    const finalInput = virtualEntries.input;

    const baseAliases = getAliasesForNode({ external });
    const aliasMap = {
        ...(registerInject ? enableGjsRegistersForNode(baseAliases) : baseAliases),
        ...input.pluginOptions.aliases,
        ...input.userAliases,
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
        input: finalInput,
        platform: 'node',
        // Pass the EXACT-MATCH external set as a plain string array, NOT the
        // `external` predicate function. `@gjsify/rolldown-native` ships the
        // whole options object to its Rust core via `JSON.stringify` — a
        // function value does not survive serialization (it is silently
        // dropped), so a function `external` is honoured under npm rolldown
        // (Node) but IGNORED under native rolldown (GJS), leaving
        // `node-datachannel` (and the rest of EXTERNALS_NODE) bundled. That
        // descends into node-datachannel's `require('…/node_datachannel.node')`
        // and fails the `--app node` build with `Module not found`. The
        // predicate here is pure exact membership, so the array is
        // behaviourally identical under both engines AND JSON-serializable.
        // (The gjs target follows the same rule: exact names as an array,
        // plus an `externalsPlugin` resolveId hook for its gi://-prefix and
        // register-subpath shape rules — see app/gjs.ts. The browser target
        // already uses a plain array.)
        // The function form is still used for `getAliasesForNode({ external })`
        // above — that runs in-process and is never serialized.
        external: exactExternal,
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
        // Virtual-entry plugin runs FIRST so its resolveId/load match the
        // synthetic `\0gjsify-entry:` ids that `wrapInputWithSideEffects`
        // produces (no-op when nothing was injected).
        ...(virtualEntries.plugin ? [virtualEntries.plugin] : []),
        // gjsGiNodePlugin runs FIRST (resolveId order 'pre' + array order): it
        // claims `gi://Ns?version=X` and rewrites it to the `@gjsify/node-gi`
        // runtime, so a real GJS/GI source builds + runs on Node. It returns
        // null for `@girs/*`.
        gjsGiNodePlugin(),
        // Bare GJS built-in modules (`system`/`gettext`/`cairo`): claimed BEFORE
        // the aliasPlugin so they resolve to the EXTERNAL `@gjsify/node-gi/<mod>`
        // shims without a disk resolution (works without node-gi installed,
        // like gi://). Node-target-only — never active on gjs/browser/ns. The
        // externalisation itself rides `NODE_GI_BARE_MODULE_SPECIFIERS` in the
        // `exactExternal` array (the resolveId `external` flag is dropped under
        // @gjsify/rolldown-native — see that const's doc-comment).
        gjsBuiltinModulesNodePlugin(ALIASES_GJS_FOR_NODE),
        // gjsImportsEmptyPlugin then decides the fate of `@girs/*` before
        // `aliasPlugin` and the default resolver. Same composition order as
        // `app/browser.ts`. `emptyGirs` is GATED on `nodeGiGlobalsInject`:
        //   • false-flag (default Node build) → `@girs/*` → empty module. A
        //     cross-platform polyfill package whose GJS-only code paths import
        //     `@girs/*` transitively (e.g. via `@gjsify/unit`) stays loadable on
        //     plain Node WITHOUT node-gi installed — exactly the existing
        //     behaviour, never regressed.
        //   • node-gi build (`nodeGiGlobalsInject` true — the genuine-GJS-source
        //     signal) → `@girs/<ns>-<ver>` falls through to its real package
        //     body (`import Adw from 'gi://Adw?version=1'; export default Adw`),
        //     whose inner `gi://` is rewritten to `requireGi` by gjsGiNodePlugin
        //     above. This routes `@girs/adw-1` → `requireGi('Adw','1')` WITHOUT
        //     a lowercased-pkg→namespace map (the proper-cased namespace comes
        //     from the @girs package's own `gi://` specifier). `gi://*` is
        //     already claimed by gjsGiNodePlugin, so this plugin's `gi://`
        //     branch is dead on the node target either way.
        // `emptyGirs` also lifts for the explicit-register reverse-bridge case:
        // the injected register bodies (dom-elements, canvas2d, …) are genuine
        // GJS code whose `@girs/*` value imports must route through to
        // `requireGi`, exactly like the ambient-globals case.
        gjsImportsEmptyPlugin({
            emptyGirs: !(input.pluginOptions.nodeGiGlobalsInject || registerInject),
        }),
        aliasPlugin({ entries: flattenAliases(aliasMap) }),
        // Blueprint (.blp → XML string): the reverse bridge runs REAL GTK on
        // Node, so a GJS app entry (composite-template windows) must build for
        // `--app node` too. Only claims `.blp` files — inert for plain-Node
        // bundles. Same plugin the gjs/browser targets compose.
        blueprintPlugin() as RolldownPluginOption,
        deepkitPlugin({ reflection: input.pluginOptions.reflection }),
        // CSS-as-string. For a node-gi build (the reverse bridge runs REAL GTK on
        // Node — `nodeGiGlobalsInject`, the same signal that keeps `@girs/*` bodies
        // above), lower the CSS to GTK 4's subset with `firefox: 60 << 16` — exactly
        // as `--app gjs` does — so modern authoring (nesting, `&`, …) is FLATTENED
        // before it reaches `Gtk.CssProvider.load_from_string`. Without this GTK 4's
        // CSS parser rejects nested rules at runtime ("Expected ';'/an identifier"
        // theme-parser warnings, styles silently dropped — the Learn6502 app-gnome
        // symptom). A plain-Node bundle (no node-gi) keeps the CSS pristine.
        cssAsStringPlugin(input.pluginOptions.nodeGiGlobalsInject ? { targets: { firefox: 60 << 16 } } : {}),
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
