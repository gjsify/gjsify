// Reference: Node.js lib/fs.js (fd-based ops, readSync, writeSync, readv, writev, exists, openAsBlob)
// Reimplemented for GJS using FileHandle + Gio streams

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { FileHandle } from './file-handle.js';
import { Stats, BigIntStats } from './stats.js';
import { statSync, truncateSync, chmodSync, chownSync, readFileSync } from './sync.js';
import { utimesSync } from './utimes.js';
import { normalizePath } from './utils.js';

import type { PathLike, TimeLike, StatOptions } from 'node:fs';

function getFH(fd: number | FileHandle): FileHandle {
  if (fd instanceof FileHandle) return FileHandle.getInstance(fd.fd);
  return FileHandle.getInstance(fd as number);
}

// ─── fstat ────────────────────────────────────────────────────────────────────

export function fstatSync(fd: number, options?: { bigint?: false }): Stats;
export function fstatSync(fd: number, options: { bigint: true }): BigIntStats;
export function fstatSync(fd: number, options?: { bigint?: boolean }): Stats | BigIntStats {
  return statSync(normalizePath(getFH(fd).options.path), options as any);
}

export function fstat(fd: number, callback: (err: NodeJS.ErrnoException | null, stats: Stats) => void): void;
export function fstat(fd: number, options: StatOptions, callback: (err: NodeJS.ErrnoException | null, stats: Stats | BigIntStats) => void): void;
export function fstat(fd: number, optionsOrCb: any, callback?: any): void {
  if (typeof optionsOrCb === 'function') { callback = optionsOrCb; optionsOrCb = {}; }
  Promise.resolve()
    .then(() => fstatSync(fd, optionsOrCb))
    .then(s => callback(null, s), callback);
}

export async function fstatAsync(fd: number, options?: StatOptions): Promise<Stats | BigIntStats> {
  return fstatSync(fd, options as any);
}

// ─── ftruncate ────────────────────────────────────────────────────────────────

export function ftruncateSync(fd: number, len = 0): void {
  truncateSync(normalizePath(getFH(fd).options.path), len);
}

export function ftruncate(fd: number, callback: (err: NodeJS.ErrnoException | null) => void): void;
export function ftruncate(fd: number, len: number, callback: (err: NodeJS.ErrnoException | null) => void): void;
export function ftruncate(fd: number, lenOrCb: any, callback?: any): void {
  if (typeof lenOrCb === 'function') { callback = lenOrCb; lenOrCb = 0; }
  Promise.resolve()
    .then(() => ftruncateSync(fd, lenOrCb))
    .then(() => callback(null), callback);
}

export async function ftruncateAsync(fd: number, len = 0): Promise<void> {
  ftruncateSync(fd, len);
}

// ─── fdatasync / fsync ────────────────────────────────────────────────────────
// Best-effort: flush the IOChannel write buffer (equivalent to fdatasync on GJS).

export function fdatasyncSync(fd: number): void { getFH(fd)._flushSync(); }
export function fdatasync(fd: number, callback: (err: NodeJS.ErrnoException | null) => void): void {
  Promise.resolve().then(() => fdatasyncSync(fd)).then(() => callback(null), callback);
}
export async function fdatasyncAsync(fd: number): Promise<void> { fdatasyncSync(fd); }

export function fsyncSync(fd: number): void { getFH(fd)._flushSync(); }
export function fsync(fd: number, callback: (err: NodeJS.ErrnoException | null) => void): void {
  Promise.resolve().then(() => fsyncSync(fd)).then(() => callback(null), callback);
}
export async function fsyncAsync(fd: number): Promise<void> { fsyncSync(fd); }

// ─── fchmod / fchown / futimes ────────────────────────────────────────────────

export function fchmodSync(fd: number, mode: number | string): void {
  chmodSync(normalizePath(getFH(fd).options.path), mode);
}
export function fchmod(fd: number, mode: number | string, callback: (err: NodeJS.ErrnoException | null) => void): void {
  Promise.resolve().then(() => fchmodSync(fd, mode)).then(() => callback(null), callback);
}
export async function fchmodAsync(fd: number, mode: number | string): Promise<void> { fchmodSync(fd, mode); }

export function fchownSync(fd: number, uid: number, gid: number): void {
  chownSync(normalizePath(getFH(fd).options.path), uid, gid);
}
export function fchown(fd: number, uid: number, gid: number, callback: (err: NodeJS.ErrnoException | null) => void): void {
  Promise.resolve().then(() => fchownSync(fd, uid, gid)).then(() => callback(null), callback);
}
export async function fchownAsync(fd: number, uid: number, gid: number): Promise<void> { fchownSync(fd, uid, gid); }

export function futimesSync(fd: number, atime: TimeLike, mtime: TimeLike): void {
  utimesSync(normalizePath(getFH(fd).options.path), atime, mtime);
}
export function futimes(fd: number, atime: TimeLike, mtime: TimeLike, callback: (err: NodeJS.ErrnoException | null) => void): void {
  Promise.resolve().then(() => futimesSync(fd, atime, mtime)).then(() => callback(null), callback);
}
export async function futimesAsync(fd: number, atime: TimeLike, mtime: TimeLike): Promise<void> { futimesSync(fd, atime, mtime); }

// ─── closeSync ────────────────────────────────────────────────────────────────

