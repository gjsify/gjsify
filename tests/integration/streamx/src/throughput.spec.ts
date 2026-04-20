// Original tests for streamx scheduling correctness and throughput on GJS.
// These target the 0 B/s symptom in the webtorrent-player example:
//   - queueMicrotask injection (streamx falls back to process.nextTick if missing)
//   - High-frequency Readable → no data loss
//   - pipeline Readable→Transform→Writable preserves all bytes
//   - Duplex echo round-trip (mirrors bittorrent-protocol Wire)
//   - Sequential writes complete within a reasonable time budget

import { describe, it, expect, on } from '@gjsify/unit';
import { Readable, Writable, Duplex, Transform, pipeline, pipelinePromise } from 'streamx';

export default async () => {
  await describe('streamx throughput', async () => {

    await it('queueMicrotask is globally defined', async () => {
      expect(typeof queueMicrotask).toBe('function');
    });

    await it('Readable delivers 100 chunks without loss', async () => {
      let count = 0;
      const r = new Readable({
        read(cb: (err?: Error | null) => void) {
          if (++count <= 100) this.push(Buffer.alloc(1024));
          else this.push(null);
          cb();
        }
      });
      let received = 0;
      for await (const _ of r) received++;
      expect(received).toBe(100);
    });

    await it('pipeline Readable→Transform→Writable preserves all bytes', async () => {
      const chunkCount = 50;
      const chunkSize = 4096;
      let totalSent = 0;
      let totalReceived = 0;
      let i = 0;

      await pipelinePromise(
        new Readable({
          read(cb: (err?: Error | null) => void) {
            if (i++ < chunkCount) {
              const chunk = Buffer.alloc(chunkSize, i);
              totalSent += chunk.length;
              this.push(chunk);
            } else {
              this.push(null);
            }
            cb();
          }
        }),
        new Transform({
          transform(data: any, cb: (err?: Error | null, chunk?: any) => void) {
            cb(null, data);
          }
        }),
        new Writable({
          write(data: any, cb: (err?: Error | null) => void) {
            totalReceived += data.length;
            cb();
          }
        })
      );

      expect(totalSent).toBe(chunkCount * chunkSize);
      expect(totalReceived).toBe(totalSent);
    });

    await it('Duplex echo returns all written data in order', async () => {
      const messages = 30;
      const received: string[] = [];

      const d = new Duplex({
        write(data: any, cb: (err?: Error | null) => void) {
          this.push(data);
          cb();
        },
        final(cb: (err?: Error | null) => void) {
          this.push(null);
          cb();
        }
      });

      for (let i = 0; i < messages; i++) {
        d.write('msg-' + i);
      }
      d.end();

      for await (const chunk of d) {
        received.push(chunk as string);
      }

      expect(received.length).toBe(messages);
      for (let i = 0; i < messages; i++) {
        expect(received[i]).toBe('msg-' + i);
      }
    });

    await it('100 sequential pipeline writes complete within 5 seconds', async () => {
      const start = Date.now();
      let i = 0;

      await pipelinePromise(
        new Readable({
          read(cb: (err?: Error | null) => void) {
            if (i++ < 100) this.push(Buffer.alloc(1024));
            else this.push(null);
            cb();
          }
        }),
        new Writable({
          write(data: any, cb: (err?: Error | null) => void) { cb(); }
        })
      );

      expect(Date.now() - start).toBeLessThan(5000);
    });

    await on('Gjs', async () => {
      await it('streamx uses queueMicrotask not process.nextTick fallback', async () => {
        // Verify that queueMicrotask is injected so streamx uses the fast path.
        // The streamx index.js line 7-8:
        //   const qmt = typeof queueMicrotask === 'undefined'
        //     ? (fn) => global.process.nextTick(fn) : queueMicrotask
        // If queueMicrotask is available, qmt === queueMicrotask (Promise-based).
        // We verify this indirectly: 100 pipeline writes must complete in < 1s.
        const start = Date.now();
        let i = 0;
        await pipelinePromise(
          new Readable({
            read(cb: (err?: Error | null) => void) {
              if (i++ < 100) this.push('x');
              else this.push(null);
              cb();
            }
          }),
          new Writable({
            write(data: any, cb: (err?: Error | null) => void) { cb(); }
          })
        );
        const elapsed = Date.now() - start;
        expect(elapsed).toBeLessThan(1000);
      });
    });

  });
};
