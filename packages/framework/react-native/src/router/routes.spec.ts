// The file convention, vector by vector — and every refusal it owes.
//
// This is where the weight goes. ADR 0032's prior art carries a 2.1 : 1
// test-to-source ratio in its navigation package, and the reason is not thoroughness
// for its own sake: a route tree is arithmetic over file names, every wrong answer is
// a screen that does not appear, and none of it is visible in a type. So each
// convention gets its positive vector AND its refusal, and the URL round trip is
// asserted through React Navigation's own functions rather than through our config —
// the config is a means, the URLs are the promise.
//
// NO GTK HERE. `buildRouteTree` and `pathConfigOf` are pure functions over strings,
// which is what makes them testable at all; the widgets have their own file.

import { describe, expect, it } from '@gjsify/unit';
import { getPathFromState, getStateFromPath } from '@react-navigation/core';

import { RouterError } from './errors.js';
import { buildRouteTree, pathConfigOf, screenUrls, type RouteManifest, type RouteNode } from './routes.js';

/** A manifest from bare file names. The module is a component, because a route has one. */
const manifestOf = (...files: readonly string[]): RouteManifest =>
    files.map((contextKey) => ({ contextKey, module: { default: () => null } }));

/** The code a call refuses with, or `null` when it did not refuse. */
function refusal(run: () => unknown): string | null {
    try {
        run();
        return null;
    } catch (error) {
        if (error instanceof RouterError) return error.code;
        throw error;
    }
}

