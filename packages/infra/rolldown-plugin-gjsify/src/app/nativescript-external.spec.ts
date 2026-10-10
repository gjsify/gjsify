// SPDX-License-Identifier: MIT
// How `--app nativescript` keeps `@nativescript/core` out of the bundle.
//
// The shape is load-bearing twice over. It must stay EXTERNAL — an app works only with the
// one core instance the NS runtime boots, and a bundled copy is a second one — and it must
// be externalized by a HOOK rather than by a RegExp in `options.external`: the native
// rolldown engine, which is what the GJS-hosted `gjsify` CLI runs, accepts only exact
// string names there and fails the whole build on a RegExp. Measured on
// `gjsify build --app nativescript`: "`external` entries must be exact string names under
// the native rolldown engine (got /^@nativescript\/core(?:\/|$)/)".
//
// So the tests that matter are the two halves of that: nothing non-string reaches
// `external`, and the subpaths are still externalized anyway.

import { describe, expect, it } from '@gjsify/unit';

import { NATIVESCRIPT_CORE_EXTERNAL_PLUGIN, setupForNativescript } from './nativescript.js';

type ResolveIdHandler = (id: string) => { id: string; external: boolean } | null;

/** The plugin array flattened to entries that carry a `name`, whatever shape they arrived in. */
function namedPlugins(plugins: unknown[]): { name: string; resolveId?: unknown }[] {
    const out: { name: string; resolveId?: unknown }[] = [];
    for (const entry of plugins) {
        for (const candidate of Array.isArray(entry) ? entry : [entry]) {
            if (
                candidate &&
                typeof candidate === 'object' &&
                typeof (candidate as { name?: unknown }).name === 'string'
            )
                out.push(candidate as { name: string; resolveId?: unknown });
        }
    }
    return out;
}

function resolveIdOf(plugin: { resolveId?: unknown }): ResolveIdHandler {
    const hook = plugin.resolveId;
    if (typeof hook === 'function') return hook as ResolveIdHandler;
    return (hook as { handler: ResolveIdHandler }).handler;
}

export default async () => {
    await describe('setupForNativescript external', async () => {
        const factoryInput = { output: { file: 'dist/out.mjs' }, pluginOptions: {} };

        await it('passes only exact string names to the engine', async () => {
            // The regression itself: a RegExp here is a hard build failure under the native
            // engine, and the GJS-hosted CLI has no other engine to fall back to.
            const { options } = await setupForNativescript(factoryInput);
            const external = (options.external ?? []) as unknown[];
            expect(Array.isArray(external)).toBe(true);
            for (const entry of external) expect(typeof entry).toBe('string');
        });

        await it('keeps the caller’s --external names', async () => {
            const { options } = await setupForNativescript({ ...factoryInput, userExternal: ['some-peer'] });
            expect(options.external).toContain('some-peer');
        });

        await it('composes the core-external plugin first', async () => {
            // Ahead of `aliasPlugin` and the platform-suffix chain: both match on specifier
            // shape, and either one claiming the specifier first bundles a second core.
            const { plugins } = await setupForNativescript(factoryInput);
            const names = namedPlugins(plugins).map((plugin) => plugin.name);
            expect(names).toContain(NATIVESCRIPT_CORE_EXTERNAL_PLUGIN);
            expect(names[0]).toBe(NATIVESCRIPT_CORE_EXTERNAL_PLUGIN);
        });

        await it('externalizes the package and every subpath through the hook', async () => {
            const { plugins } = await setupForNativescript(factoryInput);
            const plugin = namedPlugins(plugins).find((entry) => entry.name === NATIVESCRIPT_CORE_EXTERNAL_PLUGIN);
            const resolveId = resolveIdOf(plugin!);
            expect(resolveId('@nativescript/core')).toStrictEqual({ id: '@nativescript/core', external: true });
            expect(resolveId('@nativescript/core/ui/frame')).toStrictEqual({
                id: '@nativescript/core/ui/frame',
                external: true,
            });
            // A subpath set cannot be enumerated as exact strings, which is why the arm has
            // to be a hook at all rather than a longer `external` list.
            expect(resolveId('@nativescript/core/application/application-common')).toStrictEqual({
                id: '@nativescript/core/application/application-common',
                external: true,
            });
        });

        await it('leaves a neighbouring specifier alone', async () => {
            // Prefix, not substring: `@nativescript/webpack` is a build-time dependency the
            // app bundle never imports, and `@nativescript/core-foo` is somebody else's package.
            const { plugins } = await setupForNativescript(factoryInput);
            const plugin = namedPlugins(plugins).find((entry) => entry.name === NATIVESCRIPT_CORE_EXTERNAL_PLUGIN);
            const resolveId = resolveIdOf(plugin!);
            expect(resolveId('@nativescript/webpack')).toBeNull();
            expect(resolveId('@nativescript/core-foo')).toBeNull();
            expect(resolveId('nativescript/core')).toBeNull();
            expect(resolveId('@gjsify/unit')).toBeNull();
        });
    });
};
