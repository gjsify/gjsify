import { describe, it, expect } from '@gjsify/unit';
import { statSync, mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { platform } from 'node:process';

// Assertions below marked `it.failing(..., { when: IS_WIN32 })` describe POSIX
// concepts win32 does not have. The marker keeps them RUNNING and keeps the
// assertion unweakened; it tolerates the failure only here, and fails the run the
// day it starts passing — unlike a platform guard, which would hide it forever.
const IS_WIN32 = platform === 'win32';

export default async () => {
    await describe('fs.statSync', async () => {
        await it.failing(
            'Should return the file stat',
            async () => {
                const dir = mkdtempSync(join(tmpdir(), 'fs-stat-'));
                const filePath = join(dir, 'test.txt');
                writeFileSync(filePath, 'stat test data');

                const s = statSync(filePath);

                expect(s.atime instanceof Date).toBeTruthy();
                expect(s.atimeMs).toBeGreaterThan(0);
                expect(s.birthtime instanceof Date).toBeTruthy();
                expect(s.birthtimeMs).toBeGreaterThan(0);
                expect(s.blksize).toBeGreaterThan(0);
                expect(s.blocks).toBeGreaterThan(0);
                expect(s.ctime instanceof Date).toBeTruthy();
                expect(s.ctimeMs).toBeGreaterThan(0);
                expect(s.dev).toBeGreaterThan(0);
                expect(s.gid).toBeGreaterThan(-1);
                expect(s.ino).toBeGreaterThan(0);
                expect(s.mode).toBeGreaterThan(0);
                expect(s.mtime instanceof Date).toBeTruthy();
                expect(s.mtimeMs).toBeGreaterThan(0);
                expect(s.nlink).toBeGreaterThan(0);
                expect(s.rdev).toBeGreaterThan(-1);
                expect(s.size).toBeGreaterThan(0);
                expect(s.uid).toBeGreaterThan(-1);
                expect(s.isBlockDevice()).toBeFalsy();
                expect(s.isCharacterDevice()).toBeFalsy();
                expect(s.isDirectory()).toBeFalsy();
                expect(s.isFIFO()).toBeFalsy();
                expect(s.isFile()).toBeTruthy();
                expect(s.isSocket()).toBeFalsy();
                expect(s.isSymbolicLink()).toBeFalsy();

                rmSync(filePath);
                rmdirSync(dir);
            },
            '`stat.blocks` is 0 on win32 — Windows does not report an allocated block count (measured: 8 on Linux, 0 on win32 for the same file).',
            { when: IS_WIN32 },
        );
    });

    await describe('fs.stat (promise)', async () => {
        await it.failing(
            'Should return the file stat',
            async () => {
                const dir = mkdtempSync(join(tmpdir(), 'fs-pstat-'));
                const filePath = join(dir, 'test.txt');
                writeFileSync(filePath, 'stat test data');

                const s = await stat(filePath);

                expect(s.atime instanceof Date).toBeTruthy();
                expect(s.atimeMs).toBeGreaterThan(0);
                expect(s.birthtime instanceof Date).toBeTruthy();
                expect(s.birthtimeMs).toBeGreaterThan(0);
                expect(s.blksize).toBeGreaterThan(0);
                expect(s.blocks).toBeGreaterThan(0);
                expect(s.ctime instanceof Date).toBeTruthy();
                expect(s.ctimeMs).toBeGreaterThan(0);
                expect(s.dev).toBeGreaterThan(0);
                expect(s.gid).toBeGreaterThan(-1);
                expect(s.ino).toBeGreaterThan(0);
                expect(s.mode).toBeGreaterThan(0);
                expect(s.mtime instanceof Date).toBeTruthy();
                expect(s.mtimeMs).toBeGreaterThan(0);
                expect(s.nlink).toBeGreaterThan(0);
                expect(s.rdev).toBeGreaterThan(-1);
                expect(s.size).toBeGreaterThan(0);
                expect(s.uid).toBeGreaterThan(-1);
                expect(s.isBlockDevice()).toBeFalsy();
                expect(s.isCharacterDevice()).toBeFalsy();
                expect(s.isDirectory()).toBeFalsy();
                expect(s.isFIFO()).toBeFalsy();
                expect(s.isFile()).toBeTruthy();
                expect(s.isSocket()).toBeFalsy();
                expect(s.isSymbolicLink()).toBeFalsy();

                rmSync(filePath);
                rmdirSync(dir);
            },
            '`stat.blocks` is 0 on win32 — Windows does not report an allocated block count (measured: 8 on Linux, 0 on win32 for the same file).',
            { when: IS_WIN32 },
        );
    });
};
