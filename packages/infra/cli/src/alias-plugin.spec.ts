// SPDX-License-Identifier: MIT
// Regression coverage for `aliasPlugin`'s two scoping invariants.
//
//  1. An import whose IMPORTER is a gjsify-generated (`\0gjsify-*`) virtual
//     module is never rewritten. That module's source is OURS; it names the
//     RUNTIME module it needs. The motivating failure was
//     `gjsGiNodePlugin`'s `import { createRequire } from 'node:module'` being
//     retargeted onto `@gjsify/module` by the node-gi consumer harness's
//     `--alias node:module=@gjsify/module`, which detonated at bundle load
//     with `TypeError: … reading 'filename_from_uri'`.
//  2. An alias target is TERMINAL — resolved in exactly one hop, never fed
//     back through the table. The merged `entries` map has lost the tier a
//     value came from, so chaining would apply derived slot routing to USER
//     aliases (see the plugin's header comment for the full argument).
//
// Tested from @gjsify/cli's harness because the plugin package has no
// `test:node` script of its own — same placement rationale as
// `napi-node-addon.spec.ts` / `externals-plugin.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';
import { aliasPlugin, isGjsifyVirtualModuleId, GJSIFY_VIRTUAL_PREFIX } from '@gjsify/rolldown-plugin-gjsify';

/** Extract the resolveId handler from the `{order, handler}` object form. */
type ResolveHandler = (
    this: unknown,
    source: string,
    importer: string | undefined,
    extraOptions?: { kind?: string },
) => Promise<{ id: string } | null> | ({ id: string } | null);

function handlerOf(plugin: unknown): ResolveHandler {
    const resolveId = (plugin as { resolveId?: { handler?: unknown } }).resolveId;
    const h = resolveId?.handler;
    if (typeof h !== 'function') throw new Error('aliasPlugin did not expose a resolveId.handler');
    return h as ResolveHandler;
}

/**
 * Minimal Rolldown PluginContext mock. `resolveMap` maps a specifier → id;
 * every `this.resolve()` call is recorded so a test can assert HOW MANY hops
 * the plugin took and with WHICH specifier.
 */
function mockCtx(resolveMap: Record<string, string> = {}): {
    resolve: (s: string, importer?: string, opts?: unknown) => Promise<{ id: string } | null>;
    calls: string[];
} {
    const calls: string[] = [];
    return {
        async resolve(s: string) {
            calls.push(s);
            const hit = resolveMap[s];
            return hit ? { id: hit } : null;
        },
        calls,
    };
}

const REAL_IMPORTER = '/project/src/app.ts';

