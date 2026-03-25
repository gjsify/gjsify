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

	// --- New tests below ---

	await describe('fs.promises.writeFile + readFile round-trip', async () => {
		await it('should write and read back a string correctly', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-prt-'));
			const file = join(dir, 'roundtrip.txt');
			const content = 'Hello, round-trip test!';
			await writeFile(file, content);
			const result = await promises.readFile(file, 'utf-8');
			expect(result).toBe(content);
			await rm(file);
			await rmdir(dir);
		});

		await it('should write and read back a Buffer correctly', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-prt-buf-'));
			const file = join(dir, 'roundtrip-buf.bin');
			const data = Buffer.from([0x00, 0x01, 0x02, 0xff]);
			await writeFile(file, data);
			const result = await promises.readFile(file);
			expect(result instanceof Buffer).toBeTruthy();
			expect(result[0]).toBe(0x00);
			expect(result[1]).toBe(0x01);
			expect(result[2]).toBe(0x02);
			expect(result[3]).toBe(0xff);
			expect(result.length).toBe(4);
			await rm(file);
			await rmdir(dir);
		});

		await it('should write an empty file and read it back', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-prt-empty-'));
			const file = join(dir, 'empty.txt');
			await writeFile(file, '');
			const result = await promises.readFile(file, 'utf-8');
			expect(result).toBe('');
			await rm(file);
			await rmdir(dir);
		});

		await it('should write unicode content and read it back', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-prt-uni-'));
			const file = join(dir, 'unicode.txt');
			const content = 'Hej! Caf\u00e9 \u2603 \ud83d\ude00';
			await writeFile(file, content);
			const result = await promises.readFile(file, 'utf-8');
			expect(result).toBe(content);
			await rm(file);
			await rmdir(dir);
		});
	});

	await describe('fs.promises.mkdir / rmdir', async () => {
		await it('should create and remove a directory', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pmkdir-'));
			const sub = join(dir, 'subdir');
			await mkdir(sub);
			expect(existsSync(sub)).toBe(true);
			await rmdir(sub);
			expect(existsSync(sub)).toBe(false);
			await rmdir(dir);
		});

		await it('should create nested directories with recursive option', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pmkdir-rec-'));
			const nested = join(dir, 'a', 'b', 'c');
			await mkdir(nested, { recursive: true });
			expect(existsSync(nested)).toBe(true);
			await promises.rm(dir, { recursive: true });
		});

		await it('should not throw when recursive mkdir on existing directory', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pmkdir-exist-'));
			// Should not throw
			await mkdir(dir, { recursive: true });
			await rmdir(dir);
		});
	});

	await describe('fs.promises.stat', async () => {
		await it('should return stat for a file with correct size', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pstat-'));
			const file = join(dir, 'sized.txt');
			const content = 'abcdef'; // 6 bytes in UTF-8
			await writeFile(file, content);
			const s = await stat(file);
			expect(s.isFile()).toBe(true);
			expect(s.isDirectory()).toBe(false);
			expect(s.size).toBe(6);
			await rm(file);
			await rmdir(dir);
		});

		await it('should return stat for a directory', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pstat-d-'));
			const s = await stat(dir);
			expect(s.isDirectory()).toBe(true);
			expect(s.isFile()).toBe(false);
			await rmdir(dir);
		});

		await it('should reject with ENOENT for non-existent file', async () => {
			let threw = false;
			try {
				await stat('/nonexistent/xyz789/no-file.txt');
			} catch (e: unknown) {
				threw = true;
				expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
			}
			expect(threw).toBe(true);
		});
	});

	await describe('fs.promises.access additional', async () => {
		await it('should reject with EACCES or ENOENT for W_OK on read-only path', async () => {
			// /etc/hosts typically is not writable by normal users
			let threw = false;
			try {
				await access('/etc/hosts', fsConstants.W_OK);
			} catch (e: unknown) {
				threw = true;
				const code = (e as NodeJS.ErrnoException).code;
				// Either EACCES (permission denied) or ENOENT depending on system
				expect(code === 'EACCES' || code === 'ENOENT').toBe(true);
			}
			expect(threw).toBe(true);
		});
	});

	await describe('fs.promises.rename additional', async () => {
		await it('should preserve file content after rename', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pren-content-'));
			const src = join(dir, 'before.txt');
			const dst = join(dir, 'after.txt');
			await writeFile(src, 'content to preserve');
			await rename(src, dst);
			const content = await promises.readFile(dst, 'utf-8');
			expect(content).toBe('content to preserve');
			expect(existsSync(src)).toBe(false);
			await rm(dst);
			await rmdir(dir);
		});

		await it('should overwrite destination if it already exists', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pren-ow-'));
			const src = join(dir, 'src.txt');
			const dst = join(dir, 'dst.txt');
			await writeFile(src, 'new');
			await writeFile(dst, 'old');
			await rename(src, dst);
			const content = await promises.readFile(dst, 'utf-8');
			expect(content).toBe('new');
			expect(existsSync(src)).toBe(false);
			await rm(dst);
			await rmdir(dir);
		});
	});

	await describe('fs.promises.copyFile additional', async () => {
		await it('should not modify original file after copy', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pcp-orig-'));
			const src = join(dir, 'original.txt');
			const dst = join(dir, 'copied.txt');
			await writeFile(src, 'original');
			await copyFile(src, dst);
			const srcContent = await promises.readFile(src, 'utf-8');
			const dstContent = await promises.readFile(dst, 'utf-8');
			expect(srcContent).toBe('original');
			expect(dstContent).toBe('original');
			await rm(src);
			await rm(dst);
			await rmdir(dir);
		});
	});

	await describe('fs.promises.unlink', async () => {
		await it('should remove a file', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-punlink-'));
			const file = join(dir, 'to-delete.txt');
			await writeFile(file, 'delete me');
			expect(existsSync(file)).toBe(true);
			await unlink(file);
			expect(existsSync(file)).toBe(false);
			await rmdir(dir);
		});

		await it('should throw ENOENT for non-existent file', async () => {
			let threw = false;
			try {
				await unlink('/nonexistent/abc/delete-me.txt');
			} catch (e: unknown) {
				threw = true;
				expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
			}
			expect(threw).toBe(true);
		});
	});

	await describe('fs.promises.readdir additional', async () => {
		await it('should return sorted entries for multiple files', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-preaddir-sort-'));
			await writeFile(join(dir, 'c.txt'), '');
			await writeFile(join(dir, 'a.txt'), '');
			await writeFile(join(dir, 'b.txt'), '');
			const files = await readdir(dir);
			// readdir does not guarantee order, but should return all 3 entries
			expect(files.length).toBe(3);
			expect(files).toContain('a.txt');
			expect(files).toContain('b.txt');
			expect(files).toContain('c.txt');
			await promises.rm(dir, { recursive: true });
		});
	});

	await describe('fs.promises.appendFile', async () => {
		await it('should append data to an existing file', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pappend-'));
			const file = join(dir, 'append.txt');
			await writeFile(file, 'hello');
			await promises.appendFile(file, ' world');
			const content = await promises.readFile(file, 'utf-8');
			expect(content).toBe('hello world');
			await rm(file);
			await rmdir(dir);
		});

		await it('should create a new file if it does not exist', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pappend-new-'));
			const file = join(dir, 'new-append.txt');
			await promises.appendFile(file, 'created');
			expect(existsSync(file)).toBe(true);
			const content = await promises.readFile(file, 'utf-8');
			expect(content).toBe('created');
			await rm(file);
			await rmdir(dir);
		});
	});

	await describe('fs.promises.chmod', async () => {
		await it('should change file mode', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pchmod-'));
			const file = join(dir, 'chmod.txt');
			await writeFile(file, 'chmod test');
			await promises.chmod(file, 0o444);
			const s = await stat(file);
			// Check that the permission bits match (mask with 0o777 for portable comparison)
			expect(s.mode & 0o777).toBe(0o444);
			// Restore write permission for cleanup
			await promises.chmod(file, 0o644);
			await rm(file);
			await rmdir(dir);
		});
	});

	await describe('fs.promises.mkdtemp additional', async () => {
		await it('should create a directory with the given prefix', async () => {
			const prefix = join(tmpdir(), 'fs-pmkdtemp-test-');
			const dir = await promises.mkdtemp(prefix);
			expect(existsSync(dir)).toBe(true);
			expect(dir.startsWith(prefix)).toBe(true);
			// The random suffix should add characters
			expect(dir.length).toBeGreaterThan(prefix.length);
			await rmdir(dir);
		});
	});

	await describe('fs.promises.realpath', async () => {
		await it('should resolve a simple path', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-prealpath-'));
			const file = join(dir, 'real.txt');
			await writeFile(file, 'data');
			const resolved = await promises.realpath(file);
			// Should be an absolute path
			expect(resolved.startsWith('/')).toBe(true);
			// Should end with the file name
			expect(resolved.endsWith('real.txt')).toBe(true);
			await rm(file);
			await rmdir(dir);
		});
	});

	await describe('fs.promises.truncate', async () => {
		await it('should truncate a file to a specified length', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-ptrunc-'));
			const file = join(dir, 'trunc.txt');
			await writeFile(file, 'hello world');
			await promises.truncate(file, 5);
			const content = await promises.readFile(file, 'utf-8');
			expect(content).toBe('hello');
			await rm(file);
			await rmdir(dir);
		});

		await it('should truncate a file to zero length when no length specified', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-ptrunc0-'));
			const file = join(dir, 'trunc0.txt');
			await writeFile(file, 'data to remove');
			await promises.truncate(file);
			const content = await promises.readFile(file, 'utf-8');
			expect(content).toBe('');
			await rm(file);
			await rmdir(dir);
		});
	});

	await describe('fs.promises error cases', async () => {
		await it('readFile should reject for non-existent file', async () => {
			let threw = false;
			try {
				await promises.readFile('/nonexistent/path/xyz987.txt');
			} catch (e: unknown) {
				threw = true;
				expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
			}
			expect(threw).toBe(true);
		});

		await it('readdir should reject for non-existent directory', async () => {
			let threw = false;
			try {
				await readdir('/nonexistent/xyz654/dir');
			} catch (e: unknown) {
				threw = true;
				expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
			}
			expect(threw).toBe(true);
		});
	});

	await describe('fs.promises return types', async () => {
		await it('readFile should return a Promise', async () => {
			const p = promises.readFile('/etc/hosts');
			expect(p instanceof Promise).toBe(true);
			await p; // consume
		});

		await it('writeFile should return a Promise', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pret-wf-'));
			const file = join(dir, 'ret.txt');
			const p = writeFile(file, 'test');
			expect(p instanceof Promise).toBe(true);
			await p;
			await rm(file);
			await rmdir(dir);
		});

		await it('stat should return a Promise', async () => {
			const p = stat('/tmp');
			expect(p instanceof Promise).toBe(true);
			await p;
		});

		await it('mkdir should return a Promise', async () => {
			const dir = join(tmpdir(), 'fs-pret-mkdir-' + Date.now());
			const p = mkdir(dir);
			expect(p instanceof Promise).toBe(true);
			await p;
			await rmdir(dir);
		});

		await it('access should return a Promise', async () => {
			const p = access('/tmp', fsConstants.F_OK);
			expect(p instanceof Promise).toBe(true);
			await p;
		});

		await it('unlink should return a Promise', async () => {
			const dir = await mkdtemp(join(tmpdir(), 'fs-pret-ul-'));
			const file = join(dir, 'unlinkret.txt');
			await writeFile(file, '');
			const p = unlink(file);
			expect(p instanceof Promise).toBe(true);
			await p;
			await rmdir(dir);
		});
	});
}
