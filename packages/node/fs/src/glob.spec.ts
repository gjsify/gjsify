// Ported from refs/bun/test/js/node/fs/glob.test.ts
// Original: MIT, Oven & contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  globSync,
  glob,
  promises,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'gjsify-glob-'));
}

export default async () => {
  await describe('fs.globSync', async () => {
    await it('matches *.ts files in flat directory', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'a.ts'), '');
      writeFileSync(join(tmp, 'b.ts'), '');
      writeFileSync(join(tmp, 'c.txt'), '');

      const results = globSync('*.ts', { cwd: tmp });
      expect(results.sort()).toStrictEqual(['a.ts', 'b.ts']);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('matches **/*.ts recursively', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'sub'));
      writeFileSync(join(tmp, 'root.ts'), '');
      writeFileSync(join(tmp, 'sub', 'nested.ts'), '');
      writeFileSync(join(tmp, 'sub', 'other.txt'), '');

      const results = globSync('**/*.ts', { cwd: tmp });
      expect(results.sort()).toStrictEqual(['root.ts', 'sub/nested.ts']);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('matches files in a subdirectory pattern', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'src'));
      writeFileSync(join(tmp, 'src', 'index.ts'), '');
      writeFileSync(join(tmp, 'src', 'util.ts'), '');
      writeFileSync(join(tmp, 'index.ts'), '');

      const results = globSync('src/*.ts', { cwd: tmp });
      expect(results.sort()).toStrictEqual(['src/index.ts', 'src/util.ts']);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('supports {a,b} alternation', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'a.ts'), '');
      writeFileSync(join(tmp, 'b.ts'), '');
      writeFileSync(join(tmp, 'c.ts'), '');

      const results = globSync('*.{ts,js}', { cwd: tmp });
      expect(results.sort()).toStrictEqual(['a.ts', 'b.ts', 'c.ts']);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('** matches all files and directories', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'sub'));
      writeFileSync(join(tmp, 'a.ts'), '');
      writeFileSync(join(tmp, 'sub', 'b.ts'), '');

      const results = globSync('**', { cwd: tmp });
      // Should include '.', 'a.ts', 'sub', 'sub/b.ts'
      expect(results.includes('a.ts')).toBe(true);
      expect(results.includes('sub/b.ts')).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('a/** matches the directory itself and its contents', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'sub'));
      writeFileSync(join(tmp, 'sub', 'x.ts'), '');
      writeFileSync(join(tmp, 'root.ts'), '');

      const results = globSync('sub/**', { cwd: tmp });
      expect(results.includes('sub')).toBe(true);
      expect(results.includes('sub/x.ts')).toBe(true);
      expect(results.includes('root.ts')).toBe(false);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('accepts array of patterns', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'a.ts'), '');
      writeFileSync(join(tmp, 'b.js'), '');
      writeFileSync(join(tmp, 'c.txt'), '');

      const results = globSync(['*.ts', '*.js'], { cwd: tmp });
      expect(results.sort()).toStrictEqual(['a.ts', 'b.js']);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('exclude function filters out matching paths', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'a.ts'), '');
      writeFileSync(join(tmp, 'b.ts'), '');

      // Use **/*.ts so Node.js native also invokes the exclude function
      // (flat patterns like *.ts skip directory traversal and exclude is not called)
      const results = globSync('**/*.ts', {
        cwd: tmp,
        exclude: (p) => p === 'a.ts',
      });
      expect(results).toStrictEqual(['b.ts']);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('returns empty array when no files match', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'a.txt'), '');

      const results = globSync('*.ts', { cwd: tmp });
      expect(results).toStrictEqual([]);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('returns empty array for non-existent cwd', async () => {
      const results = globSync('*.ts', { cwd: '/nonexistent-dir-gjsify-test' });
      expect(results).toStrictEqual([]);
    });
  });

  await describe('fs.glob (callback)', async () => {
    await it('calls back with matched files', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'hello.ts'), '');
      writeFileSync(join(tmp, 'world.ts'), '');

      const results = await new Promise<string[]>((resolve, reject) => {
        glob('*.ts', { cwd: tmp }, (err, matches) => {
          if (err) return reject(err);
          resolve(matches);
        });
      });

      expect(results.sort()).toStrictEqual(['hello.ts', 'world.ts']);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('accepts callback as second argument (no options)', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'file.ts'), '');

      const results = await new Promise<string[]>((resolve, reject) => {
        (glob as any)('*.ts', (err: any, matches: string[]) => {
          if (err) return reject(err);
          resolve(matches);
        });
      });

      // No cwd given — just verify it completes without error
      expect(Array.isArray(results)).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });
  });

  await describe('fs.promises.glob', async () => {
    await it('async iterates matched files', async () => {
      const tmp = makeTmp();
      writeFileSync(join(tmp, 'alpha.ts'), '');
      writeFileSync(join(tmp, 'beta.ts'), '');

      const results: string[] = [];
      for await (const match of promises.glob('*.ts', { cwd: tmp })) {
        results.push(match);
      }

      expect(results.sort()).toStrictEqual(['alpha.ts', 'beta.ts']);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('async iterates recursively with **/*.ts', async () => {
      const tmp = makeTmp();
      mkdirSync(join(tmp, 'lib'));
      writeFileSync(join(tmp, 'index.ts'), '');
      writeFileSync(join(tmp, 'lib', 'helper.ts'), '');

      const results: string[] = [];
      for await (const match of promises.glob('**/*.ts', { cwd: tmp })) {
        results.push(match);
      }

      expect(results.sort()).toStrictEqual(['index.ts', 'lib/helper.ts']);
      rmSync(tmp, { recursive: true, force: true });
    });
  });
};
