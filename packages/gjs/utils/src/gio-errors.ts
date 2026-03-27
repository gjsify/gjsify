// Shared Gio.IOErrorEnum → Node.js error code mapping.
// Used by fs, net, http, dns, child-process, and other packages that wrap Gio operations.
//
// The enum values are numeric constants from GLib — we use numbers directly
// to avoid importing Gio just for error handling (keeps this usable in Node.js tests too).

/** Map from Gio.IOErrorEnum numeric values to Node.js error code strings. */
export const GIO_ERROR_TO_NODE: Record<number, string> = {
  0:  'EIO',          // FAILED
  1:  'ENOENT',       // NOT_FOUND
  2:  'EEXIST',       // EXISTS
  3:  'EISDIR',       // IS_DIRECTORY
  4:  'ENOTDIR',      // NOT_DIRECTORY
  5:  'ENOTEMPTY',    // NOT_EMPTY
  6:  'ENOENT',       // NOT_REGULAR_FILE
  7:  'ENFILE',       // TOO_MANY_OPEN_FILES
  9:  'EACCES',       // NOT_MOUNTABLE_FILE
  10: 'ENFILE',       // FILENAME_TOO_LONG
  11: 'EINVAL',       // INVALID_FILENAME
  12: 'ELOOP',        // TOO_MANY_LINKS
  13: 'ENOSPC',       // NO_SPACE
  14: 'EACCES',       // PERMISSION_DENIED
  17: 'ELOOP',        // TOO_MANY_LINKS (duplicate guard)
  19: 'ENOSPC',       // NO_SPACE (duplicate guard)
  20: 'ENOTSUP',      // NOT_SUPPORTED
  22: 'EMFILE',       // TOO_MANY_OPEN_FILES
  24: 'EROFS',        // READ_ONLY
  25: 'ECANCELED',    // CANCELLED
  26: 'EBUSY',        // BUSY
  27: 'ETIMEDOUT',    // TIMED_OUT
  28: 'EHOSTUNREACH', // HOST_NOT_FOUND (was WOULD_BLOCK)
  30: 'EHOSTUNREACH', // HOST_NOT_FOUND
  31: 'ENETUNREACH',  // NETWORK_UNREACHABLE
  32: 'ECONNREFUSED', // CONNECTION_REFUSED (legacy value)
  33: 'EADDRINUSE',   // ADDRESS_IN_USE
  34: 'ECONNRESET',   // CONNECTION_CLOSED (mapped to reset)
  36: 'EPIPE',        // BROKEN_PIPE
  38: 'ENETUNREACH',  // NETWORK_UNREACHABLE (actual GJS value)
  39: 'ECONNREFUSED', // CONNECTION_REFUSED (actual GJS value)
  40: 'ECONNREFUSED', // PROXY_FAILED
  41: 'EACCES',       // PROXY_AUTH_FAILED
  44: 'ECONNRESET',   // CONNECTION_CLOSED (actual GJS value)
  46: 'EMSGSIZE',     // MESSAGE_TOO_LARGE
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
export function createNodeError(
  err: unknown,
  syscall: string,
  details?: NodeErrorDetails
): ErrnoException {
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
