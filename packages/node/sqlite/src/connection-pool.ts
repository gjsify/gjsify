// The one owner of every Gda.Connection this process opens.
// Reference: Node.js lib/sqlite.js
// Reimplemented for GJS using Gda-6.0

import type Gda from '@girs/gda-6.0';
import Gio from '@girs/gio-2.0';
import { executeStatement, integerColumns } from './execution.ts';
import { parseSql } from './parse-sql.ts';

/**
 * Why a libgda SQLite connection is NEVER closed and NEVER dropped.
 *
 * `gda_sqlite_provider_open_connection()` allocates the connection's provider data with
 * `cdata = g_new0 (SqliteConnectionData, 1); g_weak_ref_init (&cdata->provider, prov)`
 * (`libgda/sqlite/gda-sqlite-provider.c:1210` at LIBGDA_6_0_0), and the matching teardown
 * `gda_sqlite_free_cnc_data()` ends in a bare `g_free (cdata)` with no `g_weak_ref_clear()`
 * (same file, :4291). GLib keeps an object's GWeakRefs in a list ON the object, so the
 * freed `cdata`'s slot stays registered on the `GdaSqliteProvider` — which is a
 * session-wide singleton (`gda_config_get_provider()` caches it in `ip->instance`). Three
 * ways that kills the process, all measured on GJS 1.88.1 + libgda 6.0.0 + GLib 2.90.0:
 *
 * - The next connection's `cdata` gets the same malloc block back, so `g_weak_ref_init`
 *   re-registers an address the list already holds and GLib aborts:
 *   `gobject.c:6103:_weak_ref_set: assertion failed: (weak_ref_data_list_find
 *   (new_wrdata, weak_ref) < 0)`. At the SECOND connection, deterministically.
 * - Where that assertion is compiled out (a GLib without `G_ENABLE_DEBUG`), the duplicate
 *   is added instead and the list grows by one per connection ever released, until
 *   `weak_ref_data_list_add()` refuses at 65535 with "Too many GWeakRef registered".
 *   Prepared statements then come back with no provider and reads answer
 *   `fuzzy_get_gtype: assertion 'prov != NULL' failed` — a CRITICAL, not an error.
 * - The provider can afterwards never be destroyed: `weak_ref_data_clear_list()` writes
 *   NULL through every registered slot, dereferences the freed block, and aborts with
 *   `gobject.c:5982 … (G_IS_OBJECT (_weak_ref_clean_pointer (ptr)))`.
 *
 * `Gda.Connection.close()` frees the `cdata`, and so does the connection's own finalizer —
 * so REFRAINING from close() is not enough: a connection the garbage collector reaps
 * aborts the process just the same (measured: 40 open-and-forget cycles, abort at the
 * second). Hence this module holds a STRONG reference to every connection from the moment
 * it is created, and `DatabaseSync` never calls `close()` on one.
 *
 * Giving each connection its own provider instance is not the way out either: such a
 * provider can never be released, and GJS releases every wrapped GObject at context
 * teardown — which turns the abort at open into an abort at exit. GJS also blocks
 * `g_object_ref()`, `set_data()` and every other refcounting escape from JS.
 *
 * The leak is bounded by handing a parked connection out again, but only on PROOF that it
 * is equivalent to a fresh one (see `acquire`). An idle connection costs ~120 KB.
 */
const everOpened = new Set<Gda.Connection>();

/** Parked connections per key, with the file identity each was opened against. */
const parked = new Map<string, Parked[]>();

interface Parked {
    connection: Gda.Connection;
    /** `id::file` of the database file when it was parked; null for `:memory:`. */
    fileId: string | null;
}

export interface PoolKey {
    /** The database path as the caller gave it — `:memory:` or a file path. */
    path: string;
    isMemory: boolean;
    readOnly: boolean;
}

function keyOf(key: PoolKey): string {
    return `${key.readOnly ? 'ro' : 'rw'}\u0000${key.path}`;
}

/**
 * The file's identity, or null when it does not exist.
 *
 * `id::file` is what tells a recreated database from the one a connection is attached to:
 * a consumer that closes a database, deletes the file and opens the path again must get
 * the empty database it asked for, not the rows the parked connection still holds.
 */
function fileIdentity(path: string): string | null {
    const file = Gio.File.new_for_path(path);
    try {
        return file
            .query_info(Gio.FILE_ATTRIBUTE_ID_FILE, Gio.FileQueryInfoFlags.NONE, null)
            .get_attribute_string(Gio.FILE_ATTRIBUTE_ID_FILE);
    } catch {
        // query_info is `throws="1"` and raises G_IO_ERROR_NOT_FOUND for a path that is
        // not there — the normal case for a database about to be created.
        return null;
    }
}

function exec(connection: Gda.Connection, sql: string): void {
    const [stmt] = parseSql(connection, sql);
    executeStatement(connection, stmt, null, () => undefined);
}

/**
 * Every row of a SELECT with `columnCount` columns, as text.
 *
 * The count must be passed, and it is what makes the rows READABLE at all: without a
 * `ColumnTypes` the execution is a forward cursor, whose `get_n_rows()` is **-1** — so a
 * `row < get_n_rows()` loop runs zero times and the query answers "no rows" for every
 * input. That is not a wrong number but a wrong ANSWER here: the wipe below then drops
 * nothing and `isPristine()` passes on whatever the consumer left behind, which is how a
 * parked connection handed `table t already exists` to the next caller.
 */
