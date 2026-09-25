// The one sanctioned way to execute a Gda.Statement on a connection.
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import Gda from '@girs/gda-6.0';
import { SqliteError } from './errors.ts';

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
    read: (model: Gda.DataModel | null) => T,
): T {
    let model: Gda.DataModel | null = null;
    try {
        model = execute(connection, stmt, params);
        if (model) assertTyped(model);
        return read(model);
    } finally {
        if (model) releasePreparedStatement(model);
        // `del_prepared_statement()` does not check for a missing cache, which libgda
        // creates on the first successful prepare. open()'s first PRAGMA is always one,
        // so every connection this package hands out already has it.
        connection.del_prepared_statement(stmt);
    }
}

function execute(connection: Gda.Connection, stmt: Gda.Statement, params: Gda.Set | null): Gda.DataModel | null {
    if (stmt.get_statement_type() === Gda.SqlStatementType.SELECT) {
        return connection.statement_execute_select(stmt, params);
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
