// The one sanctioned way to execute a Gda.Statement on a connection.
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import Gda from '@girs/gda-6.0';
import GObject from '@girs/gobject-2.0';
import { SqliteError } from './errors.ts';

/**
 * GType names libgda gives a result column that it then reads through a C type narrower
 * than SQLite's 64-bit INTEGER, or converts into something node:sqlite never returns.
 *
 * libgda types a column from its declared type (`INTEGER`/`INT` → gint, `BOOLEAN` →
 * gboolean, `TIMESTAMP` → GDateTime …) or, without one, from the storage class of the first
 * non-NULL value (INTEGER → gint). A gint column then refuses every value outside 32 bits
 * ("Integer value is too big"), so a millisecond timestamp failed the whole SELECT.
 * gint64 would not be enough either: GJS turns a gint64 GValue into a Number, which loses
 * every integer past 2^53 before this package can hand it out as a BigInt.
 *
 * Such a column is read as TEXT instead. SQLite renders an INTEGER as its exact decimal
 * digits, and `data-model-reader.ts` turns them back into a Number or BigInt by
 * node:sqlite's rules.
 */
let gdaTypeNull: GObject.GType | null = null;

/**
 * GDA_TYPE_NULL as a `col_types` entry: "let the provider decide", per execution. GJS
 * refuses the documented alternative, a 0 in the array.
 *
 * The GIR has no class for the type, and it is registered lazily: measured,
 * `type_from_name('GdaNull')` is null right after importing Gda. Creating a NULL value is
 * what registers it.
 */
function typeNull(): GObject.GType {
    if (gdaTypeNull === null) {
        Gda.value_new_null();
        gdaTypeNull = GObject.type_from_name('GdaNull');
        if (!gdaTypeNull) throw new SqliteError('libgda did not register GdaNull');
    }
    return gdaTypeNull;
}

const TEXT_READ_TYPE_NAMES = new Set([
    'gint',
    'guint',
    'gint64',
    'guint64',
    'gboolean',
    'GDate',
    'GdaTime',
    'GDateTime',
]);

/**
 * How the result columns of one prepared statement are read, remembered between its
 * executions.
 *
 * Learning it costs an extra execution (see `probeColumns`), so a `StatementSync` keeps one
 * of these for its lifetime. A column this has never seen typed (NULL in every probed row)
 * is left to libgda; if a later execution types it integer-like, it is probed again.
 */
export class ColumnTypes {
    /** Per column: TYPE_STRING to read as exact text, GdaNull to let libgda decide. */
    types: GObject.GType[] | null;

    constructor(types: GObject.GType[] | null = null) {
        this.types = types;
    }

    /** Which columns hold text that `data-model-reader.ts` must convert back. */
    get textColumns(): boolean[] {
        return (this.types ?? []).map((type) => type === GObject.TYPE_STRING);
    }
}

/** Every column read as text — for a query whose columns are all known to be integers. */
export function integerColumns(count: number): ColumnTypes {
    return new ColumnTypes(Array.from({ length: count }, () => GObject.TYPE_STRING));
}

