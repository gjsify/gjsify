// Convert Gda.DataModel results to JavaScript objects/arrays
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import type Gda from '@girs/gda-6.0';
import { OutOfRangeError } from './errors.ts';

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
    // Handle GLib.Bytes or Uint8Array (BLOB)
    if (value instanceof Uint8Array) {
        return value;
    }
    // GLib.Bytes from Gda — duck-typed structural view (the lib exposes
    // `toArray()` returning a `Uint8Array`-compatible buffer).
    const bytesLike = value as { toArray?: () => ArrayLike<number> };
    if (typeof bytesLike.toArray === 'function') {
        return new Uint8Array(bytesLike.toArray());
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
