// SPDX-License-Identifier: MIT
// Ported from refs/streamx/test/writable.js
// Original: Copyright (c) mafintosh and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { Writable, Duplex } from 'streamx';

function eventFlush(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

export default async () => {
  await describe('streamx Writable', async () => {

    await it('opens before writes', async () => {
      const trace: string[] = [];
      const stream = new Writable({
        open(cb: (err?: Error | null) => void) {
          trace.push('open');
          return cb(null);
        },
        write(data: any, cb: (err?: Error | null) => void) {
          trace.push('write');
          return cb(null);
        }
      });
      const closeP = new Promise<void>((resolve, reject) => {
        stream.on('close', () => {
          try {
            expect(trace.length).toBe(2);
            expect(trace[0]).toBe('open');
            resolve();
          } catch (e) { reject(e); }
        });
      });
      stream.write('data');
      stream.end();
      await closeP;
    });

    await it('drain', async () => {
      const stream = new Writable({
        highWaterMark: 1,
        write(data: any, cb: (err?: Error | null) => void) { cb(null); }
      });

      expect(stream.write('a')).toBeFalsy();
      await new Promise<void>((resolve, reject) => {
        stream.on('drain', () => {
          try {
            expect(true).toBeTruthy();
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('drain multi write', async () => {
      const stream = new Writable({
        highWaterMark: 1,
        write(data: any, cb: (err?: Error | null) => void) { cb(null); }
      });

      expect(stream.write('a')).toBeFalsy();
      expect(stream.write('a')).toBeFalsy();
      expect(stream.write('a')).toBeFalsy();
      await new Promise<void>(resolve => stream.on('drain', resolve));
    });

    await it('drain async write', async () => {
      let flushed = false;
      const stream = new Writable({
        highWaterMark: 1,
        write(data: any, cb: (err?: Error | null) => void) {
          setImmediate(function () {
            flushed = true;
            cb(null);
          });
        }
      });

      expect(stream.write('a')).toBeFalsy();
      expect(flushed).toBeFalsy();
      await new Promise<void>((resolve, reject) => {
        stream.on('drain', () => {
          try {
            expect(flushed).toBeTruthy();
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('writev', async () => {
      const expected: string[][] = [[], ['ho']];
      for (let i = 0; i < 100; i++) expected[0].push('hi-' + i);

      const s = new Writable({
        writev(batch: any[], cb: (err?: Error | null) => void) {
          expect(batch).toStrictEqual(expected.shift());
          cb(null);
        }
      });

      for (let i = 0; i < 100; i++) s.write('hi-' + i);

      await new Promise<void>((resolve, reject) => {
        s.on('drain', function () {
          s.write('ho');
          s.end();
        });
        s.on('finish', () => {
          try {
            expect(expected.length).toBe(0);
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('map written data', async () => {
      const r = new Writable({
        write(data: any, cb: (err?: Error | null) => void) {
          expect(data).toBe('{"foo":1}');
          cb();
        },
        map: (input: any) => JSON.stringify(input)
      });
      const finishP = new Promise<void>(resolve => r.on('finish', resolve));
      r.write({ foo: 1 });
      r.end();
      await finishP;
    });

    await it('use mapWritable to map data', async () => {
      const r = new Writable({
        write(data: any, cb: (err?: Error | null) => void) {
          expect(data).toBe('{"foo":1}');
          cb();
        },
        map: () => { throw new Error('.mapWritable has priority'); },
        mapWritable: (input: any) => JSON.stringify(input)
      });
      const finishP = new Promise<void>(resolve => r.on('finish', resolve));
      r.write({ foo: 1 });
      r.end();
      await finishP;
    });

    await it('many ends', async () => {
      let finals = 0;
      let finish = 0;

      const s = new Duplex({
        final(cb: (err?: Error | null) => void) {
          finals++;
          cb(null);
        }
      });

      s.end();
      Promise.resolve().then(() => {
        s.end();
        Promise.resolve().then(() => { s.end(); });
      });

      await new Promise<void>((resolve, reject) => {
        s.on('finish', function () {
          finish++;
          try {
            expect(finals).toBe(1);
            expect(finish).toBe(1);
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('drained helper', async () => {
      const w = new Writable({
        write(data: any, cb: (err?: Error | null) => void) { setImmediate(cb); }
      });

      for (let i = 0; i < 20; i++) w.write('hi');
      await Writable.drained(w);
      expect(w._writableState.queue.length).toBe(0);

      for (let i = 0; i < 20; i++) w.write('hi');
      const d1 = Writable.drained(w);
      for (let i = 0; i < 20; i++) w.write('hi');
      const d2 = Writable.drained(w);

      let d1QueueLength = -1;
      d1.then(() => { d1QueueLength = w._writableState.queue.length; });

      await d1;
      await d2;

      expect(d1QueueLength).not.toBe(0);
      expect(w._writableState.queue.length).toBe(0);

      await Writable.drained(w);

      for (let i = 0; i < 20; i++) w.write('hi');
      const d3 = Writable.drained(w);
      w.destroy();

      expect(await d3).toBeFalsy();
      expect(await Writable.drained(w)).toBeFalsy();
    });

    await it('drained helper, duplex', async () => {
      const w = new Duplex({
        write(data: any, cb: (err?: Error | null) => void) { setImmediate(cb); }
      });

      for (let i = 0; i < 20; i++) w.write('hi');
      await Writable.drained(w);
      expect(w._writableState.queue.length).toBe(0);

      for (let i = 0; i < 20; i++) w.write('hi');
      const d1 = Writable.drained(w);
      for (let i = 0; i < 20; i++) w.write('hi');
      const d2 = Writable.drained(w);

      let d1QueueLength = -1;
      d1.then(() => { d1QueueLength = w._writableState.queue.length; });

      await d1;
      await d2;

      expect(d1QueueLength).not.toBe(0);
      expect(w._writableState.queue.length).toBe(0);

      await Writable.drained(w);

      for (let i = 0; i < 20; i++) w.write('hi');
      const d3 = Writable.drained(w);
      w.destroy();

      expect(await d3).toBeFalsy();
      expect(await Writable.drained(w)).toBeFalsy();
    });

    await it('drained helper, inflight write', async () => {
      let writing = false;
      const w = new Writable({
        write(data: any, cb: (err?: Error | null) => void) {
          writing = true;
          setImmediate(() => {
            setImmediate(() => {
              writing = false;
              cb();
            });
          });
        }
      });

      w.write('hello');
      w.end();

      await new Promise<void>(resolve => setImmediate(resolve));
      expect(writing).toBeTruthy();
      await Writable.drained(w);
      expect(writing).toBeFalsy();
    });

    await it('can cork and uncork the stream', async () => {
      const w = new Writable({
        writev(batch: any[], cb: (err?: Error | null) => void) {
          expect(batch).toStrictEqual([1, 2, 3]);
          cb(null);
        }
      });

      w.cork();
      w.write(1);
      await eventFlush();
      w.write(2);
      await eventFlush();
      w.write(3);
      w.uncork();

      await Writable.drained(w);
    });

  });
};
