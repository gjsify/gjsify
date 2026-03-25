// SPDX-License-Identifier: MIT
// Adapted from Deno (refs/deno/ext/node/polyfills/_fs/_fs_streams.ts)
// Copyright (c) 2018-2026 the Deno authors. MIT license.
// Modifications: Rewritten to use Gio.File / Gio.FileInputStream for GJS
import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { Buffer } from "node:buffer";
import { Readable } from "node:stream";
import { URL, fileURLToPath } from "node:url";

import type { CreateReadStreamOptions } from 'node:fs/promises';
import type { PathLike, ReadStream as IReadStream } from 'node:fs';

export class ReadStream extends Readable implements IReadStream {
  bytesRead = 0;
  path: string | Buffer;
  pending = true;
  fd: number | null = null;

  private _gioFile: Gio.File;
  private _inputStream: Gio.FileInputStream | null = null;
  private _start: number;
  private _end: number;
  private _pos: number;

  close(callback?: (err?: NodeJS.ErrnoException | null) => void): void {
    if (this._inputStream) {
      try { this._inputStream.close(null); } catch {}
      this._inputStream = null;
    }
    this.destroy();
    if (callback) callback(null);
  }

  constructor(path: PathLike, opts?: CreateReadStreamOptions) {
    if (path instanceof URL) {
      path = fileURLToPath(path);
    }

    super({
      highWaterMark: opts?.highWaterMark ?? 64 * 1024,
      encoding: opts?.encoding as BufferEncoding | undefined,
      objectMode: false,
    });

    this.path = path.toString();
    this._gioFile = Gio.File.new_for_path(this.path.toString());
    this._start = (opts?.start as number) ?? 0;
    this._end = (opts?.end as number) ?? Infinity;
    this._pos = this._start;
  }

  override _read(size: number): void {
    // Open the stream lazily on first read
    if (!this._inputStream) {
      try {
        this._inputStream = this._gioFile.read(null);
        this.pending = false;
        this.emit('open', 0);
        this.emit('ready');

        // Seek to start position if needed
        if (this._start > 0 && this._inputStream.can_seek()) {
          this._inputStream.seek(this._start, GLib.SeekType.SET, null);
        }
      } catch (err) {
        this.destroy(err as Error);
        return;
      }
    }

    // Calculate how many bytes to read
    let toRead = size;
    if (this._end !== Infinity) {
      const remaining = this._end - this._pos + 1;
      if (remaining <= 0) {
        this.push(null);
        return;
      }
      toRead = Math.min(size, remaining);
    }

    try {
      const gbytes = this._inputStream!.read_bytes(toRead, null);
      const data = gbytes.get_data();

      if (!data || data.length === 0) {
        // EOF
        this.push(null);
        return;
      }

      this.bytesRead += data.length;
      this._pos += data.length;
      this.push(Buffer.from(data));
    } catch (err) {
      this.destroy(err as Error);
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    if (this._inputStream) {
      try { this._inputStream.close(null); } catch {}
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
