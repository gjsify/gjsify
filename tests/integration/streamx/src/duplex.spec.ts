// SPDX-License-Identifier: MIT
// Ported from refs/streamx/test/duplex.js and refs/streamx/test/destroy.js
// Original: Copyright (c) mafintosh and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { Duplex } from 'streamx';

export default async () => {
  await describe('streamx Duplex', async () => {

    await it('if open does not end, it should stall', async () => {
      let openCalled = false;
      const d = new Duplex({
        open() { openCalled = true; },
        read() { throw new Error('should not call read'); },
        write() { throw new Error('should not call write'); }
      });

      d.resume();
      d.write('hi');

      await new Promise<void>(resolve => setImmediate(resolve));
      expect(openCalled).toBeTruthy();
    });

    await it('mapReadable and mapWritable', async () => {
      const received: any[] = [];
      const d = new Duplex({
        write(data: any, cb: (err?: Error | null) => void) {
          d.push(data);
          cb();
        },
        final(cb: (err?: Error | null) => void) {
          d.push(null);
          cb();
        },
        mapReadable: (num: any) => JSON.stringify({ num }),
        mapWritable: (input: any) => parseInt(input, 10)
      });

      d.on('data', (data: any) => received.push(data));
      d.write('32');
      d.end();

      await new Promise<void>((resolve, reject) => {
        d.on('close', () => {
          try {
            expect(received).toStrictEqual(['{"num":32}']);
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('wait for readable', async () => {
      const d = new Duplex({
        read(cb: (err?: Error | null) => void) {
          d.push('ok');
          d.push(null);
          cb();
        }
      });

      await new Promise<void>((resolve, reject) => {
        d.on('readable', function () {
          try {
            expect(d.read()).toBe('ok');
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('write during end', async () => {
      const expected = ['a', 'b'];
      const received: any[] = [];

      const w = new Duplex({
        write(data: any, cb: (err?: Error | null) => void) {
          received.push(data);
          expect(data).toBe(expected.shift());
          cb(null);
        },
        final(cb: (err?: Error | null) => void) {
          w.write('bad');
          cb(null);
        }
      });

      w.write('a');
      w.write('b');
      w.end();
      w.on('finish', () => w.push(null));

      await new Promise<void>(resolve => w.on('close', resolve));
      expect(received).toStrictEqual(['a', 'b']);
    });

    await it('destroy is never sync', async () => {
      let openCb: ((err?: Error) => void) | null = null;
      const s = new Duplex({
        open(cb: (err?: Error) => void) { openCb = cb; },
        predestroy() { openCb!(new Error('stop')); }
      });

      s.resume();
      await new Promise<void>(resolve => setImmediate(resolve));
      s.destroy();
      await new Promise<void>(resolve => s.on('close', resolve));
    });

  });
};
