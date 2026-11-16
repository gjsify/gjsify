// The driver contract `@gjsify/sqlite` is written against — ADR 0123 (thin native layer) and
// ADR 0147 (a second backend on NativeScript).
//
// It is the C API's shape, free of GLib and GObject so a backend that has neither can
// implement it. The GjsifySqlite typelib satisfies it as it stands (asserted in index.ts);
// `@gjsify/native-sqlite-bridge` implements it over androidx.sqlite. Nothing here may
// import `gi://` or `@girs/*`, not even as a type.
//
// Enumerations are plain numbers: the typelib's enums are numeric and a second backend
// must not need the typelib to name them. Every method may throw; the thrown value is
// turned into a Node-style error by `toSqliteError()` in `@gjsify/sqlite`, so a backend
// that knows SQLite's result code should put it in a numeric `code` property.

/** What `column_blob()` returns: GLib.Bytes on GJS, a plain holder elsewhere. */
export interface SqliteBytes {
    get_data(): Uint8Array | null;
}

export interface SqliteStatement {
    readonly is_valid: boolean;
    readonly column_count: number;
    readonly bind_parameter_count: number;
    readonly sql: string | null;
    readonly expanded_sql: string | null;

    close(): void;
    reset(): void;
    clear_bindings(): void;
    /** SQLITE_ROW or SQLITE_DONE as `StepResult`; anything else throws. */
    step(): number;

    /** Parameter indices are 1-based, column indices 0-based, as in the C API. */
    bind_null(index: number): void;
    bind_double(index: number, value: number): void;
    bind_int64(index: number, value: bigint | number): void;
    bind_text(index: number, value: string): void;
    bind_blob(index: number, value: SqliteBytes | Uint8Array): void;
    /** 0 when the statement has no such name. */
    bind_parameter_index(name: string): number;
    /** The full name (`:a`, `@a`, `$a`, `?NNN`), or null for an anonymous `?`. */
    bind_parameter_name(index: number): string | null;

    column_name(index: number): string | null;
    column_decltype(index: number): string | null;
    /** A `ColumnType` of the CURRENT row. */
    column_type(index: number): number;
    column_double(index: number): number;
    column_text(index: number): string | null;
    column_blob(index: number): SqliteBytes;
}

export interface SqliteDatabase {
    readonly is_open: boolean;
    /** Of the most recent write on this connection. */
    readonly last_insert_rowid: number;
    readonly changes: number;
    /** `sqlite3_get_autocommit() == 0`. */
    readonly in_transaction: boolean;

    /** One or more statements, `sqlite3_exec()` semantics. */
    exec(sql: string): void;
    prepare(sql: string): SqliteStatement;
    /** Finalises every statement still live on this connection. */
    close(): void;
}

export interface SqliteDriverModule {
    Database: {
        open(path: string, mode: number, uri: boolean): SqliteDatabase;
    };
    OpenMode: { readonly READONLY: number; readonly READWRITE: number; readonly READWRITE_CREATE: number };
    StepResult: { readonly ROW: number; readonly DONE: number };
    ColumnType: {
        readonly INTEGER: number;
        readonly FLOAT: number;
        readonly TEXT: number;
        readonly BLOB: number;
        readonly NULL: number;
    };
}
