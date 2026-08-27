// `--app gjs` Rolldown configuration factory: returns a partial
// `RolldownOptions` template plus the plugin array the caller composes with
// their user options. Library mode is `setupLib`.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';
import { aliasPlugin } from '../plugins/alias.js';
import { externalsPlugin } from '../plugins/externals.js';
import { napiNodeAddonPlugin } from '../plugins/napi-node-addon.js';
import { unresolvedWorkspaceImportPlugin } from '../plugins/unresolved-workspace-import.js';
import {
    platformResolvePlugin,
    desktopSuffixChain,
    desktopOsSuffix,
    DESKTOP_REFUSED_SUFFIXES,
} from '../plugins/platform-resolve.js';
import { reactNativeAliasPlugin } from '../plugins/react-native-alias.js';
import { reactNativeSupportGatePlugin } from '../plugins/react-native-gate.js';

import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';

import type { PluginOptions } from '../types/plugin-options.js';
import { getAliasesForGjs } from '../utils/alias.js';
import { globToEntryPoints } from '../utils/entry-points.js';
import { nodeModulesPathRewritePlugin, getBundleDirFromOutput } from '../plugins/rewrite-node-modules-paths.js';
import { processStubPlugin } from '../plugins/process-stub.js';
import type { GiSystemProbe } from '../plugins/gi-runtime-paths.js';
import { cssAsStringPlugin } from '../plugins/css-as-string.js';
import { shebangPlugin, resolveShebangLine, inputShebangStripPlugin } from '../plugins/shebang.js';
import { wrapInputWithSideEffects } from '../utils/entry-wrapper.js';

const _shimDir = dirname(fileURLToPath(import.meta.url));

/**
 * Resolve one of this package's bundled shims to an absolute path.
 *
 * `createRequire` is used only for its `exports`-map-aware RESOLVER; nothing is
 * loaded through it (this source is ESM — see AGENTS.md "no bare `require`").
 */
function resolveShim(shimName: string): string {
    // Normal Node consumption: `_shimDir` = `<pkg>/lib/app/`.
    const relative = resolve(_shimDir, `../shims/${shimName}.js`);
    if (existsSync(relative)) return relative;
    // Fallback for the bundled-orchestrator case (GJS-CLI self-host loop):
    // `_shimDir` collapses to the bundle's own directory and the relative lookup
    // misses. Every shim MUST therefore be a `./shims/<name>` subpath export in
    // package.json.
    try {
        return createRequire(import.meta.url).resolve(`@gjsify/rolldown-plugin-gjsify/shims/${shimName}`);
    } catch (cause) {
        // Throw rather than return the unverified `relative`: a non-existent
        // path in the alias map resurfaces much later as an unrelated "could not
        // resolve" naming a path nobody wrote.
        throw new Error(
            `@gjsify/rolldown-plugin-gjsify: cannot locate the "${shimName}" shim. ` +
                `Tried ${relative} and the "./shims/${shimName}" subpath export.`,
            { cause },
        );
    }
}

/** Resolved Rolldown configuration template + plugins for `--app gjs`. */
export interface GjsBuildConfig {
    /** Transforms that must see the ORIGINAL source; composed before the caller's plugins. */
    prePlugins: RolldownPluginOption[];
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
    /**
     * Shebang to prepend to the output bundle.
     *   `true`  → default `#!/usr/bin/env -S gjs -m`
     *   `false` → no shebang
     *   `"…"`   → custom line, supports `${env:NAME[:-default]}` placeholders
     */
    shebang?: boolean | string;
    /**
     * System GI library dirs the byte-1 prologue tries at RUNTIME — see `GiSystemProbe`.
     * The only half a build can honestly fill: the build machine is not the host that
     * runs the bundle, so what travels is a candidate plus the markers that decide it
     * there. See `GjsifyPluginInput.giSystemProbes` for why the relative half is absent.
     */
    giSystemProbes?: readonly GiSystemProbe[];
    /** Plugin options forwarded to sub-plugins (deepkit, css, …). */
    pluginOptions: PluginOptions;
}

