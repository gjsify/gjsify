// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// Callback API surface. Every function wraps the matching sync impl on a
// `queueMicrotask` to preserve Node's "always async" callback semantics and
// surface errors via the `(err, value)` callback contract.

import * as sync from './sync.js';
import type { Stats, BigIntStats, Dirent } from './types.js';

type ErrCb<T = void> = (err: NodeJS.ErrnoException | null, value?: T) => void;

function defer<T>(impl: () => T, cb?: ErrCb<T>): void {
    queueMicrotask(() => {
        try {
            cb?.(null, impl());
        } catch (e) {
            cb?.(e as NodeJS.ErrnoException);
        }
    });
}

/** Resolve a `(...args, cb)` Node-shape signature where the callback can also
 *  appear at the position of an optional preceding argument. */
function pickCb<T extends (...a: unknown[]) => unknown>(...candidates: Array<T | unknown>): T | undefined {
    for (const c of candidates) if (typeof c === 'function') return c as T;
    return undefined;
}

// ───────────── readFile / writeFile / appendFile ─────────────────────────────

export function readFile(
    path: Parameters<typeof sync.readFileSync>[0],
    optsOrCb: Parameters<typeof sync.readFileSync>[1] | ErrCb<string | Uint8Array>,
    maybeCb?: ErrCb<string | Uint8Array>,
): void {
    const cb = pickCb(optsOrCb, maybeCb) as ErrCb<string | Uint8Array> | undefined;
    const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    defer(() => sync.readFileSync(path, opts), cb);
}

export function writeFile(
    path: Parameters<typeof sync.writeFileSync>[0],
    data: Parameters<typeof sync.writeFileSync>[1],
    optsOrCb: Parameters<typeof sync.writeFileSync>[2] | ErrCb,
    maybeCb?: ErrCb,
): void {
    const cb = pickCb(optsOrCb, maybeCb) as ErrCb | undefined;
    const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    defer(() => sync.writeFileSync(path, data, opts), cb);
}

export function appendFile(
    path: Parameters<typeof sync.appendFileSync>[0],
    data: Parameters<typeof sync.appendFileSync>[1],
    optsOrCb: Parameters<typeof sync.appendFileSync>[2] | ErrCb,
    maybeCb?: ErrCb,
): void {
    const cb = pickCb(optsOrCb, maybeCb) as ErrCb | undefined;
    const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    defer(() => sync.appendFileSync(path, data, opts), cb);
}

// ───────────── stat / lstat / exists / access ────────────────────────────────

export function stat(path: Parameters<typeof sync.statSync>[0], cb?: ErrCb<Stats | BigIntStats | undefined>): void {
    defer(() => sync.statSync(path), cb);
}
export function lstat(path: Parameters<typeof sync.lstatSync>[0], cb?: ErrCb<Stats | BigIntStats | undefined>): void {
    defer(() => sync.lstatSync(path), cb);
}
export function exists(path: Parameters<typeof sync.existsSync>[0], cb?: (exists: boolean) => void): void {
    queueMicrotask(() => cb?.(sync.existsSync(path)));
}
export function access(path: Parameters<typeof sync.accessSync>[0], modeOrCb?: number | ErrCb, maybeCb?: ErrCb): void {
    const cb = pickCb(modeOrCb, maybeCb) as ErrCb | undefined;
    const mode = typeof modeOrCb === 'number' ? modeOrCb : 0;
    defer(() => sync.accessSync(path, mode), cb);
}

// ───────────── Directories ───────────────────────────────────────────────────

export function readdir(
    path: Parameters<typeof sync.readdirSync>[0],
    optsOrCb: Parameters<typeof sync.readdirSync>[1] | ErrCb<string[] | Dirent[]>,
    maybeCb?: ErrCb<string[] | Dirent[]>,
): void {
    const cb = pickCb(optsOrCb, maybeCb) as ErrCb<string[] | Dirent[]> | undefined;
    const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    defer(() => sync.readdirSync(path, opts), cb);
}

export function mkdir(
    path: Parameters<typeof sync.mkdirSync>[0],
    optsOrCb: Parameters<typeof sync.mkdirSync>[1] | ErrCb<string | undefined>,
    maybeCb?: ErrCb<string | undefined>,
): void {
    const cb = pickCb(optsOrCb, maybeCb) as ErrCb<string | undefined> | undefined;
    const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    defer(() => sync.mkdirSync(path, opts), cb);
}

export function rmdir(
    path: Parameters<typeof sync.rmdirSync>[0],
    optsOrCb: Parameters<typeof sync.rmdirSync>[1] | ErrCb,
    maybeCb?: ErrCb,
): void {
    const cb = pickCb(optsOrCb, maybeCb) as ErrCb | undefined;
    const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    defer(() => sync.rmdirSync(path, opts), cb);
}

export function rm(
    path: Parameters<typeof sync.rmSync>[0],
    optsOrCb: Parameters<typeof sync.rmSync>[1] | ErrCb,
    maybeCb?: ErrCb,
): void {
    const cb = pickCb(optsOrCb, maybeCb) as ErrCb | undefined;
    const opts = typeof optsOrCb === 'function' ? undefined : optsOrCb;
    defer(() => sync.rmSync(path, opts), cb);
}

export function unlink(path: Parameters<typeof sync.unlinkSync>[0], cb?: ErrCb): void {
    defer(() => sync.unlinkSync(path), cb);
}

