// SPDX-License-Identifier: MIT
// Which licence text ends up in the package, and — the half that matters —
// which one deliberately does NOT.
//
// The defect these cases were written for: `packages/infra/cli` declares
// `"license": "MIT"` and carries no `LICENSE`, because the text lives one
// monorepo root above it. Discovery looked in the project directory only, found
// nothing, and every `.deb` gjsify built for itself shipped without the
// `/usr/share/doc/<pkg>/copyright` Debian Policy § 12.5 requires. Nothing on the
// way there objected — `dpkg-deb --info` prints a clean control file and
// `dpkg -i` installs the package.
//
// Real directory trees rather than a mocked fs: what is under test is what a
// layout MEANS ("is this still my project?"), and a mock would only re-assert
// the assumption being checked.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { discoverPayload } from './discover.js';
import type { ConfigDataShip } from '../../types/config-data.js';

/** A tree whose leaf is the project: `<root>/packages/app`, with a built bundle. */
function tree(build: (root: string, projectDir: string) => void): { root: string; projectDir: string } {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-ship-licence-'));
    const projectDir = join(root, 'packages', 'app');
    mkdirSync(join(projectDir, 'dist'), { recursive: true });
    writeFileSync(join(projectDir, 'dist', 'app.gjs.mjs'), '// bundle\n');
    build(root, projectDir);
    return { root, projectDir };
}

function licenseOf(projectDir: string, ship: Partial<ConfigDataShip> = {}): string | undefined {
    return discoverPayload({
        projectDir,
        pkg: { name: 'app', version: '1.0.0' },
        ship: ship as ConfigDataShip,
        declaredBundle: 'dist/app.gjs.mjs',
    }).licenseFile;
}

export default async () => {
    await describe('discoverLicense', async () => {
        await it('prefers the project’s own licence over the one above it', async () => {
            const { root, projectDir } = tree((r, p) => {
                writeFileSync(join(r, '.git'), 'gitdir: elsewhere\n');
                writeFileSync(join(r, 'LICENSE'), 'root\n');
                writeFileSync(join(p, 'LICENSE'), 'mine\n');
            });
            expect(licenseOf(projectDir)).toBe(join(projectDir, 'LICENSE'));
            rmSync(root, { recursive: true, force: true });
        });

        // The gjsify case exactly: one LICENSE at the repository root, sixty-odd
        // packages under it, none carrying a copy.
        await it('climbs to the repository root when the package carries none', async () => {
            const { root, projectDir } = tree((r) => {
                // A FILE, not a directory: that is what `.git` is in a git worktree,
                // and this repository is developed in worktrees.
                writeFileSync(join(r, '.git'), 'gitdir: elsewhere\n');
                writeFileSync(join(r, 'LICENSE'), 'root\n');
            });
            expect(licenseOf(projectDir)).toBe(join(root, 'LICENSE'));
            rmSync(root, { recursive: true, force: true });
        });

        await it('accepts a workspace root as the top of the climb', async () => {
            const { root, projectDir } = tree((r) => {
                writeFileSync(join(r, 'package.json'), JSON.stringify({ workspaces: ['packages/*'] }));
                writeFileSync(join(r, 'COPYING'), 'root\n');
            });
            expect(licenseOf(projectDir)).toBe(join(root, 'COPYING'));
            rmSync(root, { recursive: true, force: true });
        });

        // The reason the climb is bounded at all. Without the stop this would walk
        // into the tmpdir’s parents and package whatever licence it met — a specific
        // false legal claim, made silently.
        await it('does not take a licence from ABOVE the project root', async () => {
            const { root, projectDir } = tree((r) => {
                writeFileSync(join(r, 'LICENSE'), 'not yours\n');
                writeFileSync(join(r, 'packages', '.git'), 'gitdir: elsewhere\n');
            });
            expect(licenseOf(projectDir)).toBe(undefined);
            rmSync(root, { recursive: true, force: true });
        });

        // No marker anywhere means there is no way to tell where the project ends,
        // and a guess is the same false claim as crossing a known boundary.
        await it('searches the project directory alone when no root marker exists', async () => {
            const { root, projectDir } = tree((r) => {
                writeFileSync(join(r, 'LICENSE'), 'ambient\n');
            });
            expect(licenseOf(projectDir)).toBe(undefined);
            rmSync(root, { recursive: true, force: true });
        });

        await it('lets `gjsify.ship.licenseFile` name a path the climb would never reach', async () => {
            const { root, projectDir } = tree((r, p) => {
                writeFileSync(join(r, '.git'), 'gitdir: elsewhere\n');
                mkdirSync(join(p, 'legal'), { recursive: true });
                writeFileSync(join(p, 'legal', 'terms.txt'), 'bespoke\n');
            });
            expect(licenseOf(projectDir, { licenseFile: 'legal/terms.txt' })).toBe(
                join(projectDir, 'legal', 'terms.txt'),
            );
            rmSync(root, { recursive: true, force: true });
        });

        // A malformed `package.json` in some ancestor is not this command’s business.
        // Before the guard, `JSON.parse` threw out of a licence search and `gjsify
        // ship` failed on a file it has no reason to read.
        await it('walks past an ancestor whose package.json is unparseable', async () => {
            const { root, projectDir } = tree((r) => {
                writeFileSync(join(r, 'packages', 'package.json'), '{ not json');
                writeFileSync(join(r, '.git'), 'gitdir: elsewhere\n');
                writeFileSync(join(r, 'LICENSE'), 'root\n');
            });
            expect(licenseOf(projectDir)).toBe(join(root, 'LICENSE'));
            rmSync(root, { recursive: true, force: true });
        });
    });
};
