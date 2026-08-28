// SPDX-License-Identifier: MIT
// Package-set discovery for `gjsify onboard` — the tests that decide whether the
// command is usable outside this repo.
//
// The two failures worth pinning are both SILENT ones. A monorepo with no root
// `package.json` used to make discovery THROW before it enumerated anything, and
// a `--packages` glob with a typo would enumerate an empty set that reads
// exactly like "there is nothing left to do". Neither is visible in a summary
// that prints a total, so both are asserted here as behaviour, not as messages.

import { describe, it, expect } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    assertEveryPatternMatches,
    collectOnboardPackages,
    describeSources,
    resolveRepoRoot,
} from './onboard-discovery.js';

/** Write `<root>/<dir>/package.json`. */
function pkg(root: string, dir: string, manifest: Record<string, unknown>): void {
    mkdirSync(join(root, dir), { recursive: true });
    writeFileSync(join(root, dir, 'package.json'), JSON.stringify(manifest, null, 2));
}

function fixtureRoot(): string {
    return mkdtempSync(join(tmpdir(), 'gjsify-onboard-discovery-'));
}

export default async () => {
    await describe('collectOnboardPackages — workspace monorepo', async () => {
        await it('enumerates the root manifest workspaces globs', () => {
            const root = fixtureRoot();
            try {
                writeFileSync(
                    join(root, 'package.json'),
                    JSON.stringify({ name: '@acme/root', private: true, workspaces: ['packages/*'] }),
                );
                pkg(root, 'packages/a', { name: '@acme/a', version: '1.0.0' });
                pkg(root, 'packages/b', { name: '@acme/b', version: '1.0.0' });

                const found = collectOnboardPackages(root, root);
                const names = found.packages.map((w) => w.name).sort();
                expect(names).toStrictEqual(['@acme/a', '@acme/b', '@acme/root']);
                expect(found.sources.find((s) => s.kind === 'workspaces')?.count).toBe(3);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('collectOnboardPackages — monorepo with NO root manifest', async () => {
        // `gjsify/types`: 703 package directories at the top level, and a root
        // whose only tracked file is `.gitignore`. This is the shape the command
        // could not see at all before — `discoverWorkspaces` threw on the missing
        // root package.json, so the sweep never got as far as an empty list.
        await it('enumerates directory globs with no workspace manifest present', () => {
            const root = fixtureRoot();
            try {
                pkg(root, 'gtk-4.0', { name: '@girs/gtk-4.0', version: '4.2.0' });
                pkg(root, 'adw-1', { name: '@girs/adw-1', version: '4.2.0' });
                pkg(root, 'gio-2.0', { name: '@girs/gio-2.0', version: '4.2.0' });

                const found = collectOnboardPackages(root, root, { patterns: ['*'] });
                expect(found.packages.map((w) => w.name).sort()).toStrictEqual([
                    '@girs/adw-1',
                    '@girs/gio-2.0',
                    '@girs/gtk-4.0',
                ]);
                expect(found.sources.find((s) => s.kind === 'packages')?.count).toBe(3);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('reports the glob it used, so the blast radius is legible', () => {
            const root = fixtureRoot();
            try {
                pkg(root, 'one', { name: '@acme/one', version: '1.0.0' });
                const found = collectOnboardPackages(root, root, { patterns: ['*'] });
                expect(describeSources(found.sources)).toBe('packages(*)=1');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('collectOnboardPackages — precedence + dedupe', async () => {
        await it('keeps the workspace entry when a glob matches the same package', () => {
            const root = fixtureRoot();
            try {
                writeFileSync(
                    join(root, 'package.json'),
                    JSON.stringify({ name: '@acme/root', private: true, workspaces: ['packages/*'] }),
                );
                pkg(root, 'packages/a', { name: '@acme/a', version: '1.0.0' });

                const found = collectOnboardPackages(root, root, { patterns: ['packages/*'] });
                expect(found.packages.filter((w) => w.name === '@acme/a').length).toBe(1);
                // The workspace source claimed it; the glob adds nothing on top.
                expect(found.sources.find((s) => s.kind === 'packages')?.count).toBe(0);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('skips a matched directory whose manifest has no name', () => {
            const root = fixtureRoot();
            try {
                pkg(root, 'named', { name: '@acme/named', version: '1.0.0' });
                pkg(root, 'nameless', { version: '1.0.0' });
                const found = collectOnboardPackages(root, root, { patterns: ['*'] });
                expect(found.packages.map((w) => w.name)).toStrictEqual(['@acme/named']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('assertEveryPatternMatches', async () => {
        await it('accepts a glob that matches at least one package directory', () => {
            const root = fixtureRoot();
            try {
                pkg(root, 'gtk-4.0', { name: '@girs/gtk-4.0', version: '4.2.0' });
                assertEveryPatternMatches(root, ['*']);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('THROWS on a glob that matches nothing — an empty sweep is never an intent', () => {
            const root = fixtureRoot();
            try {
                pkg(root, 'gtk-4.0', { name: '@girs/gtk-4.0', version: '4.2.0' });
                let threw: Error | undefined;
                try {
                    assertEveryPatternMatches(root, ['*', 'packages/*']);
                } catch (err) {
                    threw = err as Error;
                }
                expect(threw !== undefined).toBe(true);
                // It must NAME the pattern — "0 packages" alone sends people
                // hunting in the registry instead of in their own quoting.
                expect((threw?.message ?? '').includes('"packages/*"')).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('THROWS on a directory that exists but holds no package.json', () => {
            const root = fixtureRoot();
            try {
                mkdirSync(join(root, 'docs'), { recursive: true });
                let threw = false;
                try {
                    assertEveryPatternMatches(root, ['docs']);
                } catch {
                    threw = true;
                }
                expect(threw).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });

    await describe('resolveRepoRoot', async () => {
        await it('falls back to the cwd when there is neither a workspace root nor a git tree', () => {
            const root = fixtureRoot();
            try {
                // A bare temp dir has no `workspaces` manifest above it; whether a
                // git top level exists depends on where TMPDIR points, so assert
                // only the invariant that holds either way: a real directory that
                // CONTAINS the cwd.
                const resolved = resolveRepoRoot(root);
                expect(typeof resolved).toBe('string');
                expect(root.startsWith(resolved) || resolved === root).toBe(true);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
