// Unit coverage for the `--app gjs` bundle loadability gate. The regression it
// guards: a build whose `@gjsify/*` alias targets could not be resolved emitted
// a bundle with 10 bare `node:` imports, which stock GJS refuses to load
// ("ImportError: Unsupported URI scheme for importing: node") — and the build
// still exited 0.
//
// The second regression, caught by CI on the guard's own first cut: a text scan
// counts `node:` specifiers quoted inside STRINGS. Reading the bundler's module
// graph instead is what makes the difference, so that case is pinned here.

import { describe, expect, it } from '@gjsify/unit';
import { GJS_ALLOWED_NODE_IMPORTS, findDisallowedNodeImports, assertGjsBundleLoadable } from './gjs-bundle-guard.js';

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
    });
};
