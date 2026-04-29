// Reference: Node.js lib/internal/fs/dir.js
// Reimplemented for GJS using Gio.FileEnumerator

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { normalizePath } from './utils.js';
import { Dirent } from './dirent.js';
import { createNodeError } from './errors.js';
import type { PathLike } from 'node:fs';

const DIR_ATTRS = 'standard::name,standard::type,standard::is-symlink,standard::size,standard::symlink-target,unix::uid,unix::gid,unix::mode,time::modified,time::access,time::created';

export class Dir {
  readonly path: string;
  private _enumerator: Gio.FileEnumerator | null;
  private _closed = false;

  constructor(path: string, enumerator: Gio.FileEnumerator) {
    this.path = path;
    this._enumerator = enumerator;
  }

  private _assertOpen(): void {
    if (this._closed) {
      const err = new Error('Directory handle was closed') as NodeJS.ErrnoException;
      err.code = 'ERR_DIR_CLOSED';
      throw err;
    }
  }

  readSync(): Dirent | null {
    this._assertOpen();
    try {
      const info = this._enumerator!.next_file(null);
      if (info === null) return null;
      const name = info.get_name();
      const fileType = info.get_file_type();
      const childPath = this.path.endsWith('/') ? this.path + name : this.path + '/' + name;
      return new Dirent(childPath, name, fileType);
    } catch (err: unknown) {
      throw createNodeError(err, 'readdir', this.path);
    }
  }

  read(): Promise<Dirent | null>;
  read(callback: (err: NodeJS.ErrnoException | null, dirent: Dirent | null) => void): void;
  read(callback?: (err: NodeJS.ErrnoException | null, dirent: Dirent | null) => void): Promise<Dirent | null> | void {
    if (callback !== undefined) {
      if (typeof callback !== 'function') {
        throw new TypeError('The "callback" argument must be of type function');
      }
      try {
        this._assertOpen();
        const dirent = this.readSync();
        Promise.resolve().then(() => callback(null, dirent));
      } catch (err: unknown) {
        Promise.resolve().then(() => callback(err as NodeJS.ErrnoException, null));
      }
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this._assertOpen();
        resolve(this.readSync());
      } catch (err: unknown) {
        reject(err);
      }
    });
  }

  closeSync(): void {
    this._assertOpen();
    this._closed = true;
    try {
      this._enumerator!.close(null);
    } catch {
      // ignore close errors
    }
    this._enumerator = null;
  }

  close(): Promise<void>;
  close(callback: (err: NodeJS.ErrnoException | null) => void): void;
  close(callback?: (err: NodeJS.ErrnoException | null) => void): Promise<void> | void {
    if (callback !== undefined) {
      if (typeof callback !== 'function') {
        throw new TypeError('The "callback" argument must be of type function');
      }
      try {
        this.closeSync();
        Promise.resolve().then(() => callback(null));
      } catch (err: unknown) {
        Promise.resolve().then(() => callback(err as NodeJS.ErrnoException));
      }
      return;
    }

    return new Promise((resolve, reject) => {
      try {
        this.closeSync();
        resolve();
      } catch (err: unknown) {
        reject(err);
      }
    });
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<Dirent> {
    try {
      while (true) {
        const dirent = await this.read();
        if (dirent === null) break;
        yield dirent;
      }
    } finally {
      if (!this._closed) {
        await this.close();
      }
    }
  }
}

function _openDir(pathStr: string): Dir {
  const file = Gio.File.new_for_path(pathStr);
  let enumerator: Gio.FileEnumerator;
  try {
    enumerator = file.enumerate_children(DIR_ATTRS, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
  } catch (err: unknown) {
    throw createNodeError(err, 'opendir', pathStr);
  }
  return new Dir(pathStr, enumerator);
}

export function opendirSync(path: PathLike): Dir {
  return _openDir(normalizePath(path));
}

export function opendir(
  path: PathLike,
  callback: (err: NodeJS.ErrnoException | null, dir: Dir) => void,
): void;
export function opendir(
  path: PathLike,
  options: { encoding?: BufferEncoding | null; bufferSize?: number; recursive?: boolean },
  callback: (err: NodeJS.ErrnoException | null, dir: Dir) => void,
): void;
export function opendir(
  path: PathLike,
  optionsOrCallback:
    | { encoding?: BufferEncoding | null; bufferSize?: number; recursive?: boolean }
    | ((err: NodeJS.ErrnoException | null, dir: Dir) => void),
  callback?: (err: NodeJS.ErrnoException | null, dir: Dir) => void,
): void {
  let cb: (err: NodeJS.ErrnoException | null, dir: Dir) => void;
  if (typeof optionsOrCallback === 'function') {
    cb = optionsOrCallback;
  } else {
    cb = callback!;
  }

  if (typeof cb !== 'function') {
    throw new TypeError('The "callback" argument must be of type function');
  }

  Promise.resolve().then(() => {
    try {
      const dir = opendirSync(path);
      cb(null, dir);
    } catch (err: unknown) {
      cb(err as NodeJS.ErrnoException, null as unknown as Dir);
    }
  });
}

// promises.opendir
export async function opendirAsync(
  path: PathLike,
  _options?: { encoding?: BufferEncoding | null; bufferSize?: number; recursive?: boolean },
): Promise<Dir> {
  return new Promise<Dir>((resolve, reject) => {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    file.enumerate_children_async(
      DIR_ATTRS,
      Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      GLib.PRIORITY_DEFAULT,
      null,
      (_source: unknown, result: Gio.AsyncResult) => {
        try {
          const enumerator = file.enumerate_children_finish(result);
          resolve(new Dir(pathStr, enumerator));
        } catch (err: unknown) {
          reject(createNodeError(err, 'opendir', pathStr));
        }
      },
    );
  });
}
