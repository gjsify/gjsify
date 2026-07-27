// Unit coverage for the `--app gjs` bundle loadability gate. The regression it
// guards: a build whose `@gjsify/*` alias targets could not be resolved emitted
// a bundle with 10 bare `node:` imports, which stock GJS refuses to load
// ("ImportError: Unsupported URI scheme for importing: node") — and the build
// still exited 0.

import { describe, expect, it } from '@gjsify/unit';
import { GJS_ALLOWED_NODE_IMPORTS, findDisallowedNodeImports, assertGjsBundleLoadable } from './gjs-bundle-guard.js';

export default async () => {
    await describe('gjs-bundle-guard: findDisallowedNodeImports', async () => {
        await it('is empty for a healthy bundle', () => {
            expect(findDisallowedNodeImports('import{x}from"@gjsify/fs";const y=1;')).toStrictEqual([]);
        });

        await it('finds every import form a bundler emits, minified', () => {
            const code = 'import{a}from"node:fs";import"node:os";import("node:path");require("node:util");';
            expect(findDisallowedNodeImports(code)).toStrictEqual(['node:fs', 'node:os', 'node:path', 'node:util']);
        });

        await it('tolerates whitespace and single quotes', () => {
            expect(findDisallowedNodeImports("import { x } from 'node:crypto';")).toStrictEqual(['node:crypto']);
        });

        await it('deduplicates and sorts', () => {
            const code = 'from"node:path";from"node:fs";from"node:path";';
            expect(findDisallowedNodeImports(code)).toStrictEqual(['node:fs', 'node:path']);
        });

        await it('ignores a node: specifier that is only mentioned in a string', () => {
            // Every healthy bundle carries this @gjsify/streams hint verbatim —
            // it must NOT trip the guard.
            const code = 'throw Error(`needs ReadableStream. Import "node:stream/web" or "@gjsify/streams"`)';
            expect(findDisallowedNodeImports(code)).toStrictEqual([]);
        });

        await it('does not match a property access that ends in .import', () => {
            expect(findDisallowedNodeImports('a.import("node:fs")')).toStrictEqual([]);
        });

        await it('honours the allowlist', () => {
            expect(findDisallowedNodeImports('from"node:fs";', ['node:fs'])).toStrictEqual([]);
        });

        await it('allowlists exactly node:module, and only that', () => {
            // Keep the list at the length of the demonstrated need — every entry
            // is a specifier the guard can no longer catch. `node:module` is the
            // CLI's own `--app node` codegen template, not an import; see the
            // comment on the constant.
            expect(GJS_ALLOWED_NODE_IMPORTS).toStrictEqual(['node:module']);
            expect(findDisallowedNodeImports("import { createRequire } from 'node:module';")).toStrictEqual([]);
        });
    });

    await describe('gjs-bundle-guard: assertGjsBundleLoadable', async () => {
        await it('passes a healthy bundle', () => {
            assertGjsBundleLoadable('import{x}from"@gjsify/path";', 'dist/gjs.js');
        });

        await it('throws naming every offending specifier and the file', () => {
            let message = '';
            try {
                assertGjsBundleLoadable('from"node:fs";from"node:os";', 'dist/cli.gjs.mjs');
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain('dist/cli.gjs.mjs');
            expect(message).toContain('node:fs');
            expect(message).toContain('node:os');
            expect(message).toContain('Unsupported URI scheme for importing: node');
        });
    });
};
