// @gjsify/workspace specs — Yarn-workspaces-compatible discovery + graph.
//
// Test workspaces live under `node:fs.mkdtempSync` so the suite is fully
// hermetic. Each test builds a fresh fixture, validates the public API,
// then cleans up.

import { describe, it, expect } from '@gjsify/unit';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    discoverWorkspaces,
    resolveWorkspaceProtocol,
    buildDependencyGraph,
    buildReverseDependencyGraph,
    affectedClosure,
    workspacesForChangedFiles,
    topologicalSort,
    filterWorkspaces,
    type Workspace,
} from './index.js';

function makeFixture(layout: Record<string, Record<string, unknown>>): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-workspace-spec-'));
    for (const [relPath, manifest] of Object.entries(layout)) {
        const dir = join(root, relPath);
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest) + '\n');
    }
    return root;
}

export default async (): Promise<void> => {
    await describe('@gjsify/workspace', async () => {
        await describe('discoverWorkspaces', async () => {
            await it('expands `packages/*` glob + reads manifests', () => {
                const root = makeFixture({
                    '.': { name: 'root', version: '0.1.0', private: true, workspaces: ['packages/*'] },
                    'packages/a': { name: 'pkg-a', version: '1.0.0' },
                    'packages/b': { name: 'pkg-b', version: '2.0.0' },
                });
                try {
                    const ws = discoverWorkspaces(root);
                    expect(ws.length).toBe(2);
                    expect(ws.map((w) => w.name).sort()).toStrictEqual(['pkg-a', 'pkg-b']);
                    const a = ws.find((w) => w.name === 'pkg-a')!;
                    expect(a.version).toBe('1.0.0');
                    expect(a.relativeLocation).toBe('packages/a');
                } finally {
                    rmSync(root, { recursive: true, force: true });
                }
            });

            await it('handles `{ packages: [...] }` shape (yarn classic)', () => {
                const root = makeFixture({
                    '.': { name: 'root', private: true, workspaces: { packages: ['libs/*'] } },
                    'libs/x': { name: 'x', version: '0.0.1' },
                });
                try {
                    const ws = discoverWorkspaces(root);
                    expect(ws.length).toBe(1);
                    expect(ws[0]?.name).toBe('x');
                } finally {
                    rmSync(root, { recursive: true, force: true });
                }
            });

            await it('excludes dirs matched by a `!`-negation pattern', () => {
                const root = makeFixture({
                    '.': { name: 'root', private: true, workspaces: ['showcases/*', '!showcases/excluded'] },
                    'showcases/kept': { name: 'kept', version: '1.0.0' },
                    'showcases/excluded': { name: 'excluded', version: '1.0.0' },
                });
                try {
                    const ws = discoverWorkspaces(root);
                    expect(ws.map((w) => w.name).sort()).toStrictEqual(['kept']);
                } finally {
                    rmSync(root, { recursive: true, force: true });
                }
            });

            await it('skips dirs without package.json', () => {
                const root = makeFixture({
                    '.': { name: 'root', private: true, workspaces: ['packages/*'] },
                    'packages/with-manifest': { name: 'good', version: '0.1.0' },
                });
                // Add a sibling dir without a package.json.
                mkdirSync(join(root, 'packages', 'no-manifest'), { recursive: true });
                try {
                    const ws = discoverWorkspaces(root);
                    expect(ws.length).toBe(1);
                    expect(ws[0]?.name).toBe('good');
                } finally {
                    rmSync(root, { recursive: true, force: true });
                }
            });

            await it('flags `private: true` workspaces correctly', () => {
                const root = makeFixture({
                    '.': { name: 'root', private: true, workspaces: ['packages/*'] },
                    'packages/pub': { name: 'pub', version: '0.1.0' },
                    'packages/priv': { name: 'priv', version: '0.1.0', private: true },
                });
                try {
                    const ws = discoverWorkspaces(root);
                    const pub = ws.find((w) => w.name === 'pub')!;
                    const priv = ws.find((w) => w.name === 'priv')!;
                    expect(pub.private).toBeFalsy();
                    expect(priv.private).toBe(true);
                } finally {
                    rmSync(root, { recursive: true, force: true });
                }
            });

            await it('dedupes dirs matched by overlapping patterns', () => {
                // A glob plus an explicit entry for the same dir (a real config:
                // `["packages/*", "packages/app-android", "packages/app-web"]`).
                // Each overlapped dir must appear exactly once — duplicates flow
                // into double symlink plans that race to EEXIST in install.
                const root = makeFixture({
                    '.': {
                        name: 'root',
                        private: true,
                        workspaces: ['packages/*', 'packages/app-android', 'packages/app-web'],
                    },
                    'packages/core': { name: 'core', version: '1.0.0' },
                    'packages/app-android': { name: 'app-android', version: '1.0.0' },
                    'packages/app-web': { name: 'app-web', version: '1.0.0' },
                });
                try {
                    const ws = discoverWorkspaces(root);
                    expect(ws.map((w) => w.name).sort()).toStrictEqual(['app-android', 'app-web', 'core']);
                    expect(ws.length).toBe(3);
                } finally {
                    rmSync(root, { recursive: true, force: true });
                }
            });
        });

        await describe('resolveWorkspaceProtocol', async () => {
            const ws: Workspace[] = [makeWs('@gjsify/core', '1.2.3'), makeWs('@gjsify/util', '0.4.0')];

            await it('expands workspace:^ to caret-range', () => {
                expect(resolveWorkspaceProtocol('workspace:^', '@gjsify/core', ws)).toBe('^1.2.3');
            });

            await it('expands workspace:~ to tilde-range', () => {
                expect(resolveWorkspaceProtocol('workspace:~', '@gjsify/util', ws)).toBe('~0.4.0');
            });

            await it('expands workspace:* to exact version', () => {
                expect(resolveWorkspaceProtocol('workspace:*', '@gjsify/core', ws)).toBe('1.2.3');
            });

            await it('passes explicit ranges through', () => {
                expect(resolveWorkspaceProtocol('workspace:^1.0.0', '@gjsify/core', ws)).toBe('^1.0.0');
            });

            await it('returns undefined for non-workspace specs', () => {
                expect(resolveWorkspaceProtocol('^1.0.0', '@gjsify/core', ws)).toBeUndefined();
                expect(resolveWorkspaceProtocol('latest', '@gjsify/core', ws)).toBeUndefined();
            });

            await it('throws when the workspace does not exist locally', () => {
                expect(() => resolveWorkspaceProtocol('workspace:^', '@unknown/pkg', ws)).toThrow();
            });
        });

        await describe('buildDependencyGraph + topologicalSort', async () => {
            await it('only records inter-workspace edges (ignores external deps)', () => {
                const ws: Workspace[] = [
                    makeWs('a', '1.0.0', { dependencies: { b: 'workspace:^', lodash: '^4.0.0' } }),
                    makeWs('b', '1.0.0'),
                ];
                const g = buildDependencyGraph(ws);
                expect(g.edges.get('a')!.has('b')).toBe(true);
                expect(g.edges.get('a')!.has('lodash')).toBeFalsy();
                expect(g.edges.get('b')!.size).toBe(0);
            });

            await it('excludes devDependencies by default (yarn --topological)', () => {
                const ws: Workspace[] = [
                    makeWs('lib', '1.0.0', {
                        dependencies: { core: 'workspace:^' },
                        devDependencies: { tooling: 'workspace:^' },
                    }),
                    makeWs('core', '1.0.0'),
                    makeWs('tooling', '1.0.0'),
                ];
                const def = buildDependencyGraph(ws);
                expect(def.edges.get('lib')!.has('core')).toBe(true);
                expect(def.edges.get('lib')!.has('tooling')).toBeFalsy();
                const withDev = buildDependencyGraph(ws, { includeDev: true });
                expect(withDev.edges.get('lib')!.has('tooling')).toBe(true);
            });

            await it('topologicalSort puts dependencies BEFORE dependents', () => {
                const ws: Workspace[] = [
                    makeWs('app', '1.0.0', { dependencies: { lib: 'workspace:^', utils: 'workspace:^' } }),
                    makeWs('lib', '1.0.0', { dependencies: { utils: 'workspace:^' } }),
                    makeWs('utils', '1.0.0'),
                ];
                const g = buildDependencyGraph(ws);
                const sorted = topologicalSort(g);
                const order = sorted.map((w) => w.name);
                // `utils` must come before `lib` and `app`. `lib` must come before `app`.
                expect(order.indexOf('utils') < order.indexOf('lib')).toBe(true);
                expect(order.indexOf('lib') < order.indexOf('app')).toBe(true);
            });

            await it('throws on cycle', () => {
                const ws: Workspace[] = [
                    makeWs('a', '1.0.0', { dependencies: { b: 'workspace:^' } }),
                    makeWs('b', '1.0.0', { dependencies: { a: 'workspace:^' } }),
                ];
                const g = buildDependencyGraph(ws);
                expect(() => topologicalSort(g)).toThrow();
            });
        });

        await describe('filterWorkspaces', async () => {
            const ws: Workspace[] = [
                makeWs('@gjsify/cli', '0.3.0'),
                makeWs('@gjsify/example-foo', '0.1.0'),
                makeWs('@gjsify/example-bar', '0.1.0'),
                makeWs('@girs/glib-2.0', '0.0.0', undefined, /* private */ true),
            ];

            await it('--include glob picks matching workspaces', () => {
                const sel = filterWorkspaces(ws, { include: ['@gjsify/example-*'] });
                expect(sel.length).toBe(2);
            });

            await it('--exclude removes matching workspaces', () => {
                const sel = filterWorkspaces(ws, { exclude: ['@girs/*'] });
                expect(sel.length).toBe(3);
            });

            await it('--no-private drops private workspaces', () => {
                const sel = filterWorkspaces(ws, { noPrivate: true });
                expect(sel.find((w) => w.name === '@girs/glib-2.0')).toBeUndefined();
            });
        });

        await describe('buildReverseDependencyGraph', async () => {
            await it('inverts forward edges — `A → B` becomes `B → A`', () => {
                const ws: Workspace[] = [
                    makeWs('@gjsify/a', '1.0.0', {
                        dependencies: { '@gjsify/b': 'workspace:*' },
                    }),
                    makeWs('@gjsify/b', '1.0.0'),
                ];
                const reverse = buildReverseDependencyGraph(ws);
                expect(reverse.edges.get('@gjsify/b')?.has('@gjsify/a')).toBeTruthy();
                expect(reverse.edges.get('@gjsify/a')?.size).toBe(0);
            });

            await it('every workspace appears as a key, even with no dependents', () => {
                const ws: Workspace[] = [makeWs('@gjsify/lonely', '1.0.0')];
                const reverse = buildReverseDependencyGraph(ws);
                expect(reverse.edges.has('@gjsify/lonely')).toBeTruthy();
                expect(reverse.edges.get('@gjsify/lonely')?.size).toBe(0);
            });
        });

        await describe('affectedClosure', async () => {
            // Diamond: A → B, A → C, B → D, C → D. A change in D
            // should mark D, B, C, AND A as affected.
            const ws: Workspace[] = [
                makeWs('@gjsify/a', '1.0.0', {
                    dependencies: { '@gjsify/b': 'workspace:*', '@gjsify/c': 'workspace:*' },
                }),
                makeWs('@gjsify/b', '1.0.0', {
                    dependencies: { '@gjsify/d': 'workspace:*' },
                }),
                makeWs('@gjsify/c', '1.0.0', {
                    dependencies: { '@gjsify/d': 'workspace:*' },
                }),
                makeWs('@gjsify/d', '1.0.0'),
            ];
            const reverse = buildReverseDependencyGraph(ws);

            await it('seeds-only when no dependents', () => {
                const closure = affectedClosure(reverse, ['@gjsify/a']);
                expect(closure.size).toBe(1);
                expect(closure.has('@gjsify/a')).toBeTruthy();
            });

            await it('walks transitive dependents through a diamond', () => {
                const closure = affectedClosure(reverse, ['@gjsify/d']);
                expect(closure.size).toBe(4);
                for (const name of ['@gjsify/a', '@gjsify/b', '@gjsify/c', '@gjsify/d']) {
                    expect(closure.has(name)).toBeTruthy();
                }
            });

            await it('idempotent on duplicate seeds', () => {
                const a = affectedClosure(reverse, ['@gjsify/b', '@gjsify/b', '@gjsify/b']);
                const b = affectedClosure(reverse, ['@gjsify/b']);
                expect(a.size).toBe(b.size);
                for (const n of a) expect(b.has(n)).toBeTruthy();
            });

            await it('unknown seed names are silently skipped (conservative)', () => {
                const closure = affectedClosure(reverse, ['@gjsify/ghost', '@gjsify/d']);
                expect(closure.size).toBe(4);
                expect(closure.has('@gjsify/ghost')).toBeFalsy();
            });

            await it('seeds = [] returns empty', () => {
                expect(affectedClosure(reverse, []).size).toBe(0);
            });
        });

        await describe('workspacesForChangedFiles', async () => {
            const ws: Workspace[] = [
                {
                    location: '/abs/packages/node/fs',
                    relativeLocation: 'packages/node/fs',
                    name: '@gjsify/fs',
                    version: '0.0.0',
                    private: false,
                    manifest: { name: '@gjsify/fs', version: '0.0.0' },
                },
                {
                    location: '/abs/packages/node/fs-promises',
                    relativeLocation: 'packages/node/fs-promises',
                    name: '@gjsify/fs-promises',
                    version: '0.0.0',
                    private: false,
                    manifest: { name: '@gjsify/fs-promises', version: '0.0.0' },
                },
                {
                    location: '/abs/tests/integration/loro-crdt',
                    relativeLocation: 'tests/integration/loro-crdt',
                    name: '@gjsify/integration-loro-crdt',
                    version: '0.0.0',
                    private: true,
                    manifest: { name: '@gjsify/integration-loro-crdt', version: '0.0.0' },
                },
            ];

            await it('matches segment-aware, not prefix-of-string', () => {
                // fs-promises is a prefix-of-string match for fs but
                // belongs to its own workspace.
                const r = workspacesForChangedFiles(ws, '/abs', [
                    'packages/node/fs-promises/src/x.ts',
                    'packages/node/fs/src/y.ts',
                ]);
                expect(r.matched.size).toBe(2);
                expect(r.matched.has('@gjsify/fs-promises')).toBeTruthy();
                expect(r.matched.has('@gjsify/fs')).toBeTruthy();
            });

            await it('unmatched files surface for caller-side classification', () => {
                const r = workspacesForChangedFiles(ws, '/abs', ['README.md', 'scripts/audit-runtimes.mjs']);
                expect(r.matched.size).toBe(0);
                expect(r.unmatched.length).toBe(2);
            });

            await it('multiple files in one workspace coalesce', () => {
                const r = workspacesForChangedFiles(ws, '/abs', [
                    'packages/node/fs/src/a.ts',
                    'packages/node/fs/src/b.ts',
                    'packages/node/fs/package.json',
                ]);
                expect(r.matched.size).toBe(1);
                expect(r.matched.has('@gjsify/fs')).toBeTruthy();
            });

            await it('handles backslashes (Windows-style diff)', () => {
                const r = workspacesForChangedFiles(ws, '/abs', ['packages\\node\\fs\\src\\index.ts']);
                expect(r.matched.has('@gjsify/fs')).toBeTruthy();
            });

            await it('empty input → empty output', () => {
                const r = workspacesForChangedFiles(ws, '/abs', []);
                expect(r.matched.size).toBe(0);
                expect(r.unmatched.length).toBe(0);
            });
        });
    });
};

function makeWs(name: string, version: string, manifest: Partial<Workspace['manifest']> = {}, priv = false): Workspace {
    return {
        location: `/tmp/synthetic/${name}`,
        relativeLocation: name,
        name,
        version,
        private: priv,
        manifest: { name, version, ...manifest },
    };
}
