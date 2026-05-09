// Writable stream — push-based sink with serialized writes and FIFO drain queue.
//
// Reference: refs/node/lib/internal/streams/writable.js
// Reimplemented for GJS using @gjsify/events + microtask scheduling.

import { nextTick } from '@gjsify/utils';
import type { WritableOptions } from 'node:stream';

import { Stream_ } from './stream-base.js';
import { getDefaultHighWaterMark } from './internal/state.js';
import type { BufferedWrite, ErrCallback } from './internal/types.js';

interface WritableInternalState {
  ended: boolean;
  finished: boolean;
  constructed: boolean;
  writing: boolean;
}

/** Object form for `_writev` invocations. */
interface WriteVChunk { chunk: unknown; encoding: string; }

export class Writable_ extends Stream_ {
  // Allow `duplex instanceof Writable` to return true even though Duplex inherits
  // from Readable_ only. Mirrors Node.js: standard prototype-chain check first,
  // then duck-type fallback — but only when checking against Writable itself, not
  // against a user subclass. Because `Writable` is exported as a makeCallable Proxy,
  // `this === Writable_` fails for `obj instanceof Writable`; however the Proxy's
  // default `get` trap forwards `.prototype` straight to the target, so the
  // prototype reference check below correctly recognises both.
  static [Symbol.hasInstance](obj: unknown): boolean {
    const ctor = this as unknown as { prototype?: object };
    if (typeof ctor.prototype !== 'undefined' &&
        Object.prototype.isPrototypeOf.call(ctor.prototype, obj as object)) return true;
    if (ctor.prototype !== Writable_.prototype) return false;
    if (obj === null || obj === undefined) return false;
    return typeof (obj as { writableHighWaterMark?: unknown }).writableHighWaterMark === 'number';
  }

  writable = true;
  writableHighWaterMark: number;
  writableLength = 0;
  writableObjectMode: boolean;
  writableEnded = false;
  writableFinished = false;
  writableCorked = 0;
  writableNeedDrain = false;
  destroyed = false;

  /** @internal Stored error from `destroy(err)` so `finished()` can retrieve it. */
  _err?: Error;

  private _writableState: WritableInternalState = { ended: false, finished: false, constructed: true, writing: false };
  private _corkedBuffer: BufferedWrite[] = [];
  private _writeBuffer: BufferedWrite[] = [];
  private _pendingConstruct: BufferedWrite[] = [];
  private _ending = false;
  private _endCallback?: () => void;
  private _pendingEnd: { chunk?: unknown; encoding?: string; callback?: () => void } | null = null;
  private _writeImpl: ((this: Writable_, chunk: unknown, encoding: string, cb: ErrCallback) => void) | undefined;
  private _writev: ((this: Writable_, chunks: WriteVChunk[], cb: ErrCallback) => void) | undefined;
  private _finalImpl: ((this: Writable_, cb: ErrCallback) => void) | undefined;
  private _destroyImpl: ((this: Writable_, error: Error | null, cb: ErrCallback) => void) | undefined;
  private _constructImpl: ((this: Writable_, cb: ErrCallback) => void) | undefined;
  private _decodeStrings: boolean;
  private _defaultEncoding = 'utf8';

