// Library mode — multi-entry, unbundled output for republication on npm.
//
// Equivalent to esbuild's `bundle: false`: every input file is emitted
// 1:1 with its imports preserved as-is (resolved by Rolldown). The user
// alias map is applied so `node:fs` → `fs/promises` style remappings still
// work, and the JS extension table mirrors the esbuild predecessor.
//
// Targeting `esnext` and `platform: 'neutral'` matches the original
// library config: consumers downstream (downstream apps using `gjsify
// build --app gjs|node|browser`) re-bundle and apply their own target
// lowering. Library output stays maximally portable.

import { aliasPlugin } from '../plugins/alias.js';
import { cssAsStringPlugin } from '../plugins/css-as-string.js';
import type { RolldownOptions, RolldownPluginOption } from 'rolldown';

import type { PluginOptions } from '../types/plugin-options.js';
import { globToEntryPoints } from '../utils/entry-points.js';

export interface LibBuildConfig {
    options: RolldownOptions;
    plugins: RolldownPluginOption[];
}

export interface LibFactoryInput {
    input?: RolldownOptions['input'];
    output: { file?: string; dir?: string };
    userAliases?: Record<string, string>;
    pluginOptions: PluginOptions;
}

export const setupLib = async (input: LibFactoryInput): Promise<LibBuildConfig> => {
    // Derive output format from `library: 'esm' | 'cjs'` when the caller
    // didn't pass `format` explicitly. The library type and the emitted
    // module format are inseparable: a CJS-library build that emits ESM
    // (or vice versa) is broken by definition.
    const format = input.pluginOptions.format ?? input.pluginOptions.library ?? 'esm';

    const exclude = input.pluginOptions.exclude ?? [];
    const entryPoints = await globToEntryPoints(input.input, exclude);

    // Derive `preserveModulesRoot` from the common ancestor of every
    // resolved entry. Workspaces use various roots (`src/`, `src/ts/`,
    // `lib/`); without stripping the right one, Rolldown emits paths
    // like `lib/esm/<root>/<file>.js` instead of `lib/esm/<file>.js`,
    // which doesn't match the package.json `exports` map.
    const preserveModulesRoot = computeCommonRoot(entryPoints);

    const aliasMap = {
        ...input.pluginOptions.aliases,
        ...input.userAliases,
    };

    // Library mode keeps all third-party / workspace imports as-is so the
    // emitted package re-exports its dep tree by reference. Rolldown's
    // default behaviour would inline workspace packages into the output
    // directory; we mark anything not starting with `./` or `/` as external.
    //
    // This `external` predicate is honoured by npm rolldown (Node), but
    // `@gjsify/rolldown-native` JSON.stringify's its options to the Rust core
    // which silently DROPS function values (same hazard commit 78a6042ac
    // fixed for app/node.ts). Under native rolldown — the Node-free GJS build
    // — the predicate is therefore ignored and every *resolvable* dep
    // (`@gjsify/web-streams`, `@girs/*`, `@gjsify/utils`) gets INLINED into
    // the package's own `lib/esm/` subtree. That bakes a private copy of e.g.
    // `@gjsify/web-streams` into each consumer; a later app bundle then carries
    // TWO web-streams copies whose module-level brand Symbols (`kState`/`kType`)
    // differ, so a `ReadableStream` made by one copy fails the other's
    // `isReadableStream` brand check (`transform.readable must be a
    // ReadableStream` from `Blob.stream().pipeThrough(new DecompressionStream)`).
    // The `externalizeBareImportsPlugin` below enforces the SAME policy via a
    // `resolveId` hook returning `{ external: true }`, which the native facade
    // honours (`normalizeResolveIdResult` forwards `external`) — so the engine
    // can never inline a workspace dep regardless of how it serializes options.
    const external = isExternalSpecifier;

    const options: RolldownOptions = {
        input: entryPoints,
        platform: 'neutral',
        external,
        resolve: {
            mainFields: format === 'esm' ? ['module', 'main'] : ['main'],
            conditionNames: format === 'esm' ? ['module', 'import'] : ['require'],
        },
        transform: { target: 'esnext' },
        output: {
            ...input.output,
            format,
            // Library mode = preserve module structure (multi-file output,
            // imports resolved but not bundled).
            preserveModules: true,
            // Strip the source root from the emitted paths. Without this,
            // Rolldown keeps the full project-relative path. The root is
            // computed from the common ancestor of resolved entries.
            preserveModulesRoot,
            sourcemap: false,
        },
        treeshake: false,
    };

    const plugins: RolldownPluginOption[] = [
        aliasPlugin({ entries: flattenAliases(aliasMap) }),
        // Enforce the library-mode externals policy in a form native rolldown
        // honours (the top-level `external` function is dropped under the
        // Node-free GJS build — see the note on `external` above). Runs after
        // the alias plugin's `pre`-order resolveId so user aliases still apply.
        externalizeBareImportsPlugin(),
        // Rolldown removed experimental CSS bundling — `.css` files would
        // error at the bundler level. Library-mode packages that bundle
        // CSS as a string (e.g. `@gjsify/adwaita-fonts/index.css`) need
        // the same `load` hook the app factories install. The result is a
        // tiny JS module re-exporting the CSS source, which preserveModules
        // emits 1:1.
        cssAsStringPlugin(),
    ];

    return { options, plugins };
};

