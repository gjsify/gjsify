// Ported from refs/node-test/parallel/test-fs-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import {
	existsSync, mkdtempSync, rmSync, writeFileSync, readFileSync,
	realpathSync, symlinkSync, unlinkSync, linkSync, chmodSync,
	statSync, lstatSync, mkdirSync, rmdirSync,
	createReadStream, createWriteStream,
	realpath, link, chmod, stat, lstat, readFile, writeFile,
} from 'node:fs';
import * as promises from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Buffer } from 'node:buffer';

export default async () => {

	// ==================== realpathSync ====================

	await describe('fs.realpathSync', async () => {
		await it('should resolve the real path of a file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'realpath-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'data');

			const resolved = realpathSync(filePath);
			expect(typeof resolved).toBe('string');
			expect(resolved.length).toBeGreaterThan(0);
			// Should be an absolute path
			expect(resolved.startsWith('/')).toBeTruthy();

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should resolve /tmp to its real path', async () => {
			const resolved = realpathSync('/tmp');
			expect(typeof resolved).toBe('string');
			expect(resolved.length).toBeGreaterThan(0);
		});

		await it('should throw for non-existent path', async () => {
			expect(() => realpathSync('/nonexistent_gjsify_test_path_12345')).toThrow();
		});
	});

	// ==================== realpath (callback) ====================

	await describe('fs.realpath (callback)', async () => {
		await it('should resolve the real path of a file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'realpath-cb-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'data');

			const resolved = await new Promise<string>((resolve, reject) => {
				realpath(filePath, (err, res) => {
					if (err) reject(err);
					else resolve(res);
				});
			});
			expect(typeof resolved).toBe('string');
			expect(resolved.startsWith('/')).toBeTruthy();

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should callback with error for non-existent path', async () => {
			const err = await new Promise<Error>((resolve) => {
				realpath('/nonexistent_gjsify_12345', (e) => {
					resolve(e!);
				});
			});
			expect(err).toBeDefined();
		});
	});

	// ==================== promises.stat / promises.lstat ====================

	await describe('fs.promises.stat', async () => {
		await it('should return stats for existing file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'pstat-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'hello');

			const stats = await promises.stat(filePath);
			expect(stats).toBeDefined();
			expect(stats.isFile()).toBeTruthy();
			expect(stats.isDirectory()).toBeFalsy();
			expect(stats.size).toBe(5);

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should return stats for directory', async () => {
			const stats = await promises.stat('/tmp');
			expect(stats.isDirectory()).toBeTruthy();
			expect(stats.isFile()).toBeFalsy();
		});

		await it('should reject for non-existent path', async () => {
			let threw = false;
			try {
				await promises.stat('/nonexistent_gjsify_12345');
			} catch {
				threw = true;
			}
			expect(threw).toBeTruthy();
		});
	});

	await describe('fs.promises.lstat', async () => {
		await it('should return stats for existing file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'plstat-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'data');

			const stats = await promises.lstat(filePath);
			expect(stats.isFile()).toBeTruthy();

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== linkSync / link ====================

	await describe('fs.linkSync', async () => {
		await it('should create a hard link', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'link-');
			const src = join(dir, 'original.txt');
			const dest = join(dir, 'hardlink.txt');
			writeFileSync(src, 'linked content');

			linkSync(src, dest);
			expect(existsSync(dest)).toBeTruthy();
			expect(String(readFileSync(dest, 'utf-8'))).toBe('linked content');

			// Hard links share the same inode
			const srcStat = statSync(src);
			const destStat = statSync(dest);
			expect(srcStat.ino).toBe(destStat.ino);

			rmSync(dest);
			rmSync(src);
			rmdirSync(dir);
		});
	});

	await describe('fs.link (callback)', async () => {
		await it('should create a hard link asynchronously', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'link-cb-');
			const src = join(dir, 'src.txt');
			const dest = join(dir, 'link.txt');
			writeFileSync(src, 'data');

			await new Promise<void>((resolve, reject) => {
				link(src, dest, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
			expect(existsSync(dest)).toBeTruthy();

			rmSync(dest);
			rmSync(src);
			rmdirSync(dir);
		});
	});

	// ==================== stat / lstat (callback) extended ====================

	await describe('fs.stat (callback) extended', async () => {
		await it('should return file size', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'stat-ext-');
			const filePath = join(dir, 'sized.txt');
			writeFileSync(filePath, 'hello world');

			const stats = await new Promise<any>((resolve, reject) => {
				stat(filePath, (err, s) => {
					if (err) reject(err);
					else resolve(s);
				});
			});
			expect(stats.size).toBe(11);
			expect(stats.isFile()).toBeTruthy();

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should error for non-existent file', async () => {
			const err = await new Promise<Error>((resolve) => {
				stat('/nonexistent_gjsify_12345', (e) => resolve(e!));
			});
			expect(err).toBeDefined();
		});
	});

	await describe('fs.lstat (callback)', async () => {
		await it('should return stats for file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'lstat-cb-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'data');

			const stats = await new Promise<any>((resolve, reject) => {
				lstat(filePath, (err, s) => {
					if (err) reject(err);
					else resolve(s);
				});
			});
			expect(stats.isFile()).toBeTruthy();

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== chmodSync / chmod ====================

	await describe('fs.chmodSync', async () => {
		await it('should change file permissions', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'chmod-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'data');

			chmodSync(filePath, 0o644);
			const stats = statSync(filePath);
			// Check permission bits (mask out file type bits)
			expect(stats.mode & 0o777).toBe(0o644);

			chmodSync(filePath, 0o755);
			const stats2 = statSync(filePath);
			expect(stats2.mode & 0o777).toBe(0o755);

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	await describe('fs.chmod (callback)', async () => {
		await it('should change file permissions asynchronously', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'chmod-cb-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'data');

			await new Promise<void>((resolve, reject) => {
				chmod(filePath, 0o600, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
			const stats = statSync(filePath);
			expect(stats.mode & 0o777).toBe(0o600);

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== promises.chmod ====================

	await describe('fs.promises.chmod', async () => {
		await it('should change file permissions', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'pchmod-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'data');

			await promises.chmod(filePath, 0o640);
			const stats = statSync(filePath);
			expect(stats.mode & 0o777).toBe(0o640);

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== promises.writeFile / readFile ====================

	await describe('fs.promises.writeFile / readFile extended', async () => {
		await it('should write and read Buffer data', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'prw-');
			const filePath = join(dir, 'buf.bin');
			const data = Buffer.from([0x00, 0x01, 0x02, 0xff]);

			await promises.writeFile(filePath, data);
			const read = await promises.readFile(filePath);
			expect(read.length).toBe(4);

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should write and read string with encoding', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'prw-str-');
			const filePath = join(dir, 'str.txt');

			await promises.writeFile(filePath, 'hello promises', 'utf8');
			const content = await promises.readFile(filePath, 'utf8');
			expect(content).toBe('hello promises');

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== promises.rename ====================

	await describe('fs.promises.rename', async () => {
		await it('should rename a file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'prename-');
			const old = join(dir, 'old.txt');
			const newPath = join(dir, 'new.txt');
			writeFileSync(old, 'rename me');

			await promises.rename(old, newPath);
			expect(existsSync(newPath)).toBeTruthy();
			expect(existsSync(old)).toBeFalsy();

			rmSync(newPath);
			rmdirSync(dir);
		});
	});

	// ==================== promises.access ====================

	await describe('fs.promises.access', async () => {
		await it('should resolve for existing file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'paccess-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'data');

			await promises.access(filePath);
			// Should not throw

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should reject for non-existent file', async () => {
			let threw = false;
			try {
				await promises.access('/nonexistent_gjsify_12345');
			} catch {
				threw = true;
			}
			expect(threw).toBeTruthy();
		});
	});

	// ==================== promises.appendFile ====================

	await describe('fs.promises.appendFile', async () => {
		await it('should append to a file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'pappend-');
			const filePath = join(dir, 'append.txt');
			writeFileSync(filePath, 'first');

			await promises.appendFile(filePath, ' second');
			const content = await promises.readFile(filePath, 'utf8');
			expect(content).toBe('first second');

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== promises.copyFile ====================

	await describe('fs.promises.copyFile', async () => {
		await it('should copy a file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'pcopy-');
			const src = join(dir, 'src.txt');
			const dest = join(dir, 'copy.txt');
			writeFileSync(src, 'copy me');

			await promises.copyFile(src, dest);
			const content = await promises.readFile(dest, 'utf8');
			expect(content).toBe('copy me');

			rmSync(dest);
			rmSync(src);
			rmdirSync(dir);
		});
	});

	// ==================== promises.truncate ====================

	await describe('fs.promises.truncate', async () => {
		await it('should truncate a file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'ptrunc-');
			const filePath = join(dir, 'trunc.txt');
			writeFileSync(filePath, 'hello world');

			await promises.truncate(filePath, 5);
			const content = await promises.readFile(filePath, 'utf8');
			expect(content).toBe('hello');

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== promises.realpath ====================

	await describe('fs.promises.realpath', async () => {
		await it('should resolve real path', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'prealpath-');
			const filePath = join(dir, 'file.txt');
			writeFileSync(filePath, 'data');

			const resolved = await promises.realpath(filePath);
			expect(typeof resolved).toBe('string');
			expect(resolved.startsWith('/')).toBeTruthy();

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== promises.link ====================

	await describe('fs.promises.link', async () => {
		await it('should create a hard link', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'plink-');
			const src = join(dir, 'src.txt');
			const dest = join(dir, 'link.txt');
			writeFileSync(src, 'linked');

			await promises.link(src, dest);
			const content = await promises.readFile(dest, 'utf8');
			expect(content).toBe('linked');

			rmSync(dest);
			rmSync(src);
			rmdirSync(dir);
		});
	});

	// ==================== createReadStream extended ====================

	await describe('createReadStream extended', async () => {
		await it('should emit end event', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'crs-');
			const filePath = join(dir, 'read.txt');
			writeFileSync(filePath, 'stream data');

			const stream = createReadStream(filePath, { encoding: 'utf8' });
			const chunks: string[] = [];
			await new Promise<void>((resolve) => {
				stream.on('data', (chunk) => chunks.push(chunk as string));
				stream.on('end', () => resolve());
			});
			expect(chunks.join('')).toBe('stream data');

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should handle empty file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'crs-empty-');
			const filePath = join(dir, 'empty.txt');
			writeFileSync(filePath, '');

			const stream = createReadStream(filePath, { encoding: 'utf8' });
			const chunks: string[] = [];
			await new Promise<void>((resolve) => {
				stream.on('data', (chunk) => chunks.push(chunk as string));
				stream.on('end', () => resolve());
			});
			expect(chunks.join('')).toBe('');

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should emit error for non-existent file', async () => {
			const stream = createReadStream('/nonexistent_gjsify_12345');
			const err = await new Promise<Error>((resolve) => {
				stream.on('error', (e) => resolve(e));
			});
			expect(err).toBeDefined();
		});
	});

	// ==================== createWriteStream extended ====================

	await describe('createWriteStream extended', async () => {
		await it('should write data to file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'cws-');
			const filePath = join(dir, 'write.txt');

			const stream = createWriteStream(filePath);
			await new Promise<void>((resolve) => {
				stream.write('hello ');
				stream.write('world');
				stream.end(() => resolve());
			});

			const content = readFileSync(filePath, 'utf8');
			expect(content).toBe('hello world');

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should emit finish event', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'cws-fin-');
			const filePath = join(dir, 'finish.txt');

			const stream = createWriteStream(filePath);
			const finished = await new Promise<boolean>((resolve) => {
				stream.on('finish', () => resolve(true));
				stream.end('done');
			});
			expect(finished).toBeTruthy();

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== readFile / writeFile callback extended ====================

	await describe('fs.readFile / writeFile callback extended', async () => {
		await it('readFile should accept encoding option', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'rf-enc-');
			const filePath = join(dir, 'encoded.txt');
			writeFileSync(filePath, 'encoded content');

			const data = await new Promise<string>((resolve, reject) => {
				readFile(filePath, 'utf8', (err, d) => {
					if (err) reject(err);
					else resolve(d as string);
				});
			});
			expect(data).toBe('encoded content');

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('readFile should return Buffer without encoding', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'rf-buf-');
			const filePath = join(dir, 'raw.txt');
			writeFileSync(filePath, 'raw');

			const data = await new Promise<Buffer>((resolve, reject) => {
				readFile(filePath, (err, d) => {
					if (err) reject(err);
					else resolve(d as Buffer);
				});
			});
			expect(data instanceof Uint8Array).toBeTruthy();

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('writeFile callback should complete without error', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'wf-cb-');
			const filePath = join(dir, 'written.txt');

			await new Promise<void>((resolve, reject) => {
				writeFile(filePath, 'callback write', (err) => {
					if (err) reject(err);
					else resolve();
				});
			});
			expect(readFileSync(filePath, 'utf8')).toBe('callback write');

			rmSync(filePath);
			rmdirSync(dir);
		});
	});

	// ==================== statSync extended ====================

	await describe('fs.statSync extended', async () => {
		await it('should return file timestamps', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'stat-ts-');
			const filePath = join(dir, 'timed.txt');
			writeFileSync(filePath, 'data');

			const stats = statSync(filePath);
			expect(stats.atime).toBeDefined();
			expect(stats.mtime).toBeDefined();
			expect(stats.ctime).toBeDefined();
			expect(stats.birthtime).toBeDefined();
			expect(stats.atimeMs).toBeGreaterThan(0);
			expect(stats.mtimeMs).toBeGreaterThan(0);

			rmSync(filePath);
			rmdirSync(dir);
		});

		await it('should return correct nlink for hard links', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'stat-nlink-');
			const src = join(dir, 'src.txt');
			const link1 = join(dir, 'link1.txt');
			writeFileSync(src, 'data');

			const before = statSync(src);
			expect(before.nlink).toBe(1);

			linkSync(src, link1);
			const after = statSync(src);
			expect(after.nlink).toBe(2);

			rmSync(link1);
			rmSync(src);
			rmdirSync(dir);
		});
	});

	// ==================== symlink creation ====================

	await describe('fs.symlinkSync (creation)', async () => {
		await it('should create and read a symlink', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'sym-');
			const target = join(dir, 'target.txt');
			const link = join(dir, 'symlink.txt');
			writeFileSync(target, 'symlink content');

			symlinkSync(target, link);
			expect(existsSync(link)).toBeTruthy();

			// lstatSync should show it as a symlink
			const stats = lstatSync(link);
			expect(stats.isSymbolicLink()).toBeTruthy();

			// Reading through the symlink should give original content
			expect(readFileSync(link, 'utf8')).toBe('symlink content');

			unlinkSync(link);
			rmSync(target);
			rmdirSync(dir);
		});
	});

	// ==================== promises.symlink ====================

	await describe('fs.promises.symlink', async () => {
		await it('should create a symlink', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'psym-');
			const target = join(dir, 'target.txt');
			const link = join(dir, 'link.txt');
			writeFileSync(target, 'data');

			await promises.symlink(target, link);
			expect(existsSync(link)).toBeTruthy();

			const stats = await promises.lstat(link);
			expect(stats.isSymbolicLink()).toBeTruthy();

			unlinkSync(link);
			rmSync(target);
			rmdirSync(dir);
		});
	});

	// ==================== promises.unlink ====================

	await describe('fs.promises.unlink', async () => {
		await it('should delete a file', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'punlink-');
			const filePath = join(dir, 'delete.txt');
			writeFileSync(filePath, 'delete me');

			await promises.unlink(filePath);
			expect(existsSync(filePath)).toBeFalsy();

			rmdirSync(dir);
		});
	});

	// ==================== promises.mkdir / rmdir ====================

	await describe('fs.promises.mkdir / rmdir', async () => {
		await it('should create and remove a directory', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'pmkdir-');
			const subdir = join(dir, 'subdir');

			await promises.mkdir(subdir);
			const stats = await promises.stat(subdir);
			expect(stats.isDirectory()).toBeTruthy();

			await promises.rmdir(subdir);
			expect(existsSync(subdir)).toBeFalsy();

			rmdirSync(dir);
		});

		await it('should create nested directories with recursive', async () => {
			const dir = mkdtempSync(join(tmpdir(), 'fs-') + 'pmkdir-rec-');
			const nested = join(dir, 'a', 'b', 'c');

			await promises.mkdir(nested, { recursive: true });
			expect(existsSync(nested)).toBeTruthy();

			rmSync(dir, { recursive: true });
		});
	});
};
