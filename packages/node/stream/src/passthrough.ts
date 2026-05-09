// PassThrough — Transform whose `_transform` is the identity.
//
// Reference: refs/node/lib/internal/streams/passthrough.js
// Reimplemented for GJS.

import type { TransformOptions } from 'node:stream';

import { Transform_ } from './transform.js';

export class PassThrough_ extends Transform_ {
  constructor(opts?: TransformOptions) {
    super({
      ...opts,
      transform(chunk: unknown, _encoding: string, callback: (error?: Error | null, data?: unknown) => void) {
        callback(null, chunk);
      }
    });
  }
}
