// Convert Gda.DataModel results to JavaScript objects/arrays
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import Gda from '@girs/gda-6.0';
import GObject from '@girs/gobject-2.0';
import { OutOfRangeError } from './errors.ts';

export interface ReadOptions {
    readBigInts: boolean;
    returnArrays: boolean;
}

function convertValue(value: unknown, readBigInts: boolean): unknown {
    if (value === null || value === undefined) {
        return null;
    }
    if (typeof value === 'number') {
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
            if (!readBigInts) {
                throw new OutOfRangeError(
                    `Value is too large to be represented as a JavaScript number: ${value}`
                );
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
                throw new OutOfRangeError(
                    `Value is too large to be represented as a JavaScript number: ${value}`
                );
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
    // GLib.Bytes from Gda
    if (value && typeof (value as any).toArray === 'function') {
        return new Uint8Array((value as any).toArray());
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
            arr.push(convertValue(val, options.readBigInts));
        }
        return arr;
    }

    const obj = Object.create(null) as Record<string, unknown>;
    for (let col = 0; col < nCols; col++) {
        const name = model.get_column_name(col);
        const val = model.get_value_at(col, row);
        obj[name] = convertValue(val, options.readBigInts);
    }
    return obj;
}

export function readAllRows(
    model: Gda.DataModel,
    options: ReadOptions,
): (Record<string, unknown> | unknown[])[] {
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
