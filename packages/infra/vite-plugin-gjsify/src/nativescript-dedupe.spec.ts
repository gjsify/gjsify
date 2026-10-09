import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installedGjsifyPackages } from './nativescript-dedupe.js';

export default async () => {
    await describe('installedGjsifyPackages', async () => {
        await it('lists the @gjsify packages in the root node_modules, sorted, without dotfiles', () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-dedupe-'));
            try {
                for (const name of ['gtksource-core', 'adwaita-core', '.bin']) {
                    mkdirSync(join(root, 'node_modules', '@gjsify', name), { recursive: true });
                }
                expect(installedGjsifyPackages(root).join()).toBe('@gjsify/adwaita-core,@gjsify/gtksource-core');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('returns nothing when the project has no @gjsify scope', () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-dedupe-'));
            try {
                expect(installedGjsifyPackages(root).length).toBe(0);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
