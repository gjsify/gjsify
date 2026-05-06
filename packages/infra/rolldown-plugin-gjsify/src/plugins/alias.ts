// Custom alias plugin — `@rollup/plugin-alias` returns the rewritten
// specifier as the resolved id, then leaves Rolldown's default resolver to
// load it. That fails for workspace package targets (`@gjsify/crypto` etc.)
// when the importer's package.json doesn't list them as direct deps —
// Rolldown rejects packages that aren't declared in the importer's manifest
// even when they exist in a hoisted workspace `node_modules`.
//
// This plugin instead calls `this.resolve(target, importer, { skipSelf: true })`
// which goes through the full plugin chain (including any subsequent resolvers)
// and resolves to a real file path the default loader can read.
//
// Behaviour preserved from the esbuild predecessor's `aliasPlugin`:
//   - exact string match (no prefix-aware semantics needed at this layer)
//   - `node:<name>` specifiers map to the same target as `<name>`
//     (handled in the alias-builder helpers, not here).

import type { Plugin } from 'rolldown';

export interface AliasPluginOptions {
    entries: Record<string, string>;
}

export function aliasPlugin(options: AliasPluginOptions): Plugin {
    const entries = options.entries;
    const keys = Object.keys(entries);

    return {
        name: 'gjsify-alias',
        resolveId: {
            order: 'pre' as const,
            async handler(source, importer) {
                if (!Object.prototype.hasOwnProperty.call(entries, source)) {
                    return null;
                }
                const target = entries[source];
                // Self-reference guard: if a user maps a specifier to itself
                // (rare but legal), skip to avoid infinite loops.
                if (target === source) return null;

                const resolved = await this.resolve(target, importer, {
                    skipSelf: true,
                });
                if (resolved !== null) {
                    return resolved;
                }
                // Fall through to other resolvers if we couldn't load it
                // ourselves. `null` from a `pre`-order resolveId lets the
                // default chain continue.
                return null;
            },
        },
    };
}
