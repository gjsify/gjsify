// Subqueries in the SQL a real consumer writes: EXISTS, IN (SELECT …), a scalar
// subquery, a WITH clause.
//
// EXISTS (SELECT …) is here because libgda used to reject it outright: the SQLite
// provider re-renders a parsed statement before handing it to sqlite3_prepare_v2(),
// and libgda's renderer emits a SECOND paren pair for a function argument that is a
// sub-SELECT, so `EXISTS (SELECT …)` reached SQLite as `EXISTS ((SELECT …))` — which
// SQLite answers with `near "(": syntax error`. The libgda side of that is written
// out in exists-subquery.ts; the cases below are the consumer-visible half.
//
// Rows are asserted field by field, not as whole objects: Node's own node:sqlite hands
// back rows on a null prototype, so an object-literal comparison would only be asserting
// which host ran the test.

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

/** True on real GJS — the same signal `@gjsify/unit` gates its host hooks on. */
const IS_GJS = typeof (globalThis as { process?: { versions?: { gjs?: string } } }).process?.versions?.gjs === 'string';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-subquery-test-' + Date.now());

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

    await describe('EXISTS (subquery)', async () => {
        await it('reads back EXISTS in a projection', async () => {
            const db = seeded();
            const row = db.prepare('SELECT EXISTS (SELECT 1 FROM l WHERE k = ?) AS e').get('a') as Record<
                string,
                unknown
            >;
            expect(row.e).toBe(1);
            db.close();
        });

        await it('reads back a false EXISTS', async () => {
            const db = seeded();
            const row = db.prepare('SELECT EXISTS (SELECT 1 FROM l WHERE k = ?) AS e').get('zz') as Record<
                string,
                unknown
            >;
            expect(row.e).toBe(0);
            db.close();
        });

        await it('reads back NOT EXISTS in a WHERE', async () => {
            const db = seeded();
            const stmt = db.prepare('SELECT 1 AS one WHERE NOT EXISTS (SELECT 1 FROM l WHERE k = ?)');
            expect(stmt.all('a')).toHaveLength(0);
            expect(stmt.all('zz')).toHaveLength(1);
            db.close();
        });

        // A paren inside a string literal must not end the subquery early.
        await it('sees a paren inside a literal in the subquery', async () => {
            const db = seeded();
            const row = db.prepare("SELECT EXISTS (SELECT 1 FROM l WHERE k = ')') AS e").get() as Record<
                string,
                unknown
            >;
            expect(row.e).toBe(0);
            db.close();
        });

        await it('sees a correlated subquery', async () => {
            const db = seeded();
            db.prepare('INSERT INTO l (k, h) VALUES (?, ?)').run('c', 'd');
            const rows = db.prepare('SELECT k FROM l WHERE EXISTS (SELECT 1 FROM l x WHERE x.h = l.h) ORDER BY k');
            expect(column(rows.all(), 'k')).toStrictEqual(['a', 'c']);
            db.close();
        });

        await it('sees a nested EXISTS', async () => {
            const db = seeded();
            const stmt = db.prepare(
                'SELECT 1 AS one WHERE NOT EXISTS (SELECT 1 FROM l WHERE k = ? AND EXISTS (SELECT 1 FROM l WHERE k = ?))',
            );
            // The conjunction needs BOTH keys present to match a row, which is what
            // the inner EXISTS contributes: 'a' alone is not enough.
            expect(stmt.all('zz', 'a')).toHaveLength(1);
            expect(stmt.all('a', 'qq')).toHaveLength(1);
            expect(stmt.all('a', 'a')).toHaveLength(0);
            db.close();
        });
    });

    await describe('INSERT … SELECT … WHERE NOT EXISTS', async () => {
        // The guard a consumer writes to make an upsert idempotent, with a parameter on
        // each side of the subquery: their ORDER is the thing a rewrite can break.
        await it('binds the outer and the inner parameter', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE l (k TEXT PRIMARY KEY, h TEXT)');
            const insert = db.prepare(
                'INSERT INTO l (k, h) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM l WHERE k = ?)',
            );
            expect(insert.run('a', 'b', 'a').changes).toBe(1);
            expect(insert.run('a', 'b', 'a').changes).toBe(0);
            expect(insert.run('c', 'd', 'c').changes).toBe(1);
            // The guard reads the THIRD argument, so 'x' is the row that lands.
            expect(insert.run('x', 'y', 'c').changes).toBe(0);
            const rows = db.prepare('SELECT k, h FROM l ORDER BY k').all();
            expect(column(rows, 'k')).toStrictEqual(['a', 'c']);
            expect(column(rows, 'h')).toStrictEqual(['b', 'd']);
            db.close();
        });

        // Same statement, the inner parameter a NUMBER: rendered as a literal rather than
        // bound, so the two parameters take different paths through the SQL text.
        await it('binds a string outside and a number inside', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE l (k INTEGER PRIMARY KEY, h TEXT)');
            const insert = db.prepare(
                'INSERT INTO l (k, h) SELECT ?, ? WHERE NOT EXISTS (SELECT 1 FROM l WHERE k = ?)',
            );
            expect(insert.run(7, 'seven', 7).changes).toBe(1);
            expect(insert.run(7, 'seven', 7).changes).toBe(0);
            expect(insert.run(8, 'eight', 9).changes).toBe(1);
            expect(insert.run(9, 'nine', 8).changes).toBe(0);
            const rows = db.prepare('SELECT k, h FROM l ORDER BY k').all();
            expect(column(rows, 'k')).toStrictEqual([7, 8]);
            expect(column(rows, 'h')).toStrictEqual(['seven', 'eight']);
            db.close();
        });
    });

    await describe('the other subquery shapes', async () => {
        await it('reads back x IN (SELECT …)', async () => {
            const db = seeded();
            const rows = db.prepare('SELECT k FROM l WHERE k IN (SELECT k FROM l WHERE h = ?)').all('b');
            expect(column(rows, 'k')).toStrictEqual(['a']);
            db.close();
        });

        await it('reads back a scalar subquery', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE n (v INTEGER)');
            db.prepare('INSERT INTO n (v) VALUES (?)').run(7);
            const row = db.prepare('SELECT (SELECT max(v) FROM n) AS m').get() as Record<string, unknown>;
            expect(row.m).toBe(7);
            db.close();
        });

        await it.failing(
            'reads back a WITH clause',
            async () => {
                const db = seeded();
                const rows = db.prepare('WITH c AS (SELECT k FROM l WHERE h = ?) SELECT k FROM c').all('b');
                expect(column(rows, 'k')).toStrictEqual(['a']);
                db.close();
            },
            'libgda parses a WITH clause as an UNKNOWN statement and renders it back VERBATIM — ' +
                'so unlike EXISTS (exists-subquery.ts) the SQL reaching SQLite is correct. What fails is ' +
                'the SQLite provider\'s own dispatch: it decides "does this yield rows" by prefix-matching ' +
                'the rendered text against SELECT/PRAGMA/EXPLAIN (gda-sqlite-provider.c:3724, at LIBGDA_6_0_0), ' +
                'and `WITH …` matches none, so the statement is stepped once as a command, the row it returns is ' +
                'dropped, and the step reports not SQLITE_DONE. Measured on GJS 1.88.1 + libgda 6.0.0: ' +
                'statement_execute_select, batch_execute and statement_execute_select_full all answer ' +
                '"not an error" for this statement, while the identical query wrapped as ' +
                '`SELECT * FROM (WITH c AS ( … ) SELECT …)` returns its row. Not fixable downstream without ' +
                'rewriting the statement, and the rewrite is not semantics-preserving for a WITH that precedes ' +
                'an INSERT/UPDATE/DELETE — see the table row in status/upstream-patch-candidates.md.',
            { when: IS_GJS },
        );
    });

    await describe('EXISTS the word is left alone elsewhere', async () => {
        await it('does not read EXISTS out of a string literal', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a TEXT)');
            db.prepare('INSERT INTO t (a) VALUES (?)').run('EXISTS (SELECT 1)');
            const row = db.prepare('SELECT a FROM t').get() as Record<string, unknown>;
            expect(row.a).toBe('EXISTS (SELECT 1)');
            db.close();
        });

        // Bracket and backtick quoting, not `"…"`: libgda's parser rejects a
        // double-quoted identifier holding a paren and a space, which is a defect of its
        // own and would fail this case before the rewriter was ever reached.
        await it('does not read EXISTS out of a quoted identifier', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t ([EXISTS (x)] TEXT)');
            db.prepare('INSERT INTO t ([EXISTS (x)]) VALUES (?)').run('v');
            const row = db.prepare('SELECT [EXISTS (x)] FROM t').get() as Record<string, unknown>;
            expect(row['EXISTS (x)']).toBe('v');
            db.close();
        });
    });

    cleanup();
};
