// Open-flag conversion + IOChannel acquisition helpers for FileHandle.
//
// Node's `fs.open()` / `fs.promises.open()` accept either a numeric POSIX
// `O_*` flag set or one of the documented string aliases (`'r'`, `'r+'`,
// `'w'`, `'a'`, `'as+'`, `'ax+'`, …). `GLib.IOChannel.new_file()` takes
// the fopen(3) flavour: `'r'` / `'r+'` / `'w'` / `'w+'` / `'a'` / `'a+'`.
// This module converts between the two and handles the create-if-missing
// retry that fopen `'r+'` doesn't get natively.
//
// Reference: Node.js lib/internal/fs/utils.js (stringToFlags / flagsToMode).
// Original: see file-handle.ts pre-split.

import GLib from '@girs/glib-2.0';
import { createGLibFileError } from '@gjsify/utils/core';
import type { OpenFlags } from './types/index.js';

// POSIX numeric open(2) flags (values on Linux x86-64).
const O_WRONLY = 1;
const O_RDWR = 2;
const O_CREAT = 64;
const O_EXCL = 128;
const O_TRUNC = 512;
const O_APPEND = 1024;

/** fopen(3)-style IOChannel mode. */
export type IOMode = 'r' | 'r+' | 'w' | 'w+' | 'a' | 'a+';

/**
 * Convert open flags (Node.js string or POSIX numeric) to a GLib.IOChannel mode.
 * IOChannel.new_file() takes fopen(3) modes: 'r', 'r+', 'w', 'w+', 'a', 'a+'.
 */
export function resolveIOMode(flags: OpenFlags | number | undefined): IOMode {
    if (flags === undefined || flags === null) return 'r';
    if (typeof flags === 'number') {
        const rdwr = (flags & O_RDWR) !== 0;
        const wronly = (flags & O_WRONLY) !== 0;
        const append = (flags & O_APPEND) !== 0;
        const trunc = (flags & O_TRUNC) !== 0;
        if (rdwr) return trunc ? 'w+' : 'r+';
        if (wronly) return append ? 'a' : 'w';
        return 'r';
    }
    // Node.js string flags — map extras to IOChannel equivalents.
    switch (flags) {
        case 'ax':
        case 'wx':
            return 'w';
        case 'ax+':
        case 'wx+':
            return 'w+';
        case 'as':
        case 'rs+':
            return 'r+';
        case 'as+':
            return 'a+';
        default:
            return flags as IOMode;
    }
}

/** Whether the open flags include `O_CREAT` (create-if-missing semantics). */
export function shouldCreate(flags: OpenFlags | number | undefined): boolean {
    if (typeof flags === 'number') return (flags & O_CREAT) !== 0;
    if (typeof flags !== 'string') return false;
    // String aliases that imply create: w*, a*. 'r'-only never creates.
    return (
        flags === 'w' ||
        flags === 'w+' ||
        flags === 'wx' ||
        flags === 'wx+' ||
        flags === 'a' ||
        flags === 'a+' ||
        flags === 'ax' ||
        flags === 'ax+' ||
        flags === 'as' ||
        flags === 'as+'
    );
}

/**
 * Whether the flags demand EXCLUSIVE creation — `O_EXCL`, or the `x` string aliases.
 *
 * fopen(3) has no exclusive mode, so `resolveIOMode` necessarily maps `wx` → `w` and `ax` → `a`,
 * which TRUNCATES an existing file instead of failing. That silently defeats the one guarantee
 * these flags exist to provide: they are how a lock file or a `.part` temp file claims a name
 * without racing another process. Callers must check this and refuse an existing path.
 */
export function isExclusive(flags: OpenFlags | number | undefined): boolean {
    if (typeof flags === 'number') return (flags & O_EXCL) !== 0;
    if (typeof flags !== 'string') return false;
    return flags === 'wx' || flags === 'wx+' || flags === 'ax' || flags === 'ax+';
}

/**
 * Open the file with the given IOChannel mode. When the flags request
 * create-if-missing + read/write without truncation (numeric O_CREAT | O_RDWR,
 * which maps to IOChannel 'r+' — a mode that requires the file to exist), we
 * catch the ENOENT and create an empty file, then retry. This avoids a TOCTOU
 * existence check and keeps the common "file exists" path to a single syscall.
 */
export function openIOChannel(path: string, mode: IOMode, creat: boolean): GLib.IOChannel {
    try {
        return GLib.IOChannel.new_file(path, mode);
    } catch (err) {
        const gErr = err as { code?: number } | null | undefined;
        if (creat && mode === 'r+' && gErr?.code === GLib.FileError.NOENT) {
            GLib.file_set_contents(path, new Uint8Array(0));
            return GLib.IOChannel.new_file(path, mode);
        }
        throw err;
    }
}

/**
 * Wrap a `GLib.IOChannel.new_file()` failure as a Node `ErrnoException`.
 * GLib's IOChannel throws GLib.FileError (not Gio.IOErrorEnum) on this path,
 * so we route through `createGLibFileError` to get the right errno + code.
 */
export function mapOpenError(err: unknown, path: string): NodeJS.ErrnoException {
    return createGLibFileError(err, 'open', { path }) as NodeJS.ErrnoException;
}
