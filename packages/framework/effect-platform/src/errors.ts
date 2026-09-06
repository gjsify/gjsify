// SPDX-License-Identifier: MIT
//
// `GError` → Effect's tagged platform errors.
//
// THE PROBLEM THIS SOLVES. Every failing GIO call arrives in JavaScript as one
// type — a `GLib.Error` carrying a numeric `code` whose meaning depends on which
// `domain` produced it. So the only thing a consumer can write today is
// `catch (e) { if (e.code === Gio.IOErrorEnum.NOT_FOUND) … }`, and getting the
// domain wrong is silent. Measured: `Gio.IOErrorEnum.NOT_FOUND` is 1, and so is
// `GLib.FileError.ISDIR` — so a code read without its domain turns "is a
// directory" into "not found", which is a different REAL error rather than an
// unknown one, and nothing downstream can tell.
//
// Effect already has the vocabulary this wants: `PlatformError` wrapping a
// `SystemError` whose `_tag` is one of eleven normalized reasons. Mapping GIO onto
// THAT rather than onto a private enum is what makes a Gio-backed FileSystem layer
// interchangeable with the Node-backed one — the same `error.reason._tag ===
// 'NotFound'` in consumer code, whichever layer is provided.
//
// The domain check is not defensive noise: `Gio.io_error_from_errno` maps errno
// into this same enum, so a code arriving from another domain WOULD land in range
// and be mistranslated. Anything not from `g-io-error-quark` is `Unknown`, with the
// original kept as the cause.

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';

import { PlatformError, SystemError, type SystemErrorTag } from 'effect/PlatformError';

/**
 * The GIO error codes that have a normalized Effect reason. Codes not listed here
 * are real and specific (`IS_DIRECTORY`, `NOT_EMPTY`, `NO_SPACE`, …) but Effect's
 * vocabulary has no tag for them, so they become `Unknown` and keep their message
 * — which is honest, where inventing a near-miss tag would not be.
 */
const REASON_BY_IO_ERROR: ReadonlyMap<number, SystemErrorTag> = new Map<number, SystemErrorTag>([
    [Gio.IOErrorEnum.NOT_FOUND, 'NotFound'],
    [Gio.IOErrorEnum.EXISTS, 'AlreadyExists'],
    [Gio.IOErrorEnum.PERMISSION_DENIED, 'PermissionDenied'],
    [Gio.IOErrorEnum.BUSY, 'Busy'],
    [Gio.IOErrorEnum.TIMED_OUT, 'TimedOut'],
    [Gio.IOErrorEnum.WOULD_BLOCK, 'WouldBlock'],
    [Gio.IOErrorEnum.INVALID_DATA, 'InvalidData'],
    [Gio.IOErrorEnum.CLOSED, 'BadResource'],
    [Gio.IOErrorEnum.NOT_INITIALIZED, 'BadResource'],
    [Gio.IOErrorEnum.NO_SPACE, 'WriteZero'],
    [Gio.IOErrorEnum.PARTIAL_INPUT, 'UnexpectedEof'],
]);

/** The quark GIO stamps on every `GError` it raises. */
const IO_ERROR_QUARK = GLib.quark_to_string(Gio.io_error_quark());

/** `true` when this value is a `GLib.Error` raised by GIO itself. */
export const isIoError = (error: unknown): error is GLib.Error =>
    error instanceof GLib.Error && error.domain === Gio.io_error_quark();

/**
 * The normalized reason for a caught value. Non-GIO errors — a `TypeError` from
 * our own binding code, a `GLib.Error` from another domain — are `Unknown` rather
 * than guessed at.
 */
export const reasonOf = (error: unknown): SystemErrorTag =>
    isIoError(error) ? (REASON_BY_IO_ERROR.get(error.code) ?? 'Unknown') : 'Unknown';

/**
 * Wrap a caught GIO failure as the platform error `effect/FileSystem` declares.
 *
 * `module` is the Effect service that failed, not the GIO class, so a consumer
 * reading `NotFound: FileSystem.readFile (/etc/nope)` cannot tell which layer
 * produced it — which is the point.
 */
export const toPlatformError = (options: {
    readonly method: string;
    readonly pathOrDescriptor?: string | number;
    readonly error: unknown;
    readonly module?: string;
}): PlatformError =>
    new PlatformError(
        new SystemError({
            _tag: reasonOf(options.error),
            module: options.module ?? 'FileSystem',
            method: options.method,
            pathOrDescriptor: options.pathOrDescriptor,
            description: describe(options.error),
            cause: options.error,
        }),
    );

/**
 * The human half of the report. A GIO `GError` already carries a formatted
 * message; the domain is added because the same code means different things in
 * different domains and `Unknown` on its own tells the reader nothing about why.
 */
const describe = (error: unknown): string => {
    if (error instanceof GLib.Error) {
        const domain = GLib.quark_to_string(error.domain) ?? String(error.domain);
        return domain === IO_ERROR_QUARK ? error.message : `${domain}(${error.code}): ${error.message}`;
    }
    return error instanceof Error ? error.message : String(error);
};
