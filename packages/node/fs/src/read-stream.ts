// SPDX-License-Identifier: MIT
// Adapted from Deno (refs/deno/ext/node/polyfills/_fs/_fs_streams.ts)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Modifications: Rewritten to use Gio.File / Gio.FileInputStream for GJS
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Buffer } from 'node:buffer';
import { Readable } from 'node:stream';
import { normalizePath } from './utils.js';

import type { CreateReadStreamOptions } from 'node:fs/promises';
import type { PathLike, ReadStream as IReadStream } from 'node:fs';

export class ReadStream extends Readable implements IReadStream {
    bytesRead = 0;
    path: string | Buffer;
    pending = true;
    fd: number | null = null;

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
        if (this._inputStream) {
            this._inputStream.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
            this._inputStream = null;
        }
        this.destroy();
        if (callback) callback(null);
    }

    constructor(path: PathLike, opts?: CreateReadStreamOptions) {
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
    }

    // Use _construct() for async file opening so the stream machinery defers
    // _read() until the file is open. This avoids the fragile _pendingReadSize
    // pattern and correctly handles backpressure via the constructed flag.
    override _construct(callback: (err?: Error | null) => void): void {
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

    override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
        this._cancellable.cancel();
        if (this._inputStream) {
            this._inputStream.close_async(GLib.PRIORITY_DEFAULT, null, () => {});
            this._inputStream = null;
        }
        callback(error);
    }
}

export function createReadStream(path: string | URL, options?: CreateReadStreamOptions): ReadStream {
    return new ReadStream(path, options);
}
