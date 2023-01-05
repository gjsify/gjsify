import { describe, it, expect } from '@gjsify/unit';
// import { join, dirname } from 'path';
// import { fileURLToPath } from "url";

// const __filename = fileURLToPath(import.meta.url)
// const __dirname = dirname(__filename)

import { statSync } from 'fs';
import { stat } from 'fs/promises';

export default async () => {
	await describe('fs.statSync', async () => {

		await it('Should return the file stat', async () => {

                  const s = statSync('tsconfig.json');

                  expect(s.atime instanceof Date).toBeTruthy();
                  expect(s.atimeMs).toBeGreaterThan(0);
                  expect(s.birthtime instanceof Date).toBeTruthy();
                  expect(s.birthtimeMs).toBeGreaterThan(0);
                  expect(s.blksize).toBeGreaterThan(0);
                  expect(s.blocks).toBeGreaterThan(0);
                  expect(s.ctime instanceof Date).toBeTruthy();
                  expect(s.ctimeMs).toBeGreaterThan(0);
                  expect(s.dev).toBeGreaterThan(0);
                  expect(s.gid).toBeGreaterThan(0);
                  expect(s.ino).toBeGreaterThan(0);
                  expect(s.mode).toBeGreaterThan(0);
                  expect(s.mtime instanceof Date).toBeTruthy();
                  expect(s.mtimeMs).toBeGreaterThan(0);
                  expect(s.nlink).toBeGreaterThan(0);
                  expect(s.rdev).toBeGreaterThan(-1);
                  expect(s.size).toBeGreaterThan(0);
                  expect(s.uid).toBeGreaterThan(0);
                  expect(s.isBlockDevice()).toBeFalsy();
                  expect(s.isCharacterDevice()).toBeFalsy();
                  expect(s.isDirectory()).toBeFalsy();
                  expect(s.isFIFO()).toBeFalsy();
                  expect(s.isFile()).toBeTruthy();
                  expect(s.isSocket()).toBeFalsy();
                  expect(s.isSymbolicLink()).toBeFalsy();
		});
	});

	await describe('fs.stat (promise)', async () => {

		await it('Should return the file stat', async () => {

                  const s = await stat('tsconfig.json');

                  expect(s.atime instanceof Date).toBeTruthy();
                  expect(s.atimeMs).toBeGreaterThan(0);
                  expect(s.birthtime instanceof Date).toBeTruthy();
                  expect(s.birthtimeMs).toBeGreaterThan(0);
                  expect(s.blksize).toBeGreaterThan(0);
                  expect(s.blocks).toBeGreaterThan(0);
                  expect(s.ctime instanceof Date).toBeTruthy();
                  expect(s.ctimeMs).toBeGreaterThan(0);
                  expect(s.dev).toBeGreaterThan(0);
                  expect(s.gid).toBeGreaterThan(0);
                  expect(s.ino).toBeGreaterThan(0);
                  expect(s.mode).toBeGreaterThan(0);
                  expect(s.mtime instanceof Date).toBeTruthy();
                  expect(s.mtimeMs).toBeGreaterThan(0);
                  expect(s.nlink).toBeGreaterThan(0);
                  expect(s.rdev).toBeGreaterThan(-1);
                  expect(s.size).toBeGreaterThan(0);
                  expect(s.uid).toBeGreaterThan(0);
                  expect(s.isBlockDevice()).toBeFalsy();
                  expect(s.isCharacterDevice()).toBeFalsy();
                  expect(s.isDirectory()).toBeFalsy();
                  expect(s.isFIFO()).toBeFalsy();
                  expect(s.isFile()).toBeTruthy();
                  expect(s.isSocket()).toBeFalsy();
                  expect(s.isSymbolicLink()).toBeFalsy();
		});
	});
}
