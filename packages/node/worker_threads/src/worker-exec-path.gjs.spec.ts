// SPDX-License-Identifier: MIT
// The worker runs under the SAME gjs binary as its parent (#2338.3), not
// whatever `gjs` PATH resolves to — inside an AppImage/Flatpak or with a
// non-default gjs that is the wrong binary or none at all.
//
// GJS-only (rule 2b): Node workers are threads and share the interpreter.

import { describe, it, expect, on } from '@gjsify/unit';
import { Worker } from 'node:worker_threads';
import GLib from '@girs/glib-2.0';

export default async () => {
    await on('Gjs', async () => {
        await describe('Worker — spawns the parent’s own gjs', async () => {
            await it('runs under the same executable as the parent', async () => {
                const parentExe = GLib.file_read_link('/proc/self/exe');
                const worker = new Worker(
                    'globalThis.__gjsify_worker_context.parentPort.postMessage(imports.gi.GLib.file_read_link("/proc/self/exe"));',
                    { eval: true },
                );
                try {
                    const childExe = await new Promise<string>((resolve, reject) => {
                        const timer = setTimeout(() => reject(new Error('no message within 5000 ms')), 5000);
                        worker.once('message', (msg: string) => {
                            clearTimeout(timer);
                            resolve(msg);
                        });
                        worker.once('error', reject);
                    });
                    expect(childExe).toBe(parentExe);
                } finally {
                    await worker.terminate();
                }
            });
        });
    });
};
