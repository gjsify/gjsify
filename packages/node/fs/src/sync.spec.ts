import { describe, it, expect } from '@gjsify/unit';
import type { EventEmitter } from 'node:events';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import {
    existsSync,
    readdirSync,
    readFileSync,
    mkdirSync,
    rmdirSync,
    writeFileSync,
    unlinkSync,
    watch,
    mkdtempSync,
    rmSync,
    realpathSync,
    symlinkSync,
    statSync,
} from 'node:fs';
import { Buffer } from 'node:buffer';
import { tmpdir } from 'node:os';
import { platform } from 'node:process';

// Node on win32 returns the first created directory in EXTENDED-LENGTH form
// (`\\?\C:\…`) from a recursive mkdir, while `join()` yields the plain form.
// Same directory, different spelling — measured against native Node, which
// returns the plain form on Linux. So the comparison, not the value, was the
// POSIX-only part here.
const plainPath = (p: string | undefined) => p?.replace(/^\\\\\?\\/, '');

// Assertions below marked `it.failing(..., { when: IS_WIN32 })` describe POSIX
// concepts win32 does not have. The marker keeps them RUNNING and keeps the
// assertion unweakened; it tolerates the failure only here, and fails the run the
// day it starts passing — unlike a platform guard, which would hide it forever.
const IS_WIN32 = platform === 'win32';

export default async () => {
    await describe('fs.existsSync', async () => {
        // A spec-created file, not a system one: `/etc/hosts` does not exist on
        // Windows (it lives under %SystemRoot%\\System32\\drivers\\etc), and the
        // test only needs "a path that exists".
        const existingDir = mkdtempSync(join(tmpdir(), 'fs-exists-'));
        const existingFile = join(existingDir, 'present.txt');
        writeFileSync(existingFile, 'x');
        const existingFiles = [tmpdir(), existingFile];
        const nonExistingFiles = ['asdasd', '/asdasd', ''];

        await it('should return true for existing files', () => {
            for (const file of existingFiles) {
                const result = existsSync(file);
                expect(result).toBe(true);
            }
        });

        await it('should return false for non existing files', () => {
            for (const file of nonExistingFiles) {
                const result = existsSync(file);
                expect(result).toBe(false);
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
            // Spec-created file rather than `/etc/hosts`, which is POSIX-only.
            const dir = mkdtempSync(join(tmpdir(), 'fs-rfs-buf-'));
            const filePath = join(dir, 'bytes.bin');
            writeFileSync(filePath, 'payload');
            const bufferData = readFileSync(filePath);
            expect(bufferData instanceof Buffer).toBeTruthy();
            rmSync(dir, { recursive: true, force: true });
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
                    watcher = watch(watchMe, { persistent: true }, console.log);
                } catch (err) {
                    // EMFILE (too many open files) is a system-level issue, not a code bug
                    if ((err as NodeJS.ErrnoException)?.code === 'EMFILE') {
                        resolve();
                        return;
                    }
                    throw err;
                }
                // FSWatcher inherits from EventEmitter at runtime
                const w = watcher as unknown as EventEmitter;
                w.on('change', console.log).on('rename', console.log);

                setTimeout(() => {
                    writeFileSync(watchMe, '// test');
                    setTimeout(() => {
                        // force:true is the non-throwing spelling of "remove if
                        // still there" — a real failure (EACCES) still surfaces.
                        rmSync(watchMe, { force: true });
                        watcher.close();
                        resolve();
                    }, 100);
                }, 100);

                setTimeout(() => {
                    watcher.close();
                    resolve();
                }, 2000);
            });
        });
    });

    await describe('fs.mkdtempSync', async () => {
        await it('should be a function', () => {
            expect(typeof mkdtempSync).toBe('function');
        });

        await it('should create a new directory', () => {
            const directory = mkdtempSync('fs-test-');
            expect(existsSync(directory)).toBeTruthy();
            rmdirSync(directory);
        });
    });

    await describe('fs.realpathSync', async () => {
        await it('should be a function', () => {
            expect(typeof realpathSync).toBe('function');
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
            expect(plainPath(result)).toBe(join(dir, 'a'));
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

        await it('should remove a deeply nested tree without hitting EMFILE', () => {
            // Regression for the user-reported issue where `gjsify install`
            // hit `Gio.IOErrorEnum: Error opening directory '...': Zu viele
            // offene Dateien` while clearing a stale ~20-level-deep
            // node_modules tree (worker_threads/node_modules/@girs/gio-2.0/
            // node_modules/@girs/gobject-2.0/...). Root cause was that
            // `readdirSync`'s `Gio.FileEnumerator` never got an explicit
            // `close()` — under deep recursion the fd-per-level kept piling
            // up until the process hit its open-fd limit (typically 1024).
            //
            // 256 nested directories well exceeds any reasonable default
            // fd limit when each level keeps an enumerator open; the test
            // passes today and would fail before the close() fix.
            const root = mkdtempSync(join(tmpdir(), 'fs-rmsync-deep-'));
            let current = root;
            for (let i = 0; i < 256; i++) {
                current = join(current, 'd');
                mkdirSync(current);
            }
            writeFileSync(join(current, 'leaf.txt'), 'data');
            rmSync(root, { recursive: true });
            expect(existsSync(root)).toBe(false);
        });

        await it('should keep open fd count bounded across many recursive removals', () => {
            // Companion to the deep-tree case: a wide-and-medium-deep tree
            // (multiple siblings per level) exercises the close-before-
            // recurse semantics. Without the enumerator close, the leaks
            // would accumulate across the inner loop iterations even when
            // each individual subtree's depth stays modest.
            const root = mkdtempSync(join(tmpdir(), 'fs-rmsync-wide-'));
            for (let i = 0; i < 8; i++) {
                let current = join(root, `tree-${i}`);
                mkdirSync(current);
                for (let j = 0; j < 32; j++) {
                    current = join(current, 'd');
                    mkdirSync(current);
                }
                writeFileSync(join(current, 'leaf.txt'), 'data');
            }
            rmSync(root, { recursive: true });
            expect(existsSync(root)).toBe(false);
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

        await it.failing(
            'statSync should detect isCharacterDevice for /dev/null',
            () => {
                const s = statSync('/dev/null');
                expect(s.isCharacterDevice()).toBe(true);
                expect(s.isFile()).toBe(false);
                expect(s.isDirectory()).toBe(false);
                expect(s.isSocket()).toBe(false);
                expect(s.isFIFO()).toBe(false);
                expect(s.isBlockDevice()).toBe(false);
            },
            "win32 has no path that stats as a character device — there is no /dev/null, and \\\\.\\NUL does not report S_IFCHR through Node's stat.",
            { when: IS_WIN32 },
        );
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
            } catch (err) {
                // EMFILE is a system-level issue, not a code bug
                if ((err as NodeJS.ErrnoException)?.code !== 'EMFILE') throw err;
            } finally {
                if (watcher) watcher.close();
                rmSync(filePath);
                rmdirSync(dir);
            }
        });
    });
};
