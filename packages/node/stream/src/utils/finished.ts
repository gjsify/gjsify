// finished + addAbortSignal + is* helpers.
//
// Reference: refs/node/lib/internal/streams/end-of-stream.js
//            refs/node/lib/internal/streams/utils.js
// Reimplemented for GJS using @gjsify/utils microtask scheduling.

import { queueMicrotask } from '@gjsify/utils';
import type { FinishedOptions } from 'node:stream';

import { Stream_ } from '../stream-base.js';
import type { Readable_ } from '../readable.js';
import type { Writable_ } from '../writable.js';

type AnyStream = Stream_ | Readable_ | Writable_;

export function finished(stream: AnyStream, callback: (err?: Error | null) => void): () => void;
export function finished(stream: AnyStream, opts: FinishedOptions, callback: (err?: Error | null) => void): () => void;
export function finished(stream: AnyStream, optsOrCb: FinishedOptions | ((err?: Error | null) => void), callback?: (err?: Error | null) => void): () => void {
  let cb: (err?: Error | null) => void;

  if (typeof optsOrCb === 'function') {
    cb = optsOrCb;
  } else {
    // opts not currently consumed — Node uses it for error/readable/writable filters.
    cb = callback!;
  }

  let called = false;
  function done(err?: Error | null) {
    if (!called) {
      called = true;
      cb(err);
    }
  }

  const onFinish = () => done();
  const onEnd = () => done();
  const onError = (err: Error) => done(err);
  const onClose = () => {
    const w = stream as Writable_;
    const r = stream as Readable_;
    if (!w.writableFinished && !r.readableEnded) {
      done(new Error('premature close'));
    }
  };

  stream.on('finish', onFinish);
  stream.on('end', onEnd);
  stream.on('error', onError);
  stream.on('close', onClose);

  // Check initial state — handle already-finished/destroyed streams
  // Reference: refs/node/lib/internal/streams/end-of-stream.js lines 228-249
  const s = stream as unknown as Record<string, unknown>;
  const isWritableStream = typeof (stream as Writable_).write === 'function';
  const isReadableStream = typeof (stream as Readable_).read === 'function';
  const writableFinished = s.writableFinished === true;
  const readableEnded = s.readableEnded === true;
  const destroyed = s.destroyed === true;

  if (destroyed) {
    const storedErr = s._err as Error | null | undefined;
    if (storedErr) {
      // Stream was destroyed with an error (may have fired before we registered listener)
      queueMicrotask(() => done(storedErr));
    } else if ((isWritableStream && writableFinished) || (isReadableStream && readableEnded)) {
      // Stream was destroyed after completing normally — treat as success
      queueMicrotask(() => done());
    } else {
      // Stream was destroyed without completing — premature close
      queueMicrotask(() => done(new Error('premature close')));
    }
  } else if (isWritableStream && !isReadableStream && writableFinished) {
    queueMicrotask(() => done());
  } else if (!isWritableStream && isReadableStream && readableEnded) {
    queueMicrotask(() => done());
  } else if (isWritableStream && isReadableStream && writableFinished && readableEnded) {
    queueMicrotask(() => done());
  }

  return function cleanup() {
    stream.removeListener('finish', onFinish);
    stream.removeListener('end', onEnd);
    stream.removeListener('error', onError);
    stream.removeListener('close', onClose);
  };
}

export function addAbortSignal<T extends AnyStream>(signal: AbortSignal, stream: T): T {
  if (!(signal instanceof AbortSignal)) {
    throw new TypeError('The first argument must be an AbortSignal');
  }
  if (!(stream instanceof Stream_)) {
    throw new TypeError('The second argument must be a Stream');
  }

  const destroyable = stream as Readable_ | Writable_;

  if (signal.aborted) {
    destroyable.destroy(new Error('The operation was aborted'));
  } else {
    const onAbort = () => {
      destroyable.destroy(new Error('The operation was aborted'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
    // Cleanup when stream closes
    stream.once('close', () => {
      signal.removeEventListener('abort', onAbort);
    });
  }

  return stream;
}

// ---- Utility functions ----

export function isReadable(stream: unknown): boolean {
  if (stream == null) return false;
  const s = stream as Record<string, unknown>;
  if (typeof s.readable !== 'boolean') return false;
  if (typeof s.read !== 'function') return false;
  if (s.destroyed === true) return false;
  if (s.readableEnded === true) return false;
  return s.readable === true;
}

export function isWritable(stream: unknown): boolean {
  if (stream == null) return false;
  const s = stream as Record<string, unknown>;
  if (typeof s.writable !== 'boolean') return false;
  if (typeof s.write !== 'function') return false;
  if (s.destroyed === true) return false;
  if (s.writableEnded === true) return false;
  return s.writable === true;
}

export function isDestroyed(stream: unknown): boolean {
  if (stream == null) return false;
  return (stream as Record<string, unknown>).destroyed === true;
}

export function isDisturbed(stream: unknown): boolean {
  if (stream == null) return false;
  const s = stream as Record<string, unknown>;
  // A stream is disturbed if data has been read from it
  return s.readableDidRead === true || (s.readableFlowing !== null && s.readableFlowing !== undefined);
}

export function isErrored(stream: unknown): boolean {
  if (stream == null) return false;
  // Check for errored state on either side
  const s = stream as Record<string, unknown>;
  if (s.destroyed === true && typeof s.readable === 'boolean' && s.readable === false) return true;
  if (s.destroyed === true && typeof s.writable === 'boolean' && s.writable === false) return true;
  return false;
}
