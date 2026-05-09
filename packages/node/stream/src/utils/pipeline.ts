// pipeline — chain streams and propagate destroy on error.
//
// Reference: refs/node/lib/internal/streams/pipeline.js
// Reimplemented for GJS — minimal, callback-based variant. The promise form
// lives under `@gjsify/stream/promises` and wraps this.

import type { Stream_ } from '../stream-base.js';
import type { Writable_ } from '../writable.js';

export type PipelineCallback = (err: Error | null) => void;

/** A stream that can be destroyed (duck-typed for pipeline). */
export interface DestroyableStream extends Stream_ {
  destroy?(error?: Error): void;
}

export function pipeline(...args: [...streams: DestroyableStream[], callback: PipelineCallback] | DestroyableStream[]): DestroyableStream {
  const argList = args as Array<DestroyableStream | PipelineCallback>;
  const last = argList[argList.length - 1];
  const callback = typeof last === 'function' ? (argList.pop() as PipelineCallback) : undefined;
  const streams = argList as DestroyableStream[];

  if (streams.length < 2) {
    throw new Error('pipeline requires at least 2 streams');
  }

  let error: Error | null = null;

  function onError(err: Error) {
    if (!error) {
      error = err;
      // Destroy all streams
      for (const stream of streams) {
        if (typeof stream.destroy === 'function') {
          stream.destroy();
        }
      }
      if (callback) callback(err);
    }
  }

  // Pipe streams together
  let current: Stream_ = streams[0];
  for (let i = 1; i < streams.length; i++) {
    const next = streams[i];
    current.pipe(next as unknown as Writable_);
    current.on('error', onError);
    current = next;
  }

  // Listen for end on last stream
  const lastStream = streams[streams.length - 1];
  lastStream.on('error', onError);
  lastStream.on('finish', () => {
    if (callback && !error) callback(null);
  });

  return lastStream;
}
