// Ported from refs/node-test/parallel/test-fs-read-file*.js, test-fs-write-file*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import {
  open, close, write, read, rm,
  stat, lstat, readdir, readFile, writeFile,
  rename, copyFile, access, appendFile, truncate,
  mkdir, chmod,
} from 'fs';
import { constants } from 'fs';
import { Buffer } from 'buffer';

const TEST_DIR = './test-callback-' + Date.now();

export default async () => {
  await describe('fs callback API', async () => {

    // ==================== stat / lstat ====================
    await describe('stat', async () => {
      await it('should stat current directory', async () => {
        await new Promise<void>((resolve, reject) => {
          stat('.', (err, stats) => {
            if (err) return reject(err);
            expect(stats).toBeDefined();
            expect(stats.isDirectory()).toBe(true);
            expect(stats.isFile()).toBe(false);
            expect(typeof stats.size).toBe('number');
            expect(typeof stats.mode).toBe('number');
            resolve();
          });
        });
      });

      await it('should return error for non-existent path', async () => {
        await new Promise<void>((resolve, reject) => {
          stat('/non/existent/path/xyz', (err) => {
            try {
              expect(err).toBeDefined();
              resolve();
            } catch (e) { reject(e); }
          });
        });
      });
    });

    await describe('lstat', async () => {
      await it('should lstat current directory', async () => {
        await new Promise<void>((resolve, reject) => {
          lstat('.', (err, stats) => {
            if (err) return reject(err);
            expect(stats).toBeDefined();
            expect(stats.isDirectory()).toBe(true);
            resolve();
          });
        });
      });
    });

    // ==================== readdir ====================
    await describe('readdir', async () => {
      await it('should list files in current directory', async () => {
        await new Promise<void>((resolve, reject) => {
          readdir('.', (err, files) => {
            if (err) return reject(err);
            expect(Array.isArray(files)).toBe(true);
            expect(files.length).toBeGreaterThan(0);
            resolve();
          });
        });
      });
    });

    // ==================== mkdir / rm ====================
    await describe('mkdir and rm', async () => {
      await it('should create and remove a directory', async () => {
        const dir = TEST_DIR + '-mkdir';
        await new Promise<void>((resolve, reject) => {
          mkdir(dir, (err) => {
            if (err) return reject(err);
            stat(dir, (err2, stats) => {
              if (err2) return reject(err2);
              expect(stats.isDirectory()).toBe(true);
              rm(dir, { recursive: true }, (err3) => {
                if (err3) return reject(err3);
                resolve();
              });
            });
          });
        });
      });
    });

    // ==================== writeFile / readFile ====================
    await describe('writeFile and readFile', async () => {
      await it('should write and read a file', async () => {
        const path = TEST_DIR + '-rw.txt';
        const content = 'Hello callback world';

        await new Promise<void>((resolve, reject) => {
          writeFile(path, content, 'utf8', (err) => {
            if (err) return reject(err);
            readFile(path, 'utf8', (err2, data) => {
              if (err2) return reject(err2);
              expect(data).toBe(content);
              rm(path, (err3) => {
                if (err3) return reject(err3);
                resolve();
              });
            });
          });
        });
      });

      await it('should write and read Buffer data', async () => {
        const path = TEST_DIR + '-buf.txt';
        const buf = Buffer.from([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"

        await new Promise<void>((resolve, reject) => {
          writeFile(path, buf, (err) => {
            if (err) return reject(err);
            readFile(path, (err2, data) => {
              if (err2) return reject(err2);
              expect(Buffer.isBuffer(data)).toBe(true);
              expect(data.toString()).toBe('Hello');
              rm(path, () => resolve());
            });
          });
        });
      });

      await it('should return error when reading non-existent file', async () => {
        await new Promise<void>((resolve, reject) => {
          readFile('/non/existent/file.txt', (err) => {
            try {
              expect(err).toBeDefined();
              resolve();
            } catch (e) { reject(e); }
          });
        });
      });
    });

    // ==================== open / write / read / close ====================
    await describe('open, write, read, close', async () => {
      await it('should open, write, read, and close a file', async () => {
        const path = TEST_DIR + '-open.txt';

        await new Promise<void>((resolve, reject) => {
          open(path, 'w+', 0o666, (err, fd) => {
            if (err) return reject(err);
            expect(typeof fd).toBe('number');

            const buf = Buffer.from('Hello World', 'utf8');
            write(fd, buf, 0, buf.length, 0, (err2, written) => {
              if (err2) return reject(err2);
              expect(written).toBe(buf.length);

              close(fd, (err3) => {
                if (err3) return reject(err3);
                rm(path, () => resolve());
              });
            });
          });
        });
      });
    });

    // ==================== access ====================
    await describe('access', async () => {
      await it('should succeed for existing file', async () => {
        const path = TEST_DIR + '-access.txt';
        await new Promise<void>((resolve, reject) => {
          writeFile(path, 'test', (err) => {
            if (err) return reject(err);
            access(path, constants.F_OK, (err2) => {
              expect(err2).toBeNull();
              rm(path, () => resolve());
            });
          });
        });
      });

      await it('should fail for non-existent file', async () => {
        await new Promise<void>((resolve, reject) => {
          access('/non/existent/file', constants.F_OK, (err) => {
            try {
              expect(err).toBeDefined();
              resolve();
            } catch (e) { reject(e); }
          });
        });
      });
    });

    // ==================== appendFile ====================
    await describe('appendFile', async () => {
      await it('should append to a file', async () => {
        const path = TEST_DIR + '-append.txt';
        await new Promise<void>((resolve, reject) => {
          writeFile(path, 'Hello', 'utf8', (err) => {
            if (err) return reject(err);
            appendFile(path, ' World', 'utf8', (err2) => {
              if (err2) return reject(err2);
              readFile(path, 'utf8', (err3, data) => {
                if (err3) return reject(err3);
                expect(data).toBe('Hello World');
                rm(path, () => resolve());
              });
            });
          });
        });
      });
    });

    // ==================== rename ====================
    await describe('rename', async () => {
      await it('should rename a file', async () => {
        const oldPath = TEST_DIR + '-rename-old.txt';
        const newPath = TEST_DIR + '-rename-new.txt';
        await new Promise<void>((resolve, reject) => {
          writeFile(oldPath, 'rename test', (err) => {
            if (err) return reject(err);
            rename(oldPath, newPath, (err2) => {
              if (err2) return reject(err2);
              readFile(newPath, 'utf8', (err3, data) => {
                if (err3) return reject(err3);
                expect(data).toBe('rename test');
                rm(newPath, () => resolve());
              });
            });
          });
        });
      });
    });

    // ==================== copyFile ====================
    await describe('copyFile', async () => {
      await it('should copy a file', async () => {
        const src = TEST_DIR + '-copy-src.txt';
        const dst = TEST_DIR + '-copy-dst.txt';
        await new Promise<void>((resolve, reject) => {
          writeFile(src, 'copy test', (err) => {
            if (err) return reject(err);
            copyFile(src, dst, (err2) => {
              if (err2) return reject(err2);
              readFile(dst, 'utf8', (err3, data) => {
                if (err3) return reject(err3);
                expect(data).toBe('copy test');
                rm(src, () => rm(dst, () => resolve()));
              });
            });
          });
        });
      });
    });

    // ==================== truncate ====================
    await describe('truncate', async () => {
      await it('should truncate a file', async () => {
        const path = TEST_DIR + '-truncate.txt';
        await new Promise<void>((resolve, reject) => {
          writeFile(path, 'Hello World', (err) => {
            if (err) return reject(err);
            truncate(path, 5, (err2) => {
              if (err2) return reject(err2);
              readFile(path, 'utf8', (err3, data) => {
                if (err3) return reject(err3);
                expect(data).toBe('Hello');
                rm(path, () => resolve());
              });
            });
          });
        });
      });
    });

    // ==================== chmod ====================
    await describe('chmod', async () => {
      await it('should change file mode', async () => {
        const path = TEST_DIR + '-chmod.txt';
        await new Promise<void>((resolve, reject) => {
          writeFile(path, 'chmod test', (err) => {
            if (err) return reject(err);
            chmod(path, 0o644, (err2) => {
              if (err2) return reject(err2);
              stat(path, (err3, stats) => {
                if (err3) return reject(err3);
                // Check that mode includes the permission bits
                expect((stats.mode & 0o777)).toBe(0o644);
                rm(path, () => resolve());
              });
            });
          });
        });
      });
    });
  });
};
