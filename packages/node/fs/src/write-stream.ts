import { Writable } from "stream";
import { fileURLToPath } from "url";
import { open, write, close } from "./callback.js";

import type { CreateWriteStreamOptions, OpenFlags, PathLike } from './types/index.js';

// From Deno
const kFs = Symbol("kFs");
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
export class WriteStream extends Writable {
    fd: number | null = null;
    path: string | Buffer;
    flags?: OpenFlags;
    mode?: number;
    bytesWritten = 0;
    pos = 0;
    [kFs] = { open, write };
    [kIsPerformingIO] = false;
    
    constructor(path: PathLike, opts: CreateWriteStreamOptions = {}) {
      super(opts);
      this.path = toPathIfFileURL(path);
      this.flags = opts.flags || "w";
      this.mode = opts.mode || 0o666;
      this[kFs] = opts.fs ?? { open, write, close };
  
      if (opts.encoding) {
        this.setDefaultEncoding(opts.encoding);
      }
    }
  
    override _construct(callback: (err?: Error) => void) {
      this[kFs].open(
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
      this[kFs].write(
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
        this.once(kIoDone, (er) => closeStream(this, err || er, cb));
      } else {
        closeStream(this, err, cb);
      }
    }
  }
  
  function closeStream(
    // deno-lint-ignore no-explicit-any
    stream: any,
    err: Error,
    cb: (err?: Error | null) => void,
  ) {
    if (!stream.fd) {
      cb(err);
    } else {
      stream[kFs].close(stream.fd, (er?: Error | null) => {
        cb(er || err);
      });
      stream.fd = null;
    }
  }
  
  export function createWriteStream(
    path: string | Buffer,
    opts: CreateWriteStreamOptions,
  ): WriteStream {
    return new WriteStream(path, opts);
  }