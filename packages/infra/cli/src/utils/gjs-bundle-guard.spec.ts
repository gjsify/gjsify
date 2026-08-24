// Unit coverage for the `--app gjs` bundle loadability gate. The regression it
// guards: a build whose `@gjsify/*` alias targets could not be resolved emitted
// a bundle with 10 bare `node:` imports, which stock GJS refuses to load
// ("ImportError: Unsupported URI scheme for importing: node") — and the build
// still exited 0.
//
// The second regression, caught by CI on the guard's own first cut: a text scan
// counts `node:` specifiers quoted inside STRINGS. Reading the bundler's module
// graph instead is what makes the difference, so that case is pinned here.
//
// The third: `node:` was only ever ONE shape. A `.tsx` entry with no JSX
// configuration emitted `import { jsx } from "react/jsx-runtime"` at exit 0 —
// UNRESOLVED_IMPORT is a rolldown WARNING — and `gjs -m` died with
// "ImportError: Module not found: react/jsx-runtime". What must NOT trip is
// pinned beside it: `gi://`, a declared external, a sibling chunk fileName.

import { describe, expect, it } from '@gjsify/unit';
import {
    GJS_ALLOWED_NODE_IMPORTS,
    assertGjsBundleLoadable,
    assertGjsBundleParses,
    findDisallowedNodeImports,
    findUnresolvableBareImports,
    isBareSpecifier,
} from './gjs-bundle-guard.js';
import { createGjsExternalsPredicate } from '@gjsify/rolldown-plugin-gjsify';

