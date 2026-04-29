// Reference: Node.js lib/fs.js (fs.statfs / fs.promises.statfs)
// Reimplemented for GJS using Gio.File.query_filesystem_info

import Gio from '@girs/gio-2.0';
import GLib from '@girs/glib-2.0';
import { normalizePath } from './utils.js';

import type { PathLike } from 'node:fs';

const FS_INFO_ATTRS = [
  'filesystem::size',
  'filesystem::free',
].join(',');

// Block size used to derive block counts from byte counts.
// Gio does not expose the real fs block size; 4096 is a safe default.
const BSIZE = 4096;

export interface StatFsResult {
  type: number;
  bsize: number;
  blocks: number;
  bfree: number;
  bavail: number;
  files: number;
  ffree: number;
}

export interface BigIntStatFsResult {
  type: bigint;
  bsize: bigint;
  blocks: bigint;
  bfree: bigint;
  bavail: bigint;
  files: bigint;
  ffree: bigint;
}

function buildStatFs(info: Gio.FileInfo): StatFsResult {
  const totalBytes = Number(info.get_attribute_uint64('filesystem::size') ?? 0);
  const freeBytes  = Number(info.get_attribute_uint64('filesystem::free') ?? 0);
  const blocks = Math.floor(totalBytes / BSIZE);
  const bfree  = Math.floor(freeBytes  / BSIZE);
  return { type: 0, bsize: BSIZE, blocks, bfree, bavail: bfree, files: 0, ffree: 0 };
}

function buildBigIntStatFs(info: Gio.FileInfo): BigIntStatFsResult {
  const totalBytes = BigInt(info.get_attribute_uint64('filesystem::size') ?? 0);
  const freeBytes  = BigInt(info.get_attribute_uint64('filesystem::free') ?? 0);
  const bsize = BigInt(BSIZE);
  const blocks = totalBytes / bsize;
  const bfree  = freeBytes  / bsize;
  return { type: 0n, bsize, blocks, bfree, bavail: bfree, files: 0n, ffree: 0n };
}

export function statfsSync(path: PathLike, options?: { bigint?: false }): StatFsResult;
export function statfsSync(path: PathLike, options: { bigint: true }): BigIntStatFsResult;
export function statfsSync(path: PathLike, options?: { bigint?: boolean }): StatFsResult | BigIntStatFsResult {
  const file = Gio.File.new_for_path(normalizePath(path));
  const info = file.query_filesystem_info(FS_INFO_ATTRS, null);
  return options?.bigint === true ? buildBigIntStatFs(info) : buildStatFs(info);
}

function queryFsInfoAsync(path: PathLike, useBigInt: boolean): Promise<StatFsResult | BigIntStatFsResult> {
  return new Promise((resolve, reject) => {
    const file = Gio.File.new_for_path(normalizePath(path));
    file.query_filesystem_info_async(FS_INFO_ATTRS, GLib.PRIORITY_DEFAULT, null, (_s: unknown, res: Gio.AsyncResult) => {
      try {
        const info = file.query_filesystem_info_finish(res);
        resolve(useBigInt ? buildBigIntStatFs(info) : buildStatFs(info));
      } catch (err) {
        reject(err);
      }
    });
  });
}

export function statfs(path: PathLike, callback: (err: NodeJS.ErrnoException | null, stats: StatFsResult) => void): void;
export function statfs(path: PathLike, options: { bigint?: false }, callback: (err: NodeJS.ErrnoException | null, stats: StatFsResult) => void): void;
export function statfs(path: PathLike, options: { bigint: true }, callback: (err: NodeJS.ErrnoException | null, stats: BigIntStatFsResult) => void): void;
export function statfs(path: PathLike, optionsOrCb: any, callback?: any): void {
  if (typeof optionsOrCb === 'function') {
    callback = optionsOrCb;
    optionsOrCb = {};
  }
  const useBigInt = optionsOrCb?.bigint === true;
  queryFsInfoAsync(path, useBigInt).then(result => callback(null, result), err => callback(err, null));
}

export async function statfsAsync(path: PathLike, options?: { bigint?: boolean }): Promise<StatFsResult | BigIntStatFsResult> {
  return queryFsInfoAsync(path, options?.bigint === true);
}
