// Reference: Node.js lib/fs.js (utimes/lutimes/lchown/lchmod)
// Reimplemented for GJS using Gio.FileInfo timestamp attributes

import GLib from '@girs/glib-2.0';
import Gio from '@girs/gio-2.0';
import { normalizePath } from './utils.js';

import type { PathLike, TimeLike } from 'node:fs';

function toGLibDateTime(t: TimeLike): GLib.DateTime {
    const ms =
        t instanceof Date
            ? t.getTime()
            : typeof t === 'bigint'
              ? Number(t)
              : typeof t === 'string'
                ? Date.parse(t)
                : t * 1000; // Node accepts float seconds
    return GLib.DateTime.new_from_unix_utc(Math.floor(ms / 1000));
}

function setTimestamps(path: string, atime: TimeLike, mtime: TimeLike, flags: Gio.FileQueryInfoFlags): void {
    const file = Gio.File.new_for_path(path);
    const info = new Gio.FileInfo();
    info.set_modification_date_time(toGLibDateTime(mtime));
    info.set_access_date_time(toGLibDateTime(atime));
    file.set_attributes_from_info(info, flags, null);
}

// ─── utimes ───────────────────────────────────────────────────────────────────

export function utimesSync(path: PathLike, atime: TimeLike, mtime: TimeLike): void {
    setTimestamps(normalizePath(path), atime, mtime, Gio.FileQueryInfoFlags.NONE);
}

export function utimes(
    path: PathLike,
    atime: TimeLike,
    mtime: TimeLike,
    callback: (err: NodeJS.ErrnoException | null) => void,
): void {
    Promise.resolve()
        .then(() => utimesSync(path, atime, mtime))
        .then(() => callback(null), callback);
}

export async function utimesAsync(path: PathLike, atime: TimeLike, mtime: TimeLike): Promise<void> {
    utimesSync(path, atime, mtime);
}

// ─── lutimes ──────────────────────────────────────────────────────────────────

export function lutimesSync(path: PathLike, atime: TimeLike, mtime: TimeLike): void {
    setTimestamps(normalizePath(path), atime, mtime, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS);
}

export function lutimes(
    path: PathLike,
    atime: TimeLike,
    mtime: TimeLike,
    callback: (err: NodeJS.ErrnoException | null) => void,
): void {
    Promise.resolve()
        .then(() => lutimesSync(path, atime, mtime))
        .then(() => callback(null), callback);
}

export async function lutimesAsync(path: PathLike, atime: TimeLike, mtime: TimeLike): Promise<void> {
    lutimesSync(path, atime, mtime);
}

// ─── lchown ───────────────────────────────────────────────────────────────────
// NOFOLLOW_SYMLINKS changes the ownership of the symlink itself, not its
// target — the Gio equivalent of `chown -h`. The previous impl shelled out
// with unquoted paths (broken on spaces, command-injection hazard) and
// swallowed every failure.

export function lchownSync(path: PathLike, uid: number, gid: number): void {
    const pathStr = normalizePath(path);
    const file = Gio.File.new_for_path(pathStr);
    const info = new Gio.FileInfo();
    if (uid !== -1) info.set_attribute_uint32('unix::uid', uid);
    if (gid !== -1) info.set_attribute_uint32('unix::gid', gid);
    file.set_attributes_from_info(info, Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS, null);
}

export function lchown(
    path: PathLike,
    uid: number,
    gid: number,
    callback: (err: NodeJS.ErrnoException | null) => void,
): void {
    Promise.resolve()
        .then(() => lchownSync(path, uid, gid))
        .then(() => callback(null), callback);
}

export async function lchownAsync(path: PathLike, uid: number, gid: number): Promise<void> {
    lchownSync(path, uid, gid);
}

// ─── lchmod ───────────────────────────────────────────────────────────────────

/**
 * `lchmod` is not implemented, and now it SAYS so.
 *
 * The comment this replaces claimed the empty body "mirrors Node.js behavior on
 * Linux". It does not. Node does not define `fs.lchmodSync` or `fs.lchmod` on
 * Linux at all — both are `undefined`, so the caller gets a TypeError — and
 * `fsPromises.lchmod` does exist but throws `ERR_METHOD_NOT_IMPLEMENTED`
 * (measured against v24.15.0). Every one of those spellings tells the caller.
 *
 * An empty body does the opposite: a request to RESTRICT permissions returns
 * normally having changed nothing. That is the same silent-non-restriction
 * class as the dropped `mode` this redesign exists to close, and the quietest
 * member of it — there is not even a wrong mode left on disk to notice later.
 *
 * They throw rather than being deleted because the export list and the
 * `node:fs` type surface are load-bearing for consumers that re-export the
 * module wholesale, and a throw is exactly what the one spelling Node DOES
 * define already does.
 */
function lchmodUnsupported(): NodeJS.ErrnoException {
    const err = new Error('The lchmod() method is not implemented') as NodeJS.ErrnoException;
    err.code = 'ERR_METHOD_NOT_IMPLEMENTED';
    return err;
}

export function lchmodSync(_path: PathLike, _mode: number): void {
    throw lchmodUnsupported();
}

export function lchmod(_path: PathLike, _mode: number, callback: (err: NodeJS.ErrnoException | null) => void): void {
    callback(lchmodUnsupported());
}

export async function lchmodAsync(_path: PathLike, _mode: number): Promise<void> {
    throw lchmodUnsupported();
}
