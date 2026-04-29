// Ported from refs/bun/test/js/node/watch/fs.watchFile.test.ts (behavior)
// Original: MIT, Oven & contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  watchFile,
  unwatchFile,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const INTERVAL = 50;

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'gjsify-watchfile-'));
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default async () => {
  await describe('fs.watchFile / fs.unwatchFile', async () => {
    await it('calls listener when file is modified', async () => {
      const tmp = makeTmp();
      const file = join(tmp, 'watch.txt');
      writeFileSync(file, 'initial');

      let called = false;
      const listener = () => { called = true; };

      watchFile(file, { interval: INTERVAL }, listener);

      await wait(20);
      writeFileSync(file, 'modified');
      await wait(INTERVAL * 3);

      unwatchFile(file, listener);
      expect(called).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('calls listener with curr and prev Stats', async () => {
      const tmp = makeTmp();
      const file = join(tmp, 'stats.txt');
      writeFileSync(file, 'v1');

      let curr: any = null;
      let prev: any = null;
      const listener = (c: any, p: any) => { curr = c; prev = p; };

      watchFile(file, { interval: INTERVAL }, listener);

      await wait(20);
      writeFileSync(file, 'v2-longer');
      await wait(INTERVAL * 3);

      unwatchFile(file, listener);
      expect(curr).not.toBeNull();
      expect(prev).not.toBeNull();
      expect(typeof curr.mtimeMs).toBe('number');
      expect(typeof prev.mtimeMs).toBe('number');
      expect(curr.size).toBeGreaterThan(prev.size);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('stops calling listener after unwatchFile', async () => {
      const tmp = makeTmp();
      const file = join(tmp, 'stop.txt');
      writeFileSync(file, 'start');

      let count = 0;
      const listener = () => { count++; };

      watchFile(file, { interval: INTERVAL }, listener);

      await wait(20);
      writeFileSync(file, 'change1');
      await wait(INTERVAL * 3);
      unwatchFile(file, listener);

      const countAfterUnwatch = count;
      writeFileSync(file, 'change2');
      await wait(INTERVAL * 3);

      expect(count).toBe(countAfterUnwatch);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('unwatchFile with no listener removes all listeners', async () => {
      const tmp = makeTmp();
      const file = join(tmp, 'all.txt');
      writeFileSync(file, 'x');

      let a = 0;
      let b = 0;
      const la = () => { a++; };
      const lb = () => { b++; };

      watchFile(file, { interval: INTERVAL }, la);
      watchFile(file, { interval: INTERVAL }, lb);

      await wait(20);
      writeFileSync(file, 'y');
      await wait(INTERVAL * 3);

      unwatchFile(file); // remove all

      const snapA = a;
      const snapB = b;
      writeFileSync(file, 'z');
      await wait(INTERVAL * 3);

      expect(a).toBe(snapA);
      expect(b).toBe(snapB);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('returns StatWatcher with changeListenerCount', async () => {
      const tmp = makeTmp();
      const file = join(tmp, 'watcher.txt');
      writeFileSync(file, '0');

      const listener = () => {};
      const watcher = watchFile(file, { interval: INTERVAL }, listener);

      expect(typeof watcher.on).toBe('function');
      expect(watcher.listenerCount('change')).toBe(1);

      unwatchFile(file, listener);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('multiple listeners on same file share one watcher', async () => {
      const tmp = makeTmp();
      const file = join(tmp, 'shared.txt');
      writeFileSync(file, '0');

      let a = 0;
      let b = 0;
      const la = () => { a++; };
      const lb = () => { b++; };

      const w1 = watchFile(file, { interval: INTERVAL }, la);
      const w2 = watchFile(file, { interval: INTERVAL }, lb);

      expect(w1).toBe(w2); // same watcher instance

      await wait(20);
      writeFileSync(file, '1');
      await wait(INTERVAL * 3);

      unwatchFile(file, la);
      unwatchFile(file, lb);
      expect(a).toBeGreaterThan(0);
      expect(b).toBeGreaterThan(0);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('listener called when file is created (was non-existent)', async () => {
      const tmp = makeTmp();
      const file = join(tmp, 'new.txt');
      // file does NOT exist yet

      let called = false;
      const listener = (curr: any) => {
        if (curr.size > 0) called = true;
      };

      watchFile(file, { interval: INTERVAL }, listener);

      await wait(20);
      writeFileSync(file, 'created');
      await wait(INTERVAL * 3);

      unwatchFile(file, listener);
      expect(called).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });
  });
};
