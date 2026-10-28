// Node.js-compatible error classes for sqlite module
// Reference: Node.js lib/internal/errors.js

export class SqliteError extends Error {
    code = 'ERR_SQLITE_ERROR';
    errcode: number;
    errstr: string;

    constructor(message: string, errcode = 0, errstr = '') {
        super(message);
        this.name = 'SqliteError';
        this.errcode = errcode;
        this.errstr = errstr || message;
    }
}

export class InvalidStateError extends Error {
    code = 'ERR_INVALID_STATE';

    constructor(message: string) {
        super(message);
        this.name = 'InvalidStateError';
    }
}

export class InvalidArgTypeError extends TypeError {
    code = 'ERR_INVALID_ARG_TYPE';

    constructor(message: string) {
        super(message);
        this.name = 'InvalidArgTypeError';
    }
}

export class InvalidArgValueError extends Error {
    code = 'ERR_INVALID_ARG_VALUE';

    constructor(message: string) {
        super(message);
        this.name = 'InvalidArgValueError';
    }
}

export class OutOfRangeError extends RangeError {
    code = 'ERR_OUT_OF_RANGE';

    constructor(message: string) {
        super(message);
        this.name = 'OutOfRangeError';
    }
}

export class ConstructCallRequiredError extends TypeError {
    code = 'ERR_CONSTRUCT_CALL_REQUIRED';

    constructor(name: string) {
        super(`Cannot call constructor without \`new\`: ${name}`);
        this.name = 'ConstructCallRequiredError';
    }
}

export class InvalidUrlSchemeError extends TypeError {
    code = 'ERR_INVALID_URL_SCHEME';

    constructor(message = 'The URL must be of scheme file:') {
        super(message);
        this.name = 'InvalidUrlSchemeError';
    }
}

export class IllegalConstructorError extends TypeError {
    code = 'ERR_ILLEGAL_CONSTRUCTOR';

    constructor() {
        super('Illegal constructor');
        this.name = 'IllegalConstructorError';
    }
}

/**
 * Whether `cause` is one of the errors above — already Node-shaped, so a catch that
 * translates the native module's must let it through untouched.
 *
 * **The discriminator cannot be `instanceof Error`.** The native module reports through
 * `GLib.Error`, which is a boxed GObject value whose prototype chain does NOT reach
 * `Error.prototype` — on GJS and, since the GError identity fix, on `@gjsify/node-gi`
 * too. It used to be a real `Error` subclass there, so an `instanceof Error` test
 * wrapped on one host and passed the raw GError through on the other; it now agrees on
 * both, and listing the Node-shaped errors by name keeps it agreeing if either moves.
 */
export function isNodeSqliteError(cause: unknown): boolean {
    return (
        cause instanceof SqliteError ||
        cause instanceof InvalidStateError ||
        cause instanceof InvalidArgTypeError ||
        cause instanceof InvalidArgValueError ||
        cause instanceof OutOfRangeError ||
        cause instanceof ConstructCallRequiredError ||
        cause instanceof InvalidUrlSchemeError ||
        cause instanceof IllegalConstructorError
    );
}

/**
 * The message SQLite actually reported.
 *
 * An `e instanceof Error ? e.message : String(e)` extraction takes the `String(e)`
 * branch for a GJS `GLib.Error` and yields
 * `"GLib.Error gjsify-sqlite-error: no such table: t"`; under node-gi the same
 * expression takes the OTHER branch and yields the bare message. The `message`
 * property alone is SQLite's own text on both — byte-for-byte what node:sqlite
 * reports for the same statement — so read the property instead of stringifying.
 */
export function sqliteErrorMessage(cause: unknown): string {
    const message = (cause as { message?: unknown } | null | undefined)?.message;
    return typeof message === 'string' ? message : String(cause);
}

/**
 * SQLite's result code for a failure the native module raised.
 *
 * `GjsifySqlite.SqliteError` is a GError domain whose `code` IS the extended result
 * code, which is exactly what node:sqlite exposes as `err.errcode`. Anything else
 * reports 0 rather than a number from an unrelated domain.
 */
export function sqliteErrorCode(cause: unknown): number {
    const code = (cause as { code?: unknown } | null | undefined)?.code;
    return typeof code === 'number' ? code : 0;
}

/**
 * A native failure in the shape a consumer written against node:sqlite branches on.
 *
 * Returned rather than thrown, so every call site reads `throw toSqliteError(e)` and
 * stays an exit the type checker can see. One of our own errors passes through: it is
 * already the shape, and re-wrapping would lose its `code`.
 */
export function toSqliteError(cause: unknown): Error {
    if (isNodeSqliteError(cause)) return cause as Error;
    return new SqliteError(sqliteErrorMessage(cause), sqliteErrorCode(cause));
}
