// Unit tests for the short-lived, cross-invocation OTP cache
// (`utils/npm-otp-cache.ts`) — the task-#61 fix. Node-only (the CLI's test
// suite runs `--app node`), so it exercises the real `node:fs` path incl.
// perms. Every test injects a throwaway `dir` (+ `now`) so nothing touches the
// real `$XDG_RUNTIME_DIR`/temp cache.

import { describe, expect, it } from '@gjsify/unit';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    OTP_CACHE_OPT_OUT_ENV,
    OTP_CACHE_TTL_MS,
    cachedOtpFileMode,
    clearAllCachedOtp,
    clearCachedOtp,
    isOtpCacheEnabled,
    readCachedOtp,
    writeCachedOtp,
} from './npm-otp-cache.js';

const REG_A = 'https://registry.npmjs.org/';
const REG_B = 'https://npm.pkg.github.com/';

function tempDir(): string {
    return mkdtempSync(join(tmpdir(), 'gjsify-otp-spec-'));
}

export default async () => {
    await describe('npm-otp-cache — write/read within TTL', async () => {
        await it('returns the code written within the TTL window', async () => {
            const dir = tempDir();
            try {
                const now = 1_000_000;
                writeCachedOtp(REG_A, '123456', { dir, now });
                // Just before expiry → hit.
                expect(readCachedOtp(REG_A, { dir, now: now + OTP_CACHE_TTL_MS - 1 })).toBe('123456');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('trailing-slash-insensitive registry key (…/ and … are the same entry)', async () => {
            const dir = tempDir();
            try {
                const now = 5;
                writeCachedOtp('https://registry.npmjs.org/', '222222', { dir, now });
                expect(readCachedOtp('https://registry.npmjs.org', { dir, now: now + 10 })).toBe('222222');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    await describe('npm-otp-cache — expiry', async () => {
        await it('returns undefined AND deletes the file once past the TTL', async () => {
            const dir = tempDir();
            try {
                const now = 2_000_000;
                writeCachedOtp(REG_A, '654321', { dir, now });
                expect(cachedOtpFileMode(REG_A, { dir })).toBeDefined(); // file exists
                // At/after expiry → miss + delete.
                expect(readCachedOtp(REG_A, { dir, now: now + OTP_CACHE_TTL_MS })).toBe(undefined);
                expect(cachedOtpFileMode(REG_A, { dir })).toBe(undefined); // deleted
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    await describe('npm-otp-cache — perms', async () => {
        await it('writes the cache file with 0600 perms', async () => {
            const dir = tempDir();
            try {
                writeCachedOtp(REG_A, '424242', { dir, now: 1 });
                expect(cachedOtpFileMode(REG_A, { dir })).toBe(0o600);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    await describe('npm-otp-cache — registry scope', async () => {
        await it('a code for registry A is NOT returned when reading registry B', async () => {
            const dir = tempDir();
            try {
                const now = 10;
                writeCachedOtp(REG_A, '111111', { dir, now });
                expect(readCachedOtp(REG_B, { dir, now: now + 5 })).toBe(undefined); // miss
                expect(readCachedOtp(REG_A, { dir, now: now + 5 })).toBe('111111'); // hit
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    await describe('npm-otp-cache — opt-out', async () => {
        await it('GJSIFY_NO_OTP_CACHE disables read + write', async () => {
            const dir = tempDir();
            const prev = process.env[OTP_CACHE_OPT_OUT_ENV];
            try {
                process.env[OTP_CACHE_OPT_OUT_ENV] = '1';
                expect(isOtpCacheEnabled()).toBeFalsy();
                writeCachedOtp(REG_A, '999999', { dir, now: 1 }); // no-op
                expect(cachedOtpFileMode(REG_A, { dir })).toBe(undefined); // nothing written
                expect(readCachedOtp(REG_A, { dir, now: 2 })).toBe(undefined); // read disabled
            } finally {
                if (prev === undefined) delete process.env[OTP_CACHE_OPT_OUT_ENV];
                else process.env[OTP_CACHE_OPT_OUT_ENV] = prev;
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    await describe('npm-otp-cache — clear', async () => {
        await it('clearCachedOtp removes a single registry entry; a fresh read misses', async () => {
            const dir = tempDir();
            try {
                writeCachedOtp(REG_A, '777777', { dir, now: 1 });
                clearCachedOtp(REG_A, { dir });
                expect(readCachedOtp(REG_A, { dir, now: 2 })).toBe(undefined);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('clearAllCachedOtp removes every entry', async () => {
            const dir = tempDir();
            try {
                writeCachedOtp(REG_A, '333333', { dir, now: 1 });
                writeCachedOtp(REG_B, '444444', { dir, now: 1 });
                clearAllCachedOtp({ dir });
                expect(readCachedOtp(REG_A, { dir, now: 2 })).toBe(undefined);
                expect(readCachedOtp(REG_B, { dir, now: 2 })).toBe(undefined);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });

    await describe('npm-otp-cache — robustness', async () => {
        await it('an empty code is never written', async () => {
            const dir = tempDir();
            try {
                writeCachedOtp(REG_A, '', { dir, now: 1 });
                expect(cachedOtpFileMode(REG_A, { dir })).toBe(undefined);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });

        await it('a missing entry reads as undefined', async () => {
            const dir = tempDir();
            try {
                expect(readCachedOtp(REG_A, { dir, now: 1 })).toBe(undefined);
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
