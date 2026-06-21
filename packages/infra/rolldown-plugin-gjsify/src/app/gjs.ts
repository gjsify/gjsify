// `--app gjs` Rolldown configuration factory.
//
// Mirrors the esbuild predecessor's `setupForGjs` exactly in terms of the
// effective build behaviour: same externals, same alias map, same target
// (firefox140 for JS, firefox60 for CSS), same console-shim injection,
// same process-stub banner, same `random-access-file` fs-backed-fallback.
//
// Returns a partial `RolldownOptions` template plus the plugin array the
// caller should compose with their user-supplied options. Library mode is
// handled separately by `setupLib`.

import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type * as NodeFs from 'node:fs';
import type * as NodeModule from 'node:module';
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';
import { aliasPlugin } from '../plugins/alias.js';
import { externalsPlugin } from '../plugins/externals.js';

import { deepkitPlugin } from '@gjsify/rolldown-plugin-deepkit';
import blueprintPlugin from '@gjsify/vite-plugin-blueprint';

import type { PluginOptions } from '../types/plugin-options.js';
import { getAliasesForGjs } from '../utils/alias.js';
import { globToEntryPoints } from '../utils/entry-points.js';
import { nodeModulesPathRewritePlugin, getBundleDirFromOutput } from '../plugins/rewrite-node-modules-paths.js';
import { processStubPlugin } from '../plugins/process-stub.js';
import { cssAsStringPlugin } from '../plugins/css-as-string.js';
import { shebangPlugin, resolveShebangLine, inputShebangStripPlugin } from '../plugins/shebang.js';

const _shimDir = dirname(fileURLToPath(import.meta.url));

function resolveShim(shimName: string): string {
    // Preferred: relative to this module's directory. Works under the
    // normal Node consumer flow where `_shimDir` = `<pkg>/lib/app/`.
    const relative = resolve(_shimDir, `../shims/${shimName}.js`);
    let fs: typeof NodeFs | null = null;
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        fs = require('node:fs') as typeof NodeFs;
    } catch {
        return relative;
    }
    if (fs.existsSync(relative)) return relative;
    // Fallback: when the orchestrator is bundled into a single .mjs
    // (GJS-CLI self-host loop) `_shimDir` collapses to the bundle's
    // own directory and the relative lookup misses. createRequire's
    // resolver is `exports`-map-aware (Phase C), so the published
    // subpath export `./shims/<name>` works under both Node and GJS
    // without further walking. Each shim MUST be a `./shims/<name>`
    // subpath export in package.json for this fallback to resolve.
    try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const Module = require('node:module') as typeof NodeModule;
        const require_ = Module.createRequire(import.meta.url);
        return require_.resolve(`@gjsify/rolldown-plugin-gjsify/shims/${shimName}`);
    } catch {
        return relative;
    }
}

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
    /**
     * Shebang to prepend to the output bundle.
     *   `true`  → default `#!/usr/bin/env -S gjs -m`
     *   `false` → no shebang
     *   `"…"`   → custom line, supports `${env:NAME[:-default]}` placeholders
     */
    shebang?: boolean | string;
    /** Plugin options forwarded to sub-plugins (deepkit, css, …). */
    pluginOptions: PluginOptions;
}

