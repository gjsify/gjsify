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
                } finally { rmSync(root, { recursive: true, force: true }); }
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
                } finally { rmSync(root, { recursive: true, force: true }); }
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
                } finally { rmSync(root, { recursive: true, force: true }); }
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
                } finally { rmSync(root, { recursive: true, force: true }); }
            });
        });

        await describe('resolveWorkspaceProtocol', async () => {
            const ws: Workspace[] = [
                makeWs('@gjsify/core', '1.2.3'),
                makeWs('@gjsify/util', '0.4.0'),
            ];

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
                    makeWs('lib', '1.0.0', { dependencies: { core: 'workspace:^' }, devDependencies: { tooling: 'workspace:^' } }),
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
    });
};

function makeWs(
    name: string,
    version: string,
    manifest: Partial<Workspace['manifest']> = {},
    priv = false,
): Workspace {
    return {
        location: `/tmp/synthetic/${name}`,
        relativeLocation: name,
        name,
        version,
        private: priv,
        manifest: { name, version, ...manifest },
    };
}
