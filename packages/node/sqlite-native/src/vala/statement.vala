/*
 * GjsifySqlite.Statement — one compiled `sqlite3_stmt`, introspectable.
 *
 * Parameters are addressed by their 1-BASED sqlite index throughout, never by
 * name: resolving `:foo` to an index is `bind_parameter_index()`, which is
 * exposed so the JS layer can do that mapping once per statement instead of
 * once per bind.
 */

namespace GjsifySqlite {

    /**
     * A prepared statement, obtained from {@link Database.prepare}.
     *
     * The instance holds a STRONG reference to its database. That is what makes
     * the object graph safe in a garbage-collected host: GJS finalizes in no
     * order anyone can predict, and without the ref a collected `Database`
     * would close the connection under a statement that is still reachable from
     * JS. With it, the connection outlives every statement by construction.
     */
    public class Statement : GLib.Object {

        private Database? owner;
        private Sqlite.Statement? stmt;

        internal Statement (Database owner, owned Sqlite.Statement stmt) {
            this.owner = owner;
            this.stmt = (owned) stmt;
            owner.register (this);
        }

        ~Statement () {
            this.release ();
        }

        /** Whether the statement is still compiled and usable. */
        public bool is_valid {
            get { return this.stmt != null; }
        }

        /** Number of result columns; 0 for a statement that returns no rows. */
        public int column_count {
            get {
                if (this.stmt == null) {
                    return 0;
                }
                return this.stmt.column_count ();
            }
        }

        /** Highest 1-based parameter index used by the statement. */
        public int bind_parameter_count {
            get {
                if (this.stmt == null) {
                    return 0;
                }
                return this.stmt.bind_parameter_count ();
            }
        }

        /** The SQL text this statement was compiled from. */
        public string? sql {
            owned get {
                if (this.stmt == null) {
                    return null;
                }
                return this.stmt.sql ();
            }
        }

        /** The SQL text with current bindings substituted in, for diagnostics. */
        public string? expanded_sql {
            owned get {
                if (this.stmt == null) {
                    return null;
                }
                return this.stmt.expanded_sql ();
            }
        }

        /**
         * Finalize the statement. Idempotent, and safe after the database was
         * closed — {@link Database.close} calls exactly this on every statement
         * it still knows about.
         */
        public void close () {
            this.release ();
        }

        public void bind_null (int index) throws SqliteError {
            this.check (this.require_stmt ().bind_null (index));
        }

        public void bind_int64 (int index, int64 value) throws SqliteError {
            this.check (this.require_stmt ().bind_int64 (index, value));
        }

        public void bind_double (int index, double value) throws SqliteError {
            this.check (this.require_stmt ().bind_double (index, value));
        }

        public void bind_text (int index, string value) throws SqliteError {
            // The vapi's `bind_text` overload takes an OWNED string and hands
            // sqlite `g_free` as the destructor, so the copy outlives this
            // frame. The raw binding's default is SQLITE_STATIC, which would
            // leave sqlite pointing at a freed buffer.
            this.check (this.require_stmt ().bind_text (index, value));
        }

        /**
         * Bind a BLOB.
         *
         * The bytes are COPIED. SQLITE_TRANSIENT — the sentinel that asks
         * sqlite to copy for us — is a cast of -1 to a function pointer that
         * Vala has no way to spell, and the alternative the binding defaults to
         * (SQLITE_STATIC) would have sqlite read @value's buffer long after
         * this frame and possibly the GLib.Bytes are gone.
         */
        public void bind_blob (int index, GLib.Bytes value) throws SqliteError {
            unowned Sqlite.Statement s = this.require_stmt ();
            size_t size = value.get_size ();

            if (size == 0) {
                // sqlite3_bind_blob with a null pointer binds NULL, not an
                // empty blob, and a zero-length GLib.Bytes has no data pointer.
                // bind_zeroblob(0) is how sqlite spells "a BLOB of no bytes".
                this.check (s.bind_zeroblob (index, 0));
                return;
            }

            if (size > int.MAX) {
                throw sqlite_error (Sqlite.TOOBIG,
                                    "blob exceeds the maximum size sqlite can bind");
            }

            void* copy = GLib.malloc (size);
            GLib.Memory.copy (copy, value.get_data (), size);
            // sqlite invokes the destructor even when the bind itself fails, so
            // the failing path below leaks nothing.
            this.check (s.bind_blob (index, copy, (int) size, GLib.g_free));
        }

