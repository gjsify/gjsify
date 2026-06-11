// Regression coverage for the shared `externalsPlugin` resolveId hook +
// the library-mode `isExternalSpecifier` policy.
//
// The library/app externals policies are enforced via a `resolveId` hook
// returning `{ id, external: true }` because the top-level `external`
// FUNCTION option is silently dropped by `@gjsify/rolldown-native`'s
// JSON options marshalling (the documented bug class — shipped twice via
// app/node.ts and library/lib.ts predicates before the plugin form
// landed, with `--app gjs` as the third live instance). Before these
// tests the only guard was the CI bundle-grep counting 'must be a
// ReadableStream' occurrences in the committed CLI bundle — maximally
// indirect. These rows pin:
//
//   - `isExternalSpecifier`: bare/scoped/protocol → external; relative /
//     absolute / `\0`-virtual / `data:` ids → bundled.
//   - the plugin's ENTRY GUARD: `importer === undefined` or
//     `options.isEntry` → null even for bare ids. A regression there
//     externalizes ENTRY modules and emits empty packages.
//
// Tested from @gjsify/cli's test harness because the plugin package has
// no `test:node` script of its own (same placement rationale as
// auto-globals.spec.ts).

import { describe, expect, it } from '@gjsify/unit';
import { externalsPlugin, isExternalSpecifier } from '@gjsify/rolldown-plugin-gjsify';

type ResolveIdHook = (
    source: string,
    importer: string | undefined,
    options?: { isEntry?: boolean },
) => { id: string; external: boolean } | null;

function hookOf(plugin: unknown): ResolveIdHook {
    const resolveId = (plugin as { resolveId?: unknown }).resolveId;
    if (typeof resolveId !== 'function') throw new Error('externalsPlugin did not expose a resolveId function');
    return resolveId as ResolveIdHook;
}

export default async () => {
    await describe('isExternalSpecifier — library-mode externals contract', async () => {
        await it('marks bare / scoped / protocol specifiers external', () => {
            expect(isExternalSpecifier('three')).toBe(true);
            expect(isExternalSpecifier('@gjsify/web-streams')).toBe(true);
            expect(isExternalSpecifier('@scope/dep/subpath')).toBe(true);
            expect(isExternalSpecifier('node:fs')).toBe(true);
            expect(isExternalSpecifier('gi://Gtk?version=4.0')).toBe(true);
        });

        await it('keeps relative and absolute source modules internal', () => {
            expect(isExternalSpecifier('./local.js')).toBe(false);
            expect(isExternalSpecifier('../up.js')).toBe(false);
            expect(isExternalSpecifier('/abs/path/mod.js')).toBe(false);
        });

        await it('keeps rolldown \\0-virtual modules internal', () => {
            expect(isExternalSpecifier('\0rolldown/runtime')).toBe(false);
            expect(isExternalSpecifier('\0gjsify-entry:src/index.ts')).toBe(false);
        });

        await it('keeps data: URI modules internal (must be inlined, never re-imported)', () => {
            expect(isExternalSpecifier('data:text/javascript,export default 1')).toBe(false);
        });
    });

    await describe('externalsPlugin — resolveId {external:true} enforcement', async () => {
        await it('externalizes a matching specifier with the ORIGINAL id', () => {
            const hook = hookOf(externalsPlugin(isExternalSpecifier));
            const res = hook('@gjsify/web-streams', '/pkg/src/index.ts', { isEntry: false });
            expect(res).toStrictEqual({ id: '@gjsify/web-streams', external: true });
        });

        await it('returns null for non-matching specifiers (falls through to normal resolution)', () => {
            const hook = hookOf(externalsPlugin(isExternalSpecifier));
            expect(hook('./local.js', '/pkg/src/index.ts', { isEntry: false })).toBe(null);
            expect(hook('\0virtual', '/pkg/src/index.ts', { isEntry: false })).toBe(null);
        });

        await it('NEVER externalizes entry modules — importer undefined', () => {
            // Entry-guard regression = entries marked external = empty output.
            const hook = hookOf(externalsPlugin(() => true));
            expect(hook('src/index.ts', undefined, { isEntry: true })).toBe(null);
            expect(hook('bare-looking-entry', undefined, undefined)).toBe(null);
        });

        await it('NEVER externalizes entry modules — options.isEntry true', () => {
            const hook = hookOf(externalsPlugin(() => true));
            expect(hook('src/index.ts', '/some/importer.ts', { isEntry: true })).toBe(null);
        });

        await it('uses the provided plugin name (default gjsify-externalize)', () => {
            expect((externalsPlugin(() => false) as { name?: string }).name).toBe('gjsify-externalize');
            expect((externalsPlugin(() => false, { name: 'gjsify-lib-externalize' }) as { name?: string }).name).toBe(
                'gjsify-lib-externalize',
            );
        });
    });
};
