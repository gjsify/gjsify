// Reference: Node.js lib/stream.js, lib/internal/streams/*.js
// Reimplemented for GJS using EventEmitter and microtask scheduling

import { EventEmitter } from '@gjsify/events';
import type { ReadableOptions, WritableOptions, DuplexOptions, TransformOptions, FinishedOptions } from 'node:stream';

// ---- Async scheduling ----
// Node.js uses process.nextTick for stream event emission.
// In GJS, we use queueMicrotask which fires as a microtask but does NOT create
// a Promise, avoiding "Unhandled promise rejection" warnings when callbacks throw.
// queueMicrotask is available in SpiderMonkey 69+ (GJS uses SpiderMonkey 128).
const nextTick: (fn: (...args: unknown[]) => void, ...args: unknown[]) => void =
  typeof globalThis.process?.nextTick === 'function'
    ? globalThis.process.nextTick
    : typeof globalThis.queueMicrotask === 'function'
      ? (fn: (...args: unknown[]) => void, ...args: unknown[]) => queueMicrotask(() => fn(...args))
      : (fn: (...args: unknown[]) => void, ...args: unknown[]) => Promise.resolve().then(() => fn(...args));

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

export class Stream extends EventEmitter {
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

export class Readable extends Stream {
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
    if (size === undefined || size >= this._buffer.length) {
      if (this.readableObjectMode) {
        return this._buffer.shift();
      }
      const result = this._buffer.splice(0);
      this.readableLength = 0;
      if (this._readableState.ended && this._buffer.length === 0) {
        this._readableState.endEmitted = true;
        this.emit('end');
      }
      return result.length === 1 ? result[0] : Buffer.concat ? (globalThis as unknown as Record<string, { concat: (list: unknown[]) => unknown }>).Buffer?.concat(result) : result;
    }

    return this._buffer.shift();
  }

  push(chunk: any, encoding?: string): boolean {
    if (chunk === null) {
      this._readableState.ended = true;
      this.readableEnded = true;
      if (this._buffer.length === 0 && !this._readableState.endEmitted) {
        this._readableState.endEmitted = true;
        nextTick(() => this.emit('end'));
      }
      return false;
    }

    this._buffer.push(chunk);
    this.readableLength += this.readableObjectMode ? 1 : (chunk.length ?? 1);

    // In flowing mode, schedule draining (unless already flowing)
    if (this.readableFlowing && !this._flowing) {
      nextTick(() => this._flow());
    }

    return this.readableLength < this.readableHighWaterMark;
  }

  on(event: string | symbol, listener: (...args: any[]) => void): this {
    super.on(event, listener);
    // Attaching a 'data' listener switches to flowing mode (like Node.js)
    if (event === 'data' && this.readableFlowing !== false) {
      this.resume();
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
    if (this.readableFlowing !== true || this._flowing) return;
    if (!this._readableState.constructed) return;
    this._flowing = true;

    try {
      // Drain buffered data synchronously (like Node.js flow())
      while (this._buffer.length > 0 && this.readableFlowing) {
        const chunk = this._buffer.shift()!;
        this.readableLength -= this.readableObjectMode ? 1 : ((chunk as any).length ?? 1);
        this.emit('data', chunk);
      }

      // If ended and buffer drained, emit end
      if (this._readableState.ended && this._buffer.length === 0 && !this._readableState.endEmitted) {
        this._readableState.endEmitted = true;
        nextTick(() => this.emit('end'));
        return;
      }

      // Call _read to get more data (may push synchronously)
      if (!this._readableState.ended && !this._readableState.reading) {
        this._readableState.reading = true;
        this._read(this.readableHighWaterMark);
        this._readableState.reading = false;
      }
    } finally {
      this._flowing = false;
    }

    // After _read, if new data was pushed, schedule another flow
    if (this._buffer.length > 0 && this.readableFlowing) {
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
      nextTick(() => {
        if (err) this.emit('error', err);
        this.emit('close');
      });
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
    let waiting: ((value: IteratorResult<unknown>) => void) | null = null;

    readable.on('data', (chunk: unknown) => {
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: chunk, done: false });
      } else {
        buffer.push(chunk);
      }
    });

    readable.on('end', () => {
      done = true;
      if (waiting) {
        const resolve = waiting;
        waiting = null;
        resolve({ value: undefined, done: true });
      }
    });

    readable.on('error', (err: Error) => {
      error = err;
      if (waiting) {
        const reject = waiting;
        waiting = null;
        reject({ value: undefined, done: true });
      }
    });

    return {
      next(): Promise<IteratorResult<unknown>> {
        if (error) return Promise.reject(error);
        if (buffer.length > 0) return Promise.resolve({ value: buffer.shift(), done: false });
        if (done) return Promise.resolve({ value: undefined, done: true });
        return new Promise(resolve => { waiting = resolve; });
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
      ...opts,
      read() {}
    });

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

export class Writable extends Stream {
  writable = true;
  writableHighWaterMark: number;
  writableLength = 0;
  writableObjectMode: boolean;
  writableEnded = false;
  writableFinished = false;
  writableCorked = 0;
  writableNeedDrain = false;
  destroyed = false;

