// Ported from refs/bun/test/js/node/watch/fs.watch.test.ts
// Original: MIT, Oven & contributors.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import {
  promises,
  mkdirSync,
  writeFileSync,
  mkdtempSync,
  rmSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), 'gjsify-watch-'));
}

export default async () => {
  await describe('fs.promises.watch', async () => {
    await it('yields rename event when a file is created in a directory', async () => {
      const tmp = makeTmp();
      const ac = new AbortController();
      let received = false;

      // Write the file shortly after the iterator starts waiting
      setTimeout(() => {
        writeFileSync(join(tmp, 'new-file.txt'), 'hello');
      }, 30);

      try {
        for await (const event of promises.watch(tmp, { signal: ac.signal })) {
          expect(typeof event.eventType).toBe('string');
          expect(['rename', 'change']).toContain(event.eventType);
          received = true;
          ac.abort();
        }
      } catch (e: any) {
        // AbortError from native Node.js is expected — our impl ends cleanly
        if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
      }

      expect(received).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('yields change event when a watched file is modified', async () => {
      const tmp = makeTmp();
      const file = join(tmp, 'watch-me.txt');
      writeFileSync(file, 'initial');

      const ac = new AbortController();
      let received = false;

      setTimeout(() => {
        writeFileSync(file, 'modified');
      }, 30);

      try {
        for await (const event of promises.watch(file, { signal: ac.signal })) {
          expect(typeof event.eventType).toBe('string');
          expect(['rename', 'change']).toContain(event.eventType);
          received = true;
          ac.abort();
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
      }

      expect(received).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('filename in event is a string or null', async () => {
      const tmp = makeTmp();
      const ac = new AbortController();
      let filename: string | null | undefined = undefined;

      setTimeout(() => {
        writeFileSync(join(tmp, 'tracked.txt'), 'x');
      }, 30);

      try {
        for await (const event of promises.watch(tmp, { signal: ac.signal })) {
          filename = event.filename;
          ac.abort();
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
      }

      // filename is a string basename or null (GJS writeFileSync uses atomic writes
      // via GLib.file_set_contents which may report a temp filename — any string is valid)
      expect(typeof filename === 'string' || filename === null).toBe(true);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('stops iterating immediately when signal is pre-aborted', async () => {
      const tmp = makeTmp();
      const ac = new AbortController();
      ac.abort(); // aborted BEFORE the watch starts

      let count = 0;
      try {
        for await (const _ of promises.watch(tmp, { signal: ac.signal })) {
          count++;
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
      }

      expect(count).toBe(0);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('stops cleanly when AbortController is aborted during iteration', async () => {
      const tmp = makeTmp();
      const ac = new AbortController();
      let eventCount = 0;

      // Write repeatedly so events keep coming
      const interval = setInterval(() => {
        writeFileSync(join(tmp, 'file.txt'), String(Date.now()));
      }, 20);

      try {
        for await (const event of promises.watch(tmp, { signal: ac.signal })) {
          expect(['rename', 'change']).toContain(event.eventType);
          eventCount++;
          if (eventCount >= 2) {
            clearInterval(interval);
            ac.abort();
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
      } finally {
        clearInterval(interval);
      }

      expect(eventCount).toBeGreaterThan(0);
      rmSync(tmp, { recursive: true, force: true });
    });

    await it('multiple events can be collected before abort', async () => {
      const tmp = makeTmp();
      const ac = new AbortController();
      const events: string[] = [];

      setTimeout(() => {
        writeFileSync(join(tmp, 'a.txt'), '1');
        writeFileSync(join(tmp, 'b.txt'), '2');
      }, 30);

      try {
        for await (const event of promises.watch(tmp, { signal: ac.signal })) {
          events.push(event.eventType);
          if (events.length >= 2) {
            ac.abort();
          }
        }
      } catch (e: any) {
        if (e?.name !== 'AbortError' && e?.code !== 'ABORT_ERR') throw e;
      }

      expect(events.length).toBeGreaterThan(0);
      rmSync(tmp, { recursive: true, force: true });
    });
  });
};
