// SPDX-License-Identifier: MIT
// Adapted from Deno (refs/deno/ext/node/polyfills/_fs/_fs_streams.ts)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Modifications: Rewritten to use Gio.File / Gio.FileInputStream for GJS
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { normalizePath } from './utils.js';

import { FileHandle } from './file-handle.js';
import { closeSync } from './fd-ops.js';

import type { CreateReadStreamOptions } from 'node:fs/promises';
import type { PathLike, ReadStream as IReadStream } from 'node:fs';

/**
 * What `fs.createReadStream()` accepts, as opposed to
 * `filehandle.createReadStream()`.
 *
 * `CreateReadStreamOptions` is the fs/promises shape and has no `fd` — which is
 * exactly why one was never read here, and why this stream had no way to reach
 * a descriptor at all.
 */
export type ReadStreamOptions = CreateReadStreamOptions & {
    fd?: number | null;
};

export class ReadStream extends Readable implements IReadStream {
    bytesRead = 0;
    path: string | Buffer;
    pending = true;
    fd: number | null = null;

    /**
     * Read through the DESCRIPTOR rather than by opening the path again.
     *
     * `filehandle.createReadStream()` returned a stream that opened the path
     * afresh at offset 0: a second read cursor that neither consulted nor
     * advanced the handle's. After `await fh.read(buf,0,4,null)` the stream
     * replayed the whole file from the beginning where Node resumes at byte 4,
     * and it bound a different inode if the path had been replaced since the
     * open. The write half was moved onto the descriptor earlier in this
     * redesign, so until now the "one cursor" invariant held for writes only.
     */
    private _ownFd: number | null = null;
    private _autoCloseFd = true;
    /** Whether reads carry an explicit position (`start` given) or ride the shared cursor. */
    private _positional = false;

    private _gioFile: Gio.File;
    private _inputStream: Gio.FileInputStream | null = null;
    private _cancellable = new Gio.Cancellable();
    private _start: number;
    private _end: number;
    private _pos: number;
    /**
     * Whether a `read_bytes_async` is in flight.
     *
     * A `GInputStream` allows exactly ONE outstanding async operation; a second
     * one fails with `G_IO_ERROR_PENDING` ("Datenstrom hat noch einen
     * ausstehenden Vorgang"). Nothing here used to prevent the second call, and
     * the only thing that kept it rare was that the write side of a pipe took a
     * main-loop turn to acknowledge each chunk. The moment writes stopped
     * needing one, `pipe()` of a 128 KB file started failing about two runs in
     * three — a race that was always there, timed out of reach.
     *
     * So the invariant is enforced rather than relied on: a `_read()` that
     * arrives mid-flight is remembered and re-issued on completion instead of
     * being dropped (which would stall the stream) or issued (which throws).
     */
    private _reading = false;
    private _readAgain = false;
    private _lastSize = 64 * 1024;

    close(callback?: (err?: NodeJS.ErrnoException | null) => void): void {
        this._cancellable.cancel();
        this._release();
        this.destroy();
        if (callback) callback(null);
    }

    constructor(path: PathLike, opts?: ReadStreamOptions) {
        const pathStr = normalizePath(path);

        super({
            highWaterMark: opts?.highWaterMark ?? 64 * 1024,
            encoding: opts?.encoding as BufferEncoding | undefined,
            objectMode: false,
        });

        this.path = pathStr;
        this._gioFile = Gio.File.new_for_path(pathStr);
        this._start = (opts?.start as number) ?? 0;
        this._end = (opts?.end as number) ?? Infinity;
        this._pos = this._start;
        // Only an explicit `start` makes the reads positional. Without one Node
        // reads "sequentially from the current file position" — the
        // descriptor's, shared with every other operation on it.
        this._positional = opts?.start !== undefined;
        if (typeof opts?.fd === 'number') {
            this._ownFd = opts.fd;
            this.fd = opts.fd;
            // Node closes a stream-held descriptor at end unless told not to,
            // and does so whether the fd was handed in or opened here.
            this._autoCloseFd = opts.autoClose !== false;
        }
        // On 'end' and not only in `_destroy()`: a Readable that simply reaches
        // EOF emits 'end' then 'close' WITHOUT destroying, so `_destroy()`
        // never runs for the ordinary case and the open resource is held until
        // the stream is collected. Node has released it by then — a
        // `fh.read()` after the stream drains rejects EBADF.
        //
        // Registered for BOTH shapes. It used to sit inside the `fd` branch
        // above, so `fs.createReadStream(path)` — the far commoner one, and the
        // one this comment was written about — leaked exactly one descriptor
        // per stream: 200 streams, 200 descriptors, and the exhaustion then
        // surfaced as a raw `Gio.IOErrorEnum` rather than EMFILE. An explicit
        // `rs.destroy()` after `'close'` reclaimed none, because 'close' had
        // already been emitted without destroying.
        this.once('end', () => this._release());
    }

    // Use _construct() for async file opening so the stream machinery defers
    // _read() until the file is open. This avoids the fragile _pendingReadSize
    // pattern and correctly handles backpressure via the constructed flag.
    override _construct(callback: (err?: Error | null) => void): void {
        // A descriptor we were given is already open. Re-opening the path would
        // start a second cursor at 0 and could land on a different inode.
        if (this._ownFd !== null) {
            this.pending = false;
            callback();
            this.emit('open', this._ownFd);
            this.emit('ready');
            return;
        }
        this._gioFile.read_async(GLib.PRIORITY_DEFAULT, this._cancellable, (_source, asyncResult) => {
            if (this.destroyed) {
                callback();
                return;
            }
            try {
                this._inputStream = this._gioFile.read_finish(asyncResult);
                this.pending = false;
                this.emit('open', 0);
                this.emit('ready');
                if (this._start > 0 && this._inputStream!.can_seek()) {
                    this._inputStream!.seek(this._start, GLib.SeekType.SET, null);
                }
                callback();
            } catch (err) {
                if (!this._cancellable.is_cancelled()) {
                    callback(err as Error);
                }
            }
        });
    }

