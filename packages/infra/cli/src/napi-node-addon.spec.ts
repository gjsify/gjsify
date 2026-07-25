// SPDX-License-Identifier: MIT
// Regression coverage for the transparent N-API `.node`-addon loader
// (`napiNodeAddonPlugin`) — the forward mirror of `gjsGiNodePlugin`. Pure logic,
// no typelib: fixture package roots + shim-shape assertions. The real-addon
// byte-identical proof lives in the NAPI gate (`packages/napi/napi/test/
// transparent-gate.mjs`), where the GjsifyNapi typelib exists (napi.yml CI).
//
// Tested from @gjsify/cli's test harness because the plugin package has no
// `test:node` script of its own (same placement rationale as auto-globals.spec.ts
// and externals-plugin.spec.ts — the CLI already depends on the plugin and
// re-exports its public API).

import { describe, expect, it } from '@gjsify/unit';
import {
    napiNodeAddonPlugin,
    resolveAddonPath,
    nearestPackageRoot,
    classifySpecifier,
    directNodeShim,
    nodeGypBuildShim,
    bindingsShim,
    napiRsShim,
    isNapiRsPackageJson,
    detectNapiRsEntry,
    AddonNotBuiltError,
} from '@gjsify/rolldown-plugin-gjsify';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Build a throwaway addon-package fixture; returns its root dir. */
function makeFixture(build: (root: string) => void): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-napi-addon-'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'fixture-addon' }));
    build(root);
    return root;
}

function touch(dir: string, file: string): string {
    mkdirSync(dir, { recursive: true });
    const p = join(dir, file);
    writeFileSync(p, '');
    return p;
}

/** Extract the resolveId handler from the `{order,filter,handler}` object form. */
type ResolveHandler = (
    this: unknown,
    source: string,
    importer: string | undefined,
) => Promise<{ id: string } | null> | ({ id: string } | null);
function handlerOf(plugin: unknown): ResolveHandler {
    const resolveId = (plugin as { resolveId?: { handler?: unknown } }).resolveId;
    const h = resolveId?.handler;
    if (typeof h !== 'function') throw new Error('napiNodeAddonPlugin did not expose a resolveId.handler');
    return h as ResolveHandler;
}

/** Minimal Rolldown PluginContext mock. `resolve` maps a specifier → id. */
function mockCtx(resolveMap: Record<string, string | null> = {}): {
    resolve: (s: string) => Promise<{ id: string } | null>;
    warn: (m: string) => void;
    warnings: string[];
} {
    const warnings: string[] = [];
    return {
        async resolve(s: string) {
            const hit = resolveMap[s];
            return hit ? { id: hit } : null;
        },
        warn(m: string) {
            warnings.push(m);
        },
        warnings,
    };
}

