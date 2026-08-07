// SPDX-License-Identifier: MIT
// Adapted from Deno (refs/deno/ext/node/polyfills/internal/fs/streams.ts)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Modifications: Rewritten to use Gio.File for GJS

import { Writable } from 'node:stream';
import { open, write, close } from './callback.js';
import { normalizePath } from './utils.js';
import { normalizeMode } from './posix-flags.js';

import type { OpenFlags } from './types/index.js';
import type { Mode, PathLike, WriteStream as IWriteStream } from 'node:fs';
import type { CreateWriteStreamOptions } from 'node:fs/promises'; // Types from @types/node

/**
 * What `fs.createWriteStream()` accepts, as opposed to
 * `filehandle.createWriteStream()`.
 *
 * `CreateWriteStreamOptions` is the fs/promises shape and carries only
 * `encoding`/`autoClose`/`emitClose`/`start`/`highWaterMark` — which is
 * precisely why `flags`, `mode` and `fd` were never read here: they are not in
 * the type the constructor was written against.
 */
export type WriteStreamOptions = CreateWriteStreamOptions & {
    flags?: OpenFlags | string;
    mode?: Mode;
    fd?: number | null;
    /**
     * @internal Set only by {@link FileHandle.createWriteStream}.
     *
     * A descriptor that came from a `FileHandle` is closed through the HANDLE
     * in Node, and a handle's close is IDEMPOTENT — so a stream that finishes
     * after the caller already closed the handle reports nothing (measured
     * against v24.15.0: `errs=[]`). A raw `fd` handed to
     * `createWriteStream(p, {fd})` is a real `close(2)`, and Node DOES surface
     * its EBADF as an `'error'`. The two look identical from inside this class,
     * which is why they are told apart here rather than both swallowed — or, as
     * before this flag existed, both reported: that turned the ordinary
     * `fh.createWriteStream(); …; await fh.close()` sequence into an
     * `'error'` nobody listens for.
     */
    fdFromHandle?: boolean;
};

const kIsPerformingIO = Symbol('kIsPerformingIO');
const kIoDone = Symbol('kIoDone');

// Legacy alias — delegates to the fs-package-internal `normalizePath`.
// Accepts Buffer for compatibility with older call-sites; always returns a string.
export function toPathIfFileURL(fileURLOrPath: string | Buffer | URL): string {
    return normalizePath(fileURLOrPath as PathLike);
}
export class WriteStream extends Writable implements IWriteStream {
    /**
     * Closes `writeStream`. Optionally accepts a
     * callback that will be executed once the `writeStream`is closed.
     * @since v0.9.4
     */
    close(callback?: (err?: NodeJS.ErrnoException | null) => void, err: Error | null = null): void {
        // `ws.close()` with no callback is legal and silent in Node (measured
        // against v24.15.0). It was declared optional here and then called
        // unconditionally, so the documented no-argument spelling raised
        // `callback is not a function` — synchronously on the first branch, and
        // inside `fs.close`'s promise chain on the second, where it surfaced
        // only as an unhandled rejection. `_destroy()` always passes one, which
        // is why every test went green over it.
        const done = (e?: NodeJS.ErrnoException | Error | null) => {
            if (typeof callback === 'function') callback(e as NodeJS.ErrnoException | null);
        };
        if (this.fd === null || !this._autoClose) {
            // A descriptor we were handed stays open: the FileHandle (or the
            // caller) still owns it, and closing it here would pull the fd out
            // from under them.
            this.fd = null;
            done(err);
        } else {
            const fromHandle = this._fdFromHandle;
            close(this.fd, (er?: Error | null) => {
                // See `fdFromHandle`: a handle's close is idempotent in Node, a
                // raw descriptor's is not. Reporting the handle case is what
                // turns `fh.createWriteStream(); …; await fh.close()` into an
                // unlistened `'error'`.
                const reported = fromHandle && (er as NodeJS.ErrnoException | null)?.code === 'EBADF' ? null : er;
                done(reported || err);
            });
            this.fd = null;
        }
    }
    /**
     * The number of bytes written so far. Does not include data that is still queued
     * for writing.
     * @since v0.4.7
     */
    bytesWritten = 0;
    /**
     * The path to the file the stream is writing to as specified in the first
     * argument to {@link createWriteStream}. If `path` is passed as a string, then`writeStream.path` will be a string. If `path` is passed as a `Buffer`, then`writeStream.path` will be a
     * `Buffer`.
     * @since v0.1.93
     */
    path: string | Buffer;
    /**
     * This property is `true` if the underlying file has not been opened yet,
     * i.e. before the `'ready'` event is emitted.
     * @since v11.2.0
     */
    pending: boolean;

