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
