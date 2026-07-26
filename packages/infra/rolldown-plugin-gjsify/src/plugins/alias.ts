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
//
// `extraOptions.kind` is forwarded to `this.resolve()` so package.json
// `exports` conditions ("import" / "require") match the original call site.
// Without this, a CJS `require('stream')` in a bundled npm package would
// resolve through the "import" condition (Rolldown's default), bypassing the
// `cjs-compat.cjs` shim that unwraps named-export ESM modules to their
// constructor — breaking `util.inherits(Child, Stream)` patterns.
//
// ── Two invariants this plugin holds ────────────────────────────────────────
//
// 1. **Gjsify-generated modules are NOT aliased.** An import whose importer is
//    a `\0gjsify-*` virtual module (`isGjsifyVirtualModuleId`) is left alone.
//    We wrote that module's source; it names the RUNTIME module it needs and
//    must get exactly that. The motivating failure: `gjsGiNodePlugin`'s
//    `import { createRequire } from 'node:module'` was rewritten onto the
//    `@gjsify/module` polyfill by the consumer harness's
//    `--alias node:module=@gjsify/module`, so the bundle called the polyfill's
//    `createRequire` at top level before its GLib proxy existed
//    (`TypeError: … reading 'filename_from_uri'`) — and the polyfill's own
//    Gio-backed loader can only reach GLib THROUGH the module it was being
//    asked to load. The guard is importer-based rather than a per-specifier
//    carve-out so it covers every current and future virtual module (entry
//    wrapper, gi-node, napi-addon, gjs-imports-empty).
//
// 2. **An alias target is TERMINAL — exactly one hop, never a chain.** The
//    `entries` map handed in is already MERGED across tiers (derived slot
//    routing → curated `ALIASES_*` tables → per-target overrides → user
//    `--alias`, later wins, see `app/*.ts`), so the tier a value came from is
//    no longer recoverable here. Re-feeding a target through the table would
//    therefore apply slot routing to USER aliases too, which is precisely what
//    must not happen: `scripts/node-gi-consumer-harness.mjs` builds
//    `--alias node:<x>=@gjsify/<x>` to put the POLYFILL under test behind a
//    Node builtin, and 34 of those polyfills declare `runtimes.node: "native"`
//    — a second hop would silently route them back to `@gjsify/<x>/globals`
//    (i.e. Node's own builtin) and the suite would measure nothing. The
//    "second pass" of the slot-routing model is a COMPOSITION concern, and it
//    is resolved where the tiers are still distinguishable — see
//    `withDerivedSlotRouting` in `@gjsify/resolve-npm`.

import type { Plugin } from 'rolldown';

import { isGjsifyVirtualModuleId } from '../utils/virtual-module-id.js';

export interface AliasPluginOptions {
    entries: Record<string, string>;
}

export function aliasPlugin(options: AliasPluginOptions): Plugin {
    const entries = options.entries;

    return {
        name: 'gjsify-alias',
        resolveId: {
            order: 'pre' as const,
            async handler(source, importer, extraOptions) {
                // Invariant 1 — never rewrite an import that WE generated.
                if (isGjsifyVirtualModuleId(importer)) {
                    return null;
                }
                if (!Object.prototype.hasOwnProperty.call(entries, source)) {
                    return null;
                }
                const target = entries[source];
                // Self-reference guard: if a user maps a specifier to itself
                // (rare but legal), skip to avoid infinite loops.
                if (target === source) return null;

                const resolved = await this.resolve(target, importer, {
                    skipSelf: true,
                    kind: extraOptions?.kind,
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
