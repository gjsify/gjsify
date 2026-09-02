// For `--app browser`: redirect `@girs/*` and `gi://*` imports to an empty
// module. These are GJS-specific (GObject introspection bindings / GI
// protocol) with no browser equivalent. They appear transitively via
// `@gjsify/unit` and similar packages that have GJS-specific code paths.
//
// Marking them external would leave bare specifiers in the bundle that the
// browser cannot resolve at runtime; instead we resolve them to a virtual
// empty ESM module so the bundle is self-contained.
//
// `@girs/<ns>-<ver>` carve-out (`emptyGirs: false`): on the `--app node`
// target, when the bundle is a genuine GJS source being run through the
// `@gjsify/node-gi` reverse bridge, an `@girs/adw-1` VALUE import must resolve
// to its real package body — `@girs/adw-1/adw-1.js` is literally
// `import Adw from 'gi://Adw?version=1'; export default Adw` — so that the
// inner `gi://` import is rewritten to `requireGi(...)` by `gjsGiNodePlugin`
// (which runs FIRST). Mapping `@girs/*` to an empty module here instead would
// strand the import as `{}`, and a `class extends ({}).Bin` throws
// `Class extends value undefined`. The `gjsGiNodePlugin` claims `gi://` before
// this plugin runs, so on the node target this plugin only ever decides the
// fate of `@girs/*`; `emptyGirs:false` lets them fall through to disk while
// `gi://*` (never reached on node) is unaffected. The carve-out is GATED — see
// `app/node.ts`, where it is enabled only when `nodeGiGlobalsInject` is set
// (the same genuine-GJS-source signal that drives the globals shim) so a
// cross-platform polyfill package's plain-Node bundle keeps `@girs/*`→empty
// and loads WITHOUT node-gi installed.
//
// Portability note: the `filter: { id: ... }` below is a Rolldown fast-path
// — Rolldown pre-filters which specifiers reach `handler`. Under Vite (which
// also runs Rolldown for `build` but does NOT honor the Rolldown-specific
// hook-level `filter` in every code path, e.g. esbuild dep prebundle or the
// dev server) the handler may receive ALL ids. The internal guard below makes
// the plugin correct regardless of whether the filter pre-filtered — it is
// the load-bearing check; the `filter` is a defense-in-depth optimization.

import type { Plugin } from 'rolldown';

import { GJSIFY_VIRTUAL_PREFIX } from '../utils/virtual-module-id.js';

const GJSIMPORTS_VIRTUAL_ID = `${GJSIFY_VIRTUAL_PREFIX}empty-gjs-import`;

export interface GjsImportsEmptyOptions {
    /**
     * Whether `@girs/*` specifiers are redirected to the empty module. Default
     * `true` (browser / cross-platform Node behaviour). Set `false` on the
     * `--app node` node-gi path so `@girs/<ns>-<ver>` resolves to its real body
     * and the inner `gi://` is rewritten to `requireGi` by `gjsGiNodePlugin`.
     * `gi://*` is always handled (in node mode it is already claimed by
     * `gjsGiNodePlugin` before this plugin runs, so this only affects browser).
     */
    emptyGirs?: boolean;
}

export function gjsImportsEmptyPlugin(options: GjsImportsEmptyOptions = {}): Plugin {
    const emptyGirs = options.emptyGirs ?? true;
    // When `@girs/*` is carved out, only `gi://*` reaches the empty redirect.
    const matcher = emptyGirs ? /^(@girs\/|gi:\/\/)/ : /^gi:\/\//;
    // …with one subpath excluded on EVERY target, carve-out or not.
    //
    // `@girs/<ns>/vocabulary` is generated DATA — property names, signal names,
    // enum nicks, versions (ADR 0029). It imports no `gi://`, binds no library and
    // loads under plain Node; the reason it sits in `@girs` is that ts-for-gir
    // generates it, not that it needs GJS. Emptying it produces
    // `[MISSING_EXPORT] "PROVENANCE" is not exported by "\0gjsify-empty-gjs-import"`
    // at bundle time, which reads like a missing export rather than a substituted
    // module.
    //
    // The same over-broad assumption lived in `GIRS_VALUE_RE`
    // (manifest-conformance), where it made gtk-host's honest `node: "polyfill"`
    // read as runtime drift. Two tools, one rule: the package scope says who
    // generated a file, the subpath says what it needs.
    const isVocabulary = (source: string) => /^@girs\/[^/]+\/vocabulary$/.test(source);
    return {
        name: 'gjsify-gjs-imports-empty',
        resolveId: {
            order: 'pre' as const,
            filter: { id: matcher },
            handler(source) {
                // Internal guard: do not rely solely on the Rolldown `filter`
                // above (it may not pre-filter under Vite). Only intercept the
                // matched specifiers; let everything else (including `@girs/*`
                // when `emptyGirs` is false) fall through to the default
                // resolver chain.
                if (!matcher.test(source) || isVocabulary(source)) return null;
                return { id: GJSIMPORTS_VIRTUAL_ID };
            },
        },
        load(id) {
            if (id !== GJSIMPORTS_VIRTUAL_ID) return null;
            return { code: 'export {}; export default {};', moduleSideEffects: false };
        },
    };
}