export default async () => {
    await describe('gjs-bundle-guard: findDisallowedNodeImports', async () => {
        await it('is empty for a healthy bundle', () => {
            expect(
                findDisallowedNodeImports([{ fileName: 'gjs.js', imports: ['gi://Gtk?version=4.0'] }]),
            ).toStrictEqual([]);
        });

        await it('is empty when the bundler reports no imports at all', () => {
            expect(findDisallowedNodeImports([{ fileName: 'gjs.js' }])).toStrictEqual([]);
            expect(findDisallowedNodeImports([])).toStrictEqual([]);
        });

        await it('finds the bare node: specifiers and ignores everything else', () => {
            const chunks = [
                { fileName: 'gjs.js', imports: ['node:fs', 'gi://GLib?version=2.0', 'node:path', '@gjsify/node-gi'] },
            ];
            expect(findDisallowedNodeImports(chunks)).toStrictEqual(['node:fs', 'node:path']);
        });

        await it('deduplicates and sorts across chunks', () => {
            const chunks = [
                { fileName: 'a.js', imports: ['node:path', 'node:fs'] },
                { fileName: 'b.js', imports: ['node:path'] },
            ];
            expect(findDisallowedNodeImports(chunks)).toStrictEqual(['node:fs', 'node:path']);
        });

        await it('cannot be fooled by a node: specifier quoted inside a string', () => {
            // The exact shape that made CI red: `@gjsify/process`'s test bundle
            // names a case `named-import hrtime (from "node:process") preserves
            // .bigint`, and `@gjsify/cli`'s bundle embeds giNodeShimSource()'s
            // `import { createRequire } from 'node:module';` codegen template.
            // Neither is an import, so neither reaches the module graph — the
            // bundler reports only what the chunk really imports.
            const chunks = [{ fileName: 'test.gjs.mjs', imports: ['@gjsify/process'] }];
            expect(findDisallowedNodeImports(chunks)).toStrictEqual([]);
        });

        await it('honours the allowlist', () => {
            expect(findDisallowedNodeImports([{ imports: ['node:fs'] }], ['node:fs'])).toStrictEqual([]);
        });

        await it('ships an EMPTY allowlist — every builtin has a polyfill', () => {
            // Reading the graph rather than the text is what keeps this empty:
            // the entries the text-scanning version needed were lookalikes.
            expect(GJS_ALLOWED_NODE_IMPORTS).toStrictEqual([]);
        });
    });

    await describe('gjs-bundle-guard: isBareSpecifier', async () => {
        await it('accepts only bare package specifiers', () => {
            expect(isBareSpecifier('react/jsx-runtime')).toBe(true);
            expect(isBareSpecifier('@gjsify/fs')).toBe(true);
            expect(isBareSpecifier('./chunk-a.js')).toBe(false);
            expect(isBareSpecifier('../lib/x.js')).toBe(false);
            expect(isBareSpecifier('/abs/path.js')).toBe(false);
            // A URL scheme names a loader GJS has, or one it reports itself.
            expect(isBareSpecifier('gi://Gtk?version=4.0')).toBe(false);
            expect(isBareSpecifier('file:///x.js')).toBe(false);
            expect(isBareSpecifier('resource:///eu/jumplink/app/x.js')).toBe(false);
            // Win32 drive letters read as a scheme, which is the intended answer.
            expect(isBareSpecifier('C:\\app\\x.js')).toBe(false);
        });
    });

    await describe('gjs-bundle-guard: findUnresolvableBareImports', async () => {
        const isExternal = createGjsExternalsPredicate([]);

        await it('finds the react/jsx-runtime the JSX default emits', () => {
            const chunks = [{ fileName: 'app.gjs.mjs', imports: ['react/jsx-runtime'] }];
            expect(findUnresolvableBareImports(chunks, { isExternal })).toStrictEqual(['react/jsx-runtime']);
        });

        await it('ignores what the target itself declares external', () => {
            const chunks = [{ imports: ['gi://Adw?version=1', 'cairo', 'system', 'gettext'] }];
            expect(findUnresolvableBareImports(chunks, { isExternal })).toStrictEqual([]);
        });

        await it('ignores a USER-declared external — a promise the caller made', () => {
            const chunks = [{ imports: ['some-host-module'] }];
            expect(
                findUnresolvableBareImports(chunks, { isExternal: createGjsExternalsPredicate(['some-host-module']) }),
            ).toStrictEqual([]);
            // …and reports it when nothing declared it.
            expect(findUnresolvableBareImports(chunks, { isExternal })).toStrictEqual(['some-host-module']);
        });

        await it('ignores a sibling chunk, which `imports` lists by bare fileName', () => {
            const chunks = [
                { fileName: 'entry.js', imports: ['shared-abc.js'] },
                { fileName: 'shared-abc.js', imports: [] },
            ];
            expect(
                findUnresolvableBareImports(chunks, { isExternal, emitted: ['entry.js', 'shared-abc.js'] }),
            ).toStrictEqual([]);
        });

        await it('leaves `node:` to the guard that has its own diagnosis for it', () => {
            const chunks = [{ imports: ['node:fs', 'lodash'] }];
            expect(findUnresolvableBareImports(chunks, { isExternal })).toStrictEqual(['lodash']);
        });
    });

    await describe('gjs-bundle-guard: assertGjsBundleLoadable', async () => {
        await it('passes a healthy bundle', () => {
            assertGjsBundleLoadable([{ fileName: 'gjs.js', imports: ['gi://Adw?version=1'] }], 'dist/gjs.js');
        });

        await it('throws naming every offending specifier and the file', () => {
            let message = '';
            try {
                assertGjsBundleLoadable([{ imports: ['node:fs', 'node:os'] }], 'dist/cli.gjs.mjs');
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain('dist/cli.gjs.mjs');
            expect(message).toContain('2 bare');
            expect(message).toContain('node:fs');
            expect(message).toContain('node:os');
            expect(message).toContain('Unsupported URI scheme for importing: node');
        });

        await it('throws on an unresolvable bare specifier, naming the JSX cause', () => {
            let message = '';
            try {
                assertGjsBundleLoadable([{ imports: ['react/jsx-runtime'] }], 'dist/app.gjs.mjs', {
                    isExternal: createGjsExternalsPredicate([]),
                });
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain('dist/app.gjs.mjs');
            expect(message).toContain('react/jsx-runtime');
            expect(message).toContain('Module not found');
            expect(message).toContain('jsxImportSource');
        });

        await it('reports the node: shape FIRST — the two have different fixes', () => {
            let message = '';
            try {
                assertGjsBundleLoadable([{ imports: ['node:fs', 'react/jsx-runtime'] }], 'dist/app.gjs.mjs', {
                    isExternal: createGjsExternalsPredicate([]),
                });
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain('Unsupported URI scheme');
            expect(message).toContain('node:fs');
        });
    });

    await describe('gjs-bundle-guard: assertGjsBundleParses', async () => {
        await it('passes a bundle that parses', () => {
            assertGjsBundleParses([{ fileName: 'app.gjs.mjs', code: 'const a = 1; console.log(a);' }], 'dist/app.js');
        });

        await it('passes when the engine reported no code for a chunk', () => {
            assertGjsBundleParses([{ fileName: 'app.gjs.mjs' }, { fileName: 'b.js', code: '' }], 'dist/app.js');
        });

        await it('throws on raw JSX, naming the position and the two fixes', () => {
            let message = '';
            try {
                assertGjsBundleParses([{ fileName: 'app.gjs.mjs', code: 'const r = <box title="hi"/>;' }], 'dist/app');
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain('app.gjs.mjs');
            expect(message).toContain('raw JSX');
            expect(message).toContain('1:10');
            expect(message).toContain('babel-preset-solid');
        });

        await it('stays silent on a parse failure that is NOT JSX', () => {
            // acorn trails SpiderMonkey on new syntax; blaming JSX for that would
            // attach a fix to a claim the position does not support.
            assertGjsBundleParses([{ fileName: 'app.gjs.mjs', code: 'const a = ;' }], 'dist/app.js');
        });
    });
};