    fd: number | null = null;
    flags: OpenFlags = 'w';
    mode = 0o666;
    /**
     * The offset the next chunk is written at, or `undefined` to ride the
     * descriptor's own cursor — which is what Node does unless `start` is given.
     *
     * This was `pos = 0`, i.e. ALWAYS defined, so every chunk carried an
     * explicit position. That is why a `{flags: 'a'}` stream could only ever
     * rewrite the file from byte 0, and why `{start: n}` was silently ignored.
     */
    pos: number | undefined = undefined;
    /** Whether this stream owns the descriptor and must close it. */
    private _autoClose = true;
    /** Whether the descriptor came from a FileHandle — see `fdFromHandle`. */
    private _fdFromHandle = false;
    [kIsPerformingIO] = false;

    constructor(path: PathLike, opts: WriteStreamOptions = {}) {
        super(opts);
        this.path = toPathIfFileURL(path);

        // `opts.flags`, `opts.mode`, `opts.start`, `opts.fd` and
        // `opts.autoClose` were all discarded here — the class-field defaults
        // `'w'`/0o666 won, so `createWriteStream(p, {flags:'a'})` truncated and
        // `{mode: 0o600}` produced a world-readable file.
        if (opts.flags !== undefined) this.flags = opts.flags as OpenFlags;
        if (opts.mode !== undefined) this.mode = normalizeMode(opts.mode, 0o666);
        if (opts.start !== undefined) this.pos = opts.start;
        if (opts.encoding) {
            this.setDefaultEncoding(opts.encoding);
        }
        if (typeof opts.fd === 'number') {
            this.fd = opts.fd;
            // Node closes a stream-held descriptor at 'finish' whether the
            // stream opened it or was handed one: `createWriteStream(f, {fd})`
            // leaves that fd closed (measured — a later `writeSync` gives
            // EBADF). Defaulting to `false` here contradicted it and, with
            // `FileHandle.createWriteStream()` hardcoding `false` on top of the
            // caller's options, made `autoClose: true` unreachable from either
            // entry point.
            this._autoClose = opts.autoClose ?? true;
            this._fdFromHandle = opts.fdFromHandle === true;
        } else if (opts.autoClose !== undefined) {
            this._autoClose = opts.autoClose;
        }
        this.pending = this.fd === null;
    }

    override _construct(callback: (err?: Error) => void) {
        // A descriptor handed in by the caller (or by FileHandle.createWriteStream)
        // is already open; re-opening the path would bind a different inode and,
        // with the default `'w'` flags, truncate the file the caller had open.
        if (this.fd !== null) {
            callback();
            this.emit('open', this.fd);
            this.emit('ready');
            return;
        }
        open(this.path.toString(), this.flags!, this.mode!, (err: Error | null, fd: number) => {
            if (err) {
                callback(err);
                return;
            }

            this.fd = fd;
            this.pending = false;
            callback();
            this.emit('open', this.fd);
            this.emit('ready');
        });
    }

    override _write(data: Buffer, _encoding: string, cb: (err?: Error | null) => void) {
        this[kIsPerformingIO] = true;
        write(this.fd!, data, 0, data.length, this.pos ?? null, (er: Error | null, bytes: number) => {
            this[kIsPerformingIO] = false;
            if (this.destroyed) {
                // Tell ._destroy() that it's safe to close the fd now.
                cb(er);
                return this.emit(kIoDone, er);
            }

            if (er) {
                return cb(er);
            }

            this.bytesWritten += bytes;
            cb();
        });

        if (this.pos !== undefined) {
            this.pos += data.length;
        }
    }

    override _destroy(err: Error, cb: (err?: Error | null) => void) {
        if (this[kIsPerformingIO]) {
            this.once(kIoDone, (er) => this.close(cb, err || er));
        } else {
            this.close(cb, err);
        }
    }
}

export function createWriteStream(path: string | Buffer, opts: WriteStreamOptions): WriteStream {
    return new WriteStream(path, opts);
}
