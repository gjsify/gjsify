// SPDX-License-Identifier: MIT
// The ADR 0032 § 2 alias line, and the three things it must NOT do.
//
// The line itself is one rewrite. What needs pinning is the boundary around it:
// `react-native-web` and `react-native-reanimated` share eleven characters with
// the package and are NOT it (a prefix match would replace a package that
// honestly does not work with one that silently does the wrong thing), a subpath
// into React Native's internals is a named refusal rather than a rewrite, and an
// unresolvable target is a named error rather than a silent external — because
// the substitution IS the promise, so its failure is the one thing that must not
// exit 0.
//
// Tested from @gjsify/cli's harness because the plugin package has no
// `test:node` script of its own.

import { describe, expect, it } from '@gjsify/unit';
import {
    classifyReactNativeSpecifier,
    reactNativeAliasPlugin,
    ReactNativeAliasTargetMissingError,
    ReactNativeDeepImportError,
    REACT_NATIVE_ALIAS_TARGET,
    type LayerReader,
} from '@gjsify/rolldown-plugin-gjsify';

const IMPORTER = '/proj/src/screen.tsx';
const TARGET_ID = '/proj/node_modules/@gjsify/react-native/lib/esm/index.js';

type ResolveHandler = (
    this: unknown,
    source: string,
    importer: string | undefined,
    extra?: { kind?: string },
) => Promise<{ id: string; external?: boolean } | null>;

function handlerOf(plugin: unknown): ResolveHandler {
    const h = (plugin as { resolveId?: { handler?: unknown } }).resolveId?.handler;
    if (typeof h !== 'function') throw new Error('plugin did not expose a resolveId.handler');
    return h as ResolveHandler;
}

function mockCtx(resolveMap: Record<string, { id: string; external?: boolean }> = {}) {
    const asked: string[] = [];
    return {
        asked,
        async resolve(id: string) {
            asked.push(id);
            return resolveMap[id] ?? null;
        },
    };
}

const withTarget = () => mockCtx({ [REACT_NATIVE_ALIAS_TARGET]: { id: TARGET_ID } });

/**
 * The layer, handed in rather than resolved (ADR 0036).
 *
 * The plugin reads the surface registry off `@gjsify/react-native/support-table` in a
 * real build; these vectors are about the ALIAS, so the registry arrives as a fixture
 * and `ctx.asked` stays a record of what the alias itself asked for.
 */
const layerOf = (rows: readonly { module: string; target: string }[]): LayerReader => ({
    SURFACES: rows,
    isImportable: () => true,
    explainUnsupported: () => 'x',
});

const ROOT_ONLY = layerOf([{ module: 'react-native', target: REACT_NATIVE_ALIAS_TARGET }]);

