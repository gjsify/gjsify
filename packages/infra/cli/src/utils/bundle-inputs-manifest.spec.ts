// Unit coverage for the bundle inputs-manifest derivation. The regression it
// guards: the pre-commit hook's rebuild trigger was a hand-maintained
// five-path list while the committed bundles inline the whole workspace-dep
// closure — three misses in one day (`@gjsify/fetch`, `@gjsify/utils`+`fs`,
// `@gjsify/zlib`), each a ~20-minute CI round trip. The manifest derives the
// trigger set from the bundler's REAL module graph so it cannot drift.

import { describe, expect, it } from '@gjsify/unit';
import {
    assertModuleGraphReported,
    collectChunkModuleIds,
    deriveInputPackages,
    renderInputsManifest,
    type InputsManifestFs,
    type InputsWorkspaceRef,
} from './bundle-inputs-manifest.js';

const ROOT = '/repo';

const WORKSPACES: InputsWorkspaceRef[] = [
    { name: '@gjsify/cli', location: '/repo/packages/infra/cli', relativeLocation: 'packages/infra/cli' },
    { name: '@gjsify/zlib', location: '/repo/packages/node/zlib', relativeLocation: 'packages/node/zlib' },
    { name: '@gjsify/utils', location: '/repo/packages/gjs/utils', relativeLocation: 'packages/gjs/utils' },
];

/**
 * A virtual tree: `packageDirs` have a package.json (name optional),
 * `symlinks` maps a path PREFIX to its realpath prefix (the
 * `node_modules/@gjsify/* → packages/…` install layout).
 */
function fakeFs(opts: { packageDirs: Record<string, string | null>; symlinks?: Record<string, string> }): InputsManifestFs {
    const links = Object.entries(opts.symlinks ?? {});
    return {
        realpath: (path) => {
            for (const [from, to] of links) {
                if (path === from) return to;
                if (path.startsWith(`${from}/`)) return to + path.slice(from.length);
            }
            return path;
        },
        hasPackageJson: (dir) => dir in opts.packageDirs,
        readPackageName: (dir) => opts.packageDirs[dir] ?? undefined,
    };
}

