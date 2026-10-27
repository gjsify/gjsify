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
const ZERO = 0x30;

/**
 * Decodes `gda_binary_to_string()` output straight into a buffer of the known size: one pass, no
 * slicing, the escape digits read inline. This loop runs once per byte of every BLOB read, so it
 * dominates a large `SELECT` of BLOBs (gjsify#2415).
 */
function decodeBinaryString(text: string, size: number): Uint8Array {
    const bytes = new Uint8Array(size);
    const length = text.length;
    let n = 0;
    let i = 0;
    while (i < length) {
        if (n >= size) {
            throw new SqliteError(`BLOB decoded to more than ${size} bytes`);
        }
        const code = text.charCodeAt(i);
        if (code !== BACKSLASH) {
            if (code > 0x7f) {
                throw new SqliteError(`BLOB holds a non-ASCII character at offset ${i}`);
            }
            bytes[n++] = code;
            i += 1;
            continue;
        }
        const a = text.charCodeAt(i + 1) - ZERO;
        if (a === BACKSLASH - ZERO) {
            bytes[n++] = BACKSLASH;
            i += 2;
            continue;
        }
        const b = text.charCodeAt(i + 2) - ZERO;
        const c = text.charCodeAt(i + 3) - ZERO;
        if (!(a >= 0 && a <= 3 && b >= 0 && b <= 7 && c >= 0 && c <= 7)) {
            throw new SqliteError(`BLOB holds an unknown escape at offset ${i}`);
        }
        bytes[n++] = (a << 6) | (b << 3) | c;
        i += 4;
    }
    if (n !== size) {
        throw new SqliteError(`BLOB decoded to ${n} bytes, expected ${size}`);
    }
    return bytes;
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
    return decodeBinaryString(binary.to_string(0), binary.get_size());
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
