// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by readable-stream
// (Node.js contributors, MIT) and stream-browserify (James Halliday + browserify
// contributors, MIT).
//
// Reference: refs/readable-stream/lib, refs/stream-browserify/index.js.
//
// This module is the `@gjsify/stream` entry the bundler picks up when
// `gjsify build --app browser` resolves `stream` / `node:stream` /
// `@gjsify/stream` (per `ALIASES_NODE_FOR_BROWSER` in
// `packages/infra/resolve-npm/lib/index.mjs`, PR #388). The full GJS impl
// (`./index.js`) is large (Readable/Writable internals + GJS-tuned scheduling)
// and bundling it for the browser would needlessly inflate every web build.
//
// Strategy: a thin EventEmitter + queue-based adapter that exposes the
// canonical `stream` surface (Stream / Readable / Writable / Duplex / Transform
// / PassThrough + pipeline + finished). Backed by `queueMicrotask` for
// scheduling (the Web Streams primitives are NOT used directly — too many
// Node-stream consumers reach into internal state we'd otherwise have to
// emulate via a second adapter layer). Slot: browser:"polyfill". < 400 LOC.

import { EventEmitter } from '@gjsify/events';

// ─── Legacy Stream (pre-0.10) — base class for our polyfill ────────────────

interface WritableLike {
    writable?: boolean;
    write(chunk: unknown, enc?: string, cb?: () => void): boolean;
    end?(chunk?: unknown, enc?: string, cb?: () => void): void;
    destroy?(err?: Error): unknown;
    emit(event: string, ...args: unknown[]): boolean;
    on(event: string, listener: (...args: unknown[]) => void): unknown;
    removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
    _isStdio?: boolean;
}

export class Stream extends EventEmitter {
    static Stream: typeof Stream;
    static Readable: typeof Readable;
    static Writable: typeof Writable;
    static Duplex: typeof Duplex;
    static Transform: typeof Transform;
    static PassThrough: typeof PassThrough;
    static pipeline: typeof pipeline;
    static finished: typeof finished;

    readable = false;
    writable = false;

    /** Optional subclass hook — present on Readable/Duplex. */
    pause?(): this;
    /** Optional subclass hook — present on Readable/Duplex. */
    resume?(): this;

    pipe<T extends WritableLike>(dest: T, options?: { end?: boolean }): T {
        const source = this;
        const ondata = (chunk: unknown): void => {
            if (dest.writable !== false && dest.write(chunk) === false && source.pause) source.pause();
        };
        source.on('data', ondata);
        const ondrain = (): void => {
            if (source.readable && source.resume) source.resume();
        };
        dest.on('drain', ondrain);

        let didOnEnd = false;
        const onend = (): void => {
            if (didOnEnd) return;
            didOnEnd = true;
            dest.end?.();
        };
        const onclose = (): void => {
            if (didOnEnd) return;
            didOnEnd = true;
            dest.destroy?.();
        };
        const onerror = (er: Error): void => {
            cleanup();
            if (EventEmitter.listenerCount(source, 'error') === 0) throw er;
        };
        const cleanup = (): void => {
            source.removeListener('data', ondata);
            dest.removeListener('drain', ondrain);
            source.removeListener('end', onend);
            source.removeListener('close', onclose);
            source.removeListener('error', onerror);
            dest.removeListener('error', onerror);
            source.removeListener('end', cleanup);
            source.removeListener('close', cleanup);
            dest.removeListener('close', cleanup);
        };

        if (!dest._isStdio && (!options || options.end !== false)) {
            source.on('end', onend);
            source.on('close', onclose);
        }
        source.on('error', onerror);
        dest.on('error', onerror);
        source.on('end', cleanup);
        source.on('close', cleanup);
        dest.on('close', cleanup);

        dest.emit('pipe', source);
        return dest;
    }
}

// ─── Readable ──────────────────────────────────────────────────────────────

export class Readable extends Stream {
    static from(iterable: Iterable<unknown> | AsyncIterable<unknown>): Readable {
        const r = new Readable();
        (async () => {
            try {
                for await (const chunk of iterable as AsyncIterable<unknown>) r.push(chunk);
                r.push(null);
            } catch (err) {
                r.destroy(err as Error);
            }
        })();
        return r;
    }

