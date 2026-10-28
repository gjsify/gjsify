/*
 * GjsifySqlite.Database — a libsqlite3 connection, introspectable.
 *
 * This bridge is DELIBERATELY THIN. Everything `node:sqlite` promises on top of
 * sqlite — statement caching, the `DatabaseSync`/`StatementSync` surface, the
 * JS value coercions, `readBigInts`, the error class hierarchy — belongs to
 * `@gjsify/sqlite` and lives in TypeScript. What cannot live there is the part
 * that needs a C pointer: a prepared `sqlite3_stmt` with bindings and a column
 * cursor. So this file exposes exactly that and nothing it can avoid.
 *
 * Errors travel as a GLib.Error in the {@link GjsifySqlite.SqliteError} domain
 * whose `code` is sqlite's EXTENDED result code (2067, not 19) — GJS surfaces
 * that unchanged on the thrown exception, which is the only reason the JS layer
 * can rebuild Node's `err.errcode` without a second round trip.
 */

namespace GjsifySqlite {

    /**
     * The error domain every failure here is reported in.
     *
     * The enumerated member is a formality: the `code` carried by a thrown
     * error is never FAILED but sqlite's own extended result code, so that the
     * JS layer sees what `sqlite3_extended_errcode()` saw. Only the DOMAIN is
     * load-bearing — see {@link sqlite_error}.
     */
    public errordomain SqliteError {
        FAILED
    }

    /**
     * Mint an error in the {@link SqliteError} domain carrying @code.
     *
     * Vala offers no way to name an errordomain's quark, and its `throw new
     * SqliteError.FAILED (…)` form can only produce the enumerated code — which
     * is the one value that tells the JS layer nothing. Constructing the error
     * and then overwriting its public `code` field is how both halves are had
     * at once: the domain Vala generated, and sqlite's own result code.
     */
    internal SqliteError sqlite_error (int code, string message) {
        var error = new SqliteError.FAILED ("%s", message);
        error.code = code;
        return error;
    }

    /** How {@link Database.open} should treat a missing or read-only file. */
    public enum OpenMode {
        /** Open an existing database for reading; fail if it does not exist. */
        READONLY,
        /** Open an existing database for writing; fail if it does not exist. */
        READWRITE,
        /** Open for writing, creating the database when it does not exist. */
        READWRITE_CREATE
    }

    /** What {@link Statement.step} found. Anything else is thrown. */
    public enum StepResult {
        /** A row is available; the column accessors may be read. */
        ROW,
        /** The statement ran to completion and has no (more) rows. */
        DONE
    }

    /** The storage class of a value in the current row. */
    public enum ColumnType {
        INTEGER,
        FLOAT,
        TEXT,
        BLOB,
        NULL
    }

    /**
     * A connection to a SQLite database.
     *
     * Obtained from {@link Database.open}; there is no public constructor,
     * because an instance without a handle has no useful state.
     */
    public class Database : GLib.Object {

        private Sqlite.Database? handle = null;

        /**
         * Every statement prepared from this connection and not yet closed.
         *
         * Entries are UNOWNED: the reference runs the other way, each
         * {@link Statement} holding a strong ref on its database. That
         * direction is what makes the teardown order safe — a connection
         * cannot be finalized while a statement can still reach its handle —
         * and this list exists only so {@link close} can reach the statements
         * it must finalize first.
         */
        private GLib.List<unowned Statement> live = new GLib.List<unowned Statement> ();

        /** Whether the connection is still usable. */
        public bool is_open {
            get { return this.handle != null; }
        }

        /**
         * ROWID of the most recent successful INSERT, or 0 when there was none
         * — and 0 on a closed connection, since a property cannot throw.
         */
        public int64 last_insert_rowid {
            get {
                if (this.handle == null) {
                    return 0;
                }
                return this.handle.last_insert_rowid ();
            }
        }

        /**
         * Rows changed by the most recent INSERT/UPDATE/DELETE.
         *
         * `sqlite3_changes64`, not `sqlite3_changes`: the 32-bit one truncates
         * a bulk UPDATE's count silently, and a wrong number is worse here than
         * no number.
         */
        public int64 changes {
            get {
                if (this.handle == null) {
                    return 0;
                }
                return GjsifySqliteCompat.changes64 (this.handle);
            }
        }

        /**
         * Whether an explicit transaction is open.
         *
         * `sqlite3_get_autocommit()` answers the inverse — autocommit is ON
         * exactly when no transaction is pending — so the sense is flipped here
         * rather than in every caller.
         */
        public bool in_transaction {
            get {
                if (this.handle == null) {
                    return false;
                }
                return this.handle.get_autocommit () == 0;
            }
        }

