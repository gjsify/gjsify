// SPDX-License-Identifier: MIT
// Inspired by node_modules/execa/index.d.ts (execaSync) and the README
// "Synchronous execution" section.
// Original: Copyright (c) Sindre Sorhus / execa contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { execaSync } from 'execa';

export default async () => {
    await describe('execa — execaSync', async () => {
        await it('captures stdout from a sync spawn', () => {
            const result = execaSync('echo', ['sync-out']);
            expect(result.exitCode).toBe(0);
            expect(result.stdout).toBe('sync-out');
            expect(result.failed).toBe(false);
        });

        await it('throws synchronously on non-zero exit', () => {
            let caught: unknown = undefined;
            try {
                execaSync('false');
            } catch (err) {
                caught = err;
            }
            expect(caught).toBeTruthy();
            const e = caught as { exitCode: number; failed: boolean };
            expect(e.exitCode).toBe(1);
            expect(e.failed).toBe(true);
        });

        await it('respects reject:false on the sync path', () => {
            const result = execaSync('false', [], { reject: false });
            expect(result.exitCode).toBe(1);
            expect(result.failed).toBe(true);
        });

        await it('returns env-aware output (sync path)', () => {
            const result = execaSync('node', ['-e', 'process.stdout.write(String(process.env.SYNC_TOKEN))'], {
                env: { SYNC_TOKEN: 'sync-abc' },
            });
            expect(result.stdout).toBe('sync-abc');
        });
    });
};
