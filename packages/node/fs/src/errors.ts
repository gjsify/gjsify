import type { PathLike } from 'fs';

// Map Gio.IOErrorEnum values to Node.js error codes.
// The enum values are numeric constants from GLib — we use the numbers directly
// to avoid importing Gio just for error handling (keeps this usable in Node.js tests too).
const GIO_ERROR_TO_NODE: Record<number, string> = {
  1:  'ENOENT',   // NOT_FOUND
  2:  'EEXIST',   // EXISTS
  3:  'EISDIR',   // IS_DIRECTORY
  4:  'ENOTDIR',  // NOT_DIRECTORY
  5:  'ENOTEMPTY',// NOT_EMPTY
  7:  'ENFILE',   // TOO_MANY_OPEN_FILES
  14: 'EACCES',   // PERMISSION_DENIED
  17: 'ELOOP',    // TOO_MANY_LINKS
  19: 'ENOSPC',   // NO_SPACE
  24: 'EROFS',    // READ_ONLY
  27: 'ETIMEDOUT',// TIMED_OUT
  26: 'EBUSY',    // BUSY
  39: 'ENOTSUP',  // NOT_SUPPORTED
};

export function createNodeError(err: any, syscall: string, path: PathLike, dest?: PathLike): NodeJS.ErrnoException {
  const code = GIO_ERROR_TO_NODE[err?.code] || 'EIO';
  const pathStr = path.toString();
  let msg = `${code}: ${err?.message || 'unknown error'}, ${syscall} '${pathStr}'`;
  if (dest) msg += ` -> '${dest.toString()}'`;

  const error = new Error(msg) as NodeJS.ErrnoException;
  error.code = code;
  error.syscall = syscall;
  error.path = pathStr;
  if (dest) (error as any).dest = dest.toString();
  error.errno = -(err?.code || 0);
  return error;
}

export function isNotFoundError(err: any): boolean {
  return err?.code === 1 || err?.code === 'ENOENT';
}
