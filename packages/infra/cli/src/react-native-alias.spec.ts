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

export default async () => {
    await describe('react-native alias: what counts as the package', async () => {
        await it('classifies the exact root', () => {
            expect(classifyReactNativeSpecifier('react-native')).toStrictEqual({ kind: 'root' });
        });

        await it('classifies a subpath, keeping the subpath for the message', () => {
            expect(classifyReactNativeSpecifier('react-native/Libraries/Text/Text')).toStrictEqual({
                kind: 'subpath',
                subpath: 'Libraries/Text/Text',
            });
        });

        // The prefix trap. The last two are `not-reachable` in ADR 0032's own
        // table (they need a Babel worklet transform that is not in this chain),
        // and the first is rejected by design — none of them is this package.
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
            const resolved = await handlerOf(reactNativeAliasPlugin()).call(ctx, 'react-native', IMPORTER);
            expect(resolved?.id).toBe(TARGET_ID);
            expect(ctx.asked).toStrictEqual([REACT_NATIVE_ALIAS_TARGET]);
        });

        await it('claims the root on an ENTRY module too', async () => {
            const ctx = withTarget();
            const resolved = await handlerOf(reactNativeAliasPlugin()).call(ctx, 'react-native', undefined);
            expect(resolved?.id).toBe(TARGET_ID);
        });

        await it('ignores every specifier that is not the package', async () => {
            const ctx = withTarget();
            const plugin = reactNativeAliasPlugin();
            for (const other of ['react', 'react-native-web', REACT_NATIVE_ALIAS_TARGET, './card', 'node:fs']) {
                expect(await handlerOf(plugin).call(ctx, other, IMPORTER)).toBe(null);
            }
            expect(ctx.asked).toStrictEqual([]);
        });

        await it('refuses a deep import by name, with the importer in the message', async () => {
            const ctx = withTarget();
            let thrown: unknown;
            try {
                await handlerOf(reactNativeAliasPlugin()).call(
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
                await handlerOf(reactNativeAliasPlugin()).call(ctx, 'react-native', IMPORTER);
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
                await handlerOf(reactNativeAliasPlugin()).call(ctx, 'react-native', IMPORTER);
            } catch (error) {
                thrown = error;
            }
            expect(thrown instanceof ReactNativeAliasTargetMissingError).toBe(true);
        });
    });
};
