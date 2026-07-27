// Virtual entry-wrapper shared by the `--app gjs` and `--app node` factories.
//
// When a build needs to land one or more side-effect imports BEFORE the user's
// entry executes (the `--globals auto` register-inject stub on GJS; the
// `@gjsify/node-gi/globals` ambient-globals shim on Node), each entry is wrapped
// in a `\0gjsify-entry:<path>` virtual module that imports the side effects
// first, then re-exports the real entry. `\0`-prefixed ids are Rollup's
// convention for synthetic modules — Rolldown treats them as not-from-disk and
// skips the default loader.

import type { RolldownOptions, RolldownPluginOption } from 'rolldown';

import { GJSIFY_VIRTUAL_PREFIX } from './virtual-module-id.js';

export interface VirtualEntriesResult {
    input: RolldownOptions['input'];
    plugin: RolldownPluginOption | null;
}

/**
 * If there are side-effect imports to land alongside the user's entry, wrap each
 * entry in a virtual module that imports them first then re-exports the entry.
 * Returns the rewritten `input` plus the resolveId/load plugin that resolves the
 * virtual ids. With no side effects (or no input) it is a no-op pass-through.
 *
 * Single-input case: `'src/index.ts'` → `'\0gjsify-entry:src/index.ts'`.
 * Array-input case: each element gets the same wrapper id.
 * Record-input case: values get wrapped, keys preserved.
 */
export function wrapInputWithSideEffects(
    input: RolldownOptions['input'],
    sideEffects: string[],
    opts: { preserveDefaultExport?: boolean } = {},
): VirtualEntriesResult {
    if (sideEffects.length === 0 || input === undefined) {
        return { input, plugin: null };
    }

    const userEntries = new Map<string, string>(); // virtualId → realPath
    const PREFIX = `${GJSIFY_VIRTUAL_PREFIX}entry:`;

    function wrap(realPath: string): string {
        const id = PREFIX + realPath;
        userEntries.set(id, realPath);
        return id;
    }

    let wrappedInput: RolldownOptions['input'];
    if (typeof input === 'string') {
        wrappedInput = wrap(input);
    } else if (Array.isArray(input)) {
        wrappedInput = input.map(wrap);
    } else {
        const out: Record<string, string> = {};
        for (const [name, path] of Object.entries(input)) {
            out[name] = wrap(path);
        }
        wrappedInput = out;
    }

    const sideEffectImports = sideEffects.map((p) => `import ${JSON.stringify(p)};`).join('\n');

    // Resolved real-path targets from `userEntries` get their moduleSideEffects
    // forced to 'no-treeshake' so the user-entry's top-level body (`run({...})`,
    // side-effect calls) survives tree-shake even when its package.json restricts
    // sideEffects to register files.
    const resolvedTargets = new Set<string>();

    const plugin: RolldownPluginOption = {
        name: 'gjsify-virtual-entry',
        async resolveId(source, _importer) {
            if (source.startsWith(PREFIX)) return source;
            // Force-mark the resolved user-entry target as having top-level
            // side effects.
            if (resolvedTargets.has(source)) {
                return { id: source, moduleSideEffects: 'no-treeshake' };
            }
            return null;
        },
        async load(id) {
            if (!id.startsWith(PREFIX)) return null;
            const realPath = userEntries.get(id);
            if (!realPath) return null;
            // Resolve the user-provided entry path through the full resolver
            // chain so the re-export targets a real on-disk module — otherwise
            // Rolldown treats `src/foo.ts` as a bare specifier and emits it as
            // an external import.
            const resolved = await this.resolve(realPath, undefined, { skipSelf: true });
            const target = resolved?.id ?? realPath;
            resolvedTargets.add(target);
            // The bare `export * from <target>` re-exports named bindings but
            // does NOT execute the source module's top-level body. A companion
            // side-effect-only `import <target>` plus our resolveId-side
            // `moduleSideEffects: 'no-treeshake'` mark forces the body to run —
            // `run({...})` calls in test entries, top-level await, etc.
            //
            // `export *` also never carries the `default` export. For an
            // executable that's irrelevant, but a library bundle imported for
            // its default API (a bundler plugin) needs it preserved. When
            // requested, import the target as a namespace (which also runs the
            // body, so it doubles as the side-effect import) and re-export its
            // `default` — safely `undefined` when the entry has none.
            if (opts.preserveDefaultExport) {
                const ns = '__gjsify_entry__';
                return {
                    code:
                        `${sideEffectImports}\nimport * as ${ns} from ${JSON.stringify(target)};\n` +
                        `export * from ${JSON.stringify(target)};\nexport default ${ns}.default;\n`,
                    moduleSideEffects: 'no-treeshake',
                };
            }
            return {
                code: `${sideEffectImports}\nimport ${JSON.stringify(target)};\nexport * from ${JSON.stringify(target)};\n`,
                moduleSideEffects: 'no-treeshake',
            };
        },
    };

    return { input: wrappedInput, plugin };
}
