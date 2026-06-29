// For `--app node`: redirect `gi://Ns?version=X` imports to the `@gjsify/node-gi`
// L1 runtime (`requireGi`) instead of an empty module. This is the Axis-5
// reverse bridge — it lets the SAME GJS/GObject-Introspection source that builds
// for `--app gjs` (where `gi://` is a real native protocol) also build + run for
// `--app node`, where `@gjsify/node-gi` provides the GIRepository backend.
//
// `import Gtk from 'gi://Gtk?version=4.0'` is rewritten to a virtual module whose
// default export is a lazy Proxy over `requireGi('Gtk', '4.0')` — close to how
// GJS lowers `gi://` to `$$gi.require(...)`. The namespace (and @gjsify/node-gi
// itself) is resolved on FIRST ACCESS, not at import: a `gi://` import gated to
// GJS-only code paths stays harmless on Node when @gjsify/node-gi is absent.
//
// `@girs/*` is deliberately NOT claimed here (this plugin returns null for
// them, falling through). Those are ambient/type packages whose VALUE entry
// re-exports `gi://` (`@girs/adw-1/adw-1.js` is `import Adw from
// 'gi://Adw?version=1'; export default Adw`). On a default Node build
// `gjsImportsEmptyPlugin` maps them to an empty module. On a node-gi build
// (`nodeGiGlobalsInject`, see `app/node.ts`) that empty redirect is OFF: the
// `@girs/<ns>-<ver>` import resolves to its real body and ITS inner `gi://` is
// then rewritten by THIS plugin — so `@girs/adw-1` routes to
// `requireGi('Adw','1')` with the proper-cased namespace taken straight from
// the @girs package's own `gi://` specifier (no lowercased-pkg→namespace map
// needed). The `@gjsify/node-gi/gi` import the virtual module emits is kept
// EXTERNAL (a native addon cannot be bundled), so it resolves at runtime
// against the consumer's node_modules.
//
// Portability note (same as `gjs-imports-empty.ts`): the `filter` is a Rolldown
// fast-path; the internal guard in the handler is the load-bearing check so the
// plugin is correct even when the filter does not pre-filter (e.g. under Vite).

import type { Plugin } from 'rolldown';

const GI_NODE_VIRTUAL_PREFIX = '\0gjsify-gi-node:';

/** Parse a `gi://Ns?version=X` specifier into its namespace + optional version. */
export function parseGiSpecifier(source: string): { namespace: string; version?: string } | null {
    if (!source.startsWith('gi://')) return null;
    const rest = source.slice('gi://'.length);
    const queryIndex = rest.indexOf('?');
    const namespace = queryIndex === -1 ? rest : rest.slice(0, queryIndex);
    if (!namespace) return null;
    let version: string | undefined;
    if (queryIndex !== -1) {
        const params = new URLSearchParams(rest.slice(queryIndex + 1));
        version = params.get('version') ?? undefined;
    }
    return { namespace, version };
}

/** Build the runtime shim source for a resolved `gi://` namespace. */
export function giNodeShimSource(namespace: string, version?: string): string {
    const versionArg = version ? `, ${JSON.stringify(version)}` : '';
    // Load @gjsify/node-gi LAZILY (createRequire, on first access) — NEVER at
    // module init. A `gi://` import that is gated to GJS-only code paths (very
    // common in cross-platform packages — e.g. an `on('Gjs')` block or a
    // `*.gjs.spec`) is then harmless on Node when @gjsify/node-gi is not
    // installed: the bundle loads, the namespace is resolved only if the code
    // actually touches it. This preserves the old empty-stub safety for unused
    // imports while making used ones real. `require()` (not dynamic `import()`)
    // keeps the default export synchronous, matching `import Ns from 'gi://Ns'`.
    return (
        `import { createRequire } from 'node:module';\n` +
        `const require = createRequire(import.meta.url);\n` +
        `let cached;\n` +
        `function load() {\n` +
        `  if (cached === undefined) {\n` +
        `    cached = require('@gjsify/node-gi/gi').requireGi(${JSON.stringify(namespace)}${versionArg});\n` +
        `  }\n` +
        `  return cached;\n` +
        `}\n` +
        `export default new Proxy(Object.create(null), {\n` +
        `  get(_target, prop) { return load()[prop]; },\n` +
        `  has(_target, prop) { return prop in load(); },\n` +
        `});\n`
    );
}

