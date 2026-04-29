// fs.cp / fs.cpSync / fs.promises.cp — recursive copy
// Reference: Node.js lib/internal/fs/cpSync.js
// Reimplemented for GJS using Gio.File synchronous operations

import Gio from '@girs/gio-2.0';
import { join } from 'node:path';
import { normalizePath } from './utils.js';
import { createNodeError } from './errors.js';

import type { PathLike } from 'node:fs';

export interface CpSyncOptions {
  dereference?: boolean;
  errorOnExist?: boolean;
  filter?: (src: string, dest: string) => boolean;
  force?: boolean;
  mode?: number;
  preserveTimestamps?: boolean;
  recursive?: boolean;
  verbatimSymlinks?: boolean;
}

export interface CpOptions extends Omit<CpSyncOptions, 'filter'> {
  filter?: (src: string, dest: string) => boolean | Promise<boolean>;
}

function makeEEXIST(destStr: string): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`ERR_FS_CP_EEXIST: file already exists, copyfile '${destStr}'`);
  e.code = 'ERR_FS_CP_EEXIST';
  e.syscall = 'copyfile';
  e.path = destStr;
  return e;
}

function makeEISDIR(srcStr: string): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`ERR_FS_EISDIR: illegal operation on a directory, copyfile '${srcStr}'`);
  e.code = 'ERR_FS_EISDIR';
  e.syscall = 'copyfile';
  e.path = srcStr;
  return e;
}

function makeENOTDIR(srcStr: string, destStr: string): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`ENOTDIR: not a directory, copyfile '${srcStr}' -> '${destStr}'`);
  e.code = 'ENOTDIR';
  e.syscall = 'copyfile';
  e.path = srcStr;
  (e as any).dest = destStr;
  return e;
}

function makeSYMLINKLOOP(srcStr: string, destStr: string): NodeJS.ErrnoException {
  const e: NodeJS.ErrnoException = new Error(`ELOOP: too many levels of symbolic links, copyfile '${srcStr}' -> '${destStr}'`);
  e.code = 'ELOOP';
  e.syscall = 'copyfile';
  e.path = srcStr;
  (e as any).dest = destStr;
  return e;
}

function queryCopyFlags(opts: CpSyncOptions | CpOptions): Gio.FileCopyFlags {
  const force = opts.force ?? true;
  let flags = Gio.FileCopyFlags.NONE;
  if (force) flags |= Gio.FileCopyFlags.OVERWRITE;
  if (opts.preserveTimestamps) flags |= Gio.FileCopyFlags.TARGET_DEFAULT_MODIFIED_TIME;
  if (!opts.dereference) flags |= Gio.FileCopyFlags.NOFOLLOW_SYMLINKS;
  return flags;
}

function copyOneSyncFile(srcFile: Gio.File, destFile: Gio.File, srcStr: string, destStr: string, opts: CpSyncOptions | CpOptions): void {
  const force = opts.force ?? true;

  // Check dest is not a directory
  try {
    const destInfo = destFile.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
    if (destInfo.get_file_type() === Gio.FileType.DIRECTORY) {
      throw makeENOTDIR(srcStr, destStr);
    }
    if (!force) {
      if (opts.errorOnExist) throw makeEEXIST(destStr);
      return; // silent skip when force=false and no errorOnExist
    }
  } catch (e: any) {
    if (typeof e.code === 'string') throw e; // re-throw Node-style errors (string codes)
    // Gio errors have numeric codes (e.g. NOT_FOUND=1) — dest doesn't exist, fine
  }

  const flags = queryCopyFlags(opts);
  try {
    srcFile.copy(destFile, flags, null, null);
  } catch (err: unknown) {
    throw createNodeError(err, 'copyfile', srcStr, destStr);
  }
}