function query(connection: Gda.Connection, sql: string, columnCount: number): string[][] {
    const [stmt] = parseSql(connection, sql);
    return executeStatement(
        connection,
        stmt,
        null,
        (model) => {
            if (!model) return [];
            const rows: string[][] = [];
            for (let row = 0; row < model.get_n_rows(); row++) {
                const cells: string[] = [];
                for (let col = 0; col < model.get_n_columns(); col++) {
                    cells.push(String(model.get_value_at(col, row)));
                }
                rows.push(cells);
            }
            return rows;
        },
        integerColumns(columnCount),
    );
}

const DROP_KEYWORD: Record<string, string> = { table: 'TABLE', view: 'VIEW', index: 'INDEX', trigger: 'TRIGGER' };

/** Schema objects a consumer created, in an order that drops dependants first. */
function userObjects(connection: Gda.Connection, schema: string): string[][] {
    return query(
        connection,
        `SELECT type, name FROM ${schema} WHERE name NOT LIKE 'sqlite_%'
         ORDER BY CASE type WHEN 'trigger' THEN 0 WHEN 'view' THEN 1 WHEN 'index' THEN 2 ELSE 3 END`,
        2,
    );
}

/**
 * Return a `:memory:` connection to the state a freshly opened one has.
 *
 * Repeated because one DROP can take several objects with it — a virtual table's shadow
 * tables, an index on a dropped table — so the list goes stale mid-pass. The loop ends on
 * the first pass that drops nothing, which is also what makes an undroppable object
 * (`sqlite_sequence`, left behind by AUTOINCREMENT and refused by DROP TABLE) terminate it
 * rather than spin.
 */
function wipeMemory(connection: Gda.Connection): void {
    for (const schema of ['sqlite_master', 'sqlite_temp_master']) {
        for (;;) {
            const objects = userObjects(connection, schema);
            if (objects.length === 0) break;
            let dropped = 0;
            for (const [type, name] of objects) {
                const keyword = DROP_KEYWORD[type];
                if (!keyword) continue;
                try {
                    exec(connection, `DROP ${keyword} IF EXISTS "${name.replace(/"/g, '""')}"`);
                    dropped++;
                } catch {
                    // Already gone with something this pass dropped before it, or refused
                    // (an internal table). Either way the next pass decides.
                }
            }
            if (dropped === 0) break;
        }
    }
    exec(connection, 'PRAGMA user_version = 0');
    exec(connection, 'PRAGMA application_id = 0');
}

/**
 * Is this connection indistinguishable from a freshly opened `:memory:` database?
 *
 * Only then may it be handed out again. `sqlite_sequence` is the measured case that fails
 * here: SQLite creates it for the first AUTOINCREMENT column and refuses to drop it, so
 * such a connection stays parked and unused for the life of the process — leaking it is
 * the only disposal libgda leaves us.
 */
function isPristine(connection: Gda.Connection): boolean {
    for (const schema of ['sqlite_master', 'sqlite_temp_master']) {
        if (query(connection, `SELECT name FROM ${schema}`, 1).length > 0) return false;
    }
    for (const pragma of ['pragma_user_version()', 'pragma_application_id()']) {
        const [row] = query(connection, `SELECT * FROM ${pragma}`, 1);
        if (!row || row[0] !== '0') return false;
    }
    return true;
}

/** Undo a transaction the consumer left open, so the next user starts outside one. */
function rollbackIfNeeded(connection: Gda.Connection): void {
    if (!connection.get_transaction_status()) return;
    exec(connection, 'ROLLBACK');
}

/**
 * A connection for `key` — a parked one proven equivalent to a fresh one, or a new one
 * from `create`.
 *
 * The caller's `create` is what knows the connection string; this module only owns the
 * lifetime. A connection it returns is registered before it is handed out, so even a
 * caller that drops it on the floor cannot let the garbage collector finalize it.
 */
export function acquire(key: PoolKey, create: () => Gda.Connection): Gda.Connection {
    const slot = parked.get(keyOf(key));
    const wanted = key.isMemory ? null : fileIdentity(key.path);
    while (slot && slot.length > 0) {
        const candidate = slot.pop()!;
        // A file database IS its file: the same inode means the same database, and a
        // different one (or none) means the parked connection answers for a database the
        // caller did not ask for. A `:memory:` one was proven pristine when it was parked.
        if (key.isMemory || (wanted !== null && candidate.fileId === wanted)) {
            return candidate.connection;
        }
    }
    const connection = create();
    everOpened.add(connection);
    return connection;
}

/**
 * Take a connection back from a `DatabaseSync` that is done with it.
 *
 * Never closes it (see the note at the top of this file). A `:memory:` connection is
 * wiped and parked only if it verifies as pristine afterwards; a file connection is parked
 * with the identity of the file it is attached to.
 */
export function release(key: PoolKey, connection: Gda.Connection): void {
    try {
        rollbackIfNeeded(connection);
        if (key.isMemory) {
            wipeMemory(connection);
            if (!isPristine(connection)) return;
        }
        const slotKey = keyOf(key);
        const slot = parked.get(slotKey) ?? [];
        slot.push({ connection, fileId: key.isMemory ? null : fileIdentity(key.path) });
        parked.set(slotKey, slot);
    } catch {
        // A connection whose state could not be read back is not proven equivalent to a
        // fresh one, so it is not parked. `everOpened` still holds it: dropping it would
        // let the garbage collector finalize it and abort the process.
    }
}
