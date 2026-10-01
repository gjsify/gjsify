// SPDX-License-Identifier: MIT
// `import Goa from 'gi://Goa?version=1.0&optional'` — a GI namespace the app can run
// without (ADR 0087). Composed by `--app gjs` and `--app node`.
//
// A plain `gi://` import is a hard edge: GJS loads the typelib when the specifier is
// EVALUATED and a missing one aborts the module graph before the app decides anything.
// The `optional` query flag is the declaration that the app has that decision to make.
// The import resolves to a virtual module that loads the SAME specifier without the
// flag inside a try/catch, so the emitted bundle still carries the verbatim
// `gi://Goa?version=1.0` that `ship/gi-namespaces.ts` and `depends.ts` read, and the
// namespace is `undefined` when it is absent.
//
// BOTH app targets, and the second one was the trap. `--app node` already loads a
// `gi://` namespace LAZILY (`gjsGiNodePlugin` default-exports a Proxy that calls
// `requireGi` on first member access), so with the flag ignored the same source kept
// returning a truthy Proxy where the app checks `Goa === undefined`, and the first
// real member access threw instead of degrading — a degrade path that works on one
// build target and not the other is the defect, not the laziness. Hence a NODE
// shim with the SAME contract: the namespace or `undefined`, plus one warn. It is
// synchronous rather than a top-level `await import()` (the shape the node arm's
// synchronous `require()` already has), because a flag whose whole point is that
// the app can branch on the result must not force every importer to be async.

import type { Plugin } from 'rolldown';

import { GJSIFY_VIRTUAL_PREFIX } from '../utils/virtual-module-id.js';
import { parseGiSpecifier } from './gjs-gi-node.js';

const GI_OPTIONAL_VIRTUAL_PREFIX = {
    gjs: `${GJSIFY_VIRTUAL_PREFIX}gi-optional:`,
    node: `${GJSIFY_VIRTUAL_PREFIX}gi-optional-node:`,
} as const;

/** Which build target's shim a flagged specifier gets. */
export type GiOptionalTarget = keyof typeof GI_OPTIONAL_VIRTUAL_PREFIX;

/** The query flag that declares a `gi://` import optional. */
export const GI_OPTIONAL_FLAG = 'optional';

/**
 * `Symbol.for` key of the marker statement every optional shim emits, naming its own
 * namespace so a reader of the ARTIFACT can tell an optional namespace from a hard one.
 *
 * WHY IT IS IN THE BUNDLE AND NOT ALONGSIDE IT, which is the design decision this
 * constant exists to pin: `gjsify ship` reads the emitted file, not the build tree,
 * and reads the STAGE MANIFEST when it packs on another host — so a sidecar next to
 * the bundle is a second source that can be stale, absent, or a different file. The
 * marker is therefore one statement in the module body the plugin already emits, and
 * it is a `globalThis[Symbol.for(…)]?.(…)` call for two reasons, both measured on
 * rolldown's own minifier: an unknown global call is not statically pure, so it
 * survives minification where a bare string constant is dropped by tree-shaking, and
 * the optional call means nothing on a host that never registers a handler.
 */
export const GI_OPTIONAL_MARKER = 'gjsify.optionalGi';

/**
 * The statement that records `namespace` as optional in the artifact.
 *
 * Two string arguments in the spelling the node arm's `requireGi("Ns", "X")` already
 * uses, so one reader answers both targets. The version argument is OMITTED when
 * there is none, rather than sent empty: a `requireGi` call cannot tell `''` from a
 * version, and neither can this.
 */
export function giOptionalMarkerSource(namespace: string, version?: string): string {
    const args =
        version === undefined ? JSON.stringify(namespace) : `${JSON.stringify(namespace)}, ${JSON.stringify(version)}`;
    return `globalThis[Symbol.for(${JSON.stringify(GI_OPTIONAL_MARKER)})]?.(${args});`;
}

/**
 * Split `gi://Ns?version=X&optional` into the clean specifier the loader sees and the
 * flag; `null` when the specifier is not a `gi://` one or does not carry the flag.
 */