export default async () => {
    await describe('alias-plugin: isGjsifyVirtualModuleId', async () => {
        await it('recognises every gjsify-generated virtual id', () => {
            expect(isGjsifyVirtualModuleId(`${GJSIFY_VIRTUAL_PREFIX}gi-node:Gio@2.0`)).toBe(true);
            expect(isGjsifyVirtualModuleId(`${GJSIFY_VIRTUAL_PREFIX}entry:/project/src/app.ts`)).toBe(true);
            expect(isGjsifyVirtualModuleId(`${GJSIFY_VIRTUAL_PREFIX}napi-addon:direct:/x/y.node`)).toBe(true);
            expect(isGjsifyVirtualModuleId(`${GJSIFY_VIRTUAL_PREFIX}empty-gjs-import`)).toBe(true);
        });

        await it('does NOT claim real sources, other plugins’ virtuals, or undefined', () => {
            expect(isGjsifyVirtualModuleId(REAL_IMPORTER)).toBe(false);
            expect(isGjsifyVirtualModuleId('@gjsify/module')).toBe(false);
            // A `\0`-prefixed id from some OTHER plugin is not ours to skip.
            expect(isGjsifyVirtualModuleId('\0vite/other')).toBe(false);
            expect(isGjsifyVirtualModuleId(undefined)).toBe(false);
            expect(isGjsifyVirtualModuleId(null)).toBe(false);
        });
    });

    await describe('alias-plugin: virtual-module scoping', async () => {
        await it('does NOT rewrite node:module for a gjsify virtual importer', async () => {
            const plugin = aliasPlugin({ entries: { 'node:module': '@gjsify/module' } });
            const ctx = mockCtx({ '@gjsify/module': '/w/@gjsify/module/lib/esm/index.js' });
            const res = await handlerOf(plugin).call(ctx, 'node:module', `${GJSIFY_VIRTUAL_PREFIX}gi-node:Gio@2.0`);
            expect(res).toBe(null);
            // Not even a resolution attempt — the specifier falls through
            // untouched so the runtime builtin wins.
            expect(ctx.calls.length).toBe(0);
        });

        await it('does NOT rewrite for the virtual ENTRY wrapper either', async () => {
            const plugin = aliasPlugin({ entries: { '@gjsify/node-gi/globals': '@gjsify/empty' } });
            const ctx = mockCtx({ '@gjsify/empty': '/w/@gjsify/empty/index.js' });
            const importer = `${GJSIFY_VIRTUAL_PREFIX}entry:${REAL_IMPORTER}`;
            expect(await handlerOf(plugin).call(ctx, '@gjsify/node-gi/globals', importer)).toBe(null);
            expect(ctx.calls.length).toBe(0);
        });

        await it('STILL rewrites the same specifier for real source (scoped, not disabled)', async () => {
            const plugin = aliasPlugin({ entries: { 'node:module': '@gjsify/module' } });
            const ctx = mockCtx({ '@gjsify/module': '/w/@gjsify/module/lib/esm/index.js' });
            const res = await handlerOf(plugin).call(ctx, 'node:module', REAL_IMPORTER);
            expect(res).toStrictEqual({ id: '/w/@gjsify/module/lib/esm/index.js' });
            expect(ctx.calls).toStrictEqual(['@gjsify/module']);
        });

        await it('rewrites for an ENTRY module (importer undefined)', async () => {
            const plugin = aliasPlugin({ entries: { assert: '@gjsify/assert' } });
            const ctx = mockCtx({ '@gjsify/assert': '/w/@gjsify/assert/lib/esm/index.js' });
            const res = await handlerOf(plugin).call(ctx, 'assert', undefined);
            expect(res).toStrictEqual({ id: '/w/@gjsify/assert/lib/esm/index.js' });
        });
    });

    await describe('alias-plugin: an alias target is terminal', async () => {
        await it('resolves the FIRST target, never re-feeding it through the table', async () => {
            // `node:stream` → `@gjsify/stream` is the harness/user tier;
            // `@gjsify/stream` → `@gjsify/stream/globals` is the derived
            // slot-routing tier. Both live in the SAME merged map. A chain
            // would hand the user Node's own builtin back.
            const plugin = aliasPlugin({
                entries: {
                    'node:stream': '@gjsify/stream',
                    '@gjsify/stream': '@gjsify/stream/globals',
                },
            });
            const ctx = mockCtx({
                '@gjsify/stream': '/w/@gjsify/stream/lib/esm/index.js',
                '@gjsify/stream/globals': '/w/@gjsify/stream/globals.mjs',
            });
            const res = await handlerOf(plugin).call(ctx, 'node:stream', REAL_IMPORTER);
            expect(res).toStrictEqual({ id: '/w/@gjsify/stream/lib/esm/index.js' });
            expect(ctx.calls).toStrictEqual(['@gjsify/stream']);
        });

        await it('skips a self-referential entry instead of looping', async () => {
            const plugin = aliasPlugin({ entries: { 'node:fs': 'node:fs' } });
            const ctx = mockCtx({ 'node:fs': '/w/fs.js' });
            expect(await handlerOf(plugin).call(ctx, 'node:fs', REAL_IMPORTER)).toBe(null);
            expect(ctx.calls.length).toBe(0);
        });

        await it('falls through when the target does not resolve', async () => {
            const plugin = aliasPlugin({ entries: { ws: '@gjsify/ws' } });
            const ctx = mockCtx();
            expect(await handlerOf(plugin).call(ctx, 'ws', REAL_IMPORTER)).toBe(null);
            expect(ctx.calls).toStrictEqual(['@gjsify/ws']);
        });

        await it('leaves unmapped specifiers alone', async () => {
            const plugin = aliasPlugin({ entries: { assert: '@gjsify/assert' } });
            const ctx = mockCtx();
            expect(await handlerOf(plugin).call(ctx, 'lodash', REAL_IMPORTER)).toBe(null);
            expect(ctx.calls.length).toBe(0);
        });
    });
};