  private _writableState = { ended: false, finished: false, constructed: true };
  private _corkedBuffer: Array<{ chunk: any; encoding: string; callback: (error?: Error | null) => void }> = [];
  private _pendingConstruct: Array<{ chunk: any; encoding: string; callback: (error?: Error | null) => void }> = [];
  private _pendingEnd: { chunk?: any; encoding?: string; callback?: () => void } | null = null;
  private _writeImpl: ((chunk: any, encoding: string, cb: (error?: Error | null) => void) => void) | undefined;
  private _writev: ((chunks: Array<{ chunk: any; encoding: string }>, cb: (error?: Error | null) => void) => void) | undefined;
  private _finalImpl: ((cb: (error?: Error | null) => void) => void) | undefined;
  private _destroyImpl: ((error: Error | null, cb: (error?: Error | null) => void) => void) | undefined;
  private _constructImpl: ((cb: (error?: Error | null) => void) => void) | undefined;

  constructor(opts?: WritableOptions) {
    super(opts);
    this.writableHighWaterMark = opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.objectMode ?? false);
    this.writableObjectMode = opts?.objectMode ?? false;
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
    for (const { chunk, encoding, callback } of pending) {
      this._doWrite(chunk, encoding, callback);
    }
    if (this._pendingEnd) {
      const { chunk, encoding, callback } = this._pendingEnd;
      this._pendingEnd = null;
      this._doEnd(chunk, encoding, callback);
    }
  }

  private _doWrite(chunk: any, encoding: string, callback: (error?: Error | null) => void): void {
    this._write(chunk, encoding, (err) => {
      this.writableLength -= this.writableObjectMode ? 1 : (chunk?.length ?? 1);
      if (err) {
        nextTick(() => {
          callback(err);
          this.emit('error', err);
        });
      } else {
        nextTick(() => {
          callback();
          if (this.writableNeedDrain && this.writableLength < this.writableHighWaterMark) {
            this.writableNeedDrain = false;
            this.emit('drain');
          }
        });
      }
    });
  }

  write(chunk: any, encoding?: string | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = 'utf8';
    }
    encoding = encoding || 'utf8';
    callback = callback || (() => {});

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

    this._doWrite(chunk, encoding as string, callback);

    const belowHWM = this.writableLength < this.writableHighWaterMark;
    if (!belowHWM) {
      this.writableNeedDrain = true;
    }
    return belowHWM;
  }

  private _doEnd(chunk?: any, encoding?: string, callback?: () => void): void {
    if (chunk !== undefined && chunk !== null) {
      this.write(chunk, encoding as string);
    }

    this.writableEnded = true;
    this._writableState.ended = true;

    this._final((err) => {
      this.writableFinished = true;
      this._writableState.finished = true;
      nextTick(() => {
        if (err) {
          this.emit('error', err);
        }
        this.emit('finish');
        if (callback) callback();
      });
    });
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
      // Flush one by one
      const buffered = this._corkedBuffer.splice(0);
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

  setDefaultEncoding(encoding: string): this {
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.writable = false;

    const cb = (err?: Error | null) => {
      nextTick(() => {
        if (err) this.emit('error', err);
        this.emit('close');
      });
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

export class Duplex extends Readable {
  writable = true;
  writableHighWaterMark: number;
  writableLength = 0;
  writableObjectMode: boolean;
  writableEnded = false;
  writableFinished = false;
  writableCorked = 0;
  writableNeedDrain = false;

  private _duplexCorkedBuffer: Array<{ chunk: any; encoding: string; callback: (error?: Error | null) => void }> = [];
  private _writeImpl: ((chunk: any, encoding: string, cb: (error?: Error | null) => void) => void) | undefined;
  private _finalImpl: ((cb: (error?: Error | null) => void) => void) | undefined;

  constructor(opts?: DuplexOptions) {
    super(opts);
    this.writableHighWaterMark = opts?.writableHighWaterMark ?? opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.writableObjectMode ?? opts?.objectMode ?? false);
    this.writableObjectMode = opts?.writableObjectMode ?? opts?.objectMode ?? false;
    if (opts?.write) this._writeImpl = opts.write;
    // writev not yet supported on Duplex
    if (opts?.final) this._finalImpl = opts.final;
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

  write(chunk: any, encoding?: string | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean {
    if (typeof encoding === 'function') {
      callback = encoding;
      encoding = 'utf8';
    }
    encoding = encoding || 'utf8';

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

    const cb = callback || (() => {});
    this._write(chunk, encoding as string, (err) => {
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
        });
      }
    });

    const belowHWM = this.writableLength < this.writableHighWaterMark;
    if (!belowHWM) {
      this.writableNeedDrain = true;
    }
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
    this._final((err) => {
      this.writableFinished = true;
      nextTick(() => {
        if (err) this.emit('error', err);
        this.emit('finish');
        if (callback) callback();
      });
    });

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

  setDefaultEncoding(_encoding: string): this { return this; }
}

// ---- Transform ----

export class Transform extends Duplex {
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

export class PassThrough extends Transform {
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
  const writableFinished = (stream as any).writableFinished === true;
  const readableEnded = (stream as any).readableEnded === true;
  const destroyed = (stream as any).destroyed === true;

  if (destroyed) {
    queueMicrotask(() => done((stream as any)._err || null));
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
