// Native stream module for GJS — no Deno dependency
// Implements core Node.js stream classes built on EventEmitter.

import { EventEmitter } from '@gjsify/events';

// ---- Types ----

/** Base options accepted by the Stream constructor (superset used by subclass options). */
export interface StreamOptions {
  highWaterMark?: number;
  objectMode?: boolean;
  signal?: AbortSignal;
  captureRejections?: boolean;
}

export interface ReadableOptions extends StreamOptions {
  encoding?: string;
  autoDestroy?: boolean;
  read?(this: Readable, size: number): void;
  destroy?(this: Readable, error: Error | null, callback: (error?: Error | null) => void): void;
}

export interface WritableOptions extends StreamOptions {
  decodeStrings?: boolean;
  defaultEncoding?: string;
  autoDestroy?: boolean;
  write?(this: Writable, chunk: any, encoding: string, callback: (error?: Error | null) => void): void;
  writev?(this: Writable, chunks: Array<{ chunk: any; encoding: string }>, callback: (error?: Error | null) => void): void;
  final?(this: Writable, callback: (error?: Error | null) => void): void;
  destroy?(this: Writable, error: Error | null, callback: (error?: Error | null) => void): void;
}

export interface DuplexOptions extends ReadableOptions, WritableOptions {
  allowHalfOpen?: boolean;
  readableObjectMode?: boolean;
  writableObjectMode?: boolean;
  destroy?(this: Readable & Writable, error: Error | null, callback: (error?: Error | null) => void): void;
}

export interface TransformOptions extends DuplexOptions {
  transform?(this: Transform, chunk: any, encoding: string, callback: (error?: Error | null, data?: any) => void): void;
  flush?(this: Transform, callback: (error?: Error | null, data?: any) => void): void;
}

export interface FinishedOptions {
  error?: boolean;
  readable?: boolean;
  writable?: boolean;
}

// ---- Stream base class ----

/** A stream-like emitter that may have `pause` and `resume` methods (duck-typed). */
interface StreamLike extends EventEmitter {
  pause?(): void;
  resume?(): void;
}

export class Stream extends EventEmitter {
  constructor(opts?: StreamOptions) {
    super(opts);
  }

  pipe<T extends Writable>(destination: T, options?: { end?: boolean }): T {
    const source: StreamLike = this;
    const doEnd = options?.end !== false;

    function ondata(chunk: unknown) {
      if (destination.writable) {
        if (destination.write(chunk) === false && typeof source.pause === 'function') {
          source.pause();
        }
      }
    }

    source.on('data', ondata);

    function ondrain() {
      if (typeof source.resume === 'function') {
        source.resume();
      }
    }
    destination.on('drain', ondrain);

    function onend() {
      if (doEnd) {
        destination.end();
      }
    }
    if (doEnd) {
      source.on('end', onend);
    }

    function cleanup() {
      source.removeListener('data', ondata);
      destination.removeListener('drain', ondrain);
      source.removeListener('end', onend);
    }

    source.on('close', cleanup);
    destination.on('close', cleanup);

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
  destroyed = false;

  private _buffer: unknown[] = [];
  private _readableState = { ended: false, endEmitted: false, reading: false };
  private _readImpl: ((size: number) => void) | undefined;
  private _destroyImpl: ((error: Error | null, cb: (error?: Error | null) => void) => void) | undefined;

  constructor(opts?: ReadableOptions) {
    super(opts);
    this.readableHighWaterMark = opts?.highWaterMark ?? 16384;
    this.readableEncoding = opts?.encoding ?? null;
    this.readableObjectMode = opts?.objectMode ?? false;
    if (opts?.read) this._readImpl = opts.read;
    if (opts?.destroy) this._destroyImpl = opts.destroy;
  }

  _read(_size: number): void {
    if (this._readImpl) {
      this._readImpl.call(this, _size);
    }
  }

  read(size?: number): any {
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
      if (this._buffer.length === 0) {
        this._readableState.endEmitted = true;
        this.emit('end');
      }
      return false;
    }

    this._buffer.push(chunk);
    this.readableLength += this.readableObjectMode ? 1 : (chunk.length ?? 1);
    this.emit('data', chunk);

    return this.readableLength < this.readableHighWaterMark;
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
    this.readableFlowing = true;
    this.emit('resume');
    return this;
  }