    override readable = true;
    destroyed = false;
    readableEnded = false;
    protected _buffer: unknown[] = [];
    protected _paused = false;
    protected _flowing: boolean | null = null;
    protected _ended = false;
    protected _endEmitted = false;
    protected _drainScheduled = false;

    push(chunk: unknown): boolean {
        if (chunk === null) {
            this._ended = true;
            // Route end emission through the same drain path as data so a flowing
            // 'end' can never overtake still-pending 'data' emits (and fires once).
            this._scheduleDrain();
            return false;
        }
        if (this._flowing) {
            // Buffer + coalesced drain instead of an independent per-chunk
            // microtask: keeps data ordered ahead of 'end' on the single path.
            this._buffer.push(chunk);
            this._scheduleDrain();
        } else {
            this._buffer.push(chunk);
            this.emit('readable');
        }
        return !this._paused;
    }

    protected _scheduleDrain(): void {
        if (this._drainScheduled) return;
        this._drainScheduled = true;
        queueMicrotask(() => {
            this._drainScheduled = false;
            this._drainBuffer();
        });
    }

    read(): unknown {
        return this._buffer.length === 0 ? null : this._buffer.shift();
    }

    override pause(): this {
        this._paused = true;
        this._flowing = false;
        this.emit('pause');
        return this;
    }

    override resume(): this {
        this._paused = false;
        this._flowing = true;
        this._scheduleDrain();
        this.emit('resume');
        return this;
    }

    protected _drainBuffer(): void {
        while (this._flowing && this._buffer.length > 0) this.emit('data', this._buffer.shift());
        if (this._ended && this._buffer.length === 0 && !this._endEmitted) {
            this._endEmitted = true;
            this.readableEnded = true;
            this.emit('end');
        }
    }

    destroy(err?: Error): this {
        if (this.destroyed) return this;
        this.destroyed = true;
        queueMicrotask(() => {
            if (err) this.emit('error', err);
            this.emit('close');
        });
        return this;
    }

    override on(event: string, listener: (...args: unknown[]) => void): this {
        super.on(event, listener);
        if (event === 'data' && this._flowing === null) {
            this._flowing = true;
            this._scheduleDrain();
        }
        return this;
    }

    async *[Symbol.asyncIterator](): AsyncIterableIterator<unknown> {
        const self = this;
        let waiter: ((v: IteratorResult<unknown>) => void) | null = null;
        const queue: unknown[] = [];
        let done = false;
        let err: Error | null = null;

        const settle = (r: IteratorResult<unknown>): void => {
            if (waiter) {
                const w = waiter;
                waiter = null;
                w(r);
            }
        };
        const onData = (chunk: unknown): void => {
            if (waiter) settle({ value: chunk, done: false });
            else queue.push(chunk);
        };
        const onEnd = (): void => {
            done = true;
            settle({ value: undefined, done: true });
        };
        const onError = (e: Error): void => {
            err = e;
            settle({ value: undefined, done: true });
        };
        self.on('data', onData);
        self.on('end', onEnd);
        self.on('error', onError);

        try {
            while (true) {
                if (err) throw err;
                if (queue.length > 0) {
                    yield queue.shift();
                    continue;
                }
                if (done) return;
                const r = await new Promise<IteratorResult<unknown>>((res) => {
                    waiter = res;
                });
                if (r.done) return;
                yield r.value;
            }
        } finally {
            self.removeListener('data', onData);
            self.removeListener('end', onEnd);
            self.removeListener('error', onError);
        }
    }
}

// ─── Writable ──────────────────────────────────────────────────────────────

type WriteCb = (err?: Error | null) => void;

export class Writable extends Stream {
    override writable = true;
    writableEnded = false;
    writableFinished = false;
    destroyed = false;
    /** Subclass-supplied write impl. */
    _write?(chunk: unknown, enc: string, cb: WriteCb): void;
    protected _writing = false;
    protected _writeEnded = false;

