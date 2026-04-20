// SPDX-License-Identifier: MIT
// Ported from refs/streamx/test/transform.js and refs/streamx/test/passthrough.js
// Original: Copyright (c) mafintosh and contributors. MIT.
// Rewritten for @gjsify/unit — behavior preserved, assertion dialect adapted.

import { describe, it, expect } from '@gjsify/unit';
import { Transform, PassThrough, Readable, Writable } from 'streamx';

export default async () => {
  await describe('streamx Transform', async () => {

    await it('default transform teardown when saturated', async () => {
      const stream = new Transform({
        transform(data: any, cb: (err?: Error | null, chunk?: any) => void) {
          cb(null, data);
        }
      });

      for (let i = 0; i < 20; i++) {
        stream.write('hello');
      }

      await new Promise<void>(resolve => setImmediate(resolve));

      stream.destroy();

      await new Promise<void>(resolve => stream.on('close', resolve));
    });

    await it('passthrough', async () => {
      let i = 0;
      const p = new PassThrough();
      const w = new Writable({
        write(data: any, cb: (err?: Error | null) => void) {
          i++;
          if (i === 1) expect(data).toBe('foo');
          else if (i === 2) expect(data).toBe('bar');
          else throw new Error('too many messages');
          cb();
        }
      });

      const r = new Readable();
      r.pipe(p).pipe(w);
      r.push('foo');
      r.push('bar');
      r.push(null);

      await new Promise<void>(resolve => w.on('finish', resolve));
      expect(i).toBe(2);
    });

  });
};
