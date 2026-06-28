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
import { nodeModulesPathRewritePlugin, getBundleDirFromOutput } from '../plugins/rewrite-node-modules-paths.js';
import { cssAsStringPlugin } from '../plugins/css-as-string.js';
import { gjsImportsEmptyPlugin } from '../plugins/gjs-imports-empty.js';
import { gjsGiNodePlugin } from '../plugins/gjs-gi-node.js';

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
    // they are intercepted by `gjsImportsEmptyPlugin` (added to the plugins
    // array below) and redirected to a virtual empty ESM module. Marking them
    // external would leave bare `import 'gi://Gio?version=2.0'` strings in the
    // output that Node's default ESM loader rejects with
    // `ERR_UNSUPPORTED_ESM_URL_SCHEME`. The empty-module redirect makes node
    // bundles of cross-platform packages (which transitively import @girs/*
    // via *.gjs.spec / direct internal imports) loadable on Node — the GJS-
    // only code paths are still gated at runtime by `on('Gjs', …)` or by
    // `typeof globalThis.imports !== 'undefined'` guards.
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

    const aliasMap = {
        ...getAliasesForNode({ external }),
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
        input: entryPoints,
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
        // gjsGiNodePlugin runs FIRST (resolveId order 'pre' + array order): it
        // claims `gi://Ns?version=X` and rewrites it to the `@gjsify/node-gi`
        // runtime, so a real GJS/GI source builds + runs on Node. It returns
        // null for `@girs/*`, which then falls through to gjsImportsEmptyPlugin
        // (those ambient/type packages map to an empty module on Node).
        gjsGiNodePlugin(),
        // gjsImportsEmptyPlugin then intercepts the remaining `@girs/*` (and any
        // `gi://` not claimed above) before `aliasPlugin` and the default
        // resolver. Same composition order as `app/browser.ts`.
        gjsImportsEmptyPlugin(),
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
