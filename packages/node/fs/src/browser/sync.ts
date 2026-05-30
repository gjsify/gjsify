// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// Synchronous Node `fs.*Sync` surface. Every function delegates to the
// default `Volume` and wraps the result in the relevant Node-shaped class
// (Stats / Dirent / etc.).

import { absolutise, __defaultVolume as vol } from './volume.js';
import { BigIntStats, Dirent, Stats } from './types.js';
import { dirname, resolve } from './path-utils.js';

type PathLike = string | URL | { toString(): string };
type BufferLike = Uint8Array | { buffer: ArrayBufferLike; byteOffset?: number; byteLength?: number };
type Encoding = 'utf8' | 'utf-8' | 'ascii' | 'binary' | 'base64' | 'hex' | null;

export interface ReadFileOpts { encoding?: Encoding; flag?: string }
export interface WriteFileOpts { encoding?: Encoding; mode?: number; flag?: string }
export interface MkdirOpts { recursive?: boolean; mode?: number }
export interface RmOpts { recursive?: boolean; force?: boolean; maxRetries?: number; retryDelay?: number }
export interface StatOpts { bigint?: boolean; throwIfNoEntry?: boolean }

function toBytes(input: string | BufferLike, encoding?: Encoding): Uint8Array {
    if (typeof input === 'string') {
        if (!encoding || encoding === 'utf8' || encoding === 'utf-8') return new TextEncoder().encode(input);
        if (encoding === 'ascii' || encoding === 'binary') {
            const arr = new Uint8Array(input.length);
            for (let i = 0; i < input.length; i++) arr[i] = input.charCodeAt(i) & 0xff;
            return arr;
        }
        if (encoding === 'base64') {
            const bin = atob(input);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return arr;
        }
        if (encoding === 'hex') {
            const arr = new Uint8Array(input.length / 2);
            for (let i = 0; i < arr.length; i++) arr[i] = parseInt(input.slice(i * 2, i * 2 + 2), 16);
            return arr;
        }
        return new TextEncoder().encode(input);
    }
    if (input instanceof Uint8Array) return input;
    return new Uint8Array(input.buffer, input.byteOffset ?? 0, input.byteLength ?? input.buffer.byteLength);
}

function decodeBytes(bytes: Uint8Array, encoding?: Encoding | string): string | Uint8Array {
    if (!encoding) return bytes;
    if (encoding === 'utf8' || encoding === 'utf-8') return new TextDecoder('utf-8').decode(bytes);
    if (encoding === 'ascii' || encoding === 'binary') {
        let s = '';
        for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
        return s;
    }
    if (encoding === 'base64') {
        let s = '';
        for (let i = 0; i < bytes.byteLength; i++) s += String.fromCharCode(bytes[i]);
        return btoa(s);
    }
    if (encoding === 'hex') {
        let s = '';
        for (let i = 0; i < bytes.byteLength; i++) s += bytes[i].toString(16).padStart(2, '0');
        return s;
    }
    return new TextDecoder('utf-8').decode(bytes);
}

function statsFor(path: PathLike, fields: ReturnType<typeof vol.statSync>, opts?: StatOpts): Stats | BigIntStats {
    return opts?.bigint ? new BigIntStats(fields) : new Stats(fields);
}

// ───────────── readFile / writeFile / appendFile ─────────────────────────────

export function readFileSync(path: PathLike, opts?: Encoding | ReadFileOpts): string | Uint8Array {
    const bytes = vol.readFileSync(absolutise(path));
    const enc = typeof opts === 'string' ? opts : opts?.encoding;
    return decodeBytes(bytes, enc ?? null);
}

export function writeFileSync(path: PathLike, data: string | BufferLike, opts?: Encoding | WriteFileOpts): void {
    const enc = typeof opts === 'string' ? opts : opts?.encoding;
    const mode = typeof opts === 'object' && opts ? opts.mode : undefined;
    vol.writeFileSync(absolutise(path), toBytes(data, enc), mode);
}

export function appendFileSync(path: PathLike, data: string | BufferLike, opts?: Encoding | WriteFileOpts): void {
    const enc = typeof opts === 'string' ? opts : opts?.encoding;
    const mode = typeof opts === 'object' && opts ? opts.mode : undefined;
    vol.appendFileSync(absolutise(path), toBytes(data, enc), mode);
}

// ───────────── stat / lstat / exists / access ────────────────────────────────

export function statSync(path: PathLike, opts?: StatOpts): Stats | BigIntStats | undefined {
    try { return statsFor(path, vol.statSync(absolutise(path)), opts); }
    catch (e) {
        if (opts?.throwIfNoEntry === false) return undefined;
        throw e;
    }
}

export function lstatSync(path: PathLike, opts?: StatOpts): Stats | BigIntStats | undefined {
    try { return statsFor(path, vol.lstatSync(absolutise(path)), opts); }
    catch (e) {
        if (opts?.throwIfNoEntry === false) return undefined;
        throw e;
    }
}

