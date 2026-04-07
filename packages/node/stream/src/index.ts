// Reference: Node.js lib/stream.js, lib/internal/streams/*.js
// Reimplemented for GJS using EventEmitter and microtask scheduling

import { EventEmitter } from '@gjsify/events';
import { nextTick } from '@gjsify/utils';
import type { ReadableOptions, WritableOptions, DuplexOptions, TransformOptions, FinishedOptions } from 'node:stream';

// ---- Default high water marks ----

let defaultHighWaterMark = 16384;
let defaultObjectHighWaterMark = 16;

export function getDefaultHighWaterMark(objectMode: boolean): number {
  return objectMode ? defaultObjectHighWaterMark : defaultHighWaterMark;
}

export function setDefaultHighWaterMark(objectMode: boolean, value: number): void {
  if (typeof value !== 'number' || value < 0 || Number.isNaN(value)) {
    throw new TypeError(`Invalid highWaterMark: ${value}`);
  }
  if (objectMode) {
    defaultObjectHighWaterMark = value;
  } else {
    defaultHighWaterMark = value;
  }
}

// ---- Types ----

/** Base options accepted by the Stream constructor (superset used by subclass options). */
export interface StreamOptions {
  highWaterMark?: number;
  objectMode?: boolean;
  signal?: AbortSignal;
  captureRejections?: boolean;
}

export type { ReadableOptions, WritableOptions, DuplexOptions, TransformOptions, FinishedOptions };

// ---- Stream base class ----

/** A stream-like emitter that may have `pause` and `resume` methods (duck-typed). */
interface StreamLike extends EventEmitter {
  pause?(): void;
  resume?(): void;
}

/** Tracked pipe destination for unpipe support. */
interface PipeState {
  dest: Writable;
  ondata: (chunk: unknown) => void;
  ondrain: () => void;
  onend: () => void;
  cleanup: () => void;
  doEnd: boolean;
}

class Stream_ extends EventEmitter {
  constructor(opts?: StreamOptions) {
    super(opts);
  }

  pipe<T extends Writable>(destination: T, options?: { end?: boolean }): T {
    const source = this as unknown as Readable;
    const doEnd = options?.end !== false;

    const ondata = (chunk: unknown) => {
      if (destination.writable) {
        if (destination.write(chunk) === false && typeof (source as StreamLike).pause === 'function') {
          (source as StreamLike).pause!();
        }
      }
    };

    source.on('data', ondata);

    const ondrain = () => {
      if (typeof (source as StreamLike).resume === 'function') {
        (source as StreamLike).resume!();
      }
    };
    destination.on('drain', ondrain);

    const onend = () => {
      if (doEnd) {
        destination.end();
      }
    };
    if (doEnd) {
      source.on('end', onend);
    }

    const cleanup = () => {
      source.removeListener('data', ondata);
      destination.removeListener('drain', ondrain);
      source.removeListener('end', onend);
    };

    source.on('close', cleanup);
    destination.on('close', cleanup);

    // Track piped destinations for unpipe
    if (source instanceof Readable) {
      source._pipeDests.push({ dest: destination, ondata, ondrain, onend, cleanup, doEnd });
    }

    destination.emit('pipe', source);
    return destination;
  }
}

// ---- Readable ----

class Readable_ extends Stream_ {
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

  private _buffer: unknown[] = [];
  private _readableState = { ended: false, endEmitted: false, reading: false, constructed: true };
  private _readablePending = false;
  private _readImpl: ((size: number) => void) | undefined;
  private _destroyImpl: ((error: Error | null, cb: (error?: Error | null) => void) => void) | undefined;
  private _constructImpl: ((cb: (error?: Error | null) => void) => void) | undefined;

