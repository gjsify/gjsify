// The SqliteDriverModule contract (`@gjsify/sqlite-native/driver`) over any androidx.sqlite
// shaped backend — ADR 0146. Everything androidx leaves out lives here, in plain TypeScript
// with no Java in sight, so it runs (and is specced) under Node against a fake backend:
// parameter names and count, multi-statement `exec`, `changes` / `last_insert_rowid`,
// `in_transaction`, statement lifetime and the error code.

import type { SqliteBytes, SqliteDatabase, SqliteDriverModule, SqliteStatement } from '@gjsify/sqlite-native/driver';

import { scanParameters, splitStatements } from './sql-scan.js';

/** The statement surface of androidx.sqlite, with JS types already on the values. */
export interface RawStatement {
    bindNull(index: number): void;
    bindLong(index: number, value: bigint | number): void;
    bindDouble(index: number, value: number): void;
    bindText(index: number, value: string): void;
    bindBlob(index: number, value: Uint8Array): void;
    /** true = a row is available. */
    step(): boolean;
    reset(): void;
    clearBindings(): void;
    close(): void;
    getColumnCount(): number;
    getColumnName(index: number): string;
    /** SQLite's fundamental type: 1 integer, 2 float, 3 text, 4 blob, 5 null. */
    getColumnType(index: number): number;
    getDouble(index: number): number;
    getText(index: number): string;
    getBlob(index: number): Uint8Array;
}

export interface RawConnection {
    prepare(sql: string): RawStatement;
    close(): void;
}

export interface RawBackend {
    open(path: string, mode: number, uri: boolean): RawConnection;
}

const OPEN_MODE = { READONLY: 1, READWRITE: 2, READWRITE_CREATE: 6 } as const;
const STEP_RESULT = { ROW: 100, DONE: 101 } as const;
const COLUMN_TYPE = { INTEGER: 1, FLOAT: 2, TEXT: 3, BLOB: 4, NULL: 5 } as const;

const SQLITE_CONSTRAINT = 19;
const CONSTRAINT_CODES: [RegExp, number][] = [
    [/UNIQUE constraint failed/, 2067],
    [/NOT NULL constraint failed/, 1299],
    [/FOREIGN KEY constraint failed/, 787],
    [/CHECK constraint failed/, 275],
];

/**
 * A backend failure as an Error whose `message` is SQLite's text and whose `code` is the
 * result code. androidx reports `Error code: <primary>, message: <errmsg>` and nothing
 * more, so the extended code of a constraint failure is recovered from the message
 * (a rowid clash therefore reads 2067, not 1555: ADR 0146 decision 4).
 */
export function toDriverError(cause: unknown): Error {
    const raw = cause as { message?: unknown; nativeException?: { getMessage?: () => unknown } } | null;
    let text = typeof raw?.message === 'string' ? raw.message : '';
    if (!/Error code:/.test(text)) {
        const native = raw?.nativeException?.getMessage?.();
        if (native != null) text = String(native);
    }
    if (!text) text = String(cause);
    const match = /Error code:\s*(\d+),\s*message:\s*([\s\S]*)$/.exec(text);
    const error = new Error(match ? match[2] : text) as Error & { code: number };
    let code = match ? Number(match[1]) : 0;
    if ((code & 0xff) === SQLITE_CONSTRAINT || code === 0) {
        for (const [pattern, extended] of CONSTRAINT_CODES) {
            if (pattern.test(error.message)) {
                code = extended;
                break;
            }
        }
    }
    error.code = code;
    return error;
}

function guarded<T>(fn: () => T): T {
    try {
        return fn();
    } catch (cause) {
        throw toDriverError(cause);
    }
}

class Bytes implements SqliteBytes {
    constructor(private readonly data: Uint8Array) {}
    get_data(): Uint8Array | null {
        return this.data;
    }
}

// Only these leave the connection's autocommit state; anything else cannot.
const TRANSACTION_START = /^\s*(BEGIN|SAVEPOINT)\b/i;
const TRANSACTION_END = /^\s*(COMMIT|END|ROLLBACK)\b(?!\s+TO\b)/i;

class Statement implements SqliteStatement {
    #raw: RawStatement | null;
    readonly #parameters: (string | null)[];
    readonly #sql: string;
    readonly #onClose: (statement: Statement) => void;
    readonly #connection: Connection;

    constructor(raw: RawStatement, sql: string, connection: Connection, onClose: (s: Statement) => void) {
        this.#raw = raw;
        this.#sql = sql;
        this.#parameters = scanParameters(sql);
        this.#connection = connection;
        this.#onClose = onClose;
    }

    #live(): RawStatement {
        if (!this.#raw) throw toDriverError(new Error('statement has been finalized'));
        return this.#raw;
    }

