// Credits https://github.com/denoland/deno_std/blob/main/node/_fs/_fs_streams.ts
import GLib from '@gjsify/types/GLib-2.0';
import { notImplemented } from "@gjsify/utils";
import { Buffer } from "buffer";
import { Readable } from "stream";

type ReadStreamOptions = Record<string, unknown>;

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

export class ReadStream extends Readable {
  public path: string;

  constructor(path: string | URL, opts?: ReadStreamOptions) {
    path = path instanceof URL ? fromFileUrl(path) : path;
    const hasBadOptions = opts && (
      opts.fd || opts.start || opts.end || opts.fs
    );
    if (hasBadOptions) {
      notImplemented(
        `fs.ReadStream.prototype.constructor with unsupported options (${
          JSON.stringify(opts)
        })`,
      );
    }
    const file = GLib.IOChannel.new_file(path, "r")
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
    this.path = path;
  }
}

export function createReadStream(
  path: string | URL,
  options?: ReadStreamOptions,
): ReadStream {
  return new ReadStream(path, options);
}