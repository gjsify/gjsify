// SPDX-License-Identifier: MIT
// Regression coverage for `unresolvedWorkspaceImportPlugin` — the resolver-layer
// guard that turns a silently-externalised `@gjsify/*` substitution into a build
// error.
//
// What is actually being pinned here is the LEGITIMATE-vs-BROKEN line, because
// that is the part a blanket "fail on any external" would get wrong: every
// target externalises on purpose (`gi://*`, `cairo`/`system`/`gettext` on gjs,
// the whole `EXTERNALS_NODE` set plus `@gjsify/node-gi*` on node, user
// `--external`), and none of those may become fatal. So the suite is mostly a
// table of specifiers that MUST be ignored, next to the two shapes that must
// not be.
//
// Tested from @gjsify/cli's harness because the plugin package has no
// `test:node` script of its own — same placement rationale as
// `napi-node-addon.spec.ts` / `externals-plugin.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';
import {
    buildReverseAliasIndex,
    classifyImport,
    createGjsExternalsPredicate,
    formatUnresolvedWorkspaceImport,
    isWorkspaceSpecifier,
    unresolvedWorkspaceImportPlugin,
    UnresolvedWorkspaceImportError,
} from '@gjsify/rolldown-plugin-gjsify';

/** The `--app gjs` slice of the substitution table, enough to exercise the guard. */
const GJS_ALIASES: Record<string, string> = {
    'node:fs': '@gjsify/fs',
    fs: '@gjsify/fs',
    'fetch/register': '@gjsify/fetch/register',
    'random-access-file': 'random-access-file/index.js',
};

/** The `--app node` slice: a bare GJS built-in routed onto an EXTERNAL node-gi shim. */
const NODE_ALIASES: Record<string, string> = {
    system: '@gjsify/node-gi/system',
    assert: '@gjsify/assert/globals',
};

const IMPORTER = '/proj/src/app.ts';

/** Extract the resolveId handler from the `{ order, handler }` object form. */
type ResolveHandler = (
    this: unknown,
    source: string,
    importer: string | undefined,
    extra?: { isEntry?: boolean; kind?: string },
) => Promise<{ id: string } | null>;
function handlerOf(plugin: unknown): ResolveHandler {
    const h = (plugin as { resolveId?: { handler?: unknown } }).resolveId?.handler;
    if (typeof h !== 'function') throw new Error('plugin did not expose a resolveId.handler');
    return h as ResolveHandler;
}

/** Minimal Rolldown PluginContext mock — `resolve` maps a specifier → id. */
function mockCtx(resolveMap: Record<string, string> = {}) {
    const asked: string[] = [];
    return {
        asked,
        async resolve(id: string) {
            asked.push(id);
            const hit = resolveMap[id];
            return hit ? { id: hit } : null;
        },
    };
}