  constructor(opts?: ReadableOptions) {
    super(opts);
    this.readableHighWaterMark = opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.objectMode ?? false);
    this.readableEncoding = opts?.encoding ?? null;
    this.readableObjectMode = opts?.objectMode ?? false;
    if (opts?.read) this._readImpl = opts.read;
    if (opts?.destroy) this._destroyImpl = opts.destroy;
    if (opts?.construct) this._constructImpl = opts.construct;

    // Call _construct if provided via options or overridden by subclass
    const hasConstruct = this._constructImpl || this._construct !== Readable.prototype._construct;
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

  _construct(callback: (error?: Error | null) => void): void {
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

  read(size?: number): any {
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
    if (typeof result[0] === 'string') return result.join('');
    const BufCtor = (globalThis as any).Buffer;
    return BufCtor?.concat ? BufCtor.concat(result) : result;
  }

  /** @internal Extract exactly `size` bytes from the internal buffer. */
  private _readBytes(size: number): any {
    let collected = 0;
    const parts: unknown[] = [];
    while (collected < size && this._buffer.length > 0) {
      const chunk = this._buffer[0];
      const chunkLen = (chunk as any).length ?? 1;
      if (collected + chunkLen <= size) {
        // Take the whole chunk
        parts.push(this._buffer.shift()!);
        collected += chunkLen;
        this.readableLength -= chunkLen;
      } else {
        // Split the chunk
        const needed = size - collected;
        const BufCtor = (globalThis as any).Buffer;
        if (BufCtor && BufCtor.isBuffer(chunk)) {
          parts.push((chunk as any).slice(0, needed));
          this._buffer[0] = (chunk as any).slice(needed);
        } else if (typeof chunk === 'string') {
          parts.push(chunk.slice(0, needed));
          this._buffer[0] = chunk.slice(needed);
        } else {
          // Uint8Array or similar
          parts.push((chunk as Uint8Array).slice(0, needed));
          this._buffer[0] = (chunk as Uint8Array).slice(needed);
        }
        this.readableLength -= needed;
        collected += needed;
      }
    }
    if (parts.length === 1) return parts[0];
    const BufCtor = (globalThis as any).Buffer;
    return BufCtor?.concat ? BufCtor.concat(parts) : parts;
  }

  push(chunk: any, encoding?: string): boolean {
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

    this._buffer.push(chunk);
    this.readableLength += this.readableObjectMode ? 1 : (chunk.length ?? 1);

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
    nextTick(() => this.emit('close'));
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

  on(event: string | symbol, listener: (...args: any[]) => void): this {
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

  unshift(chunk: any): void {
    this._buffer.unshift(chunk);
    this.readableLength += this.readableObjectMode ? 1 : (chunk.length ?? 1);
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
        this.readableLength -= this.readableObjectMode ? 1 : ((chunk as { length?: number }).length ?? 1);
        // Decode to string when setEncoding was called
        if (this.readableEncoding && typeof chunk !== 'string') {
          const BufCtor = (globalThis as any).Buffer;
          if (BufCtor && BufCtor.isBuffer(chunk)) {
            chunk = (chunk as any).toString(this.readableEncoding);
          } else if (chunk instanceof Uint8Array) {
            chunk = new TextDecoder(this.readableEncoding).decode(chunk as Uint8Array);
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

  unpipe(destination?: Writable): this {
    if (!destination) {
      // Remove all piped destinations
      for (const state of this._pipeDests) {
        state.cleanup();
        state.dest.emit('unpipe', this);
      }
      this._pipeDests = [];
      this.readableFlowing = false;
    } else {
      const idx = this._pipeDests.findIndex(s => s.dest === destination);
      if (idx !== -1) {
        const state = this._pipeDests[idx];
        state.cleanup();
        this._pipeDests.splice(idx, 1);
        destination.emit('unpipe', this);
        if (this._pipeDests.length === 0) {
          this.readableFlowing = false;
        }
      }
    }
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.readable = false;
    this.readableAborted = !this.readableEnded;

    const cb = (err?: Error | null) => {
      // Emit error and close in separate nextTick calls (matches Node.js behavior)
      // so an unhandled error doesn't prevent 'close' from firing
      if (err) nextTick(() => this.emit('error', err));
      nextTick(() => this.emit('close'));
    };

    if (this._destroyImpl) {
      this._destroyImpl.call(this, error ?? null, cb);
    } else {
      cb(error);
    }

    return this;
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

  static from(iterable: Iterable<unknown> | AsyncIterable<unknown>, opts?: ReadableOptions): Readable {
    const readable = new Readable({
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

// ---- Writable ----

class Writable_ extends Stream_ {
  writable = true;
  writableHighWaterMark: number;
  writableLength = 0;
  writableObjectMode: boolean;
  writableEnded = false;
  writableFinished = false;
  writableCorked = 0;
  writableNeedDrain = false;
  destroyed = false;

  private _writableState = { ended: false, finished: false, constructed: true, writing: false };
  private _corkedBuffer: Array<{ chunk: any; encoding: string; callback: (error?: Error | null) => void }> = [];
  private _writeBuffer: Array<{ chunk: any; encoding: string; callback: (error?: Error | null) => void }> = [];
  private _pendingConstruct: Array<{ chunk: any; encoding: string; callback: (error?: Error | null) => void }> = [];
  private _ending = false;
  private _endCallback?: () => void;
  private _pendingEnd: { chunk?: any; encoding?: string; callback?: () => void } | null = null;
  private _writeImpl: ((chunk: any, encoding: string, cb: (error?: Error | null) => void) => void) | undefined;
  private _writev: ((chunks: Array<{ chunk: any; encoding: string }>, cb: (error?: Error | null) => void) => void) | undefined;
  private _finalImpl: ((cb: (error?: Error | null) => void) => void) | undefined;
  private _destroyImpl: ((error: Error | null, cb: (error?: Error | null) => void) => void) | undefined;
  private _constructImpl: ((cb: (error?: Error | null) => void) => void) | undefined;
  private _decodeStrings: boolean;
  private _defaultEncoding = 'utf8';

  constructor(opts?: WritableOptions) {
    super(opts);
    this.writableHighWaterMark = opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.objectMode ?? false);
    this.writableObjectMode = opts?.objectMode ?? false;
    this._decodeStrings = opts?.decodeStrings !== false;
    if (opts?.write) this._writeImpl = opts.write;
    if (opts?.writev) this._writev = opts.writev;
    if (opts?.final) this._finalImpl = opts.final;
    if (opts?.destroy) this._destroyImpl = opts.destroy;
    if (opts?.construct) this._constructImpl = opts.construct;

    // Call _construct if provided via options or overridden by subclass
    const hasConstruct = this._constructImpl || this._construct !== Writable.prototype._construct;
    if (hasConstruct) {
      this._writableState.constructed = false;
      nextTick(() => {
        this._construct((err) => {
          this._writableState.constructed = true;
          if (err) {
            this.destroy(err);
          } else {
            this._maybeFlush();
          }
        });
      });
    }
  }

  _construct(callback: (error?: Error | null) => void): void {
    if (this._constructImpl) {
      this._constructImpl.call(this, callback);
    } else {
      callback();
    }
  }

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    if (this._writeImpl) {
      this._writeImpl.call(this, chunk, encoding, callback);
    } else {
      callback();
    }
  }

  _final(callback: (error?: Error | null) => void): void {
    if (this._finalImpl) {
      this._finalImpl.call(this, callback);
    } else {
      callback();
    }
  }

  private _maybeFlush(): void {
    // Flush writes that were buffered while waiting for _construct
    const pending = this._pendingConstruct.splice(0);
    if (pending.length > 0) {
      // First write goes directly, rest get serialized via _writeBuffer
      const [first, ...rest] = pending;
      this._writeBuffer.push(...rest);
      this._doWrite(first.chunk, first.encoding, first.callback);
    }
    if (this._pendingEnd) {
      const { chunk, encoding, callback } = this._pendingEnd;
      this._pendingEnd = null;
      this._doEnd(chunk, encoding, callback);
    }
  }

  private _doWrite(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    this._writableState.writing = true;
    this._write(chunk, encoding, (err) => {
      this._writableState.writing = false;
      this.writableLength -= this.writableObjectMode ? 1 : (chunk?.length ?? 1);
      if (err) {
        nextTick(() => {
          callback(err);
          this.emit('error', err);
          this._drainWriteBuffer();
        });
      } else {
        nextTick(() => {
          callback();
          if (this.writableNeedDrain && this.writableLength < this.writableHighWaterMark) {
            this.writableNeedDrain = false;
            this.emit('drain');
          }
          this._drainWriteBuffer();
        });
      }
    });
  }

  private _drainWriteBuffer(): void {
    if (this._writeBuffer.length > 0) {
      const next = this._writeBuffer.shift()!;
      this._doWrite(next.chunk, next.encoding, next.callback);
    } else {
      this._maybeFinish();
    }
  }

  private _maybeFinish(): void {
    if (!this._ending || this._writableState.finished || this._writableState.writing || this._writeBuffer.length > 0) return;
    this._ending = false;

    this._final((err) => {
      this.writableFinished = true;
      this._writableState.finished = true;
      nextTick(() => {
        if (err) {
          this.emit('error', err);
        }
        this.emit('finish');
        nextTick(() => this.emit('close'));
        if (this._endCallback) this._endCallback();
      });
    });
  }

  write(chunk: any, encoding?: string | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }
    if (encoding === undefined) encoding = this._defaultEncoding;
    callback = callback || (() => {});

    // Convert strings to Buffer when decodeStrings is true (default), but not in objectMode
    if (this._decodeStrings && !this.writableObjectMode && typeof chunk === 'string') {
      const BufCtor = (globalThis as any).Buffer;
      if (BufCtor) {
        chunk = BufCtor.from(chunk, encoding);
        encoding = 'buffer';
      }
    }
    // Set encoding to 'buffer' for Buffer/Uint8Array chunks
    if (typeof chunk !== 'string' && !this.writableObjectMode) {
      const BufCtor = (globalThis as any).Buffer;
      if ((BufCtor && BufCtor.isBuffer(chunk)) || chunk instanceof Uint8Array) {
        encoding = 'buffer';
      }
    }

    if (this.writableEnded) {
      const err = new Error('write after end');
      nextTick(() => {
        if (callback) callback(err);
        this.emit('error', err);
      });
      return false;
    }

    this.writableLength += this.writableObjectMode ? 1 : (chunk?.length ?? 1);

    // If corked, buffer the write
    if (this.writableCorked > 0) {
      this._corkedBuffer.push({ chunk, encoding: encoding as string, callback });
      return this.writableLength < this.writableHighWaterMark;
    }

    // If not yet constructed, buffer writes until construction finishes
    if (!this._writableState.constructed) {
      this._pendingConstruct.push({ chunk, encoding: encoding as string, callback });
      return this.writableLength < this.writableHighWaterMark;
    }

    // Compute backpressure BEFORE _doWrite (sync transforms may decrement length immediately)
    const belowHWM = this.writableLength < this.writableHighWaterMark;
    if (!belowHWM) {
      this.writableNeedDrain = true;
    }

    // Serialize writes: only one _write at a time, buffer the rest
    if (this._writableState.writing) {
      this._writeBuffer.push({ chunk, encoding: encoding as string, callback });
    } else {
      this._doWrite(chunk, encoding as string, callback);
    }

    return belowHWM;
  }

  private _doEnd(chunk?: any, encoding?: string, callback?: () => void): void {
    if (chunk !== undefined && chunk !== null) {
      this.write(chunk, encoding as string);
    }

    this.writableEnded = true;
    this._writableState.ended = true;
    this._ending = true;
    this._endCallback = callback;

    // _maybeFinish will call _final once all pending writes have drained
    this._maybeFinish();
  }

  end(chunk?: any, encoding?: string | (() => void), callback?: () => void): this {
    if (typeof chunk === 'function') {
      callback = chunk;
      chunk = undefined;
    }
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }

    // Ignore duplicate end() calls (e.g. from auto-end after half-close)
    if (this.writableEnded) {
      if (callback) nextTick(callback);
      return this;
    }

    // If not yet constructed, defer end until construction finishes
    if (!this._writableState.constructed) {
      this._pendingEnd = { chunk, encoding: encoding as string, callback };
      return this;
    }

    this._doEnd(chunk, encoding as string, callback);

    return this;
  }

  cork(): void {
    this.writableCorked++;
  }

  uncork(): void {
    if (this.writableCorked > 0) {
      this.writableCorked--;
      if (this.writableCorked === 0 && this._corkedBuffer.length > 0) {
        this._flushCorkedBuffer();
      }
    }
  }

  private _flushCorkedBuffer(): void {
    // If _writev is available, flush as a batch
    if (this._writev && this._corkedBuffer.length > 1) {
      const buffered = this._corkedBuffer.splice(0);
      const chunks = buffered.map(b => ({ chunk: b.chunk, encoding: b.encoding }));
      this._writev.call(this, chunks, (err) => {
        for (const b of buffered) {
          this.writableLength -= this.writableObjectMode ? 1 : (b.chunk?.length ?? 1);
        }
        if (err) {
          for (const b of buffered) b.callback(err);
          this.emit('error', err);
        } else {
          for (const b of buffered) b.callback();
          if (this.writableNeedDrain && this.writableLength < this.writableHighWaterMark) {
            this.writableNeedDrain = false;
            this.emit('drain');
          }
        }
      });
    } else {
      // Flush one by one via serialized write path
      const buffered = this._corkedBuffer.splice(0);
      if (buffered.length > 0) {
        const [first, ...rest] = buffered;
        this._writeBuffer.push(...rest);
        this._doWrite(first.chunk, first.encoding, first.callback);
      }
    }
  }

  setDefaultEncoding(encoding: string): this {
    this._defaultEncoding = encoding;
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.writable = false;

    const cb = (err?: Error | null) => {
      if (err) nextTick(() => this.emit('error', err));
      nextTick(() => this.emit('close'));
    };

    if (this._destroyImpl) {
      this._destroyImpl.call(this, error ?? null, cb);
    } else {
      cb(error);
    }

    return this;
  }
}

// ---- Duplex ----

class Duplex_ extends Readable_ {
  writable = true;
  writableHighWaterMark: number;
  writableLength = 0;
  writableObjectMode: boolean;
  writableEnded = false;
  writableFinished = false;
  writableCorked = 0;
  writableNeedDrain = false;
  allowHalfOpen: boolean;
  private _decodeStrings: boolean;

  private _duplexCorkedBuffer: Array<{ chunk: any; encoding: string; callback: (error?: Error | null) => void }> = [];
  private _writeImpl: ((chunk: any, encoding: string, cb: (error?: Error | null) => void) => void) | undefined;
  private _finalImpl: ((cb: (error?: Error | null) => void) => void) | undefined;
  private _defaultEncoding = 'utf8';
  private _pendingWrites = 0;
  private _pendingEndCb: (() => void) | null = null;

  constructor(opts?: DuplexOptions) {
    super(opts);
    this.writableHighWaterMark = opts?.writableHighWaterMark ?? opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.writableObjectMode ?? opts?.objectMode ?? false);
    this.writableObjectMode = opts?.writableObjectMode ?? opts?.objectMode ?? false;
    this.allowHalfOpen = opts?.allowHalfOpen !== false;
    this._decodeStrings = opts?.decodeStrings !== false;
    if (opts?.write) this._writeImpl = opts.write;
    // writev not yet supported on Duplex
    if (opts?.final) this._finalImpl = opts.final;

    // When allowHalfOpen=false, end writable when readable ends
    if (!this.allowHalfOpen) {
      this.once('end', () => {
        if (!this.writableEnded) {
          nextTick(() => this.end());
        }
      });
    }
  }

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    if (this._writeImpl) {
      this._writeImpl.call(this, chunk, encoding, callback);
    } else {
      callback();
    }
  }

  _final(callback: (error?: Error | null) => void): void {
    if (this._finalImpl) {
      this._finalImpl.call(this, callback);
    } else {
      callback();
    }
  }

  override destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.writable = false;
    return super.destroy(error);
  }

  write(chunk: any, encoding?: string | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }
    if (encoding === undefined) encoding = this._defaultEncoding;

    // Convert strings to Buffer when decodeStrings is true (default), but not in objectMode
    if (this._decodeStrings && !this.writableObjectMode && typeof chunk === 'string') {
      const BufCtor = (globalThis as any).Buffer;
      if (BufCtor) {
        chunk = BufCtor.from(chunk, encoding);
        encoding = 'buffer';
      }
    }
    // Set encoding to 'buffer' for Buffer/Uint8Array chunks
    if (typeof chunk !== 'string' && !this.writableObjectMode) {
      const BufCtor = (globalThis as any).Buffer;
      if ((BufCtor && BufCtor.isBuffer(chunk)) || chunk instanceof Uint8Array) {
        encoding = 'buffer';
      }
    }

    if (this.writableEnded) {
      const err = new Error('write after end');
      const cb = callback || (() => {});
      nextTick(() => {
        cb(err);
        this.emit('error', err);
      });
      return false;
    }

    this.writableLength += this.writableObjectMode ? 1 : (chunk?.length ?? 1);

    // If corked, buffer the write
    if (this.writableCorked > 0) {
      this._duplexCorkedBuffer.push({ chunk, encoding: encoding as string, callback: callback || (() => {}) });
      return this.writableLength < this.writableHighWaterMark;
    }

    // Compute backpressure BEFORE _write (sync transforms may decrement length immediately)
    const belowHWM = this.writableLength < this.writableHighWaterMark;
    if (!belowHWM) {
      this.writableNeedDrain = true;
    }

    const cb = callback || (() => {});
    this._pendingWrites++;
    this._write(chunk, encoding as string, (err) => {
      this._pendingWrites--;
      this.writableLength -= this.writableObjectMode ? 1 : (chunk?.length ?? 1);
      if (err) {
        nextTick(() => {
          cb(err);
          this.emit('error', err);
        });
      } else {
        nextTick(() => {
          cb();
          if (this.writableNeedDrain && this.writableLength < this.writableHighWaterMark) {
            this.writableNeedDrain = false;
            this.emit('drain');
          }
          // If end() is waiting for pending writes to complete, trigger it now
          if (this._pendingWrites === 0 && this._pendingEndCb) {
            const endCb = this._pendingEndCb;
            this._pendingEndCb = null;
            endCb();
          }
        });
      }
    });

    return belowHWM;
  }

  end(chunk?: any, encoding?: string | (() => void), callback?: () => void): this {
    if (typeof chunk === 'function') {
      callback = chunk;
      chunk = undefined;
    }
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = undefined;
    }

    if (chunk !== undefined && chunk !== null) {
      this.write(chunk, encoding as string);
    }

    this.writableEnded = true;

    const doFinal = () => {
      this._final((err) => {
        this.writableFinished = true;
        nextTick(() => {
          if (err) this.emit('error', err);
          this.emit('finish');
          nextTick(() => this.emit('close'));
          if (callback) callback();
        });
      });
    };

    // Wait for all pending writes to complete before calling _final
    if (this._pendingWrites > 0) {
      this._pendingEndCb = doFinal;
    } else {
      doFinal();
    }

    return this;
  }

  cork(): void { this.writableCorked++; }

  uncork(): void {
    if (this.writableCorked > 0) {
      this.writableCorked--;
      if (this.writableCorked === 0 && this._duplexCorkedBuffer.length > 0) {
        const buffered = this._duplexCorkedBuffer.splice(0);
        for (const { chunk, encoding, callback } of buffered) {
          this._write(chunk, encoding, (err) => {
            this.writableLength -= this.writableObjectMode ? 1 : (chunk?.length ?? 1);
            if (err) {
              callback(err);
              this.emit('error', err);
            } else {
              callback();
            }
          });
        }
        if (this.writableNeedDrain && this.writableLength < this.writableHighWaterMark) {
          this.writableNeedDrain = false;
          nextTick(() => this.emit('drain'));
        }
      }
    }
  }

  setDefaultEncoding(encoding: string): this {
    this._defaultEncoding = encoding;
    return this;
  }
}

// ---- Transform ----

class Transform_ extends Duplex_ {
  private _transformImpl: ((chunk: any, encoding: string, cb: (error?: Error | null, data?: any) => void) => void) | undefined;
  private _flushImpl: ((cb: (error?: Error | null, data?: any) => void) => void) | undefined;

  constructor(opts?: TransformOptions) {
    super({
      ...opts,
      write: undefined, // Override write to use transform
    });
    if (opts?.transform) this._transformImpl = opts.transform;
    if (opts?.flush) this._flushImpl = opts.flush;
  }

  _transform(chunk: any, encoding: string, callback: (error?: Error | null, data?: any) => void): void {
    if (this._transformImpl) {
      this._transformImpl.call(this, chunk, encoding, callback);
    } else {
      callback(null, chunk);
    }
  }

  _flush(callback: (error?: Error | null, data?: any) => void): void {
    if (this._flushImpl) {
      this._flushImpl.call(this, callback);
    } else {
      callback();
    }
  }

  _write(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    this._transform(chunk, encoding, (err, data) => {
      if (err) {
        callback(err);
        return;
      }
      if (data !== undefined && data !== null) {
        this.push(data);
      }
      callback();
    });
  }

  _final(callback: (error?: Error | null) => void): void {
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
}

// ---- PassThrough ----

class PassThrough_ extends Transform_ {
  constructor(opts?: TransformOptions) {
    super({
      ...opts,
      transform(chunk: any, _encoding: string, callback: (error?: Error | null, data?: any) => void) {
        callback(null, chunk);
      }
    });
  }
}

// ---- pipeline ----

type PipelineCallback = (err: Error | null) => void;

/** A stream that can be destroyed (duck-typed for pipeline). */
interface DestroyableStream extends Stream {
  destroy?(error?: Error): void;
}

export function pipeline(...args: [...streams: DestroyableStream[], callback: PipelineCallback] | DestroyableStream[]): DestroyableStream {
  const callback = typeof args[args.length - 1] === 'function' ? args.pop() as PipelineCallback : undefined;
  const streams = args as DestroyableStream[];

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
  let current: Stream = streams[0];
  for (let i = 1; i < streams.length; i++) {
    const next = streams[i];
    current.pipe(next as unknown as Writable);
    current.on('error', onError);
    current = next;
  }

  // Listen for end on last stream
  const last = streams[streams.length - 1];
  last.on('error', onError);
  last.on('finish', () => {
    if (callback && !error) callback(null);
  });

  return last;
}

// ---- finished ----

export function finished(stream: Stream | Readable | Writable, callback: (err?: Error | null) => void): () => void;
export function finished(stream: Stream | Readable | Writable, opts: FinishedOptions, callback: (err?: Error | null) => void): () => void;
export function finished(stream: Stream | Readable | Writable, optsOrCb: FinishedOptions | ((err?: Error | null) => void), callback?: (err?: Error | null) => void): () => void {
  let cb: (err?: Error | null) => void;
  let _opts: FinishedOptions = {};

  if (typeof optsOrCb === 'function') {
    cb = optsOrCb;
  } else {
    _opts = optsOrCb || {};
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
    if (!(stream as Writable).writableFinished && !(stream as Readable).readableEnded) {
      done(new Error('premature close'));
    }
  };

  stream.on('finish', onFinish);
  stream.on('end', onEnd);
  stream.on('error', onError);
  stream.on('close', onClose);

  // Check initial state — handle already-finished/destroyed streams
  // Reference: refs/node/lib/internal/streams/end-of-stream.js lines 228-249
  const isWritableStream = typeof (stream as Writable).write === 'function';
  const isReadableStream = typeof (stream as Readable).read === 'function';
  const writableFinished = (stream as unknown as Record<string, unknown>).writableFinished === true;
  const readableEnded = (stream as unknown as Record<string, unknown>).readableEnded === true;
  const destroyed = (stream as unknown as Record<string, unknown>).destroyed === true;

  if (destroyed) {
    queueMicrotask(() => done(((stream as unknown as Record<string, unknown>)._err as Error | null) || null));
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

// ---- addAbortSignal ----

export function addAbortSignal(signal: AbortSignal, stream: Stream): typeof stream {
  if (!(signal instanceof AbortSignal)) {
    throw new TypeError('The first argument must be an AbortSignal');
  }
  if (!(stream instanceof Stream)) {
    throw new TypeError('The second argument must be a Stream');
  }

  if (signal.aborted) {
    (stream as Readable | Writable).destroy(new Error('The operation was aborted'));
  } else {
    const onAbort = () => {
      (stream as Readable | Writable).destroy(new Error('The operation was aborted'));
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
  return (s.readable as boolean) === true;
}

export function isWritable(stream: unknown): boolean {
  if (stream == null) return false;
  const s = stream as Record<string, unknown>;
  if (typeof s.writable !== 'boolean') return false;
  if (typeof s.write !== 'function') return false;
  if (s.destroyed === true) return false;
  if (s.writableEnded === true) return false;
  return (s.writable as boolean) === true;
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

// ---- Exports ----
//
// The class declarations above use underscore-suffixed internal names
// (`Stream_`, `Readable_`, etc.) — we wrap each one with `makeCallable` so
// legacy CJS consumers can do `Stream.call(this)` (npm `send`,
// `util.inherits(Sub, Stream)`, our own `@gjsify/crypto` `Hash.copy()`).
// See `./callable.ts` for the rationale and implementation.
//
// Public API preserves the historical names. Both value and type positions
// work because of the `type X = X_` aliases below.

import { makeCallable } from './callable.js';

export const Stream = makeCallable(Stream_) as typeof Stream_;
export const Readable = makeCallable(Readable_) as typeof Readable_;
export const Writable = makeCallable(Writable_) as typeof Writable_;
export const Duplex = makeCallable(Duplex_) as typeof Duplex_;
export const Transform = makeCallable(Transform_) as typeof Transform_;
export const PassThrough = makeCallable(PassThrough_) as typeof PassThrough_;

export type Stream = Stream_;
export type Readable = Readable_;
export type Writable = Writable_;
export type Duplex = Duplex_;
export type Transform = Transform_;
export type PassThrough = PassThrough_;

// Default export
const _default = Object.assign(Stream, {
  Stream,
  Readable,
  Writable,
  Duplex,
  Transform,
  PassThrough,
  pipeline,
  finished,
  addAbortSignal,
  isReadable,
  isWritable,
  isDestroyed,
  isDisturbed,
  isErrored,
  getDefaultHighWaterMark,
  setDefaultHighWaterMark,
});

export default _default;