/**
 * Execute `stmt`, hand its result to `read`, and leave NOTHING behind on the connection.
 *
 * libgda keeps state per execution that only the connection's close() or the garbage
 * collector would otherwise release, and on a long-lived connection that state runs out:
 *
 * - The connection caches a prepared statement (`GdaSqlitePStmt`) for every
 *   `Gda.Statement` it ever executed, holding a STRONG reference to both, until the
 *   statement emits `reset` — which ours never do — or the connection closes. This package
 *   renders a fresh statement per execution, so the cache grew by one on every call.
 * - Every `GdaSqlitePStmt` holds a GWeakRef to the SQLite provider, and GLib (≥ 2.84) caps
 *   the GWeakRefs on one object at 65535. Past it, `g_weak_ref_set()` refuses with
 *   "Too many GWeakRef registered", the next prepared statement has no provider, and
 *   libgda answers `fuzzy_get_gtype: assertion 'prov != NULL' failed` — a CRITICAL, not an
 *   error. Reads on that connection came back typeless or empty with no exception.
 * - A SELECT's data model (`GdaSqliteRecordset`) holds its prepared statement until the
 *   model is finalized, and the model is a GJS wrapper the garbage collector frees
 *   whenever it gets round to it. Measured: ~70,000 unread models outlive one GC.
 * - `statement_execute_non_select()` has a `last_insert_row` out-parameter. GJS always
 *   passes the pointer, so on every INSERT the SQLite provider built and executed a
 *   hidden `SELECT * FROM <table> WHERE rowid = ?` — on a statement of its own that the
 *   connection cached as above, where no caller can reach it to release it.
 *
 * So: non-SELECTs go through `batch_execute()`, which passes `last_insert_row` as NULL;
 * the connection's cache entry is deleted after every execution; and the data model lets
 * go of its prepared statement as soon as `read` returns. Every object an execution
 * creates is then released before this function does.
 *
 * Do NOT use `GObject.Object.run_dispose()` on the model instead: `GdaSqliteRecordset`'s
 * dispose clears a GWeakRef without re-initialising it, so the second dispose the
 * finalizer runs dereferences a cleared weak ref and the process dies with SIGSEGV.
 */
export function executeStatement<T>(
    connection: Gda.Connection,
    stmt: Gda.Statement,
    params: Gda.Set | null,
    read: (model: Gda.DataModel | null, textColumns: boolean[]) => T,
    columns?: ColumnTypes,
): T {
    let model: Gda.DataModel | null = null;
    try {
        model = execute(connection, stmt, params, columns);
        if (model) assertTyped(model);
        return read(model, columns?.textColumns ?? []);
    } finally {
        if (model) releasePreparedStatement(model);
        // `del_prepared_statement()` does not check for a missing cache, which libgda
        // creates on the first successful prepare. open()'s first PRAGMA is always one,
        // so every connection this package hands out already has it.
        connection.del_prepared_statement(stmt);
    }
}

function execute(
    connection: Gda.Connection,
    stmt: Gda.Statement,
    params: Gda.Set | null,
    columns: ColumnTypes | undefined,
): Gda.DataModel | null {
    if (stmt.get_statement_type() === Gda.SqlStatementType.SELECT) {
        // Without `columns` nobody reads the rows, so none are converted: a forward
        // cursor types the columns from the first row and never fails on a value.
        if (!columns) {
            return connection.statement_execute_select_full(stmt, params, Gda.StatementModelUsage.CURSOR_FORWARD, null);
        }
        return executeTyped(connection, stmt, params, columns);
    }
    // A PRAGMA reaches libgda as UNKNOWN; the provider executes it and answers with a data
    // model when it yields rows, and with a Gda.Set of counters when it does not. So one
    // execution tells both apart — the statement is never run twice.
    const batch = Gda.Batch.new();
    batch.add_statement(stmt);
    const [result] = connection.batch_execute(batch, params, Gda.StatementModelUsage.RANDOM_ACCESS);
    if (!result || result instanceof Gda.Set) return null;
    return result as unknown as Gda.DataModel;
}

/**
 * Run a SELECT with every integer-like column read as text (see TEXT_READ_TYPE_NAMES).
 *
 * `col_types` must name every column, so the column count and libgda's own typing are
 * learned first by `probeColumns`, once per `ColumnTypes`. A remembered answer can go
 * stale (see `matches`), and is then probed again, once.
 */
function executeTyped(
    connection: Gda.Connection,
    stmt: Gda.Statement,
    params: Gda.Set | null,
    columns: ColumnTypes,
): Gda.DataModel {
    const freshlyProbed = columns.types === null;
    if (freshlyProbed) columns.types = probeColumns(connection, stmt, params);
    const model = selectWith(connection, stmt, params, columns.types!);
    if (matches(model, columns.types!)) return model;
    releasePreparedStatement(model);
    connection.del_prepared_statement(stmt);
    if (freshlyProbed) throw new SqliteError('the result columns changed between two executions');
    columns.types = probeColumns(connection, stmt, params);
    const retried = selectWith(connection, stmt, params, columns.types);
    if (matches(retried, columns.types)) return retried;
    releasePreparedStatement(retried);
    throw new SqliteError('the result columns changed between two executions');
}

