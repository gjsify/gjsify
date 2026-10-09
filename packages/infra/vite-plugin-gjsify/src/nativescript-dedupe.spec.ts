import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { installedGjsifyPackages } from './nativescript-dedupe.js';

const withTmp = (fn: (root: string) => void): void => {
    const root = mkdtempSync(join(tmpdir(), 'gjsify-dedupe-'));
    try {
        fn(root);
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
};

export default async () => {
    await describe('installedGjsifyPackages', async () => {
        await it('lists the @gjsify packages in the root node_modules, sorted, without dotfiles', () => {
            withTmp((root) => {
                for (const name of ['gtksource-core', 'adwaita-core', '.bin']) {
                    mkdirSync(join(root, 'node_modules', '@gjsify', name), { recursive: true });
                }
                expect(installedGjsifyPackages(root).join()).toBe('@gjsify/adwaita-core,@gjsify/gtksource-core');
            });
        });

        await it('finds the hoisted workspace root from an app dir without node_modules', () => {
            withTmp((root) => {
                mkdirSync(join(root, 'node_modules', '@gjsify', 'adwaita-core'), { recursive: true });
                const app = join(root, 'packages', 'app');
                mkdirSync(app, { recursive: true });
                expect(installedGjsifyPackages(app).join()).toBe('@gjsify/adwaita-core');
            });
        });

        await it('merges a partly populated app level with the workspace root', () => {
            withTmp((root) => {
                mkdirSync(join(root, 'node_modules', '@gjsify', 'adwaita-core'), { recursive: true });
                const app = join(root, 'packages', 'app');
                mkdirSync(join(app, 'node_modules', '@gjsify', 'cli'), { recursive: true });
                expect(installedGjsifyPackages(app).join()).toBe('@gjsify/adwaita-core,@gjsify/cli');
            });
        });

        await it('does not invent packages when no level has a @gjsify scope', () => {
            withTmp((root) => {
                // Ancestors of the temp dir are outside our control, so assert on names only we could add.
                expect(installedGjsifyPackages(root).includes('@gjsify/adwaita-core')).toBe(false);
            });
        });
    });
};