export const setupForGjs = async (input: GjsFactoryInput): Promise<GjsBuildConfig> => {
    const userExternal = input.userExternal ?? [];
    // Externals policy in TWO forms, because `@gjsify/rolldown-native` (the
    // GJS-default engine) JSON.stringify's its options to the Rust core and
    // silently DROPS function values:
    //   1. `options.external` = a plain string array of EXACT names — arrays
    //      serialize on both engines.
    //   2. `externalsPlugin(external)` for the SHAPE rules an exact array can't
    //      express (`gi://` prefix) — a resolveId `{ external: true }` is
    //      honoured by both engines.
    // `exactExternal` filters out register subpaths so a user external entry can
    // never override the force-inline carve-out below.
    const exactExternal = [
        'cairo',
        'gettext',
        'system',
        ...userExternal.filter((id) => !isRegisterSubpath(id) && !isGjsifyShim(id)),
    ];
    const external = createGjsExternalsPredicate(userExternal);
    const format = input.pluginOptions.format ?? 'esm';

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    // unicorn-magic gates its full API behind the "node" condition, which we
    // deliberately omit globally (see `conditionNames` below). Route it to our
    // bundled shim instead of turning the condition on for every package.
    const unicornMagicShim = resolveShim('unicorn-magic');

    const aliasMap = {
        ...getAliasesForGjs({ external }),
        'unicorn-magic': unicornMagicShim,
        ...input.pluginOptions.aliases,
        ...input.userAliases,
    };

    // The console shim replaces all `console` references with print()/printerr()-
    // based implementations that bypass GLib.log_structured() — no prefix,
    // ANSI codes work.
    const consoleShimEnabled = input.pluginOptions.consoleShim !== false;
    const consoleShimPath = consoleShimEnabled ? resolveShim('console-gjs') : null;

    // The auto-globals inject stub is side-effect-imported via a virtual entry:
    // its register modules write to globalThis, so the import chain matters but
    // no name binding does. Rolldown's `inject` is not usable here — the
    // auto-globals invariant forbids source-AST rewrites for global identifiers
    // (see AGENTS.md § `--globals` modes).
    const sideEffectImports: string[] = [];
    if (input.pluginOptions.autoGlobalsInject) sideEffectImports.push(input.pluginOptions.autoGlobalsInject);

    const virtualEntries = wrapInputWithSideEffects(entryPoints, sideEffectImports, {
        preserveDefaultExport: input.pluginOptions.preserveDefaultExport === true,
    });
    const finalInput = virtualEntries.input;

    const options: RolldownOptions = {
        input: finalInput,
        platform: 'neutral',
        // EXACT names only — see the externals policy note above.
        external: exactExternal,
        // 'browser' first so packages like create-hash/create-hmac/randombytes
        // take their pure-JS browser entry instead of an index.js that
        // `require('crypto')`s and cycles back through the @gjsify/crypto alias.
        resolve: {
            mainFields: format === 'esm' ? ['browser', 'module', 'main'] : ['browser', 'main', 'module'],
            // NEITHER 'import' NOR 'require' belongs here — rolldown adds the
            // one matching each CALL SITE, and naming either explicitly applies
            // it to both kinds. The exports-map resolver takes the PACKAGE's
            // first key our list contains, so `'import'` here made a require()
            // call match an `import` key declared first, handing a CJS consumer
            // an ESM namespace where it expects `module.exports`. MEASURED on the
            // express showcase: `is-promise@4` declares `[{import,require,default}, …]`
            // in that order, so `router`'s `require('is-promise')` bound
            // `{default: fn}` and every request threw `TypeError: n is not a
            // function` — answered 200 anyway, and express logged `err.stack`,
            // which carries no message line on SpiderMonkey, so the flagship
            // slide printed ~59 anonymous frames per request naming nothing.
            //
            // `'node'` is absent for a different reason: it hands
            // `cross-fetch-ponyfill` its Node-only entry, which imports
            // `blobFrom`/`fileFrom` and breaks the bundle at link time. Packages
            // that genuinely need their `node` export under GJS (so far only
            // `unicorn-magic`'s `traversePathUp`) get an explicit alias.
            conditionNames: ['browser'],
        },
        transform: {
            // GJS 1.86 / SpiderMonkey 140 ≈ firefox140.
            target: 'firefox140',
            define: {
                global: 'globalThis',
                window: 'globalThis',
                'process.env.READABLE_STREAM': '"disable"',
            },
            // Rewrite bare `console` to a named import from our shim. Rolldown's
            // `inject` (not a register-style global write) because GJS defines
            // `globalThis.console` non-writable + non-configurable, so assigning
            // to it silently no-ops. Safe here where the auto-globals invariant
            // forbids AST rewrites: console is replaced unconditionally, so there
            // is no tree-shake-aware detection to defeat.
            ...(consoleShimPath ? { inject: { console: [consoleShimPath, 'console'] } } : {}),
        },
        output: {
            ...input.output,
            format,
            sourcemap: false,
            // App builds emit a single bundle file: dynamic imports inline and
            // the whole program lands in one chunk matching `--outfile`.
            codeSplitting: false,
        },
        treeshake: true,
    };

    const bundleDir = getBundleDirFromOutput(input.output);

    // The substitution table exactly as `aliasPlugin` receives it — shared with
    // the unresolved-workspace-import guard below so the guard reports the same
    // promise the alias layer made.
    const aliasEntries = {
        'random-access-file': 'random-access-file/index.js',
        ...flattenAliases(aliasMap),
    };

    // Reflection reads the ORIGINAL TypeScript, so it runs before any user
    // transform can strip the annotations out from under it (see `GjsifyConfig`).
    const prePlugins: RolldownPluginOption[] = [deepkitPlugin({ reflection: input.pluginOptions.reflection })];
    // ADR 0032 § 8's build-time gate reads the ORIGINAL source for the same reason
    // reflection does: `import type { ViewProps }` is what tells it a name costs
    // nothing, and a normal-order transform may already have stripped it.
    if (input.pluginOptions.reactNative) prePlugins.push(reactNativeSupportGatePlugin());

    const plugins: RolldownPluginOption[] = [
        // Virtual-entry plugin runs FIRST so its resolveId/load match the
        // synthetic input ids that `wrapInputWithSideEffects` produces.
        ...(virtualEntries.plugin ? [virtualEntries.plugin] : []),
        // Strip leading #! from every input module BEFORE bundling: a shebang in
        // e.g. the CLI's own entry would end up mid-chunk after the process-stub
        // banner, and acorn (the auto-globals detector) rejects the `#` byte.
        // The final-output shebang is composed by shebangPlugin's renderChunk.
        inputShebangStripPlugin(),
        // Platform-file forks for the desktop, ADR 0032 § 9: `.gtk` → `.<os>` →
        // `.desktop` → base. BEFORE the alias layer, so a platform fork of a
        // module that also has a Node-builtin substitution wins over the
        // substitution — the fork is the more specific statement. `.native` and
        // `.web` are deliberately absent from the chain and warned about when
        // present; `DESKTOP_REFUSED_SUFFIXES` carries the reason.
        platformResolvePlugin({
            suffixes: desktopSuffixChain(desktopOsSuffix()),
            refusedSuffixes: DESKTOP_REFUSED_SUFFIXES,
            siblingIndex: true,
        }),
        // ADR 0032 § 2's alias line, only when the consumer asked for it
        // (`--react-native`). `pre`, ahead of the substitution table and the
        // externals policy — a redirect after `externalsPlugin` would find the
        // specifier already externalised.
        ...(input.pluginOptions.reactNative ? [reactNativeAliasPlugin()] : []),
        // random-access-file's 'browser' field maps to a throwing stub; the alias
        // table forces the fs-backed Node entry.
        aliasPlugin({ entries: aliasEntries }),
        // Transparent N-API `.node`-addon loader (the forward mirror of
        // `gjsGiNodePlugin`): claims a native-addon acquisition
        // (`bindings`/`node-gyp-build`/a direct `.node`/a napi-rs platform
        // sibling) and rewrites it to a virtual module returning `loadAddon()`
        // from `@gjsify/napi`, which is BUNDLED, not external. Order matters:
        // after aliasPlugin so a user alias pinning an addon's native entry wins,
        // before externalsPlugin so the acquisition is claimed first. Inert
        // otherwise; `--app gjs` only.
        napiNodeAddonPlugin(),
        // Externals policy as a resolveId hook — the only form BOTH engines
        // honour. Runs after the alias plugin's `pre` resolveId so aliases apply
        // first.
        externalsPlugin(external, { name: 'gjsify-gjs-externalize' }),
        blueprintPlugin() as RolldownPluginOption,
        // GTK4's CSS engine is much older than browser engines — its
        // parser predates nesting + many modern selectors. Targeting
        // `firefox: 60 << 16` makes lightningcss flatten the source
        // into the subset GTK4 understands.
        cssAsStringPlugin({ targets: { firefox: 60 << 16 } }),
        nodeModulesPathRewritePlugin({ bundleDir, runtimeResolve: format === 'esm' }),
        processStubPlugin({
            userBanner: input.userBanner,
            captureBundleUrl: format === 'esm',
            giSystemProbes: input.giSystemProbes,
        }),
        // resolveShebangLine returns null when disabled, else the resolved line
        // with `${env:…}` expanded.
        (() => {
            const line = resolveShebangLine(input.shebang);
            return shebangPlugin({ enabled: line !== null, line: line ?? undefined });
        })(),
        // LAST claim on an id nothing else wanted (`order: 'post'`): an
        // unresolvable `@gjsify/*` substitution is a build ERROR, not a silent
        // external. Otherwise Rolldown externalises the ORIGINAL specifier, exits
        // 0, and writes a bundle stock GJS aborts on at load (`ImportError:
        // Unsupported URI scheme for importing: node`) — the same failure
        // `utils/gjs-bundle-guard.ts` catches at emit time, caught here at its
        // source with the importer and cause named.
        unresolvedWorkspaceImportPlugin({
            target: 'gjs',
            aliases: aliasEntries,
            isExternal: external,
            ...(input.pluginOptions.toolchainAnchor !== undefined
                ? { toolchainAnchor: input.pluginOptions.toolchainAnchor }
                : {}),
        }),
    ];

    return { options, prePlugins, plugins };
};

