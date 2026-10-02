// SPDX-License-Identifier: MIT
// `&optional` flag on a `gi://` specifier (ADR 0087): what it is parsed to, the
// module a flagged import resolves to on each target, and the marker statement that
// records the namespace as optional in the ARTIFACT — which is what `depends.ts`
// reads (`@gjsify/cli`'s `depends.spec.ts` reads this same shim as its fixture, so
// the two cannot drift). The runtime behaviour on a host without the typelib is
// pinned end to end by `tests/e2e/gi-optional`.

import { describe, it, expect } from '@gjsify/unit';
import {
    GI_OPTIONAL_MARKER,
    giOptionalMarkerSource,
    giOptionalNodeShimSource,
    giOptionalPlugin,
    giOptionalShimSource,
    parseOptionalGiSpecifier,
} from './gi-optional.js';

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

        await it('is not fooled by a parameter whose NAME merely starts with the flag', () => {
            // The filter is a regex on the raw specifier, so the handler is the
            // load-bearing check — an engine that ignores filters, or a specifier
            // carrying `optionalThing=1`, must not be claimed.
            expect(parseOptionalGiSpecifier('gi://Goa?optionalThing=1')).toBeNull();
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

    await describe('the optional marker', async () => {
        await it('names the namespace and version as two string arguments', () => {
            // TWO arguments in the `requireGi("Ns", "X")` spelling, because the node
            // arm's shim carries that call instead of a `gi://` specifier and one
            // reader has to classify both targets.
            expect(giOptionalMarkerSource('Goa', '1.0')).toBe(
                `globalThis[Symbol.for(${JSON.stringify(GI_OPTIONAL_MARKER)})]?.("Goa", "1.0");`,
            );
        });

        await it('omits the version rather than sending an empty one', () => {
            // `requireGi` cannot tell `''` from a version, and neither can the
            // reader — so an unpinned namespace stays unpinned on both sides.
            expect(giOptionalMarkerSource('Goa')).toBe(
                `globalThis[Symbol.for(${JSON.stringify(GI_OPTIONAL_MARKER)})]?.("Goa");`,
            );
        });

        await it('is in BOTH shims, not only the gjs one', () => {
            // A node bundle has no `gi://` specifier at all, so this statement is
            // the only thing in the artifact that says which of its namespaces may
            // be missing.
            expect(giOptionalShimSource('gi://Goa?version=1.0', 'Goa', '1.0')).toContain(
                giOptionalMarkerSource('Goa', '1.0'),
            );
            expect(giOptionalNodeShimSource('Goa', '1.0')).toContain(giOptionalMarkerSource('Goa', '1.0'));
        });

        await it('is an OPTIONAL call, so a host that registers nothing pays nothing', () => {
            // `?.()` and not `()`: the key is a slot a future runtime may fill, and a
            // bundle that hard-called it would crash every host that does not.
            expect(giOptionalShimSource('gi://Goa', 'Goa')).toContain(']?.("Goa")');
        });
    });

    await describe('giOptionalNodeShimSource', async () => {
        await it('loads through node-gi inside a try, default-exporting the namespace or undefined', () => {
            const src = giOptionalNodeShimSource('Goa', '1.0');
            expect(src).toContain(`require('@gjsify/node-gi/gi').requireGi("Goa", "1.0")`);
            expect(src).toContain('try {');
            expect(src).toContain('export default ns;');
        });

        await it('omits the version argument when the specifier pins none', () => {
            expect(giOptionalNodeShimSource('Goa')).toContain('requireGi("Goa")');
            expect(giOptionalNodeShimSource('Goa')).not.toContain('requireGi("Goa", "")');
        });

        await it('is NOT a top-level await, unlike the gjs arm', () => {
            // The hard node shim is synchronous (`require`, not `import()`), and
            // this arm has to match it: a flag whose whole purpose is that the app
            // can branch on the result must not force every importer to be async.
            expect(giOptionalNodeShimSource('Goa')).not.toContain('await');
        });

        await it('names the namespace and version in the diagnostic', () => {
            expect(giOptionalNodeShimSource('Goa', '1.0')).toContain('optional GI namespace Goa 1.0 is not available');
        });
    });

    await describe('giOptionalPlugin', async () => {
        const loadOf = (plugin: ReturnType<typeof giOptionalPlugin>) =>
            plugin.load as unknown as (id: string) => {
                code: string;
            } | null;

        await it('claims only flagged specifiers', () => {
            for (const target of ['gjs', 'node'] as const) {
                const resolve = (giOptionalPlugin(target).resolveId as unknown as Hook).handler;
                expect(resolve.call({}, 'gi://Goa?version=1.0')).toBeNull();
                expect(resolve.call({}, 'gi://Goa?version=1.0&optional')).not.toBeNull();
            }
        });

        await it('mints target-specific ids, so one load hook answers both arms', () => {
            // Two prefixes rather than a flag inside the id: the node arm's body is
            // not the gjs arm's, and a shared prefix would make `load` guess which
            // build is running.
            const gjs = (giOptionalPlugin('gjs').resolveId as unknown as Hook).handler;
            const node = (giOptionalPlugin('node').resolveId as unknown as Hook).handler;
            const from = (handler: Hook['handler']) =>
                handler.call({}, 'gi://Goa?version=1.0&optional') as { id: string };
            expect(from(gjs).id).not.toBe(from(node).id);
        });

        await it('round-trips resolve → load to the guarded import', () => {
            const gjs = giOptionalPlugin('gjs');
            const resolved = (gjs.resolveId as unknown as Hook).handler.call({}, 'gi://Goa?version=1.0&optional') as {
                id: string;
            };
            expect(loadOf(gjs)(resolved.id)?.code).toContain('await import("gi://Goa?version=1.0")');
        });

        await it('round-trips resolve → load to the node-gi call on the node target', () => {
            const node = giOptionalPlugin('node');
            const resolved = (node.resolveId as unknown as Hook).handler.call({}, 'gi://Goa?version=1.0&optional') as {
                id: string;
            };
            expect(loadOf(node)(resolved.id)?.code).toContain(`requireGi("Goa", "1.0")`);
        });

        await it("does not load the other target's ids", () => {
            // The cross-wiring this forbids is the defect the node composition
            // exists to prevent: the gjs arm's `await import("gi://Goa")` reaching a
            // node bundle is an `ERR_UNSUPPORTED_ESM_URL_SCHEME` at load.
            const gjs = giOptionalPlugin('gjs');
            const nodeId = (giOptionalPlugin('node').resolveId as unknown as Hook).handler.call(
                {},
                'gi://Goa?version=1.0&optional',
            ) as { id: string };
            expect(loadOf(gjs)(nodeId.id)).toBeNull();
        });

        await it('does not load ids it did not mint', () => {
            expect(loadOf(giOptionalPlugin('gjs'))('/some/file.js')).toBeNull();
            expect(loadOf(giOptionalPlugin('node'))('/some/file.js')).toBeNull();
        });
    });
};
