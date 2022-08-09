import { describe, it, expect } from '@gjsify/unit';
import { join, dirname } from 'path'
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import { existsSync, readdirSync, readFileSync, mkdirSync, rmdirSync, writeFileSync, unlinkSync, watch } from 'fs';


export function testSuite() {
	describe('fs.existsSync', function() {

		const existingFiles = ['tsconfig.json', 'package.json', 'test.gjs.js'];
		const nonExistingFiles = ['asdasd', '/asdasd', ''];

		it('should return true for existing files', function() {
			for (const file of existingFiles) {
				const result = existsSync(file);
				expect(result).toBe(true)
			}
		});

		it('should return false for non existing files', function() {
			for (const file of nonExistingFiles) {
				const result = existsSync(file);
				expect(result).toBe(false)
			}
		});
	});

	describe('fs.readdirSync', function() {
		const expectedFilesCount = 1;
		const expectedFileName = 'file.txt';
	  
		const files = readdirSync('./test');

		it('should return one file', function() {
			expect(files.length).toEqual(expectedFilesCount)
		});

		it('should return the file with the name "file.txt"', function() {
			expect(files[0]).toEqual(expectedFileName)
		});
	});

	describe('fs.readFileSync', function() {
		it('should return a Buffer if no encoding was specified', function() {
			const bufferData = readFileSync('package.json');
			expect(bufferData instanceof Buffer).toBeTruthy();
		});

		it('should return a string when encoding is utf-8', function() {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});

		it('should return a string with "Hello World"', function() {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(utf8Data).toBe('Hello World');
		});
	});

	describe('fs.mkdirSync', function() {
		const path = './foobar';

		it(`should be executed with "${path}" without error`, function() {
			mkdirSync(path);
		});

		it(`${path} should exists`, function() {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});
	});

	describe('fs.rmdirSync', function() {
		const path = './foobar';

		it(`should be executed with "${path}" without error`, function() {
			rmdirSync(path);
		});

		it(`"${path}" should not exists (anymore)`, function() {
			const utf8Data = readFileSync('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});
	});

	describe('fs.writeFileSync', function() {
		const watchMe = join(__dirname, 'watch.js');

		it(`should be executed without error`, function() {
			writeFileSync(watchMe, '// test');
		});

		it(`fs.watch should watch ${watchMe} for changes`, function() {
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
}


// const watch = join(__dirname, 'watch.js');
// writeFileSync(watch, '// test');
// const watcher = watch(watch, {persistent: true}, console.log);
// watcher.on('change', console.log).on('rename', console.log);

// setTimeout(() => { watcher.close(); }, 1000);

// setTimeout(() => {
//   writeFileSync(watch, '// test');
//   setTimeout(() => {
//     unlinkSync(watch);
//   }, 100);
// }, 100);
