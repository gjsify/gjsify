import { describe, it, expect } from '@gjsify/unit';
import { join, dirname } from 'path';
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import { existsSync, readdirSync, readFileSync, mkdirSync, rmdirSync, writeFileSync, unlinkSync, watch, mkdtempSync, rmSync } from 'fs';

export default async () => {
	await describe('fs.existsSync', () => {

		const existingFiles = ['tsconfig.json', 'package.json', 'test.gjs.js'];
		const nonExistingFiles = ['asdasd', '/asdasd', ''];

		it('should return true for existing files', () => {
			for (const file of existingFiles) {
				const result = existsSync(file);
				expect(result).toBe(true)
			}
		});

		it('should return false for non existing files', () => {
			for (const file of nonExistingFiles) {
				const result = existsSync(file);
				expect(result).toBe(false)
			}
		});
	});

	await describe('fs.readdirSync', () => {
		const expectedFilesCount = 1;
		const expectedFileName = 'file.txt';
	  
		const files = readdirSync('./test');

		it('should return one file', () => {
			expect(files.length).toEqual(expectedFilesCount)
		});

		it('should return the file with the name "file.txt"', () => {
			expect(files[0]).toEqual(expectedFileName)
		});
	});

	await describe('fs.readFileSync', () => {
		it('should return a Buffer if no encoding was specified', () => {
			const bufferData = readFileSync('package.json');
			expect(bufferData instanceof Buffer).toBeTruthy();
		});

		it('should return a string when encoding is utf-8', () => {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});

		it('should return a string with "Hello World"', () => {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(utf8Data).toBe('Hello World');
		});
	});

	await describe('fs.mkdirSync', () => {
		const path = './foobar';

		it(`should be executed with "${path}" without error`, () => {
			mkdirSync(path);
		});

		it(`${path} should exists`, () => {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});
	});

	await describe('fs.rmdirSync', () => {
		const path = './foobar';

		it(`should be executed with "${path}" without error`, () => {
			rmdirSync(path);
		});

		it(`"${path}" should not exists (anymore)`, () => {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});
	});

	await describe('fs.writeFileSync', () => {
		const watchMe = join(__dirname, 'test/watch.js');

		it(`should be executed without error`, () => {
			writeFileSync(watchMe, '// test');
		});

		it(`fs.watch should watch ${watchMe} for changes`, () => {
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

	await describe('fs.mkdtempSync', () => {

		it('should be a function', () => {
			expect(typeof mkdtempSync).toBe("function");
		});

		it('should create a new directory', () => {
			const directory = mkdtempSync('fs-test-');
			expect(existsSync(directory)).toBeTruthy();
			rmdirSync(directory);
		});
	});

}
