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
 * translates libgda's must let it through untouched.
 *
 * **The discriminator cannot be `instanceof Error`.** libgda reports through
 * `GLib.Error`, and that is a boxed GObject value under GJS but a real `Error`
 * SUBCLASS under `@gjsify/node-gi` (`class GLibError extends Error` in its `gi.js`)
 * — the bridge that runs this very package's suite on Node. An `instanceof Error`
 * test would therefore wrap on one host and pass the raw GError through on the
 * other, and the leg that disagreed is the one nobody runs locally.
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
 * The message libgda actually reported.
 *
 * An `e instanceof Error ? e.message : String(e)` extraction takes the `String(e)`
 * branch for a GJS `GLib.Error` and yields
 * `"GLib.Error gda_server_provider_error: no such table: t"`; under node-gi the same
 * expression takes the OTHER branch and yields the bare message. The `message`
 * property alone is SQLite's own text on both — byte-for-byte what node:sqlite
 * reports for the same statement — so read the property instead of stringifying.
 */
export function sqliteErrorMessage(cause: unknown): string {
    const message = (cause as { message?: unknown } | null | undefined)?.message;
    return typeof message === 'string' ? message : String(cause);
}
