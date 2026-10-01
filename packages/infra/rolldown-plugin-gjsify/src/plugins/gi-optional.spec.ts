// SPDX-License-Identifier: MIT
// The `&optional` flag on a `gi://` specifier (ADR 0086): what it is parsed to, and
// the module a flagged import resolves to. The runtime behaviour on a host without the
// typelib is pinned end to end by `tests/e2e/gi-optional`.

import { describe, it, expect } from '@gjsify/unit';
import { giOptionalPlugin, giOptionalShimSource, parseOptionalGiSpecifier } from './gi-optional.js';

type Hook = { handler: (this: unknown, ...args: unknown[]) => unknown };

export default async () => {
    await describe('parseOptionalGiSpecifier', async () => {
        await it('strips the flag and keeps the version', () => {
            const parsed = parseOptionalGiSpecifier('gi://Goa?version=1.0&optional');
            expect(parsed?.specifier).toBe('gi://Goa?version=1.0');
            expect(parsed?.namespace).toBe('Goa');
            expect(parsed?.version).toBe('1.0');
        });

        await it('accepts the flag first and as the only parameter', () => {
            expect(parseOptionalGiSpecifier('gi://Goa?optional&version=1.0')?.specifier).toBe('gi://Goa?version=1.0');
            expect(parseOptionalGiSpecifier('gi://Goa?optional')?.specifier).toBe('gi://Goa');
        });

        await it('leaves an unflagged or foreign specifier alone', () => {
            expect(parseOptionalGiSpecifier('gi://Goa?version=1.0')).toBeNull();
            expect(parseOptionalGiSpecifier('gi://Goa')).toBeNull();
            expect(parseOptionalGiSpecifier('node:fs?optional')).toBeNull();
        });
    });

    await describe('giOptionalShimSource', async () => {
        await it('awaits the verbatim, flag-free specifier inside a try', () => {
            const src = giOptionalShimSource('gi://Goa?version=1.0', 'Goa', '1.0');
            expect(src).toContain('await import("gi://Goa?version=1.0")');
            expect(src).toContain('try {');
            expect(src).not.toContain('optional&');
            expect(src).toContain('export default ns;');
        });

        await it('names the namespace and version in the diagnostic', () => {
            expect(giOptionalShimSource('gi://Goa?version=1.0', 'Goa', '1.0')).toContain(
                'optional GI namespace Goa 1.0 is not available',
            );
        });

        await it('is valid module syntax', () => {
            const src = giOptionalShimSource('gi://Goa?version=1.0', 'Goa', '1.0');
            // `export default` and top-level await only parse as a module.
            expect(() => new Function(`return async () => {${src.replace('export default ns;', '')}}`)).not.toThrow();
        });
    });

    await describe('giOptionalPlugin', async () => {
        const plugin = giOptionalPlugin();
        const resolve = (plugin.resolveId as unknown as Hook).handler;
        const load = plugin.load as unknown as (id: string) => { code: string } | null;

        await it('claims only flagged specifiers', () => {
            expect(resolve.call({}, 'gi://Goa?version=1.0')).toBeNull();
            expect(resolve.call({}, 'gi://Goa?version=1.0&optional')).not.toBeNull();
        });

        await it('round-trips resolve → load to the guarded import', () => {
            const resolved = resolve.call({}, 'gi://Goa?version=1.0&optional') as { id: string };
            expect(load(resolved.id)?.code).toContain('await import("gi://Goa?version=1.0")');
        });

        await it('does not load ids it did not mint', () => {
            expect(load('/some/file.js')).toBeNull();
        });
    });
};
