// Ported from refs/bun/test/js/node/fs/cp.test.ts and
// refs/node-test/parallel/test-fs-cp-sync-*.mjs
// Original: MIT, Oven & contributors / Node.js contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { cpSync, promises, existsSync, mkdirSync, writeFileSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'gjsify-cp-'));
}

export default async () => {
  await describe('fs.cpSync', async () => {
    await it('copies a single file', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'a.txt'), 'hello');

      cpSync(join(tmp, 'a.txt'), join(tmp, 'b.txt'));

      expect(readFileSync(join(tmp, 'b.txt'), 'utf8')).toBe('hello');
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('throws EISDIR when src is directory and recursive is false', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'src'));

      let threw = false;
      try {
        cpSync(join(tmp, 'src'), join(tmp, 'dest'));
      } catch (e: any) {
        threw = true;
        expect(e.code).toBe('ERR_FS_EISDIR');
      }
      expect(threw).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('recursively copies a directory tree', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'src', 'sub'), { recursive: true });
      writeFileSync(join(tmp, 'src', 'a.txt'), 'a');
      writeFileSync(join(tmp, 'src', 'sub', 'b.txt'), 'b');

      cpSync(join(tmp, 'src'), join(tmp, 'dst'), { recursive: true });

      expect(readFileSync(join(tmp, 'dst', 'a.txt'), 'utf8')).toBe('a');
      expect(readFileSync(join(tmp, 'dst', 'sub', 'b.txt'), 'utf8')).toBe('b');
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('overwrites existing file by default (force=true)', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'src.txt'), 'new');
      writeFileSync(join(tmp, 'dst.txt'), 'old');

      cpSync(join(tmp, 'src.txt'), join(tmp, 'dst.txt'));

      expect(readFileSync(join(tmp, 'dst.txt'), 'utf8')).toBe('new');
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('does not overwrite when force=false', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'src.txt'), 'new');
      writeFileSync(join(tmp, 'dst.txt'), 'old');

      cpSync(join(tmp, 'src.txt'), join(tmp, 'dst.txt'), { force: false });

      expect(readFileSync(join(tmp, 'dst.txt'), 'utf8')).toBe('old');
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('throws EEXIST when force=false and errorOnExist=true', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'src.txt'), 'new');
      writeFileSync(join(tmp, 'dst.txt'), 'old');

      let threw = false;
      try {
        cpSync(join(tmp, 'src.txt'), join(tmp, 'dst.txt'), { force: false, errorOnExist: true });
      } catch (e: any) {
        threw = true;
        expect(e.code).toBe('ERR_FS_CP_EEXIST');
      }
      expect(threw).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('applies filter function — skips excluded entries', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'keep.txt'), 'keep');
      writeFileSync(join(tmp, 'src', 'skip.log'), 'skip');

      cpSync(join(tmp, 'src'), join(tmp, 'dst'), {
        recursive: true,
        filter: (_src, _dst) => !_src.endsWith('.log'),
      });

      expect(existsSync(join(tmp, 'dst', 'keep.txt'))).toBe(true);
      expect(existsSync(join(tmp, 'dst', 'skip.log'))).toBe(false);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('throws ENOENT when src does not exist', async () => {
      const tmp = makeTmp();

      let threw = false;
      try {
        cpSync(join(tmp, 'nonexistent.txt'), join(tmp, 'dst.txt'));
      } catch (e: any) {
        threw = true;
        expect(e.code).toBe('ENOENT');
      }
      expect(threw).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });
  });

  await describe('fs.promises.cp', async () => {
    await it('copies a single file', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'a.txt'), 'hello');

      await promises.cp(join(tmp, 'a.txt'), join(tmp, 'b.txt'));

      expect(readFileSync(join(tmp, 'b.txt'), 'utf8')).toBe('hello');
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('throws EISDIR when src is directory and recursive is false', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'src'));

      let threw = false;
      try {
        await promises.cp(join(tmp, 'src'), join(tmp, 'dest'));
      } catch (e: any) {
        threw = true;
        expect(e.code).toBe('ERR_FS_EISDIR');
      }
      expect(threw).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('recursively copies a directory tree', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'src', 'sub'), { recursive: true });
      writeFileSync(join(tmp, 'src', 'a.txt'), 'a');
      writeFileSync(join(tmp, 'src', 'sub', 'b.txt'), 'b');

      await promises.cp(join(tmp, 'src'), join(tmp, 'dst'), { recursive: true });

      expect(readFileSync(join(tmp, 'dst', 'a.txt'), 'utf8')).toBe('a');
      expect(readFileSync(join(tmp, 'dst', 'sub', 'b.txt'), 'utf8')).toBe('b');
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('applies async filter function', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'keep.ts'), 'ts');
      writeFileSync(join(tmp, 'src', 'skip.js'), 'js');

      await promises.cp(join(tmp, 'src'), join(tmp, 'dst'), {
        recursive: true,
        filter: async (_src, _dst) => {
          return !_src.endsWith('.js');
        },
      });

      expect(existsSync(join(tmp, 'dst', 'keep.ts'))).toBe(true);
      expect(existsSync(join(tmp, 'dst', 'skip.js'))).toBe(false);
      rmSync(tmp, { recursive: true, force: true });
    });
  });
};
