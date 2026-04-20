// SPDX-License-Identifier: MIT
// Ported from refs/streamx/test/readable.js
// Original: Copyright (c) mafintosh and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { Readable, isDisturbed } from 'streamx';

function nextImmediate(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

export default async () => {
  await describe('streamx Readable', async () => {

    await it('ondata', async () => {
      const r = new Readable();
      const buffered: any[] = [];
      let ended = 0;

      r.push('hello');
      r.push('world');
      r.push(null);

      r.on('data', (data: any) => buffered.push(data));
      r.on('end', () => ended++);

      await new Promise<void>((resolve, reject) => {
        r.on('close', () => {
          try {
            expect(buffered).toStrictEqual(['hello', 'world']);
            expect(ended).toBe(1);
            expect(r.destroyed).toBeTruthy();
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('pause', async () => {
      const r = new Readable();
      const buffered: any[] = [];
      expect(Readable.isPaused(r)).toBe(true);
      r.on('data', (data: any) => buffered.push(data));
      r.on('close', () => { /* ignored — we await below */ });
      r.push('hello');
      await nextImmediate();
      expect(r.pause()).toBe(r);
      expect(Readable.isPaused(r)).toBe(true);
      r.push('world');
      await nextImmediate();
      expect(buffered).toStrictEqual(['hello']);
      expect(r.resume()).toBe(r);
      expect(Readable.isPaused(r)).toBe(false);
      await nextImmediate();
      expect(buffered).toStrictEqual(['hello', 'world']);
      r.push(null);
    });

    await it('resume', async () => {
      const r = new Readable();
      let ended = 0;

      r.push('hello');
      r.push('world');
      r.push(null);

      r.resume();
      r.on('end', () => ended++);

      await new Promise<void>((resolve, reject) => {
        r.on('close', () => {
          try {
            expect(ended).toBe(1);
            expect(r.destroyed).toBeTruthy();
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('lazy open', async () => {
      let opened = false;
      const r = new Readable({
        open(cb: (err?: Error | null) => void) {
          opened = true;
          cb(null);
        }
      });
      await nextImmediate();
      expect(opened).toBeFalsy();
      r.read();
      await nextImmediate();
      expect(opened).toBeTruthy();
    });

    await it('eager open', async () => {
      let opened = false;
      const r = new Readable({
        open(cb: (err?: Error | null) => void) {
          opened = true;
          cb(null);
        },
        eagerOpen: true
      });
      await nextImmediate();
      expect(opened).toBeTruthy();
      r.push(null);
    });

    await it('shorthands', async () => {
      let destroyed = false;
      const r = new Readable({
        read(cb: (err?: Error | null) => void) {
          this.push('hello');
          cb(null);
        },
        destroy(cb: (err?: Error | null) => void) {
          destroyed = true;
          cb(null);
        }
      });

      await new Promise<void>((resolve, reject) => {
        r.once('readable', function () {
          try {
            expect(r.read()).toBe('hello');
            r.destroy();
            expect(r.read()).toBe(null);
            resolve();
          } catch (e) { reject(e); }
        });
      });
      expect(destroyed).toBeTruthy();
    });

    await it('both push and the cb needs to be called for re-reads', async () => {
      let once = true;

      const r = new Readable({
        read(cb: (err?: Error | null) => void) {
          expect(once).toBeTruthy();
          once = false;
          cb(null);
        }
      });

      r.resume();

      await new Promise<void>(resolve => {
        setTimeout(function () {
          once = true;
          r.push('hi');
          resolve();
        }, 100);
      });
    });

    await it('from array', async () => {
      const inc: any[] = [];
      const r = Readable.from([1, 2, 3]);
      r.on('data', (data: any) => inc.push(data));
      await new Promise<void>((resolve, reject) => {
        r.on('end', () => {
          try {
            expect(inc).toStrictEqual([1, 2, 3]);
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('from buffer', async () => {
      const inc: any[] = [];
      const r = Readable.from(Buffer.from('hello'));
      r.on('data', (data: any) => inc.push(data));
      await new Promise<void>((resolve, reject) => {
        r.on('end', () => {
          try {
            expect(inc).toStrictEqual([Buffer.from('hello')]);
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('from async iterator', async () => {
      async function* gen() {
        yield 1;
        yield 2;
        yield 3;
      }

      const inc: any[] = [];
      const r = Readable.from(gen());
      r.on('data', (data: any) => inc.push(data));
      await new Promise<void>((resolve, reject) => {
        r.on('end', () => {
          try {
            expect(inc).toStrictEqual([1, 2, 3]);
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('from array with highWaterMark', async () => {
      const r = Readable.from([1, 2, 3], { highWaterMark: 1 });
      expect(r._readableState.highWaterMark).toBe(1);
    });

    await it('from async iterator with highWaterMark', async () => {
      async function* gen() { yield 1; }
      const r = Readable.from(gen(), { highWaterMark: 1 });
      expect(r._readableState.highWaterMark).toBe(1);
    });

    await it('unshift', async () => {
      const r = new Readable();
      r.pause();
      r.push(1);
      r.push(2);
      r.unshift(0);
      r.push(null);
      const inc: any[] = [];
      for await (const entry of r) {
        inc.push(entry);
      }
      expect(inc).toStrictEqual([0, 1, 2]);
    });

    await it('from readable should return the original readable', async () => {
      const r = new Readable();
      expect(Readable.from(r)).toBe(r);
    });

    await it('map readable data', async () => {
      const r = new Readable({
        map: (input: any) => JSON.parse(input)
      });
      r.push('{ "foo": 1 }');
      for await (const obj of r) {
        expect(obj).toStrictEqual({ foo: 1 });
        break;
      }
    });

    await it('use mapReadable to map data', async () => {
      const r = new Readable({
        map: () => { throw new Error('.mapReadable has priority'); },
        mapReadable: (input: any) => JSON.parse(input)
      });
      r.push('{ "foo": 1 }');
      for await (const obj of r) {
        expect(obj).toStrictEqual({ foo: 1 });
        break;
      }
    });

    await it('live stream', async () => {
      const collected: any[] = [];
      const r = new Readable({
        read(cb: (err?: Error | null) => void) {
          this.push('data');
          this.push('data');
          this.push('data');
        }
      });

      await new Promise<void>((resolve, reject) => {
        r.on('data', function (data: any) {
          collected.push(data);
          if (collected.length === 3) {
            try {
              expect(collected).toStrictEqual(['data', 'data', 'data']);
              resolve();
            } catch (e) { reject(e); }
          }
        });
      });
    });

    await it('live stream with readable event', async () => {
      const collected: any[] = [];
      const r = new Readable({
        read(cb: (err?: Error | null) => void) {
          this.push('data');
          this.push('data');
          this.push('data');
        }
      });

      await new Promise<void>((resolve, reject) => {
        r.on('readable', function () {
          let data: any;
          while ((data = r.read()) !== null) collected.push(data);
          if (collected.length >= 3) {
            try {
              expect(collected.slice(0, 3)).toStrictEqual(['data', 'data', 'data']);
              resolve();
            } catch (e) { reject(e); }
          }
        });
      });
    });

    await it('no read-ahead with async iterator', async () => {
      let tick = 0;

      const r = new Readable({
        highWaterMark: 0,
        read(cb: (err?: Error | null) => void) {
          this.push('tick: ' + ++tick);
          if (tick === 10) this.push(null);
          cb();
        }
      });

      let expectedTick = 0;
      for await (const data of r) {
        expect(tick).toBe(++expectedTick);
        expect(data).toBe('tick: ' + tick);
        await nextImmediate();
      }

      expect(expectedTick).toBe(10);
    });

    await it('setEncoding', async () => {
      const r = new Readable();
      r.setEncoding('utf-8');
      const buffer = Buffer.from('hællå wørld!');
      for (let i = 0; i < buffer.byteLength; i++) {
        r.push(buffer.subarray(i, i + 1));
      }
      r.push(null);
      const expected = buffer.toString().split('');
      for await (const data of r) {
        expect(data).toBe(expected.shift());
      }
      expect(expected.length).toBe(0);
    });

    await it('setEncoding respects existing map', async () => {
      const r = new Readable({
        encoding: 'utf-8',
        map(data: any) { return JSON.parse(data); }
      });

      r.push('{"hello":"world"}');
      await new Promise<void>((resolve, reject) => {
        r.once('data', function (data: any) {
          try {
            expect(data).toStrictEqual({ hello: 'world' });
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('setEncoding empty string', async () => {
      const r = new Readable();
      r.setEncoding('utf-8');
      const buffer = Buffer.from('');
      r.push(buffer);
      r.push(null);

      const chunks: any[] = [];
      for await (const data of r) {
        chunks.push(data);
      }
      expect(chunks).toStrictEqual(['']);
    });

    await it('is disturbed', async () => {
      const r = new Readable();
      expect(isDisturbed(r)).toBe(false);

      r.push('hello');
      expect(isDisturbed(r)).toBe(false);

      r.resume();
      expect(isDisturbed(r)).toBe(true);

      r.pause();
      expect(isDisturbed(r)).toBe(true);
    });

    await it('is disturbed after immediate destroy', async () => {
      const r = new Readable();
      expect(isDisturbed(r)).toBe(false);

      r.destroy();
      expect(isDisturbed(r)).toBe(true);

      await new Promise<void>(resolve => r.on('close', resolve));
      expect(isDisturbed(r)).toBe(true);
    });

  });
};