    get is_valid(): boolean {
        return this.#raw !== null;
    }
    get column_count(): number {
        return guarded(() => this.#live().getColumnCount());
    }
    get bind_parameter_count(): number {
        return this.#parameters.length;
    }
    get sql(): string | null {
        return this.#sql;
    }
    // androidx has no sqlite3_expanded_sql(); StatementSync falls back to the source text.
    get expanded_sql(): string | null {
        return null;
    }

    close(): void {
        const raw = this.#raw;
        if (!raw) return;
        this.#raw = null;
        this.#onClose(this);
        raw.close();
    }
    reset(): void {
        guarded(() => this.#live().reset());
    }
    clear_bindings(): void {
        guarded(() => this.#live().clearBindings());
    }
    step(): number {
        const raw = this.#live();
        const hasRow = guarded(() => raw.step());
        if (hasRow) return STEP_RESULT.ROW;
        this.#connection.noteStatementDone(this.#sql);
        return STEP_RESULT.DONE;
    }

    bind_null(index: number): void {
        guarded(() => this.#live().bindNull(index));
    }
    bind_double(index: number, value: number): void {
        guarded(() => this.#live().bindDouble(index, value));
    }
    bind_int64(index: number, value: bigint | number): void {
        guarded(() => this.#live().bindLong(index, value));
    }
    bind_text(index: number, value: string): void {
        guarded(() => this.#live().bindText(index, value));
    }
    bind_blob(index: number, value: SqliteBytes | Uint8Array): void {
        const data = value instanceof Uint8Array ? value : (value.get_data() ?? new Uint8Array(0));
        guarded(() => this.#live().bindBlob(index, data));
    }
    bind_parameter_index(name: string): number {
        const at = this.#parameters.indexOf(name);
        return at < 0 ? 0 : at + 1;
    }
    bind_parameter_name(index: number): string | null {
        return this.#parameters[index - 1] ?? null;
    }

    column_name(index: number): string | null {
        return guarded(() => this.#live().getColumnName(index));
    }
    // androidx exposes no declared type.
    column_decltype(_index: number): string | null {
        return null;
    }
    column_type(index: number): number {
        return guarded(() => this.#live().getColumnType(index));
    }
    column_double(index: number): number {
        return guarded(() => this.#live().getDouble(index));
    }
    column_text(index: number): string | null {
        return guarded(() => this.#live().getText(index));
    }
    column_blob(index: number): SqliteBytes {
        return new Bytes(guarded(() => this.#live().getBlob(index)));
    }
}

class Connection implements SqliteDatabase {
    #raw: RawConnection | null;
    readonly #statements = new Set<Statement>();
    #changes = 0;
    #rowid = 0;
    #depth = 0;
    #bookkeeping: RawStatement | null = null;

    constructor(raw: RawConnection) {
        this.#raw = raw;
    }

    #live(): RawConnection {
        if (!this.#raw) throw toDriverError(new Error('database is not open'));
        return this.#raw;
    }

    get is_open(): boolean {
        return this.#raw !== null;
    }
    get last_insert_rowid(): number {
        this.#refresh();
        return this.#rowid;
    }
    get changes(): number {
        this.#refresh();
        return this.#changes;
    }
    // androidx has no sqlite3_get_autocommit(); the transaction statements that pass through
    // this connection are tracked instead. A rollback SQLite performs on its own (a failed
    // COMMIT, SQLITE_FULL) is not seen, which is the one place this can say true too long.
    get in_transaction(): boolean {
        return this.#depth > 0;
    }

    /** Called by a statement once it has run to completion. */
    noteStatementDone(sql: string): void {
        if (TRANSACTION_START.test(sql)) {
            this.#depth = /^\s*SAVEPOINT\b/i.test(sql) ? this.#depth + 1 : Math.max(this.#depth, 1);
        } else if (TRANSACTION_END.test(sql)) {
            this.#depth = 0;
        } else if (/^\s*RELEASE\b/i.test(sql) && this.#depth > 0) {
            this.#depth--;
        }
    }

    #refresh(): void {
        const raw = this.#live();
        this.#bookkeeping ??= guarded(() => raw.prepare('SELECT changes(), last_insert_rowid()'));
        const statement = this.#bookkeeping;
        guarded(() => {
            statement.reset();
            if (statement.step()) {
                this.#changes = Number(statement.getText(0));
                this.#rowid = Number(statement.getText(1));
            }
            statement.reset();
        });
    }

    exec(sql: string): void {
        for (const piece of splitStatements(sql)) {
            const statement = this.prepare(piece);
            try {
                while (statement.step() === STEP_RESULT.ROW) {
                    // sqlite3_exec() without a callback discards the rows.
                }
            } finally {
                statement.close();
            }
        }
    }

    prepare(sql: string): SqliteStatement {
        const raw = this.#live();
        const prepared = guarded(() => raw.prepare(sql));
        const statement = new Statement(prepared, sql, this, (done) => this.#statements.delete(done));
        this.#statements.add(statement);
        return statement;
    }

    close(): void {
        const raw = this.#raw;
        if (!raw) return;
        for (const statement of this.#statements) statement.close();
        try {
            this.#bookkeeping?.close();
        } catch {
            // closing the connection finalises it anyway
        }
        this.#bookkeeping = null;
        this.#raw = null;
        guarded(() => raw.close());
    }
}

export function createSqliteDriver(backend: RawBackend): SqliteDriverModule {
    return {
        Database: {
            open(path: string, mode: number, uri: boolean): SqliteDatabase {
                return new Connection(guarded(() => backend.open(path, mode, uri)));
            },
        },
        OpenMode: OPEN_MODE,
        StepResult: STEP_RESULT,
        ColumnType: COLUMN_TYPE,
    };
}
