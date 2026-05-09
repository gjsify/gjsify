// Duplex stream — Readable + Writable in a single object (independent halves).
//
// Reference: refs/node/lib/internal/streams/duplex.js
// Reimplemented for GJS. Note: extends Readable_ and re-implements the writable
// half here (rather than multiply-inheriting Writable_) — matches Node's lib
// layout, where Duplex.prototype is built by mixing Writable methods into a
// Readable-prototype-chain.

import { nextTick } from '@gjsify/utils';
import type { DuplexOptions } from 'node:stream';

import { Readable_ } from './readable.js';
import { getDefaultHighWaterMark, validateHighWaterMark } from './internal/state.js';
import type { BufferedWrite, ErrCallback } from './internal/types.js';

interface DuplexWritableState {
  highWaterMark: number;
  objectMode: boolean;
}

export class Duplex_ extends Readable_ {
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

  // Exposed writable-side state (mirrors Node.js _writableState for split HWM tests)
  // NOTE: The base Readable_ class declares `_readableState` with a different shape.
  // We deliberately only expose the highWaterMark/objectMode pair here — the rest of
  // Node's _writableState fields are kept private below.
  _writableState: DuplexWritableState = { highWaterMark: 0, objectMode: false };

  private _duplexCorkedBuffer: BufferedWrite[] = [];
  // Write serialization — prevents concurrent write_bytes_async calls (GIO_ERROR_PENDING).
  // Duplex inherits from Readable, not Writable, so it needs its own queue separate from
  // Writable_._doWrite/_drainWriteBuffer.
  private _duplexWriting = false;
  private _duplexWriteQueue: BufferedWrite[] = [];
  private _writeImpl: ((this: Duplex_, chunk: unknown, encoding: string, cb: ErrCallback) => void) | undefined;
  private _finalImpl: ((this: Duplex_, cb: ErrCallback) => void) | undefined;
  private _defaultEncoding = 'utf8';
  private _pendingWrites = 0;
  private _pendingEndCb: (() => void) | null = null;

  constructor(opts?: DuplexOptions) {
    super(opts);

    validateHighWaterMark('writableHighWaterMark', opts?.writableHighWaterMark);
    validateHighWaterMark('readableHighWaterMark', opts?.readableHighWaterMark);

    // Writable side: highWaterMark (shared) takes priority over writableHighWaterMark.
    this.writableObjectMode = opts?.writableObjectMode ?? opts?.objectMode ?? false;
    this.writableHighWaterMark = opts?.highWaterMark
      ?? opts?.writableHighWaterMark
      ?? getDefaultHighWaterMark(this.writableObjectMode);
    this._writableState.highWaterMark = this.writableHighWaterMark;
    this._writableState.objectMode = this.writableObjectMode;

    // Readable side overrides: Readable_ constructor already applied opts.highWaterMark,
    // so only override with readableHighWaterMark when highWaterMark was NOT set.
    if (opts?.highWaterMark === undefined && opts?.readableHighWaterMark !== undefined) {
      this.readableHighWaterMark = opts.readableHighWaterMark;
      this._readableState.highWaterMark = opts.readableHighWaterMark;
    }
    if (opts?.readableObjectMode !== undefined) {
      this.readableObjectMode = opts.readableObjectMode;
      this._readableState.objectMode = opts.readableObjectMode;
      // Re-derive readable HWM for objectMode when neither readableHighWaterMark nor highWaterMark was set.
      if (opts?.readableHighWaterMark === undefined && opts?.highWaterMark === undefined) {
        this.readableHighWaterMark = getDefaultHighWaterMark(opts.readableObjectMode);
        this._readableState.highWaterMark = this.readableHighWaterMark;
      }
    }

    this.allowHalfOpen = opts?.allowHalfOpen !== false;
    this._decodeStrings = opts?.decodeStrings !== false;
    if (opts?.write) this._writeImpl = opts.write as unknown as (this: Duplex_, c: unknown, e: string, cb: ErrCallback) => void;
    // writev not yet supported on Duplex
    if (opts?.final) this._finalImpl = opts.final as unknown as (this: Duplex_, cb: ErrCallback) => void;

    // When allowHalfOpen=false, end writable when readable ends
    if (!this.allowHalfOpen) {
      this.once('end', () => {
        if (!this.writableEnded) {
          nextTick(() => this.end());
        }
      });
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

  override destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.writable = false;
    return super.destroy(error);
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
      this._duplexCorkedBuffer.push({ chunk, encoding: enc, callback: cb });
      return this.writableLength < this.writableHighWaterMark;
    }

    // Compute backpressure BEFORE _write (sync transforms may decrement length immediately)
    const belowHWM = this.writableLength < this.writableHighWaterMark;
    if (!belowHWM) {
      this.writableNeedDrain = true;
    }

    this._duplexDoWrite(chunk, enc, cb);

    return belowHWM;
  }

