// SPDX-License-Identifier: MIT
// Ported from chokidar's `src/index.test.ts` — selections from the "watch a
// directory" (nested subdir cases) and "depth" describe blocks. chokidar's npm
// tarball does NOT ship its test file (`files: ["index.js", "handler.js", ...]`),
// so the upstream reference is fetched at port time from:
//   https://github.com/paulmillr/chokidar/blob/5.0.0/src/index.test.ts
// Original: Copyright (c) Paul Miller (https://paulmillr.com). MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.
//
// chokidar implements recursion itself by walking the tree at startup and
// instantiating an fs.watch handle per subdirectory — it does NOT rely on
// the (Linux-unsupported) `recursive: true` option of fs.watch. That makes
// this suite a pure correctness test of fs.watch event delivery in nested
// trees, not of any platform-specific recursion implementation.

import { describe, it, expect } from '@gjsify/unit';
import { mkdir, writeFile, rm } from 'node:fs/promises';
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
    await describe('chokidar — recursive watching', async () => {
        await it("emits 'addDir' when a subdirectory is created under the watch root", async () => {
            const dir = makeFreshSubdir('add-dir');
            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            const addDirSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('addDir', addDirSpy);

                const sub = join(dir, 'subdir');
                await delay(30);
                await mkdir(sub);
                await waitFor(addDirSpy);

                expect(addDirSpy.calledWith(sub)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it('observes file events in a freshly-created nested subdirectory', async () => {
            // chokidar's own behavior: when a new subdir is created under a
            // watched root, chokidar walks it and starts watching new files
            // appearing inside.
            const dir = makeFreshSubdir('nested-events');
            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            const addSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('add', addSpy);

                const sub = join(dir, 'subdir');
                await mkdir(sub);
                // Give chokidar a moment to install the per-subdir fs.watch.
                await delay(150);

                const nestedFile = join(sub, 'nested.txt');
                await writeFile(nestedFile, 'inside');
                await waitFor(addSpy);

                expect(addSpy.calledWith(nestedFile)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it("emits 'unlinkDir' when a watched subdirectory is removed", async () => {
            const dir = makeFreshSubdir('unlink-dir');
            const sub = join(dir, 'goner');
            await mkdir(sub);

            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true });
            const unlinkDirSpy = makeSpy<[string]>();
            try {
                await waitForReady(watcher);
                watcher.on('unlinkDir', unlinkDirSpy);

                await delay(30);
                await rm(sub, { recursive: true, force: true });
                await waitFor(unlinkDirSpy);

                expect(unlinkDirSpy.calledWith(sub)).toBe(true);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it('depth: 0 — does not emit events from sub-subdirectory', async () => {
            const dir = makeFreshSubdir('depth-0');
            const sub = join(dir, 'subdir');
            const subsub = join(sub, 'subsub');
            await mkdir(subsub, { recursive: true });

            // depth: 0 means "watch only the immediate watch path".
            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true, depth: 0 });
            const addSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('add', addSpy);

                // File at depth 2 — must NOT be observed.
                const deepFile = join(subsub, 'deep.txt');
                await delay(30);
                await writeFile(deepFile, 'hidden');
                await delay(200);

                expect(addSpy.calledWith(deepFile)).toBe(false);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });

        await it('depth: 1 — observes one level down but not two', async () => {
            const dir = makeFreshSubdir('depth-1');
            const sub = join(dir, 'subdir');
            const subsub = join(sub, 'subsub');
            await mkdir(subsub, { recursive: true });

            const watcher = chokidar.watch(dir, { persistent: true, ignoreInitial: true, depth: 1 });
            const addSpy = makeSpy<[string, unknown]>();
            try {
                await waitForReady(watcher);
                watcher.on('add', addSpy);

                const shallowFile = join(sub, 'shallow.txt');
                const deepFile = join(subsub, 'deep.txt');

                await delay(30);
                await writeFile(shallowFile, 'visible');
                await writeFile(deepFile, 'hidden');
                await waitFor(addSpy);
                // Give the (silent) deep write a chance to leak through if our impl
                // misroutes events. 200 ms matches chokidar's own depth tests.
                await delay(200);

                expect(addSpy.calledWith(shallowFile)).toBe(true);
                expect(addSpy.calledWith(deepFile)).toBe(false);
            } finally {
                await watcher.close();
                cleanupSubdir(dir);
            }
        });
    });
};