        /** 1-based index of a named parameter, or 0 when there is no such name. */
        public int bind_parameter_index (string name) throws SqliteError {
            return this.require_stmt ().bind_parameter_index (name);
        }

        /** Name of a 1-based parameter, or %null for a positional `?`. */
        public string? bind_parameter_name (int index) throws SqliteError {
            unowned string? name = this.require_stmt ().bind_parameter_name (index);
            return name;
        }

        /** Reset every binding to NULL without recompiling the statement. */
        public void clear_bindings () throws SqliteError {
            this.check (this.require_stmt ().clear_bindings ());
        }

        /**
         * Advance the cursor.
         *
         * @return ROW when column values are available, DONE at the end
         */
        public StepResult step () throws SqliteError {
            int rc = this.require_stmt ().step ();
            if (rc == Sqlite.ROW) {
                return StepResult.ROW;
            }
            if (rc == Sqlite.DONE) {
                return StepResult.DONE;
            }
            throw this.owner.make_error (rc);
        }

        /**
         * Rewind the statement so it can run again. Bindings are KEPT, matching
         * `sqlite3_reset`; {@link clear_bindings} drops them.
         */
        public void reset () throws SqliteError {
            // sqlite3_reset answers the error code of the statement's LAST run,
            // which the caller has already been told about. Re-raising it here
            // would report the same failure twice, so only the reset itself is
            // checked — and it cannot fail on its own.
            this.require_stmt ().reset ();
        }

        /** Name of a 0-based result column, as the SELECT labelled it. */
        public string? column_name (int index) throws SqliteError {
            unowned string? name = this.require_stmt ().column_name (index);
            return name;
        }

        /**
         * The column's declared type from CREATE TABLE, or %null for an
         * expression column. The JS layer needs it to apply type affinity.
         */
        public string? column_decltype (int index) throws SqliteError {
            unowned string? decl = GjsifySqliteCompat.column_decltype (this.require_stmt (), index);
            return decl;
        }

        /** Storage class of the value in the current row. */
        public ColumnType column_type (int index) throws SqliteError {
            int type = this.require_stmt ().column_type (index);

            // if/else rather than a switch: these are C macros reaching Vala as
            // vapi constants, not case labels it will fold.
            if (type == Sqlite.INTEGER) {
                return ColumnType.INTEGER;
            }
            if (type == Sqlite.FLOAT) {
                return ColumnType.FLOAT;
            }
            if (type == Sqlite.TEXT) {
                return ColumnType.TEXT;
            }
            if (type == Sqlite.BLOB) {
                return ColumnType.BLOB;
            }
            return ColumnType.NULL;
        }

        public int64 column_int64 (int index) throws SqliteError {
            return this.require_stmt ().column_int64 (index);
        }

        public double column_double (int index) throws SqliteError {
            return this.require_stmt ().column_double (index);
        }

        public string? column_text (int index) throws SqliteError {
            unowned string? text = this.require_stmt ().column_text (index);
            return text;
        }

        /**
         * The column's bytes, copied into a fresh GLib.Bytes.
         *
         * A copy is not optional: sqlite's pointer is invalidated by the next
         * step/reset/finalize, and GJS hands a GLib.Bytes to JS that may well
         * outlive all three.
         */
        public GLib.Bytes column_blob (int index) throws SqliteError {
            unowned Sqlite.Statement s = this.require_stmt ();

            // Order matters: sqlite3_column_blob may convert the value, and
            // sqlite3_column_bytes only reports the post-conversion length once
            // it has. Asking for the length first can answer for the old type.
            void* data = s.column_blob (index);
            int size = s.column_bytes (index);

            if (data == null || size <= 0) {
                return new GLib.Bytes (new uint8[0]);
            }

            uint8[] copy = new uint8[size];
            GLib.Memory.copy (copy, data, (size_t) size);
            return new GLib.Bytes.take ((owned) copy);
        }

        private void release () {
            // Dropping the field runs the vapi's free function, sqlite3_finalize.
            this.stmt = null;

            if (this.owner != null) {
                this.owner.unregister (this);
                this.owner = null;
            }
        }

        private unowned Sqlite.Statement require_stmt () throws SqliteError {
            if (this.stmt == null) {
                throw sqlite_error (Sqlite.MISUSE, "statement is finalized");
            }
            return this.stmt;
        }

        private void check (int rc) throws SqliteError {
            if (rc == Sqlite.OK) {
                return;
            }
            throw this.owner.make_error (rc);
        }
    }
}
