// Ported from refs/node/test/parallel/test-fs-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import {
	existsSync, mkdtempSync, rmdirSync, rmSync, writeFileSync, readFileSync,
	renameSync, copyFileSync, accessSync, appendFileSync, readlinkSync,
	symlinkSync, unlinkSync, truncateSync, createReadStream, createWriteStream,
	constants, mkdirSync,
	rename, copyFile, access, appendFile, readFile, writeFile,
} from 'fs';
import * as promises from 'fs/promises';
import { Buffer } from 'buffer';
import { join } from 'path';

export default async () => {

	// ==================== constants ====================

	await describe('fs.constants', async () => {
		await it('should export F_OK, R_OK, W_OK, X_OK', async () => {
			expect(constants.F_OK).toBe(0);
			expect(constants.R_OK).toBe(4);
			expect(constants.W_OK).toBe(2);
			expect(constants.X_OK).toBe(1);
		});

		await it('should export COPYFILE_EXCL', async () => {
			expect(constants.COPYFILE_EXCL).toBe(1);
		});

		await it('should export file type constants', async () => {
			expect(constants.S_IFMT).toBeDefined();
			expect(constants.S_IFREG).toBeDefined();
			expect(constants.S_IFDIR).toBeDefined();
		});

		await it('should export file mode constants', async () => {
			expect(constants.S_IRUSR).toBeDefined();
			expect(constants.S_IWUSR).toBeDefined();
			expect(constants.S_IXUSR).toBeDefined();
		});
	});

	// ==================== renameSync ====================

	await describe('fs.renameSync', async () => {
		await it('should rename a file', async () => {
			const dir = mkdtempSync('fs-test-');
			const oldPath = join(dir, 'old.txt');
			const newPath = join(dir, 'new.txt');
			writeFileSync(oldPath, 'content');
			renameSync(oldPath, newPath);

			expect(existsSync(newPath)).toBeTruthy();
			expect(existsSync(oldPath)).toBeFalsy();
			expect(String(readFileSync(newPath, 'utf-8'))).toBe('content');

			rmSync(newPath);
			rmdirSync(dir);
		});
	});

	// ==================== rename (callback) ====================

	await describe('fs.rename (callback)', async () => {
		await it('should rename a file asynchronously', async () => {
			const dir = mkdtempSync('fs-test-');
			const oldPath = join(dir, 'old.txt');
			const newPath = join(dir, 'new.txt');
			writeFileSync(oldPath, 'data');

			await new Promise<void>((resolve, reject) => {
				rename(oldPath, newPath, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});

			expect(existsSync(newPath)).toBeTruthy();
			expect(existsSync(oldPath)).toBeFalsy();

			rmSync(newPath);
			rmdirSync(dir);
		});
	});

	// ==================== copyFileSync ====================

	await describe('fs.copyFileSync', async () => {
		await it('should copy a file', async () => {
			const dir = mkdtempSync('fs-test-');
			const src = join(dir, 'src.txt');
			const dest = join(dir, 'dest.txt');
			writeFileSync(src, 'copy me');
			copyFileSync(src, dest);

			expect(existsSync(dest)).toBeTruthy();
			expect(String(readFileSync(dest, 'utf-8'))).toBe('copy me');

			rmSync(src);
			rmSync(dest);
			rmdirSync(dir);
		});

		await it('should overwrite existing file by default', async () => {
			const dir = mkdtempSync('fs-test-');
			const src = join(dir, 'src.txt');
			const dest = join(dir, 'dest.txt');
			writeFileSync(src, 'new content');
			writeFileSync(dest, 'old content');
			copyFileSync(src, dest);

			expect(String(readFileSync(dest, 'utf-8'))).toBe('new content');

			rmSync(src);
			rmSync(dest);
			rmdirSync(dir);
		});
	});

	// ==================== copyFile (callback) ====================

	await describe('fs.copyFile (callback)', async () => {
		await it('should copy a file asynchronously', async () => {
			const dir = mkdtempSync('fs-test-');
			const src = join(dir, 'src.txt');
			const dest = join(dir, 'dest.txt');
			writeFileSync(src, 'async copy');

			await new Promise<void>((resolve, reject) => {
				copyFile(src, dest, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});

			expect(existsSync(dest)).toBeTruthy();

			rmSync(src);
			rmSync(dest);
			rmdirSync(dir);
		});
	});

	// ==================== accessSync ====================

	await describe('fs.accessSync', async () => {
		await it('should not throw for existing file with F_OK', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'test.txt');
			writeFileSync(file, '');

			let threw = false;
			try {
				accessSync(file, constants.F_OK);
			} catch {
				threw = true;
			}
			expect(threw).toBeFalsy();

			rmSync(file);
			rmdirSync(dir);
		});

		await it('should throw for non-existing file', async () => {
			let threw = false;
			try {
				accessSync('/nonexistent/path/file.txt');
			} catch {
				threw = true;
			}
			expect(threw).toBeTruthy();
		});

		await it('should check read permission with R_OK', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'test.txt');
			writeFileSync(file, '');

			let threw = false;
			try {
				accessSync(file, constants.R_OK);
			} catch {
				threw = true;
			}
			expect(threw).toBeFalsy();

			rmSync(file);
			rmdirSync(dir);
		});
	});

	// ==================== access (callback) ====================

	await describe('fs.access (callback)', async () => {
		await it('should callback without error for existing file', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'test.txt');
			writeFileSync(file, '');

			await new Promise<void>((resolve, reject) => {
				access(file, (err) => {
					if (err) reject(err);
					else resolve();
				});
			});

			rmSync(file);
			rmdirSync(dir);
		});

		await it('should callback with error for non-existing file', async () => {
			const err = await new Promise<Error>((resolve) => {
				access('/nonexistent/path', (e) => {
					resolve(e as Error);
				});
			});
			expect(err).toBeDefined();
		});
	});

	// ==================== appendFileSync ====================

	await describe('fs.appendFileSync', async () => {
		await it('should append data to a file', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'append.txt');
			writeFileSync(file, 'hello');
			appendFileSync(file, ' world');

			expect(String(readFileSync(file, 'utf-8'))).toBe('hello world');

			rmSync(file);
			rmdirSync(dir);
		});

		await it('should create file if it does not exist', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'new.txt');
			appendFileSync(file, 'created');

			expect(existsSync(file)).toBeTruthy();
			expect(String(readFileSync(file, 'utf-8'))).toBe('created');

			rmSync(file);
			rmdirSync(dir);
		});
	});

	// ==================== appendFile (callback) ====================

	await describe('fs.appendFile (callback)', async () => {
		await it('should append data asynchronously', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'append.txt');
			writeFileSync(file, 'start');

			await new Promise<void>((resolve, reject) => {
				appendFile(file, '-end', (err) => {
					if (err) reject(err);
					else resolve();
				});
			});

			expect(String(readFileSync(file, 'utf-8'))).toBe('start-end');

			rmSync(file);
			rmdirSync(dir);
		});
	});

	// ==================== truncateSync ====================

	await describe('fs.truncateSync', async () => {
		await it('should truncate a file to 0 bytes', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'truncate.txt');
			writeFileSync(file, 'hello world');
			truncateSync(file);

			expect(String(readFileSync(file, 'utf-8'))).toBe('');

			rmSync(file);
			rmdirSync(dir);
		});
	});

	// ==================== readlinkSync ====================

	await describe('fs.readlinkSync', async () => {
		await it('should read symlink target', async () => {
			const dir = mkdtempSync('fs-test-');
			const target = join(dir, 'target.txt');
			const link = join(dir, 'link.txt');
			writeFileSync(target, 'data');
			symlinkSync(target, link);

			const result = readlinkSync(link);
			expect(String(result)).toBe(target);

			unlinkSync(link);
			rmSync(target);
			rmdirSync(dir);
		});
	});

	// ==================== readFile / writeFile (callback) ====================

	await describe('fs.readFile / fs.writeFile (callback)', async () => {
		await it('should write and read a file', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'rw.txt');

			await new Promise<void>((resolve, reject) => {
				writeFile(file, 'callback data', (err) => {
					if (err) reject(err);
					else resolve();
				});
			});

			const data = await new Promise<string>((resolve, reject) => {
				readFile(file, 'utf-8', (err, data) => {
					if (err) reject(err);
					else resolve(String(data));
				});
			});

			expect(data).toBe('callback data');

			rmSync(file);
			rmdirSync(dir);
		});
	});

	// ==================== createReadStream ====================

	await describe('fs.createReadStream', async () => {
		await it('should read file contents via stream', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'stream.txt');
			writeFileSync(file, 'stream data');

			const rs = createReadStream(file);
			const chunks: Buffer[] = [];

			await new Promise<void>((resolve, reject) => {
				rs.on('data', (chunk: Buffer) => chunks.push(chunk));
				rs.on('end', () => resolve());
				rs.on('error', reject);
			});

			const content = Buffer.concat(chunks).toString('utf-8');
			expect(content).toBe('stream data');
			expect(rs.bytesRead).toBe(11);

			rmSync(file);
			rmdirSync(dir);
		});

		await it('should emit open and ready events', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'events.txt');
			writeFileSync(file, 'test');

			const rs = createReadStream(file);
			let openEmitted = false;
			let readyEmitted = false;

			rs.on('open', () => { openEmitted = true; });
			rs.on('ready', () => { readyEmitted = true; });

			await new Promise<void>((resolve) => {
				rs.on('end', () => resolve());
				rs.resume();
			});

			expect(openEmitted).toBeTruthy();
			expect(readyEmitted).toBeTruthy();

			rmSync(file);
			rmdirSync(dir);
		});
	});

	// ==================== createWriteStream ====================

	await describe('fs.createWriteStream', async () => {
		await it('should write file contents via stream', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'ws.txt');

			const ws = createWriteStream(file, {});

			await new Promise<void>((resolve, reject) => {
				ws.on('open', () => {
					ws.write('hello ');
					ws.end('world');
				});
				ws.on('finish', () => resolve());
				ws.on('error', reject);
			});

			const content = String(readFileSync(file, 'utf-8'));
			expect(content).toBe('hello world');

			rmSync(file);
			rmdirSync(dir);
		});
	});

	// ==================== promises.rename ====================

	await describe('fs.promises.rename', async () => {
		await it('should rename a file', async () => {
			const dir = mkdtempSync('fs-test-');
			const oldPath = join(dir, 'old.txt');
			const newPath = join(dir, 'new.txt');
			writeFileSync(oldPath, 'data');

			await promises.rename(oldPath, newPath);
			expect(existsSync(newPath)).toBeTruthy();
			expect(existsSync(oldPath)).toBeFalsy();

			rmSync(newPath);
			rmdirSync(dir);
		});
	});

	// ==================== promises.copyFile ====================

	await describe('fs.promises.copyFile', async () => {
		await it('should copy a file', async () => {
			const dir = mkdtempSync('fs-test-');
			const src = join(dir, 'src.txt');
			const dest = join(dir, 'dest.txt');
			writeFileSync(src, 'copy data');

			await promises.copyFile(src, dest);
			expect(existsSync(dest)).toBeTruthy();
			expect(String(readFileSync(dest, 'utf-8'))).toBe('copy data');

			rmSync(src);
			rmSync(dest);
			rmdirSync(dir);
		});
	});

	// ==================== promises.access ====================

	await describe('fs.promises.access', async () => {
		await it('should resolve for existing file', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'test.txt');
			writeFileSync(file, '');

			await promises.access(file);

			rmSync(file);
			rmdirSync(dir);
		});

		await it('should reject for non-existing file', async () => {
			let threw = false;
			try {
				await promises.access('/nonexistent/path/file.txt');
			} catch {
				threw = true;
			}
			expect(threw).toBeTruthy();
		});
	});

	// ==================== promises.appendFile ====================

	await describe('fs.promises.appendFile', async () => {
		await it('should append data to a file', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'append.txt');
			writeFileSync(file, 'hello');

			await promises.appendFile(file, ' world');
			expect(String(readFileSync(file, 'utf-8'))).toBe('hello world');

			rmSync(file);
			rmdirSync(dir);
		});
	});

	// ==================== promises.truncate ====================

	await describe('fs.promises.truncate', async () => {
		await it('should truncate a file', async () => {
			const dir = mkdtempSync('fs-test-');
			const file = join(dir, 'trunc.txt');
			writeFileSync(file, 'hello world');

			await promises.truncate(file);
			expect(String(readFileSync(file, 'utf-8'))).toBe('');

			rmSync(file);
			rmdirSync(dir);
		});
	});
};
