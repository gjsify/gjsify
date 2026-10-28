// Node.js sqlite module types
// Reference: Node.js lib/sqlite.js

export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    timeout?: number;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
    readBigInts?: boolean;
    returnArrays?: boolean;
    allowBareNamedParameters?: boolean;
    allowUnknownNamedParameters?: boolean;
    defensive?: boolean;
    allowExtension?: boolean;
}

export interface StatementSyncOptions {
    readBigInts?: boolean;
    returnArrays?: boolean;
    allowBareNamedParameters?: boolean;
    allowUnknownNamedParameters?: boolean;
}

export interface RunResult {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
}

export interface ColumnInfo {
    column: string | null;
    database: string | null;
    name: string;
    table: string | null;
    type: string | null;
}

export type SQLiteValue = null | number | bigint | string | Uint8Array;

/** One result row, an object by default and an array under `returnArrays`. */
export type StatementRow = Record<string, unknown> | unknown[];

/**
 * What `StatementSync.iterate()` hands back.
 *
 * An iterator AND an iterable — `for…of` needs the second — whose `return()` is
 * declared because the contract includes resetting the statement when a loop is left
 * early, not only when it runs out.
 */
export interface StatementIterator extends Iterator<StatementRow, null> {
    [Symbol.iterator](): StatementIterator;
    return(): IteratorResult<StatementRow, null>;
}
