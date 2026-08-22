// Phase D-2.B.5b — toNativePlugin adapter regression coverage.
//
// The native bundler itself only loads under GJS (it needs the
// GjsifyRolldown typelib via `imports.gi`), so a real
// `GJSIFY_BUNDLER=native` build of a Node-CLI invocation is
// unreachable by design. The thing we CAN cover from Node is the
// shape adapter — given a rolldown-shaped plugin, does it produce
// the right NativePlugin envelope (function references intact, bare
// vs. `{filter, handler}` form normalized, idFilter regex strings
// matching the original RegExp source)?
//
// These tests prevent the adapter from silently dropping hooks /
// mis-translating filters when real-world plugin shapes change.

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from '@gjsify/unit';
import { isResolveMiss } from '@gjsify/rolldown-native';
import {
    toNativePlugin,
    isPluginObject,
    shouldUseNative,
    stripUnserializable,
    translateSourcemapOption,
    mapToInjectArray,
    findRolldownNativeDir,
    type NativePlugin,
} from './bundler-pick.js';
import {
    cssAsStringPlugin,
    shebangPlugin,
    gjsImportsEmptyPlugin,
    processStubPlugin,
    textLoaderPlugin,
} from '@gjsify/rolldown-plugin-gjsify';

export default async () => {
    await describe('isPluginObject', async () => {
        await it('accepts plain plugin objects', () => {
            expect(isPluginObject({ name: 'p', load: () => null })).toBe(true);
        });
        await it('rejects null / undefined / primitives / arrays', () => {
            expect(isPluginObject(null)).toBe(false);
            expect(isPluginObject(undefined)).toBe(false);
            expect(isPluginObject('p')).toBe(false);
            expect(isPluginObject(42)).toBe(false);
            expect(isPluginObject([{ name: 'p' }])).toBe(false);
        });
    });

    await describe('toNativePlugin — bare-function hook form', async () => {
        await it('preserves function reference identity for each hook', () => {
            const load = () => 'loaded';
            const transform = (code: string) => code;
            const resolveId = (s: string) => s;
            const renderChunk = (c: string) => c;
            const buildStart = () => {};
            const native = toNativePlugin({ name: 'b', load, transform, resolveId, renderChunk, buildStart });
            expect(native.load === (load as unknown as NativePlugin['load'])).toBe(true);
            expect(native.transform === (transform as unknown as NativePlugin['transform'])).toBe(true);
            expect(native.resolveId === (resolveId as unknown as NativePlugin['resolveId'])).toBe(true);
            expect(native.renderChunk === (renderChunk as unknown as NativePlugin['renderChunk'])).toBe(true);
            expect(native.buildStart === (buildStart as unknown as NativePlugin['buildStart'])).toBe(true);
        });

        await it('falls back to "unnamed-plugin" when name is missing', () => {
            const native = toNativePlugin({ load: () => null });
            expect(native.name).toBe('unnamed-plugin');
        });

        await it('omits hooks that are not functions', () => {
            const native = toNativePlugin({
                name: 'p',
                load: 'not a function',
                transform: undefined,
                resolveId: 42,
            } as Record<string, unknown>);
            expect(native.load).toBe(undefined);
            expect(native.transform).toBe(undefined);
            expect(native.resolveId).toBe(undefined);
        });
    });

    await describe('toNativePlugin — {filter, handler} hook form', async () => {
        await it('extracts handler + converts RegExp filter.id to source string', () => {
            const handler = () => 'css';
            const native = toNativePlugin({
                name: 'css',
                load: { filter: { id: /\.css$/ }, handler },
            } as Record<string, unknown>);
            expect(native.load === (handler as unknown as NativePlugin['load'])).toBe(true);
            expect(native.idFilter?.load).toBe('\\.css$');
        });

        await it('escapes string filter.id so regex metas are literal', () => {
            const native = toNativePlugin({
                name: 'p',
                transform: { filter: { id: '.config.js' }, handler: () => null },
            } as Record<string, unknown>);
            // Dots in input become escaped in the regex string so the
            // server-side matcher treats them literally.
            expect(native.idFilter?.transform).toBe('\\.config\\.js');
        });

        await it('combines an array of filter.id sources into an alternation', () => {
            const native = toNativePlugin({
                name: 'p',
                load: { filter: { id: [/\.svg$/, /\.png$/] }, handler: () => null },
            } as Record<string, unknown>);
            expect(native.idFilter?.load).toBe('(?:\\.svg$|\\.png$)');
        });

        await it('passes the bare regex through when array has one element', () => {
            const native = toNativePlugin({
                name: 'p',
                load: { filter: { id: [/\.txt$/] }, handler: () => null },
            } as Record<string, unknown>);
            expect(native.idFilter?.load).toBe('\\.txt$');
        });

        await it('emits no idFilter entry for a hook without filter', () => {
            const native = toNativePlugin({
                name: 'p',
                load: { handler: () => null },
            } as Record<string, unknown>);
            expect(native.idFilter).toBe(undefined);
        });

        await it('only puts idFilter on hooks where it was declared', () => {
            const native = toNativePlugin({
                name: 'p',
                load: { filter: { id: /\.txt$/ }, handler: () => null },
                transform: () => null,
            } as Record<string, unknown>);
            expect(native.idFilter?.load).toBe('\\.txt$');
            expect(native.idFilter?.transform).toBe(undefined);
            expect(native.idFilter?.resolveId).toBe(undefined);
        });
    });

    await describe('toNativePlugin — real-world gjsify plugin set', async () => {
        // These walks bind the adapter to the actual plugin shapes the
        // CLI passes to rolldown today. A drift in any plugin's hook
        // declaration (function vs {filter,handler}, regex change, hook
        // added/removed) surfaces here as a single failed expectation
        // rather than as a silent runtime mis-dispatch under GJS.

        await it('cssAsStringPlugin — load hook with .css idFilter', () => {
            const native = toNativePlugin(cssAsStringPlugin() as unknown as Record<string, unknown>);
            expect(native.name).toBe('gjsify-css-as-string');
            expect(typeof native.load).toBe('function');
            expect(native.idFilter?.load !== undefined).toBe(true);
            expect(native.idFilter!.load!.includes('css')).toBe(true);
        });

        await it('shebangPlugin — renderChunk {filter, handler} form', () => {
            const p = shebangPlugin({ enabled: true });
            if (p === null) throw new Error('shebangPlugin({enabled:true}) returned null');
            const native = toNativePlugin(p as unknown as Record<string, unknown>);
            expect(native.name).toBe('gjsify-shebang');
            // renderChunk uses the {handler, order:'post'} object form
            // — adapter must extract `handler` even when no `filter` is set.
            expect(typeof native.renderChunk).toBe('function');
            expect(native.idFilter?.renderChunk).toBe(undefined);
        });

        await it('gjsImportsEmptyPlugin — resolveId + load hooks', () => {
            const p = gjsImportsEmptyPlugin();
            const native = toNativePlugin(p as unknown as Record<string, unknown>);
            expect(typeof native.resolveId).toBe('function');
            expect(typeof native.load).toBe('function');
        });

        await it('processStubPlugin — renderChunk hook', () => {
            const p = processStubPlugin();
            const native = toNativePlugin(p as unknown as Record<string, unknown>);
            expect(typeof native.renderChunk).toBe('function');
        });

        await it('textLoaderPlugin with text loaders — load hook (function form)', () => {
            const p = textLoaderPlugin({ loaders: { '.ui': 'text', '.asm': 'text' } });
            if (p === null) throw new Error('textLoaderPlugin({loaders:{...}}) returned null');
            const native = toNativePlugin(p as unknown as Record<string, unknown>);
            // text-loader uses bare `load(id)` — function form with internal
            // regex check, not {filter, handler}. So no idFilter on the
            // adapter side either.
            expect(typeof native.load).toBe('function');
        });
    });

    await describe('toNativePlugin — full hook coverage', async () => {
        await it('covers all 13 advertised hook names', () => {
            const stub = () => null;
            const native = toNativePlugin({
                name: 'all',
                load: stub,
                transform: stub,
                resolveId: stub,
                renderChunk: stub,
                banner: stub,
                footer: stub,
                intro: stub,
                outro: stub,
                buildStart: stub,
                buildEnd: stub,
                generateBundle: stub,
                writeBundle: stub,
                closeBundle: stub,
            });
            for (const h of [
                'load',
                'transform',
                'resolveId',
                'renderChunk',
                'banner',
                'footer',
                'intro',
                'outro',
                'buildStart',
                'buildEnd',
                'generateBundle',
                'writeBundle',
                'closeBundle',
            ] as const) {
                expect(typeof native[h]).toBe('function');
            }
        });

        await it('drops unknown extra fields silently (rolldown-only options not in our facade)', () => {
            const native = toNativePlugin({
                name: 'p',
                load: () => null,
                api: { customField: 'value' },
                resolveDynamicImport: () => null,
            } as Record<string, unknown>);
            expect((native as unknown as Record<string, unknown>).api).toBe(undefined);
            expect((native as unknown as Record<string, unknown>).resolveDynamicImport).toBe(undefined);
        });
    });

    await describe('shouldUseNative — Phase D-3.1 runtime default', async () => {
        // The Node-side test sees:
        //   - process.env.GJSIFY_BUNDLER respected (env-var overrides)
        //   - globalThis.imports?.gi UNDEFINED (we're under Node) → default returns false
        // We mutate process.env around each assertion; restore on exit so the
        // suite stays hermetic with the rest of the file.

        await it('GJSIFY_BUNDLER=npm forces npm path even when native is loadable', async () => {
            const prev = process.env.GJSIFY_BUNDLER;
            process.env.GJSIFY_BUNDLER = 'npm';
            try {
                const result = await shouldUseNative();
                expect(result).toBe(false);
            } finally {
                if (prev === undefined) delete process.env.GJSIFY_BUNDLER;
                else process.env.GJSIFY_BUNDLER = prev;
            }
        });

        await it('GJSIFY_BUNDLER=native throws under Node when prebuild not loadable', async () => {
            const prev = process.env.GJSIFY_BUNDLER;
            process.env.GJSIFY_BUNDLER = 'native';
            try {
                let thrown: Error | null = null;
                try {
                    await shouldUseNative();
                } catch (e) {
                    thrown = e as Error;
                }
                expect(thrown !== null).toBe(true);
                expect((thrown as Error).message.includes('not loadable')).toBe(true);
            } finally {
                if (prev === undefined) delete process.env.GJSIFY_BUNDLER;
                else process.env.GJSIFY_BUNDLER = prev;
            }
        });

        await it('default under Node = false (no imports.gi, npm rolldown wins)', async () => {
            const prev = process.env.GJSIFY_BUNDLER;
            delete process.env.GJSIFY_BUNDLER;
            try {
                // Under Node test runner, globalThis.imports?.gi is undefined,
                // so the new D-3.1 runtime-detect logic correctly returns false
                // and the npm rolldown path is taken in runBundle.
                const result = await shouldUseNative();
                expect(result).toBe(false);
            } finally {
                if (prev !== undefined) process.env.GJSIFY_BUNDLER = prev;
            }
        });
    });

    await describe('stripUnserializable — native options JSON boundary', async () => {
        // Function values do not survive JSON.stringify to the Rust core —
        // the recurring footgun behind the dropped-`external` bug class.
        // The sanitize layer must (a) never ship a function, (b) WARN when
        // it drops one (silent drops are how three instances shipped),
        // (c) translate `sourcemap` spellings instead of dropping them.

        await it('drops function values and emits a console.warn naming the key', () => {
            const warnings: string[] = [];
            const origWarn = console.warn;
            console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
            try {
                const out = stripUnserializable({
                    input: [{ import: 'src/index.ts' }],
                    external: (id: string) => id === 'x',
                } as unknown as Record<string, unknown>);
                expect('external' in out).toBe(false);
                expect(out['input'] !== undefined).toBe(true);
                expect(warnings.length).toBeGreaterThan(0);
                expect(warnings[0].includes('"external"')).toBe(true);
                expect(warnings[0].includes('externalsPlugin')).toBe(true);
            } finally {
                console.warn = origWarn;
            }
        });

        await it('warns at most once per key (multi-pass --globals auto builds)', () => {
            const warnings: string[] = [];
            const origWarn = console.warn;
            console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
            try {
                // 'external' already warned in the previous test (module-level
                // warn-once registry) — a second drop must stay silent.
                stripUnserializable({ external: () => true } as unknown as Record<string, unknown>);
                stripUnserializable({ external: () => true } as unknown as Record<string, unknown>);
                expect(warnings.length).toBe(0);
            } finally {
                console.warn = origWarn;
            }
        });

        await it('keeps string-array external entries untouched', () => {
            const out = stripUnserializable({ external: ['cairo', 'system'] } as unknown as Record<string, unknown>);
            expect(out['external']).toStrictEqual(['cairo', 'system']);
        });

        await it('rejects RegExp external entries with a NAMED error (not an opaque serde crash)', () => {
            // A RegExp JSON-serializes to `{}` → Rust `Vec<String>` serde
            // column error. Fail loudly with an actionable message instead.
            expect(() =>
                stripUnserializable({ external: ['ok', /^@scope\//] } as unknown as Record<string, unknown>),
            ).toThrow();
            try {
                stripUnserializable({ external: [/^@scope\//] } as unknown as Record<string, unknown>);
            } catch (e) {
                expect((e as Error).message.includes('exact string names')).toBe(true);
            }
        });

        await it('translates sourcemap spellings to the Rust enum casing', () => {
            const t = (v: unknown) =>
                stripUnserializable({ sourcemap: v } as unknown as Record<string, unknown>)['sourcemap'];
            expect(t(true)).toBe('File');
            expect(t('inline')).toBe('Inline');
            expect(t('hidden')).toBe('Hidden');
            // `false` → key omitted entirely (same effect on the Rust side).
            expect('sourcemap' in stripUnserializable({ sourcemap: false } as unknown as Record<string, unknown>)).toBe(
                false,
            );
        });
    });

    await describe('translateSourcemapOption — all JS-API spellings', async () => {
        await it('maps boolean and string forms onto SourceMapType variants', () => {
            expect(translateSourcemapOption(true)).toBe('File');
            expect(translateSourcemapOption('file')).toBe('File');
            expect(translateSourcemapOption('inline')).toBe('Inline');
            expect(translateSourcemapOption('hidden')).toBe('Hidden');
            // Already-translated values pass through idempotently.
            expect(translateSourcemapOption('File')).toBe('File');
            expect(translateSourcemapOption('Inline')).toBe('Inline');
            expect(translateSourcemapOption('Hidden')).toBe('Hidden');
        });

        await it('returns undefined for false / unknown shapes (omit the key)', () => {
            expect(translateSourcemapOption(false)).toBe(undefined);
            expect(translateSourcemapOption(undefined)).toBe(undefined);
            expect(translateSourcemapOption('bogus')).toBe(undefined);
        });
    });

    await describe('findRolldownNativeDir — parent-dir filesystem walk', async () => {
        // This covers the sub-package cwd scenario: `@gjsify/rolldown-native`
        // is hoisted to the workspace root's node_modules but the cwd is a
        // deeply nested package dir whose own node_modules doesn't carry it.
        // The helper must walk up and find it, bypassing createRequire and
        // findWorkspaceRoot (both of which can fail under GJS polyfills from
        // a sub-package dir).

        let tmpDir: string | null = null;

        const setup = () => {
            tmpDir = mkdtempSync(join(tmpdir(), 'gjsify-native-dir-spec-'));
            // Workspace root with the hoisted package
            const pkgJson = join(tmpDir, 'node_modules', '@gjsify', 'rolldown-native', 'package.json');
            mkdirSync(join(tmpDir, 'node_modules', '@gjsify', 'rolldown-native'), {
                recursive: true,
            });
            writeFileSync(pkgJson, JSON.stringify({ name: '@gjsify/rolldown-native' }));
            // Sub-package directory (no node_modules of its own)
            const subPkg = join(tmpDir, 'packages', 'web', 'compression-streams');
            mkdirSync(subPkg, { recursive: true });
            return { wsRoot: tmpDir, subPkg };
        };

        const teardown = () => {
            if (tmpDir) {
                rmSync(tmpDir, { recursive: true, force: true });
                tmpDir = null;
            }
        };

        await it('finds the package when cwd is a deep sub-package dir', () => {
            const { wsRoot, subPkg } = setup();
            try {
                const found = findRolldownNativeDir(subPkg);
                expect(found !== null).toBe(true);
                // Path must end at rolldown-native inside wsRoot/node_modules
                expect(found!.includes('rolldown-native')).toBe(true);
                expect(found!.startsWith(wsRoot)).toBe(true);
            } finally {
                teardown();
            }
        });

        await it('returns null when the package is nowhere in the ancestor chain', () => {
            const tmp = mkdtempSync(join(tmpdir(), 'gjsify-native-dir-miss-'));
            try {
                const isolated = join(tmp, 'deep', 'pkg');
                mkdirSync(isolated, { recursive: true });
                const found = findRolldownNativeDir(isolated);
                expect(found).toBe(null);
            } finally {
                rmSync(tmp, { recursive: true, force: true });
            }
        });

        await it('finds the package via the bundleDir anchor when cwd misses', () => {
            const { wsRoot, subPkg } = setup();
            // cwd has no node_modules; bundleDir (bundle's dist/) is at wsRoot/dist
            const bundleDir = join(wsRoot, 'dist');
            mkdirSync(bundleDir, { recursive: true });
            try {
                const found = findRolldownNativeDir(subPkg, bundleDir);
                expect(found !== null).toBe(true);
                expect(found!.includes('rolldown-native')).toBe(true);
            } finally {
                teardown();
            }
        });
    });

    await describe('mapToInjectArray — Rust InjectImport descriptor shapes', async () => {
        // The Rust enum has ONLY `named` and `namespace` variants
        // (tag = "type", camelCase). Default imports are encoded as
        // `{type:'named', imported:'default'}` — `{type:'default'}` crashes
        // the deserializer with `unknown variant`.

        await it("string value → default import encoded as named 'default'", () => {
            expect(mapToInjectArray({ Buffer: '@gjsify/buffer' })).toStrictEqual([
                { type: 'named', imported: 'default', from: '@gjsify/buffer', alias: 'Buffer' },
            ]);
        });

        await it('tuple [from, name] → named import', () => {
            expect(mapToInjectArray({ console: ['./shims/console-gjs.js', 'console'] })).toStrictEqual([
                { type: 'named', from: './shims/console-gjs.js', imported: 'console', alias: 'console' },
            ]);
        });

        await it("tuple [from, '*'] → namespace import", () => {
            expect(mapToInjectArray({ fs: ['node:fs', '*'] })).toStrictEqual([
                { type: 'namespace', from: 'node:fs', alias: 'fs' },
            ]);
        });

        await it('mixes all three forms in one map', () => {
            const out = mapToInjectArray({
                $: 'jquery',
                Promise: ['es6-promise', 'Promise'],
                ns: ['some-mod', '*'],
            });
            expect(out).toStrictEqual([
                { type: 'named', imported: 'default', from: 'jquery', alias: '$' },
                { type: 'named', from: 'es6-promise', imported: 'Promise', alias: 'Promise' },
                { type: 'namespace', from: 'some-mod', alias: 'ns' },
            ]);
        });
    });
    // The bridge's `ctx.resolve` is DECLARED to answer `null` for a specifier that
    // doesn't resolve, because that is what npm `rolldown` does and what every
    // caller in `@gjsify/rolldown-plugin-gjsify` assumes — nine `this.resolve` /
    // `ctx.resolve` call sites, none with a catch, one of them a bare presence probe
    // (`Boolean(await ctx.resolve(…))`). The Rust side stringifies EVERY
    // `ResolveError` into one `error` field, so a plain miss used to arrive as a
    // rejection and those call sites threw instead of taking their not-found branch.
    // Measured on gjs 1.88.1 with the real prebuild: an unresolvable bare specifier
    // rejected with `NotFound("@gjsify/definitely-not-there")`.
    await describe('isResolveMiss — only NotFound is "nothing there"', async () => {
        await it('treats NotFound as a miss', () => {
            expect(isResolveMiss('NotFound("@gjsify/fs")')).toBe(true);
        });

        // Everything else is a real failure. Folding these into `null` is how a
        // bridge bug or an EACCES gets reported as the user's missing dependency.
        await it('keeps every other shape a rejection', () => {
            for (const e of [
                'InvalidPackageConfig { path: "/p/package.json" }',
                'PackagePathNotExported { subpath: "./register" }',
                'IOError(Os { code: 13, kind: PermissionDenied })',
                'MatchedAliasNotFound { alias: "x" }',
                "@gjsify/rolldown-native: ctx.resolve('x') failed — parent req_id 7 unknown",
                'rolldown: malformed context_resolve args JSON: expected value',
                // anyhow's alternate Display — what the `Err(e)` arm of
                // `gjsify_rolldown_session_context_resolve` sends once it stopped
                // truncating the cause chain. A plugin failure surfaced through
                // THAT arm must stay a rejection: fold it into `null` and a broken
                // plugin is reported as the user's missing dependency.
                'plugin `gjsify-alias` threw an error: plugin `gjsify-unresolved-workspace-import` threw an error: NotFound("@gjsify/dom-exception/register")',
            ]) {
                expect(isResolveMiss(e)).toBe(false);
            }
        });
    });
};