  private _duplexDoWrite(chunk: unknown, encoding: string, cb: ErrCallback): void {
    if (this._duplexWriting) {
      this._duplexWriteQueue.push({ chunk, encoding, callback: cb });
      return;
    }
    this._duplexWriting = true;
    this._duplexStartWrite(chunk, encoding, cb);
  }

  // Starts a write assuming _duplexWriting is already true. After the write
  // completes, either start the next queued write (keeping _duplexWriting=true
  // to preserve FIFO order) or clear the flag and emit 'drain'. The 'drain'
  // listener on streamx may synchronously call conn.write() — emitting drain
  // BEFORE the queue is fully processed would let that new write bypass the
  // queue, causing out-of-order bytes on the wire (and, for bittorrent-protocol,
  // desync of piece header vs. piece payload).
  private _duplexStartWrite(chunk: unknown, encoding: string, cb: ErrCallback): void {
    this._pendingWrites++;
    this._write(chunk, encoding, (err) => {
      this._pendingWrites--;
      this.writableLength -= this.writableObjectMode ? 1 : chunkLen(chunk);
      if (err) {
        nextTick(() => {
          cb(err);
          this._duplexWriting = false;
          this.emit('error', err);
          if (this._duplexWriteQueue.length > 0) {
            const next = this._duplexWriteQueue.shift()!;
            this._duplexWriting = true;
            this._duplexStartWrite(next.chunk, next.encoding, next.callback);
          }
        });
      } else {
        nextTick(() => {
          cb();
          if (this._duplexWriteQueue.length > 0) {
            const next = this._duplexWriteQueue.shift()!;
            this._duplexStartWrite(next.chunk, next.encoding, next.callback);
            return;
          }
          this._duplexWriting = false;
          if (this.writableNeedDrain && this.writableLength <= this.writableHighWaterMark) {
            this.writableNeedDrain = false;
            this.emit('drain');
          }
          if (this._pendingWrites === 0 && this._pendingEndCb) {
            const endCb = this._pendingEndCb;
            this._pendingEndCb = null;
            endCb();
          }
        });
      }
    });
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

    if (chunk !== undefined && chunk !== null) {
      this.write(chunk, encoding as string);
    }

    this.writableEnded = true;

    const doFinal = () => {
      this._final((err) => {
        this.writableFinished = true;
        // Allow subclasses (Transform) to run post-final hooks (e.g. flush)
        // before the 'finish' event fires.
        this._doPrefinishHooks(() => {
          nextTick(() => {
            if (err) this.emit('error', err);
            this.emit('finish');
            nextTick(() => this.emit('close'));
            if (callback) callback();
          });
        });
      });
    };

    // Wait for all pending writes to complete before calling _final.
    // Transform._write is synchronous (calls user cb in same tick), so _pendingWrites
    // can be 0 even while follow-up writes sit in _duplexWriteQueue. Check the queue
    // and the write-in-flight flag too, otherwise end() fires _final — which for
    // Transform pushes null — before the queued chunks reach _transform.
    if (this._pendingWrites > 0 || this._duplexWriting || this._duplexWriteQueue.length > 0) {
      this._pendingEndCb = doFinal;
    } else {
      doFinal();
    }

    return this;
  }

  /** Hook for subclasses to run logic between _final and 'finish'. Default: no-op. */
  protected _doPrefinishHooks(cb: () => void): void {
    cb();
  }

  cork(): void { this.writableCorked++; }

  uncork(): void {
    if (this.writableCorked > 0) {
      this.writableCorked--;
      if (this.writableCorked === 0 && this._duplexCorkedBuffer.length > 0) {
        const buffered = this._duplexCorkedBuffer.splice(0);
        for (const { chunk, encoding, callback } of buffered) {
          this._write(chunk, encoding, (err) => {
            this.writableLength -= this.writableObjectMode ? 1 : chunkLen(chunk);
            if (err) {
              callback(err);
              this.emit('error', err);
            } else {
              callback();
            }
          });
        }
        if (this.writableNeedDrain && this.writableLength <= this.writableHighWaterMark) {
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

/** Length of a stream chunk (string/Buffer/Uint8Array → .length, otherwise 1). */
function chunkLen(chunk: unknown): number {
  if (chunk == null) return 1;
  const v = (chunk as { length?: unknown }).length;
  return typeof v === 'number' ? v : 1;
}