  isPaused(): boolean {
    return this.readableFlowing === false;
  }

  unpipe(destination?: Writable): this {
    // Simplified — full implementation needs tracking piped destinations
    return this;
  }

  destroy(error?: Error): this {
    if (this.destroyed) return this;
    this.destroyed = true;
    this.readable = false;

    const cb = (err?: Error | null) => {
      if (err) this.emit('error', err);
      this.emit('close');
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
  destroyed = false;

  private _writableState = { ended: false, finished: false, corked: 0 };
  private _writeImpl: ((chunk: any, encoding: string, cb: (error?: Error | null) => void) => void) | undefined;
  private _finalImpl: ((cb: (error?: Error | null) => void) => void) | undefined;
  private _destroyImpl: ((error: Error | null, cb: (error?: Error | null) => void) => void) | undefined;

  constructor(opts?: WritableOptions) {
    super(opts);
    this.writableHighWaterMark = opts?.highWaterMark ?? 16384;
    this.writableObjectMode = opts?.objectMode ?? false;
    if (opts?.write) this._writeImpl = opts.write;
    if (opts?.final) this._finalImpl = opts.final;
    if (opts?.destroy) this._destroyImpl = opts.destroy;
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
    callback = callback || (() => {});

    if (this.writableEnded) {
      const err = new Error('write after end');
      if (callback) callback(err);
      this.emit('error', err);
      return false;
    }

    this.writableLength += this.writableObjectMode ? 1 : (chunk?.length ?? 1);

    const cb = callback;
    this._write(chunk, encoding as string, (err) => {
      this.writableLength -= this.writableObjectMode ? 1 : (chunk?.length ?? 1);
      if (err) {
        if (cb) cb(err);
        this.emit('error', err);
      } else {
        if (cb) cb();
        this.emit('drain');
      }
    });

    return this.writableLength < this.writableHighWaterMark;
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
    this._writableState.ended = true;

    this._final((err) => {
      this.writableFinished = true;
      this._writableState.finished = true;
      if (err) {
        this.emit('error', err);
      }
      this.emit('finish');
      if (callback) callback();
    });

    return this;
  }

  cork(): void {
    this._writableState.corked++;
  }

  uncork(): void {
    if (this._writableState.corked > 0) {
      this._writableState.corked--;
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
      if (err) this.emit('error', err);
      this.emit('close');
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

  private _duplexWritableState = { ended: false, finished: false, corked: 0 };
  private _writeImpl: ((chunk: any, encoding: string, cb: (error?: Error | null) => void) => void) | undefined;
  private _finalImpl: ((cb: (error?: Error | null) => void) => void) | undefined;

  constructor(opts?: DuplexOptions) {
    super(opts);
    this.writableHighWaterMark = opts?.highWaterMark ?? 16384;
    this.writableObjectMode = opts?.writableObjectMode ?? opts?.objectMode ?? false;
    if (opts?.write) this._writeImpl = opts.write;
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

    this.writableLength += this.writableObjectMode ? 1 : (chunk?.length ?? 1);

    const cb = callback || (() => {});
    this._write(chunk, encoding as string, (err) => {
      this.writableLength -= this.writableObjectMode ? 1 : (chunk?.length ?? 1);
      if (err) {
        cb(err);
        this.emit('error', err);
      } else {
        cb();
        this.emit('drain');
      }
    });

    return this.writableLength < this.writableHighWaterMark;
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
      if (err) this.emit('error', err);
      this.emit('finish');
      if (callback) callback();
    });

    return this;
  }

  cork(): void { this._duplexWritableState.corked++; }
  uncork(): void { if (this._duplexWritableState.corked > 0) this._duplexWritableState.corked--; }
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

  return function cleanup() {
    stream.removeListener('finish', onFinish);
    stream.removeListener('end', onEnd);
    stream.removeListener('error', onError);
    stream.removeListener('close', onClose);
  };
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
});

export default _default;