export function parseOptionalGiSpecifier(
    source: string,
): { specifier: string; namespace: string; version?: string } | null {
    if (!source.startsWith('gi://')) return null;
    const queryIndex = source.indexOf('?');
    if (queryIndex === -1) return null;
    const params = new URLSearchParams(source.slice(queryIndex + 1));
    if (!params.has(GI_OPTIONAL_FLAG)) return null;
    params.delete(GI_OPTIONAL_FLAG);
    const rest = params.toString();
    const specifier = source.slice(0, queryIndex) + (rest ? `?${rest}` : '');
    const parsed = parseGiSpecifier(specifier);
    if (parsed === null) return null;
    return { specifier, ...parsed };
}

/**
 * The module body for one optional namespace. Self-contained: it runs at module
 * evaluation, where no bundled helper may be assumed, and reaches ambient globals
 * through `globalThis.` only.
 */
export function giOptionalShimSource(specifier: string, namespace: string, version?: string): string {
    const label = version ? `${namespace} ${version}` : namespace;
    return (
        `let ns;\n` +
        `try {\n` +
        `  const m = await import(${JSON.stringify(specifier)});\n` +
        `  ns = m.default ?? m;\n` +
        `} catch (error) {\n` +
        `  let searched = '';\n` +
        `  try {\n` +
        `    const r = globalThis.imports.gi.GIRepository.Repository.dup_default();\n` +
        `    searched = ' (typelib search path: ' + r.get_search_path().join(':') + ')';\n` +
        `  } catch {}\n` +
        `  console.warn(${JSON.stringify(`optional GI namespace ${label} is not available`)} + searched + ': ' + (error && error.message ? error.message : String(error)));\n` +
        `}\n` +
        `${giOptionalMarkerSource(namespace, version)}\n` +
        `export default ns;\n`
    );
}

/**
 * The `--app node` body: the same contract, reached through `@gjsify/node-gi`.
 *
 * The load is EAGER, which is the one place this arm differs from the hard node shim
 * and the reason is the flag: `requireGi` only fails when it is called, so a lazy Proxy
 * cannot answer "is it there" without loading it — and the answer is the whole point.
 * A missing `@gjsify/node-gi` itself lands in the same catch and yields `undefined`,
 * which is honest: without node-gi no GI namespace loads, optional or not.
 */
export function giOptionalNodeShimSource(namespace: string, version?: string): string {
    const label = version ? `${namespace} ${version}` : namespace;
    const versionArg = version === undefined ? '' : `, ${JSON.stringify(version)}`;
    return (
        `import { createRequire } from 'node:module';\n` +
        `const require = createRequire(import.meta.url);\n` +
        `let ns;\n` +
        `try {\n` +
        `  ns = require('@gjsify/node-gi/gi').requireGi(${JSON.stringify(namespace)}${versionArg});\n` +
        `} catch (error) {\n` +
        `  console.warn(${JSON.stringify(`optional GI namespace ${label} is not available`)} + ': ' + (error && error.message ? error.message : String(error)));\n` +
        `}\n` +
        `${giOptionalMarkerSource(namespace, version)}\n` +
        `export default ns;\n`
    );
}

export function giOptionalPlugin(target: GiOptionalTarget): Plugin {
    const prefix = GI_OPTIONAL_VIRTUAL_PREFIX[target];
    return {
        name: `gjsify-gi-optional-${target}`,
        resolveId: {
            order: 'pre' as const,
            filter: { id: /^gi:\/\/.*[?&]optional(?:&|=|$)/ },
            handler(source) {
                const parsed = parseOptionalGiSpecifier(source);
                if (parsed === null) return null;
                const version = parsed.version ? `@${parsed.version}` : '';
                return { id: `${prefix}${parsed.namespace}${version}` };
            },
        },
        load(id) {
            if (!id.startsWith(prefix)) return null;
            const spec = id.slice(prefix.length);
            const at = spec.lastIndexOf('@');
            const namespace = at === -1 ? spec : spec.slice(0, at);
            const version = at === -1 ? undefined : spec.slice(at + 1);
            const code =
                target === 'gjs'
                    ? giOptionalShimSource(
                          `gi://${namespace}${version ? `?version=${version}` : ''}`,
                          namespace,
                          version,
                      )
                    : giOptionalNodeShimSource(namespace, version);
            return { code, moduleSideEffects: false };
        },
    };
}
