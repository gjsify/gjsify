
/**
 * Raised when the underlying operating system indicates that the file
 * was not found.
 *
 * @category Errors */
export class NotFound extends Error { }
/**
 * Raised when the underlying operating system indicates the current user
 * which the Deno process is running under does not have the appropriate
 * permissions to a file or resource, or the user _did not_ provide required
 * `--allow-*` flag.
 *
 * @category Errors */
export class PermissionDenied extends Error { }
/**
 * Raised when the underlying operating system reports that a connection to
 * a resource is refused.
 *
 * @category Errors */
export class ConnectionRefused extends Error { }
/**
 * Raised when the underlying operating system reports that a connection has
 * been reset. With network servers, it can be a _normal_ occurrence where a
 * client will abort a connection instead of properly shutting it down.
 *
 * @category Errors */
export class ConnectionReset extends Error { }
/**
 * Raised when the underlying operating system reports an `ECONNABORTED`
 * error.
 *
 * @category Errors */
export class ConnectionAborted extends Error { }
/**
 * Raised when the underlying operating system reports an `ENOTCONN` error.
 *
 * @category Errors */
export class NotConnected extends Error { }
/**
 * Raised when attempting to open a server listener on an address and port
 * that already has a listener.
 *
 * @category Errors */
export class AddrInUse extends Error { }
/**
 * Raised when the underlying operating system reports an `EADDRNOTAVAIL`
 * error.
 *
 * @category Errors */
export class AddrNotAvailable extends Error { }
/**
 * Raised when trying to write to a resource and a broken pipe error occurs.
 * This can happen when trying to write directly to `stdout` or `stderr`
 * and the operating system is unable to pipe the output for a reason
 * external to the Deno runtime.
 *
 * @category Errors */
export class BrokenPipe extends Error { }
/**
 * Raised when trying to create a resource, like a file, that already
 * exits.
 *
 * @category Errors */
export class AlreadyExists extends Error { }
/**
 * Raised when an operation to returns data that is invalid for the
 * operation being performed.
 *
 * @category Errors */
export class InvalidData extends Error { }
/**
 * Raised when the underlying operating system reports that an I/O operation
 * has timed out (`ETIMEDOUT`).
 *
 * @category Errors */
export class TimedOut extends Error { }
/**
 * Raised when the underlying operating system reports an `EINTR` error. In
 * many cases, this underlying IO error will be handled internally within
 * Deno, or result in an @{link BadResource} error instead.
 *
 * @category Errors */
export class Interrupted extends Error { }
/**
 * Raised when expecting to write to a IO buffer resulted in zero bytes
 * being written.
 *
 * @category Errors */
export class WriteZero extends Error { }
/**
 * Raised when attempting to read bytes from a resource, but the EOF was
 * unexpectedly encountered.
 *
 * @category Errors */
export class UnexpectedEof extends Error { }
/**
 * The underlying IO resource is invalid or closed, and so the operation
 * could not be performed.
 *
 * @category Errors */
export class BadResource extends Error { }
/**
 * Raised in situations where when attempting to load a dynamic import,
 * too many redirects were encountered.
 *
 * @category Errors */
export class Http extends Error { }
/**
 * Raised when the underlying IO resource is not available because it is
 * being awaited on in another block of code.
 *
 * @category Errors */
export class Busy extends Error { }
/**
 * Raised when the underlying Deno API is asked to perform a function that
 * is not currently supported.
 *
 * @category Errors */
export class NotSupported extends Error { }

export interface Errors {
    NotFound: typeof NotFound;
    PermissionDenied: typeof PermissionDenied;
    ConnectionRefused: typeof ConnectionRefused;
    ConnectionReset: typeof ConnectionReset;
    ConnectionAborted: typeof ConnectionAborted;
    NotConnected: typeof NotConnected;
    AddrInUse: typeof AddrInUse;
    AddrNotAvailable: typeof AddrNotAvailable;
    BrokenPipe: typeof BrokenPipe;
    AlreadyExists: typeof AlreadyExists;
    InvalidData: typeof InvalidData;
    TimedOut: typeof TimedOut;
    Interrupted: typeof Interrupted;
    WriteZero: typeof WriteZero;
    UnexpectedEof: typeof UnexpectedEof;
    BadResource: typeof BadResource;
    Http: typeof Http;
    Busy: typeof Busy;
    NotSupported: typeof NotSupported;
}