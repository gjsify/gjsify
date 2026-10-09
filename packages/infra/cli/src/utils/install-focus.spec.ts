// `--focus` (ADR 0102) on three layers: the manifest planner, the lockfile walk, and
// the two real entry points — `installPackagesNative` and `focusedTarballs` — against a
// fixture monorepo whose `app` workspace does not need the `toolchain` package that
// `tool` (and the root) do. Offline: the focused tree is pre-extracted, the toolchain
// node is not and its URL is unreachable, so any attempt to fetch it fails the row.

import { describe, expect, it } from '@gjsify/unit';
import { discoverWorkspaces } from '@gjsify/workspace';
import { existsSync, readFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { focusedTarballs } from '../commands/flatpak/sources.js';
import { installPackagesNative, readLockfileNodes, reachableInstallPaths } from './install-backend-native.js';
import { planFocus } from './install-focus.js';
import { makeProgressReporter } from './install-progress.js';

const QUIET = makeProgressReporter({ enabled: false });
const SPECS = ['dep-a@^1.0.0', 'toolchain@^2.0.0'];

function writeJson(path: string, value: unknown): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value, null, 2));
}

function entry(name: string, extra: Record<string, unknown> = {}) {
    const hex = Buffer.from(name).toString('hex').padEnd(128, '0');
    return {
        version: name === 'toolchain' ? '2.0.0' : '1.0.0',
        resolved: `https://example.invalid/${name}.tgz`,
        integrity: `sha512-${Buffer.from(hex, 'hex').toString('base64')}`,
        ...extra,
    };
}

/** root (toolchain) · app (dep-a → dep-c, lib) · lib · tool (toolchain). */
function makeMonorepo(): string {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-focus-'));
    writeJson(join(root, 'package.json'), {
        name: 'fx-root',
        private: true,
        workspaces: ['packages/*'],
        devDependencies: { toolchain: '^2.0.0' },
    });
    writeJson(join(root, 'packages/app/package.json'), {
        name: '@fx/app',
        version: '1.0.0',
        dependencies: { 'dep-a': '^1.0.0', '@fx/lib': '^1.0.0' },
    });
    writeJson(join(root, 'packages/lib/package.json'), { name: '@fx/lib', version: '1.0.0' });
    writeJson(join(root, 'packages/tool/package.json'), {
        name: '@fx/tool',
        version: '1.0.0',
        devDependencies: { toolchain: '^2.0.0' },
    });
    writeJson(join(root, 'gjsify-lock.json'), {
        lockfileVersion: 4,
        requested: SPECS,
        packages: {
            'node_modules/dep-a': entry('dep-a', { dependencies: { 'dep-c': '^1.0.0' } }),
            'node_modules/dep-c': entry('dep-c'),
            'node_modules/toolchain': entry('toolchain'),
        },
    });
    for (const name of ['dep-a', 'dep-c']) {
        writeJson(join(root, 'node_modules', name, 'package.json'), { name, version: '1.0.0' });
    }
    return root;
}

async function messageOf(run: () => Promise<unknown> | unknown): Promise<string> {
    try {
        await run();
        return '<no error>';
    } catch (err) {
        return err instanceof Error ? err.message : String(err);
    }
}

