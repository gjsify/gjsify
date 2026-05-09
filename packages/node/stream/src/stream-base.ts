// Base Stream class — shared root of Readable, Writable, Duplex, Transform.
//
// Reference: refs/node/lib/internal/streams/legacy.js (Stream as EventEmitter+pipe)
// Reimplemented for GJS using @gjsify/events.

import { EventEmitter } from '@gjsify/events';

import type { StreamOptions } from './internal/types.js';
import type { Writable_ } from './writable.js';

/**
 * Late-bound pipe implementation. Wired by `./utils/pipe.ts` when it loads —
 * doing this lazily breaks what would otherwise be a top-level import cycle:
 *   stream-base → pipe → readable → stream-base.
 *
 * GJS / esbuild's `__esmMin` wrapper evaluates modules eagerly on first import
 * but stops at the cycle boundary, so `Readable_` would be `undefined` at the
 * point `Stream_` is declared (`class Readable_ extends Stream_` then fails
 * with "class heritage … is not an object or null"). The hook is set after
 * both classes finish initializing.
 */
let pipeImpl: <T extends Writable_>(source: Stream_, dest: T, opts?: { end?: boolean }) => T;

/** @internal Wired by ./utils/pipe.js (side-effect import in ./readable.ts). */
export function _setPipeImpl(fn: typeof pipeImpl): void {
  pipeImpl = fn;
}

export class Stream_ extends EventEmitter {
  constructor(opts?: StreamOptions) {
    super(opts);
  }

  pipe<T extends Writable_>(destination: T, options?: { end?: boolean }): T {
    return pipeImpl(this, destination, options);
  }
}
