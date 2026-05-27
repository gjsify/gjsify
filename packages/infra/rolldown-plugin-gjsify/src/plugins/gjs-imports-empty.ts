// For `--app browser`: redirect `@girs/*` and `gi://*` imports to an empty
// module. These are GJS-specific (GObject introspection bindings / GI
// protocol) with no browser equivalent. They appear transitively via
// `@gjsify/unit` and similar packages that have GJS-specific code paths.
//
// Marking them external would leave bare specifiers in the bundle that the
// browser cannot resolve at runtime; instead we resolve them to a virtual
// empty ESM module so the bundle is self-contained.
//
// Portability note: the `filter: { id: ... }` below is a Rolldown fast-path
// — Rolldown pre-filters which specifiers reach `handler`. Under Vite (which
// also runs Rolldown for `build` but does NOT honor the Rolldown-specific
// hook-level `filter` in every code path, e.g. esbuild dep prebundle or the
// dev server) the handler may receive ALL ids. The internal guard below makes
// the plugin correct regardless of whether the filter pre-filtered — it is
// the load-bearing check; the `filter` is a defense-in-depth optimization.

import type { Plugin } from 'rolldown';

const GJSIMPORTS_VIRTUAL_ID = '\0gjsify-empty-gjs-import';

export function gjsImportsEmptyPlugin(): Plugin {
    return {
        name: 'gjsify-gjs-imports-empty',
        resolveId: {
            order: 'pre' as const,
            filter: { id: /^(@girs\/|gi:\/\/)/ },
            handler(source) {
                // Internal guard: do not rely solely on the Rolldown `filter`
                // above (it may not pre-filter under Vite). Only intercept
                // `@girs/*` and `gi://*` specifiers; let everything else fall
                // through to the default resolver chain.
                if (!/^(@girs\/|gi:\/\/)/.test(source)) return null;
                return { id: GJSIMPORTS_VIRTUAL_ID };
            },
        },
        load(id) {
            if (id !== GJSIMPORTS_VIRTUAL_ID) return null;
            return { code: 'export {}; export default {};', moduleSideEffects: false };
        },
    };
}
