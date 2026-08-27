// The route manifest plugin, against a real directory on a real filesystem.
//
// What this file is FOR is the half the router cannot check: that the walk finds every
// file including the ones in subdirectories, that the emitted module is byte-stable for
// the same tree, and that each filesystem refusal names the resolved path. The
// CONVENTIONS are not tested here and must not be — they live in
// `@gjsify/react-native/router` and are covered by its own `routes.spec.ts`, and a
// second set of vectors over the same rules here would be the second truth this split
// exists to avoid.
//
// A real temporary directory rather than a mocked `fs`: the two facts most worth having
// are that a symlinked subdirectory is walked (a dirent says `isDirectory() === false`
// for one, which is why the walk calls `statSync`) and that a nesting cycle is refused
// rather than hung. Neither is expressible against a mock without encoding the answer
// into it.

import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from '@gjsify/unit';

import {
    MAX_ROUTE_DEPTH,
    RN_ROUTES_MODULE_ID,
    RouteManifestError,
    renderRouteManifest,
    rnRouteManifestPlugin,
    walkRoutes,
    type FoundRoute,
} from './rn-route-manifest.js';

/** A plugin hook, called with the `this` a bundler would supply. */
interface HookContext {
    addWatchFile(file: string): void;
}
type Loader = (this: HookContext, id: string) => string | null;
type Resolver = (this: HookContext, source: string) => string | null;

/** The message a call refuses with, or `null` when it did not refuse. */
function refusal(run: () => unknown): string | null {
    try {
        run();
        return null;
    } catch (error) {
        if (error instanceof RouteManifestError) return error.message;
        throw error;
    }
}

const keys = (routes: readonly FoundRoute[]): readonly string[] => routes.map((route) => route.contextKey);

