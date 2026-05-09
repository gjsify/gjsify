// Free-function pipe helper used by Stream_.pipe.
//
// Reference: refs/node/lib/internal/streams/legacy.js Stream.prototype.pipe.
// Reimplemented for GJS — extracted so stream-base.ts (Stream_) can stay
// dependency-free of the per-class files. The Readable_ instance check is
// resolved lazily at call time, breaking what would otherwise be a top-level
// import cycle (stream-base → pipe → readable → stream-base).

import { _setPipeImpl, type Stream_ } from '../stream-base.js';
import { Readable_ } from '../readable.js';
import type { Writable_ } from '../writable.js';
import type { StreamLike } from '../internal/types.js';

/** Tracked pipe destination for unpipe support. */
export interface PipeState {
  dest: Writable_;
  cleanup: () => void;
}

export function pipe<T extends Writable_>(
  sourceStream: Stream_,
  destination: T,
  options?: { end?: boolean },
): T {
  // The source is conceptually Readable-shaped; the legacy Stream signature
  // allows any EventEmitter that emits 'data'/'end'/'close', so we keep the
  // structural cast and only branch on the modern Readable_ check below.
  const source = sourceStream as unknown as Readable_;
  const doEnd = options?.end !== false;

  // Drain listener is added lazily only when backpressure occurs.
  let drainListenerAdded = false;
  const ondrain = () => {
    drainListenerAdded = false;
    destination.removeListener('drain', ondrain);
    const s = source as StreamLike;
    if (typeof s.resume === 'function') {
      s.resume();
    }
  };

  const ondata = (chunk: unknown) => {
    if (destination.writable) {
      const s = source as StreamLike;
      if (destination.write(chunk) === false && typeof s.pause === 'function') {
        s.pause();
        if (!drainListenerAdded) {
          drainListenerAdded = true;
          destination.on('drain', ondrain);
        }
      }
    }
  };

  source.on('data', ondata);

  let didEnd = false;

  const onend = () => {
    if (didEnd) return;
    didEnd = true;
    if (doEnd) destination.end();
  };

  const onclose = () => {
    if (didEnd) return;
    didEnd = true;
    if (doEnd) {
      // Modern Readable streams (Readable_) do NOT destroy dest on source close —
      // only call dest.end/destroy for legacy Stream objects (no Readable_ prototype).
      if (!(source instanceof Readable_)) {
        const d = destination as unknown as { destroy?: () => void };
        if (typeof d.destroy === 'function') {
          d.destroy();
        }
      }
    }
  };

  if (doEnd) {
    source.on('end', onend);
    source.on('close', onclose);
  }

  const cleanup = () => {
    source.removeListener('data', ondata);
    if (drainListenerAdded) destination.removeListener('drain', ondrain);
    source.removeListener('end', onend);
    source.removeListener('close', onclose);
    // Self-remove from both end and close
    source.removeListener('end', cleanup);
    source.removeListener('close', cleanup);
    destination.removeListener('close', cleanup);
  };

  source.on('end', cleanup);
  source.on('close', cleanup);
  destination.on('close', cleanup);

  // Track piped destinations for unpipe
  if (source instanceof Readable_) {
    source._pipeDests.push({ dest: destination, cleanup });
    source._readableState.pipes.push(destination);
  }

  destination.emit('pipe', source);
  return destination;
}

// Wire the implementation back into Stream_.prototype.pipe — see _setPipeImpl
// in ../stream-base.ts for why this is done at module-load time rather than
// via a static top-level import.
_setPipeImpl(pipe);