    write(chunk: unknown, encOrCb?: string | WriteCb, cb?: WriteCb): boolean {
        if (this._writeEnded) {
            const err = new Error('write after end');
            queueMicrotask(() => this.emit('error', err));
            return false;
        }
        const enc = typeof encOrCb === 'string' ? encOrCb : 'utf8';
        const callback = typeof encOrCb === 'function' ? encOrCb : cb;
        if (typeof this._write === 'function') {
            this._writing = true;
            this._write(chunk, enc, (err) => {
                this._writing = false;
                if (err) {
                    queueMicrotask(() => this.emit('error', err));
                    callback?.();
                    return;
                }
                callback?.();
                queueMicrotask(() => this.emit('drain'));
            });
        } else {
            // No subclass impl — drop the write but call back.
            if (callback) queueMicrotask(() => callback());
        }
        return !this._writing;
    }

    end(chunk?: unknown, encOrCb?: string | WriteCb, cb?: WriteCb): this {
        const callback = typeof encOrCb === 'function' ? encOrCb : cb;
        const finish = (): void => {
            this._writeEnded = true;
            this.writableEnded = true;
            queueMicrotask(() => {
                this.writableFinished = true;
                this.emit('finish');
                this.emit('close');
            });
            if (callback) queueMicrotask(() => callback());
        };
        if (chunk !== undefined && chunk !== null) {
            this.write(chunk, typeof encOrCb === 'string' ? encOrCb : undefined, finish);
        } else {
            finish();
        }
        return this;
    }

    destroy(err?: Error): this {
        if (this.destroyed) return this;
        this.destroyed = true;
        queueMicrotask(() => {
            if (err) this.emit('error', err);
            this.emit('close');
        });
        return this;
    }
}

// ─── Duplex / Transform / PassThrough ──────────────────────────────────────

export class Duplex extends Readable {
    override writable = true;
    writableEnded = false;
    writableFinished = false;
    _write?(chunk: unknown, enc: string, cb: WriteCb): void;
    protected _writing = false;
    protected _writeEnded = false;

    write(chunk: unknown, encOrCb?: string | WriteCb, cb?: WriteCb): boolean {
        return Writable.prototype.write.call(this as unknown as Writable, chunk, encOrCb, cb);
    }
    end(chunk?: unknown, encOrCb?: string | WriteCb, cb?: WriteCb): this {
        Writable.prototype.end.call(this as unknown as Writable, chunk, encOrCb, cb);
        return this;
    }
}

export class Transform extends Duplex {
    _transform?(chunk: unknown, enc: string, cb: (err: Error | null, data?: unknown) => void): void;
    _flush?(cb: (err?: Error | null) => void): void;

    constructor(opts?: {
        transform?: (chunk: unknown, enc: string, cb: (err: Error | null, data?: unknown) => void) => void;
        flush?: (cb: (err?: Error | null) => void) => void;
    }) {
        super();
        if (opts?.transform) this._transform = opts.transform;
        if (opts?.flush) this._flush = opts.flush;
    }

    override write(chunk: unknown, encOrCb?: string | WriteCb, cb?: WriteCb): boolean {
        const enc = typeof encOrCb === 'string' ? encOrCb : 'utf8';
        const callback = typeof encOrCb === 'function' ? encOrCb : cb;
        if (typeof this._transform === 'function') {
            this._transform(chunk, enc, (err, data) => {
                if (err) {
                    queueMicrotask(() => this.emit('error', err));
                    return;
                }
                if (data !== undefined && data !== null) this.push(data);
                callback?.();
            });
        } else {
            this.push(chunk);
            if (callback) queueMicrotask(() => callback());
        }
        return true;
    }

    override end(chunk?: unknown, encOrCb?: string | WriteCb, cb?: WriteCb): this {
        const finishOut = (): void => {
            const callback = typeof encOrCb === 'function' ? encOrCb : cb;
            const done = (): void => {
                this.push(null);
                this._writeEnded = true;
                this.writableEnded = true;
                queueMicrotask(() => {
                    this.writableFinished = true;
                    this.emit('finish');
                });
                if (callback) queueMicrotask(() => callback());
            };
            if (typeof this._flush === 'function') {
                this._flush((err) => {
                    if (err) queueMicrotask(() => this.emit('error', err));
                    else done();
                });
            } else {
                done();
            }
        };
        if (chunk !== undefined && chunk !== null) this.write(chunk, typeof encOrCb === 'string' ? encOrCb : undefined, finishOut);
        else finishOut();
        return this;
    }
}