export default async () => {
    await describe('the route manifest plugin', async () => {
        let root = '';
        const write = (relative: string, body = 'export default () => null;\n'): void => {
            const parts = relative.split('/');
            if (parts.length > 1) mkdirSync(join(root, ...parts.slice(0, -1)), { recursive: true });
            writeFileSync(join(root, ...parts), body);
        };

        beforeEach(() => {
            root = mkdtempSync(join(tmpdir(), 'gjsify-rn-routes-'));
        });
        afterEach(() => {
            rmSync(root, { recursive: true, force: true });
        });

        await it('walks subdirectories, not just the top level', async () => {
            write('_layout.tsx');
            write('index.tsx');
            write('detail/[id].tsx');
            write('(tabs)/_layout.tsx');
            write('(tabs)/home.tsx');
            // WALKED, never globbed: a glob is blind to the first file that lands in a
            // directory it did not think to match, and a route file nobody imports is a
            // screen that is simply not there.
            expect(keys(walkRoutes(root))).toStrictEqual([
                '(tabs)/_layout.tsx',
                '(tabs)/home.tsx',
                '_layout.tsx',
                'detail/[id].tsx',
                'index.tsx',
            ]);
        });

        await it('sorts, so the emitted module is byte-identical for the same tree', async () => {
            write('b.tsx');
            write('a.tsx');
            write('_layout.tsx');
            const first = renderRouteManifest(walkRoutes(root), root);
            const second = renderRouteManifest(walkRoutes(root), root);
            expect(first).toBe(second);
            // The order is the sort, not the readdir order — which differs by
            // filesystem, and a build cache keyed on this module's text would then miss
            // on a machine that merely reads a directory differently.
            expect(first.indexOf('"_layout.tsx"') < first.indexOf('"a.tsx"')).toBe(true);
            expect(first.indexOf('"a.tsx"') < first.indexOf('"b.tsx"')).toBe(true);
        });

        await it('reports EVERY file, leaving "is this a route" to the router', async () => {
            write('_layout.tsx');
            write('index.tsx');
            write('README.md', '# notes\n');
            // Filtering here would be a silent drop with a plausible excuse. The router
            // refuses a file that matches no convention BY NAME, and that message is
            // the one a reader can act on — this plugin has no opinion to offer.
            expect(keys(walkRoutes(root))).toStrictEqual(['README.md', '_layout.tsx', 'index.tsx']);
        });

        await it('walks a SYMLINKED subdirectory, which a dirent calls a file', async () => {
            write('_layout.tsx');
            const shared = mkdtempSync(join(tmpdir(), 'gjsify-rn-shared-'));
            try {
                writeFileSync(join(shared, 'about.tsx'), 'export default () => null;\n');
                symlinkSync(shared, join(root, 'extra'));
                // `entry.isDirectory()` answers FALSE for a symlink to a directory, so a
                // walk that trusted the dirent would emit `extra` as a route file and
                // lose `extra/about.tsx`. `statSync` follows the link.
                expect(keys(walkRoutes(root))).toStrictEqual(['_layout.tsx', 'extra/about.tsx']);
            } finally {
                rmSync(shared, { recursive: true, force: true });
            }
        });

        await it('emits one static import per file and the manifest the router takes', async () => {
            write('_layout.tsx');
            write('index.tsx');
            const source = renderRouteManifest(walkRoutes(root), root);
            expect(source.includes('import * as route0 from')).toBe(true);
            expect(source.includes('import * as route1 from')).toBe(true);
            expect(source.includes('{ contextKey: "_layout.tsx", module: route0 },')).toBe(true);
            expect(source.includes('{ contextKey: "index.tsx", module: route1 },')).toBe(true);
            expect(source.includes('export const manifest = [')).toBe(true);
            // STATIC, not `() => import(…)`: a lazy route needs a Suspense boundary and
            // `@gjsify/gtk-host/react`'s render() is synchronous, so a boundary that
            // suspends on the first commit leaves the container empty and returns
            // cleanly. That failure is invisible; this assertion is not.
            expect(source.includes('import(')).toBe(false);
        });

        await it('writes module specifiers with `/`, because a specifier is not a path', async () => {
            write('index.tsx');
            const source = renderRouteManifest(walkRoutes(root), root);
            const importLine = source.split('\n').find((line) => line.startsWith('import * as route0')) ?? '';
            const specifier = importLine.slice(importLine.indexOf('"'));
            expect(specifier.includes('\\')).toBe(false);
            expect(specifier.includes('/index.tsx')).toBe(true);
            // On POSIX this is the identity; the assertion is what would catch a Windows
            // build emitting `C:\app\index.tsx`, where the backslash is an escape.
            expect(sep === '/' || !specifier.includes(sep)).toBe(true);
        });

        await it('REFUSES an empty routes directory, naming it', async () => {
            const said = refusal(() => renderRouteManifest(walkRoutes(root), root));
            expect(said !== null).toBe(true);
            expect((said as string).includes(root)).toBe(true);
            expect((said as string).includes('index.tsx')).toBe(true);
        });

        await it('REFUSES a nesting cycle rather than hanging the bundler', async () => {
            // A LOUD limit rather than none: unbounded, a symlink cycle becomes a hang
            // or an out-of-memory inside the bundler, where nothing points at the
            // directory that caused it.
            write('_layout.tsx');
            let path = root;
            for (let level = 0; level <= MAX_ROUTE_DEPTH + 1; level++) {
                path = join(path, `d${level}`);
                mkdirSync(path);
            }
            writeFileSync(join(path, 'deep.tsx'), 'export default () => null;\n');
            const said = refusal(() => walkRoutes(root));
            expect(said !== null).toBe(true);
            expect((said as string).includes(String(MAX_ROUTE_DEPTH))).toBe(true);
            expect((said as string).includes('symlink')).toBe(true);
        });

        await it('answers only its own specifier, and marks the id as its own', async () => {
            const plugin = rnRouteManifestPlugin({ routesDir: root });
            const resolveId = plugin.resolveId as unknown as Resolver;
            const context: HookContext = { addWatchFile: () => {} };
            expect(resolveId.call(context, RN_ROUTES_MODULE_ID)).toBe(`\0${RN_ROUTES_MODULE_ID}`);
            expect(resolveId.call(context, 'react')).toBe(null);
            // The `\0` prefix is rollup's own convention for "this id is mine": it
            // survives the resolver chain and makes every other plugin's path handling
            // leave it alone.
            expect(resolveId.call(context, 'virtual:something-else')).toBe(null);
        });

        await it('honours a custom specifier', async () => {
            const plugin = rnRouteManifestPlugin({ routesDir: root, virtualId: 'app-routes' });
            const resolveId = plugin.resolveId as unknown as Resolver;
            const context: HookContext = { addWatchFile: () => {} };
            expect(resolveId.call(context, 'app-routes')).toBe('\0app-routes');
            expect(resolveId.call(context, RN_ROUTES_MODULE_ID)).toBe(null);
        });

        await it('loads only its own id, and watches every file it emitted', async () => {
            write('_layout.tsx');
            write('index.tsx');
            const plugin = rnRouteManifestPlugin({ routesDir: root });
            const load = plugin.load as unknown as Loader;
            const watched: string[] = [];
            const context: HookContext = {
                addWatchFile: (file) => {
                    watched.push(file);
                },
            };
            expect(load.call(context, '/somewhere/else.ts')).toBe(null);
            const source = load.call(context, `\0${RN_ROUTES_MODULE_ID}`);
            expect(typeof source).toBe('string');
            // Without the watch files a new route file needs a restart, which reads as
            // "the router did not pick it up".
            expect(watched.length).toBe(2);
            expect(watched.every((file) => file.startsWith(root))).toBe(true);
        });

        await it('REFUSES a routesDir that does not exist, naming the RESOLVED path', async () => {
            const missing = join(root, 'no-such-dir');
            const plugin = rnRouteManifestPlugin({ routesDir: missing });
            const load = plugin.load as unknown as Loader;
            const said = refusal(() => load.call({ addWatchFile: () => {} }, `\0${RN_ROUTES_MODULE_ID}`));
            expect(said !== null).toBe(true);
            // The resolved absolute path, because "routes directory not found" without
            // the path it looked for is the least useful build error there is — and a
            // relative `routesDir` means something different when the bundler is spawned
            // from elsewhere, which is exactly when this fires.
            expect((said as string).includes(missing)).toBe(true);
        });

        await it('REFUSES a routesDir that is a file', async () => {
            write('app.tsx');
            const plugin = rnRouteManifestPlugin({ routesDir: join(root, 'app.tsx') });
            const load = plugin.load as unknown as Loader;
            const said = refusal(() => load.call({ addWatchFile: () => {} }, `\0${RN_ROUTES_MODULE_ID}`));
            expect(said !== null).toBe(true);
            expect((said as string).includes('not a directory')).toBe(true);
        });
    });
};