/**
 * Whether a specifier should stay external in library mode: a bare /
 * scoped / protocol specifier (`@gjsify/web-streams`, `node:fs`, `gi://Gtk`)
 * is external; the package's own relative/absolute source modules — and
 * rolldown's `\0`-prefixed virtual modules (its runtime helper, plugin
 * stubs) — are bundled.
 */
function isExternalSpecifier(id: string): boolean {
    if (id.startsWith('./') || id.startsWith('../') || id.startsWith('/')) return false;
    if (id.startsWith('\0')) return false;
    return true;
}

/**
 * Externalize bare/workspace imports via a `resolveId` hook — the
 * engine-agnostic equivalent of the (native-dropped) `external` function.
 * Returning `{ id, external: true }` keeps the ORIGINAL specifier in the
 * emitted module (`preserveModules` writes `import … from '@gjsify/web-streams'`
 * unchanged) so the published package re-exports its dep tree by reference.
 */
function externalizeBareImportsPlugin(): RolldownPluginOption {
    return {
        name: 'gjsify-lib-externalize',
        resolveId(source: string, importer: string | undefined, options: { isEntry?: boolean }) {
            // Entry modules MUST be resolved + emitted, never externalized.
            // Rolldown's `external` OPTION skips entries implicitly, but a
            // resolveId HOOK fires for them too — guard on the absent importer
            // (and `isEntry`) so `src/index.ts` etc. aren't marked external.
            if (importer === undefined || options?.isEntry) return null;
            return isExternalSpecifier(source) ? { id: source, external: true } : null;
        },
    };
}

/**
 * Compute the common-ancestor directory of a set of entry paths so
 * Rolldown's `preserveModulesRoot` strips the right prefix from emitted
 * file paths. Falls back to `'src'` when there are no entries or the
 * entries don't share a meaningful prefix.
 */
function computeCommonRoot(entries: ReturnType<typeof globToEntryPoints> extends Promise<infer T> ? T : never): string {
    const paths: string[] =
        entries === undefined
            ? []
            : typeof entries === 'string'
              ? [entries]
              : Array.isArray(entries)
                ? entries
                : Object.values(entries);
    if (paths.length === 0) return 'src';

    const split = paths.map((p) => p.split('/').filter(Boolean));
    const head = split[0];
    let i = 0;
    for (; i < head.length; i++) {
        const seg = head[i];
        if (!split.every((parts) => parts[i] === seg)) break;
    }
    if (i === 0) return 'src';
    // Drop the basename if the common prefix points at a single file.
    const commonParts = head.slice(0, i);
    // Heuristic: treat the prefix as a directory when at least one path
    // has more segments after it.
    const hasMoreAfter = split.some((parts) => parts.length > i);
    return hasMoreAfter ? commonParts.join('/') : commonParts.slice(0, -1).join('/') || 'src';
}

function flattenAliases(map: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [from, to] of Object.entries(map)) {
        if (to) out[from] = to;
    }
    return out;
}