/** Copy the alias map, dropping entries with an empty target. */
function flattenAliases(map: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [from, to] of Object.entries(map)) {
        if (to) out[from] = to;
    }
    return out;
}

/**
 * The canonical `--app gjs` externals predicate — used both for the in-process
 * alias layer and as the predicate behind `externalsPlugin`. Pinned by
 * `packages/infra/cli/src/auto-globals.spec.ts`.
 *
 *   - `<pkg>/register[/<feature>]` MUST NEVER be externalized: GJS's ESM loader
 *     has no node_modules walker and does not follow `exports` maps for bare
 *     specifiers, so an externalized `import '@gjsify/buffer/register/buffer'`
 *     throws `Module not found` at runtime even with the file on disk. Matched by
 *     SHAPE (`isRegisterSubpath`) so it scales to every package following the
 *     tree-shakeable-globals convention, and short-circuited BEFORE the
 *     user-external check so `bundler.external` cannot override it.
 *   - `gi://*` external by prefix; `cairo`/`gettext`/`system` + user externals by
 *     exact name.
 */
export function createGjsExternalsPredicate(userExternal: string[] = []): (id: string) => boolean {
    const exact = ['cairo', 'gettext', 'system', ...userExternal];
    return (id: string): boolean => {
        if (isRegisterSubpath(id) || isGjsifyShim(id)) return false;
        if (id.startsWith('gi://')) return true;
        if (exact.includes(id)) return true;
        return false;
    };
}