export default async () => {
    await describe('react-native alias: what counts as the package', async () => {
        await it('classifies the exact root, and names the target it rewrites to', () => {
            // The TARGET is part of the classification now (ADR 0036): a surface's
            // answer is a subpath of this package, and the alias would otherwise have to
            // recompute which one from the specifier.
            expect(classifyReactNativeSpecifier('react-native')).toStrictEqual({
                kind: 'root',
                target: REACT_NATIVE_ALIAS_TARGET,
            });
        });

        await it('classifies a subpath, keeping the subpath for the message', () => {
            expect(classifyReactNativeSpecifier('react-native/Libraries/Text/Text')).toStrictEqual({
                kind: 'subpath',
                module: 'react-native',
                target: REACT_NATIVE_ALIAS_TARGET,
                subpath: 'Libraries/Text/Text',
            });
        });

        await it('classifies a deep import into ANY declared surface, not only react-native', async () => {
            // The gap ADR 0036 left open, and it is reachable from ordinary code:
            // `@expo/vector-icons/Ionicons` is the spelling that package's own
            // documentation uses and `expo-router/entry` is what an Expo application's
            // `package.json#main` points at. Both classified as `other`, so the alias
            // returned null and the build failed at MODULE RESOLUTION — npm's "cannot
            // find package", the exact failure this ADR replaces with a sentence.
            const rows = [
                { module: 'react-native', target: REACT_NATIVE_ALIAS_TARGET },
                { module: '@expo/vector-icons', target: `${REACT_NATIVE_ALIAS_TARGET}/vector-icons` },
                { module: 'expo-router', target: `${REACT_NATIVE_ALIAS_TARGET}/router` },
            ];
            expect(classifyReactNativeSpecifier('@expo/vector-icons/Ionicons', rows)).toStrictEqual({
                kind: 'subpath',
                module: '@expo/vector-icons',
                target: `${REACT_NATIVE_ALIAS_TARGET}/vector-icons`,
                subpath: 'Ionicons',
            });
            expect(classifyReactNativeSpecifier('expo-router/entry', rows)).toStrictEqual({
                kind: 'subpath',
                module: 'expo-router',
                target: `${REACT_NATIVE_ALIAS_TARGET}/router`,
                subpath: 'entry',
            });
            // AND THE TARGET'S OWN SUBPATHS STAY LEGAL, which is the half a careless
            // prefix test breaks: `@gjsify/react-native/router` is the answer, not a
            // deep import to refuse.
            expect(classifyReactNativeSpecifier(`${REACT_NATIVE_ALIAS_TARGET}/router`, rows)).toStrictEqual({
                kind: 'other',
            });
            // A surface the rows do not declare keeps its subpath too: the registry
            // decides, so `expo-font/build/x` is somebody else's package here.
            expect(classifyReactNativeSpecifier('expo-font/build/x', rows)).toStrictEqual({ kind: 'other' });
        });

        await it('names the surface, not react-native, when the deep import is another one', async () => {
            const target = `${REACT_NATIVE_ALIAS_TARGET}/vector-icons`;
            const ctx = mockCtx({ [target]: { id: '/proj/x/vector-icons.js' } });
            const layer = layerOf([
                { module: 'react-native', target: REACT_NATIVE_ALIAS_TARGET },
                { module: '@expo/vector-icons', target },
            ]);
            let thrown: unknown;
            try {
                await handlerOf(reactNativeAliasPlugin({ layer })).call(ctx, '@expo/vector-icons/Ionicons', IMPORTER);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof ReactNativeDeepImportError).toBe(true);
            const message = (thrown as Error).message;
            expect(message).toContain('@expo/vector-icons/Ionicons');
            expect(message).toContain(target);
            // Metro is react-native's OWN reason for having a subpath layout, so it must
            // not be attached to a surface it says nothing about.
            expect(message.includes('Metro')).toBe(false);
            // And nothing was resolved: a refusal is not a rewrite.
            expect(ctx.asked).toStrictEqual([]);
        });

        // The prefix trap, and it got sharper with ADR 0036 rather than softer:
        // `react-native-gesture-handler` and `react-native-safe-area-context` ARE
        // declared surfaces now, so the exact-match pass has to run before the
        // `react-native/` subpath test — and a specifier that is not in the rows handed
        // in is `other`, never a guess. `react-native-web` is rejected by design;
        // `react-native-reanimated` is `not-reachable` in ADR 0032's own table.
        await it('is not a prefix match', () => {
            for (const near of [
                'react-native-web',
                'react-native-reanimated',
                'react-native-gesture-handler',
                'react-nativex',
                '@react-native/normalize-colors',
            ]) {
                expect(classifyReactNativeSpecifier(near)).toStrictEqual({ kind: 'other' });
            }
        });

        await it('claims a surface the registry declares, and only through the registry', async () => {
            const rows = [
                { module: 'react-native', target: REACT_NATIVE_ALIAS_TARGET },
                {
                    module: 'react-native-gesture-handler',
                    target: `${REACT_NATIVE_ALIAS_TARGET}/react-native-gesture-handler`,
                },
            ];
            expect(classifyReactNativeSpecifier('react-native-gesture-handler', rows)).toStrictEqual({
                kind: 'root',
                target: `${REACT_NATIVE_ALIAS_TARGET}/react-native-gesture-handler`,
            });
            // The SAME specifier is `other` against rows that do not declare it. The
            // registry decides; the plugin never guesses from the shape of a name.
            expect(classifyReactNativeSpecifier('react-native-gesture-handler', [rows[0]!])).toStrictEqual({
                kind: 'other',
            });
        });

        // Otherwise the rewrite target rewrites itself.
        await it('leaves the alias target itself alone', () => {
            expect(classifyReactNativeSpecifier(REACT_NATIVE_ALIAS_TARGET)).toStrictEqual({ kind: 'other' });
            expect(classifyReactNativeSpecifier(`${REACT_NATIVE_ALIAS_TARGET}/solid`)).toStrictEqual({
                kind: 'other',
            });
        });
    });

    await describe('react-native alias: the plugin', async () => {
        await it('rewrites the bare root onto the gjsify layer', async () => {
            const ctx = withTarget();
            const resolved = await handlerOf(reactNativeAliasPlugin({ layer: ROOT_ONLY })).call(
                ctx,
                'react-native',
                IMPORTER,
            );
            expect(resolved?.id).toBe(TARGET_ID);
            expect(ctx.asked).toStrictEqual([REACT_NATIVE_ALIAS_TARGET]);
        });

        await it('rewrites a third-party surface onto ITS subpath', async () => {
            const target = `${REACT_NATIVE_ALIAS_TARGET}/expo-font`;
            const ctx = mockCtx({ [target]: { id: '/proj/node_modules/x/expo-font.js' } });
            const layer = layerOf([
                { module: 'react-native', target: REACT_NATIVE_ALIAS_TARGET },
                { module: 'expo-font', target },
            ]);
            const resolved = await handlerOf(reactNativeAliasPlugin({ layer })).call(ctx, 'expo-font', IMPORTER);
            expect(resolved?.id).toBe('/proj/node_modules/x/expo-font.js');
            expect(ctx.asked).toStrictEqual([target]);
        });

        await it('claims the root on an ENTRY module too', async () => {
            const ctx = withTarget();
            const resolved = await handlerOf(reactNativeAliasPlugin({ layer: ROOT_ONLY })).call(
                ctx,
                'react-native',
                undefined,
            );
            expect(resolved?.id).toBe(TARGET_ID);
        });

        await it('ignores every specifier that is not a declared surface', async () => {
            const ctx = withTarget();
            const plugin = reactNativeAliasPlugin({ layer: ROOT_ONLY });
            for (const other of ['react', 'react-native-web', REACT_NATIVE_ALIAS_TARGET, './card', 'node:fs']) {
                expect(await handlerOf(plugin).call(ctx, other, IMPORTER)).toBe(null);
            }
            // NOTHING WAS ASKED, which is the half that matters: this hook runs for
            // every specifier in the build, so a resolve per miss would be a resolve per
            // import in the project.
            expect(ctx.asked).toStrictEqual([]);
        });

        await it('refuses a deep import by name, with the importer in the message', async () => {
            const ctx = withTarget();
            let thrown: unknown;
            try {
                await handlerOf(reactNativeAliasPlugin({ layer: ROOT_ONLY })).call(
                    ctx,
                    'react-native/Libraries/Components/View/View',
                    IMPORTER,
                );
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof ReactNativeDeepImportError).toBe(true);
            const message = (thrown as Error).message;
            expect(message.includes('react-native/Libraries/Components/View/View')).toBe(true);
            expect(message.includes(IMPORTER)).toBe(true);
        });

        // The failure that must not exit 0: without this, Rolldown externalises
        // `react-native` and stock GJS aborts the module graph at load.
        await it('errors by name when the alias target does not resolve', async () => {
            const ctx = mockCtx();
            let thrown: unknown;
            try {
                await handlerOf(reactNativeAliasPlugin({ layer: ROOT_ONLY })).call(ctx, 'react-native', IMPORTER);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof ReactNativeAliasTargetMissingError).toBe(true);
            expect((thrown as Error).message.includes(REACT_NATIVE_ALIAS_TARGET)).toBe(true);
        });

        // An external target is not a target: there would be no file in the
        // bundle, and the bare specifier would be re-emitted.
        await it('errors when the alias target resolves EXTERNAL', async () => {
            const ctx = mockCtx({ [REACT_NATIVE_ALIAS_TARGET]: { id: TARGET_ID, external: true } });
            let thrown: unknown;
            try {
                await handlerOf(reactNativeAliasPlugin({ layer: ROOT_ONLY })).call(ctx, 'react-native', IMPORTER);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof ReactNativeAliasTargetMissingError).toBe(true);
        });

        // WHAT HAPPENS WHEN THE LAYER CANNOT BE READ AT ALL, which is a real state: the
        // opt-in is on and `@gjsify/react-native` is not installed. The alias falls back
        // to the ONE row whose name is a fact rather than a lookup, so `react-native`
        // still gets its named error and nothing else in the build starts throwing —
        // which is what would happen if a failed registry read propagated out of a hook
        // that runs for every specifier.
        await it('degrades to the one row it knows when the layer is unreadable', async () => {
            const ctx = mockCtx();
            const plugin = reactNativeAliasPlugin();
            let thrown: unknown;
            try {
                await handlerOf(plugin).call(ctx, 'react-native', IMPORTER);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof ReactNativeAliasTargetMissingError).toBe(true);
            // And a surface it can no longer know about is left alone rather than
            // refused: `expo-font` simply resolves the way it did before ADR 0036.
            expect(await handlerOf(plugin).call(ctx, 'expo-font', IMPORTER)).toBe(null);
            // The failed read is CACHED: one attempt, not one per specifier.
            expect(ctx.asked.filter((id) => id.endsWith('/support-table')).length).toBe(1);
        });
    });
};
