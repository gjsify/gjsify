// Extended fs tests — error handling, constants, path edge cases, readdir options
// Ported from refs/node-test/parallel/test-fs-*.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

export default async () => {

  // ===================== Module exports =====================
  await describe('fs module exports', async () => {
    await it('should export readFileSync', async () => {
      expect(typeof fs.readFileSync).toBe('function');
    });
    await it('should export writeFileSync', async () => {
      expect(typeof fs.writeFileSync).toBe('function');
    });
    await it('should export existsSync', async () => {
      expect(typeof fs.existsSync).toBe('function');
    });
    await it('should export mkdirSync', async () => {
      expect(typeof fs.mkdirSync).toBe('function');
    });
    await it('should export rmdirSync', async () => {
      expect(typeof fs.rmdirSync).toBe('function');
    });
    await it('should export unlinkSync', async () => {
      expect(typeof fs.unlinkSync).toBe('function');
    });
    await it('should export statSync', async () => {
      expect(typeof fs.statSync).toBe('function');
    });
    await it('should export lstatSync', async () => {
      expect(typeof fs.lstatSync).toBe('function');
    });
    await it('should export readdirSync', async () => {
      expect(typeof fs.readdirSync).toBe('function');
    });
    await it('should export renameSync', async () => {
      expect(typeof fs.renameSync).toBe('function');
    });
    await it('should export copyFileSync', async () => {
      expect(typeof fs.copyFileSync).toBe('function');
    });
    await it('should export accessSync', async () => {
      expect(typeof fs.accessSync).toBe('function');
    });
    await it('should export chmodSync', async () => {
      expect(typeof fs.chmodSync).toBe('function');
    });
    await it('should export realpathSync', async () => {
      expect(typeof fs.realpathSync).toBe('function');
    });
    await it('should export createReadStream', async () => {
      expect(typeof fs.createReadStream).toBe('function');
    });
    await it('should export createWriteStream', async () => {
      expect(typeof fs.createWriteStream).toBe('function');
    });
    await it('should export promises', async () => {
      expect(typeof fs.promises).toBe('object');
    });

    // Callback exports
    await it('should export readFile (callback)', async () => {
      expect(typeof fs.readFile).toBe('function');
    });
    await it('should export writeFile (callback)', async () => {
      expect(typeof fs.writeFile).toBe('function');
    });
    await it('should export stat (callback)', async () => {
      expect(typeof fs.stat).toBe('function');
    });
    await it('should export mkdir (callback)', async () => {
      expect(typeof fs.mkdir).toBe('function');
    });
    await it('should export readdir (callback)', async () => {
      expect(typeof fs.readdir).toBe('function');
    });
    await it('should export rename (callback)', async () => {
      expect(typeof fs.rename).toBe('function');
    });
    await it('should export unlink (callback)', async () => {
      expect(typeof fs.unlink).toBe('function');
    });

    // watch/watchFile
    await it('should export watch', async () => {
      expect(typeof fs.watch).toBe('function');
    });
    // watchFile/unwatchFile not yet implemented in GJS
    // await it('should export watchFile', ...)
    // await it('should export unwatchFile', ...)
  });

  // ===================== fs.constants =====================
  await describe('fs.constants comprehensive', async () => {
    await it('should have F_OK', async () => {
      expect(typeof fs.constants.F_OK).toBe('number');
      expect(fs.constants.F_OK).toBe(0);
    });
    await it('should have R_OK', async () => {
      expect(typeof fs.constants.R_OK).toBe('number');
    });
    await it('should have W_OK', async () => {
      expect(typeof fs.constants.W_OK).toBe('number');
    });
    await it('should have X_OK', async () => {
      expect(typeof fs.constants.X_OK).toBe('number');
    });
    await it('should have O_RDONLY', async () => {
      expect(fs.constants.O_RDONLY).toBe(0);
    });
    await it('should have O_WRONLY', async () => {
      expect(fs.constants.O_WRONLY).toBe(1);
    });
    await it('should have O_RDWR', async () => {
      expect(fs.constants.O_RDWR).toBe(2);
    });
    await it('should have O_CREAT', async () => {
      expect(typeof fs.constants.O_CREAT).toBe('number');
    });
    await it('should have O_EXCL', async () => {
      expect(typeof fs.constants.O_EXCL).toBe('number');
    });
    await it('should have O_TRUNC', async () => {
      expect(typeof fs.constants.O_TRUNC).toBe('number');
    });
    await it('should have O_APPEND', async () => {
      expect(typeof fs.constants.O_APPEND).toBe('number');
    });
    await it('should have S_IFMT', async () => {
      expect(typeof fs.constants.S_IFMT).toBe('number');
    });
    await it('should have S_IFREG', async () => {
      expect(typeof fs.constants.S_IFREG).toBe('number');
    });
    await it('should have S_IFDIR', async () => {
      expect(typeof fs.constants.S_IFDIR).toBe('number');
    });
    await it('should have S_IFLNK', async () => {
      expect(typeof fs.constants.S_IFLNK).toBe('number');
    });
    await it('should have COPYFILE_EXCL', async () => {
      expect(typeof fs.constants.COPYFILE_EXCL).toBe('number');
    });
  });

  // ===================== ENOENT error handling =====================
  await describe('fs ENOENT error handling', async () => {
    const nonExistent = path.join(tmpdir(), 'gjsify-test-nonexistent-' + Date.now());

    await it('readFileSync should throw ENOENT for missing file', async () => {
      let thrown = false;
      try {
        fs.readFileSync(nonExistent);
      } catch (err: any) {
        thrown = true;
        expect(err.code).toBe('ENOENT');
      }
      expect(thrown).toBe(true);
    });

    await it('statSync should throw ENOENT for missing file', async () => {
      let thrown = false;
      try {
        fs.statSync(nonExistent);
      } catch (err: any) {
        thrown = true;
        expect(err.code).toBe('ENOENT');
      }
      expect(thrown).toBe(true);
    });

    await it('unlinkSync should throw ENOENT for missing file', async () => {
      let thrown = false;
      try {
        fs.unlinkSync(nonExistent);
      } catch (err: any) {
        thrown = true;
        expect(err.code).toBe('ENOENT');
      }
      expect(thrown).toBe(true);
    });

    await it('readFile callback should receive ENOENT', async () => {
      const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
        fs.readFile(nonExistent, (e) => resolve(e));
      });
      expect(err).toBeDefined();
      expect(err!.code).toBe('ENOENT');
    });

    await it('stat callback should receive ENOENT', async () => {
      const err = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
        fs.stat(nonExistent, (e) => resolve(e));
      });
      expect(err).toBeDefined();
      expect(err!.code).toBe('ENOENT');
    });

    await it('fs.promises.readFile should reject with ENOENT', async () => {
      let caught = false;
      try {
        await fs.promises.readFile(nonExistent);
      } catch (err: any) {
        caught = true;
        expect(err.code).toBe('ENOENT');
      }
      expect(caught).toBe(true);
    });

    await it('fs.promises.stat should reject with ENOENT', async () => {
      let caught = false;
      try {
        await fs.promises.stat(nonExistent);
      } catch (err: any) {
        caught = true;
        expect(err.code).toBe('ENOENT');
      }
      expect(caught).toBe(true);
    });

    await it('existsSync should return false for missing file', async () => {
      expect(fs.existsSync(nonExistent)).toBe(false);
    });

    await it('accessSync should throw ENOENT for missing file', async () => {
      let thrown = false;
      try {
        fs.accessSync(nonExistent);
      } catch (err: any) {
        thrown = true;
        expect(err.code).toBe('ENOENT');
      }
      expect(thrown).toBe(true);
    });
  });

  // ===================== existsSync edge cases =====================
  await describe('fs.existsSync edge cases', async () => {
    await it('should return true for /', async () => {
      expect(fs.existsSync('/')).toBe(true);
    });
    await it('should return true for /tmp', async () => {
      expect(fs.existsSync('/tmp')).toBe(true);
    });
    await it('should return true for tmpdir()', async () => {
      expect(fs.existsSync(tmpdir())).toBe(true);
    });
    await it('should return false for empty string', async () => {
      expect(fs.existsSync('')).toBe(false);
    });
  });

  // ===================== readdir with options =====================
  await describe('fs.readdirSync options', async () => {
    await it('should return string array by default', async () => {
      const entries = fs.readdirSync('/tmp');
      expect(Array.isArray(entries)).toBe(true);
      if (entries.length > 0) {
        expect(typeof entries[0]).toBe('string');
      }
    });

    await it('should return Dirent array with withFileTypes', async () => {
      const entries = fs.readdirSync('/tmp', { withFileTypes: true });
      expect(Array.isArray(entries)).toBe(true);
      if (entries.length > 0) {
        const d = entries[0];
        expect(typeof d.name).toBe('string');
        expect(typeof d.isFile).toBe('function');
        expect(typeof d.isDirectory).toBe('function');
        expect(typeof d.isSymbolicLink).toBe('function');
      }
    });

    await it('should return string with utf8 encoding', async () => {
      const entries = fs.readdirSync('/tmp', { encoding: 'utf8' });
      expect(Array.isArray(entries)).toBe(true);
      if (entries.length > 0) {
        expect(typeof entries[0]).toBe('string');
      }
    });
  });

  // ===================== mkdirSync recursive =====================
  await describe('fs.mkdirSync recursive', async () => {
    const baseDir = path.join(tmpdir(), 'gjsify-mkdir-recursive-' + Date.now());

    await it('should create nested directories', async () => {
      const nested = path.join(baseDir, 'a', 'b', 'c');
      fs.mkdirSync(nested, { recursive: true });
      expect(fs.existsSync(nested)).toBe(true);
      expect(fs.statSync(nested).isDirectory()).toBe(true);
    });

    await it('should not throw if directory already exists with recursive', async () => {
      expect(() => fs.mkdirSync(baseDir, { recursive: true })).not.toThrow();
    });

    await it('should throw EEXIST without recursive for existing dir', async () => {
      let thrown = false;
      try {
        fs.mkdirSync(baseDir);
      } catch (err: any) {
        thrown = true;
        expect(err.code).toBe('EEXIST');
      }
      expect(thrown).toBe(true);
    });

    // Cleanup
    await it('cleanup', async () => {
      fs.rmSync(baseDir, { recursive: true, force: true });
      expect(fs.existsSync(baseDir)).toBe(false);
    });
  });

  // ===================== writeFileSync/readFileSync round-trip =====================
  await describe('fs read/write round-trip', async () => {
    const testFile = path.join(tmpdir(), 'gjsify-roundtrip-' + Date.now() + '.txt');

    await it('should write and read string content', async () => {
      fs.writeFileSync(testFile, 'hello world');
      const content = fs.readFileSync(testFile, 'utf8');
      expect(content).toBe('hello world');
    });

    await it('should write and read with encoding', async () => {
      fs.writeFileSync(testFile, 'überschreiben');
      const content = fs.readFileSync(testFile, 'utf8');
      expect(content).toBe('überschreiben');
    });

    await it('should write and read Buffer content', async () => {
      const buf = Buffer.from([0x01, 0x02, 0x03, 0x04]);
      fs.writeFileSync(testFile, buf);
      const content = fs.readFileSync(testFile);
      expect(content.length).toBe(4);
      expect(content[0]).toBe(1);
      expect(content[3]).toBe(4);
    });

    await it('should overwrite existing file', async () => {
      fs.writeFileSync(testFile, 'first');
      fs.writeFileSync(testFile, 'second');
      expect(fs.readFileSync(testFile, 'utf8')).toBe('second');
    });

    await it('should write empty file', async () => {
      fs.writeFileSync(testFile, '');
      expect(fs.readFileSync(testFile, 'utf8')).toBe('');
    });

    // Cleanup
    await it('cleanup', async () => {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    });
  });

  // ===================== appendFileSync =====================
  await describe('fs.appendFileSync', async () => {
    const testFile = path.join(tmpdir(), 'gjsify-append-' + Date.now() + '.txt');

    await it('should create file if not exists', async () => {
      fs.appendFileSync(testFile, 'hello');
      expect(fs.readFileSync(testFile, 'utf8')).toBe('hello');
    });

    await it('should append to existing file', async () => {
      fs.appendFileSync(testFile, ' world');
      expect(fs.readFileSync(testFile, 'utf8')).toBe('hello world');
    });

    await it('should append multiple times', async () => {
      fs.appendFileSync(testFile, '!');
      fs.appendFileSync(testFile, '!');
      expect(fs.readFileSync(testFile, 'utf8')).toBe('hello world!!');
    });

    // Cleanup
    await it('cleanup', async () => {
      if (fs.existsSync(testFile)) fs.unlinkSync(testFile);
    });
  });
};
