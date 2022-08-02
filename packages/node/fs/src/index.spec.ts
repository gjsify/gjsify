import { describe, it, expect } from '@gjsify/unit';

import { existsSync, readdirSync, readFileSync, mkdirSync, rmdirSync, writeFileSync, unlinkSync } from 'fs';

function checkReaddirSync() {

}

function checkReadFileSync() {
  const bufferData = readFileSync('index.js');
  if (!(bufferData instanceof Buffer)) {
    throw new Error('readFileSync should return a Buffer if no encoding was specified');
  }

  const utf8Data = readFileSync('./test/resources/file.txt', 'utf-8');
  if (!(typeof utf8Data === 'string')) {
    throw new Error('readFileSync should return a string when encoding is utf-8');
  }

  if (utf8Data.startsWith('Hello World')) {
    throw new Error('readFileSync returned a string but with the wrong value');
  }
}

function checkMkdirSyncRmdirSync() {
  const path = './foobar';

  mkdirSync(path);

  if (!existsSync(path)) {
    throw new Error(`${path} should exists`);
  }

  rmdirSync('./foobar');

  if (existsSync(path)) {
    throw new Error(`${path} should not exists`);
  }
}

// if (!Object.keys(fs).length) {
//   throw new Error('fs was not exported');
// }

// checkExistsSync();
// checkReaddirSync();
// checkReadFileSync();
// checkMkdirSyncRmdirSync();

// const watch = require('path').join(__dirname, 'watch.js');
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

	
}
