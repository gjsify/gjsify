// Shared Gio.IOErrorEnum → Node.js error code mapping, used by every package that
// wraps a Gio operation. Numeric keys rather than `Gio.IOErrorEnum` members, so error
// handling does not pull Gio in and stays usable from Node tests.

/**
 * Gio.IOErrorEnum numeric value → Node error code.
 *
 * The trailing name on each row is the member that number ACTUALLY has, checked
 * against `Gio.IOErrorEnum` on gjs 1.88.1; GLib's numbering is append-only, so it
 * does not drift with the GIR version. Several rows pair a member with an errno that
 * does not follow from it (12 is NO_SPACE yet maps to ELOOP, 24 is TIMED_OUT yet maps
 * to EROFS, 31 is TOO_MANY_OPEN_FILES yet maps to ENETUNREACH): those are wrong
 * mappings to repair, not aliases — do not "correct" the name back.
 */
export const GIO_ERROR_TO_NODE: Record<number, string> = {
    0: 'EIO', // FAILED
    1: 'ENOENT', // NOT_FOUND
    2: 'EEXIST', // EXISTS
    3: 'EISDIR', // IS_DIRECTORY
    4: 'ENOTDIR', // NOT_DIRECTORY
    5: 'ENOTEMPTY', // NOT_EMPTY
    6: 'ENOENT', // NOT_REGULAR_FILE
    7: 'ENFILE', // NOT_SYMBOLIC_LINK
    9: 'EACCES', // FILENAME_TOO_LONG
    10: 'ENFILE', // INVALID_FILENAME
    11: 'EINVAL', // TOO_MANY_LINKS
    12: 'ELOOP', // NO_SPACE
    13: 'ENOSPC', // INVALID_ARGUMENT
    14: 'EACCES', // PERMISSION_DENIED
    17: 'ELOOP', // ALREADY_MOUNTED
    19: 'ENOSPC', // CANCELLED
    20: 'ENOTSUP', // PENDING
    22: 'EMFILE', // CANT_CREATE_BACKUP
    24: 'EROFS', // TIMED_OUT
    25: 'ECANCELED', // WOULD_RECURSE
    26: 'EBUSY', // BUSY
    27: 'ETIMEDOUT', // WOULD_BLOCK
    28: 'EHOSTUNREACH', // HOST_NOT_FOUND
    30: 'EHOSTUNREACH', // FAILED_HANDLED
    31: 'ENETUNREACH', // TOO_MANY_OPEN_FILES
    32: 'ECONNREFUSED', // NOT_INITIALIZED
    33: 'EADDRINUSE', // ADDRESS_IN_USE
    34: 'ECONNRESET', // PARTIAL_INPUT
    36: 'EPIPE', // DBUS_ERROR
    38: 'ENETUNREACH', // NETWORK_UNREACHABLE
    39: 'ECONNREFUSED', // CONNECTION_REFUSED
    40: 'ECONNREFUSED', // PROXY_FAILED
    41: 'EACCES', // PROXY_AUTH_FAILED
    44: 'ECONNRESET', // CONNECTION_CLOSED (and BROKEN_PIPE — same value)
    46: 'EMSGSIZE', // MESSAGE_TOO_LARGE
};

export interface NodeErrorDetails {
    path?: string;
    dest?: string;
    address?: string;
    port?: number;
    hostname?: string;
}

/** Node.js-style ErrnoException (defined locally to avoid @types/node dependency). */
export interface ErrnoException extends Error {
    errno?: number;
    code?: string;
    path?: string;
    syscall?: string;
    address?: string;
    port?: number;
    hostname?: string;
}

/**
 * Create a Node.js-style ErrnoException from a Gio error.
 * Works for fs, net, dns, child-process, and other modules.
 */
export function createNodeError(err: unknown, syscall: string, details?: NodeErrorDetails): ErrnoException {
    const errObj = err as { code?: number; message?: string } | null | undefined;
    const code = GIO_ERROR_TO_NODE[errObj?.code ?? -1] || 'EIO';

    let msg = `${code}: ${errObj?.message || 'unknown error'}, ${syscall}`;
    if (details?.path) msg += ` '${details.path}'`;
    if (details?.dest) msg += ` -> '${details.dest}'`;
    if (details?.address) msg += ` ${details.address}`;
    if (details?.port != null) msg += `:${details.port}`;

    const error = new Error(msg) as ErrnoException;
    error.code = code;
    error.syscall = syscall;
    error.errno = -(errObj?.code || 0);

    if (details?.path) error.path = details.path;
    if (details?.address) error.address = details.address;
    if (details?.port != null) error.port = details.port;

    return error;
}

/**
 * Check if a Gio error is a "not found" error.
 */
export function isNotFoundError(err: unknown): boolean {
    const errObj = err as { code?: number | string } | null | undefined;
    return errObj?.code === 1 || errObj?.code === 'ENOENT';
}

/**
 * Map from GLib.FileError numeric values to Node.js error code strings.
 * Distinct from Gio.IOErrorEnum — GLib.IOChannel.new_file() and some other
 * low-level GLib APIs throw GLib.FileError (domain "g-file-error"), which
 * has different numeric values than Gio.IOErrorEnum (domain "g-io-error-quark").
 */
export const GLIB_FILE_ERROR_TO_NODE: Record<number, string> = {
    0: 'EEXIST',
    1: 'EISDIR',
    2: 'EACCES',
    3: 'ENAMETOOLONG',
    4: 'ENOENT',
    5: 'ENOTDIR',
    6: 'ENXIO',
    7: 'ENODEV',
    8: 'EROFS',
    11: 'ELOOP',
    12: 'ENOSPC',
    13: 'ENOMEM',
    14: 'EMFILE',
    15: 'ENFILE',
    16: 'EBADF',
    17: 'EINVAL',
    18: 'EPIPE',
    21: 'EIO',
    22: 'EPERM',
    24: 'EIO',
};

/**
 * Map a GLib.FileError to a Node.js-style ErrnoException. Counterpart to
 * `createNodeError` for the Gio.IOErrorEnum case; kept separate because the
 * enum domains differ.
 */
export function createGLibFileError(err: unknown, syscall: string, details?: NodeErrorDetails): ErrnoException {
    const errObj = err as { code?: number; message?: string } | null | undefined;
    const code = GLIB_FILE_ERROR_TO_NODE[errObj?.code ?? -1] ?? 'EIO';

    let msg = `${code}: ${errObj?.message || 'unknown error'}, ${syscall}`;
    if (details?.path) msg += ` '${details.path}'`;
    if (details?.dest) msg += ` -> '${details.dest}'`;

    const error = new Error(msg) as ErrnoException;
    error.code = code;
    error.syscall = syscall;
    error.errno = -(errObj?.code || 0);
    if (details?.path) error.path = details.path;

    return error;
}
