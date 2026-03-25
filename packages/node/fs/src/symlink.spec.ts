// Ported from refs/node-test/parallel/test-fs-symlink.js,
//   test-fs-readlink.js, test-fs-realpath.js
// Original: MIT license, Node.js contributors
import { describe, it, expect } from '@gjsify/unit';
import {
  symlink as symlinkCb,
  mkdtempSync,
  rmdirSync,
  unlinkSync,
  lstatSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { symlink, readlink, realpath, unlink, rmdir, lstat, writeFile, mkdtemp } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export default async () => {
  await describe('fs.symlink (callback)', async () => {

    await it('should throw when no callback provided', async () => {
      expect(() => {
        // @ts-ignore
        symlinkCb('some/path', 'some/other/path', 'dir');
      }).toThrow(Error);
    });

    await it('should create a symlink pointing to a file', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-sym-cb-'));
      const target = join(dir, 'target.txt');
      const link = join(dir, 'link.txt');
      writeFileSync(target, 'symlink target');

      await new Promise<void>((resolve, reject) => {
        symlinkCb(target, link, (err) => {
          if (err) return reject(err);
          try {
            const s = lstatSync(link);
            expect(s.isSymbolicLink()).toBe(true);
            resolve();
          } catch (e) {
            reject(e);
          }
        });
      });

      unlinkSync(link);
      unlinkSync(target);
      rmdirSync(dir);
    });
  });

  await describe('fs.symlink (promise)', async () => {
    await it('should create a symlink pointing to a file', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-sym-p-'));
      const target = join(dir, 'target.txt');
      const link = join(dir, 'link.txt');
      await writeFile(target, 'symlink target content');

      await symlink(target, link);

      const s = lstatSync(link);
      expect(s.isSymbolicLink()).toBe(true);

      await unlink(link);
      await unlink(target);
      await rmdir(dir);
    });

    await it('should throw ENOENT when symlinking to non-existent target', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-sym-err-'));
      const link = join(dir, 'link.txt');
      // Creating a dangling symlink — target doesn't exist
      await symlink('/nonexistent/path/12345abc', link);
      const s = await lstat(link);
      expect(s.isSymbolicLink()).toBe(true);
      await unlink(link);
      await rmdir(dir);
    });

    await it('should throw EEXIST when symlink already exists', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-sym-exist-'));
      const target = join(dir, 'target.txt');
      const link = join(dir, 'link.txt');
      await writeFile(target, 'data');
      await symlink(target, link);

      let threw = false;
      try {
        await symlink(target, link);
      } catch (e: unknown) {
        threw = true;
        expect((e as NodeJS.ErrnoException).code).toBe('EEXIST');
      }
      expect(threw).toBe(true);

      await unlink(link);
      await unlink(target);
      await rmdir(dir);
    });
  });

  await describe('fs.readlink', async () => {
    await it('should read the symlink target synchronously', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-rl-'));
      const target = join(dir, 'target.txt');
      const link2 = join(dir, 'link2.txt');
      writeFileSync(target, 'data');

      await new Promise<void>(resolve => {
        symlinkCb(target, link2, () => {
          const dest = readlinkSync(link2);
          expect(dest).toBe(target);
          unlinkSync(link2);
          unlinkSync(target);
          rmdirSync(dir);
          resolve();
        });
      });
    });

    await it('should read the symlink target via promise', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-rl-p-'));
      const target = join(dir, 'target.txt');
      const link = join(dir, 'link.txt');
      await writeFile(target, 'data');
      await symlink(target, link);

      const dest = await readlink(link);
      expect(dest).toBe(target);

      await unlink(link);
      await unlink(target);
      await rmdir(dir);
    });

    await it('should throw ENOENT when reading non-existent symlink', async () => {
      let threw = false;
      try {
        await readlink('/nonexistent/path/no-link-xyz');
      } catch (e: unknown) {
        threw = true;
        expect((e as NodeJS.ErrnoException).code).toBe('ENOENT');
      }
      expect(threw).toBe(true);
    });
  });

  await describe('fs.realpath', async () => {
    await it('should resolve a symlink to real path (sync)', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'fs-rp-'));
      const target = join(dir, 'realfile.txt');
      const link = join(dir, 'link.txt');
      writeFileSync(target, 'realpath test');

      await new Promise<void>(resolve => {
        symlinkCb(target, link, () => {
          const real = realpathSync(link);
          // realpath resolves symlinks to actual path
          expect(typeof real).toBe('string');
          expect(real.length).toBeGreaterThan(0);
          unlinkSync(link);
          resolve();
        });
      });

      unlinkSync(target);
      rmdirSync(dir);
    });

    await it('should resolve a symlink to real path (promise)', async () => {
      const dir = await mkdtemp(join(tmpdir(), 'fs-rp-p-'));
      const target = join(dir, 'realfile.txt');
      const link = join(dir, 'link.txt');
      await writeFile(target, 'realpath test');
      await symlink(target, link);

      const real = await realpath(link);
      expect(typeof real).toBe('string');
      expect(real.length).toBeGreaterThan(0);

      await unlink(link);
      await unlink(target);
      await rmdir(dir);
    });
  });
};