/** The message a call refuses with, for the vectors that assert what a reader is told. */
function message(run: () => unknown): string {
    try {
        run();
        return '(did not throw)';
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

/** Every node's `name`, depth-first, so a tree can be asserted as one array. */
function names(node: RouteNode, prefix = ''): readonly string[] {
    return node.children.flatMap((child) => {
        const own = `${prefix}${child.name}${child.kind === 'layout' ? '/' : ''}`;
        return [own, ...names(child, own)];
    });
}

/** The config, in the shape upstream's functions take. See `navigation.ts`' `upstream`. */
const asUpstream = (tree: RouteNode): Parameters<typeof getStateFromPath>[1] =>
    pathConfigOf(tree) as unknown as Parameters<typeof getStateFromPath>[1];

export default async () => {
    await describe('the four file conventions', async () => {
        await it('turns a flat directory into a stack of screens, index first', async () => {
            const tree = buildRouteTree(manifestOf('_layout.tsx', 'settings.tsx', 'about.tsx', 'index.tsx'));
            // ORDER IS THE INITIAL ROUTE. React Navigation focuses a navigator's
            // first screen, so `index` leading is a promise and not a coincidence —
            // and the rest is alphabetical, because a manifest read in directory
            // order is not deterministic across filesystems.
            expect(names(tree)).toStrictEqual(['index', 'about', 'settings']);
            expect(tree.contextKey).toBe('_layout.tsx');
        });

        await it('drops a (group) from the URL and keeps it in the route name', async () => {
            const tree = buildRouteTree(manifestOf('_layout.tsx', '(tabs)/_layout.tsx', '(tabs)/home.tsx'));
            expect(names(tree)).toStrictEqual(['(tabs)/', '(tabs)/home']);
            expect(screenUrls(tree)).toStrictEqual(['/home']);
        });

        await it('makes a [param] a React Navigation `:param` and records its name', async () => {
            const tree = buildRouteTree(manifestOf('_layout.tsx', 'detail/[id].tsx'));
            expect(screenUrls(tree)).toStrictEqual(['/detail/:id']);
            const screen = tree.children[0];
            expect(screen?.name).toBe('detail/[id]');
            expect(screen?.params).toStrictEqual(['id']);
        });

        await it('gives +not-found the wildcard pattern and puts it LAST', async () => {
            const tree = buildRouteTree(manifestOf('_layout.tsx', '+not-found.tsx', 'index.tsx', 'about.tsx'));
            expect(names(tree)).toStrictEqual(['index', 'about', '+not-found']);
            // A fallback that is tried first is not a fallback: React Navigation
            // sorts wildcards last itself, and this ordering is the same statement
            // one layer up, where the initial route is decided.
            expect(screenUrls(tree)).toStrictEqual(['/', '/about', '/*']);
        });

        await it('does NOT make a directory a navigator without a _layout', async () => {
            // The rule that reads as the surprising one and is expo-router's own:
            // `detail/[id].tsx` needs no `detail/_layout.tsx`. The alternative guess
            // — every directory is a navigator — produces a stack of empty ones.
            const flat = buildRouteTree(manifestOf('_layout.tsx', 'detail/[id].tsx'));
            expect(names(flat)).toStrictEqual(['detail/[id]']);
            expect(flat.children[0]?.kind).toBe('screen');

            const nested = buildRouteTree(manifestOf('_layout.tsx', 'detail/_layout.tsx', 'detail/[id].tsx'));
            expect(names(nested)).toStrictEqual(['detail/', 'detail/[id]']);
            expect(nested.children[0]?.kind).toBe('layout');
            // The URL is the same either way, which is the point: the layout changes
            // the widget tree, not the address.
            expect(screenUrls(nested)).toStrictEqual(['/detail/:id']);
        });

        await it('nests a group navigator under a directory navigator', async () => {
            const tree = buildRouteTree(
                manifestOf(
                    '_layout.tsx',
                    'index.tsx',
                    '(tabs)/_layout.tsx',
                    '(tabs)/home.tsx',
                    '(tabs)/settings.tsx',
                    'detail/[id].tsx',
                ),
            );
            expect(names(tree)).toStrictEqual(['index', '(tabs)/', '(tabs)/home', '(tabs)/settings', 'detail/[id]']);
            expect(screenUrls(tree)).toStrictEqual(['/', '/home', '/settings', '/detail/:id']);
        });
    });

    await describe('what the conventions refuse', async () => {
        await it('refuses a file matching no convention, naming the extensions', async () => {
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', 'README.md')))).toBe('unknown-convention');
            expect(message(() => buildRouteTree(manifestOf('_layout.tsx', 'README.md')))).toContain('.tsx');
        });

        await it('refuses a [param] with no name, and says how to read one', async () => {
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '[].tsx')))).toBe('param-without-name');
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '[]/x.tsx')))).toBe('param-without-name');
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '[...].tsx')))).toBe('param-without-name');
            expect(message(() => buildRouteTree(manifestOf('_layout.tsx', '[].tsx')))).toContain(
                'useLocalSearchParams',
            );
        });

        await it('refuses two files claiming one URL, naming BOTH', async () => {
            // Two groups are the ordinary way in — a group contributes no segment, so
            // nothing tells `(app)/settings` and `(admin)/settings` apart.
            const clash = manifestOf(
                '_layout.tsx',
                '(app)/_layout.tsx',
                '(app)/settings.tsx',
                '(admin)/_layout.tsx',
                '(admin)/settings.tsx',
            );
            expect(refusal(() => buildRouteTree(clash))).toBe('duplicate-route');
            const said = message(() => buildRouteTree(clash));
            expect(said).toContain('(app)/settings.tsx');
            expect(said).toContain('(admin)/settings.tsx');
        });

        await it('refuses `a.tsx` beside `a/index.tsx`, which is the same URL twice', async () => {
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', 'a.tsx', 'a/index.tsx')))).toBe(
                'duplicate-route',
            );
        });

        await it('refuses two _layout files for one directory', async () => {
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '_layout.ts', 'index.tsx')))).toBe(
                'duplicate-route',
            );
        });

        await it('refuses a catch-all [...rest] by name rather than half-answering it', async () => {
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '[...rest].tsx')))).toBe(
                'deep-dynamic-unsupported',
            );
            expect(message(() => buildRouteTree(manifestOf('_layout.tsx', '[...rest].tsx')))).toContain('+not-found');
        });

        await it('refuses a shared group (a,b)', async () => {
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '(a,b)/_layout.tsx', '(a,b)/x.tsx')))).toBe(
                'shared-group-unsupported',
            );
        });

        await it('refuses an unclosed (group or [param', async () => {
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '(tabs/x.tsx')))).toBe('unknown-convention');
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '[id.tsx')))).toBe('unknown-convention');
        });

        await it('refuses another `+` or `_` prefix instead of ignoring it', async () => {
            // expo-router treats these as private and silently leaves them out of the
            // tree. A file that is not a route belongs outside the routes directory,
            // where nothing has to guess — so this is a refusal, not a skip.
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '+html.tsx')))).toBe('unknown-convention');
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '_helpers.tsx')))).toBe('unknown-convention');
        });

        await it('refuses a param name a property cannot hold', async () => {
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', '[my id].tsx')))).toBe('unknown-convention');
        });

        await it('refuses a _layout whose directory holds no routes', async () => {
            expect(refusal(() => buildRouteTree(manifestOf('_layout.tsx', 'index.tsx', 'empty/_layout.tsx')))).toBe(
                'layout-without-routes',
            );
        });

        await it('refuses an empty manifest, an absolute key and a backslash key', async () => {
            expect(refusal(() => buildRouteTree([]))).toBe('bad-manifest');
            expect(refusal(() => buildRouteTree(manifestOf('/abs/index.tsx')))).toBe('bad-manifest');
            expect(refusal(() => buildRouteTree(manifestOf('a\\b.tsx')))).toBe('bad-manifest');
            expect(refusal(() => buildRouteTree([{ contextKey: 7 } as never]))).toBe('bad-manifest');
        });
    });

    await describe('the path config, through React Navigation itself', async () => {
        // THE CONFIG IS A MEANS AND THE URLS ARE THE PROMISE, so these vectors go
        // through upstream's own `getStateFromPath` / `getPathFromState` rather than
        // asserting the config object. They are also what covers the one cast in
        // `navigation.ts`: if upstream ever stops accepting this shape, the round trip
        // is what fails, and it fails with a URL rather than with a type.
        const tree = buildRouteTree(
            manifestOf(
                '_layout.tsx',
                'index.tsx',
                '(tabs)/_layout.tsx',
                '(tabs)/home.tsx',
                '(tabs)/settings.tsx',
                'detail/_layout.tsx',
                'detail/index.tsx',
                'detail/[id].tsx',
                '+not-found.tsx',
            ),
        );
        const config = asUpstream(tree);

        await it('resolves every declared URL and gives the same one back', async () => {
            for (const [href, expected] of [
                ['/', '/'],
                ['/home', '/home'],
                ['/settings', '/settings'],
                ['/detail', '/detail'],
                ['/detail/7', '/detail/7'],
            ] as const) {
                const state = getStateFromPath(href, config);
                expect(state !== undefined).toBe(true);
                expect(getPathFromState(state!, config)).toBe(expected);
            }
        });

        await it('carries a [param] value into the resolved state', async () => {
            const state = getStateFromPath('/detail/7', config);
            const deepest = JSON.stringify(state);
            expect(deepest).toContain('"id":"7"');
        });

        await it('falls through to +not-found for an unknown URL', async () => {
            const state = getStateFromPath('/nope/deeper', config);
            expect(state !== undefined).toBe(true);
            expect(JSON.stringify(state)).toContain('+not-found');
        });

        await it('nests the state, which is what makes a nested navigator work', async () => {
            const state = getStateFromPath('/settings', config);
            const routes = state?.routes ?? [];
            const group = routes.find((route) => route.name === '(tabs)');
            expect(group !== undefined).toBe(true);
            expect(group?.state?.routes.some((route) => route.name === 'settings')).toBe(true);
        });

        await it('gives a navigator NO path of its own — the conflict upstream refuses', async () => {
            // MEASURED: giving `(tabs)` its own `path: ''` alongside `index`'s makes
            // React Navigation throw "Found conflicting screens with the same pattern.
            // The pattern '' resolves to both 'index' and '(tabs)'" and refuse the
            // WHOLE config. A navigator is not a destination; only the screen in it is.
            const raw = pathConfigOf(tree) as unknown as Record<string, unknown>;
            const screens = raw.screens as Record<string, Record<string, unknown>>;
            expect('path' in (screens['(tabs)'] ?? {})).toBe(false);
            expect(screens['index']?.path).toBe('');
            expect((screens['detail'] as { screens: Record<string, { path: string }> }).screens['[id]']?.path).toBe(
                'detail/:id',
            );
        });

        await it('keeps the wildcard unprefixed even when +not-found is nested', async () => {
            const nested = buildRouteTree(
                manifestOf('_layout.tsx', 'index.tsx', 'area/_layout.tsx', 'area/index.tsx', 'area/+not-found.tsx'),
            );
            // A fallback that only catches one subtree is not the fallback the author
            // asked for, so the pattern stays `*` rather than becoming `area/*`.
            expect(screenUrls(nested)).toStrictEqual(['/', '/area', '/*']);
        });
    });
};
