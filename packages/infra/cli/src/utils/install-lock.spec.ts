// SPDX-License-Identifier: MIT
// Unit tests for the cross-process install lock (ADR 0001, step 2).
//
// The cross-PROCESS contention behavior (waiting on a live holder, stealing
// from a dead one mid-install) is covered end-to-end by
// `tests/e2e/install-concurrent/`; these units cover the in-process
// contract: acquire/release lifecycle, re-entrancy refcounting, dead-pid
// staleness stealing, and the GJSIFY_INSTALL_LOCK=0 escape hatch.

import { describe, it, expect } from '@gjsify/unit';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { acquireInstallLock } from './install-lock.js';

const LOCK_DIR = 'node_modules/.gjsify-install-lock';

export default async () => {
    await describe('install-lock', async () => {
        const withPrefix = async (fn: (prefix: string) => Promise<void>) => {
            const prefix = mkdtempSync(join(tmpdir(), 'gjsify-install-lock-'));
            try {
                await fn(prefix);
            } finally {
                rmSync(prefix, { recursive: true, force: true });
            }
        };

        await it('acquire creates the lock dir, release removes it', async () => {
            await withPrefix(async (prefix) => {
                const handle = await acquireInstallLock(prefix);
                expect(existsSync(join(prefix, LOCK_DIR))).toBe(true);
                handle.release();
                expect(existsSync(join(prefix, LOCK_DIR))).toBe(false);
            });
        });

        await it('is re-entrant within the process (refcounted release)', async () => {
            await withPrefix(async (prefix) => {
                const outer = await acquireInstallLock(prefix);
                const inner = await acquireInstallLock(prefix);
                inner.release();
                // Outer still holds — the dir must survive the inner release.
                expect(existsSync(join(prefix, LOCK_DIR))).toBe(true);
                outer.release();
                expect(existsSync(join(prefix, LOCK_DIR))).toBe(false);
            });
        });

        await it('release is idempotent per handle', async () => {
            await withPrefix(async (prefix) => {
                const a = await acquireInstallLock(prefix);
                const b = await acquireInstallLock(prefix);
                a.release();
                a.release(); // double-release must NOT decrement twice
                expect(existsSync(join(prefix, LOCK_DIR))).toBe(true);
                b.release();
                expect(existsSync(join(prefix, LOCK_DIR))).toBe(false);
            });
        });

        await it('steals a lock owned by a dead pid', async () => {
            await withPrefix(async (prefix) => {
                const lockDir = join(prefix, LOCK_DIR);
                mkdirSync(lockDir, { recursive: true });
                // A pid from the far end of the default pid space that is
                // (virtually) guaranteed dead; combined with an old startedAt
                // this is the crash-residue shape.
                writeFileSync(
                    join(lockDir, 'owner.json'),
                    JSON.stringify({ pid: 2 ** 22 - 7, nonce: 'crashed', startedAt: Date.now() }),
                );
                const handle = await acquireInstallLock(prefix);
                expect(existsSync(lockDir)).toBe(true); // re-created, now ours
                handle.release();
                expect(existsSync(lockDir)).toBe(false);
            });
        });

        await it('GJSIFY_INSTALL_LOCK=0 disables locking (no dir created)', async () => {
            await withPrefix(async (prefix) => {
                const prev = process.env.GJSIFY_INSTALL_LOCK;
                process.env.GJSIFY_INSTALL_LOCK = '0';
                try {
                    const handle = await acquireInstallLock(prefix);
                    expect(existsSync(join(prefix, LOCK_DIR))).toBe(false);
                    handle.release();
                } finally {
                    if (prev === undefined) delete process.env.GJSIFY_INSTALL_LOCK;
                    else process.env.GJSIFY_INSTALL_LOCK = prev;
                }
            });
        });
    });
};
