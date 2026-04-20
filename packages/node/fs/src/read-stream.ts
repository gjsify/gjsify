// SPDX-License-Identifier: MIT
// Adapted from Deno (refs/deno/ext/node/polyfills/_fs/_fs_streams.ts)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Modifications: Rewritten to use Gio.File / Gio.FileInputStream for GJS
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
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
  // Saved size from a _read() call that arrived before the file was open
  private _pendingReadSize: number | null = null;

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

    this._gioFile.read_async(GLib.PRIORITY_DEFAULT, this._cancellable, (_source, asyncResult) => {
      if (this.destroyed) return;
      try {
        this._inputStream = this._gioFile.read_finish(asyncResult);
        this.pending = false;
        this.emit('open', 0);
        this.emit('ready');
        if (this._start > 0 && this._inputStream!.can_seek()) {
          this._inputStream!.seek(this._start, GLib.SeekType.SET, null);
        }
        // Resume any _read() that arrived before the file was open
        if (this._pendingReadSize !== null) {
          const size = this._pendingReadSize;
          this._pendingReadSize = null;
          this._doRead(size);
        }
      } catch (err) {
        if (!this._cancellable.is_cancelled()) {
          this.destroy(err as Error);
        }
      }
    });
  }

  override _read(size: number): void {
    if (!this._inputStream) {
      if (this.destroyed) return;
      // File not open yet — save size, _doRead will fire when open completes
      this._pendingReadSize = size;
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

    const stream = this._inputStream!;
    stream.read_bytes_async(toRead, GLib.PRIORITY_DEFAULT, this._cancellable, (_source, asyncResult) => {
      try {
        const gbytes = stream.read_bytes_finish(asyncResult);
        const data = gbytes.get_data();

        if (!data || data.length === 0) {
          this.push(null);
          return;
        }

        this.bytesRead += data.length;
        this._pos += data.length;
        this.push(Buffer.from(data));
      } catch (err) {
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

export function createReadStream(
  path: string | URL,
  options?: CreateReadStreamOptions,
): ReadStream {
  return new ReadStream(path, options);
}