        /**
         * Open a database file.
         *
         * @param path     filesystem path, `:memory:`, or a URI when @uri
         * @param mode     which of the three useful `SQLITE_OPEN_*` combinations
         * @param uri      interpret @path as a `file:` URI with query parameters
         */
        public static Database open (string path,
                                     OpenMode mode = OpenMode.READWRITE_CREATE,
                                     bool uri = false) throws SqliteError {
            int flags;
            switch (mode) {
                case OpenMode.READONLY:
                    flags = Sqlite.OPEN_READONLY;
                    break;
                case OpenMode.READWRITE:
                    flags = Sqlite.OPEN_READWRITE;
                    break;
                default:
                    flags = Sqlite.OPEN_READWRITE | Sqlite.OPEN_CREATE;
                    break;
            }
            if (uri) {
                flags |= Sqlite.OPEN_URI;
            }

            Sqlite.Database opened;
            int rc = Sqlite.Database.open_v2 (path, out opened, flags, null);

            if (rc != Sqlite.OK) {
                // sqlite hands back a handle even for most failures, and it is
                // the only thing that knows WHY. Reading the message off it
                // before it goes out of scope (where the vapi's free function
                // closes it) is the difference between "unable to open database
                // file" and bare "error 14".
                string message;
                int code;
                if (opened != null) {
                    message = opened.errmsg ();
                    code = GjsifySqliteCompat.extended_errcode (opened);
                } else {
                    message = GjsifySqliteCompat.errstr (rc);
                    code = rc;
                }
                throw sqlite_error ((code & 0xff) == rc ? code : rc, message);
            }

            // Without this, errcode() and extended_errcode() answer the same
            // primary code and the JS layer can never tell SQLITE_CONSTRAINT
            // from SQLITE_CONSTRAINT_UNIQUE.
            opened.extended_result_codes (1);

            var db = new Database ();
            db.handle = (owned) opened;
            return db;
        }

        /**
         * Run one or more statements, discarding any rows.
         *
         * This is `sqlite3_exec`, so it accepts a whole script — the JS layer
         * uses it for `DatabaseSync.exec()`.
         */
        public void exec (string sql) throws SqliteError {
            unowned Sqlite.Database h = this.require_handle ();
            string? message = null;
            int rc = h.exec (sql, null, out message);
            if (rc != Sqlite.OK) {
                throw this.make_error (rc, message);
            }
        }

        /**
         * Compile the FIRST statement in @sql.
         *
         * Text after that statement is ignored, exactly as `sqlite3_prepare_v2`
         * ignores it; callers wanting a script want {@link exec}.
         */
        public Statement prepare (string sql) throws SqliteError {
            unowned Sqlite.Database h = this.require_handle ();

            Sqlite.Statement compiled;
            int rc = h.prepare_v2 (sql, -1, out compiled);
            if (rc != Sqlite.OK) {
                throw this.make_error (rc);
            }
            if (compiled == null) {
                // SQLITE_OK with a null statement is how sqlite reports input
                // that held only whitespace or a comment. Node raises here, so
                // the bridge does too rather than hand back a statement whose
                // every method would misuse-fail.
                throw sqlite_error (Sqlite.ERROR,
                                    "the SQL text contains no statement");
            }

            return new Statement (this, (owned) compiled);
        }

        /**
         * Close the connection. Idempotent.
         *
         * Every statement still open is finalized FIRST: the vapi binds the
         * plain `sqlite3_close`, which refuses a connection with outstanding
         * statements and would leave the handle leaked with only a warning.
         * Draining the list here is what lets this bridge do without
         * `sqlite3_close_v2`.
         */
        public void close () {
            if (this.handle == null) {
                return;
            }

            // Emptied before the loop so that each statement's unregister()
            // becomes a no-op and cannot mutate a list being walked.
            GLib.List<unowned Statement> pending = (owned) this.live;
            this.live = new GLib.List<unowned Statement> ();

            foreach (unowned Statement stmt in pending) {
                stmt.close ();
            }

            this.handle = null;
        }

        internal void register (Statement stmt) {
            this.live.prepend (stmt);
        }

        internal void unregister (Statement stmt) {
            this.live.remove (stmt);
        }

        /**
         * Build — not throw — the error for a failed call on this connection.
         *
         * Returning it keeps Vala's flow analysis satisfied at the call sites,
         * which all spell `throw this.make_error (rc)` and so still read as the
         * exits they are.
         */
        internal SqliteError make_error (int rc, string? message = null) {
            int code = rc;
            string text;

            if (this.handle != null) {
                // The extended code belongs to the CONNECTION, not to the call,
                // so it only describes this failure when its low byte is the
                // primary code the call just returned.
                int extended = GjsifySqliteCompat.extended_errcode (this.handle);
                if ((extended & 0xff) == rc) {
                    code = extended;
                }
            }

            if (message != null) {
                text = message;
            } else if (this.handle != null) {
                text = this.handle.errmsg ();
            } else {
                text = GjsifySqliteCompat.errstr (rc);
            }

            return sqlite_error (code, text);
        }

        private unowned Sqlite.Database require_handle () throws SqliteError {
            if (this.handle == null) {
                throw sqlite_error (Sqlite.MISUSE, "database is not open");
            }
            return this.handle;
        }
    }
}