export const setupForGjs = async (input: GjsFactoryInput): Promise<GjsBuildConfig> => {
    const userExternal = input.userExternal ?? [];
    // Externals policy — enforced in TWO serializable forms so it is
    // identical under npm rolldown (Node) AND `@gjsify/rolldown-native`
    // (the GJS-default engine, which JSON.stringify's its options to the
    // Rust core and silently DROPS function values — the bug class that
    // already shipped via app/node.ts and library/lib.ts predicates):
    //
    //   1. `options.external` = a plain string array of EXACT names
    //      (`cairo`/`gettext`/`system` + user `bundler.external` entries).
    //      Arrays serialize fine on both engines.
    //   2. `externalsPlugin(external)` in the plugin chain for the SHAPE
    //      rules an exact array can't express (`gi://` prefix match) —
    //      a resolveId hook returning `{ external: true }` is honoured by
    //      both engines via `normalizeResolveIdResult`.
    //
    // `exactExternal` filters out register subpaths so a user external
    // entry can never override the force-inline carve-out below.
    const exactExternal = ['cairo', 'gettext', 'system', ...userExternal.filter((id) => !isRegisterSubpath(id))];
    const external = createGjsExternalsPredicate(userExternal);
    const format = input.pluginOptions.format ?? 'esm';

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    // unicorn-magic gates its full API behind the "node" conditional
    // exports. We deliberately omit `node` from conditionNames (some
    // packages ship genuinely Node-only code there — see comment
    // around `conditionNames` below). Route the package to our
    // bundled shim so the API is reachable under --app gjs without
    // turning on the node condition globally.
    const unicornMagicShim = resolveShim('unicorn-magic');

    const aliasMap = {
        ...getAliasesForGjs({ external }),
        'unicorn-magic': unicornMagicShim,
        ...input.pluginOptions.aliases,
        ...input.userAliases,
    };

    // The console shim replaces all `console` references with print()/printerr()-
    // based implementations that bypass GLib.log_structured() — no prefix,
    // ANSI codes work. Disabled via `pluginOptions.consoleShim === false`.
    //
    // Path resolution: `resolve(_shimDir, '../shims/...')` works in normal
    // Node consumption (_shimDir = `<pkg>/lib/app/`). When the CLI is
    // bundled into a single .mjs (e.g. the GJS-CLI self-host loop),
    // `import.meta.url` collapses to the bundle's path and the relative
    // resolution lands at a non-existent location. Walk up via
    // createRequire's node_modules-aware resolver as a fallback.
    const consoleShimEnabled = input.pluginOptions.consoleShim !== false;
    const consoleShimPath = consoleShimEnabled ? resolveShim('console-gjs') : null;

    // The auto-globals inject stub (when present) is side-effect-imported
    // via a virtual entry — its register modules write to globalThis, so
    // the import chain matters but no name binding does. We can't use
    // Rolldown's `inject` for this because the auto-globals invariant
    // forbids source-AST rewrites for global identifiers (false positives
    // from isomorphic guards / bracket access — see AGENTS.md).
    const sideEffectImports: string[] = [];
    if (input.pluginOptions.autoGlobalsInject) sideEffectImports.push(input.pluginOptions.autoGlobalsInject);

    const virtualEntries = wrapInputWithSideEffects(entryPoints, sideEffectImports, {
        preserveDefaultExport: input.pluginOptions.preserveDefaultExport === true,
    });
    const finalInput = virtualEntries.input;

    const options: RolldownOptions = {
        input: finalInput,
        platform: 'neutral',
        // EXACT names only — the `gi://` prefix + register-subpath shape
        // rules live in `externalsPlugin` below (see the policy note at
        // the top of this function). A function predicate here would be
        // silently dropped by the native engine's JSON options boundary.
        external: exactExternal,
        // 'browser' field is needed so packages like create-hash, create-hmac,
        // randombytes use their pure-JS browser entry instead of index.js
        // (which does require('crypto') and causes circular dependencies via
        // the crypto → @gjsify/crypto alias).
        resolve: {
            mainFields: format === 'esm' ? ['browser', 'module', 'main'] : ['browser', 'main', 'module'],
            // ESM: omit 'require' — packages listing 'require' before 'import'
            // would silently route through their CJS entry.
            //
            // We deliberately do NOT add `'node'` here. Per Node's exports-map
            // spec the resolver iterates keys in DECLARATION ORDER and picks
            // the first one whose name is in `conditionNames` — the order of
            // conditionNames itself is irrelevant. Packages like
            // `cross-fetch-ponyfill` declare `"node"` first in their exports
            // map and ship a Node-only entry that imports `blobFrom`/
            // `fileFrom` (from native `node:fetch`). With `node` enabled,
            // the resolver picks that branch over `browser` and the bundle
            // breaks at link time. Packages that genuinely need their `node`
            // export under GJS (rare — only one known case so far,
            // `unicorn-magic`'s `traversePathUp`) are handled with explicit
            // resolve aliases instead.
            conditionNames: format === 'esm' ? ['browser', 'import'] : ['browser', 'require', 'import'],
        },
        transform: {
            // Compile target: GJS 1.86 / SpiderMonkey 140 ≈ firefox140.
            target: 'firefox140',
            define: {
                global: 'globalThis',
                window: 'globalThis',
                'process.env.READABLE_STREAM': '"disable"',
            },
            // Console shim: rewrite bare `console` references to a named
            // import from our shim module. We use Rolldown's `inject`
            // (Oxc-driven, lives under `transform`) because:
            //   1. `globalThis.console` is non-configurable on SpiderMonkey
            //      128 so a register-style global write throws.
            //   2. We're replacing console unconditionally — there's no
            //      tree-shake-aware detection concern that motivated the
            //      auto-globals invariant.
            ...(consoleShimPath ? { inject: { console: [consoleShimPath, 'console'] } } : {}),
        },
        output: {
            ...input.output,
            format,
            sourcemap: false,
            // App builds emit a single bundle file. Disable code-splitting
            // so dynamic imports get inlined and the entire program lands
            // in one chunk that matches `gjsify build --outfile foo.js`.
            // (`codeSplitting: false` replaces the deprecated
            // `inlineDynamicImports: true` in Rolldown ≥ 1.0-rc.18.)
            codeSplitting: false,
        },
        treeshake: true,
    };

    const bundleDir = getBundleDirFromOutput(input.output);

    const plugins: RolldownPluginOption[] = [
        // Virtual-entry plugin runs FIRST so its resolveId/load match the
        // synthetic input ids that `wrapInputWithSideEffects` produces.
        ...(virtualEntries.plugin ? [virtualEntries.plugin] : []),
        // Strip leading #! from any input module BEFORE bundling — otherwise
        // a shebang in e.g. the CLI's own entry file ends up embedded
        // mid-chunk after our process-stub banner, and acorn (auto-globals
        // detector) rejects the `#` byte. Final-output shebang is composed
        // by shebangPlugin's renderChunk hook.
        inputShebangStripPlugin(),
        // random-access-file's 'browser' field maps to a throwing stub; force
        // the fs-backed Node entry. Implemented via the gjsify alias plugin
        // as a direct entry-table override.
        aliasPlugin({
            entries: {
                'random-access-file': 'random-access-file/index.js',
                ...flattenAliases(aliasMap),
            },
        }),
        // Enforce the full `--app gjs` externals policy (gi:// prefix,
        // exact names, register-subpath force-inline) via resolveId —
        // the only form BOTH engines honour (the native engine drops
        // function `external` options at its JSON boundary). Runs after
        // the alias plugin's `pre`-order resolveId so aliases apply first.
        externalsPlugin(external, { name: 'gjsify-gjs-externalize' }),
        blueprintPlugin() as RolldownPluginOption,
        deepkitPlugin({ reflection: input.pluginOptions.reflection }),
        // GTK4's CSS engine is much older than browser engines — its
        // parser predates nesting + many modern selectors. Targeting
        // `firefox: 60 << 16` makes lightningcss flatten the source
        // into the subset GTK4 understands.
        cssAsStringPlugin({ targets: { firefox: 60 << 16 } }),
        nodeModulesPathRewritePlugin({ bundleDir, runtimeResolve: format === 'esm' }),
        processStubPlugin({ userBanner: input.userBanner, captureBundleUrl: format === 'esm' }),
        // resolveShebangLine returns null when disabled (false/undefined) and
        // the resolved line otherwise — also handles `${env:…}` expansion.
        (() => {
            const line = resolveShebangLine(input.shebang);
            return shebangPlugin({ enabled: line !== null, line: line ?? undefined });
        })(),
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
    opts: { preserveDefaultExport?: boolean } = {},
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

    const sideEffectImports = sideEffects.map((p) => `import ${JSON.stringify(p)};`).join('\n');

    // Resolved real-path targets from `userEntries` get their
    // moduleSideEffects forced to 'no-treeshake' so the user-entry's
    // top-level body (`run({...})`, side-effect calls) survives tree-shake
    // even when its package.json restricts sideEffects to register files.
    const resolvedTargets = new Set<string>();

    const plugin: RolldownPluginOption = {
        name: 'gjsify-virtual-entry',
        async resolveId(source, _importer) {
            if (source.startsWith(PREFIX)) return source;
            // Force-mark the resolved user-entry target as having
            // top-level side effects.
            if (resolvedTargets.has(source)) {
                return { id: source, moduleSideEffects: 'no-treeshake' };
            }
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
            resolvedTargets.add(target);
            // The bare `export * from <target>` re-exports named bindings
            // but does NOT execute the source module's top-level body. A
            // companion side-effect-only `import <target>` plus our
            // resolveId-side `moduleSideEffects: 'no-treeshake'` mark
            // forces the body to run — `run({...})` calls in test entries,
            // top-level await, etc.
            //
            // `export *` also never carries the `default` export. For an
            // executable that's irrelevant, but a library bundle imported for
            // its default API (a bundler plugin) needs it preserved. When
            // requested, import the target as a namespace (which also runs the
            // body, so it doubles as the side-effect import) and re-export its
            // `default` — safely `undefined` when the entry has none.
            if (opts.preserveDefaultExport) {
                const ns = '__gjsify_entry__';
                return {
                    code:
                        `${sideEffectImports}\nimport * as ${ns} from ${JSON.stringify(target)};\n` +
                        `export * from ${JSON.stringify(target)};\nexport default ${ns}.default;\n`,
                    moduleSideEffects: 'no-treeshake',
                };
            }
            return {
                code: `${sideEffectImports}\nimport ${JSON.stringify(target)};\nexport * from ${JSON.stringify(target)};\n`,
                moduleSideEffects: 'no-treeshake',
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

/**
 * Build the canonical `--app gjs` externals predicate:
 *
 *   - `@gjsify/<pkg>/register[/<feature>]` (and the bare `<pkg>/register`
 *     form) MUST NEVER be externalized — these are the side-effect entry
 *     points `--globals auto` injects to wire up
 *     `globalThis.{Buffer,fetch,…}`. GJS's native ESM loader has no
 *     node_modules walker AND does not follow `package.json#exports` maps
 *     for bare specifiers, so an externalized
 *     `import '@gjsify/buffer/register/buffer'` throws `Module not found`
 *     at runtime even when the file is on disk via the exports map.
 *     Inlining is the only safe option — the exclusion is by SHAPE
 *     (`isRegisterSubpath`), not an explicit package list, so it scales
 *     to every package added by the tree-shakeable-globals convention.
 *     It short-circuits BEFORE the user-external check so `bundler.external`
 *     can never override it. See AGENTS.md §Tree-shakeable globals.
 *   - `gi://*` URIs are external by prefix (GJS-native imports).
 *   - `cairo`/`gettext`/`system` + user externals match by exact name.
 *
 * Used by `setupForGjs` for the in-process alias layer AND as the
 * predicate behind `externalsPlugin` (resolveId `{ external: true }`,
 * honoured by both bundler engines). Exported for the regression tests
 * in `auto-globals.spec.ts` — canonical contract, change-detector status.
 */
export function createGjsExternalsPredicate(userExternal: string[] = []): (id: string) => boolean {
    const exact = ['cairo', 'gettext', 'system', ...userExternal];
    return (id: string): boolean => {
        if (isRegisterSubpath(id)) return false;
        if (id.startsWith('gi://')) return true;
        if (exact.includes(id)) return true;
        return false;
    };
}

/**
 * Recognize the `/register` and `/register/<feature>` subpath shapes that
 * `--globals auto` injects into the bundle as side-effect imports.
 *
 * Matches every shape that goes through the alias layer + Rolldown
 * resolution chain to a `@gjsify/<pkg>/register*` target:
 *   - bare:           `<pkg>/register`, `<pkg>/register/<feature>`
 *   - fully qualified `@gjsify/<pkg>/register`, `@gjsify/<pkg>/register/<feature>`
 *   - resolved disk paths under a real `node_modules/<scope>/<pkg>/lib/esm/register*`
 *
 * Used by the `--app gjs` externals predicate to force-inline these even
 * when the user passes them via `bundler.external`. Exported for direct
 * use by the regression test in `auto-globals.spec.ts`; this is the
 * canonical contract — change-detector status. Keep in sync with the
 * `AGENTS.md` §Tree-shakeable globals subpath convention.
 */
export function isRegisterSubpath(id: string): boolean {
    // Source-shape: a bare or fully-qualified specifier ending in
    // `/register` or `/register/<feature>`. The leading `/` rules out
    // false positives like `register` (the bare word) or
    // `@scope/unregister`.
    //
    //   ✓ `fetch/register`
    //   ✓ `@gjsify/buffer/register`
    //   ✓ `@gjsify/node-globals/register/buffer`
    //   ✗ `register`        (no `/` prefix)
    //   ✗ `@scope/unregister`  (the `/` is followed by `un`, not `register`)
    //   ✗ `foo/register.js?query=1`  (query-suffix → treat as resolved-path,
    //                                  caught by the second branch only when
    //                                  the file extension is intact)
    if (/\/register(?:\/[^?]*)?$/.test(id)) {
        return true;
    }
    // Resolved disk-path shape — Rolldown sees these after the alias
    // plugin + node_modules resolver run. Matches both ESM build output
    // (`lib/esm/register/<feature>.js`) and any future TS-direct setup
    // that points the export at `src/register/<feature>.ts`. Strictly
    // requires the file extension at the end — a Rolldown synthetic-id
    // suffix like `?query=1` therefore does NOT match (those callers
    // expect to flow through the normal externals path).
    if (/[/\\]register(?:[/\\][^/\\]+)?\.(?:[mc]?js|ts)$/.test(id)) {
        return true;
    }
    return false;
}
