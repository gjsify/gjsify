// Convert Gda.DataModel results to JavaScript objects/arrays
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import type Gda from '@girs/gda-6.0';
import { OutOfRangeError, SqliteError } from './errors.ts';

export interface ReadOptions {
    readBigInts: boolean;
    returnArrays: boolean;
    /** Per column: true where libgda was told to hand the value over as text (execution.ts). */
    textColumns?: boolean[];
}

const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const INTEGER_TEXT = /^[+-]?\d+$/;

/**
 * Convert a value that libgda read as text only because its column is integer-like.
 *
 * SQLite renders an INTEGER as its exact decimal digits, so parsing them as a BigInt loses
 * nothing, and node:sqlite's rule then applies: a BigInt with readBigInts, a Number when it
 * is safe, and ERR_OUT_OF_RANGE otherwise — never a silently rounded Number. The column
 * can still hold another storage class: a REAL renders as a decimal number, and TEXT that
 * affinity could not convert stays text.
 */
function convertIntegerText(text: string, readBigInts: boolean): unknown {
    if (INTEGER_TEXT.test(text)) {
        const value = BigInt(text);
        if (readBigInts) return value;
        if (value > MAX_SAFE || value < -MAX_SAFE) {
            throw new OutOfRangeError(`Value is too large to be represented as a JavaScript number: ${value}`);
        }
        return Number(value);
    }
    const number = Number(text);
    if (text.trim() !== '' && Number.isFinite(number)) return number;
    return text;
}

/** The part of `Gda.Binary` this reader needs — duck-typed, see {@link readBinary}. */
interface BinaryLike {
    get_size: () => number;
    to_string: (maxlen: number) => string;
}

const BACKSLASH = 0x5c;

/** The byte an octal escape starting at `start` denotes, or -1 if there is none. */
function octalEscapeAt(text: string, start: number): number {
    let value = 0;
    for (let i = start; i < start + 3; i++) {
        const digit = text.charCodeAt(i) - 0x30;
        if (!(digit >= 0 && digit <= 7)) return -1;
        value = value * 8 + digit;
    }
    return value > 0xff ? -1 : value;
}

function decodeBinaryString(text: string): Uint8Array {
    const bytes = new Uint8Array(text.length);
    let n = 0;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        if (code !== BACKSLASH) {
            if (code > 0x7f) {
                throw new SqliteError(`BLOB holds a non-ASCII character at offset ${i}`);
            }
            bytes[n++] = code;
            continue;
        }
        if (text.charCodeAt(i + 1) === BACKSLASH) {
            bytes[n++] = BACKSLASH;
            i += 1;
            continue;
        }
        const escaped = octalEscapeAt(text, i + 1);
        if (escaped < 0) {
            throw new SqliteError(`BLOB holds an unknown escape at offset ${i}`);
        }
        bytes[n++] = escaped;
        i += 3;
    }
    return bytes.slice(0, n);
}

/**
 * The bytes behind a libgda BLOB value.
 *
 * **No GI accessor hands them over.** `gda_binary_get_data()` is annotated `gpointer`, so GJS
 * returns `null` instead of an array, and nothing else returns one either — `gda_value_stringify()`
 * and the default `Gda.HandlerBin` both end in `gda_binary_to_string()` too. That printable form
 * is therefore the only route, and it is lossless; measured over all 256 byte values, a byte in
 * 0x20–0x7e is its own ASCII character, `\` is doubled, 0x0a stays a raw newline, and every other
 * byte becomes `\` plus exactly three octal digits. `maxlen` truncates in INPUT bytes rather than
 * output characters, so it must be 0.
 *
 * The value is duck-typed instead of matched with `instanceof Gda.Binary` because node-gi's
 * `Symbol.hasInstance` answers false for a boxed handle, which would make the gjs and node-gi legs
 * disagree. Since a wrong match would decode something unrelated into plausible bytes, the result
 * is held against `get_size()`.
 */
function readBinary(binary: BinaryLike): Uint8Array {
    const size = binary.get_size();
    const bytes = decodeBinaryString(binary.to_string(0));
    if (bytes.length !== size) {
        throw new SqliteError(`BLOB decoded to ${bytes.length} bytes, expected ${size}`);
    }
    return bytes;
}

function convertValue(value: unknown, readBigInts: boolean, isText = false): unknown {
    if (value === null || value === undefined) {
        return null;
    }
    if (isText && typeof value === 'string') {
        return convertIntegerText(value, readBigInts);
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
            if (!readBigInts) {
                throw new OutOfRangeError(`Value is too large to be represented as a JavaScript number: ${value}`);
            }
            return BigInt(value);
        }
        if (readBigInts && Number.isInteger(value)) {
            return BigInt(value);
        }
        return value;
    }
    if (typeof value === 'bigint') {
        if (!readBigInts) {
            if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(-Number.MAX_SAFE_INTEGER)) {
                throw new OutOfRangeError(`Value is too large to be represented as a JavaScript number: ${value}`);
            }
            return Number(value);
        }
        return value;
    }
    if (typeof value === 'string') {
        return value;
    }
    if (value instanceof Uint8Array) {
        return value;
    }
    const binary = value as Partial<BinaryLike>;
    if (typeof binary.get_size === 'function' && typeof binary.to_string === 'function') {
        return readBinary(binary as BinaryLike);
    }
    return value;
}

export function readRow(
    model: Gda.DataModel,
    row: number,
    options: ReadOptions,
): Record<string, unknown> | unknown[] | undefined {
    const nCols = model.get_n_columns();

    if (options.returnArrays) {
        const arr: unknown[] = [];
        for (let col = 0; col < nCols; col++) {
            const val = model.get_value_at(col, row);
            arr.push(convertValue(val, options.readBigInts, options.textColumns?.[col]));
        }
        return arr;
    }

    const obj = Object.create(null) as Record<string, unknown>;
    for (let col = 0; col < nCols; col++) {
        const name = model.get_column_name(col);
        const val = model.get_value_at(col, row);
        obj[name] = convertValue(val, options.readBigInts, options.textColumns?.[col]);
    }
    return obj;
}

export function readAllRows(model: Gda.DataModel, options: ReadOptions): (Record<string, unknown> | unknown[])[] {
    const nRows = model.get_n_rows();
    const rows: (Record<string, unknown> | unknown[])[] = [];
    for (let row = 0; row < nRows; row++) {
        const r = readRow(model, row, options);
        if (r !== undefined) {
            rows.push(r);
        }
    }
    return rows;
}

export function readFirstRow(
    model: Gda.DataModel,
    options: ReadOptions,
): Record<string, unknown> | unknown[] | undefined {
    const nRows = model.get_n_rows();
    if (nRows === 0) {
        return undefined;
    }
    return readRow(model, 0, options);
}
