// Coverage for `resolveUserPlugins` — resolving `bundler.plugins` entries that
// reference a plugin by package name. The key contract added for the Node-free
// build chain is the injectable `loadModule` strategy: under GJS the CLI swaps
// the default direct `import()` for a bundle-then-import loader (GJS can't
// follow `package.json#exports` subpath maps), and that swap must be honoured
// without changing any other resolution behaviour.
//
// Note: `resolveUserPlugins` ALWAYS resolves the entry name to an on-disk path
// first (`createRequire.resolve`), then hands that path to `loadModule`. So the
// injection tests use a real (resolvable) fixture file; the swapped loader only
// changes how the resolved path becomes a module namespace.

import { describe, it, expect } from '@gjsify/unit';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveUserPlugins, isPluginByName } from './resolve-plugin-by-name.js';

export default async () => {
    // One real fixture dir/file so `createRequire.resolve('./fixture-plugin.mjs')`
    // succeeds and the loader (default or injected) gets a valid path.
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-resolve-plugin-'));
    const FIXTURE = './fixture-plugin.mjs';
    writeFileSync(
        join(dir, 'fixture-plugin.mjs'),
        'export default (opts) => ({ name: "fixture", echoed: opts?.v });\n',
    );

    await describe('resolveUserPlugins', async () => {
        await it('uses the injected loadModule for by-name entries', async () => {
            const calls: Array<{ path: string; name: string }> = [];
            const resolved = await resolveUserPlugins([{ name: FIXTURE, options: { marker: 7 } }], dir, {
                loadModule: async (path, name) => {
                    calls.push({ path, name });
                    return { default: (opts: { marker: number }) => ({ name: 'from-injected', opts }) };
                },
            });
            expect(calls.length).toBe(1);
            expect(calls[0]!.name).toBe(FIXTURE);
            // The injected loader received the RESOLVED absolute path, not the
            // bare entry name.
            expect(calls[0]!.path.endsWith('fixture-plugin.mjs')).toBe(true);
            expect((resolved[0] as { name: string }).name).toBe('from-injected');
            expect((resolved[0] as { opts: { marker: number } }).opts.marker).toBe(7);
        });

        await it('passes plugin objects through untouched (loader not called)', async () => {
            const pluginObj = { name: 'already-a-plugin', transform() {} };
            let loaderCalled = false;
            const resolved = await resolveUserPlugins([pluginObj], dir, {
                loadModule: async () => {
                    loaderCalled = true;
                    return { default: () => ({}) };
                },
            });
            expect(loaderCalled).toBe(false);
            expect(resolved[0]).toBe(pluginObj);
        });

        await it('honours a named export', async () => {
            const resolved = await resolveUserPlugins([{ name: FIXTURE, export: 'namedFactory' }], dir, {
                loadModule: async () => ({
                    default: () => ({ name: 'wrong' }),
                    namedFactory: () => ({ name: 'right' }),
                }),
            });
            expect((resolved[0] as { name: string }).name).toBe('right');
        });

        await it('throws when the chosen export is not a function', async () => {
            let threw = false;
            try {
                await resolveUserPlugins([{ name: FIXTURE }], dir, {
                    loadModule: async () => ({ notAFunction: 1 }),
                });
            } catch (err) {
                threw = true;
                expect((err as Error).message).toContain('no function export');
            }
            expect(threw).toBe(true);
        });

        await it('throws when the factory returns nullish', async () => {
            let threw = false;
            try {
                await resolveUserPlugins([{ name: FIXTURE }], dir, {
                    loadModule: async () => ({ default: () => null }),
                });
            } catch (err) {
                threw = true;
                expect((err as Error).message).toContain('returned null');
            }
            expect(threw).toBe(true);
        });

        await it('default loader does a direct import of the resolved file', async () => {
            // No loadModule → the DEFAULT loader (plain dynamic import) runs
            // against the real fixture file.
            const resolved = await resolveUserPlugins([{ name: FIXTURE, options: { v: 'hi' } }], dir);
            expect((resolved[0] as { name: string }).name).toBe('fixture');
            expect((resolved[0] as { echoed: string }).echoed).toBe('hi');
        });

        await it('isPluginByName discriminates plugin objects from by-name entries', async () => {
            expect(isPluginByName({ name: 'pkg' })).toBe(true);
            expect(isPluginByName({ name: 'pkg', transform() {} })).toBe(false);
            expect(isPluginByName({ name: 'pkg', resolveId() {} })).toBe(false);
            expect(isPluginByName(null)).toBe(false);
            expect(isPluginByName('string')).toBe(false);
        });
    });

    rmSync(dir, { recursive: true, force: true });
};
