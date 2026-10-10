// SPDX-License-Identifier: MIT
// `gjsify install` warns about CLI version skew against the version the workspace
// DECLARES in package.json — never the one in node_modules. `install` is what
// replaces a stale node_modules, so reading the installed copy warned about the
// exact state it was about to repair (pin 0.58.0, installed 0.56.0, CLI 0.58.0).

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readWorkspaceCliVersion } from './install.js';

function makeWorkspace(declared: string | null, installed?: string): string {
    const dir = mkdtempSync(join(tmpdir(), 'gjsify-skew-'));
    writeFileSync(
        join(dir, 'package.json'),
        JSON.stringify(
            declared ? { name: 'consumer', devDependencies: { '@gjsify/cli': declared } } : { name: 'consumer' },
        ),
    );
    if (installed) {
        const cliDir = join(dir, 'node_modules', '@gjsify', 'cli');
        mkdirSync(cliDir, { recursive: true });
        writeFileSync(join(cliDir, 'package.json'), JSON.stringify({ name: '@gjsify/cli', version: installed }));
    }
    return dir;
}

export default async () => {
    await describe('readWorkspaceCliVersion', async () => {
        await it('reads the declared pin, not the stale installed copy', async () => {
            const dir = makeWorkspace('0.58.0', '0.56.0');
            try {
                expect(readWorkspaceCliVersion(dir)).toBe('0.58.0');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('strips a caret prefix', async () => {
            const dir = makeWorkspace('^0.58.0', '0.56.0');
            try {
                expect(readWorkspaceCliVersion(dir)).toBe('0.58.0');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('falls back to the installed copy when nothing is declared', async () => {
            const dir = makeWorkspace(null, '0.56.0');
            try {
                expect(readWorkspaceCliVersion(dir)).toBe('0.56.0');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('does not fall back to node_modules for a non-version spec', async () => {
            const dir = makeWorkspace('latest', '0.56.0');
            try {
                expect(readWorkspaceCliVersion(dir)).toBe(null);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
