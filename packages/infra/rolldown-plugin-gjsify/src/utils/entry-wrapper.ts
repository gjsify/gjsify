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

/**
 * The wrapper's last statement, GJS only (`opts.exitOnReportedCode`).
 *
 * GJS has no atexit hook: nothing reads `process.exitCode` when the entry ends
 * naturally, so `process.exitCode = 1` exited 0 where Node exits 1. The wrapper
 * body is the one place that runs after the entry's body AND its top-level
 * awaits (ESM evaluates the imported entry first), so it is the end of main.
 *
 * Reaches `process` through `globalThis` (see the process-stub banner: a bare
 * identifier can bind to a bundled module's own top-level). `exit(code)` is
 * passed the number explicitly because the byte-1 stub's `exit(c)` ignores
 * `exitCode`; the full `@gjsify/process` then also emits `'exit'`. Zero,
 * `undefined` and non-numeric values stay a natural 0, as on Node.
 */
const END_OF_MAIN_EXIT =
    'const __gjsify_p = globalThis.process, __gjsify_c = Number(__gjsify_p?.exitCode);\n' +
    'if (Number.isInteger(__gjsify_c) && __gjsify_c !== 0) __gjsify_p.exit(__gjsify_c);';

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
    opts: { preserveDefaultExport?: boolean; exitOnReportedCode?: boolean } = {},
): VirtualEntriesResult {
    if ((sideEffects.length === 0 && !opts.exitOnReportedCode) || input === undefined) {
        return { input, plugin: null };
    }

    const userEntries = new Map<string, string>(); // virtualId → realPath
    const PREFIX = `${GJSIFY_VIRTUAL_PREFIX}entry:`;

    function wrap(realPath: string): string {
        // The wrapper is ESM whatever the entry is, and Rolldown reads a module's
        // format off its id's EXTENSION: `\0gjsify-entry:…/prettier.cjs` was parsed as
        // CommonJS and every `import` in the wrapper failed with `PARSE_ERROR: Cannot
        // use import statement outside a module`. A CJS entry therefore gets `.mjs`
        // appended; the others keep the id they always had.
        const id = PREFIX + realPath + (/\.c[jt]sx?$/i.test(realPath) ? '.mjs' : '');
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
    const endOfMain = opts.exitOnReportedCode ? `\n${END_OF_MAIN_EXIT}\n` : '';

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
                        `export * from ${JSON.stringify(target)};\nexport default ${ns}.default;\n${endOfMain}`,
                    moduleSideEffects: 'no-treeshake',
                };
            }
            return {
                code: `${sideEffectImports}\nimport ${JSON.stringify(target)};\nexport * from ${JSON.stringify(target)};\n${endOfMain}`,
                moduleSideEffects: 'no-treeshake',
            };
        },
    };

    return { input: wrappedInput, plugin };
}
