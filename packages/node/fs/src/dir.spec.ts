// Ported from refs/bun/test/js/node/fs/dir.test.ts
// Original: MIT, Oven & contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  Dir,
  opendirSync,
  opendir,
  promises,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'gjsify-dir-'));
}

export default async () => {
  await describe('fs.opendirSync', async () => {
    await it('returns a Dir instance', async () => {
      const tmp = makeTmp();
      const dir = opendirSync(tmp);
      expect(dir).toBeDefined();
      expect(dir instanceof Dir).toBe(true);
      dir.closeSync();
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('dir.path reflects the opened path', async () => {
      const tmp = makeTmp();
      const dir = opendirSync(tmp);
      expect(dir.path).toBe(tmp);
      dir.closeSync();
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('readSync returns null on empty directory', async () => {
      const tmp = makeTmp();
      const dir = opendirSync(tmp);
      const entry = dir.readSync();
      expect(entry).toBeNull();
      dir.closeSync();
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('readSync returns Dirent entries for directory contents', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'a.txt'), 'a');
      writeFileSync(join(tmp, 'b.txt'), 'b');

      const dir = opendirSync(tmp);
      const names: string[] = [];
      let entry = dir.readSync();
      while (entry !== null) {
        names.push(entry.name);
        entry = dir.readSync();
      }
      dir.closeSync();

      expect(names.sort()).toStrictEqual(['a.txt', 'b.txt']);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('Dirent has correct type flags', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'file.txt'), 'x');
      mkdirSync(join(tmp, 'subdir'));

      const dir = opendirSync(tmp);
      const entries: { name: string; isFile: boolean; isDirectory: boolean }[] = [];
      let entry = dir.readSync();
      while (entry !== null) {
        entries.push({ name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory() });
        entry = dir.readSync();
      }
      dir.closeSync();

      entries.sort((a, b) => a.name.localeCompare(b.name));
      expect(entries).toStrictEqual([
        { name: 'file.txt', isFile: true, isDirectory: false },
        { name: 'subdir', isFile: false, isDirectory: true },
      ]);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('closeSync throws after close', async () => {
      const tmp = makeTmp();
      const dir = opendirSync(tmp);
      dir.closeSync();

      let threw = false;
      try {
        dir.closeSync();
      } catch (e: any) {
        threw = true;
        expect(e.code).toBe('ERR_DIR_CLOSED');
      }
      expect(threw).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('readSync throws after close', async () => {
      const tmp = makeTmp();
      const dir = opendirSync(tmp);
      dir.closeSync();

      let threw = false;
      try {
        dir.readSync();
      } catch (e: any) {
        threw = true;
        expect(e.code).toBe('ERR_DIR_CLOSED');
      }
      expect(threw).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('read() returns Dirent or null asynchronously', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'hello.txt'), 'hi');

      const dir = opendirSync(tmp);
      const entry = await dir.read();
      expect(entry).toBeDefined();
      expect(entry!.name).toBe('hello.txt');

      const next = await dir.read();
      expect(next).toBeNull();
      await dir.close();
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('[Symbol.asyncIterator] iterates all entries', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'x.ts'), '');
      writeFileSync(join(tmp, 'y.ts'), '');

      const dir = opendirSync(tmp);
      const names: string[] = [];
      for await (const entry of dir) {
        names.push(entry.name);
      }

      expect(names.sort()).toStrictEqual(['x.ts', 'y.ts']);
      rmSync(tmp, { recursive: true, force: true });
    });
  });

  await describe('fs.opendir (callback)', async () => {
    await it('opens directory and returns Dir instance via callback', async () => {
      const tmp = makeTmp();
      await new Promise<void>((resolve, reject) => {
        opendir(tmp, (err, dir) => {
          if (err) return reject(err);
          expect(dir instanceof Dir).toBe(true);
          expect(dir.path).toBe(tmp);
          dir.closeSync();
          rmSync(tmp, { recursive: true, force: true });
          resolve();
        });
      });
    });

    await it('throws if callback is not a function', async () => {
      let threw = false;
      try {
        (opendir as any)('/tmp');
      } catch (e: any) {
        threw = true;
      }
      expect(threw).toBe(true);
    });
  });

  await describe('fs.promises.opendir', async () => {
    await it('opens directory and returns Dir instance', async () => {
      const tmp = makeTmp();
      const dir = await promises.opendir(tmp);
      expect(dir instanceof Dir).toBe(true);
      await dir.close();
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('async iterates directory entries', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'alpha.txt'), '');
      writeFileSync(join(tmp, 'beta.txt'), '');

      const dir = await promises.opendir(tmp);
      const names: string[] = [];
      for await (const entry of dir) {
        names.push(entry.name);
      }

      expect(names.sort()).toStrictEqual(['alpha.txt', 'beta.txt']);
      rmSync(tmp, { recursive: true, force: true });
    });
  });
};
