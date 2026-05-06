// For `--app browser`: redirect `@girs/*` and `gi://*` imports to an empty
// module. These are GJS-specific (GObject introspection bindings / GI
// protocol) with no browser equivalent. They appear transitively via
// `@gjsify/unit` and similar packages that have GJS-specific code paths.
//
// Marking them external would leave bare specifiers in the bundle that the
// browser cannot resolve at runtime; instead we resolve them to a virtual
// empty ESM module so the bundle is self-contained.

import type { Plugin } from 'rolldown';

const GJSIMPORTS_VIRTUAL_ID = '\0gjsify-empty-gjs-import';

export function gjsImportsEmptyPlugin(): Plugin {
    return {
        name: 'gjsify-gjs-imports-empty',
        resolveId: {
            order: 'pre' as const,
            filter: { id: /^(@girs\/|gi:\/\/)/ },
            handler(_source) {
                return { id: GJSIMPORTS_VIRTUAL_ID };
            },
        },
        load(id) {
            if (id !== GJSIMPORTS_VIRTUAL_ID) return null;
            return { code: 'export {}; export default {};', moduleSideEffects: false };
        },
    };
}
