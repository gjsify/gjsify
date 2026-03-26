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
