import { describe, it, expect } from '@gjsify/unit';
import { join, dirname } from 'path';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import { existsSync, readdirSync, readFileSync, mkdirSync, rmdirSync, writeFileSync, unlinkSync, watch, mkdtempSync, rmSync, realpathSync, symlinkSync } from 'fs';
import { Buffer } from 'buffer';

export default async () => {
	await describe('fs.existsSync', async () => {

		const existingFiles = ['tsconfig.json', 'package.json', 'test.gjs.js'];
		const nonExistingFiles = ['asdasd', '/asdasd', ''];

		await it('should return true for existing files', () => {
			for (const file of existingFiles) {
				const result = existsSync(file);
				expect(result).toBe(true)
			}
		});

		await it('should return false for non existing files', () => {
			for (const file of nonExistingFiles) {
				const result = existsSync(file);
				expect(result).toBe(false)
			}
		});
	});

	await describe('fs.readdirSync', async () => {
		await it('should return no files for an empty directory', () => {
			const dir = mkdtempSync('fs-test-');
			const files = readdirSync(dir);
			expect(files.length).toBe(0);

			// Clear
			rmdirSync(dir);
		});

		await it('should return the files for non-empty directory', () => {
			const dir = mkdtempSync('fs-test-');
			const txt1 = join(dir, 'test1.txt');
			const txt2 = join(dir, 'test2.txt');
			const dir1 = join(dir, 'empty-dir');
			writeFileSync(txt1, '');
			writeFileSync(txt2, '');
			mkdirSync(dir1);
			const files = readdirSync(dir);
			expect(files.length).toEqual(3);

			// Clear
			rmSync(txt1);
			rmSync(txt2);
			rmdirSync(dir1);
			rmdirSync(dir);
		});

		await it('should return the file with the name "file.txt"', () => {
			const dir = mkdtempSync('fs-test-');
			const expectedFileName = 'file.txt';
			const file = join(dir, expectedFileName);

			writeFileSync(file, '');

			const files = readdirSync(dir);
			expect(files[0]).toEqual(expectedFileName);

			// Clear
			rmSync(file);
			rmdirSync(dir);
		});

		await it('should return with file types if option "withFileTypes" is `true`', () => {
			const dir = mkdtempSync('fs-test-');
			const expectedFile = 'file.txt';
			const expectedDir = 'subdir';
			const file = join(dir, expectedFile);
			const subdir = join(dir, expectedDir);

			writeFileSync(file, '');
			mkdirSync(subdir);

			const files = readdirSync(dir, { withFileTypes: true });

			expect(files.length).toBe(2);

			const fileWithTypes = files.find((f) => f.name === expectedFile);
			const dirWithTypes = files.find((f) => f.name === expectedDir);

			expect(fileWithTypes.isFile()).toBeTruthy();
			expect(fileWithTypes.isDirectory()).toBeFalsy();

			expect(dirWithTypes.isFile()).toBeFalsy();
			expect(dirWithTypes.isDirectory()).toBeTruthy();

			// Clear
			rmSync(file);
			rmdirSync(subdir);
			rmdirSync(dir);
		});
	});

	await describe('fs.readFileSync', async () => {
		await it('should return a Buffer if no encoding was specified', () => {
			const bufferData = readFileSync('package.json');
			expect(bufferData instanceof Buffer).toBeTruthy();
		});

		await it('should return a string when encoding is utf-8', () => {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});

		await it('should return a string with "Hello World"', () => {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(utf8Data).toBe('Hello World');
		});
	});

	await describe('fs.mkdirSync', async () => {
		const dir = './foobar';

		await it(`should be executed with "${dir}" without error`, () => {
			mkdirSync(dir);
		});

		await it(`${dir} should exists`, () => {
			expect(existsSync(dir)).toBeTruthy();
		});
	});

	await describe('fs.rmdirSync', async () => {
		const dir = './foobar';

		await it(`should be executed with "${dir}" without error`, () => {
			rmdirSync(dir);
		});

		await it(`"${dir}" should not exists (anymore)`, () => {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});
	});

	await describe('fs.writeFileSync', async () => {
		const watchMe = join(__dirname, 'test/watch.js');

		await it(`should be executed without error`, () => {
			writeFileSync(watchMe, '// test');
		});

		await it(`fs.watch should watch ${watchMe} for changes`, () => {
			const watcher = watch(watchMe, {persistent: true}, console.log);

			watcher.on('change', console.log).on('rename', console.log);

			setTimeout(() => { watcher.close(); }, 1000);

			setTimeout(() => {
				writeFileSync(watchMe, '// test');
				setTimeout(() => {
					unlinkSync(watchMe);
				}, 100);
			}, 100);
		});
	});

	await describe('fs.mkdtempSync', async () => {

		await it('should be a function', () => {
			expect(typeof mkdtempSync).toBe("function");
		});

		await it('should create a new directory', () => {
			const directory = mkdtempSync('fs-test-');
			expect(existsSync(directory)).toBeTruthy();
			rmdirSync(directory);
		});
	});

	await describe('fs.realpathSync', async () => {

		await it('should be a function', () => {
			expect(typeof realpathSync).toBe("function");
		});

		await it('should return the real and absolute path', () => {
			const tsConfig = "./tsconfig.json";
			const tsConfigSymlink = "./symlink_tsconfig.json";

			if(!existsSync(tsConfigSymlink)) {
				symlinkSync(tsConfig, tsConfigSymlink);

				const realPath = realpathSync(tsConfig);
				const realSymLinkPath = realpathSync(tsConfigSymlink);

				// Should point to the real file, not the symlink
				expect(realSymLinkPath).toBe(realPath);
			}

			unlinkSync(tsConfigSymlink);
		});
	});
}
