// stream/promises — Promise-based stream utilities

import { pipeline as _pipeline, finished as _finished } from '../index.js';
import type { Stream, Readable, Writable } from '../index.js';

export function pipeline(...streams: any[]): Promise<void> {
  return new Promise((resolve, reject) => {
    _pipeline(...streams, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

export function finished(stream: Stream | Readable | Writable, opts?: any): Promise<void> {
  return new Promise((resolve, reject) => {
    if (opts && typeof opts !== 'function') {
      _finished(stream, opts, (err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    } else {
      _finished(stream, (err?: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    }
  });
}

export default { pipeline, finished };