export class PassThrough extends Transform {
    constructor() {
        super({
            transform(chunk, _enc, cb) {
                cb(null, chunk);
            },
        });
    }
}

// ─── Utilities ─────────────────────────────────────────────────────────────

type AnyStream = Readable | Writable | Duplex | Stream;
type Callback = (err?: Error | null) => void;

export function pipeline(...args: (AnyStream | Callback)[]): AnyStream {
    const callback = typeof args[args.length - 1] === 'function' ? (args.pop() as Callback) : undefined;
    const streams = args as AnyStream[];
    if (streams.length < 2) throw new Error('pipeline requires at least 2 streams');
    let done = false;
    const finish = (err?: Error | null): void => {
        if (done) return;
        done = true;
        callback?.(err ?? null);
    };
    for (let i = 0; i < streams.length - 1; i++) {
        const src = streams[i];
        const dst = streams[i + 1];
        if (typeof (src as Stream).pipe === 'function') (src as Stream).pipe(dst as unknown as WritableLike);
        src.on('error', finish);
    }
    const last = streams[streams.length - 1];
    last.on('error', finish);
    last.on('finish', () => finish());
    last.on('end', () => finish());
    return last;
}

export function finished(stream: AnyStream, cbOrOpts: Callback | { signal?: AbortSignal }, maybeCb?: Callback): () => void {
    const callback = typeof cbOrOpts === 'function' ? cbOrOpts : maybeCb;
    let done = false;
    const finish = (err?: Error | null): void => {
        if (done) return;
        done = true;
        callback?.(err ?? null);
    };
    const onEnd = (): void => finish();
    const onFinish = (): void => finish();
    const onError = (err: Error): void => finish(err);
    const onClose = (): void => finish();
    stream.on('end', onEnd);
    stream.on('finish', onFinish);
    stream.on('error', onError);
    stream.on('close', onClose);
    return () => {
        stream.removeListener('end', onEnd);
        stream.removeListener('finish', onFinish);
        stream.removeListener('error', onError);
        stream.removeListener('close', onClose);
    };
}

export function addAbortSignal<T extends AnyStream>(signal: AbortSignal, stream: T): T {
    const onAbort = (): void => {
        (stream as AnyStream & { destroy?: (e: Error) => void }).destroy?.(new Error('AbortError'));
    };
    if (signal.aborted) queueMicrotask(onAbort);
    else signal.addEventListener('abort', onAbort, { once: true });
    return stream;
}

export const isReadable = (s: unknown): boolean => s instanceof Readable && (s as Readable).readable;
export const isWritable = (s: unknown): boolean => s instanceof Writable && (s as Writable).writable;
export const isDestroyed = (s: unknown): boolean => Boolean(s && typeof s === 'object' && (s as { destroyed?: boolean }).destroyed);
export const isDisturbed = (s: unknown): boolean => isDestroyed(s);
export const isErrored = (s: unknown): boolean => Boolean(s && typeof s === 'object' && (s as { errored?: unknown }).errored);

let _hwm = 16 * 1024;
export const getDefaultHighWaterMark = (_objectMode?: boolean): number => _hwm;
export const setDefaultHighWaterMark = (_objectMode: boolean, n: number): void => {
    _hwm = n;
};

// Wire up the legacy static aliases (stream-browserify compat).
Stream.Stream = Stream;
Stream.Readable = Readable;
Stream.Writable = Writable;
Stream.Duplex = Duplex;
Stream.Transform = Transform;
Stream.PassThrough = PassThrough;
Stream.pipeline = pipeline;
Stream.finished = finished;

const streamDefault = Object.assign(Stream, {
    Readable,
    Writable,
    Duplex,
    Transform,
    PassThrough,
    Stream,
    pipeline,
    finished,
});

export default streamDefault;
