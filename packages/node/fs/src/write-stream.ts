import { Writable } from "stream";
import { fileURLToPath } from "url";
import { notImplemented } from "@gjsify/utils";
import { open, write, close } from "./callback.js";

import type { OpenFlags } from './types/index.js';
import type { PathLike, WriteStream as IWriteStream } from 'fs';
import type { CreateWriteStreamOptions } from 'fs/promises'; // Types from @types/node

// From Deno
const kIsPerformingIO = Symbol("kIsPerformingIO");
const kIoDone = Symbol("kIoDone");

export function toPathIfFileURL(
  fileURLOrPath: string | Buffer | URL,
): string | Buffer {
  if (!(fileURLOrPath instanceof URL)) {
    return fileURLOrPath;
  }
  return fileURLToPath(fileURLOrPath);
}

// Credits https://github.com/denoland/deno_std/blob/main/node/internal/fs/streams.ts
export class WriteStream extends Writable implements IWriteStream {

    /**
     * Closes `writeStream`. Optionally accepts a
     * callback that will be executed once the `writeStream`is closed.
     * @since v0.9.4
     */
    close(callback?: (err?: NodeJS.ErrnoException | null) => void, err: Error | null = null): void {
      if (!this.fd) {
        callback(err);
      } else {
        close(this.fd, (er?: Error | null) => {
          callback(er || err);
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
    flags: OpenFlags = "w";
    mode = 0o666;
    pos = 0;
    [kIsPerformingIO] = false;
    
    constructor(path: PathLike, opts: CreateWriteStreamOptions = {}) {
      super(opts);
      this.path = toPathIfFileURL(path);
  
      if (opts.encoding) {
        this.setDefaultEncoding(opts.encoding);
      }
    }
  
    override _construct(callback: (err?: Error) => void) {
      open(
        this.path.toString(),
        this.flags!,
        this.mode!,
        (err: Error | null, fd: number) => {
          if (err) {
            callback(err);
            return;
          }
  
          this.fd = fd;
          callback();
          this.emit("open", this.fd);
          this.emit("ready");
        },
      );
    }
  
    override _write(
      data: Buffer,
      _encoding: string,
      cb: (err?: Error | null) => void,
    ) {
      this[kIsPerformingIO] = true;
      write(
        this.fd!,
        data,
        0,
        data.length,
        this.pos,
        (er: Error | null, bytes: number) => {
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
        },
      );
  
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

  
  export function createWriteStream(
    path: string | Buffer,
    opts: CreateWriteStreamOptions,
  ): WriteStream {
    return new WriteStream(path, opts);
  }