// SPDX-License-Identifier: MIT
// Reimplemented for @gjsify browser target — inspired by memfs
// (streamich + contributors, Apache-2.0).
//
// In-memory only. No persistence (OPFS bridge is a future iteration).
// No file watching (FSWatcher is a stub). No real permission/owner enforcement.
//
// Node-shaped errno errors. Subset of `lib/internal/errors.js` codes that the
// in-memory volume can produce. We keep them as a plain class (not extending
// host classes) so the surface is identical regardless of which browser
// engine consumes the bundle.

export type ErrnoCode =
    | 'ENOENT'
    | 'EEXIST'
    | 'EISDIR'
    | 'ENOTDIR'
    | 'EACCES'
    | 'EBADF'
    | 'EINVAL'
    | 'ENOTEMPTY'
    | 'ENOSYS'
    | 'ENOTSUP'
    | 'EPERM';

const errnoMap: Record<ErrnoCode, number> = {
    ENOENT: -2,
    EEXIST: -17,
    EISDIR: -21,
    ENOTDIR: -20,
    EACCES: -13,
    EBADF: -9,
    EINVAL: -22,
    ENOTEMPTY: -39,
    ENOSYS: -38,
    ENOTSUP: -45,
    EPERM: -1,
};

const messageMap: Record<ErrnoCode, string> = {
    ENOENT: 'no such file or directory',
    EEXIST: 'file already exists',
    EISDIR: 'illegal operation on a directory',
    ENOTDIR: 'not a directory',
    EACCES: 'permission denied',
    EBADF: 'bad file descriptor',
    EINVAL: 'invalid argument',
    ENOTEMPTY: 'directory not empty',
    ENOSYS: 'function not implemented',
    ENOTSUP: 'operation not supported',
    EPERM: 'operation not permitted',
};

/** Construct a Node-shaped errno error. */
export function createError(
    code: ErrnoCode,
    syscall: string,
    path?: string,
    dest?: string,
): Error & { code: ErrnoCode; errno: number; syscall: string; path?: string; dest?: string } {
    const msg = `${code}: ${messageMap[code]}, ${syscall}${path ? ` '${path}'` : ''}${dest ? ` -> '${dest}'` : ''}`;
    const err = new Error(msg) as Error & {
        code: ErrnoCode;
        errno: number;
        syscall: string;
        path?: string;
        dest?: string;
    };
    err.code = code;
    err.errno = errnoMap[code];
    err.syscall = syscall;
    if (path !== undefined) err.path = path;
    if (dest !== undefined) err.dest = dest;
    return err;
}

export const ENOENT = (syscall: string, path?: string) => createError('ENOENT', syscall, path);
export const EEXIST = (syscall: string, path?: string) => createError('EEXIST', syscall, path);
export const EISDIR = (syscall: string, path?: string) => createError('EISDIR', syscall, path);
export const ENOTDIR = (syscall: string, path?: string) => createError('ENOTDIR', syscall, path);
export const EACCES = (syscall: string, path?: string) => createError('EACCES', syscall, path);
export const EBADF = (syscall: string) => createError('EBADF', syscall);
export const EINVAL = (syscall: string, path?: string) => createError('EINVAL', syscall, path);
export const ENOTEMPTY = (syscall: string, path?: string) => createError('ENOTEMPTY', syscall, path);
export const ENOTSUP = (syscall: string, path?: string) => createError('ENOTSUP', syscall, path);
