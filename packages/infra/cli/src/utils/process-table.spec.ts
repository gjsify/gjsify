// SPDX-License-Identifier: MIT
// `process-table.ts` against a REAL process tree. On the macOS leg there is no
// procfs, so these cases are what proves the `ps` fallback (on Windows, the CIM
// one) — the path whose absence made `foreach`'s fail-fast kill find no
// grandchildren at all.

import { describe, it, expect } from '@gjsify/unit';
import { spawn } from 'node:child_process';

import { collectDescendants, isPidAlive, parsePsPidPpid } from './process-table.js';
import { nodeBinary } from './run-node.js';

export default async () => {
    await describe('process-table', async () => {
        await it('parsePsPidPpid builds ppid → children from POSIX ps output', async () => {
            const table = parsePsPidPpid('    1     0\n  412     1\n  413   412\n  414   412\n garbage\n\n');
            expect(table.get(412)).toStrictEqual([413, 414]);
            expect(table.get(1)).toStrictEqual([412]);
            // pid 1's parent 0 is the kernel, not a process anyone can signal.
            expect(table.has(0)).toBe(false);
        });

        await it('isPidAlive: this process is alive', async () => {
            expect(isPidAlive(process.pid)).toBe(true);
        });

        await it('isPidAlive: a pid beyond every default pid_max is not', async () => {
            expect(isPidAlive(2 ** 22 + 1001)).toBe(false);
        });

        // A Node child that starts a Node grandchild is the smallest real tree
        // with a grandchild of THIS process — the shape `foreach` must reach —
        // and it is spelled the same on every OS the suite runs on.
        await it('collectDescendants finds a grandchild', async () => {
            const node = nodeBinary();
            const inner = `require('child_process').spawn(process.argv[1], ['-e', 'setTimeout(() => {}, 30000)'], { stdio: 'ignore' })`;
            // `process.stdout.write`, not `console.log`: under `gjsify run` FORCE_COLOR
            // is set, and console.log wraps a NUMBER in ANSI colour codes.
            const script = `const c = ${inner}; process.stdout.write(c.pid + '\\n'); setTimeout(() => {}, 30000);`;
            const child = spawn(node, ['-e', script, node], { stdio: ['ignore', 'pipe', 'ignore'] });
            let grandchild = 0;
            try {
                grandchild = await new Promise<number>((resolve, reject) => {
                    child.stdout!.once('data', (chunk: Buffer) => resolve(Number(String(chunk).trim())));
                    child.once('error', reject);
                });
                expect(Number.isInteger(grandchild) && grandchild > 0).toBe(true);
                expect(collectDescendants(child.pid!)).toContain(grandchild);
            } finally {
                if (grandchild > 0) {
                    try {
                        process.kill(grandchild, 'SIGKILL');
                    } catch {
                        // already gone
                    }
                }
                child.kill('SIGKILL');
            }
        });
    });
};