// ───────────── Move / copy / link ────────────────────────────────────────────

export function rename(
    oldPath: Parameters<typeof sync.renameSync>[0],
    newPath: Parameters<typeof sync.renameSync>[1],
    cb?: ErrCb,
): void {
    defer(() => sync.renameSync(oldPath, newPath), cb);
}

export function copyFile(
    src: Parameters<typeof sync.copyFileSync>[0],
    dest: Parameters<typeof sync.copyFileSync>[1],
    flagsOrCb: number | ErrCb,
    maybeCb?: ErrCb,
): void {
    const cb = pickCb(flagsOrCb, maybeCb) as ErrCb | undefined;
    const flags = typeof flagsOrCb === 'number' ? flagsOrCb : 0;
    defer(() => sync.copyFileSync(src, dest, flags), cb);
}

export function link(
    existingPath: Parameters<typeof sync.linkSync>[0],
    newPath: Parameters<typeof sync.linkSync>[1],
    cb?: ErrCb,
): void {
    defer(() => sync.linkSync(existingPath, newPath), cb);
}

// ───────────── Symlinks ──────────────────────────────────────────────────────

export function symlink(
    target: Parameters<typeof sync.symlinkSync>[0],
    linkPath: Parameters<typeof sync.symlinkSync>[1],
    typeOrCb?: string | ErrCb,
    maybeCb?: ErrCb,
): void {
    const cb = pickCb(typeOrCb, maybeCb) as ErrCb | undefined;
    defer(() => sync.symlinkSync(target, linkPath), cb);
}

export function readlink(path: Parameters<typeof sync.readlinkSync>[0], cb?: ErrCb<string>): void {
    defer(() => sync.readlinkSync(path), cb);
}
export function realpath(path: Parameters<typeof sync.realpathSync>[0], cb?: ErrCb<string>): void {
    defer(() => sync.realpathSync(path), cb);
}
(realpath as { native?: typeof realpath }).native = realpath;

// ───────────── Metadata ──────────────────────────────────────────────────────

export function chmod(path: Parameters<typeof sync.chmodSync>[0], mode: number, cb?: ErrCb): void {
    defer(() => sync.chmodSync(path, mode), cb);
}
export function chown(path: Parameters<typeof sync.chownSync>[0], uid: number, gid: number, cb?: ErrCb): void {
    defer(() => sync.chownSync(path, uid, gid), cb);
}
export function truncate(
    path: Parameters<typeof sync.truncateSync>[0],
    lenOrCb?: number | ErrCb,
    maybeCb?: ErrCb,
): void {
    const cb = pickCb(lenOrCb, maybeCb) as ErrCb | undefined;
    const len = typeof lenOrCb === 'number' ? lenOrCb : 0;
    defer(() => sync.truncateSync(path, len), cb);
}
export function utimes(
    path: Parameters<typeof sync.utimesSync>[0],
    atime: number | Date,
    mtime: number | Date,
    cb?: ErrCb,
): void {
    defer(() => sync.utimesSync(path, atime, mtime), cb);
}
export function mkdtemp(prefix: string, cb?: ErrCb<string>): void {
    defer(() => sync.mkdtempSync(prefix), cb);
}

// ───────────── File descriptors ──────────────────────────────────────────────

export function open(
    path: Parameters<typeof sync.openSync>[0],
    flagsOrCb?: string | ErrCb<number>,
    modeOrCb?: number | ErrCb<number>,
    maybeCb?: ErrCb<number>,
): void {
    const cb = pickCb(flagsOrCb, modeOrCb, maybeCb) as ErrCb<number> | undefined;
    const flags = typeof flagsOrCb === 'string' ? flagsOrCb : 'r';
    const mode = typeof modeOrCb === 'number' ? modeOrCb : 0o666;
    defer(() => sync.openSync(path, flags, mode), cb);
}

export function close(fd: number, cb?: ErrCb): void {
    defer(() => sync.closeSync(fd), cb);
}

export function read(
    fd: number,
    buf: Uint8Array,
    offset: number,
    length: number,
    position: number | null,
    cb?: (err: NodeJS.ErrnoException | null, bytesRead: number, buffer: Uint8Array) => void,
): void {
    queueMicrotask(() => {
        try {
            const n = sync.readSync(fd, buf, offset, length, position);
            cb?.(null, n, buf);
        } catch (e) {
            cb?.(e as NodeJS.ErrnoException, 0, buf);
        }
    });
}

export function write(
    fd: number,
    buf: Uint8Array | string,
    offsetOrCb?: number | ErrCb<number>,
    lengthOrEnc?: number | string,
    positionOrCb?: number | null | ErrCb<number>,
    maybeCb?: ErrCb<number>,
): void {
    const cb = pickCb(offsetOrCb, positionOrCb, maybeCb) as ErrCb<number> | undefined;
    const offset = typeof offsetOrCb === 'number' ? offsetOrCb : 0;
    const length = typeof lengthOrEnc === 'number' ? lengthOrEnc : undefined;
    const position: number | null =
        typeof positionOrCb === 'number' ? positionOrCb : positionOrCb === null ? null : null;
    queueMicrotask(() => {
        try {
            const n = sync.writeSync(fd, buf, offset, length, position);
            cb?.(null, n);
        } catch (e) {
            cb?.(e as NodeJS.ErrnoException, 0);
        }
    });
}