export default async () => {
    await describe('unresolved-workspace-import: isWorkspaceSpecifier', async () => {
        await it('accepts a bare @gjsify package root and subpath', () => {
            expect(isWorkspaceSpecifier('@gjsify/fs')).toBe(true);
            expect(isWorkspaceSpecifier('@gjsify/fetch/register/fetch')).toBe(true);
        });
        await it('rejects anything that is not a bare @gjsify specifier', () => {
            expect(isWorkspaceSpecifier('lodash')).toBe(false);
            expect(isWorkspaceSpecifier('node:fs')).toBe(false);
            expect(isWorkspaceSpecifier('gi://Gtk?version=4.0')).toBe(false);
            expect(isWorkspaceSpecifier('/abs/node_modules/@gjsify/fs/lib/esm/index.js')).toBe(false);
            expect(isWorkspaceSpecifier('\0gjsify-entry:/proj/src/app.ts')).toBe(false);
        });
    });

    await describe('unresolved-workspace-import: legitimate externals stay legitimate', async () => {
        const isExternal = createGjsExternalsPredicate([]);

        await it('ignores an entry module (no importer)', () => {
            const v = classifyImport({ source: '@gjsify/fs', importer: undefined, aliases: GJS_ALIASES });
            expect(v.verdict).toBe('ignore');
        });

        await it('ignores gi:// — externalised by the --app gjs policy', () => {
            const v = classifyImport({
                source: 'gi://Gtk?version=4.0',
                importer: IMPORTER,
                aliases: GJS_ALIASES,
                isExternal,
            });
            expect(v).toStrictEqual({ verdict: 'ignore', reason: 'declared-external' });
        });

        await it('ignores cairo/system/gettext — exact-name --app gjs externals', () => {
            for (const id of ['cairo', 'system', 'gettext']) {
                const v = classifyImport({ source: id, importer: IMPORTER, aliases: GJS_ALIASES, isExternal });
                expect(v).toStrictEqual({ verdict: 'ignore', reason: 'declared-external' });
            }
        });

        await it('ignores a user --external entry', () => {
            const v = classifyImport({
                source: 'my-unbundled-plugin',
                importer: IMPORTER,
                isExternal: createGjsExternalsPredicate(['my-unbundled-plugin']),
            });
            expect(v).toStrictEqual({ verdict: 'ignore', reason: 'declared-external' });
        });

        await it('ignores a specifier whose ALIAS TARGET is declared external (node target)', () => {
            // `system` → `@gjsify/node-gi/system`, kept external on --app node.
            const v = classifyImport({
                source: 'system',
                importer: IMPORTER,
                aliases: NODE_ALIASES,
                isExternal: (id) => id.startsWith('@gjsify/node-gi'),
            });
            expect(v).toStrictEqual({ verdict: 'ignore', reason: 'declared-external' });
        });

        await it('ignores a bare third-party specifier — a missing dep is not this guard’s business', () => {
            const v = classifyImport({ source: 'lodash', importer: IMPORTER, aliases: GJS_ALIASES, isExternal });
            expect(v).toStrictEqual({ verdict: 'ignore', reason: 'out-of-scope' });
        });

        await it('ignores an alias target that is not a workspace package', () => {
            // `random-access-file` → `random-access-file/index.js`: a user/shim
            // mapping, deliberately left on the old fall-through behaviour.
            const v = classifyImport({
                source: 'random-access-file',
                importer: IMPORTER,
                aliases: GJS_ALIASES,
                isExternal,
            });
            expect(v).toStrictEqual({ verdict: 'ignore', reason: 'out-of-scope' });
        });

        await it('ignores relative, absolute and synthetic ids', () => {
            for (const id of ['./local.js', '/abs/local.js', '\0gjsify-gi-node:Gtk']) {
                const v = classifyImport({ source: id, importer: IMPORTER, aliases: GJS_ALIASES, isExternal });
                expect(v).toStrictEqual({ verdict: 'ignore', reason: 'not-bare' });
            }
        });
    });

    await describe('unresolved-workspace-import: the two shapes that must resolve', async () => {
        const isExternal = createGjsExternalsPredicate([]);

        await it('checks a substituted Node builtin against its @gjsify target', () => {
            const v = classifyImport({ source: 'node:fs', importer: IMPORTER, aliases: GJS_ALIASES, isExternal });
            expect(v).toStrictEqual({ verdict: 'check', candidate: '@gjsify/fs', aliasTarget: '@gjsify/fs' });
        });

        await it('checks a direct @gjsify/* workspace import (no alias entry)', () => {
            const v = classifyImport({
                source: '@gjsify/stream',
                importer: IMPORTER,
                aliases: GJS_ALIASES,
                isExternal,
            });
            expect(v).toStrictEqual({ verdict: 'check', candidate: '@gjsify/stream' });
        });

        await it('checks a /register subpath — force-inlined, so it MUST resolve', () => {
            // `createGjsExternalsPredicate` returns false for register subpaths
            // (force-inline); the guard must therefore still demand resolution.
            expect(isExternal('fetch/register')).toBe(false);
            const v = classifyImport({
                source: 'fetch/register',
                importer: IMPORTER,
                aliases: GJS_ALIASES,
                isExternal,
            });
            expect(v).toStrictEqual({
                verdict: 'check',
                candidate: '@gjsify/fetch/register',
                aliasTarget: '@gjsify/fetch/register',
            });
        });
    });

    await describe('unresolved-workspace-import: error message', async () => {
        await it('names the substitution, the original specifier, the importer and the cause', () => {
            const msg = formatUnresolvedWorkspaceImport({
                target: 'gjs',
                source: 'node:fs',
                candidate: '@gjsify/fs',
                aliasTarget: '@gjsify/fs',
                importer: IMPORTER,
            });
            expect(msg).toContain('--app gjs');
            expect(msg).toContain('@gjsify/fs');
            expect(msg).toContain('node:fs');
            expect(msg).toContain(IMPORTER);
            expect(msg).toContain('Unsupported URI scheme for importing: node');
            expect(msg).toContain('gjsify install');
            expect(msg).toContain('gjsify run build:infra');
        });

        await it('drops the substitution clause for a direct workspace import', () => {
            const msg = formatUnresolvedWorkspaceImport({
                target: 'browser',
                source: '@gjsify/stream',
                candidate: '@gjsify/stream',
                importer: IMPORTER,
            });
            expect(msg).toContain('cannot resolve the workspace package `@gjsify/stream`');
            expect(msg).toContain('--app browser');
            expect(msg.includes('substitution for')).toBe(false);
        });

        await it('recovers the ORIGINAL node: specifier by reverse lookup', () => {
            // `aliasPlugin` resolves its target through `this.resolve`, so the id
            // that reaches the guard is `@gjsify/fs` with no alias entry of its
            // own. Without the reverse index the message would never mention the
            // `node:fs` the user wrote — the specifier that survives into the
            // bundle and the one they grep for.
            const msg = formatUnresolvedWorkspaceImport({
                target: 'gjs',
                source: '@gjsify/fs',
                candidate: '@gjsify/fs',
                aliasedFrom: ['fs', 'node:fs'],
                importer: IMPORTER,
            });
            expect(msg).toContain('substitution for `fs`, `node:fs`');
            expect(msg).toContain('Unsupported URI scheme for importing: node');
        });

        await it('drops the reverse list when the target is a shared sink', () => {
            // `@gjsify/empty` is the browser target of ~50 specifiers; naming
            // them all says nothing about which one this importer wrote.
            const msg = formatUnresolvedWorkspaceImport({
                target: 'browser',
                source: '@gjsify/empty',
                candidate: '@gjsify/empty',
                aliasedFrom: ['a', 'b', 'c', 'd', 'e'],
                importer: IMPORTER,
            });
            expect(msg).toContain('cannot resolve the workspace package `@gjsify/empty`');
            expect(msg.includes('substitution for')).toBe(false);
        });

        await it('reverses the substitution table, grouping both specifier forms', () => {
            const index = buildReverseAliasIndex(GJS_ALIASES);
            expect(index.get('@gjsify/fs')).toStrictEqual(['fs', 'node:fs']);
            expect(index.get('random-access-file/index.js')).toStrictEqual(['random-access-file']);
            expect(index.get('@gjsify/nope')).toBeUndefined();
            expect(buildReverseAliasIndex(undefined).size).toBe(0);
        });
    });

    await describe('unresolved-workspace-import: plugin behaviour', async () => {
        const plugin = unresolvedWorkspaceImportPlugin({
            target: 'gjs',
            aliases: GJS_ALIASES,
            isExternal: createGjsExternalsPredicate([]),
        });
        const handler = handlerOf(plugin);

        await it('is registered as a post-order resolveId hook', () => {
            expect((plugin as { resolveId: { order: string } }).resolveId.order).toBe('post');
        });

        await it('returns the resolved id when the workspace edge exists', async () => {
            const ctx = mockCtx({ '@gjsify/fs': '/proj/node_modules/@gjsify/fs/lib/esm/index.js' });
            const out = await handler.call(ctx, 'node:fs', IMPORTER);
            expect(out).toStrictEqual({ id: '/proj/node_modules/@gjsify/fs/lib/esm/index.js' });
            expect(ctx.asked).toStrictEqual(['@gjsify/fs']);
        });

        await it('throws instead of externalising when the workspace edge is missing', async () => {
            const ctx = mockCtx();
            let caught: unknown;
            try {
                await handler.call(ctx, 'node:fs', IMPORTER);
            } catch (err) {
                caught = err;
            }
            expect(caught instanceof UnresolvedWorkspaceImportError).toBe(true);
            expect((caught as Error).message).toContain('@gjsify/fs');
            expect((caught as Error).message).toContain(IMPORTER);
        });

        await it('never touches a declared external, even when unresolvable', async () => {
            const ctx = mockCtx();
            expect(await handler.call(ctx, 'gi://Gtk?version=4.0', IMPORTER)).toBeNull();
            expect(await handler.call(ctx, 'cairo', IMPORTER)).toBeNull();
            expect(ctx.asked).toStrictEqual([]);
        });

        await it('never touches an entry module', async () => {
            const ctx = mockCtx();
            expect(await handler.call(ctx, '@gjsify/fs', undefined, { isEntry: true })).toBeNull();
            expect(ctx.asked).toStrictEqual([]);
        });

        await it('treats a NULL importer as an entry (the native engine’s spelling)', async () => {
            // `@gjsify/rolldown-native` round-trips its hook payload through
            // JSON, so "no importer" arrives as `null`, not `undefined` — the
            // #840 trap. Without normalisation the entry would be resolved as
            // a normal edge and could throw for a file the caller named.
            const ctx = mockCtx();
            expect(await handler.call(ctx, '@gjsify/fs', null as unknown as undefined)).toBeNull();
            expect(ctx.asked).toStrictEqual([]);
        });
    });
};
