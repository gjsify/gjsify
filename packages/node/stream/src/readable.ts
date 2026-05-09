// Readable stream — pull-based source with flowing/paused modes.
//
// Reference: refs/node/lib/internal/streams/readable.js
// Reimplemented for GJS using @gjsify/events + microtask scheduling.

import { nextTick } from '@gjsify/utils';
import type { ReadableOptions } from 'node:stream';

import { Stream_ } from './stream-base.js';
import { getDefaultHighWaterMark } from './internal/state.js';
import type { ErrCallback } from './internal/types.js';
import type { PipeState } from './utils/pipe.js';
import type { Writable_ } from './writable.js';

/** Internal readable-side state — exposed via `_readableState` for npm-stream consumers. */
export interface ReadableInternalState {
  ended: boolean;
  endEmitted: boolean;
  reading: boolean;
  constructed: boolean;
  highWaterMark: number;
  objectMode: boolean;
  pipes: Writable_[];
}

/** A stored buffer chunk: string, Buffer, Uint8Array, or any value in objectMode. */
type Chunk = unknown;

/** A chunk that has a `length` (string, Buffer, Uint8Array). */
interface HasLength {
  length: number;
}

function chunkLength(chunk: Chunk): number {
  if (chunk == null) return 1;
  const v = (chunk as Partial<HasLength>).length;
  return typeof v === 'number' ? v : 1;
}

/** Slice helper that works for Buffer/Uint8Array/string. */
function sliceChunk(chunk: Chunk, start: number, end?: number): Chunk {
  if (typeof chunk === 'string') {
    return end === undefined ? chunk.slice(start) : chunk.slice(start, end);
  }
  // Buffer.prototype.slice and Uint8Array.prototype.slice both share this signature.
  const slicer = (chunk as { slice?: (s: number, e?: number) => unknown }).slice;
  return typeof slicer === 'function' ? slicer.call(chunk, start, end) : chunk;
}

export class Readable_ extends Stream_ {
  readable = true;
  readableFlowing: boolean | null = null;
  readableLength = 0;
  readableHighWaterMark: number;
  readableEncoding: string | null;
  readableObjectMode: boolean;
  readableEnded = false;
  readableAborted = false;
  destroyed = false;

  /** @internal Tracked pipe destinations for unpipe. */
  _pipeDests: PipeState[] = [];

  /** @internal The internal data buffer. */
  private _buffer: Chunk[] = [];

  /** @internal Mirrors Node's `_readableState`; exposed for npm-stream consumers. */
  _readableState: ReadableInternalState = {
    ended: false,
    endEmitted: false,
    reading: false,
    constructed: true,
    highWaterMark: 0,
    objectMode: false,
    pipes: [],
  };

  /** @internal The error a `destroy(err)` call stored before the 'error' event fired. */
  _err?: Error;

  private _readablePending = false;
  private _readImpl: ((this: Readable_, size: number) => void) | undefined;
  private _destroyImpl: ((this: Readable_, error: Error | null, cb: ErrCallback) => void) | undefined;
  private _constructImpl: ((this: Readable_, cb: ErrCallback) => void) | undefined;

  constructor(opts?: ReadableOptions) {
    super(opts);
    this.readableHighWaterMark = opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.objectMode ?? false);
    this.readableEncoding = opts?.encoding ?? null;
    this.readableObjectMode = opts?.objectMode ?? false;
    this._readableState.highWaterMark = this.readableHighWaterMark;
    this._readableState.objectMode = this.readableObjectMode;
    if (opts?.read) this._readImpl = opts.read as unknown as (this: Readable_, size: number) => void;
    if (opts?.destroy) this._destroyImpl = opts.destroy as unknown as (this: Readable_, e: Error | null, cb: ErrCallback) => void;
    if (opts?.construct) this._constructImpl = opts.construct as unknown as (this: Readable_, cb: ErrCallback) => void;

