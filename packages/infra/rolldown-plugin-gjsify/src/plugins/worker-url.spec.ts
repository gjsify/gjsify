// SPDX-License-Identifier: MIT
// `new Worker(new URL('./w.ts', import.meta.url))`: which constructors count, which
// arguments are refused, how the emitted file is named, and which `--app` targets compose
// the plugin. A missed site ships a bundle whose URL points at a source file that is not
// there; a wrong match rewrites an unrelated `new URL` — so the refusals matter most.

import { describe, expect, it } from '@gjsify/unit';

import { setupForBrowser } from '../app/browser.js';
import { setupForGjs } from '../app/gjs.js';
import { setupForNode } from '../app/node.js';
import { findWorkerUrls, rewriteWorkerUrls, workerUrlPlugin, WorkerEntries, WORKER_URL_PLUGIN } from './worker-url.js';

const specifiers = (code: string) => findWorkerUrls(code, '/src/main.ts').map((s) => s.specifier);

export default async () => {
    await describe('findWorkerUrls', async () => {
        await it('finds the global Worker', async () => {
            expect(specifiers(`new Worker(new URL('./w.ts', import.meta.url));`)).toStrictEqual(['./w.ts']);
        });
        await it('finds it with an options argument', async () => {
            expect(specifiers(`new Worker(new URL('./w.ts', import.meta.url), { type: 'module' });`)).toStrictEqual([
                './w.ts',
            ]);
        });
        await it('finds Worker imported from worker_threads, aliased or not', async () => {
            const code = `import { Worker as W } from 'node:worker_threads';\nnew W(new URL('../w.ts', import.meta.url));`;
            expect(specifiers(code)).toStrictEqual(['../w.ts']);
        });
        await it('finds a member Worker', async () => {
            const code = `import wt from 'worker_threads';\nnew wt.Worker(new URL('./w.ts', import.meta.url));`;
            expect(specifiers(code)).toStrictEqual(['./w.ts']);
        });
        await it('refuses a non-literal specifier', async () => {
            expect(specifiers(`new Worker(new URL(name, import.meta.url));`).length).toBe(0);
        });
        await it('refuses a base other than import.meta.url', async () => {
            expect(specifiers(`new Worker(new URL('./w.ts', base));`).length).toBe(0);
        });
        await it('ignores a constructor that is not a Worker', async () => {
            expect(specifiers(`new Thing(new URL('./w.ts', import.meta.url));`).length).toBe(0);
        });
        await it('ignores the shape inside a string or comment', async () => {
            const code = `const s = "new Worker(new URL('./w.ts', import.meta.url))";\n// new Worker(new URL('./w.ts', import.meta.url))`;
            expect(specifiers(code).length).toBe(0);
        });
    });

    await describe('WorkerEntries', async () => {
        await it('names a worker <stem>.worker<ext>', async () => {
            expect(new WorkerEntries('.mjs').register('/a/w.ts')).toBe('w.worker.mjs');
        });
        await it('defaults to .js', async () => {
            expect(new WorkerEntries().register('/a/w.ts')).toBe('w.worker.js');
        });
        await it('gives the same name to the same source', async () => {
            const entries = new WorkerEntries();
            expect(entries.register('/a/w.ts')).toBe(entries.register('/a/w.ts'));
        });
        await it('keeps two sources with one stem apart', async () => {
            const entries = new WorkerEntries();
            const a = entries.register('/a/w.ts');
            const b = entries.register('/b/w.ts');
            expect(a).toBe('w.worker.js');
            expect(b === a).toBe(false);
            expect(b.endsWith('.worker.js')).toBe(true);
        });
        await it('hands each source out once', async () => {
            const entries = new WorkerEntries();
            entries.register('/a/w.ts');
            expect(entries.takePending().length).toBe(1);
            expect(entries.takePending().length).toBe(0);
            entries.register('/a/v.ts');
            expect(entries.takePending().length).toBe(1);
        });
    });

    await describe('rewriteWorkerUrls', async () => {
        await it('points the literal at the emitted file and registers the source', async () => {
            const entries = new WorkerEntries();
            const out = await rewriteWorkerUrls(
                `new Worker(new URL('./w.ts', import.meta.url));`,
                '/src/main.ts',
                async () => '/src/w.ts',
                entries,
            );
            expect(out).toBe(`new Worker(new URL("./w.worker.js", import.meta.url));`);
            expect(entries.takePending()[0].source).toBe('/src/w.ts');
        });
        await it('rewrites several sites in one module', async () => {
            const out = await rewriteWorkerUrls(
                `new Worker(new URL('./a.ts', import.meta.url));\nnew Worker(new URL('./b.ts', import.meta.url));`,
                '/src/main.ts',
                async (spec) => `/src/${spec.slice(2)}`,
                new WorkerEntries(),
            );
            expect(out).toBe(
                `new Worker(new URL("./a.worker.js", import.meta.url));\nnew Worker(new URL("./b.worker.js", import.meta.url));`,
            );
        });
        await it('leaves an unresolvable site as written', async () => {
            const out = await rewriteWorkerUrls(
                `new Worker(new URL('./w.ts', import.meta.url));`,
                '/src/main.ts',
                async () => null,
                new WorkerEntries(),
            );
            expect(out).toBe(null);
        });
        await it('leaves a bare specifier alone', async () => {
            const out = await rewriteWorkerUrls(
                `new Worker(new URL('pkg/w.js', import.meta.url));`,
                '/src/main.ts',
                async () => '/x/w.js',
                new WorkerEntries(),
            );
            expect(out).toBe(null);
        });
    });

    await describe('composition', async () => {
        const names = (plugins: unknown[]): string[] => plugins.flat().map((p) => (p as { name?: string })?.name ?? '');
        for (const [app, setup] of [
            ['gjs', setupForGjs],
            ['node', setupForNode],
            ['browser', setupForBrowser],
        ] as const) {
            await it(`${app} composes the plugin when workers is set`, async () => {
                const { plugins } = await setup({
                    output: { file: 'dist/out.mjs' },
                    pluginOptions: { workers: new WorkerEntries('.mjs') },
                });
                expect(names(plugins)).toContain(WORKER_URL_PLUGIN);
            });
            await it(`${app} omits it without workers`, async () => {
                const { plugins } = await setup({ output: { file: 'dist/out.mjs' }, pluginOptions: {} });
                expect(names(plugins).includes(WORKER_URL_PLUGIN)).toBe(false);
            });
        }
        await it('exposes a transform hook', async () => {
            expect(typeof workerUrlPlugin(new WorkerEntries()).name).toBe('string');
        });
    });
};
