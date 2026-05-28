// SPDX-License-Identifier: MIT
// Ported from chokidar's `src/index.test.ts` — `describe('awaitWriteFinish')`.
// chokidar's npm tarball does NOT ship its test file, so the upstream
// reference is fetched at port time from:
//   https://github.com/paulmillr/chokidar/blob/5.0.0/src/index.test.ts
// Original: Copyright (c) Paul Miller (https://paulmillr.com). MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// awaitWriteFinish defers the 'add'/'change' emit until the file's size has
// been stable for `stabilityThreshold` ms. Internally, chokidar polls the
// file's stats every `pollInterval` ms via fs.stat — so this suite exercises
// @gjsify/fs's stat surface as much as fs.watch event delivery.

import { describe, it, expect } from '@gjsify/unit';
import { writeFile, appendFile, unlink } from 'node:fs/promises';
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
    await describe('chokidar — awaitWriteFinish', async () => {
        await it('exposes documented default options when awaitWriteFinish: true', async () => {
            const dir = makeFreshSubdir('awf-defaults');
            const watcher = chokidar.watch(dir, {
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: true,
            });
            try {
                await waitForReady(watcher);
                // Documented defaults: pollInterval 100ms, stabilityThreshold 2000ms.
                // `awaitWriteFinish: true` is normalized to its full object form at runtime,
                // but the typing is the `false | AWF` union — narrow at the use site.
                const awf = watcher.options.awaitWriteFinish as { pollInterval: number; stabilityThreshold: number };
                expect(awf.pollInterval).toBe(100);
                expect(awf.stabilityThreshold).toBe(2000);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it('defers add until the file is stable for stabilityThreshold', async () => {
            const dir = makeFreshSubdir('awf-defer');
            const watcher = chokidar.watch(dir, {
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 50 },
            });
            const addSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('add', addSpy);

                const file = join(dir, 'add.txt');
                await writeFile(file, 'hello');
                // Before stabilityThreshold elapses, no add fires.
                await delay(150);
                expect(addSpy.callCount).toBe(0);

                // After stabilityThreshold elapses (plus a poll cycle), add fires.
                await waitFor(addSpy);
                expect(addSpy.calledWith(file)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it('emits with the final (post-stable) stats — size matches the full write', async () => {
            const dir = makeFreshSubdir('awf-final-stats');
            const watcher = chokidar.watch(dir, {
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 50 },
            });
            const addSpy = makeSpy<[string, { size: number }]>();
            try {
                await waitForReady(watcher);
                watcher.on('add', addSpy);

                const file = join(dir, 'grow.txt');
                await writeFile(file, 'hello ');
                await delay(150);
                await appendFile(file, 'world!'); // grows the file mid-window
                await waitFor(addSpy);

                expect(addSpy.calledWith(file)).toBe(true);
                const stats = addSpy.calls[0][1];
                expect(stats).toBeTruthy();
                expect(stats.size).toBe(12);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it('does not emit any event for a file deleted before write finished', async () => {
            const dir = makeFreshSubdir('awf-deleted');
            const watcher = chokidar.watch(dir, {
                persistent: true,
                ignoreInitial: true,
                awaitWriteFinish: { stabilityThreshold: 400, pollInterval: 50 },
            });
            const allSpy = makeSpy<[string, string, unknown?]>();
            try {
                await waitForReady(watcher);
                watcher.on('all', allSpy);

                const file = join(dir, 'transient.txt');
                await writeFile(file, 'hello');
                await delay(150); // BEFORE stabilityThreshold elapses
                await unlink(file);
                await delay(600); // past stabilityThreshold + a poll

                // No add/change/unlink for this path — chokidar drops it
                // because the awaitWriteFinish window never resolved.
                const pathEvents = allSpy.calls.filter((a) => a[1] === file);
                expect(pathEvents.length).toBe(0);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });
    });
};