    // Call _construct if provided via options or overridden by subclass
    const hasConstruct = this._constructImpl || this._construct !== Readable_.prototype._construct;
    if (hasConstruct) {
      this._readableState.constructed = false;
      nextTick(() => {
        this._construct((err) => {
          this._readableState.constructed = true;
          if (err) {
            this.destroy(err);
          } else {
            // If data was requested before construct finished, start reading
            if (this.readableFlowing === true) {
              this._flow();
            }
          }
        });
      });
    }
  }

  _construct(callback: ErrCallback): void {
    if (this._constructImpl) {
      this._constructImpl.call(this, callback);
    } else {
      callback();
    }
  }

  _read(_size: number): void {
    if (this._readImpl) {
      this._readImpl.call(this, _size);
    }
  }

  read(size?: number): unknown {
    // Don't read until constructed
    if (!this._readableState.constructed) return null;

    if (this._buffer.length === 0) {
      if (this._readableState.ended) return null;
      this._readableState.reading = true;
      this._read(size ?? this.readableHighWaterMark);
      this._readableState.reading = false;
    }

    if (this._buffer.length === 0) return null;

    if (size === 0) return null;

    if (this.readableObjectMode) {
      if (size === undefined) {
        const chunk = this._buffer.shift();
        this.readableLength -= 1;
        if (this._readableState.ended && this._buffer.length === 0 && !this._readableState.endEmitted) {
          this._emitEnd();
        }
        return chunk;
      }
      // In objectMode, size means number of objects
      if (size > this.readableLength) return null;
      const chunk = this._buffer.shift();
      this.readableLength -= 1;
      return chunk;
    }

    // Byte mode: compute total buffered bytes
    if (size !== undefined && size !== null) {
      if (size > this.readableLength) return null;
      // Partial read: extract exactly `size` bytes from buffer
      return this._readBytes(size);
    }

    // Read all buffered data
    const result = this._buffer.splice(0);
    this.readableLength = 0;
    if (this._readableState.ended && this._buffer.length === 0 && !this._readableState.endEmitted) {
      this._emitEnd();
    }
    if (result.length === 1) return result[0];
    if (result.length === 0) return null;
    // Concatenate: strings with join, buffers with Buffer.concat
    if (typeof result[0] === 'string') return (result as string[]).join('');
    const BufCtor = (globalThis as { Buffer?: { concat?: (parts: unknown[]) => unknown } }).Buffer;
    return BufCtor?.concat ? BufCtor.concat(result) : result;
  }

  /** @internal Extract exactly `size` bytes from the internal buffer. */
  private _readBytes(size: number): unknown {
    let collected = 0;
    const parts: Chunk[] = [];
    while (collected < size && this._buffer.length > 0) {
      const chunk = this._buffer[0];
      const chunkLen = chunkLength(chunk);
      if (collected + chunkLen <= size) {
        // Take the whole chunk
        parts.push(this._buffer.shift()!);
        collected += chunkLen;
        this.readableLength -= chunkLen;
      } else {
        // Split the chunk
        const needed = size - collected;
        parts.push(sliceChunk(chunk, 0, needed));
        this._buffer[0] = sliceChunk(chunk, needed);
        this.readableLength -= needed;
        collected += needed;
      }
    }
    if (parts.length === 1) return parts[0];
    const BufCtor = (globalThis as { Buffer?: { concat?: (parts: unknown[]) => unknown } }).Buffer;
    return BufCtor?.concat ? BufCtor.concat(parts) : parts;
  }

  push(chunk: unknown, _encoding?: string): boolean {
    if (chunk === null) {
      this._readableState.ended = true;
      this.readableEnded = true;
      if (this._buffer.length === 0 && !this._readableState.endEmitted) {
        nextTick(() => this._emitEnd());
      }
      // Emit 'readable' for listeners waiting on EOF with buffered data
      this._scheduleReadable();
      return false;
    }

    // Validate chunk type for non-objectMode streams (Node.js ERR_INVALID_ARG_TYPE).
    // Accept string, Buffer, or any ArrayBufferView — the latter covers Uint8Array
    // and TypedArrays from any realm (GJS vs host bundle), avoiding cross-realm
    // `instanceof Uint8Array` mismatches that would otherwise reject real Buffers.
    if (!this.readableObjectMode) {
      const isValid = typeof chunk === 'string' || ArrayBuffer.isView(chunk);
      if (!isValid) {
        const err = Object.assign(
          new TypeError(`Invalid non-string/buffer chunk type: ${typeof chunk}`),
          { code: 'ERR_INVALID_ARG_TYPE' }
        );
        nextTick(() => this.emit('error', err));
        return false;
      }
    }

    this._buffer.push(chunk);
    this.readableLength += this.readableObjectMode ? 1 : chunkLength(chunk);

    // In flowing mode, schedule draining (unless already flowing)
    if (this.readableFlowing && !this._flowing) {
      nextTick(() => this._flow());
    }

    // In non-flowing mode, emit 'readable' to notify data is available
    if (this.readableFlowing !== true) {
      this._scheduleReadable();
    }

    return this.readableLength < this.readableHighWaterMark;
  }

  /** Emit 'end' followed by 'close' (matches Node.js autoDestroy behavior). */
  private _emitEnd(): void {
    if (this._readableState.endEmitted) return;
    this._readableState.endEmitted = true;
    this.emit('end');
    nextTick(() => this._autoClose());
  }

  /** Override in subclasses to suppress automatic 'close' after 'end'. */
  protected _autoClose(): void {
    this.emit('close');
  }

  /** Schedule a single 'readable' event per microtask cycle (deduplicates multiple pushes). */
  private _scheduleReadable(): void {
    if (this._readablePending || this.listenerCount('readable') === 0) return;
    this._readablePending = true;
    nextTick(() => {
      this._readablePending = false;
      if (!this.destroyed) this.emit('readable');
    });
  }

  on(event: string | symbol, listener: (...args: unknown[]) => void): this {
    super.on(event, listener);
    // Attaching a 'data' listener switches to flowing mode (like Node.js)
    if (event === 'data' && this.readableFlowing !== false) {
      this.resume();
    }
    // Attaching a 'readable' listener: if data is already buffered, schedule event
    if (event === 'readable' && (this._buffer.length > 0 || this._readableState.ended)) {
      this._scheduleReadable();
    }
    return this;
  }

  unshift(chunk: unknown): void {
    this._buffer.unshift(chunk);
    this.readableLength += this.readableObjectMode ? 1 : chunkLength(chunk);
  }

  setEncoding(encoding: string): this {
    this.readableEncoding = encoding;
    return this;
  }

  pause(): this {
    this.readableFlowing = false;
    this.emit('pause');
    return this;
  }

  resume(): this {
    if (this.readableFlowing !== true) {
      this.readableFlowing = true;
      this.emit('resume');
      // Start flowing: drain buffered data and call _read
      if (this._readableState.constructed) {
        this._flow();
      }
    }
    return this;
  }

  private _flowing = false;

  private _flow(): void {
    if (this.readableFlowing !== true || this._flowing || this.destroyed) return;
    if (!this._readableState.constructed) return;
    this._flowing = true;

    try {
      // Drain buffered data synchronously (like Node.js flow())
      while (this._buffer.length > 0 && this.readableFlowing && !this.destroyed) {
        let chunk = this._buffer.shift()!;
        this.readableLength -= this.readableObjectMode ? 1 : chunkLength(chunk);
        // Decode to string when setEncoding was called
        if (this.readableEncoding && typeof chunk !== 'string') {
          const BufCtor = (globalThis as { Buffer?: { isBuffer?: (v: unknown) => boolean } }).Buffer;
          if (BufCtor?.isBuffer && BufCtor.isBuffer(chunk)) {
            chunk = (chunk as { toString: (enc: string) => string }).toString(this.readableEncoding);
          } else if (chunk instanceof Uint8Array) {
            chunk = new TextDecoder(this.readableEncoding).decode(chunk);
          }
        }
        this.emit('data', chunk);
      }

      if (this.destroyed) return;

      // If ended and buffer drained, emit end
      if (this._readableState.ended && this._buffer.length === 0 && !this._readableState.endEmitted) {
        nextTick(() => this._emitEnd());
        return;
      }

      // Call _read to get more data (may push synchronously)
      if (!this._readableState.ended && !this._readableState.reading && !this.destroyed) {
        this._readableState.reading = true;
        this._read(this.readableHighWaterMark);
        this._readableState.reading = false;
      }
    } finally {
      this._flowing = false;
    }

    // After _read, if new data was pushed, schedule another flow
    if (this._buffer.length > 0 && this.readableFlowing && !this.destroyed) {
      nextTick(() => this._flow());
    }
  }

  isPaused(): boolean {
    return this.readableFlowing === false;
  }

  unpipe(destination?: Writable_): this {
    if (!destination) {
      // Remove all piped destinations
      for (const state of this._pipeDests) {
        state.cleanup();
        state.dest.emit('unpipe', this);
      }
      this._pipeDests = [];
      this._readableState.pipes = [];
      this.readableFlowing = false;
    } else {
      const idx = this._pipeDests.findIndex(s => s.dest === destination);
      if (idx !== -1) {
        const state = this._pipeDests[idx];
        state.cleanup();
        this._pipeDests.splice(idx, 1);
        const pipeIdx = this._readableState.pipes.indexOf(destination);
        if (pipeIdx !== -1) this._readableState.pipes.splice(pipeIdx, 1);
        destination.emit('unpipe', this);
        if (this._pipeDests.length === 0) {
          this.readableFlowing = false;
        }
      }
    }
    return this;
  }

  _destroy(error: Error | null, callback: ErrCallback): void {
    if (this._destroyImpl) {
      this._destroyImpl.call(this, error, callback);
    } else {
      callback(error ?? undefined);
    }
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.readable = false;
    this.readableAborted = !this.readableEnded;
    // Store the error so finished() can retrieve it if called after destroy() but before 'error' fires
    if (error) this._err = error;

    const cb: ErrCallback = (err) => {
      // Emit error and close in separate nextTick calls (matches Node.js behavior)
      // so an unhandled error doesn't prevent 'close' from firing
      if (err) nextTick(() => this.emit('error', err));
      nextTick(() => this.emit('close'));
    };

    // Dispatch virtually ONLY when the user overrode _destroy on the instance
    // (e.g. tests: `stream._destroy = fn`). Do NOT call a subclass prototype
    // _destroy: net.Socket's prototype `_destroy` synchronously cancels in-flight
    // Gio I/O and would break tests that call destroy() during pending writes.
    // The opts.destroy path still runs via _destroyImpl as before.
    if (Object.prototype.hasOwnProperty.call(this, '_destroy')) {
      (this as Readable_)._destroy(error ?? null, cb);
    } else if (this._destroyImpl) {
      this._destroyImpl.call(this, error ?? null, cb);
    } else {
      cb(error);
    }

    return this;
  }

  /**
   * Converts this Node.js Readable to a Web ReadableStream.
   * Used by @hono/node-server to bridge Node.js HTTP → Web Standard Request.
   */
  static toWeb(nodeReadable: Readable_): ReadableStream<Uint8Array> {
    return new ReadableStream({
      start(controller) {
        nodeReadable.on('data', (chunk: unknown) => {
          if (typeof chunk === 'string') {
            controller.enqueue(new TextEncoder().encode(chunk));
          } else if (chunk instanceof Uint8Array) {
            controller.enqueue(chunk);
          } else if (chunk && typeof (chunk as Partial<HasLength>).length === 'number') {
            controller.enqueue(new Uint8Array(chunk as ArrayLike<number>));
          }
        });
        nodeReadable.on('end', () => {
          controller.close();
        });
        nodeReadable.on('error', (err: Error) => {
          controller.error(err);
        });
      },
      cancel() {
        nodeReadable.destroy();
      },
    });
  }

  /**
   * Creates a Node.js Readable from a Web ReadableStream.
   */
  static fromWeb(webStream: ReadableStream<Uint8Array>, options?: ReadableOptions): Readable_ {
    const reader = webStream.getReader();
    return new Readable_({
      ...options,
      read() {
        reader.read().then(
          ({ done, value }) => {
            if (done) {
              this.push(null);
            } else {
              this.push(value);
            }
          },
          (err) => {
            this.destroy(err);
          },
        );
      },
      destroy(error, callback) {
        reader.cancel(error?.message).then(() => callback(null), callback);
      },
    });
  }

  [Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
    const readable = this;
    const buffer: unknown[] = [];
    let done = false;
    let error: Error | null = null;
    let waitingResolve: ((value: IteratorResult<unknown>) => void) | null = null;
    let waitingReject: ((reason: unknown) => void) | null = null;

    readable.on('data', (chunk: unknown) => {
      if (waitingResolve) {
        const resolve = waitingResolve;
        waitingResolve = null;
        waitingReject = null;
        resolve({ value: chunk, done: false });
      } else {
        buffer.push(chunk);
      }
    });

    readable.on('end', () => {
      done = true;
      if (waitingResolve) {
        const resolve = waitingResolve;
        waitingResolve = null;
        waitingReject = null;
        resolve({ value: undefined, done: true });
      }
    });

    readable.on('error', (err: Error) => {
      error = err;
      done = true;
      if (waitingReject) {
        const reject = waitingReject;
        waitingResolve = null;
        waitingReject = null;
        reject(err);
      }
    });

    return {
      next(): Promise<IteratorResult<unknown>> {
        if (error) return Promise.reject(error);
        if (buffer.length > 0) return Promise.resolve({ value: buffer.shift(), done: false });
        if (done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve, reject) => {
          waitingResolve = resolve;
          waitingReject = reject;
        });
      },
      return(): Promise<IteratorResult<unknown>> {
        readable.destroy();
        return Promise.resolve({ value: undefined, done: true });
      },
      [Symbol.asyncIterator]() { return this; }
    };
  }

  static from(iterable: Iterable<unknown> | AsyncIterable<unknown>, opts?: ReadableOptions): Readable_ {
    const readable = new Readable_({
      objectMode: true,
      ...opts,
      read() {}
    });

    // Buffer, Uint8Array, and strings should be pushed as a single chunk,
    // not iterated element-by-element (matching Node.js Readable.from behavior)
    if (typeof iterable === 'string' || ArrayBuffer.isView(iterable)) {
      readable.push(iterable);
      readable.push(null);
      return readable;
    }

    (async () => {
      try {
        for await (const chunk of iterable as AsyncIterable<unknown>) {
          if (!readable.push(chunk)) {
            // Backpressure — wait for drain
            await new Promise<void>(resolve => readable.once('drain', resolve));
          }
        }
        readable.push(null);
      } catch (err) {
        readable.destroy(err as Error);
      }
    })();

    return readable;
  }
}
