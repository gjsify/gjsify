// SPDX-License-Identifier: MIT
// Ported from refs/streamx/test/pipeline.js
// Original: Copyright (c) mafintosh and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { pipeline, pipelinePromise, Transform, Readable, Writable } from 'streamx';

export default async () => {
  await describe('streamx pipeline', async () => {

    await it('piping to a writable', async () => {
      const received: any[] = [];
      const w = pipeline(
        Readable.from('hello'),
        new Writable({
          write(data: any, cb: (err?: Error | null) => void) {
            received.push(data);
            cb();
          }
        })
      );
      await new Promise<void>((resolve, reject) => {
        w.on('close', () => {
          try {
            expect(received).toStrictEqual(['hello']);
            resolve();
          } catch (e) { reject(e); }
        });
      });
    });

    await it('piping with error', async () => {
      const r = new Readable();
      const w = new Writable();
      const err = new Error();
      const result = await new Promise<any>(resolve => {
        pipeline(r, w, (error: any) => resolve(error));
        r.destroy(err);
      });
      expect(result).toStrictEqual(err);
    });

    await it('piping with final callback', async () => {
      const received: any[] = [];
      await new Promise<void>((resolve, reject) => {
        pipeline(
          Readable.from('hello'),
          new Writable({
            write(data: any, cb: (err?: Error | null) => void) {
              received.push(data);
              cb();
            }
          }),
          () => {
            try {
              expect(received).toStrictEqual(['hello']);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });
    });

    await it('piping with transform stream inbetween', async () => {
      const received: any[] = [];
      await new Promise<void>((resolve, reject) => {
        pipeline(
          [
            Readable.from('hello'),
            new Transform({
              transform(input: any, cb: (err?: Error | null, chunk?: any) => void) {
                this.push(input.length);
                cb();
              }
            }),
            new Writable({
              write(data: any, cb: (err?: Error | null) => void) {
                received.push(data);
                cb();
              }
            })
          ],
          () => {
            try {
              expect(received).toStrictEqual([5]);
              resolve();
            } catch (e) { reject(e); }
          }
        );
      });
    });

    await it('piping to a writable + promise', async () => {
      const r = Readable.from('hello');
      const received: any[] = [];
      let closed = false;
      r.on('close', () => { closed = true; });
      await pipelinePromise(
        r,
        new Writable({
          write(data: any, cb: (err?: Error | null) => void) {
            received.push(data);
            cb();
          }
        })
      );
      expect(received).toStrictEqual(['hello']);
      expect(closed).toBeTruthy();
    });

  });
};
