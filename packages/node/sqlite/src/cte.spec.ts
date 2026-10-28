// Common table expressions: the statements that start with `WITH`.
//
// A `WITH` statement used to be the one shape the SQL parser in front of SQLite did not
// model: it came back UNKNOWN whatever it did, and execution then dispatched on the first
// word of the text it rendered — so a `WITH … SELECT …` was run as a command and answered
// "not an error" instead of its rows. SQL now reaches sqlite3_prepare_v2() verbatim, so a
// CTE is just a SELECT; these keep it that way.
//
// Rows are asserted field by field, not as whole objects: Node's own node:sqlite hands
// back rows on a null prototype, so an object-literal comparison would only be asserting
// which host ran the test.

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-cte-test-' + Date.now());

function cleanup(): void {
    rmSync(testDir, { recursive: true, force: true });
}

function nextDb(): string {
    return join(testDir, `database-${cnt++}.db`);
}

/** A database with `l(k, h)` holding one row, `('a', 'b')`. */
function seeded(): DatabaseSync {
    const db = new DatabaseSync(nextDb());
    db.exec('CREATE TABLE l (k TEXT PRIMARY KEY, h TEXT)');
    db.prepare('INSERT INTO l (k, h) VALUES (?, ?)').run('a', 'b');
    return db;
}

/** The values of one column, down the rows — a row shape neither host decides. */
function column(rows: unknown[], name: string): unknown[] {
    return rows.map((row) => (row as Record<string, unknown>)[name]);
}

export default async () => {
    mkdirSync(testDir, { recursive: true });

    await describe('a CTE that reads', async () => {
        // The statement from the issue: a recursive CTE whose result is one row.
        await it('reads back a WITH RECURSIVE statement', async () => {
            const db = new DatabaseSync(nextDb());
            const row = db
                .prepare(
                    'WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<10) SELECT count(*) AS n FROM c',
                )
                .get() as Record<string, unknown>;
            expect(row.n).toBe(10);
            db.close();
        });

        // The same CTE, read row by row: the column NAME has to survive, or a consumer
        // asking for `x` finds nothing.
        await it('reads back every row of a WITH RECURSIVE statement', async () => {
            const db = new DatabaseSync(nextDb());
            const rows = db
                .prepare('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM c WHERE x<10) SELECT x FROM c')
                .all();
            expect(rows).toHaveLength(10);
            expect(column(rows, 'x')).toStrictEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
            db.close();
        });

        // Two CTEs, separated by a comma: the verb is the one after the LAST of them.
        await it('reads back a statement with two CTEs', async () => {
            const db = seeded();
            const row = db
                .prepare('WITH a AS (SELECT k FROM l WHERE h = ?), b AS (SELECT k FROM a WHERE k = ?) SELECT k FROM b')
                .get('b', 'a') as Record<string, unknown>;
            expect(row.k).toBe('a');
            db.close();
        });

        // A parameter inside a CTE: the value is bound, not written into the SQL.
        await it('binds a parameter inside a CTE', async () => {
            const db = seeded();
            const row = db.prepare('WITH c AS (SELECT k FROM l WHERE h = ?) SELECT k FROM c').get('b') as Record<
                string,
                unknown
            >;
            expect(row.k).toBe('a');
            db.close();
        });

        // A CTE that reads from a table that does not exist: a real SQLite failure has to
        // carry SQLite's own message. The masked one was "not an error" — what
        // sqlite3_errmsg() answers when the error code is SQLITE_OK.
        await it('reports the SQLite message when a CTE names a table that is not there', async () => {
            const db = new DatabaseSync(nextDb());
            let message = '';
            try {
                db.prepare('WITH c AS (SELECT * FROM missing) SELECT * FROM c').get();
            } catch (e: unknown) {
                message = (e as Error).message;
            }
            expect(message).toContain('no such table');
            expect(message).not.toContain('not an error');
            db.close();
        });

        // A bare VALUES is a query with no SELECT in front of it — the other shape that an
        // implementation deciding "is this a query?" from the leading keyword gets wrong.
        await it('reads back a bare VALUES statement', async () => {
            const db = new DatabaseSync(nextDb());
            const rows = db.prepare('VALUES (1), (2)').all();
            expect(rows).toHaveLength(2);
            db.close();
        });

        // The same statement through exec(), which runs it and drops what it returns.
        await it('runs a CTE through exec()', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (v INTEGER)');
            db.exec('WITH q(v) AS (SELECT 1) INSERT INTO t (v) SELECT v FROM q');
            const rows = db.prepare('SELECT v FROM t').all();
            expect(column(rows, 'v')).toStrictEqual([1]);
            db.close();
        });

        // A comment in front of the statement: the text the provider sees starts with
        // the comment's line break, not with the statement.
        await it('reads back a CTE behind a comment', async () => {
            const db = new DatabaseSync(nextDb());
            const row = db.prepare('-- a note\nWITH c(v) AS (SELECT 1) SELECT v FROM c').get() as Record<
                string,
                unknown
            >;
            expect(row.v).toBe(1);
            db.close();
        });

        // A comment behind it: the closing parenthesis of the statement shape must not
        // end up inside the comment.
        await it('reads back a CTE that ends in a comment', async () => {
            const db = new DatabaseSync(nextDb());
            const row = db.prepare('WITH c(v) AS (SELECT 1) SELECT v FROM c -- a note').get() as Record<
                string,
                unknown
            >;
            expect(row.v).toBe(1);
            db.close();
        });
    });

    await describe('a CTE that writes', async () => {
        // The write must stay a write: a `WITH` in front of an INSERT does not make the
        // statement a query. The CTE names its column, so the SELECT reads it back.
        await it('runs a CTE that writes', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (v INTEGER)');
            const insert = db.prepare('WITH q(v) AS (SELECT 1) INSERT INTO t (v) SELECT v FROM q');
            expect(insert.run().changes).toBe(1);
            const rows = db.prepare('SELECT v FROM t').all();
            expect(column(rows, 'v')).toStrictEqual([1]);
            db.close();
        });

        // And it yields no rows: the statement is a write, so there is nothing to read.
        await it('returns no rows for a CTE that writes', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (v INTEGER)');
            const insert = db.prepare('WITH q(v) AS (SELECT 1) INSERT INTO t (v) SELECT v FROM q');
            expect(insert.all()).toStrictEqual([]);
            const rows = db.prepare('SELECT v FROM t').all();
            expect(column(rows, 'v')).toStrictEqual([1]);
            db.close();
        });

        // A CTE in front of a DELETE: the other write.
        await it('runs a CTE that deletes', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (v INTEGER)');
            db.prepare('INSERT INTO t (v) VALUES (1)').run();
            const remove = db.prepare('WITH q(v) AS (SELECT 1) DELETE FROM t WHERE v IN (SELECT v FROM q)');
            expect(remove.run().changes).toBe(1);
            expect(db.prepare('SELECT v FROM t').all()).toStrictEqual([]);
            db.close();
        });
    });

    cleanup();
};