  constructor(opts?: WritableOptions) {
    super(opts);
    this.writableHighWaterMark = opts?.highWaterMark ?? getDefaultHighWaterMark(opts?.objectMode ?? false);
    this.writableObjectMode = opts?.objectMode ?? false;
    this._decodeStrings = opts?.decodeStrings !== false;
    if (opts?.write) this._writeImpl = opts.write as unknown as (this: Writable_, c: unknown, e: string, cb: ErrCallback) => void;
    if (opts?.writev) this._writev = opts.writev as unknown as (this: Writable_, c: WriteVChunk[], cb: ErrCallback) => void;
    if (opts?.final) this._finalImpl = opts.final as unknown as (this: Writable_, cb: ErrCallback) => void;
    if (opts?.destroy) this._destroyImpl = opts.destroy as unknown as (this: Writable_, e: Error | null, cb: ErrCallback) => void;
    if (opts?.construct) this._constructImpl = opts.construct as unknown as (this: Writable_, cb: ErrCallback) => void;

    // Call _construct if provided via options or overridden by subclass
    const hasConstruct = this._constructImpl || this._construct !== Writable_.prototype._construct;
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

  _construct(callback: ErrCallback): void {
    if (this._constructImpl) {
      this._constructImpl.call(this, callback);
    } else {
      callback();
    }
  }

  _write(chunk: unknown, encoding: string, callback: ErrCallback): void {
    if (this._writeImpl) {
      this._writeImpl.call(this, chunk, encoding, callback);
    } else {
      callback();
    }
  }

  _final(callback: ErrCallback): void {
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

  private _doWrite(chunk: unknown, encoding: string, callback: ErrCallback): void {
    this._writableState.writing = true;
    // Track whether the user's _write called its callback synchronously. When it
    // does (e.g. Writable with a synchronous `write` option), Node drains the
    // buffer on the same tick — tests that issue N sync writes expect N sync
    // `_write` dispatches. Deferring via nextTick here broke that expectation.
    let sync = true;
    this._write(chunk, encoding, (err) => {
      this.writableLength -= this.writableObjectMode ? 1 : chunkLen(chunk);
      if (sync) {
        // Synchronous completion: defer the user callback + 'drain' emit to
        // nextTick (Node semantics — user code must not see its own write
        // return before the callback on the same tick), but drain the buffer
        // synchronously so follow-up writes fire on the same tick.
        nextTick(() => {
          if (err) {
            callback(err);
            this.emit('error', err);
            return;
          }
          callback();
          if (this.writableNeedDrain && this.writableLength <= this.writableHighWaterMark) {
            this.writableNeedDrain = false;
            this.emit('drain');
          }
        });
        if (!err) this._drainWriteBuffer();
        return;
      }
      // Asynchronous completion — full defer.
      if (err) {
        nextTick(() => {
          callback(err);
          this.emit('error', err);
          this._drainWriteBuffer();
        });
      } else {
        nextTick(() => {
          callback();
          if (this.writableNeedDrain && this.writableLength <= this.writableHighWaterMark) {
            this.writableNeedDrain = false;
            this.emit('drain');
          }
          this._drainWriteBuffer();
        });
      }
    });
    sync = false;
  }

  private _drainWriteBuffer(): void {
    if (this._writeBuffer.length > 0) {
      const next = this._writeBuffer.shift()!;
      this._doWrite(next.chunk, next.encoding, next.callback);
    } else {
      // Only release the write lock when the buffer is truly empty.
      this._writableState.writing = false;
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

  write(chunk: unknown, encoding?: string | ErrCallback, callback?: ErrCallback): boolean {
    let cb: ErrCallback;
    let enc: string;
    if (typeof encoding === 'function') {
      cb = encoding;
      enc = this._defaultEncoding;
    } else {
      enc = encoding ?? this._defaultEncoding;
      cb = callback ?? (() => {});
    }

    // Convert strings to Buffer when decodeStrings is true (default), but not in objectMode
    if (this._decodeStrings && !this.writableObjectMode && typeof chunk === 'string') {
      const BufCtor = (globalThis as { Buffer?: { from: (s: string, e: string) => unknown } }).Buffer;
      if (BufCtor) {
        chunk = BufCtor.from(chunk, enc);
        enc = 'buffer';
      }
    }
    // Set encoding to 'buffer' for Buffer/Uint8Array chunks
    if (typeof chunk !== 'string' && !this.writableObjectMode) {
      const BufCtor = (globalThis as { Buffer?: { isBuffer: (v: unknown) => boolean } }).Buffer;
      if ((BufCtor && BufCtor.isBuffer(chunk)) || chunk instanceof Uint8Array) {
        enc = 'buffer';
      }
    }

    if (this.writableEnded) {
      const err = new Error('write after end');
      nextTick(() => {
        cb(err);
        this.emit('error', err);
      });
      return false;
    }

    this.writableLength += this.writableObjectMode ? 1 : chunkLen(chunk);

    // If corked, buffer the write
    if (this.writableCorked > 0) {
      this._corkedBuffer.push({ chunk, encoding: enc, callback: cb });
      return this.writableLength < this.writableHighWaterMark;
    }

    // If not yet constructed, buffer writes until construction finishes
    if (!this._writableState.constructed) {
      this._pendingConstruct.push({ chunk, encoding: enc, callback: cb });
      return this.writableLength < this.writableHighWaterMark;
    }

    // Compute backpressure BEFORE _doWrite (sync transforms may decrement length immediately)
    const belowHWM = this.writableLength < this.writableHighWaterMark;
    if (!belowHWM) {
      this.writableNeedDrain = true;
    }

    // Serialize writes: only one _write at a time, buffer the rest
    if (this._writableState.writing) {
      this._writeBuffer.push({ chunk, encoding: enc, callback: cb });
    } else {
      this._doWrite(chunk, enc, cb);
    }

    return belowHWM;
  }

  private _doEnd(chunk?: unknown, encoding?: string, callback?: () => void): void {
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

  end(chunk?: unknown | (() => void), encoding?: string | (() => void), callback?: () => void): this {
    if (typeof chunk === 'function') {
      callback = chunk as () => void;
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
      const chunks: WriteVChunk[] = buffered.map(b => ({ chunk: b.chunk, encoding: b.encoding }));
      this._writev.call(this, chunks, (err) => {
        for (const b of buffered) {
          this.writableLength -= this.writableObjectMode ? 1 : chunkLen(b.chunk);
        }
        if (err) {
          for (const b of buffered) b.callback(err);
          this.emit('error', err);
        } else {
          for (const b of buffered) b.callback();
          if (this.writableNeedDrain && this.writableLength <= this.writableHighWaterMark) {
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
    // Store the error so finished() can retrieve it if called after destroy() but before 'error' fires
    if (error) this._err = error;

    const cb: ErrCallback = (err) => {
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

/** Length of a stream chunk (string/Buffer/Uint8Array → .length, otherwise 1). */
function chunkLen(chunk: unknown): number {
  if (chunk == null) return 1;
  const v = (chunk as { length?: unknown }).length;
  return typeof v === 'number' ? v : 1;
}
