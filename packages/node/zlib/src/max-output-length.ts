// Reference: Node.js lib/zlib.js (`ZlibBase` option parsing, `zlibBuffer*`) and
// lib/internal/validators.js (`checkRangesOrGetDefault`, `validateFiniteNumber`).
//
// `maxOutputLength` is the zip-bomb guard of Node's convenience API: a decoder
// that is handed untrusted input stops as soon as its output would exceed the
// limit, instead of allocating whatever the input expands to and checking after.

import type { ZlibOptions } from 'node:zlib';

/**
 * Node's default and upper bound: `buffer.kMaxLength`, which is
 * `Number.MAX_SAFE_INTEGER` since Node 22. The bound is what the
 * `ERR_OUT_OF_RANGE` message prints, so it is spelled as Node spells it rather
 * than as the largest buffer this host could actually allocate.
 */
export const MAX_OUTPUT_LENGTH_DEFAULT = Number.MAX_SAFE_INTEGER;

const OPTION_NAME = 'options.maxOutputLength';

type CodedError<E extends Error> = E & { code: string };

function withCode<E extends Error>(error: E, code: string): CodedError<E> {
    return Object.assign(error, { code });
}

// Ported from refs/node/lib/internal/errors.js (addNumericalSeparator).
function addNumericalSeparator(val: string): string {
    let res = '';
    let i = val.length;
    const start = val[0] === '-' ? 1 : 0;
    for (; i >= start + 4; i -= 3) {
        res = `_${val.slice(i - 3, i)}${res}`;
    }
    return `${val.slice(0, i)}${res}`;
}

function formatReceivedNumber(value: number): string {
    if (Number.isInteger(value) && Math.abs(value) > 2 ** 32) return addNumericalSeparator(String(value));
    return Object.is(value, -0) ? '-0' : String(value);
}

// Reduced port of refs/node/lib/internal/errors.js (determineSpecificType):
// numbers and undefined never reach it, they are valid or defaulted first.
function describeType(value: unknown): string {
    if (value === null) return 'null';
    switch (typeof value) {
        case 'bigint':
            return `type bigint (${value}n)`;
        case 'boolean':
            return `type boolean (${value})`;
        case 'symbol':
            return `type symbol (${String(value)})`;
        case 'function':
            return `function ${(value as { name: string }).name}`;
        case 'string': {
            const shown = value.length > 28 ? `${value.slice(0, 25)}...` : value;
            return shown.includes("'") ? `type string (${JSON.stringify(shown)})` : `type string ('${shown}')`;
        }
        default: {
            const ctor = (value as { constructor?: { name?: string } }).constructor;
            return ctor?.name ? `an instance of ${ctor.name}` : `type ${typeof value}`;
        }
    }
}

function outOfRange(range: string, value: number): CodedError<RangeError> {
    return withCode(
        new RangeError(
            `The value of "${OPTION_NAME}" is out of range. It must be ${range}. Received ${formatReceivedNumber(value)}`,
        ),
        'ERR_OUT_OF_RANGE',
    );
}

/**
 * Validate `options.maxOutputLength` exactly as Node's `checkRangesOrGetDefault`
 * does. Measured on Node 24: `undefined` and `NaN` fall back to the default,
 * `±Infinity` is "not a finite number", anything below 1 (including `-0`) or
 * above the default is out of range, a non-number is `ERR_INVALID_ARG_TYPE`, and
 * a fractional limit such as 1.5 is accepted as given.
 */
export function resolveMaxOutputLength(options?: ZlibOptions): number {
    const value: unknown = options?.maxOutputLength;
    if (value === undefined) return MAX_OUTPUT_LENGTH_DEFAULT;
    if (typeof value !== 'number') {
        throw withCode(
            new TypeError(`The "${OPTION_NAME}" property must be of type number. Received ${describeType(value)}`),
            'ERR_INVALID_ARG_TYPE',
        );
    }
    if (Number.isNaN(value)) return MAX_OUTPUT_LENGTH_DEFAULT;
    if (!Number.isFinite(value)) throw outOfRange('a finite number', value);
    if (value < 1 || value > MAX_OUTPUT_LENGTH_DEFAULT) {
        throw outOfRange(`>= 1 and <= ${MAX_OUTPUT_LENGTH_DEFAULT}`, value);
    }
    return value;
}

export function bufferTooLargeError(maxOutputLength: number): CodedError<RangeError> {
    return withCode(
        new RangeError(`Cannot create a Buffer larger than ${maxOutputLength} bytes`),
        'ERR_BUFFER_TOO_LARGE',
    );
}

export function isBufferTooLargeError(err: unknown): boolean {
    return err instanceof RangeError && (err as { code?: unknown }).code === 'ERR_BUFFER_TOO_LARGE';
}

/**
 * How many more bytes a decoder may request before it has provably crossed the
 * limit: everything still allowed plus the one byte that proves the excess. A
 * fractional limit (Node accepts 1.5) allows its integer part.
 */
export function remainingReadBudget(maxOutputLength: number, produced: number): number {
    return Math.floor(maxOutputLength - produced) + 1;
}
