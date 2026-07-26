// The ONE prefix every synthetic module id emitted by a gjsify plugin carries.
//
// Rollup/Rolldown convention is that a `\0`-prefixed id is not-from-disk; every
// gjsify plugin that emits one additionally namespaces it with `gjsify-`
// (`\0gjsify-entry:`, `\0gjsify-gi-node:`, `\0gjsify-napi-addon:`,
// `\0gjsify-empty-gjs-import`). Deriving those ids from THIS constant turns that
// naming habit into an enforced invariant, which matters because the alias layer
// keys off it: a module whose SOURCE we generated must bind to the RUNTIME's real
// modules, never to whatever a user `--alias` retargets a specifier onto.
//
// Concretely (the bug that motivated this): `gjsGiNodePlugin`'s virtual module
// emits `import { createRequire } from 'node:module'`. Under the node-gi consumer
// harness — which builds `--alias node:module=@gjsify/module` to put the polyfill
// UNDER TEST behind the specifier — that import was rewritten onto the polyfill
// itself, so the bundle called `@gjsify/module`'s `createRequire` at top level
// before its lazy GLib namespace proxy existed (`TypeError: Cannot read
// properties of undefined (reading 'filename_from_uri')`), and past that hit a
// genuine cycle: the polyfill's Gio-backed CJS loader needs GLib, and GLib is
// reached through `@gjsify/node-gi/gi` — which is what the virtual module was
// loading in the first place.

/** Shared prefix of every gjsify-generated (synthetic) module id. */
export const GJSIFY_VIRTUAL_PREFIX = '\0gjsify-';

/**
 * Is `id` a module gjsify's own plugins generated (as opposed to a user/npm
 * source file)?
 *
 * Used by `aliasPlugin` to scope the alias tables to REAL source: generated
 * module bodies name the runtime module they need explicitly and must not be
 * re-pointed by a user alias or a slot-routing entry.
 *
 * @param id A Rolldown module id — typically a `resolveId` `importer`, which is
 *   `undefined` for entry modules.
 */
export function isGjsifyVirtualModuleId(id: string | undefined | null): boolean {
    return typeof id === 'string' && id.startsWith(GJSIFY_VIRTUAL_PREFIX);
}
