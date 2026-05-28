// SPDX-License-Identifier: MIT
// Ported from chokidar's `src/index.test.ts` — selections from the
// `describe('ignored')` block under "watch options". chokidar's npm tarball
// does NOT ship its test file (`files: ["index.js", "handler.js", ...]`), so
// the upstream reference is fetched at port time from:
//   https://github.com/paulmillr/chokidar/blob/5.0.0/src/index.test.ts
// Original: Copyright (c) Paul Miller (https://paulmillr.com). MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

import { makeFreshSubdir, cleanupSubdir, delay, makeSpy, waitFor } from './fixtures.js';

async function waitForReady(watcher: FSWatcher, timeoutMs = 4000): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('waitForReady timeout')), timeoutMs);
        watcher.once('ready', () => {
            clearTimeout(t);
            resolve();
        });
        watcher.once('error', (err: unknown) => {
            clearTimeout(t);
            reject(err);
        });
    });
}

export default async () => {
    await describe('chokidar — ignored option', async () => {
        await it('regex ignore: events for matching paths are suppressed', async () => {
            const dir = makeFreshSubdir('ignore-regex');
            await writeFile(join(dir, 'change.txt'), 'baseline');

            const watcher = chokidar.watch(dir, {
                persistent: true,
                ignoreInitial: true,
                ignored: /skip/,
            });
            const addSpy = makeSpy<[string, unknown]>();
            const changeSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('add', addSpy);
                watcher.on('change', changeSpy);

                const skipPath = join(dir, 'skip-this.txt');
                const keepPath = join(dir, 'change.txt');

                await delay(30);
                await writeFile(skipPath, 'should-not-fire');
                await writeFile(keepPath, 'should-fire');

                await waitFor(changeSpy);
                await delay(200);

                expect(addSpy.calledWith(skipPath)).toBe(false);
                expect(changeSpy.calledWith(skipPath)).toBe(false);
                expect(changeSpy.calledWith(keepPath)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it('function ignore: predicate decides per path', async () => {
            const dir = makeFreshSubdir('ignore-fn');
            const watcher = chokidar.watch(dir, {
                persistent: true,
                ignoreInitial: true,
                ignored: (path: string) => path.endsWith('.log'),
            });
            const addSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('add', addSpy);

                const ignoredFile = join(dir, 'noisy.log');
                const keptFile = join(dir, 'kept.txt');

                await delay(30);
                await writeFile(ignoredFile, 'noise');
                await writeFile(keptFile, 'signal');

                await waitFor(addSpy);
                await delay(200);

                expect(addSpy.calledWith(ignoredFile)).toBe(false);
                expect(addSpy.calledWith(keptFile)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it('ignores the contents of an ignored subdirectory', async () => {
            const dir = makeFreshSubdir('ignore-dir');
            const ignoredDir = join(dir, 'node_modules');
            const ignoredFile = join(ignoredDir, 'index.js');
            await mkdir(ignoredDir);
            await writeFile(ignoredFile, 'existing');

            const watcher = chokidar.watch(dir, {
                persistent: true,
                ignoreInitial: true,
                ignored: ignoredDir,
            });
            const allSpy = makeSpy<[string, string, unknown?]>();
            try {
                await waitForReady(watcher);
                watcher.on('all', allSpy);

                await delay(30);
                // Mutate inside the ignored dir AND add a sentinel under the watched root.
                await writeFile(ignoredFile, 'edited');
                const sentinel = join(dir, 'sentinel.txt');
                await writeFile(sentinel, 'visible');

                // Wait for the sentinel to confirm the watcher is alive.
                await new Promise<void>((resolve, reject) => {
                    const start = Date.now();
                    const check = () => {
                        if (allSpy.calls.some((a) => a[1] === sentinel)) return resolve();
                        if (Date.now() - start > 4000) return reject(new Error('sentinel timeout'));
                        setTimeout(check, 20);
                    };
                    check();
                });
                await delay(150);

                const ignoredEvents = allSpy.calls.filter((a) => a[1] === ignoredFile);
                expect(ignoredEvents.length).toBe(0);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });
    });
};
