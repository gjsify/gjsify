// Shared types used across the per-class stream modules.
//
// Reference: refs/node/lib/stream.js, refs/node/lib/internal/streams/*.js
// Reimplemented for GJS — kept tiny on purpose; per-class files own their own
// public option interfaces (re-exported via Node's `node:stream` types).

import type { EventEmitter } from '@gjsify/events';

/** Base options accepted by the Stream constructor (superset used by subclass options). */
export interface StreamOptions {
  highWaterMark?: number;
  objectMode?: boolean;
  signal?: AbortSignal;
  captureRejections?: boolean;
}

/** A stream-like emitter that may have `pause` and `resume` methods (duck-typed). */
export interface StreamLike extends EventEmitter {
  pause?(): void;
  resume?(): void;
}

/** Internal write-buffer entry shared by Writable and Duplex queues. */
export interface BufferedWrite {
  chunk: unknown;
  encoding: string;
  callback: (error?: Error | null) => void;
}

/** Generic node-style error callback. */
export type ErrCallback = (error?: Error | null) => void;