export function gjsGiNodePlugin(): Plugin {
    return {
        name: 'gjsify-gi-node',
        resolveId: {
            order: 'pre' as const,
            filter: { id: /^gi:\/\// },
            handler(source) {
                const parsed = parseGiSpecifier(source);
                if (parsed === null) return null;
                const suffix = parsed.version ? `@${parsed.version}` : '';
                return { id: `${GI_NODE_VIRTUAL_PREFIX}${parsed.namespace}${suffix}` };
            },
        },
        load(id) {
            if (!id.startsWith(GI_NODE_VIRTUAL_PREFIX)) return null;
            const spec = id.slice(GI_NODE_VIRTUAL_PREFIX.length);
            const atIndex = spec.lastIndexOf('@');
            const namespace = atIndex === -1 ? spec : spec.slice(0, atIndex);
            const version = atIndex === -1 ? undefined : spec.slice(atIndex + 1);
            return { code: giNodeShimSource(namespace, version), moduleSideEffects: false };
        },
    };
}

/**
 * For `--app node`: rewrite the bare GJS built-in module specifiers (`system`,
 * `gettext`) to their `@gjsify/node-gi` reverse-bridge shims, kept EXTERNAL.
 *
 * GJS exposes `system`/`gettext` as built-in ESM modules
 * (`import System from 'system'`); Node has no equivalent. This resolves the
 * bare specifier to `@gjsify/node-gi/system` / `@gjsify/node-gi/gettext` and
 * marks it external so it is NOT bundled — resolved at runtime against the
 * consumer's node_modules, exactly like `@gjsify/node-gi/gi` (the `gi://`
 * rewrite) and `@gjsify/node-gi/globals`.
 *
 * Returning `{ external: true }` from `resolveId` is the form honoured by BOTH
 * bundler engines (npm rolldown on Node AND `@gjsify/rolldown-native` on GJS,
 * whose JSON options boundary drops a function `external` but keeps resolveId
 * results — the same reason `app/gjs.ts` uses `externalsPlugin`). It also avoids
 * a disk `this.resolve()` of the target, so the build does NOT require
 * `@gjsify/node-gi` installed (a `system`/`gettext` import gated to GJS-only code
 * paths stays harmless on plain Node — the gi:// gated-load lesson). The generic
 * `aliasPlugin` cannot serve this role: it resolves the target on disk and falls
 * through (leaving a bare, unresolvable `system`) when node-gi is absent.
 *
 * Gating: this plugin is registered ONLY by the `--app node` orchestrator, so
 * the gjs/browser/nativescript targets never hijack a bare `system`/`gettext`
 * — identical scoping to the `gi://` rewrite. `entries` is `ALIASES_GJS_FOR_NODE`
 * (the declarative source of truth). The handler guard is the load-bearing check
 * (correct even when the filter does not pre-filter, e.g. under Vite).
 */
export function gjsBuiltinModulesNodePlugin(entries: Record<string, string>): Plugin {
    const keys = Object.keys(entries);
    // A filter for the exact bare names — a Rolldown fast-path only. The handler
    // re-checks membership so it stays correct under engines that ignore filters.
    const filter =
        keys.length > 0
            ? { id: new RegExp(`^(?:${keys.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`) }
            : undefined;
    return {
        name: 'gjsify-builtin-modules-node',
        resolveId: {
            order: 'pre' as const,
            ...(filter ? { filter } : {}),
            handler(source) {
                const target = entries[source];
                if (!target) return null;
                return { id: target, external: true };
            },
        },
    };
}
