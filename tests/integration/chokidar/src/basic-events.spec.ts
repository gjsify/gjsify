// SPDX-License-Identifier: MIT
// Ported from chokidar's `src/index.test.ts` (the "watch a directory" describe
// block — add / change / unlink / rename cases). chokidar's npm tarball does
// NOT ship its test file (`files: ["index.js", "handler.js", ...]`), so the
// upstream reference is fetched at port time from:
//   https://github.com/paulmillr/chokidar/blob/5.0.0/src/index.test.ts
// Original: Copyright (c) Paul Miller (https://paulmillr.com). MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted
// (chokidar's @paulmillr/jsbt + tinyspy + node:assert → @gjsify/unit with
// in-suite makeSpy/waitFor helpers).

import { describe, it, expect } from '@gjsify/unit';
import { writeFile, unlink, rename } from 'node:fs/promises';
import { join } from 'node:path';
import chokidar, { type FSWatcher } from 'chokidar';

import { makeFreshSubdir, cleanupSubdir, delay, makeSpy, waitFor } from './fixtures.js';

// Mirrors chokidar's own waitForWatcher: resolves on 'ready', rejects on 'error' or timeout.
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
    await describe('chokidar — watch a directory (basic events)', async () => {
        await it('exposes the documented public API on the FSWatcher instance', async () => {
            const dir = makeFreshSubdir('api');
            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            try {
                await waitForReady(watcher);
                expect(typeof watcher.on).toBe('function');
                expect(typeof watcher.add).toBe('function');
                expect(typeof watcher.close).toBe('function');
                expect(typeof watcher.getWatched).toBe('function');
                expect(typeof watcher.unwatch).toBe('function');
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it("emits 'add' when a file appears in a watched directory", async () => {
            const dir = makeFreshSubdir('add');
            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            const addSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('add', addSpy);

                const testPath = join(dir, 'new.txt');
                await delay(30);
                await writeFile(testPath, 'hello');
                await waitFor(addSpy);

                expect(addSpy.callCount).toBeGreaterThan(0);
                expect(addSpy.calledWith(testPath)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it("emits 'change' when a watched file is modified", async () => {
            const dir = makeFreshSubdir('change');
            const file = join(dir, 'change.txt');
            await writeFile(file, 'v1');

            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            const changeSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('change', changeSpy);

                await delay(30);
                await writeFile(file, 'v2-with-different-size');
                await waitFor(changeSpy);

                expect(changeSpy.calledWith(file)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it("emits 'unlink' when a watched file is removed", async () => {
            const dir = makeFreshSubdir('unlink');
            const file = join(dir, 'remove-me.txt');
            await writeFile(file, 'bye');

            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            const unlinkSpy = makeSpy<[string]>();
            try {
                await waitForReady(watcher);
                watcher.on('unlink', unlinkSpy);

                await delay(30);
                await unlink(file);
                await waitFor(unlinkSpy);

                expect(unlinkSpy.calledWith(file)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it("emits 'unlink' and 'add' when a file is renamed in place", async () => {
            const dir = makeFreshSubdir('rename');
            const src = join(dir, 'old.txt');
            const dst = join(dir, 'new.txt');
            await writeFile(src, 'rename-me');

            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            const unlinkSpy = makeSpy<[string]>();
            const addSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('unlink', unlinkSpy);
                watcher.on('add', addSpy);

                await delay(30);
                await rename(src, dst);
                await waitFor(unlinkSpy);
                await waitFor(addSpy);

                expect(unlinkSpy.calledWith(src)).toBe(true);
                expect(addSpy.calledWith(dst)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it("emits 'all' with the event name as the first argument", async () => {
            const dir = makeFreshSubdir('all');
            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            const allSpy = makeSpy<[string, string, unknown?]>();
            try {
                await waitForReady(watcher);
                watcher.on('all', allSpy);

                const file = join(dir, 'a.txt');
                await delay(30);
                await writeFile(file, '1');
                await waitFor(allSpy);

                const seenEvents = allSpy.calls.map((args) => args[0]);
                expect(seenEvents.includes('add')).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it('close() resolves and returns the same promise on subsequent calls', async () => {
            const dir = makeFreshSubdir('close');
            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            await waitForReady(watcher);

            const p1 = watcher.close();
            const p2 = watcher.close();
            // chokidar caches the close promise — second call returns the same one.
            expect(p1).toBe(p2);
            await p1;

            cleanupSubdir(dir);
        });
    });
};
