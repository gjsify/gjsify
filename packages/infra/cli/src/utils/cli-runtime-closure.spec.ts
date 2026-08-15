// SPDX-License-Identifier: MIT
// The closure `foreach` builds serially before a parallel sweep. Every case here
// is a way a cheaper derivation was MEASURED to get it wrong — the incident behind
// each one is in `cli-runtime-closure.ts`'s header.

import { describe, expect, it } from '@gjsify/unit';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { Workspace } from '@gjsify/workspace';
import { cliRuntimeClosure, moduleSpecifiers } from './cli-runtime-closure.js';

/** A workspace package materialised under `root`, so the walk has real files to read. */
function makeWorkspace(
    root: string,
    name: string,
    manifest: Record<string, unknown>,
    files: Record<string, string> = {},
): Workspace {
    const dir = join(root, name.replace('@gjsify/', ''));
    const full = { name, version: '0.0.0', ...manifest };
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'package.json'), JSON.stringify(full));
    for (const [rel, body] of Object.entries(files)) {
        const file = join(dir, rel);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, body);
    }
    return { location: dir, relativeLocation: name, name, version: '0.0.0', manifest: full, private: false };
}

/** An entry file outside every workspace — the CLI's own `lib/index.js` stand-in. */
function makeEntry(root: string, body: string): string {
    const dir = join(root, '__entry');
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'index.js');
    writeFileSync(file, body);
    return file;
}

export default async () => {
    await describe('moduleSpecifiers', async () => {
        await it('reads static imports, re-exports and literal dynamic imports', () => {
            const specs = moduleSpecifiers(
                [
                    '#!/usr/bin/env node',
                    "import { a } from '@gjsify/one';",
                    "export * from '@gjsify/two';",
                    "export { b } from '@gjsify/three';",
                    "const m = await import('@gjsify/four');",
                    "import 'node:fs';",
                ].join('\n'),
            );
            expect(specs).toContain('@gjsify/one');
            expect(specs).toContain('@gjsify/two');
            expect(specs).toContain('@gjsify/three');
            expect(specs).toContain('@gjsify/four');
            expect(specs).toContain('node:fs');
        });

        await it('does not read an import out of a string — the storybook-generator case', () => {
            // `commands/storybook.ts` builds the storybook entry as SOURCE TEXT. A
            // regex scan picks the specifier out of that template literal and drags
            // the whole GTK storybook subtree into the serial prefix; a parse cannot.
            const specs = moduleSpecifiers(
                [
                    "import { x } from '@gjsify/real';",
                    'function generateEntry(files) {',
                    "    return `import { collectStoryModules } from '@gjsify/storybook';\\n${files}`;",
                    '}',
                ].join('\n'),
            );
            expect(specs).toContain('@gjsify/real');
            expect(specs).not.toContain('@gjsify/storybook');
        });

        await it('yields nothing rather than throwing on unparseable input', () => {
            expect(moduleSpecifiers('const = = =;').length).toBe(0);
        });
    });

    await describe('cliRuntimeClosure', async () => {
        await it('walks transitively and resolves the SUBPATH a specifier names', () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-cli-closure-'));
            try {
                const workspaces = [
                    makeWorkspace(
                        root,
                        '@gjsify/leaf',
                        { exports: { '.': './lib/index.js', './runtime': './lib/runtime.js' } },
                        {
                            // The barrel reaches a package nothing imports. Only
                            // `/runtime` is imported, so substituting the package root
                            // for the subpath would over-select.
                            'lib/index.js': "export * from '@gjsify/barrel-only';",
                            'lib/runtime.js': 'export const runtime = 1;',
                        },
                    ),
                    makeWorkspace(
                        root,
                        '@gjsify/barrel-only',
                        { main: './lib/index.js' },
                        { 'lib/index.js': 'export {};' },
                    ),
                    makeWorkspace(
                        root,
                        '@gjsify/mid',
                        { main: './lib/index.js' },
                        { 'lib/index.js': "import '@gjsify/leaf/runtime';" },
                    ),
                ];
                const entry = makeEntry(root, "import '@gjsify/mid';\nimport 'node:fs';\n");

                const closure = cliRuntimeClosure(workspaces, { entry, cliManifest: null });
                expect([...closure].sort().join(',')).toBe('@gjsify/leaf,@gjsify/mid');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('adds the workspace peers of every package it reaches', () => {
            // A COMPUTED `import(target)` — the bundler engine, lightningcss — is
            // invisible to a static walk AND to npm, which is why the convention
            // declares it an optional peer. That declaration closes both holes.
            const root = mkdtempSync(join(tmpdir(), 'gjsify-cli-closure-peers-'));
            try {
                const workspaces = [
                    makeWorkspace(
                        root,
                        '@gjsify/plugin',
                        {
                            main: './lib/index.js',
                            peerDependencies: { '@gjsify/native-engine': 'workspace:^', rolldown: '^1.1.4' },
                        },
                        { 'lib/index.js': 'export {};' },
                    ),
                    makeWorkspace(
                        root,
                        '@gjsify/native-engine',
                        { main: './lib/index.js' },
                        { 'lib/index.js': 'export {};' },
                    ),
                    makeWorkspace(
                        root,
                        '@gjsify/cli-peer',
                        { main: './lib/index.js' },
                        { 'lib/index.js': 'export {};' },
                    ),
                ];
                const entry = makeEntry(root, "import '@gjsify/plugin';\n");

                const closure = cliRuntimeClosure(workspaces, {
                    entry,
                    cliManifest: { peerDependencies: { '@gjsify/cli-peer': 'workspace:^' } },
                });
                expect([...closure].sort().join(',')).toBe('@gjsify/cli-peer,@gjsify/native-engine,@gjsify/plugin');
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });

        await it('is empty when the entry is absent — an unbuilt CLI must not stall the sweep', () => {
            const closure = cliRuntimeClosure([], { entry: '/nonexistent/gjsify/lib/index.js', cliManifest: null });
            expect(closure.size).toBe(0);
        });

        await it('ignores names that are not workspaces — a consumer tree has nothing to tear', () => {
            const root = mkdtempSync(join(tmpdir(), 'gjsify-cli-closure-consumer-'));
            try {
                const entry = makeEntry(root, "import '@gjsify/npm-registry';\n");
                expect(cliRuntimeClosure([], { entry, cliManifest: null }).size).toBe(0);
            } finally {
                rmSync(root, { recursive: true, force: true });
            }
        });
    });
};
