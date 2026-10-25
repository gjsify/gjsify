// SPDX-License-Identifier: MIT
// `gjsify.ship.nodeModules`: a package and what it needs, staged where it is installed.
//
// Every fixture is a throwaway project with its own `node_modules`, for the reason
// `app-runtime.spec.ts` gives: a test run inside this monorepo cannot tell "the closure is
// resolved" from "the files happened to be sitting next to it".

import { describe, expect, it } from '@gjsify/unit';
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { resolveNodeModulesClosure, stageNodeModules } from './node-modules.js';

function project(): string {
    return mkdtempSync(join(tmpdir(), 'gjsify-node-modules-'));
}

/** Install a fake package at `<root>/node_modules/<path>` (path may nest `node_modules`). */
function install(
    root: string,
    path: string,
    manifest: Record<string, unknown>,
    files: Record<string, string> = {},
): string {
    const dir = join(root, 'node_modules', ...path.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ version: '1.0.0', ...manifest }));
    for (const [rel, text] of Object.entries(files)) {
        mkdirSync(join(dir, rel, '..'), { recursive: true });
        writeFileSync(join(dir, rel), text);
    }
    return dir;
}

export default async () => {
    await describe('resolveNodeModulesClosure', async () => {
        await it('walks dependencies and optionalDependencies and keeps the installed layout', async () => {
            const root = project();
            install(root, 'addon', {
                name: 'addon',
                dependencies: { helper: '^1' },
                optionalDependencies: { '@addon/darwin-arm64': '1.0.0', '@addon/linux-x64': '1.0.0' },
            });
            install(root, 'helper', { name: 'helper', version: '1.2.0' });
            install(root, '@addon/darwin-arm64', { name: '@addon/darwin-arm64' });
            // A nested copy of `helper`, as npm leaves it when two ranges disagree.
            install(root, 'addon/node_modules/helper', { name: 'helper', version: '2.0.0' });

            const closure = resolveNodeModulesClosure(['addon'], root);
            expect(closure.packages.map((p) => p.dest)).toStrictEqual([
                '@addon/darwin-arm64',
                'addon',
                'addon/node_modules/helper',
            ]);
            expect(closure.packages.find((p) => p.dest === 'addon/node_modules/helper')?.version).toBe('2.0.0');
            expect(closure.skippedOptional).toStrictEqual(['@addon/linux-x64']);
        });

        await it('refuses a declared name that is not installed', async () => {
            const root = project();
            let message = '';
            try {
                resolveNodeModulesClosure(['nothing-here'], root);
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('`nothing-here` is not installed');
            expect(message).toContain('gjsify.ship.nodeModules');
        });

        await it('refuses a required dependency that is missing, naming the chain', async () => {
            const root = project();
            install(root, 'addon', { name: 'addon', dependencies: { helper: '^1' } });
            let message = '';
            try {
                resolveNodeModulesClosure(['addon'], root);
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message).toContain('`helper` is not installed');
            expect(message).toContain('needed by addon');
        });

        await it('leaves @gjsify/node-gi to the carried runtime', async () => {
            const root = project();
            install(root, 'addon', { name: 'addon', dependencies: { '@gjsify/node-gi': '*' } });
            const closure = resolveNodeModulesClosure(['addon'], root);
            expect(closure.packages.map((p) => p.dest)).toStrictEqual(['addon']);
        });

        await it('survives a dependency cycle', async () => {
            const root = project();
            install(root, 'a', { name: 'a', dependencies: { b: '*' } });
            install(root, 'b', { name: 'b', dependencies: { a: '*' } });
            expect(resolveNodeModulesClosure(['a'], root).packages.map((p) => p.dest)).toStrictEqual(['a', 'b']);
        });
    });

    await describe('stageNodeModules', async () => {
        await it('stages every file under <bundle>/node_modules, minus a package’s own nested node_modules', async () => {
            const root = project();
            install(root, 'addon', { name: 'addon' }, { 'lib/index.js': '1', 'build/addon.node': '2' });
            install(root, 'addon/node_modules/helper', { name: 'helper' }, { 'index.js': '3' });
            const closure = resolveNodeModulesClosure(['addon'], root);
            // `helper` is not a dependency here, so it is not part of the closure and must not ride along
            // inside `addon`'s own file list either.
            const paths = stageNodeModules(closure, 'Contents/Resources/lib').map((f) => f.path);
            expect(paths).toStrictEqual([
                'Contents/Resources/lib/node_modules/addon/build/addon.node',
                'Contents/Resources/lib/node_modules/addon/lib/index.js',
                'Contents/Resources/lib/node_modules/addon/package.json',
            ]);
        });

        await it('keeps the execute bit and marks shared libraries executable', async () => {
            const root = project();
            const dir = install(
                root,
                'addon',
                { name: 'addon' },
                { 'bin/tool': '#!/bin/sh', 'lib/libx.dylib': 'x', 'a.js': 'y' },
            );
            chmodSync(join(dir, 'bin', 'tool'), 0o755);
            const staged = stageNodeModules(resolveNodeModulesClosure(['addon'], root), 'lib');
            const mode = (suffix: string) => staged.find((f) => f.path.endsWith(suffix))?.mode;
            expect(mode('bin/tool')).toBe(0o755);
            expect(mode('libx.dylib')).toBe(0o755);
            expect(mode('a.js')).toBe(0o644);
        });
    });
};
