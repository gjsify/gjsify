// Engine-agnostic externals enforcement via a `resolveId` hook.
//
// Rolldown's top-level `external` option accepts a function predicate on
// the npm engine (Node), but `@gjsify/rolldown-native` ships its options
// to the Rust core via `JSON.stringify` — function values are silently
// DROPPED at that boundary (the Rust deserializer only accepts a
// `Vec<String>` of exact names). Two bugs already shipped from this class
// (app/node.ts predicate → node-datachannel inlined; library/lib.ts
// predicate → `@gjsify/web-streams` inlined per-package, breaking the
// ReadableStream brand check), and `--app gjs` was the third live
// instance.
//
// A `resolveId` hook returning `{ id, external: true }` is honoured by
// BOTH engines: npm rolldown natively, and the native facade via
// `normalizeResolveIdResult` (which forwards `external` through the B.3
// nested-plugin protocol). Enforcing externals policy here — instead of
// (or in addition to) the `external` option — makes the policy identical
// under npm rolldown, native rolldown, AND the `--globals auto` analysis
// passes (`bundleToChunks`), which compose the same plugin chain.

import type { RolldownPluginOption } from 'rolldown';

/** Decides whether a specifier must stay external (`true`) or flow through normal resolution (`false`). */
export type ExternalsPredicate = (id: string) => boolean;

export interface ExternalsPluginOptions {
    /** Plugin name shown in errors/debug output. Default: `'gjsify-externalize'`. */
    name?: string;
}

/**
 * Externalize specifiers matching `predicate` via a `resolveId` hook —
 * the engine-agnostic equivalent of a (native-dropped) `external`
 * function option. Returning `{ id, external: true }` keeps the ORIGINAL
 * specifier in the emitted module so the output re-imports the dep by
 * reference (library mode: `preserveModules` writes
 * `import … from '@gjsify/web-streams'` unchanged; app mode: the bundle
 * keeps `import 'gi://Gtk?version=4.0'` for the GJS loader).
 *
 * Entry guard: entry modules MUST be resolved + emitted, never
 * externalized. Rolldown's `external` OPTION skips entries implicitly,
 * but a resolveId HOOK fires for them too — guard on the absent importer
 * (and `isEntry`) so `src/index.ts` etc. aren't marked external (a
 * regression there externalizes ENTRY modules and emits empty packages).
 */
export function externalsPlugin(predicate: ExternalsPredicate, options?: ExternalsPluginOptions): RolldownPluginOption {
    return {
        name: options?.name ?? 'gjsify-externalize',
        resolveId(source: string, importer: string | undefined, opts: { isEntry?: boolean }) {
            if (importer === undefined || opts?.isEntry) return null;
            return predicate(source) ? { id: source, external: true } : null;
        },
    };
}
