import { describe, it, expect } from '@gjsify/unit';
import { promises, existsSync } from 'fs';
import { mkdir, readdir, mkdtemp, writeFile, rm, rmdir } from 'fs/promises';
import { join } from 'path';
import { Buffer } from 'buffer';

export default async () => {

	await describe('fs/promises', async () => {
		await it('import over "fs/should" should be work', async () => {
			expect(typeof mkdir).toBe("function");
		});
	});

	await describe('fs.promises.readdir', async () => {
		await it('should return no files for an empty directory', async () => {
			const dir = await mkdtemp('fs-test-');
			const files = await readdir(dir);
			expect(files.length).toBe(0);

			// Clear
			await rmdir(dir);
		});

		await it('should return the files for non-empty directory', async () => {
			const dir = await mkdtemp('fs-test-');
			const txt1 = join(dir, 'test1.txt');
			const txt2 = join(dir, 'test2.txt');
			const dir1 = join(dir, 'empty-dir');
			await writeFile(txt1, '');
			await writeFile(txt2, '');
			await mkdir(dir1);
			const files = await readdir(dir);
			expect(files.length).toEqual(3);

			// Clear
			await rm(txt1);
			await rm(txt2);
			await rmdir(dir1);
			await rmdir(dir);
		});

		await it('should return the file with the name "file.txt"', async () => {
			const dir = await mkdtemp('fs-test-');
			const expectedFileName = 'file.txt';
			const file = join(dir, expectedFileName);

			await writeFile(file, '');

			const files = await readdir(dir);
			expect(files[0]).toEqual(expectedFileName);

			// Clear
			await rm(file);
			await rmdir(dir);
		});

		await it('should return with file types if option "withFileTypes" is `true`', async () => {
			const dir = await mkdtemp('fs-test-');
			const expectedFile = 'file.txt';
			const expectedDir = 'subdir';
			const file = join(dir, expectedFile);
			const subdir = join(dir, expectedDir);

			await writeFile(file, '');
			await mkdir(subdir);

			const files = await readdir(dir, { withFileTypes: true });

			expect(files.length).toBe(2);

			const fileWithTypes = files.find((f) => f.name === expectedFile);
			const dirWithTypes = files.find((f) => f.name === expectedDir);

			expect(fileWithTypes.isFile()).toBeTruthy();
			expect(fileWithTypes.isDirectory()).toBeFalsy();

			expect(dirWithTypes.isFile()).toBeFalsy();
			expect(dirWithTypes.isDirectory()).toBeTruthy();

			// Clear
			await rm(file);
			await rmdir(subdir);
			await rmdir(dir);
		});
	});

	await describe('fs.promises.readFile', async () => {

		await it('should be a function', async () => {
			expect(typeof promises.readFile).toBe("function");
		});

		await it('should be a promise', async () => {
			expect(promises.readFile('./test/file.txt', 'utf-8') instanceof Promise).toBeTruthy();
		});

		await it('should return a Buffer if no encoding was specified', async () => {
			const bufferData = await promises.readFile('package.json');
			expect(bufferData instanceof Buffer).toBeTruthy();
		});

		await it('should return a string when encoding is utf-8', async () => {
			const utf8Data = await promises.readFile('./test/file.txt', 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
		});

		await it('should return a string with "Hello World"', async () => {
			const utf8Data = await promises.readFile('./test/file.txt', 'utf-8');
			expect(utf8Data).toBe('Hello World');
		});
	});

	await describe('fs.promises.mkdtemp', async () => {
		await it('should be a function', async () => {
			expect(typeof promises.mkdtemp).toBe("function");
		});

		await it('should create a new directory', async () => {
			const directory = await promises.mkdtemp('fs-test-');
			expect(existsSync(directory)).toBeTruthy();
			await promises.rmdir(directory);
		});
	});

	await describe('fs.promises.rm', async () => {
		await it('should be a function', async () => {
			expect(typeof promises.rm).toBe("function");
		});

		await it('should remove an text file', async () => {

			const dir = await promises.mkdtemp('fs-test-');
			const txt1 = join(dir, 'file1.txt');
			await promises.writeFile(txt1, '');


			expect(existsSync(txt1)).toBeTruthy();
			await promises.rm(txt1);
			expect(existsSync(txt1)).toBeFalsy();
			
			// Clear
			await promises.rmdir(dir);
		});

		await it('should not remove an non-empty folder if recursive option is false and should remove an non-empty folder if recursive option is true', async () => {

			const dir = await promises.mkdtemp('fs-test-');

			await promises.writeFile(join(dir, "file1.txt"), "");
			await promises.writeFile(join(dir, "file2.txt"), "");
			await promises.mkdir(join(dir, "some_dir"));
			await promises.mkdir(join(dir, "some_dir", "file.txt"));

			expect(existsSync(dir)).toBeTruthy();

			try {
				await promises.rm(dir, { recursive: false });
			} catch (error) {
				expect(error).toBeDefined();
			}

			// Dir should still exists because recursive was `false`
			expect(existsSync(dir)).toBeTruthy();

			await promises.rm(dir, { recursive: true });

			// Dir should not exists anymore because recursive was `true`
			expect(existsSync(dir)).toBeFalsy();
		});
	});
}