/**
 * Recognize the shims this plugin INJECTS into a `--app gjs` bundle, in both
 * bare-specifier and resolved-disk-path form.
 *
 * Force-inlined for the same reason `/register` subpaths are, with the same
 * failure: GJS has no `require` and its ESM loader follows neither node_modules
 * nor `exports` maps, so an externalized shim aborts at load with `Calling
 * \`require\` for "…/shims/module-resolve" in an environment that doesn't expose
 * the \`require\` function`. The shim is never optional — the bundler injected it
 * because the bundle needs it. Short-circuits BEFORE the user-external check, and
 * matches by SHAPE so a later shim is covered without touching this predicate.
 * Deliberately scoped to OUR shim directory only.
 */
export function isGjsifyShim(id: string): boolean {
    // Bare/fully-qualified: `@gjsify/rolldown-plugin-gjsify/shims/<name>`.
    if (/@gjsify\/rolldown-plugin-gjsify\/shims\/[^?]+$/.test(id)) return true;
    // Resolved disk path: `…/rolldown-plugin-gjsify/{lib,src}/shims/<name>.js`.
    return /[\\/]rolldown-plugin-gjsify[\\/](?:lib|src)[\\/]shims[\\/]/.test(id);
}

/**
 * Recognize the `/register[/<feature>]` subpath shapes `--globals auto` injects
 * as side-effect imports, in bare, fully-qualified and resolved-disk-path form.
 *
 * Used by the `--app gjs` externals predicate to force-inline these even when the
 * user lists them in `bundler.external`. Pinned by
 * `packages/infra/cli/src/auto-globals.spec.ts`; keep in sync with AGENTS.md
 * § Tree-shakeable globals.
 */
export function isRegisterSubpath(id: string): boolean {
    // Source shape. The required leading `/` rules out the bare word `register`
    // and `@scope/unregister`.
    if (/\/register(?:\/[^?]*)?$/.test(id)) {
        return true;
    }
    // Resolved disk-path shape (post alias plugin + node_modules resolver), for
    // both `lib/esm/register/<feature>.js` and a TS-direct `src/register/<feature>.ts` export. The
    // extension is required, so a Rolldown synthetic-id suffix (`?query=1`) falls
    // through to the normal externals path on purpose.
    if (/[/\\]register(?:[/\\][^/\\]+)?\.(?:[mc]?js|ts)$/.test(id)) {
        return true;
    }
    return false;
}