export function closeSync(fd: number): void {
  getFH(fd)._closeSync();
}

// ─── readSync ─────────────────────────────────────────────────────────────────

export function readSync(
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offset?: number | null,
  length?: number | null,
  position?: number | null,
): number;
export function readSync(
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  options: { offset?: number; length?: number; position?: number | null },
): number;
export function readSync(
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offsetOrOptions?: number | null | { offset?: number; length?: number; position?: number | null },
  length?: number | null,
  position?: number | null,
): number {
  let offset = 0;
  if (offsetOrOptions !== null && typeof offsetOrOptions === 'object') {
    offset = (offsetOrOptions as any).offset ?? 0;
    length = (offsetOrOptions as any).length ?? buffer.byteLength;
    position = (offsetOrOptions as any).position ?? null;
  } else {
    offset = (offsetOrOptions as number | null | undefined) ?? 0;
    length = length ?? buffer.byteLength - offset;
  }
  return getFH(fd)._readSync(buffer, offset, length!, position ?? null);
}

// ─── writeSync ────────────────────────────────────────────────────────────────

export function writeSync(
  fd: number,
  buffer: NodeJS.ArrayBufferView,
  offset?: number | null,
  length?: number | null,
  position?: number | null,
): number;
export function writeSync(
  fd: number,
  string: string,
  position?: number | null,
  encoding?: BufferEncoding | null,
): number;
export function writeSync(
  fd: number,
  bufferOrString: NodeJS.ArrayBufferView | string,
  offsetOrPosition?: number | null,
  lengthOrEncoding?: number | string | null,
  position?: number | null,
): number {
  let data: Uint8Array;
  if (typeof bufferOrString === 'string') {
    data = new TextEncoder().encode(bufferOrString);
    if (typeof offsetOrPosition === 'number') position = offsetOrPosition;
  } else {
    const offset = (typeof offsetOrPosition === 'number' ? offsetOrPosition : 0);
    const len = (typeof lengthOrEncoding === 'number' ? lengthOrEncoding : bufferOrString.byteLength - offset);
    data = new Uint8Array((bufferOrString as any).buffer, (bufferOrString as any).byteOffset + offset, len);
  }
  return getFH(fd)._writeSync(data, position ?? null);
}

// ─── readvSync / readv ────────────────────────────────────────────────────────

export function readvSync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | null): number {
  let bytesRead = 0;
  for (const buf of buffers) {
    const n = readSync(fd, buf, 0, buf.byteLength, position != null ? position + bytesRead : null);
    bytesRead += n;
    if (n < buf.byteLength) break;
  }
  return bytesRead;
}

export function readv(
  fd: number,
  buffers: NodeJS.ArrayBufferView[],
  callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void;
export function readv(
  fd: number,
  buffers: NodeJS.ArrayBufferView[],
  position: number | null,
  callback: (err: NodeJS.ErrnoException | null, bytesRead: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void;
export function readv(fd: number, buffers: NodeJS.ArrayBufferView[], positionOrCb: any, callback?: any): void {
  if (typeof positionOrCb === 'function') { callback = positionOrCb; positionOrCb = null; }
  Promise.resolve()
    .then(() => ({ bytesRead: readvSync(fd, buffers, positionOrCb), buffers }))
    .then(r => callback(null, r.bytesRead, r.buffers), callback);
}

export async function readvAsync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | null) {
  return { bytesRead: readvSync(fd, buffers, position), buffers };
}

// ─── writevSync / writev ──────────────────────────────────────────────────────

export function writevSync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | null): number {
  let bytesWritten = 0;
  for (const buf of buffers) {
    const n = writeSync(fd, buf, 0, buf.byteLength, position != null ? position + bytesWritten : null);
    bytesWritten += n;
  }
  return bytesWritten;
}

export function writev(
  fd: number,
  buffers: NodeJS.ArrayBufferView[],
  callback: (err: NodeJS.ErrnoException | null, bytesWritten: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void;
export function writev(
  fd: number,
  buffers: NodeJS.ArrayBufferView[],
  position: number | null,
  callback: (err: NodeJS.ErrnoException | null, bytesWritten: number, buffers: NodeJS.ArrayBufferView[]) => void,
): void;
export function writev(fd: number, buffers: NodeJS.ArrayBufferView[], positionOrCb: any, callback?: any): void {
  if (typeof positionOrCb === 'function') { callback = positionOrCb; positionOrCb = null; }
  Promise.resolve()
    .then(() => ({ bytesWritten: writevSync(fd, buffers, positionOrCb), buffers }))
    .then(r => callback(null, r.bytesWritten, r.buffers), callback);
}

export async function writevAsync(fd: number, buffers: NodeJS.ArrayBufferView[], position?: number | null) {
  return { bytesWritten: writevSync(fd, buffers, position), buffers };
}

// ─── exists (deprecated) ──────────────────────────────────────────────────────

export function exists(path: PathLike, callback: (exists: boolean) => void): void {
  try { statSync(normalizePath(path)); callback(true); } catch { callback(false); }
}

// ─── openAsBlob ───────────────────────────────────────────────────────────────

export async function openAsBlob(path: PathLike, options?: { type?: string }): Promise<Blob> {
  const data = readFileSync(normalizePath(path)) as unknown as ArrayBuffer;
  return new Blob([data], { type: options?.type ?? '' });
}
