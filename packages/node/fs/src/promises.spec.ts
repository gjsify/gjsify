// Ported from refs/node-test/parallel/test-fs-promises.js,
//   test-fs-access.js, test-fs-copyfile.js
// Original: MIT license, Node.js contributors
import { describe, it, expect } from '@gjsify/unit';
import { promises, existsSync, mkdtempSync, writeFileSync, rmdirSync, rmSync, constants as fsConstants } from 'node:fs';
import { mkdir, readdir, mkdtemp, writeFile, rm, rmdir, access, copyFile, rename, lstat, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';

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

		await it('should return a promise', async () => {
			expect(promises.readFile('package.json', 'utf-8') instanceof Promise).toBeTruthy();
		});

		await it('should return a Buffer if no encoding was specified', async () => {
			const bufferData = await promises.readFile('package.json');
			expect(bufferData instanceof Buffer).toBeTruthy();
		});

		await it('should return a string when encoding is utf-8', async () => {
			const dir = mkdtempSync('fs-prf-');
			const filePath = join(dir, 'test.txt');
			writeFileSync(filePath, 'Hello World');
			const utf8Data = await promises.readFile(filePath, 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should return the correct file content', async () => {
			const dir = mkdtempSync('fs-prf-content-');
			const filePath = join(dir, 'test.txt');
			writeFileSync(filePath, 'Hello World');
			const utf8Data = await promises.readFile(filePath, 'utf-8');
			expect(utf8Data).toBe('Hello World');
			rmSync(filePath);
			rmdirSync(dir);
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

  await describe('fs.promises.access', async () => {
    await it('should resolve for an existing file with F_OK', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-acc-'));
      const file = join(dir, 'exists.txt');
      await writeFile(file, '');
      await access(file, fsConstants.F_OK);
      await rm(file);
      await rmdir(dir);
    });

    await it('should reject with ENOENT for non-existent file', async () => {
      let threw = false;
      try {
        await access('/nonexistent/abc123/xyz.txt', fsConstants.F_OK);
      } catch (e: unknown) {
        threw = true;
        expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
      expect(threw).toBe(true);
    });

    await it('should resolve for readable file with R_OK', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-acc-r-'));
      const file = join(dir, 'read.txt');
      await writeFile(file, 'readable');
      await access(file, fsConstants.R_OK);
      await rm(file);
      await rmdir(dir);
    });
  });

  await describe('fs.promises.copyFile', async () => {
    await it('should copy a file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-cp-'));
      const src = join(dir, 'src.txt');
      const dst = join(dir, 'dst.txt');
      await writeFile(src, 'copy content');
      await copyFile(src, dst);
      const content = await promises.readFile(dst, { encoding: 'utf8' });
      expect(content).toBe('copy content');
      await rm(src);
      await rm(dst);
      await rmdir(dir);
    });

    await it('should throw ENOENT when source does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-cp-err-'));
      const dst = join(dir, 'dst.txt');
      let threw = false;
      try {
        await copyFile('/nonexistent/xyz123.txt', dst);
      } catch (e: unknown) {
        threw = true;
        expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
      expect(threw).toBe(true);
      await rmdir(dir);
    });

    await it('should overwrite destination by default', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-cp-ow-'));
      const src = join(dir, 'src.txt');
      const dst = join(dir, 'dst.txt');
      await writeFile(src, 'new content');
      await writeFile(dst, 'old content');
      await copyFile(src, dst);
      const content = await promises.readFile(dst, { encoding: 'utf8' });
      expect(content).toBe('new content');
      await rm(src);
      await rm(dst);
      await rmdir(dir);
    });
  });

  await describe('fs.promises.rename', async () => {
    await it('should rename a file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-ren-'));
      const src = join(dir, 'old.txt');
      const dst = join(dir, 'new.txt');
      await writeFile(src, 'rename content');
      await rename(src, dst);
      expect(existsSync(src)).toBe(false);
      expect(existsSync(dst)).toBe(true);
      const content = await promises.readFile(dst, { encoding: 'utf8' });
      expect(content).toBe('rename content');
      await rm(dst);
      await rmdir(dir);
    });

    await it('should throw ENOENT when source does not exist', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-ren-err-'));
      let threw = false;
      try {
        await rename(join(dir, 'nonexistent.txt'), join(dir, 'dst.txt'));
      } catch (e: unknown) {
        threw = true;
        expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
      expect(threw).toBe(true);
      await rmdir(dir);
    });
  });

  await describe('fs.promises.lstat', async () => {
    await it('should return stat for a regular file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-lst-'));
      const file = join(dir, 'file.txt');
      await writeFile(file, 'lstat test');
      const s = await lstat(file);
      expect(s.isFile()).toBe(true);
      expect(s.isDirectory()).toBe(false);
      expect(s.isSymbolicLink()).toBe(false);
      await rm(file);
      await rmdir(dir);
    });

    await it('should return stat for a directory', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-lst-d-'));
      const s = await lstat(dir);
      expect(s.isDirectory()).toBe(true);
      expect(s.isFile()).toBe(false);
      await rmdir(dir);
    });

    await it('should throw ENOENT for non-existent path', async () => {
      let threw = false;
      try {
        await lstat('/nonexistent/abc/xyz123.txt');
      } catch (e: unknown) {
        threw = true;
        expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
      expect(threw).toBe(true);
    });
  });

  await describe('fs.promises.writeFile error handling', async () => {
    await it('should throw ENOENT when parent directory does not exist', async () => {
      let threw = false;
      try {
        await writeFile('/nonexistent/subdir/abc123.txt', 'data');
      } catch (e: unknown) {
        threw = true;
        expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
      expect(threw).toBe(true);
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
