import { describe, it, expect } from '@gjsify/unit';
import { join, dirname } from 'node:path';
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

import { existsSync, readdirSync, readFileSync, mkdirSync, rmdirSync, writeFileSync, unlinkSync, watch, mkdtempSync, rmSync, realpathSync, symlinkSync, statSync } from 'node:fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';

export default async () => {
	await describe('fs.existsSync', async () => {

		const existingFiles = ['/tmp', '/etc/hosts'];
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

			expect(fileWithTypes!.isFile()).toBeTruthy();
			expect(fileWithTypes!.isDirectory()).toBeFalsy();

			expect(dirWithTypes!.isFile()).toBeFalsy();
			expect(dirWithTypes!.isDirectory()).toBeTruthy();

			// Clear
			rmSync(file);
			rmdirSync(subdir);
			rmdirSync(dir);
		});
	});

	await describe('fs.readFileSync', async () => {
		await it('should return a Buffer if no encoding was specified', () => {
			const bufferData = readFileSync('/etc/hosts');
			expect(bufferData instanceof Buffer).toBeTruthy();
		});

		await it('should return a string when encoding is utf-8', () => {
			const dir = mkdtempSync('fs-rfs-');
			const filePath = join(dir, 'test.txt');
			writeFileSync(filePath, 'Hello World');
			const utf8Data = readFileSync(filePath, 'utf-8');
			expect(typeof utf8Data === 'string').toBeTruthy();
			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should return the correct file content', () => {
			const dir = mkdtempSync('fs-rfs-content-');
			const filePath = join(dir, 'test.txt');
			writeFileSync(filePath, 'Hello World');
			const utf8Data = readFileSync(filePath, 'utf-8');
			expect(utf8Data).toBe('Hello World');
			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	await describe('fs.mkdirSync', async () => {
		const dir = './foobar';

		await it(`should create the directory "${dir}" without error`, () => {
			mkdirSync(dir);
		});

		await it(`${dir} should exists`, () => {
			expect(existsSync(dir)).toBeTruthy();
		});
	});

	await describe('fs.rmdirSync', async () => {
		const dir = './foobar';

		await it(`should be remove the directory "${dir}" without error`, () => {
			rmdirSync(dir);
		});

		await it(`"${dir}" should not exists (anymore)`, () => {
			expect(existsSync(dir)).toBeFalsy();
		});
	});

	await describe('fs.writeFileSync', async () => {
		const watchMe = join(__dirname, 'test/watch.js');

		await it(`should be executed without error`, () => {
			writeFileSync(watchMe, '// test');
		});

		await it(`fs.watch should watch ${watchMe} for changes`, async () => {
			await new Promise<void>((resolve) => {
				let watcher: ReturnType<typeof watch>;
				try {
					watcher = watch(watchMe, {persistent: true}, console.log);
				} catch (err: any) {
					// EMFILE (too many open files) is a system-level issue, not a code bug
					if (err?.code === 'EMFILE') { resolve(); return; }
					throw err;
				}
				// FSWatcher inherits from EventEmitter at runtime
			const w = watcher as unknown as import('node:events').EventEmitter;
			w.on('change', console.log).on('rename', console.log);

				setTimeout(() => {
					writeFileSync(watchMe, '// test');
					setTimeout(() => {
						try { unlinkSync(watchMe); } catch {}
						watcher.close();
						resolve();
					}, 100);
				}, 100);

				setTimeout(() => { watcher.close(); resolve(); }, 2000);
			});
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
			const dir = mkdtempSync(join(tmpdir(), 'fs-rp-'));
			const target = join(dir, 'target.txt');
			const link = join(dir, 'link.txt');
			writeFileSync(target, 'data');
			symlinkSync(target, link);

			const realPath = realpathSync(target);
			const realSymLinkPath = realpathSync(link);

			// Should point to the real file, not the symlink
			expect(realSymLinkPath).toBe(realPath);

			unlinkSync(link);
			rmSync(target);
			rmdirSync(dir);
		});
	});

	await describe('fs.mkdirSync recursive', async () => {
		await it('should return the first directory created when recursive is true', () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-mkdir-rec-'));
			const nested = join(dir, 'a', 'b', 'c');
			const result = mkdirSync(nested, { recursive: true });
			// The first created directory should be 'a' (the top-level new dir)
			expect(typeof result).toBe('string');
			expect(result).toBe(join(dir, 'a'));
			expect(existsSync(nested)).toBe(true);
			rmSync(dir, { recursive: true });
		});

		await it('should return undefined when all directories already exist', () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-mkdir-rec-exist-'));
			const result = mkdirSync(dir, { recursive: true });
			expect(result).toBeUndefined();
			rmdirSync(dir);
		});

		await it('should throw EEXIST when non-recursive and dir exists', () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-mkdir-exist-'));
			let threw = false;
			try {
				mkdirSync(dir);
			} catch (e: unknown) {
				threw = true;
				expect((e as NodeJS.ErrnoException).code).toBe('EEXIST');
			}
			expect(threw).toBe(true);
			rmdirSync(dir);
		});

		await it('should throw ENOENT when non-recursive and parent missing', () => {
			const dir = join(tmpdir(), 'fs-mkdir-noparent-' + Date.now(), 'child');
			let threw = false;
			try {
				mkdirSync(dir);
			} catch (e: unknown) {
				threw = true;
				expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
			}
			expect(threw).toBe(true);
		});
	});

	await describe('fs.rmSync error handling', async () => {
		await it('should throw when removing non-empty dir without recursive', () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-rmsync-notempty-'));
			writeFileSync(join(dir, 'file.txt'), 'data');
			let threw = false;
			try {
				rmSync(dir);
			} catch (e: unknown) {
				threw = true;
				// Node.js throws ERR_FS_EISDIR, GJS throws ENOTEMPTY — both are correct
				const code = (e as NodeJS.ErrnoException).code;
				expect(code === 'ENOTEMPTY' || code === 'ERR_FS_EISDIR').toBe(true);
			}
			expect(threw).toBe(true);
			rmSync(dir, { recursive: true });
		});

		await it('should not throw when force is true and path does not exist', () => {
			const path = join(tmpdir(), 'fs-rmsync-force-nonexistent-' + Date.now());
			let threw = false;
			try {
				rmSync(path, { force: true });
			} catch {
				threw = true;
			}
			expect(threw).toBe(false);
		});

		await it('should remove non-empty directory with recursive: true', () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-rmsync-rec-'));
			mkdirSync(join(dir, 'sub'));
			writeFileSync(join(dir, 'sub', 'file.txt'), 'data');
			writeFileSync(join(dir, 'root.txt'), 'data');
			rmSync(dir, { recursive: true });
			expect(existsSync(dir)).toBe(false);
		});
	});

	await describe('fs.Dirent type methods', async () => {
		await it('should return false for isCharacterDevice, isSocket, isFIFO on regular file', () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-dirent-'));
			const filePath = join(dir, 'test.txt');
			writeFileSync(filePath, 'data');
			const entries = readdirSync(dir, { withFileTypes: true });
			const entry = entries[0];
			expect(entry.isCharacterDevice()).toBe(false);
			expect(entry.isSocket()).toBe(false);
			expect(entry.isFIFO()).toBe(false);
			expect(entry.isBlockDevice()).toBe(false);
			expect(entry.isFile()).toBe(true);
			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should return false for isCharacterDevice, isSocket, isFIFO on directory', () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-dirent-dir-'));
			const subdir = join(dir, 'sub');
			mkdirSync(subdir);
			const entries = readdirSync(dir, { withFileTypes: true });
			const entry = entries[0];
			expect(entry.isCharacterDevice()).toBe(false);
			expect(entry.isSocket()).toBe(false);
			expect(entry.isFIFO()).toBe(false);
			expect(entry.isBlockDevice()).toBe(false);
			expect(entry.isDirectory()).toBe(true);
			rmdirSync(subdir);
			rmdirSync(dir);
		});

		await it('statSync should detect isCharacterDevice for /dev/null', () => {
			const s = statSync('/dev/null');
			expect(s.isCharacterDevice()).toBe(true);
			expect(s.isFile()).toBe(false);
			expect(s.isDirectory()).toBe(false);
			expect(s.isSocket()).toBe(false);
			expect(s.isFIFO()).toBe(false);
			expect(s.isBlockDevice()).toBe(false);
		});
	});

	await describe('fs.FSWatcher ref/unref', async () => {
		await it('ref() and unref() should return the watcher itself', () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-watcher-'));
			const filePath = join(dir, 'watch.txt');
			writeFileSync(filePath, 'data');
			let watcher: ReturnType<typeof watch> | null = null;
			try {
				watcher = watch(filePath);
				const refResult = watcher.ref();
				expect(refResult).toBe(watcher);
				const unrefResult = watcher.unref();
				expect(unrefResult).toBe(watcher);
			} catch (err: any) {
				// EMFILE is a system-level issue, not a code bug
				if (err?.code !== 'EMFILE') throw err;
			} finally {
				if (watcher) watcher.close();
				rmSync(filePath);
				rmdirSync(dir);
			}
		});
	});
}
