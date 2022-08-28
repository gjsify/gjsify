// Credits https://github.com/denoland/deno_std/blob/main/node/_fs/_fs_streams.ts
import GLib from '@gjsify/types/GLib-2.0';
import { notImplemented } from "@gjsify/utils";
import { Buffer } from "buffer";
import { Readable } from "stream";

import type { CreateReadStreamOptions } from 'fs/promises'; // Types from @types/node
import type { PathLike, ReadStream as IReadStream } from 'fs'; // Types from @types/node

/**
 * Converts a file URL to a path string.
 *
 * ```ts
 *      import { fromFileUrl } from "./posix.ts";
 *      fromFileUrl("file:///home/foo"); // "/home/foo"
 * ```
 * @param url of a file URL
 * @credits https://github.com/denoland/deno_std/blob/44d05e7a8d445888d989d49eb3e59eee3055f2c5/node/path/posix.ts#L486
 */
export function fromFileUrl(url: string | URL): string {
  url = url instanceof URL ? url : new URL(url);
  if (url.protocol != "file:") {
    throw new TypeError("Must be a file URL.");
  }
  return decodeURIComponent(
    url.pathname.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"),
  );
}

export class ReadStream extends Readable implements IReadStream {
  close(callback?: (err?: NodeJS.ErrnoException | null) => void): void {
    // TODO
    callback(notImplemented('ReadStream.close'));
  }
  /**
   * The number of bytes that have been read so far.
   * @since v6.4.0
   */
  bytesRead: number;
  /**
   * The path to the file the stream is reading from as specified in the first
   * argument to `fs.createReadStream()`. If `path` is passed as a string, then`readStream.path` will be a string. If `path` is passed as a `Buffer`, then`readStream.path` will be a
   * `Buffer`. If `fd` is specified, then`readStream.path` will be `undefined`.
   * @since v0.1.93
   */
  path: string | Buffer;
  /**
   * This property is `true` if the underlying file has not been opened yet,
   * i.e. before the `'ready'` event is emitted.
   * @since v11.2.0, v10.16.0
   */
  pending: boolean;

  constructor(path: PathLike, opts?: CreateReadStreamOptions) {
    path = path instanceof URL ? fromFileUrl(path) : path;
    const hasBadOptions = opts && (
      opts.start || opts.end
    );
    if (hasBadOptions) {
      notImplemented(
        `fs.ReadStream.prototype.constructor with unsupported options (${
          JSON.stringify(opts)
        })`,
      );
    }
    const file = GLib.IOChannel.new_file(path.toString(), "r")
    const buffer = "";
    super({
      autoDestroy: true,
      emitClose: true,
      objectMode: false,
      read: async function (_size) {
        try {
          let n = 0
          file.read(buffer, 16 * 1024, n);
          this.push(n ? Buffer.from(buffer.slice(0, n)) : null);
        } catch (err) {
          this.destroy(err as Error);
        }
      },
      destroy: (err, cb) => {
        try {
          file.close();
        } catch {}
        cb(err);
      },
    });
    this.path = path.toString();
  }
}

export function createReadStream(
  path: string | URL,
  options?: CreateReadStreamOptions,
): ReadStream {
  return new ReadStream(path, options);
}