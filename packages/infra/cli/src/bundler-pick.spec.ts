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

import { describe, expect, it } from '@gjsify/unit';
import { toNativePlugin, isPluginObject, type NativePlugin } from './bundler-pick.js';
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
            const native = toNativePlugin({ name: 'p', load: 'not a function', transform: undefined, resolveId: 42 } as Record<string, unknown>);
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
                load: stub, transform: stub, resolveId: stub, renderChunk: stub,
                banner: stub, footer: stub, intro: stub, outro: stub,
                buildStart: stub, buildEnd: stub,
                generateBundle: stub, writeBundle: stub, closeBundle: stub,
            });
            for (const h of ['load', 'transform', 'resolveId', 'renderChunk',
                             'banner', 'footer', 'intro', 'outro',
                             'buildStart', 'buildEnd',
                             'generateBundle', 'writeBundle', 'closeBundle'] as const) {
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
};