    override _read(size: number): void {
        this._lastSize = size;
        if (this._reading) {
            this._readAgain = true;
            return;
        }
        this._doRead(size);
    }

    private _doRead(size: number): void {
        // The descriptor path re-applies the `end` bound per chunk inside its
        // own burst loop, so it needs the caller's UNCLAMPED size — clamping it
        // here would shrink every later chunk of the burst to the first one's
        // remainder.
        //
        // It is also SCHEDULED rather than run inline, which is the whole
        // difference between 1127 ms and 130 ms for 64 MB. `handle._readSync()`
        // is synchronous by design (the cursor's read-modify-write must have no
        // suspension point in it — see `file-handle.ts`), so pushing from
        // inside `_read()` sets the Readable's `sync` flag and the machinery
        // defers the next `_read()` to `process.nextTick`. On GJS a SERIAL
        // nextTick chain costs a full 1 ms main-loop turn per link: the shared
        // drainer re-arms with a 1 ms yield whenever its queue is non-empty
        // (`@gjsify/utils/next-tick`, tuned so a burst cannot starve GTK
        // input), and a chain enqueues exactly one successor per drain. One
        // chunk per link is one turn per 64 KB — the measured 1025 timer ticks
        // for 1024 chunks.
        //
        // A zero-delay GLib source is what the Gio-async path below gets for
        // free from `read_bytes_async`'s completion: the push then happens
        // OUTSIDE `_read()`, so `push()` may re-enter `_read()` on its own
        // stack and the cycle runs at main-loop speed with no timer wait. This
        // borrows exactly that shape. `timeout_add` and not `idle_add` for the
        // reason `next-tick.ts` documents: it returns a plain numeric id, with
        // no BoxedInstance for the collector to race.
        if (this._ownFd !== null) {
            if (this._reading || this.destroyed) return;
            this._reading = true;
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 0, () => {
                this._reading = false;
                if (!this.destroyed) this._readThroughFd(size);
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        let toRead = size;
        if (this._end !== Infinity) {
            const remaining = this._end - this._pos + 1;
            if (remaining <= 0) {
                this.push(null);
                return;
            }
            toRead = Math.min(size, remaining);
        }

        const stream = this._inputStream;
        if (!stream || this.destroyed) return;

        this._reading = true;
        stream.read_bytes_async(toRead, GLib.PRIORITY_DEFAULT, this._cancellable, (_source, asyncResult) => {
            // Cleared BEFORE push(), because push() can call _read() straight
            // back on this stack in flowing mode and that call is legitimate —
            // the operation it would follow has already completed.
            this._reading = false;
            try {
                const gbytes = stream.read_bytes_finish(asyncResult);
                const data = gbytes.get_data();

                if (!data || data.length === 0) {
                    this._readAgain = false;
                    this.push(null);
                    return;
                }

                this.bytesRead += data.length;
                this._pos += data.length;
                this.push(Buffer.from(data));

                if (this._readAgain && !this._reading) {
                    this._readAgain = false;
                    this._doRead(this._lastSize);
                }
            } catch (err) {
                this._readAgain = false;
                if (!this._cancellable.is_cancelled()) {
                    this.destroy(err as Error);
                }
            }
        });
    }

    /**
     * One chunk through the descriptor, on the handle's own cursor.
     *
     * `position: null` when the caller gave no `start`, so the read advances
     * the shared offset exactly as `fh.read()` would and the stream picks up
     * where the last operation left off. With a `start` the reads are
     * positional (`pread`), which by the same core leaves the cursor alone —
     * Node's rule, verified against it.
     *
     * The `end` bound is applied HERE rather than in `_doRead`, because the
     * descriptor path is scheduled and `_doRead` no longer knows the cursor's
     * value at the moment the read actually happens.
     */
    private _readThroughFd(size: number): void {
        try {
            let toRead = size;
            if (this._end !== Infinity) {
                const remaining = this._end - this._pos + 1;
                if (remaining <= 0) {
                    this._readAgain = false;
                    this.push(null);
                    return;
                }
                toRead = Math.min(size, remaining);
            }
            const handle = FileHandle.getInstance(this._ownFd as number, 'read');
            const chunk = Buffer.alloc(toRead);
            const n = handle._readSync(chunk, 0, toRead, this._positional ? this._pos : null);
            if (n === 0) {
                this._readAgain = false;
                this.push(null);
                return;
            }
            this.bytesRead += n;
            this._pos += n;
            this.push(chunk.subarray(0, n));
        } catch (err) {
            this._readAgain = false;
            this.destroy(err as Error);
        }
    }

    /** Every OS resource this stream holds, released once and idempotently. */
    private _release(): void {
        if (this._inputStream) {
            this._inputStream.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
            this._inputStream = null;
        }
        this._releaseFd();
    }

    private _releaseFd(): void {
        if (this._ownFd === null || !this._autoCloseFd) return;
        const fd = this._ownFd;
        this._ownFd = null;
        this.fd = null;
        try {
            closeSync(fd);
        } catch {
            // Already closed by the owner between end-of-stream and here. The
            // descriptor is gone either way, which is all this needs; rethrowing
            // would turn a tidy finish into an unhandled error.
        }
    }

    override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        this._cancellable.cancel();
        this._release();
        callback(error);
    }
}

export function createReadStream(path: string | URL, options?: ReadStreamOptions): ReadStream {
    return new ReadStream(path, options);
}
