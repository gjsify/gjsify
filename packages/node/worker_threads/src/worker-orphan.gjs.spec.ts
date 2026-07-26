// SPDX-License-Identifier: MIT
// @gjsify/worker_threads — orphaned-worker lifecycle.
//
// Reference: Node.js lib/internal/worker.js — a Node worker is a THREAD, so it
// cannot outlive the process that spawned it. Ours is a `Gio.Subprocess`, which
// can: its only tie to the parent is the stdin pipe, and the bootstrap has to
// treat EOF on that pipe as "the spawner is gone, leave now".
//
// GJS-only (rule 2b): simulating the spawner's death means dropping the
// parent-side end of the child's stdin pipe, which is a `Gio.OutputStream` the
// public Worker surface deliberately does not expose.

import { describe, it, expect, on } from '@gjsify/unit';
import { Worker } from 'node:worker_threads';
import type Gio from '@girs/gio-2.0';

/** Drop the parent's write end of the child's stdin — the child sees EOF, the
 *  same thing it would see if the parent process had died outright. */
function simulateSpawnerDeath(worker: Worker): void {
    const pipe = (worker as unknown as { _stdinPipe: Gio.OutputStream | null })._stdinPipe;
    pipe?.close(null);
}

export default async () => {
    await on('Gjs', async () => {
        await describe('Worker — an orphaned worker exits', async () => {
            await it('exits when the spawner goes away mid-script', async () => {
                // The worker script's top-level await never settles, so the
                // child never reaches the bootstrap's `loop.run()` on its own.
                // Pre-fix the EOF handler called `loop.quit()` on a loop that
                // was not running yet — a silent no-op — and the orphan lived
                // on, spinning a full core in GJS's job-queue drain.
                const worker = new Worker('await new Promise(() => {});', { eval: true });
                try {
                    const exited = await new Promise<boolean>((resolve) => {
                        const timer = setTimeout(() => resolve(false), 3000);
                        worker.once('exit', () => {
                            clearTimeout(timer);
                            resolve(true);
                        });
                        simulateSpawnerDeath(worker);
                    });
                    expect(exited).toBe(true);
                } finally {
                    // No-op once it exited; force_exit backstop if it did not,
                    // so a regression can never leak a spinning child.
                    await worker.terminate();
                }
            });

            await it('exits when the spawner goes away while it waits for messages', async () => {
                // The already-working case — the script finishes, the child
                // parks in `loop.run()` and EOF quits it. Pinned so the
                // shutdown rework above cannot regress the normal path.
                const worker = new Worker('parentPort.on("message", () => {});', { eval: true });
                try {
                    const exited = await new Promise<boolean>((resolve) => {
                        const timer = setTimeout(() => resolve(false), 3000);
                        worker.once('exit', () => {
                            clearTimeout(timer);
                            resolve(true);
                        });
                        // Give the child time to finish its script and enter
                        // the loop before the parent "dies".
                        setTimeout(() => simulateSpawnerDeath(worker), 300);
                    });
                    expect(exited).toBe(true);
                } finally {
                    await worker.terminate();
                }
            });
        });
    });
};
