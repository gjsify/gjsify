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
    ADDON_FILTER_RE,
    isNapiRsPackageJson,
    isNapiRsSibling,
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

/**
 * Minimal Rolldown PluginContext mock. `resolve` maps a specifier → id.
 *
 * `@gjsify/napi` resolves by default because every rewrite is GATED on it —
 * installing it is how a project opts into napi routing, and without it the
 * plugin deliberately declines rather than emit a bundle that cannot load.
 * Pass `{'@gjsify/napi': null}` to exercise the not-installed path.
 */
function mockCtx(resolveMap: Record<string, string | null> = {}): {
    resolve: (s: string) => Promise<{ id: string } | null>;
    warn: (m: string) => void;
    warnings: string[];
} {
    const warnings: string[] = [];
    const map: Record<string, string | null> = {
        '@gjsify/napi': '/fake/node_modules/@gjsify/napi/lib/esm/index.js',
        ...resolveMap,
    };
    return {
        async resolve(s: string) {
            const hit = map[s];
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

        await it('declines (and warns) when @gjsify/napi is unresolvable in the consumer graph', async () => {
            // The gate, not a diagnostic. Every shim does `require('@gjsify/napi')`,
            // so rewriting without it emits a bundle that cannot load — the old
            // behaviour, whose own warning said "the bundle will fail at load".
            // Declining leaves the module to normal resolution instead.
            //
            // It also keeps the COMMITTED `cli.gjs.mjs` reproducible: the CLI's
            // own bundle reaches npm `lightningcss` (css-as-string's Node
            // fallback branch), so an ungated rewrite made the artifact depend
            // on whether `@gjsify/napi` happened to be installed — two module
            // graphs, different minified names, `verify-committed-bundles` red.
            const root = makeFixture((r) => touch(join(r, 'build', 'Release'), 'x.node'));
            const importer = join(root, 'index.js');
            const plugin = napiNodeAddonPlugin(); // warnOnMissingNapi defaults true
            const handler = handlerOf(plugin);
            const ctx = mockCtx({ '@gjsify/napi': null });
            expect(await handler.call(ctx, 'node-gyp-build', importer)).toBe(null);
            expect(ctx.warnings.some((w) => w.includes('gjsify install @gjsify/napi'))).toBe(true);
            rmSync(root, { recursive: true, force: true });
        });

        await it('declines the napi-rs ENTRY rewrite too when @gjsify/napi is absent', async () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-napi-gate-'));
            const sibling = 'lightningcss-linux-x64-gnu';
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    name: 'lightningcss',
                    main: 'node/index.js',
                    napi: { name: 'lightningcss' },
                    optionalDependencies: { [sibling]: '1.32.0' },
                }),
            );
            mkdirSync(join(root, 'node'), { recursive: true });
            const entry = join(root, 'node', 'index.js');
            writeFileSync(entry, '// generated by NAPI-RS');
            const siblingNode = touch(join(root, 'node_modules', sibling), 'lightningcss.linux-x64-gnu.node');
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin);
            expect(
                await handler.call(mockCtx({ [sibling]: siblingNode, '@gjsify/napi': null }), entry, undefined),
            ).toBe(null);
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
            expect(isNapiRsPackageJson({ name: 'alpha', optionalDependencies: { 'beta-linux-x64-gnu': '1' } })).toBe(
                false,
            );
        });
    });

    // The prefixes + siblings below are copied VERBATIM from the real manifests
    // (`node_modules/<pkg>/package.json#napi` + `#optionalDependencies`) of the
    // four napi-rs packages this build chain runs on. They are the reason the
    // helper exists: three of the four publish their binaries under a scope that
    // has nothing to do with their own package name.
    await describe('napi-node-addon: filter portability (Rust regex / native engine)', async () => {
        await it('uses no lookaround and no \\0 escape', () => {
            // `@gjsify/rolldown-native` hands this pattern to the Rust core as
            // an `idFilter` STRING. Rust's `regex` crate supports neither
            // lookaround nor `\0`, and it rejects the WHOLE pattern rather than
            // the offending branch — so one JS-only construct here silently
            // disables EVERY interception under the GJS engine while npm
            // `rolldown` on Node keeps working. Nothing else catches that: the
            // addon gates all drive the Node CLI entry, so they never exercise
            // the native engine. Assert the constraint on the pattern itself.
            const src = ADDON_FILTER_RE.source;
            expect(src.includes('(?=')).toBe(false);
            expect(src.includes('(?!')).toBe(false);
            expect(src.includes('(?<')).toBe(false);
            // `\0` (NUL escape) — but NOT a back-reference-looking `\01`.
            expect(/\\0(?![0-9])/.test(src)).toBe(false);
        });
        await it('still matches the specifier shapes the handler claims', () => {
            for (const id of [
                'lightningcss', // bare specifier (the entry-replacement path)
                'rolldown',
                '@rolldown/binding-linux-x64-gnu', // napi-rs platform sibling
                'node-gyp-build',
                'bindings',
                '/abs/pkg/build/Release/x.node', // direct .node
                '/abs/pkg/dist/index.mjs', // generated-loader entry by path
            ]) {
                expect(ADDON_FILTER_RE.test(id)).toBe(true);
            }
            // Protocol-bearing and virtual ids must NOT reach the handler.
            for (const id of ['node:fs', 'gi://Gtk?version=4.0', 'data:text/js,1', './rel.js', '../up.js']) {
                expect(ADDON_FILTER_RE.test(id)).toBe(false);
            }
        });
    });

    await describe('napi-node-addon: isNapiRsSibling (both naming schemes)', async () => {
        await it('claims a `<self>-<triple>` sibling', () => {
            // lightningcss: napi.name only, no packageName — siblings are self-named.
            const lightningcss = { name: 'lightningcss', napi: { name: 'lightningcss' } };
            expect(isNapiRsSibling(lightningcss, 'lightningcss-linux-x64-gnu')).toBe(true);
            expect(isNapiRsSibling(lightningcss, 'lightningcss-darwin-arm64')).toBe(true);
            const argon2 = { name: '@node-rs/argon2', napi: { binaryName: 'argon2' } };
            expect(isNapiRsSibling(argon2, '@node-rs/argon2-linux-x64-gnu')).toBe(true);
        });
        await it('claims a `<napi.packageName>-<triple>` sibling under a FOREIGN scope', () => {
            // The regression: none of these siblings starts with the package's own
            // name, so the `<self>-` test alone found nothing and the entry was
            // left unrewritten.
            const rolldown = {
                name: 'rolldown',
                napi: { binaryName: 'rolldown-binding', packageName: '@rolldown/binding' },
            };
            expect(isNapiRsSibling(rolldown, '@rolldown/binding-linux-x64-gnu')).toBe(true);
            expect(isNapiRsSibling(rolldown, '@rolldown/binding-win32-x64-msvc')).toBe(true);
            const oxfmt = { name: 'oxfmt', napi: { binaryName: 'oxfmt', packageName: '@oxfmt/binding' } };
            expect(isNapiRsSibling(oxfmt, '@oxfmt/binding-linux-x64-gnu')).toBe(true);
            const oxlint = { name: 'oxlint', napi: { binaryName: 'oxlint', packageName: '@oxlint/binding' } };
            expect(isNapiRsSibling(oxlint, '@oxlint/binding-darwin-arm64')).toBe(true);
        });
        await it('requires BOTH a known prefix AND a platform triple', () => {
            const rolldown = { name: 'rolldown', napi: { packageName: '@rolldown/binding' } };
            // Right prefix, no triple.
            expect(isNapiRsSibling(rolldown, '@rolldown/pluginutils')).toBe(false);
            // Right triple, foreign prefix.
            expect(isNapiRsSibling(rolldown, '@swc/core-linux-x64-gnu')).toBe(false);
            // Neither.
            expect(isNapiRsSibling(rolldown, 'picomatch')).toBe(false);
        });
        await it('ignores a non-string napi.packageName instead of claiming everything', () => {
            const bogus = { name: 'weird', napi: { packageName: 42 } } as never;
            // Falls back to the `<self>-` prefix only — `weird-linux-x64-gnu` still
            // matches, an unrelated scope does not.
            expect(isNapiRsSibling(bogus, 'weird-linux-x64-gnu')).toBe(true);
            expect(isNapiRsSibling(bogus, '@other/binding-linux-x64-gnu')).toBe(false);
        });
        await it('feeds the package-level signal too (rolldown has no `<self>-` sibling at all)', () => {
            expect(
                isNapiRsPackageJson({
                    name: 'rolldown',
                    optionalDependencies: { '@rolldown/binding-linux-x64-gnu': '1.1.4' },
                    napi: { packageName: '@rolldown/binding' },
                }),
            ).toBe(true);
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
        await it('accepts the ESM twin of a CJS `main` (the lightningcss shape)', () => {
            // lightningcss declares ONLY `main: "node/index.js"` and ships
            // `node/index.mjs` beside it. `--app gjs` resolves the `.mjs`, so a
            // `main`-only comparison rejected the very file being bundled and
            // the rewrite silently never happened.
            const root = mkdtempSync(join(tmpdir(), 'gjsify-napi-rs-twin-'));
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({ name: 'lightningcss', main: 'node/index.js', napi: { name: 'lightningcss' } }),
            );
            mkdirSync(join(root, 'node'), { recursive: true });
            writeFileSync(join(root, 'node', 'index.js'), '// cjs');
            writeFileSync(join(root, 'node', 'index.mjs'), '// esm');
            expect(detectNapiRsEntry(join(root, 'node', 'index.mjs'))?.pkgRoot).toBe(root);
            expect(detectNapiRsEntry(join(root, 'node', 'index.js'))?.pkgRoot).toBe(root);
            rmSync(root, { recursive: true, force: true });
        });
        await it('accepts an `exports`-declared entry and still rejects a deep module', () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-napi-rs-exports-'));
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    name: 'oxfmt',
                    main: 'dist/index.js',
                    exports: { types: './dist/index.d.ts', default: './dist/index.js' },
                    napi: { binaryName: 'oxfmt', packageName: '@oxfmt/binding' },
                }),
            );
            mkdirSync(join(root, 'dist'), { recursive: true });
            writeFileSync(join(root, 'dist', 'index.js'), '// entry');
            writeFileSync(join(root, 'dist', 'internal.js'), '// deep module');
            expect(detectNapiRsEntry(join(root, 'dist', 'index.js'))?.pkgRoot).toBe(root);
            expect(detectNapiRsEntry(join(root, 'dist', 'internal.js'))).toBe(null);
            rmSync(root, { recursive: true, force: true });
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

        await it('replaces the loader when the sibling lives under napi.packageName scope', async () => {
            // The `rolldown` shape verbatim: package `rolldown`, binaries under
            // `@rolldown/binding-<triple>`. Before `isNapiRsSibling` learned
            // `napi.packageName`, `detectNapiRsEntry` recognised the entry (the
            // `napi` object is signal (a)) but no sibling resolved, so the rewrite
            // was skipped and the generated loader's CJS body — `require =
            // createRequire(...)` — shipped into the bundle and threw at load.
            const root = mkdtempSync(join(tmpdir(), 'gjsify-napi-rs-scope-'));
            const sibling = '@rolldown/binding-linux-x64-gnu';
            writeFileSync(
                join(root, 'package.json'),
                JSON.stringify({
                    name: 'rolldown',
                    main: './dist/index.mjs',
                    napi: { binaryName: 'rolldown-binding', packageName: '@rolldown/binding' },
                    optionalDependencies: { [sibling]: '1.1.4', '@rolldown/binding-darwin-arm64': '1.1.4' },
                }),
            );
            mkdirSync(join(root, 'dist'), { recursive: true });
            const entry = join(root, 'dist', 'index.mjs');
            writeFileSync(entry, '/* auto-generated by NAPI-RS */');
            const siblingNode = touch(join(root, 'node_modules', sibling), 'rolldown-binding.linux-x64-gnu.node');

            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const res = await handlerOf(plugin).call(mockCtx({ [sibling]: siblingNode }), entry, undefined);
            expect(res).toStrictEqual({ id: `\0gjsify-napi-addon:napi-rs-entry:${siblingNode}` });
            rmSync(root, { recursive: true, force: true });
        });

        await it('tolerates a null importer (the native engine passes null, not undefined)', async () => {
            // `@gjsify/rolldown-native` round-trips the hook payload through
            // JSON, so "no importer" arrives as `null`. Every guard here is
            // written `=== undefined`; `null` passed them all and reached
            // `dirname(null)`, which threw and took the whole `--app gjs` build
            // down as an UNHANDLEABLE_ERROR. npm rolldown never showed it.
            const plugin = napiNodeAddonPlugin({ warnOnMissingNapi: false });
            const handler = handlerOf(plugin) as unknown as (
                this: unknown,
                s: string,
                i: string | null,
            ) => Promise<{ id: string } | null>;
            expect(await handler.call(mockCtx(), 'lodash', null)).toBe(null);
            expect(await handler.call(mockCtx(), './rel/index.js', null)).toBe(null);
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
