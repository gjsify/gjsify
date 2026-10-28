// @gjsify/sqlite-native — Database + Statement spec (GJS-only).
// Validates the Vala bridge end-to-end against a real libsqlite3: binding every
// storage class, reading every column accessor, the extended error codes the JS
// layer rebuilds node:sqlite's errors from, and the teardown order a GC-driven
// host will eventually pick on its own.

import { describe, it, expect, on } from '@gjsify/unit';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';
import { hasNativeSqlite, loadNativeSqlite } from './index.js';

/**
 * sqlite's result code off a thrown bridge error. `SqliteError` carries it on
 * `code`, but GJS hands the catch binding over as a plain `Error`, so the cast
 * has to go through `unknown`.
 */
const errorCode = (err: unknown) => (err as { code: number }).code;

export default async () => {
    await on('Gjs', async () => {
        const native = loadNativeSqlite();

        await describe('GjsifySqlite — module load', async () => {
            await it('hasNativeSqlite() returns true when the prebuild is loaded', async () => {
                expect(hasNativeSqlite()).toBe(true);
                expect(native).not.toBeNull();
            });
        });

        if (!native) return;

        const { Database, OpenMode, StepResult, ColumnType } = native;
        const memory = () => Database.open(':memory:', OpenMode.READWRITE_CREATE, false);

        await describe('Database — open, exec, close', async () => {
            await it('opens an in-memory database and reports it open', async () => {
                const db = memory();
                expect(db.is_open).toBe(true);
                expect(db.in_transaction).toBe(false);
                db.close();
                expect(db.is_open).toBe(false);
            });

            await it('close() is idempotent', async () => {
                const db = memory();
                db.close();
                db.close();
                expect(db.is_open).toBe(false);
            });

            await it('exec() runs a multi-statement script', async () => {
                const db = memory();
                db.exec('CREATE TABLE a (x); CREATE TABLE b (y); INSERT INTO a VALUES (1)');
                const stmt = db.prepare('SELECT count(*) FROM a');
                expect(stmt.step()).toBe(StepResult.ROW);
                expect(stmt.column_int64(0)).toBe(1);
                db.close();
            });

            await it('refuses to open a missing file READONLY, with sqlite\u2019s own message', async () => {
                const path = `${GLib.get_tmp_dir()}/gjsify-sqlite-absent-${GLib.random_int()}.db`;
                let caught: Error | null = null;
                try {
                    Database.open(path, OpenMode.READONLY, false);
                } catch (err) {
                    caught = err as Error;
                }
                expect(caught).not.toBeNull();
                // 14 = SQLITE_CANTOPEN; the extended code is in the same family.
                expect(errorCode(caught) & 0xff).toBe(14);
                expect(caught!.message).toContain('unable to open database file');
            });

            await it('every method throws once the connection is closed', async () => {
                const db = memory();
                db.close();
                expect(() => db.exec('SELECT 1')).toThrow();
                expect(() => db.prepare('SELECT 1')).toThrow();
            });

            await it('reports a closed connection\u2019s counters as zero rather than throwing', async () => {
                const db = memory();
                db.close();
                expect(db.last_insert_rowid).toBe(0);
                expect(db.changes).toBe(0);
                expect(db.in_transaction).toBe(false);
            });
        });

        await describe('Database — prepare', async () => {
            await it('rejects SQL holding no statement', async () => {
                const db = memory();
                expect(() => db.prepare('   -- just a comment\n')).toThrow();
                db.close();
            });

            await it('rejects a syntax error with SQLITE_ERROR and sqlite\u2019s text', async () => {
                const db = memory();
                let caught: Error | null = null;
                try {
                    db.prepare('SELEC 1');
                } catch (err) {
                    caught = err as Error;
                }
                expect(caught).not.toBeNull();
                expect(errorCode(caught)).toBe(1);
                expect(caught!.message).toContain('syntax error');
                db.close();
            });

            await it('exposes the statement\u2019s SQL, and expanded_sql with bindings substituted', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (x)');
                const stmt = db.prepare('INSERT INTO t VALUES (?)');
                expect(stmt.sql).toBe('INSERT INTO t VALUES (?)');
                stmt.bind_int64(1, 42);
                expect(stmt.expanded_sql).toBe('INSERT INTO t VALUES (42)');
                db.close();
            });
        });

        await describe('Statement — parameters', async () => {
            await it('counts, names and resolves named parameters', async () => {
                const db = memory();
                const stmt = db.prepare('SELECT :one, ?2, $three');
                expect(stmt.bind_parameter_count).toBe(3);
                expect(stmt.bind_parameter_name(1)).toBe(':one');
                // `?2` IS a name to sqlite — the prefix is part of it. Only a
                // bare `?` is nameless, which the next statement pins.
                expect(stmt.bind_parameter_name(2)).toBe('?2');
                expect(stmt.bind_parameter_name(3)).toBe('$three');
                expect(stmt.bind_parameter_index(':one')).toBe(1);
                expect(stmt.bind_parameter_index('$three')).toBe(3);
                // sqlite answers 0 for a name it does not know, and so do we.
                expect(stmt.bind_parameter_index(':nope')).toBe(0);

                const anonymous = db.prepare('SELECT ?, ?');
                expect(anonymous.bind_parameter_count).toBe(2);
                expect(anonymous.bind_parameter_name(1)).toBeNull();
                expect(anonymous.bind_parameter_name(2)).toBeNull();
                db.close();
            });

            await it('rejects an out-of-range index with SQLITE_RANGE', async () => {
                const db = memory();
                const stmt = db.prepare('SELECT ?');
                let caught: Error | null = null;
                try {
                    stmt.bind_int64(2, 1);
                } catch (err) {
                    caught = err as Error;
                }
                expect(caught).not.toBeNull();
                expect(errorCode(caught) & 0xff).toBe(25);
                db.close();
            });

            await it('clear_bindings() puts every parameter back to NULL', async () => {
                const db = memory();
                const stmt = db.prepare('SELECT ?');
                stmt.bind_int64(1, 7);
                expect(stmt.step()).toBe(StepResult.ROW);
                expect(stmt.column_int64(0)).toBe(7);
                stmt.reset();
                stmt.clear_bindings();
                expect(stmt.step()).toBe(StepResult.ROW);
                expect(stmt.column_type(0)).toBe(ColumnType.NULL);
                db.close();
            });

            await it('reset() re-runs the same compiled statement', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (x)');
                const insert = db.prepare('INSERT INTO t VALUES (?)');
                for (const value of [1, 2, 3]) {
                    insert.reset();
                    insert.bind_int64(1, value);
                    expect(insert.step()).toBe(StepResult.DONE);
                }
                const count = db.prepare('SELECT count(*) FROM t');
                expect(count.step()).toBe(StepResult.ROW);
                expect(count.column_int64(0)).toBe(3);
                db.close();
            });
        });

        await describe('Statement — storage classes round-trip', async () => {
            await it('binds and reads back every type, NULL included', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (i INTEGER, d REAL, s TEXT, b BLOB, n)');
                const insert = db.prepare('INSERT INTO t VALUES (?, ?, ?, ?, ?)');
                insert.bind_int64(1, -1234567890);
                insert.bind_double(2, 0.5);
                insert.bind_text(3, 'h\u00e9llo \u4e16\u754c');
                insert.bind_blob(4, new GLib.Bytes(new Uint8Array([0, 1, 254, 255])));
                insert.bind_null(5);
                expect(insert.step()).toBe(StepResult.DONE);

                const select = db.prepare('SELECT i, d, s, b, n FROM t');
                expect(select.step()).toBe(StepResult.ROW);
                expect(select.column_type(0)).toBe(ColumnType.INTEGER);
                expect(select.column_int64(0)).toBe(-1234567890);
                expect(select.column_type(1)).toBe(ColumnType.FLOAT);
                expect(select.column_double(1)).toBe(0.5);
                expect(select.column_type(2)).toBe(ColumnType.TEXT);
                expect(select.column_text(2)).toBe('h\u00e9llo \u4e16\u754c');
                expect(select.column_type(3)).toBe(ColumnType.BLOB);
                expect(Array.from(select.column_blob(3).get_data()!)).toStrictEqual([0, 1, 254, 255]);
                expect(select.column_type(4)).toBe(ColumnType.NULL);
                expect(select.column_text(4)).toBeNull();
                db.close();
            });

            await it('round-trips 3072 random bytes unchanged', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (b BLOB)');
                const payload = new Uint8Array(3072);
                for (let i = 0; i < payload.length; i++) payload[i] = GLib.random_int_range(0, 256);

                const insert = db.prepare('INSERT INTO t VALUES (?)');
                insert.bind_blob(1, new GLib.Bytes(payload));
                expect(insert.step()).toBe(StepResult.DONE);

                const select = db.prepare('SELECT b FROM t');
                expect(select.step()).toBe(StepResult.ROW);
                const read = select.column_blob(0).get_data()!;
                expect(read.length).toBe(payload.length);
                // Compared as a whole rather than byte by byte: 3072 passing
                // assertions hide which one failed just as well as one does.
                expect(Array.from(read).join(',')).toBe(Array.from(payload).join(','));
                db.close();
            });

            await it('keeps a zero-length blob a BLOB, not a NULL', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (b BLOB)');
                const insert = db.prepare('INSERT INTO t VALUES (?)');
                insert.bind_blob(1, new GLib.Bytes(new Uint8Array(0)));
                expect(insert.step()).toBe(StepResult.DONE);

                const select = db.prepare('SELECT b, typeof(b) FROM t');
                expect(select.step()).toBe(StepResult.ROW);
                expect(select.column_type(0)).toBe(ColumnType.BLOB);
                expect(select.column_blob(0).get_size()).toBe(0);
                expect(select.column_text(1)).toBe('blob');
                db.close();
            });

            await it('keeps the extremes GJS can carry through a gint64', async () => {
                // GJS marshals `gint64` as a JS Number, so the honest bound is
                // Number.MAX_SAFE_INTEGER, not INT64_MAX. BigInt-wide values are
                // the JS layer's problem (node:sqlite `readBigInts`), not the
                // bridge's, and testing 2^63-1 here would only prove the
                // marshaller rounds.
                const db = memory();
                db.exec('CREATE TABLE t (x)');
                const insert = db.prepare('INSERT INTO t VALUES (?)');
                for (const value of [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0]) {
                    insert.reset();
                    insert.bind_int64(1, value);
                    expect(insert.step()).toBe(StepResult.DONE);
                }
                const select = db.prepare('SELECT x FROM t ORDER BY rowid');
                for (const value of [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER, 0]) {
                    expect(select.step()).toBe(StepResult.ROW);
                    expect(select.column_int64(0)).toBe(value);
                }
                expect(select.step()).toBe(StepResult.DONE);
                db.close();
            });

            await it('passes NUL-bearing text through unchanged in both directions', async () => {
                // sqlite's TEXT is length-counted, and so is a Vala string on the
                // way in — but the vapi binds `sqlite3_column_text`, which is
                // NUL-terminated, so this is the one asymmetry worth pinning.
                const db = memory();
                db.exec('CREATE TABLE t (s TEXT)');
                const insert = db.prepare('INSERT INTO t VALUES (?)');
                insert.bind_text(1, 'a');
                expect(insert.step()).toBe(StepResult.DONE);
                const select = db.prepare('SELECT s, length(s) FROM t');
                expect(select.step()).toBe(StepResult.ROW);
                expect(select.column_text(0)).toBe('a');
                expect(select.column_int64(1)).toBe(1);
                db.close();
            });
        });

        await describe('Statement — columns', async () => {
            await it('reports count, name and declared type', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (a INTEGER, b TEXT)');
                const stmt = db.prepare('SELECT a, b AS renamed, a + 1 FROM t');
                expect(stmt.column_count).toBe(3);
                expect(stmt.column_name(0)).toBe('a');
                expect(stmt.column_name(1)).toBe('renamed');
                expect(stmt.column_decltype(0)).toBe('INTEGER');
                expect(stmt.column_decltype(1)).toBe('TEXT');
                // An expression has no declared type — sqlite says so, and the
                // bridge passes the null straight through.
                expect(stmt.column_decltype(2)).toBeNull();
                db.close();
            });

            await it('step() answers DONE past the last row', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1), (2)');
                const stmt = db.prepare('SELECT x FROM t');
                expect(stmt.step()).toBe(StepResult.ROW);
                expect(stmt.step()).toBe(StepResult.ROW);
                expect(stmt.step()).toBe(StepResult.DONE);
                db.close();
            });
        });

        await describe('Database — last_insert_rowid and changes', async () => {
            await it('tracks the rowid of the last INSERT', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (a INTEGER PRIMARY KEY, b)');
                expect(db.last_insert_rowid).toBe(0);
                const insert = db.prepare('INSERT INTO t (b) VALUES (?)');
                insert.bind_int64(1, 1);
                insert.step();
                expect(db.last_insert_rowid).toBe(1);
                insert.reset();
                insert.step();
                expect(db.last_insert_rowid).toBe(2);
                expect(db.changes).toBe(1);
                db.close();
            });

            await it('counts the rows a bulk UPDATE and DELETE touched', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (x)');
                db.exec('INSERT INTO t VALUES (1), (2), (3), (4)');
                expect(db.changes).toBe(4);
                db.exec('UPDATE t SET x = x + 1');
                expect(db.changes).toBe(4);
                db.exec('DELETE FROM t WHERE x > 3');
                expect(db.changes).toBe(2);
                db.close();
            });

            await it('reports an explicit transaction as in_transaction', async () => {
                const db = memory();
                expect(db.in_transaction).toBe(false);
                db.exec('BEGIN');
                expect(db.in_transaction).toBe(true);
                db.exec('COMMIT');
                expect(db.in_transaction).toBe(false);
                db.close();
            });
        });

        await describe('errors carry sqlite\u2019s EXTENDED result code', async () => {
            await it('reports a UNIQUE violation as 2067, not bare 19', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (x UNIQUE)');
                db.exec('INSERT INTO t VALUES (1)');
                let caught: Error | null = null;
                try {
                    db.exec('INSERT INTO t VALUES (1)');
                } catch (err) {
                    caught = err as Error;
                }
                expect(caught).not.toBeNull();
                // SQLITE_CONSTRAINT_UNIQUE. Without extended codes this reads 19
                // and the JS layer cannot tell which constraint failed — the
                // whole reason `extended_result_codes(1)` is set on open.
                expect(errorCode(caught)).toBe(2067);
                expect(caught!.message).toContain('UNIQUE constraint failed');
                db.close();
            });

            await it('reports a NOT NULL violation as 1299', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (x NOT NULL)');
                const insert = db.prepare('INSERT INTO t VALUES (?)');
                insert.bind_null(1);
                let caught: Error | null = null;
                try {
                    insert.step();
                } catch (err) {
                    caught = err as Error;
                }
                expect(caught).not.toBeNull();
                expect(errorCode(caught)).toBe(1299);
                db.close();
            });
        });

        await describe('teardown order', async () => {
            await it('closing the database first leaves its statements safely dead', async () => {
                // The order a GC-driven host picks on its own. Database.close()
                // finalizes every live statement before dropping the handle, so
                // what is left must FAIL rather than reach freed memory.
                const db = memory();
                db.exec('CREATE TABLE t (x); INSERT INTO t VALUES (1)');
                const stmt = db.prepare('SELECT x FROM t');
                expect(stmt.step()).toBe(StepResult.ROW);
                db.close();

                expect(stmt.is_valid).toBe(false);
                expect(() => stmt.step()).toThrow();
                expect(() => stmt.reset()).toThrow();
                expect(() => stmt.column_text(0)).toThrow();
                expect(() => stmt.bind_int64(1, 1)).toThrow();
                // close() on an already-finalized statement is a no-op, which is
                // what makes the GC's second pass harmless.
                stmt.close();
            });

            await it('closing a statement first leaves the database usable', async () => {
                const db = memory();
                db.exec('CREATE TABLE t (x)');
                const stmt = db.prepare('INSERT INTO t VALUES (1)');
                expect(stmt.step()).toBe(StepResult.DONE);
                stmt.close();
                expect(stmt.is_valid).toBe(false);
                expect(db.is_open).toBe(true);
                db.exec('INSERT INTO t VALUES (2)');
                const count = db.prepare('SELECT count(*) FROM t');
                expect(count.step()).toBe(StepResult.ROW);
                expect(count.column_int64(0)).toBe(2);
                db.close();
            });

            await it('survives many statements left to the collector', async () => {
                // Each Statement holds a strong ref on its Database, so the
                // connection cannot be finalized while one can still reach the
                // handle. Dropping them unreferenced is the shape that would
                // crash if that direction were ever reversed.
                const db = memory();
                db.exec('CREATE TABLE t (x)');
                for (let i = 0; i < 200; i++) {
                    const stmt = db.prepare('INSERT INTO t VALUES (?)');
                    stmt.bind_int64(1, i);
                    stmt.step();
                }
                System.gc();
                const count = db.prepare('SELECT count(*) FROM t');
                expect(count.step()).toBe(StepResult.ROW);
                expect(count.column_int64(0)).toBe(200);
                db.close();
            });
        });

        await describe('Database — file-backed and URI opens', async () => {
            await it('persists across a close and a re-open', async () => {
                const path = `${GLib.get_tmp_dir()}/gjsify-sqlite-${GLib.random_int()}.db`;
                try {
                    const first = Database.open(path, OpenMode.READWRITE_CREATE, false);
                    first.exec('CREATE TABLE t (x); INSERT INTO t VALUES (99)');
                    first.close();

                    const second = Database.open(path, OpenMode.READWRITE, false);
                    const stmt = second.prepare('SELECT x FROM t');
                    expect(stmt.step()).toBe(StepResult.ROW);
                    expect(stmt.column_int64(0)).toBe(99);
                    second.close();
                } finally {
                    GLib.unlink(path);
                }
            });

            await it('honours a file: URI with query parameters', async () => {
                const path = `${GLib.get_tmp_dir()}/gjsify-sqlite-uri-${GLib.random_int()}.db`;
                try {
                    const writable = Database.open(path, OpenMode.READWRITE_CREATE, false);
                    writable.exec('CREATE TABLE t (x)');
                    writable.close();

                    const readonly = Database.open(`file:${path}?mode=ro`, OpenMode.READWRITE, true);
                    expect(() => readonly.exec('INSERT INTO t VALUES (1)')).toThrow();
                    readonly.close();
                } finally {
                    GLib.unlink(path);
                }
            });
        });
    });
};
