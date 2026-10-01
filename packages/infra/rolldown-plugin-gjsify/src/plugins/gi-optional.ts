// SPDX-License-Identifier: MIT
// `import Goa from 'gi://Goa?version=1.0&optional'` — a GI namespace the app can run
// without (ADR 0086). `--app gjs` only.
//
// A plain `gi://` import is a hard edge: GJS loads the typelib when the specifier is
// EVALUATED and a missing one aborts the module graph before the app decides anything.
// The `optional` query flag is the declaration that the app has that decision to make.
// The import resolves to a virtual module that awaits the SAME specifier without the
// flag inside a try/catch, so the emitted bundle still carries the verbatim
// `gi://Goa?version=1.0` that `ship/gi-namespaces.ts` and `depends.ts` read, and the
// namespace is `undefined` when it is absent.

import type { Plugin } from 'rolldown';

import { GJSIFY_VIRTUAL_PREFIX } from '../utils/virtual-module-id.js';
import { parseGiSpecifier } from './gjs-gi-node.js';

const GI_OPTIONAL_VIRTUAL_PREFIX = `${GJSIFY_VIRTUAL_PREFIX}gi-optional:`;

/** The query flag that declares a `gi://` import optional. */
export const GI_OPTIONAL_FLAG = 'optional';

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
        `export default ns;\n`
    );
}

export function giOptionalPlugin(): Plugin {
    return {
        name: 'gjsify-gi-optional',
        resolveId: {
            order: 'pre' as const,
            filter: { id: /^gi:\/\/.*[?&]optional(?:&|=|$)/ },
            handler(source) {
                const parsed = parseOptionalGiSpecifier(source);
                if (parsed === null) return null;
                const version = parsed.version ? `@${parsed.version}` : '';
                return { id: `${GI_OPTIONAL_VIRTUAL_PREFIX}${parsed.namespace}${version}` };
            },
        },
        load(id) {
            if (!id.startsWith(GI_OPTIONAL_VIRTUAL_PREFIX)) return null;
            const spec = id.slice(GI_OPTIONAL_VIRTUAL_PREFIX.length);
            const at = spec.lastIndexOf('@');
            const namespace = at === -1 ? spec : spec.slice(0, at);
            const version = at === -1 ? undefined : spec.slice(at + 1);
            const specifier = `gi://${namespace}${version ? `?version=${version}` : ''}`;
            return { code: giOptionalShimSource(specifier, namespace, version), moduleSideEffects: false };
        },
    };
}