export default async () => {
    await describe('bundle-inputs-manifest: deriveInputPackages', async () => {
        await it('maps module files to their owning workspace package dirs, sorted + deduped', () => {
            const fs = fakeFs({
                packageDirs: {
                    '/repo': 'gjsify',
                    '/repo/packages/infra/cli': '@gjsify/cli',
                    '/repo/packages/node/zlib': '@gjsify/zlib',
                    '/repo/packages/gjs/utils': '@gjsify/utils',
                },
            });
            const packages = deriveInputPackages({
                moduleIds: [
                    '/repo/packages/node/zlib/lib/esm/index.js',
                    '/repo/packages/infra/cli/src/index.ts',
                    '/repo/packages/node/zlib/lib/esm/register.js',
                    '/repo/packages/gjs/utils/lib/esm/cli.js',
                ],
                workspaceRoot: ROOT,
                workspaces: WORKSPACES,
                fs,
            });
            expect(packages).toStrictEqual(['packages/gjs/utils', 'packages/infra/cli', 'packages/node/zlib']);
        });

        await it('resolves node_modules workspace symlinks back to the source dir', () => {
            // The install layout: node_modules/@gjsify/zlib -> packages/node/zlib.
            const fs = fakeFs({
                packageDirs: {
                    '/repo': 'gjsify',
                    '/repo/packages/node/zlib': '@gjsify/zlib',
                },
                symlinks: { '/repo/node_modules/@gjsify/zlib': '/repo/packages/node/zlib' },
            });
            const packages = deriveInputPackages({
                moduleIds: ['/repo/node_modules/@gjsify/zlib/lib/esm/index.js'],
                workspaceRoot: ROOT,
                workspaces: WORKSPACES,
                fs,
            });
            expect(packages).toStrictEqual(['packages/node/zlib']);
        });

        await it('maps a COPIED (not symlinked) workspace install back via its package name', () => {
            const fs = fakeFs({
                packageDirs: {
                    '/repo': 'gjsify',
                    '/repo/node_modules/@gjsify/zlib': '@gjsify/zlib',
                },
            });
            const packages = deriveInputPackages({
                moduleIds: ['/repo/node_modules/@gjsify/zlib/lib/esm/index.js'],
                workspaceRoot: ROOT,
                workspaces: WORKSPACES,
                fs,
            });
            expect(packages).toStrictEqual(['packages/node/zlib']);
        });

        await it('excludes genuine third-party node_modules packages', () => {
            // yargs/acorn/… are inlined too, but their staleness signal is the
            // lockfile — a source-dir trigger for them would be meaningless.
            const fs = fakeFs({
                packageDirs: {
                    '/repo': 'gjsify',
                    '/repo/node_modules/yargs': 'yargs',
                },
            });
            const packages = deriveInputPackages({
                moduleIds: ['/repo/node_modules/yargs/build/index.js'],
                workspaceRoot: ROOT,
                workspaces: WORKSPACES,
                fs,
            });
            expect(packages).toStrictEqual([]);
        });

        await it('skips virtual modules, bare specifiers and out-of-repo files', () => {
            const fs = fakeFs({
                packageDirs: {
                    '/repo': 'gjsify',
                    '/elsewhere/pkg': 'other',
                },
            });
            const packages = deriveInputPackages({
                moduleIds: [
                    '\0gjsify-entry:/repo/packages/infra/cli/src/index.ts',
                    'gi://GLib?version=2.0',
                    '/elsewhere/pkg/index.js',
                ],
                workspaceRoot: ROOT,
                workspaces: WORKSPACES,
                fs,
            });
            expect(packages).toStrictEqual([]);
        });

        await it('never records the workspace root itself', () => {
            // Root-owned files (scripts/, root manifests) are global triggers
            // already — recording '' or '.' would only confuse the hook.
            const fs = fakeFs({ packageDirs: { '/repo': 'gjsify' } });
            const packages = deriveInputPackages({
                moduleIds: ['/repo/scripts/some-helper.mjs'],
                workspaceRoot: ROOT,
                workspaces: WORKSPACES,
                fs,
            });
            expect(packages).toStrictEqual([]);
        });

        await it('records an in-repo package dir the workspace enumeration does not know', () => {
            const fs = fakeFs({
                packageDirs: {
                    '/repo': 'gjsify',
                    '/repo/tools/extra': 'extra-tool',
                },
            });
            const packages = deriveInputPackages({
                moduleIds: ['/repo/tools/extra/lib/index.js'],
                workspaceRoot: ROOT,
                workspaces: WORKSPACES,
                fs,
            });
            expect(packages).toStrictEqual(['tools/extra']);
        });
    });

    await describe('bundle-inputs-manifest: collectChunkModuleIds', async () => {
        await it('unions moduleIds across chunks and ignores assets', () => {
            const ids = collectChunkModuleIds([
                { type: 'chunk', moduleIds: ['/a.js', '/b.js'] },
                { type: 'chunk', moduleIds: ['/b.js', '/c.js'] },
                { type: 'asset' },
            ]);
            expect([...ids].sort()).toStrictEqual(['/a.js', '/b.js', '/c.js']);
        });

        await it('tolerates chunks without a moduleIds field', () => {
            expect(collectChunkModuleIds([{ type: 'chunk' }]).size).toBe(0);
        });
    });

    await describe('bundle-inputs-manifest: assertModuleGraphReported', async () => {
        await it('throws on an empty module graph (the native-engine gap), naming the manifest', () => {
            // `@gjsify/rolldown-native` fills `moduleIds: []` in
            // synthRolldownOutput — an empty manifest would silently trigger
            // on NOTHING, which is worse than failing the build.
            expect(() => assertModuleGraphReported(new Set(), 'dist/cli.gjs.inputs.json')).toThrow(
                /reported NO module graph/,
            );
            expect(() => assertModuleGraphReported(new Set(), 'dist/cli.gjs.inputs.json')).toThrow(
                /dist\/cli\.gjs\.inputs\.json/,
            );
        });

        await it('accepts a reported graph', () => {
            expect(() => assertModuleGraphReported(new Set(['/a.js']), 'x')).not.toThrow();
        });
    });

    await describe('bundle-inputs-manifest: renderInputsManifest', async () => {
        await it('emits one array entry per line — the shape .githooks/pre-commit parses with sed', () => {
            const text = renderInputsManifest(['packages/gjs/utils', 'packages/node/zlib']);
            const lines = text.split('\n');
            expect(lines).toContain('    "packages": [');
            expect(lines).toContain('        "packages/gjs/utils",');
            expect(lines).toContain('        "packages/node/zlib"');
            // Deterministic: trailing newline, parseable, round-trips.
            expect(text.endsWith('\n')).toBeTruthy();
            const parsed = JSON.parse(text) as { packages: string[] };
            expect(parsed.packages).toStrictEqual(['packages/gjs/utils', 'packages/node/zlib']);
        });

        await it('renders an empty package list as a valid manifest', () => {
            const parsed = JSON.parse(renderInputsManifest([])) as { packages: string[] };
            expect(parsed.packages).toStrictEqual([]);
        });
    });
};
