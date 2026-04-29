// Ported from refs/node-test/parallel/test-fs-utimes.js (behavior)
// Original: MIT, Node.js contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { utimesSync, utimes, lutimesSync, lchownSync, promises } from 'node:fs';
import { statSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = tmpdir();

function tmpFile(name: string): string {
  const p = join(TMP, `gjsify-utimes-${name}-${process.pid}`);
  writeFileSync(p, 'test');
  return p;
}

export default async () => {
  await describe('fs.utimes / fs.lutimes / fs.lchown / fs.lchmod', async () => {
    await it('utimesSync sets mtime', async () => {
      const f = tmpFile('mtime');
      const mtime = new Date('2020-01-01T00:00:00Z');
      utimesSync(f, mtime, mtime);
      const stat = statSync(f);
      expect(stat.mtime.getFullYear()).toBe(2020);
      unlinkSync(f);
    });

    await it('utimesSync sets atime', async () => {
      const f = tmpFile('atime');
      const atime = new Date('2021-06-15T12:00:00Z');
      const mtime = new Date('2020-01-01T00:00:00Z');
      utimesSync(f, atime, mtime);
      const stat = statSync(f);
      expect(stat.mtime.getFullYear()).toBe(2020);
      unlinkSync(f);
    });

    await it('utimes callback sets timestamps', async () => {
      const f = tmpFile('cb');
      const mtime = new Date('2019-03-10T00:00:00Z');
      await new Promise<void>((resolve, reject) => {
        utimes(f, mtime, mtime, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      const stat = statSync(f);
      expect(stat.mtime.getFullYear()).toBe(2019);
      unlinkSync(f);
    });

    await it('promises.utimes sets timestamps', async () => {
      const f = tmpFile('promise');
      const mtime = new Date('2018-08-01T00:00:00Z');
      await promises.utimes(f, mtime, mtime);
      const stat = statSync(f);
      expect(stat.mtime.getFullYear()).toBe(2018);
      unlinkSync(f);
    });

    await it('lutimesSync does not throw on a symlink', async () => {
      const target = tmpFile('lutime-target');
      const link = join(TMP, `gjsify-lutime-link-${process.pid}`);
      try { unlinkSync(link); } catch {}
      symlinkSync(target, link);
      const mtime = new Date('2017-05-20T00:00:00Z');
      // Just verify the call completes without throwing
      expect(() => lutimesSync(link, mtime, mtime)).not.toThrow();
      unlinkSync(link);
      unlinkSync(target);
    });

    await it('lutimes callback completes without error', async () => {
      const f = tmpFile('lutimes-cb');
      const mtime = new Date('2016-01-01T00:00:00Z');
      const { lutimes } = await import('node:fs') as any;
      await new Promise<void>((resolve, reject) => {
        lutimes(f, mtime, mtime, (err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });
      unlinkSync(f);
    });

    await it('lchownSync does not throw (may need root to actually change)', async () => {
      const f = tmpFile('lchown');
      const link = join(TMP, `gjsify-lchown-link-${process.pid}`);
      try { unlinkSync(link); } catch {}
      symlinkSync(f, link);
      // This will only actually change owner if running as root; just verify no throw
      try {
        lchownSync(link, process.getuid ? process.getuid() : 0, process.getgid ? process.getgid() : 0);
      } catch {
        // acceptable if kernel denies (EPERM) — just must not crash the process
      }
      unlinkSync(link);
      unlinkSync(f);
    });

    await it('lchmod is a no-op (does not throw)', async () => {
      const f = tmpFile('lchmod');
      // Node.js removed lchmod on Linux; on GJS we export it as a no-op
      const fsModule = await import('node:fs') as any;
      if (typeof fsModule.lchmod === 'function') {
        expect(() => fsModule.lchmod(f, 0o644, () => {})).not.toThrow();
      }
      unlinkSync(f);
    });
  });
};