/**
 * Does `model` still have the columns `types` was learned from?
 *
 * The count can change under `SELECT *`. A column left to libgda can have been typed
 * integer-like by this execution — it held only NULLs when probed — and libgda would then
 * refuse its large values: not at execution, but when the value is read, as an error that
 * names no column. Both are caught here, before anything is read.
 */
function matches(model: Gda.DataModel, types: GObject.GType[]): boolean {
    if (model.get_n_columns() !== types.length) return false;
    for (let col = 0; col < types.length; col++) {
        if (types[col] === GObject.TYPE_STRING) continue;
        const name = GObject.type_name(model.describe_column(col).get_g_type());
        if (name !== null && TEXT_READ_TYPE_NAMES.has(name)) return false;
    }
    return true;
}

function selectWith(
    connection: Gda.Connection,
    stmt: Gda.Statement,
    params: Gda.Set | null,
    types: GObject.GType[],
): Gda.DataModel {
    return connection.statement_execute_select_full(stmt, params, Gda.StatementModelUsage.RANDOM_ACCESS, [
        ...types,
        GObject.TYPE_NONE,
    ]);
}

/**
 * Execute the SELECT once as a forward cursor, only to learn its columns.
 *
 * libgda creates the model by reading rows until every column has a type — without
 * converting a value it cannot hold, which only invalidates that value. So this cannot
 * fail on the data that makes a random-access execution fail, and it releases what it
 * created like every other execution here.
 */
function probeColumns(connection: Gda.Connection, stmt: Gda.Statement, params: Gda.Set | null): GObject.GType[] {
    const model = connection.statement_execute_select_full(stmt, params, Gda.StatementModelUsage.CURSOR_FORWARD, null);
    try {
        assertTyped(model);
        const types: GObject.GType[] = [];
        for (let col = 0; col < model.get_n_columns(); col++) {
            const name = GObject.type_name(model.describe_column(col).get_g_type());
            types.push(name !== null && TEXT_READ_TYPE_NAMES.has(name) ? GObject.TYPE_STRING : typeNull());
        }
        return types;
    } finally {
        releasePreparedStatement(model);
        connection.del_prepared_statement(stmt);
    }
}

/**
 * Refuse to read a model libgda could not type.
 *
 * `fuzzy_get_gtype()` is where a prepared statement without its provider fails: it logs
 * a CRITICAL, returns G_TYPE_INVALID, and the model is built anyway — so the column type
 * is the one trace of that state a caller can see. Reading on would return values that
 * are not the database's; throwing is the only answer that is not wrong.
 *
 * GJS hands G_TYPE_INVALID back as `null` rather than as a GType, hence the falsy test.
 */
function assertTyped(model: Gda.DataModel): void {
    const nCols = model.get_n_columns();
    for (let col = 0; col < nCols; col++) {
        const column = model.describe_column(col);
        if (column && !column.get_g_type()) {
            throw new SqliteError('libgda could not type a result column; the connection has lost its SQLite provider');
        }
    }
}

/**
 * Drop the data model's reference to its prepared statement.
 *
 * `prepared-stmt` is a writable GdaDataSelect property; setting it to NULL unrefs the
 * statement, and — with the connection's cache entry deleted — finalizes it, which
 * finalizes the sqlite3_stmt and clears its GWeakRef on the provider. The model is
 * unusable afterwards, so every read has to be done by then.
 */
function releasePreparedStatement(model: Gda.DataModel): void {
    (model as unknown as { prepared_stmt: Gda.PStmt | null }).prepared_stmt = null;
}
