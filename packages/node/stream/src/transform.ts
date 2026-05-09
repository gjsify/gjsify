// Transform stream — a Duplex whose readable side is fed by `_transform`.
//
// Reference: refs/node/lib/internal/streams/transform.js
// Reimplemented for GJS — direct opts.transform/flush/final assignment matches
// Node's instance-method override pattern.

import { nextTick } from '@gjsify/utils';
import type { TransformOptions } from 'node:stream';

import { Duplex_ } from './duplex.js';
import type { ErrCallback } from './internal/types.js';

type TransformFn = (this: Transform_, chunk: unknown, encoding: string, callback: (error?: Error | null, data?: unknown) => void) => void;
type FlushFn = (this: Transform_, callback: (error?: Error | null, data?: unknown) => void) => void;
type FinalFn = (this: Transform_, callback: ErrCallback) => void;

interface TransformInstanceMethods {
  _transform: TransformFn;
  _flush: FlushFn;
  _final: FinalFn;
}

export class Transform_ extends Duplex_ {
  constructor(opts?: TransformOptions) {
    // Don't forward transform/flush/final/write — Transform's own method assignments
    // handle those. Passing write/final through would register them in Duplex_'s
    // _writeImpl/_finalImpl and bypass Transform's override.
    super({ ...opts, write: undefined, final: undefined });
    // Direct assignment mirrors Node.js: opts.transform/flush/final overwrite the
    // prototype methods on the instance so `t._transform === opts.transform` holds.
    const self = this as unknown as TransformInstanceMethods;
    if (opts?.transform) self._transform = opts.transform as unknown as TransformFn;
    if (opts?.flush) self._flush = opts.flush as unknown as FlushFn;
    if (opts?.final) self._final = opts.final as unknown as FinalFn;
  }

  _transform(_chunk: unknown, _encoding: string, _callback: (error?: Error | null, data?: unknown) => void): void {
    // Throw when no implementation was provided (no opts.transform and no subclass override).
    const err = Object.assign(
      new Error('The _transform() method is not implemented'),
      { code: 'ERR_METHOD_NOT_IMPLEMENTED' }
    );
    throw err;
  }

  _flush(callback: (error?: Error | null, data?: unknown) => void): void {
    callback();
  }

  _write(chunk: unknown, encoding: string, callback: ErrCallback): void {
    let called = false;
    try {
      this._transform(chunk, encoding, (err, data) => {
        if (called) {
          const e = Object.assign(new Error('Callback called multiple times'), { code: 'ERR_MULTIPLE_CALLBACK' });
          nextTick(() => this.emit('error', e));
          return;
        }
        called = true;
        if (err) {
          callback(err);
          return;
        }
        if (data !== undefined && data !== null) {
          this.push(data);
        }
        callback();
      });
    } catch (err) {
      // ERR_METHOD_NOT_IMPLEMENTED must propagate synchronously (test-stream-transform-constructor-set-methods).
      // User-provided _transform errors are converted to 'error' events.
      const e = err as { code?: string };
      if (e?.code === 'ERR_METHOD_NOT_IMPLEMENTED') throw err;
      callback(err as Error);
    }
  }

  // Transform's built-in _final: calls _flush then pushes null.
  // This is the default; when the user provides opts.final it is overridden on
  // the instance and _doPrefinishHooks ensures _flush is still called after it.
  _final(callback: ErrCallback): void {
    this._flush((err, data) => {
      if (err) {
        callback(err);
        return;
      }
      if (data !== undefined && data !== null) {
        this.push(data);
      }
      // Signal readable side is done
      this.push(null);
      callback();
    });
  }

  // When a user-provided _final overrides the prototype method, we still need
  // to call the built-in flush+push-null logic (mirroring Node.js's prefinish).
  protected override _doPrefinishHooks(cb: () => void): void {
    const protoFinal = Transform_.prototype._final;
    if ((this as unknown as TransformInstanceMethods)._final !== protoFinal) {
      // User replaced _final; call the built-in flush+push-null now.
      protoFinal.call(this, cb);
    } else {
      // _final already ran flush+push-null; nothing extra needed.
      cb();
    }
  }
}