export default async () => {
    await describe('planFocus', async () => {
        const root = makeMonorepo();
        const workspaces = discoverWorkspaces(root, { includeRoot: true });
        try {
            await it('takes the named workspace, its workspace deps and their externals', async () => {
                const plan = planFocus(workspaces, ['@fx/app'], 'gjsify install');
                expect(
                    plan.workspaces
                        .map((w) => w.name)
                        .sort()
                        .join(','),
                ).toBe('@fx/app,@fx/lib');
                expect(plan.specs.join(',')).toBe('dep-a@^1.0.0');
            });

            await it('does not make the root implicit', async () => {
                const plan = planFocus(workspaces, ['@fx/app'], 'gjsify install');
                expect(plan.workspaces.some((w) => w.name === 'fx-root')).toBe(false);
                expect(plan.specs.includes('toolchain@^2.0.0')).toBe(false);
            });

            await it('includes the toolchain when the workspace that needs it is named', async () => {
                const plan = planFocus(workspaces, ['@fx/tool'], 'gjsify install');
                expect(plan.specs.join(',')).toBe('toolchain@^2.0.0');
            });

            await it('throws naming every unknown workspace', async () => {
                const message = await messageOf(() => planFocus(workspaces, ['@fx/app', '@fx/nope'], 'gjsify install'));
                expect(message).toContain('@fx/nope');
                expect(message).toContain('gjsify install');
            });
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    await describe('reachableInstallPaths', async () => {
        await it('follows lockfile edges and leaves the toolchain out', async () => {
            const root = makeMonorepo();
            try {
                const nodes = readLockfileNodes(join(root, 'gjsify-lock.json'))!;
                const reached = reachableInstallPaths(nodes, ['dep-a']);
                expect([...reached].sort().join(',')).toBe('node_modules/dep-a,node_modules/dep-c');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('installPackagesNative with focusSpecs', async () => {
        await it('installs the closure offline and never places the toolchain', async () => {
            const root = makeMonorepo();
            try {
                const out = await installPackagesNative({
                    prefix: root,
                    specs: SPECS,
                    focusSpecs: ['dep-a@^1.0.0'],
                    lockfile: false,
                    progress: QUIET,
                });
                expect(out.some((o) => o.name === 'dep-a')).toBe(true);
                expect(existsSync(join(root, 'node_modules/toolchain'))).toBe(false);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('works together with --immutable against the complete lockfile', async () => {
            const root = makeMonorepo();
            try {
                const before = readFileText(join(root, 'gjsify-lock.json'));
                await installPackagesNative({
                    prefix: root,
                    specs: SPECS,
                    focusSpecs: ['dep-a@^1.0.0'],
                    frozen: true,
                    lockfile: true,
                    progress: QUIET,
                });
                expect(readFileText(join(root, 'gjsify-lock.json'))).toBe(before);
                expect(existsSync(join(root, 'node_modules/toolchain'))).toBe(false);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('throws instead of resolving when there is no lockfile', async () => {
            const root = makeMonorepo();
            try {
                rmSync(join(root, 'gjsify-lock.json'));
                const message = await messageOf(() =>
                    installPackagesNative({
                        prefix: root,
                        specs: SPECS,
                        focusSpecs: ['dep-a@^1.0.0'],
                        lockfile: false,
                        progress: QUIET,
                    }),
                );
                expect(message).toContain('--focus');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('throws when the lockfile is stale', async () => {
            const root = makeMonorepo();
            try {
                const message = await messageOf(() =>
                    installPackagesNative({
                        prefix: root,
                        specs: [...SPECS, 'newcomer@^1.0.0'],
                        focusSpecs: ['dep-a@^1.0.0'],
                        lockfile: false,
                        progress: QUIET,
                    }),
                );
                expect(message).toContain('--focus');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('flatpak sources focusedTarballs', async () => {
        await it('lists the closure and not the toolchain', async () => {
            const root = makeMonorepo();
            try {
                const lock = join(root, 'gjsify-lock.json');
                const urls = focusedTarballs(lock, ['@fx/app'])
                    .map((t) => t.url)
                    .sort();
                expect(urls.join(',')).toBe('https://example.invalid/dep-a.tgz,https://example.invalid/dep-c.tgz');
                const withTool = focusedTarballs(lock, ['@fx/app', '@fx/tool']).map((t) => t.url);
                expect(withTool.includes('https://example.invalid/toolchain.tgz')).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('throws naming an unknown workspace', async () => {
            const root = makeMonorepo();
            try {
                const message = await messageOf(() => focusedTarballs(join(root, 'gjsify-lock.json'), ['@fx/nope']));
                expect(message).toContain('@fx/nope');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};

function readFileText(path: string): string {
    return readFileSync(path, 'utf-8');
}
