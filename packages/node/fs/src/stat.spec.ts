import { describe, it, expect } from '@gjsify/unit';
import { statSync, mkdtempSync, writeFileSync, rmSync, rmdirSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export default async () => {
	await describe('fs.statSync', async () => {

		await it('Should return the file stat', async () => {
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
		});
	});

	await describe('fs.stat (promise)', async () => {

		await it('Should return the file stat', async () => {
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
		});
	});
}
