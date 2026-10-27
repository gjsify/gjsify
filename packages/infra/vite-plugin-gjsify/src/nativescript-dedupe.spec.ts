import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
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

        await it('lists workspace-linked packages, scoped and unscoped, but not regular installs', () => {
            withTmp((root) => {
                const modules = join(root, 'node_modules');
                mkdirSync(join(root, 'packages', 'common-ui'), { recursive: true });
                mkdirSync(join(root, 'packages', 'tool'), { recursive: true });
                mkdirSync(join(modules, '@learn6502'), { recursive: true });
                symlinkSync(join(root, 'packages', 'common-ui'), join(modules, '@learn6502', 'common-ui'), 'dir');
                symlinkSync(join(root, 'packages', 'tool'), join(modules, 'tool'), 'dir');
                mkdirSync(join(modules, '@types', 'node'), { recursive: true });
                mkdirSync(join(modules, 'lodash'), { recursive: true });
                expect(installedGjsifyPackages(root).join()).toBe('@learn6502/common-ui,tool');
            });
        });

        await it('does not list a link that points into another node_modules', () => {
            withTmp((root) => {
                mkdirSync(join(root, 'store', 'node_modules', 'dep'), { recursive: true });
                mkdirSync(join(root, 'node_modules'), { recursive: true });
                symlinkSync(join(root, 'store', 'node_modules', 'dep'), join(root, 'node_modules', 'dep'), 'dir');
                expect(installedGjsifyPackages(root).includes('dep')).toBe(false);
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