export function existsSync(path: PathLike): boolean {
    try { return vol.existsSync(absolutise(path)); } catch { return false; }
}

export function accessSync(path: PathLike, mode = 0): void {
    vol.accessSync(absolutise(path), mode);
}

// ───────────── Directories ───────────────────────────────────────────────────

export interface ReadDirOpts { withFileTypes?: boolean; recursive?: boolean; encoding?: string }

export function readdirSync(
    path: PathLike,
    opts?: ReadDirOpts,
): string[] | Dirent[] {
    const abs = absolutise(path);
    if (opts?.withFileTypes) {
        return vol.readdirEntriesSync(abs).map(e => new Dirent(e.name, e.kind, abs));
    }
    return vol.readdirSync(abs);
}

export function mkdirSync(path: PathLike, opts?: MkdirOpts | number): string | undefined {
    const o: MkdirOpts = typeof opts === 'number' ? { mode: opts } : opts ?? {};
    return vol.mkdirSync(absolutise(path), o);
}

export function rmdirSync(path: PathLike, opts?: { recursive?: boolean }): void {
    vol.rmdirSync(absolutise(path), opts ?? {});
}

export function rmSync(path: PathLike, opts?: RmOpts): void {
    vol.rmSync(absolutise(path), opts ?? {});
}

export function unlinkSync(path: PathLike): void {
    vol.unlinkSync(absolutise(path));
}

// ───────────── Move / copy / link ────────────────────────────────────────────

export function renameSync(oldPath: PathLike, newPath: PathLike): void {
    vol.renameSync(absolutise(oldPath), absolutise(newPath));
}

export function copyFileSync(src: PathLike, dest: PathLike, flags = 0): void {
    vol.copyFileSync(absolutise(src), absolutise(dest), flags);
}

export function linkSync(existingPath: PathLike, newPath: PathLike): void {
    vol.linkSync(absolutise(existingPath), absolutise(newPath));
}

// ───────────── Symlinks (limited) ────────────────────────────────────────────

export function symlinkSync(target: PathLike, linkPath: PathLike): void {
    vol.symlinkSync(typeof target === 'string' ? target : target.toString(), absolutise(linkPath));
}

export function readlinkSync(path: PathLike): string {
    return vol.readlinkSync(absolutise(path));
}

export function realpathSync(path: PathLike): string {
    return vol.realpathSync(absolutise(path));
}
// `realpath.native` parity — Node ships this — alias to the same impl.
(realpathSync as { native?: typeof realpathSync }).native = realpathSync;

// ───────────── Metadata ──────────────────────────────────────────────────────

export function chmodSync(path: PathLike, mode: number): void {
    vol.chmodSync(absolutise(path), mode);
}

export function chownSync(path: PathLike, uid: number, gid: number): void {
    vol.chownSync(absolutise(path), uid, gid);
}

export function truncateSync(path: PathLike, len = 0): void {
    vol.truncateSync(absolutise(path), len);
}

export function utimesSync(path: PathLike, atime: number | Date, mtime: number | Date): void {
    const a = atime instanceof Date ? atime.getTime() : atime * 1000;
    const m = mtime instanceof Date ? mtime.getTime() : mtime * 1000;
    vol.utimesSync(absolutise(path), a, m);
}

// ───────────── mkdtemp ───────────────────────────────────────────────────────

export function mkdtempSync(prefix: string): string {
    const suffix = Math.floor(Math.random() * 1e10).toString(36) + Date.now().toString(36).slice(-4);
    const path = prefix + suffix.slice(0, 6);
    const abs = resolve(path);
    vol.mkdirSync(dirname(abs), { recursive: true });
    vol.mkdirSync(abs);
    return abs;
}

// ───────────── File descriptors ──────────────────────────────────────────────

export function openSync(path: PathLike, flags = 'r', mode = 0o666): number {
    return vol.openSync(absolutise(path), flags, mode);
}

export function closeSync(fd: number): void { vol.closeSync(fd); }

export function readSync(
    fd: number,
    buf: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
): number {
    return vol.readSync(fd, buf, offset, length, position);
}

export function writeSync(
    fd: number,
    buf: Uint8Array | string,
    offsetOrPos?: number | null,
    lengthOrEnc?: number | string,
    position?: number | null,
): number {
    const bytes = typeof buf === 'string'
        ? new TextEncoder().encode(buf)
        : buf;
    if (typeof buf === 'string') {
        // (fd, string, position?, encoding?) — Node overload
        const pos = (offsetOrPos as number | null | undefined) ?? null;
        return vol.writeSync(fd, bytes, 0, bytes.byteLength, pos);
    }
    return vol.writeSync(fd, bytes, offsetOrPos ?? 0, (lengthOrEnc as number) ?? bytes.byteLength, position ?? null);
}

// ───────────── Watching (stub) ───────────────────────────────────────────────

// `watch` lives in stream.ts (it's stream-shaped); placeholder re-export there.