export default async () => {
    await describe('napi-node-addon: classifySpecifier', async () => {
        await it('claims the node-gyp-build helper (bare + index.js form)', () => {
            expect(classifySpecifier('node-gyp-build')).toStrictEqual({ kind: 'node-gyp-build' });
            expect(classifySpecifier('node-gyp-build/index.js')).toStrictEqual({ kind: 'node-gyp-build' });
        });
        await it('claims the bindings helper (bare + bindings.js form)', () => {
            expect(classifySpecifier('bindings')).toStrictEqual({ kind: 'bindings' });
            expect(classifySpecifier('bindings/bindings.js')).toStrictEqual({ kind: 'bindings' });
        });
        await it('claims a direct .node specifier (relative + absolute)', () => {
            expect(classifySpecifier('./build/Release/x.node')).toStrictEqual({ kind: 'direct-node' });
            expect(classifySpecifier('/abs/path/x.node')).toStrictEqual({ kind: 'direct-node' });
        });
        await it('flags a napi-rs platform sibling as a candidate', () => {
            expect(classifySpecifier('@node-rs/argon2-linux-x64-gnu')).toStrictEqual({ kind: 'napi-rs-candidate' });
            expect(classifySpecifier('better-sqlite3-darwin-arm64')).toStrictEqual({ kind: 'napi-rs-candidate' });
            expect(classifySpecifier('pkg-win32-x64-msvc')).toStrictEqual({ kind: 'napi-rs-candidate' });
        });
        await it('ignores ordinary specifiers (falls through to normal resolution)', () => {
            expect(classifySpecifier('better-sqlite3')).toBe(null);
            expect(classifySpecifier('react')).toBe(null);
            expect(classifySpecifier('./local.js')).toBe(null);
            expect(classifySpecifier('@scope/pkg/subpath')).toBe(null);
            // A relative path that merely CONTAINS a triple is not a bare sibling.
            expect(classifySpecifier('./foo-linux-x64-gnu')).toBe(null);
        });
    });

    await describe('napi-node-addon: resolveAddonPath (node-gyp-build probe order)', async () => {
        await it('picks build/Release/*.node', () => {
            const root = makeFixture((r) => touch(join(r, 'build', 'Release'), 'addon.node'));
            expect(resolveAddonPath(root)).toBe(join(root, 'build', 'Release', 'addon.node'));
            rmSync(root, { recursive: true, force: true });
        });
        await it('falls back to build/Debug/*.node', () => {
            const root = makeFixture((r) => touch(join(r, 'build', 'Debug'), 'addon.node'));
            expect(resolveAddonPath(root)).toBe(join(root, 'build', 'Debug', 'addon.node'));
            rmSync(root, { recursive: true, force: true });
        });
        await it('prefers build/Release over build/Debug AND over prebuilds (node-gyp-build order)', () => {
            const tuple = `${process.platform}-${process.arch}`;
            const root = makeFixture((r) => {
                touch(join(r, 'build', 'Release'), 'addon.node');
                touch(join(r, 'build', 'Debug'), 'addon.node');
                touch(join(r, 'prebuilds', tuple), 'node.napi.node');
            });
            expect(resolveAddonPath(root)).toBe(join(root, 'build', 'Release', 'addon.node'));
            rmSync(root, { recursive: true, force: true });
        });
        await it('resolves a napi-tagged prebuild for the host tuple when no build/ dir', () => {
            const tuple = `${process.platform}-${process.arch}`;
            const root = makeFixture((r) => touch(join(r, 'prebuilds', tuple), 'node.napi.node'));
            expect(resolveAddonPath(root)).toBe(join(root, 'prebuilds', tuple, 'node.napi.node'));
            rmSync(root, { recursive: true, force: true });
        });
        await it('ignores a prebuild tuple for a different platform', () => {
            const root = makeFixture((r) => touch(join(r, 'prebuilds', 'aix-ppc64'), 'node.napi.node'));
            expect(() => resolveAddonPath(root)).toThrow();
            rmSync(root, { recursive: true, force: true });
        });
        await it('throws AddonNotBuiltError when no .node exists anywhere', () => {
            const root = makeFixture(() => {});
            let err: unknown;
            try {
                resolveAddonPath(root);
            } catch (e) {
                err = e;
            }
            expect(err instanceof AddonNotBuiltError).toBe(true);
            expect(String((err as Error).message)).toContain('no compiled .node found');
            rmSync(root, { recursive: true, force: true });
        });
        await it('warns (but still resolves) when build/Release has multiple .node', () => {
            const root = makeFixture((r) => {
                touch(join(r, 'build', 'Release'), 'a.node');
                touch(join(r, 'build', 'Release'), 'b.node');
            });
            const warnings: string[] = [];
            // Deterministic: sorted, first wins ('a.node').
            expect(resolveAddonPath(root, { warn: (m) => warnings.push(m) })).toBe(
                join(root, 'build', 'Release', 'a.node'),
            );
            expect(warnings.length).toBe(1);
            expect(warnings[0]).toContain('.node files in');
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('napi-node-addon: nearestPackageRoot', async () => {
        await it('walks up from a nested importer to the package root', () => {
            const root = makeFixture((r) => touch(join(r, 'lib', 'deep'), 'binding.js'));
            expect(nearestPackageRoot(join(root, 'lib', 'deep', 'binding.js'))).toBe(root);
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('napi-node-addon: shim shapes (bare @gjsify/napi + loadAddon)', async () => {
        const ABS = '/abs/build/Release/addon.node';
        const bareImport = JSON.stringify('@gjsify/napi'); // "@gjsify/napi"
        const addonArg = `loadAddon(${JSON.stringify(ABS)})`;
        await it('directNodeShim: ESM default from bare @gjsify/napi', () => {
            const code = directNodeShim(ABS);
            expect(code).toContain(`import { loadAddon } from ${bareImport}`);
            expect(code).toContain(`export default ${addonArg}`);
            expect(code).not.toContain('lib/esm/index.js'); // never an absolute lib path
        });
        await it('nodeGypBuildShim: CJS callable load() with .path(), bare require', () => {
            const code = nodeGypBuildShim(ABS);
            expect(code).toContain(`require(${bareImport})`);
            expect(code).toContain('module.exports = load');
            expect(code).toContain('load.path');
            expect(code).toContain(addonArg);
        });
        await it('bindingsShim: CJS callable bindings(), bare require', () => {
            const code = bindingsShim(ABS);
            expect(code).toContain(`require(${bareImport})`);
            expect(code).toContain('module.exports = bindings');
        });
        await it('napiRsShim: raw native exports as module.exports', () => {
            const code = napiRsShim(ABS);
            expect(code).toContain(`require(${bareImport})`);
            expect(code).toContain(`module.exports = ${addonArg}`);
        });
    });

    await describe('napi-node-addon: plugin resolveId + load', async () => {
        await it('claims bindings, encodes the resolved .node, and load() emits the shim', async () => {
            const root = makeFixture((r) => touch(join(r, 'build', 'Release'), 'node_sqlite3.node'));
            const importer = join(root, 'lib', 'sqlite3-binding.js');
            mkdirSync(join(root, 'lib'), { recursive: true });
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin);
            const res = await handler.call(mockCtx(), 'bindings', importer);
            const addonAbs = join(root, 'build', 'Release', 'node_sqlite3.node');
            expect(res).toStrictEqual({ id: `\0gjsify-napi-addon:bindings:${addonAbs}` });

            const load = (plugin as { load?: (id: string) => { code: string; moduleSideEffects: boolean } | null })
                .load;
            const out = load?.(res!.id);
            expect(out?.moduleSideEffects).toBe(false);
            expect(out?.code).toContain('module.exports = bindings');
            expect(out?.code).toContain(`loadAddon(${JSON.stringify(addonAbs)})`);
            rmSync(root, { recursive: true, force: true });
        });

        await it('claims a direct .node that exists (importer-relative) and emits the direct shim', async () => {
            const root = makeFixture((r) => touch(join(r, 'build', 'Release'), 'x.node'));
            const abs = join(root, 'build', 'Release', 'x.node');
            const importer = join(root, 'index.js');
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin);
            const res = await handler.call(mockCtx(), './build/Release/x.node', importer);
            expect(res).toStrictEqual({ id: `\0gjsify-napi-addon:direct:${abs}` });
            const load = (plugin as { load?: (id: string) => { code: string } | null }).load;
            expect(load?.(res!.id)?.code).toContain('export default loadAddon');
            rmSync(root, { recursive: true, force: true });
        });

        await it('falls through (null) for a direct .node that does not exist (napi-rs dead local branch)', async () => {
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin);
            // The napi-rs generated loader references a local `./pkg.<triple>.node`
            // that is absent when the binary ships in the sibling package — that
            // dead branch must fall through, NOT be rewritten to a missing-file shim.
            const res = await handler.call(mockCtx(), './argon2.linux-x64-gnu.node', '/nm/@node-rs/argon2/index.js');
            expect(res).toBe(null);
        });

        await it('claims a napi-rs sibling only when it resolves to a .node', async () => {
            const abs = '/nm/@node-rs/argon2-linux-x64-gnu/argon2.linux-x64-gnu.node';
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin);
            // Resolves to a .node → claimed as napi-rs.
            const hit = await handler.call(
                mockCtx({ '@node-rs/argon2-linux-x64-gnu': abs }),
                '@node-rs/argon2-linux-x64-gnu',
                '/nm/@node-rs/argon2/index.js',
            );
            expect(hit).toStrictEqual({ id: `\0gjsify-napi-addon:napi-rs:${abs}` });
            // Resolves to a NON-.node (a normal package that merely matches the tail) → null.
            const miss = await handler.call(
                mockCtx({ 'weird-linux-x64': '/nm/weird-linux-x64/index.js' }),
                'weird-linux-x64',
                '/nm/consumer/index.js',
            );
            expect(miss).toBe(null);
        });

        await it('returns null for ordinary specifiers', async () => {
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin);
            expect(await handler.call(mockCtx(), 'react', '/app/src/index.js')).toBe(null);
            expect(await handler.call(mockCtx(), 'better-sqlite3', '/app/src/index.js')).toBe(null);
        });

        await it('warns when @gjsify/napi is unresolvable in the consumer graph', async () => {
            const root = makeFixture((r) => touch(join(r, 'build', 'Release'), 'x.node'));
            const importer = join(root, 'index.js');
            const plugin = napiNodeAddonPlugin(); // warnOnMissingNapi defaults true
            const handler = handlerOf(plugin);
            const ctx = mockCtx(); // resolve('@gjsify/napi') → null
            await handler.call(ctx, 'node-gyp-build', importer);
            expect(ctx.warnings.some((w) => w.includes('gjsify install @gjsify/napi'))).toBe(true);
            rmSync(root, { recursive: true, force: true });
        });
    });

    await describe('napi-node-addon: isNapiRsPackageJson (package.json signal)', async () => {
        await it('claims a package with a top-level napi config object', () => {
            expect(isNapiRsPackageJson({ name: 'x', napi: { binaryName: 'x' } })).toBe(true);
            // Any non-null napi OBJECT qualifies (the napi-rs CLI build block).
            expect(isNapiRsPackageJson({ name: 'x', napi: { targets: ['x86_64-unknown-linux-gnu'] } })).toBe(true);
        });
        await it('claims a package declaring a `<self>-<triple>` platform sibling in optionalDependencies', () => {
            expect(
                isNapiRsPackageJson({
                    name: '@node-rs/argon2',
                    optionalDependencies: { '@node-rs/argon2-linux-x64-gnu': '2.0.2' },
                }),
            ).toBe(true);
            expect(
                isNapiRsPackageJson({
                    name: 'lightningcss',
                    optionalDependencies: { 'lightningcss-darwin-arm64': '1.0.0' },
                }),
            ).toBe(true);
        });
        await it('does NOT false-positive on an ordinary package', () => {
            expect(isNapiRsPackageJson({ name: 'lodash' })).toBe(false);
            // optionalDependencies that are NOT `<self>-<triple>` siblings.
            expect(isNapiRsPackageJson({ name: 'chokidar', optionalDependencies: { fsevents: '^2' } })).toBe(false);
            // A napi field that is a STRING (not the napi-rs build object) is not a signal.
            expect(isNapiRsPackageJson({ name: 'weird', napi: 'v8' } as never)).toBe(false);
            // A sibling-looking dep that does NOT start with the package's own name.
            expect(
                isNapiRsPackageJson({ name: 'alpha', optionalDependencies: { 'beta-linux-x64-gnu': '1' } }),
            ).toBe(false);
        });
    });

    await describe('napi-node-addon: detectNapiRsEntry (native-main confirmation)', async () => {
        /** A napi-rs generated-loader fixture: package.json signal + index.js + browser.js. */
        function makeNapiRsFixture(pkg: Record<string, unknown>): string {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-napi-rs-'));
            writeFileSync(join(root, 'package.json'), JSON.stringify({ main: 'index.js', ...pkg }));
            writeFileSync(join(root, 'index.js'), '/* auto-generated by NAPI-RS */');
            writeFileSync(join(root, 'browser.js'), '// wasm fallback');
            return root;
        }

        await it('detects the native main entry of a napi-rs package (napi field)', () => {
            const root = makeNapiRsFixture({ name: '@node-rs/argon2', napi: { binaryName: 'argon2' } });
            const hit = detectNapiRsEntry(join(root, 'index.js'));
            expect(hit?.pkgRoot).toBe(root);
            expect(hit?.pkg.name).toBe('@node-rs/argon2');
            rmSync(root, { recursive: true, force: true });
        });
        await it('detects via the optionalDependencies sibling signal', () => {
            const root = makeNapiRsFixture({
                name: '@node-rs/argon2',
                optionalDependencies: { '@node-rs/argon2-linux-x64-gnu': '2.0.2' },
            });
            expect(detectNapiRsEntry(join(root, 'index.js'))?.pkgRoot).toBe(root);
            rmSync(root, { recursive: true, force: true });
        });
        await it('rejects the browser/wasm fallback (not the native main)', () => {
            const root = makeNapiRsFixture({ name: '@node-rs/argon2', napi: { binaryName: 'argon2' } });
            expect(detectNapiRsEntry(join(root, 'browser.js'))).toBe(null);
            rmSync(root, { recursive: true, force: true });
        });
        await it('rejects an ordinary (non-napi-rs) package entry', () => {
            const root = makeNapiRsFixture({ name: 'lodash' });
            expect(detectNapiRsEntry(join(root, 'index.js'))).toBe(null);
            rmSync(root, { recursive: true, force: true });
        });
        await it('rejects a relative / non-absolute entry path', () => {
            expect(detectNapiRsEntry('./index.js')).toBe(null);
        });
    });

    await describe('napi-node-addon: napi-rs ENTRY replacement (resolveId + load)', async () => {
        /** A napi-rs package fixture at `root`, plus a sibling `.node` at `siblingNode`. */
        function makeEntryFixture(): { root: string; entry: string; sibling: string; siblingNode: string } {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-napi-rs-entry-'));
            const sibling = '@node-rs/argon2-linux-x64-gnu';
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    name: '@node-rs/argon2',
                    main: 'index.js',
                    napi: { binaryName: 'argon2' },
                    optionalDependencies: {
                        [sibling]: '2.0.2',
                        '@node-rs/argon2-darwin-arm64': '2.0.2',
                    },
                }),
            );
            writeFileSync(join(root, 'index.js'), '/* auto-generated by NAPI-RS */\nrequire = 1;');
            // The current-platform sibling's compiled binary (its package `main`).
            const siblingNode = touch(join(root, 'node_modules', sibling), 'argon2.linux-x64-gnu.node');
            return { root, entry: join(root, 'index.js'), sibling, siblingNode };
        }

        await it('replaces the generated loader with module.exports = loadAddon(<sibling .node>)', async () => {
            const { root, entry, sibling, siblingNode } = makeEntryFixture();
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin);
            // Only the CURRENT-platform sibling resolves (npm installs one).
            const ctx = mockCtx({ [sibling]: siblingNode });
            const res = await handler.call(ctx, entry, undefined);
            expect(res).toStrictEqual({ id: `\0gjsify-napi-addon:napi-rs-entry:${siblingNode}` });

            const load = (plugin as { load?: (id: string) => { code: string; moduleSideEffects: boolean } | null })
                .load;
            const out = load?.(res!.id);
            expect(out?.moduleSideEffects).toBe(false);
            expect(out?.code).toContain(`module.exports = loadAddon(${JSON.stringify(siblingNode)})`);
            expect(out?.code).toContain('require("@gjsify/napi")');
            rmSync(root, { recursive: true, force: true });
        });

        await it('falls through (null) when NO current-platform .node resolves — never a shim over nothing', async () => {
            const { root, entry } = makeEntryFixture();
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin);
            // Empty resolve map: neither sibling resolves, no local binary → conservative null.
            const res = await handler.call(mockCtx(), entry, undefined);
            expect(res).toBe(null);
            rmSync(root, { recursive: true, force: true });
        });

        await it('does NOT touch an ordinary package index.js', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-plain-'));
            writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'lodash', main: 'index.js' }));
            writeFileSync(join(root, 'index.js'), 'module.exports = {};');
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin);
            expect(await handler.call(mockCtx(), join(root, 'index.js'), undefined)).toBe(null);
            rmSync(root, { recursive: true, force: true });
        });
    });
};