function cpOneDirSync(srcFile: Gio.File, destFile: Gio.File, srcStr: string, destStr: string, opts: CpSyncOptions | CpOptions): void {
  // Detect src ⊂ dest cycle (if dest path starts with srcStr + separator)
  const sep = srcStr.endsWith('/') ? '' : '/';
  if (destStr.startsWith(srcStr + sep) && destStr !== srcStr) {
    throw makeSYMLINKLOOP(srcStr, destStr);
  }

  // Create dest directory if it doesn't exist
  if (!destFile.query_exists(null)) {
    try {
      destFile.make_directory_with_parents(null);
    } catch (err: unknown) {
      throw createNodeError(err, 'mkdir', destStr);
    }
  } else {
    // dest exists — must be a directory
    try {
      const destInfo = destFile.query_info('standard::type', Gio.FileQueryInfoFlags.NONE, null);
      if (destInfo.get_file_type() !== Gio.FileType.DIRECTORY) {
        throw makeENOTDIR(destStr, srcStr);
      }
    } catch (e: any) {
      if (typeof e.code === 'string') throw e;
    }
  }

  // Enumerate children
  let enumerator: Gio.FileEnumerator;
  try {
    enumerator = srcFile.enumerate_children(
      'standard::name,standard::type,standard::is-symlink',
      opts.dereference ? Gio.FileQueryInfoFlags.NONE : Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
  } catch (err: unknown) {
    throw createNodeError(err, 'scandir', srcStr);
  }

  let childInfo = enumerator.next_file(null);
  while (childInfo !== null) {
    const name = childInfo.get_name();
    const childSrc = join(srcStr, name);
    const childDest = join(destStr, name);

    const filter = (opts as CpSyncOptions).filter;
    if (filter && !filter(childSrc, childDest)) {
      childInfo = enumerator.next_file(null);
      continue;
    }

    cpSyncInternal(childSrc, childDest, opts);
    childInfo = enumerator.next_file(null);
  }
}

function cpSyncInternal(srcStr: string, destStr: string, opts: CpSyncOptions | CpOptions): void {
  const srcFile = Gio.File.new_for_path(srcStr);
  const destFile = Gio.File.new_for_path(destStr);

  let info: Gio.FileInfo;
  try {
    info = srcFile.query_info(
      'standard::type,standard::is-symlink',
      opts.dereference ? Gio.FileQueryInfoFlags.NONE : Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
  } catch (err: unknown) {
    throw createNodeError(err, 'stat', srcStr);
  }

  const type = info.get_file_type();

  if (type === Gio.FileType.DIRECTORY) {
    if (!opts.recursive) throw makeEISDIR(srcStr);
    cpOneDirSync(srcFile, destFile, srcStr, destStr, opts);
  } else {
    copyOneSyncFile(srcFile, destFile, srcStr, destStr, opts);
  }
}

// ─── Public API ──────────────────────────────────────────────────────────────

export function cpSync(src: PathLike, dest: PathLike, options?: CpSyncOptions): void {
  const srcStr = normalizePath(src);
  const destStr = normalizePath(dest);
  const opts: CpSyncOptions = options ?? {};

  const srcFile = Gio.File.new_for_path(srcStr);

  // Apply top-level filter before doing anything
  const filter = opts.filter;
  if (filter && !filter(srcStr, destStr)) return;

  // Check src is a directory without recursive option
  try {
    const info = srcFile.query_info(
      'standard::type',
      opts.dereference ? Gio.FileQueryInfoFlags.NONE : Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
    if (info.get_file_type() === Gio.FileType.DIRECTORY && !opts.recursive) {
      throw makeEISDIR(srcStr);
    }
  } catch (e: any) {
    if (typeof e.code === 'string') throw e;
    throw createNodeError(e, 'stat', srcStr);
  }

  cpSyncInternal(srcStr, destStr, opts);
}

export function cp(
  src: PathLike,
  dest: PathLike,
  options: CpOptions | ((err: NodeJS.ErrnoException | null) => void),
  callback?: (err: NodeJS.ErrnoException | null) => void,
): void {
  let opts: CpOptions;
  let cb: (err: NodeJS.ErrnoException | null) => void;

  if (typeof options === 'function') {
    cb = options;
    opts = {};
  } else {
    cb = callback!;
    opts = options;
  }

  const asyncFilter = opts.filter;
  if (asyncFilter) {
    // Wrap async filter through a sync-compatible adapter by running
    // a mini async pipeline: resolve filter for each entry, then cpSync.
    // For simplicity, resolve the top-level filter and then run cpSync
    // with a synchronous shim. Full async recursive filtering uses the
    // promise variant.
    Promise.resolve(asyncFilter(normalizePath(src), normalizePath(dest))).then((include) => {
      if (!include) { cb(null); return; }
      try {
        // For directories, we must run asynchronously through promises.cp
        cpPromises(src, dest, opts).then(() => cb(null)).catch(cb);
      } catch (e: any) {
        cb(e);
      }
    }).catch(cb);
    return;
  }

  // No async filter — use synchronous implementation on next tick
  Promise.resolve().then(() => {
    try {
      cpSync(src, dest, opts as CpSyncOptions);
      cb(null);
    } catch (e: any) {
      cb(e);
    }
  });
}

// ─── promises.cp ─────────────────────────────────────────────────────────────

async function cpPromisesDir(srcStr: string, destStr: string, opts: CpOptions): Promise<void> {
  const sep = srcStr.endsWith('/') ? '' : '/';
  if (destStr.startsWith(srcStr + sep) && destStr !== srcStr) {
    throw makeSYMLINKLOOP(srcStr, destStr);
  }

  const destFile = Gio.File.new_for_path(destStr);
  if (!destFile.query_exists(null)) {
    try {
      destFile.make_directory_with_parents(null);
    } catch (err: unknown) {
      throw createNodeError(err, 'mkdir', destStr);
    }
  }

  const srcFile = Gio.File.new_for_path(srcStr);
  let enumerator: Gio.FileEnumerator;
  try {
    enumerator = srcFile.enumerate_children(
      'standard::name,standard::type',
      opts.dereference ? Gio.FileQueryInfoFlags.NONE : Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
  } catch (err: unknown) {
    throw createNodeError(err, 'scandir', srcStr);
  }

  let childInfo = enumerator.next_file(null);
  while (childInfo !== null) {
    const name = childInfo.get_name();
    const childSrc = join(srcStr, name);
    const childDest = join(destStr, name);

    const filter = opts.filter;
    if (filter) {
      const include = await Promise.resolve(filter(childSrc, childDest));
      if (!include) {
        childInfo = enumerator.next_file(null);
        continue;
      }
    }

    await cpPromises(childSrc, childDest, opts);
    childInfo = enumerator.next_file(null);
  }
}

async function cpPromises(src: PathLike, dest: PathLike, opts: CpOptions = {}): Promise<void> {
  const srcStr = normalizePath(src);
  const destStr = normalizePath(dest);

  const srcFile = Gio.File.new_for_path(srcStr);
  let info: Gio.FileInfo;
  try {
    info = srcFile.query_info(
      'standard::type',
      opts.dereference ? Gio.FileQueryInfoFlags.NONE : Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
      null,
    );
  } catch (err: unknown) {
    throw createNodeError(err, 'stat', srcStr);
  }

  if (info.get_file_type() === Gio.FileType.DIRECTORY) {
    if (!opts.recursive) throw makeEISDIR(srcStr);
    await cpPromisesDir(srcStr, destStr, opts);
  } else {
    const destFile = Gio.File.new_for_path(destStr);
    copyOneSyncFile(srcFile, destFile, srcStr, destStr, opts);
  }
}

export { cpPromises as cpAsync };
