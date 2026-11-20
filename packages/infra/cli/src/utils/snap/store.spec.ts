// SPDX-License-Identifier: MIT
// The Snap Store helpers (ADR 0149): argument vectors and refusals. snapcraft is never run.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@gjsify/unit';

import {
    SNAP_CREDENTIALS_ENV,
    assertSnapCredentials,
    assertSnapFile,
    assertSnapNameForStore,
    parseChannels,
    snapRegisterArgs,
    snapStatusArgs,
    snapUploadArgs,
} from './store.js';

export default async () => {
    await describe('gjsify snap store helpers (ADR 0149)', async () => {
        await it('builds the register and status vectors', async () => {
            expect(snapRegisterArgs('hello-app')).toStrictEqual(['register', 'hello-app']);
            expect(snapStatusArgs('hello-app')).toStrictEqual(['status', 'hello-app']);
        });

        await it('puts --release before the file, joined by commas', async () => {
            expect(snapUploadArgs('a.snap', [])).toStrictEqual(['upload', 'a.snap']);
            expect(snapUploadArgs('a.snap', ['edge', 'beta'])).toStrictEqual([
                'upload',
                '--release=edge,beta',
                'a.snap',
            ]);
        });

        await it('parses repeated and comma-separated channels', async () => {
            expect(parseChannels(['edge,beta', 'latest/stable'])).toStrictEqual(['edge', 'beta', 'latest/stable']);
            expect(parseChannels([])).toStrictEqual([]);
        });

        await it('refuses a malformed channel', async () => {
            expect(() => parseChannels(['Stable'])).toThrow('not a channel');
            expect(() => parseChannels(['a/b/c/d'])).toThrow('not a channel');
        });

        await it('requires a valid snap name', async () => {
            expect(assertSnapNameForStore('register', 'hello-app')).toBe('hello-app');
            expect(() => assertSnapNameForStore('status', undefined)).toThrow('pass the snap name');
            expect(() => assertSnapNameForStore('register', 'Hello_App')).toThrow('not a snap name');
        });

        await it('refuses a missing credential without naming a value, and points at export-login', async () => {
            let message = '';
            try {
                assertSnapCredentials({});
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message).toContain(SNAP_CREDENTIALS_ENV);
            expect(message).toContain('export-login');
            expect(() => assertSnapCredentials({ [SNAP_CREDENTIALS_ENV]: '' })).toThrow('not set');
        });

        await it('accepts a set credential and never echoes it', async () => {
            const secret = 'sekrit-token-value';
            assertSnapCredentials({ [SNAP_CREDENTIALS_ENV]: secret });
            let message = '';
            try {
                assertSnapFile('/nonexistent/x.snap');
            } catch (err) {
                message = (err as Error).message;
            }
            expect(message.includes(secret)).toBe(false);
        });

        await it('checks the upload file', async () => {
            const dir = mkdtempSync(join(tmpdir(), 'gjsify-snap-store-'));
            try {
                const good = join(dir, 'a.snap');
                writeFileSync(good, 'x');
                expect(assertSnapFile(good)).toBe(good);
                expect(() => assertSnapFile(join(dir, 'missing.snap'))).toThrow('no such file');
                expect(() => assertSnapFile(join(dir, 'a.txt'))).toThrow('not a .snap');
                expect(() => assertSnapFile(undefined)).toThrow('pass the .snap file');
            } finally {
                rmSync(dir, { recursive: true, force: true });
            }
        });
    });
};
