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

/**
 * `lchmod` is not implemented — and the shape of "not implemented" is the whole
 * point, because portable code already has a way to ask.
 *
 * Node does not DEFINE `fs.lchmodSync` or `fs.lchmod` where the platform has no
 * `O_SYMLINK` — on Linux both properties are `undefined` (measured against
 * v24.15.0) — while `fsPromises.lchmod` exists everywhere and throws
 * `ERR_METHOD_NOT_IMPLEMENTED`. So the standard guard is
 * `typeof fs.lchmodSync === 'function'`, and there are exactly three things the
 * property can be:
 *
 *   - a working function        — what a darwin build gets;
 *   - ABSENT                    — what the guard is written for: it skips, and
 *                                 the caller's copy/permission routine carries
 *                                 on;
 *   - present and THROWING      — a third behaviour neither Node nor the code
 *                                 this redesign started from has. The guard
 *                                 ENTERS and the caller aborts.
 *
 * The empty body that was here first was wrong for the opposite reason: a
 * request to RESTRICT permissions returned normally having changed nothing,
 * which is the same silent-non-restriction class as the dropped `mode` this
 * redesign exists to close. Round 2 replaced it with the throw, which trades a
 * silent non-restriction for a broken feature test. Absent is the answer that
 * is true and that the ecosystem's guard already handles.
 *
 * `@gjsify/fs` has no route to `lchmod(2)` on ANY platform — Gio can set
 * `unix::mode` with `NOFOLLOW_SYMLINKS`, but Linux itself refuses to change a
 * symlink's mode, and there is no `O_SYMLINK` open to hand a mode to — so the
 * property is absent everywhere rather than per-platform. The names stay
 * EXPORTED (as `undefined`) so a consumer re-exporting the module wholesale
 * still resolves them, exactly as `import { lchmodSync } from 'node:fs'`
 * resolves to `undefined` on Node/Linux.
 */
function lchmodUnsupported(): NodeJS.ErrnoException {
    const err = new Error('The lchmod() method is not implemented') as NodeJS.ErrnoException;
    err.code = 'ERR_METHOD_NOT_IMPLEMENTED';
    return err;
}

export const lchmodSync: ((path: PathLike, mode: number) => void) | undefined = undefined;

export const lchmod:
    | ((path: PathLike, mode: number, callback: (err: NodeJS.ErrnoException | null) => void) => void)
    | undefined = undefined;

/**
 * The one spelling Node defines on every platform — and it throws there too, so
 * this is the only lchmod surface that keeps a body.
 */
export async function lchmodAsync(_path: PathLike, _mode: number): Promise<void> {
    throw lchmodUnsupported();
}
