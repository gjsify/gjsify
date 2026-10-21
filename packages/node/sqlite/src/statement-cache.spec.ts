// A prepared statement is parsed once and keeps its compiled form between executions
// (statement-sync.ts `#parsed`, execution.ts `retained`). These are the rules that
// caching must not break: the same statement run again with other parameters, one
// execution per call, and a retained statement that still lets the schema change.

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-cache-test-' + Date.now());

function setup() {
    // recursive:true already makes an existing dir a no-op — any other
    // failure (EACCES) should fail the suite loudly, not vanish.
    mkdirSync(testDir, { recursive: true });
}

function cleanup() {
    // force:true already makes a missing dir a no-op — any other failure
    // (EACCES) should fail the suite loudly, not vanish.
    rmSync(testDir, { recursive: true, force: true });
}

function nextDb(): string {
    return join(testDir, `database-${cnt++}.db`);
}

export default async () => {
    setup();

    await describe('a prepared statement reused across executions', async () => {
        await it('runs an INSERT with changing parameters', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
            const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
            for (let i = 0; i < 200; i++) {
                const result = insert.run(`v${i}`);
                expect(result.changes).toBe(1);
                expect(result.lastInsertRowid).toBe(i + 1);
            }
            const rows = db.prepare('SELECT v FROM t ORDER BY id').all() as { v: string }[];
            expect(rows.length).toBe(200);
            expect(rows[0].v).toBe('v0');
            expect(rows[199].v).toBe('v199');
            db.close();
        });

        await it('reads with changing parameters through get()', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
            const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
            for (let i = 0; i < 100; i++) insert.run(`v${i}`);

            const lookup = db.prepare('SELECT v FROM t WHERE id = ?');
            let mismatches = 0;
            for (let i = 1; i <= 100; i++) {
                const row = lookup.get(i) as { v: string } | undefined;
                if (row?.v !== `v${i - 1}`) mismatches++;
            }
            expect(mismatches).toBe(0);
            expect(lookup.get(101)).toBe(undefined);
            db.close();
        });

        await it('returns the whole result set from all() on every call', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
            const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
            const above = db.prepare('SELECT v FROM t WHERE id > ? ORDER BY id');

            for (let i = 0; i < 20; i++) {
                insert.run(`v${i}`);
                // The same statement has to see the row inserted since its last
                // execution: a kept compiled statement is re-stepped, never replayed.
                const rows = above.all(0) as { v: string }[];
                expect(rows.length).toBe(i + 1);
                expect(rows[i].v).toBe(`v${i}`);
            }
            expect((above.all(15) as { v: string }[]).length).toBe(5);
            db.close();
        });

        await it('alternates a bound value with NULL and a BLOB', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(a)');
            const insert = db.prepare('INSERT INTO t (a) VALUES (?)');
            // NULL and a BLOB cannot be bound to a holder, so each renders a different
            // SQL text and therefore a different cache entry (statement-sync.ts
            // `sqlLiteral`). Alternating them exercises the lookup, not just one entry.
            for (let i = 0; i < 10; i++) {
                insert.run('text');
                insert.run(null);
                insert.run(new Uint8Array([i, 255, 0]));
                insert.run(42);
            }
            const types = db.prepare('SELECT typeof(a) AS ty FROM t ORDER BY rowid').all() as { ty: string }[];
            expect(types.length).toBe(40);
            expect(types[0].ty).toBe('text');
            expect(types[1].ty).toBe('null');
            expect(types[2].ty).toBe('blob');
            expect(types[3].ty).toBe('real');
            expect(types[36].ty).toBe('text');
            expect(types[38].ty).toBe('blob');
            db.close();
        });

        await it('stays correct past the number of texts it caches', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, a)');
            const insert = db.prepare('INSERT INTO t (a) VALUES (?)');
            // A BLOB puts its bytes into the SQL text, so every length is another entry.
            // Past the bound the least recently used one is dropped and reparsed — the
            // results may not change.
            for (let len = 1; len <= 40; len++) {
                insert.run(new Uint8Array(len).fill(len));
            }
            const rows = db.prepare('SELECT length(a) AS len FROM t ORDER BY id').all() as { len: number }[];
            expect(rows.length).toBe(40);
            expect(rows[0].len).toBe(1);
            expect(rows[39].len).toBe(40);
            db.close();
        });
    });

    await describe('one call executes the statement exactly once', async () => {
        // A SELECT has no side effect SQLite can count, so the counter is a statement
        // that WRITES and is run through each of the three reading APIs: `n` is the
        // number of times the compiled statement was stepped.
        const bumpThrough = (call: (bump: ReturnType<DatabaseSync['prepare']>) => void) => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE counter(id INTEGER PRIMARY KEY, n INTEGER NOT NULL)');
            db.exec('INSERT INTO counter (id, n) VALUES (1, 0)');
            const bump = db.prepare('UPDATE counter SET n = n + 1 WHERE id = ?');
            const read = db.prepare('SELECT n FROM counter WHERE id = 1');
            for (let i = 1; i <= 25; i++) {
                call(bump);
                expect((read.get() as { n: number }).n).toBe(i);
            }
            db.close();
        };

        await it('steps the statement once per run()', async () => {
            bumpThrough((bump) => {
                expect(bump.run(1).changes).toBe(1);
            });
        });

        await it('steps the statement once per get()', async () => {
            bumpThrough((bump) => {
                expect(bump.get(1)).toBe(undefined);
            });
        });

        await it('steps the statement once per all()', async () => {
            bumpThrough((bump) => {
                expect((bump.all(1) as unknown[]).length).toBe(0);
            });
        });
    });

    await describe('a retained statement does not pin the database', async () => {
        await it('drops and vacuums after reads through kept statements', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
            const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
            for (let i = 0; i < 50; i++) insert.run(`v${i}`);

            const lookup = db.prepare('SELECT v FROM t WHERE id = ?');
            expect((lookup.get(1) as { v: string }).v).toBe('v0');
            expect((db.prepare('SELECT count(*) AS c FROM t').all() as { c: number }[])[0].c).toBe(50);

            // Both fail with "database table is locked" / "SQL statements in progress"
            // if an execution left a kept statement mid-step.
            db.exec('VACUUM');
            db.exec('DROP TABLE t');
            expect(db.isOpen).toBe(true);
            db.close();
        });

        await it('keeps its own column list when a column is added', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(a TEXT)');
            db.exec("INSERT INTO t (a) VALUES ('x')");
            const star = db.prepare('SELECT * FROM t');
            expect(Object.keys((star.all() as Record<string, unknown>[])[0]).length).toBe(1);

            // Measured against Node: a prepared `SELECT *` expands its column list once
            // and keeps it across an `ALTER TABLE … ADD COLUMN` — only a statement
            // prepared afterwards sees the new column. Retaining the compiled statement
            // must not change that either way: it may not start reporting the new column,
            // and it may not start failing on the row it already read.
            db.exec('ALTER TABLE t ADD COLUMN b TEXT');
            const row = (star.all() as Record<string, unknown>[])[0];
            expect(Object.keys(row).length).toBe(1);
            expect(row.a).toBe('x');

            const fresh = (db.prepare('SELECT * FROM t').all() as Record<string, unknown>[])[0];
            expect(Object.keys(fresh).length).toBe(2);
            expect(fresh.b).toBe(null);
            db.close();
        });
    });

    await describe('explicit transactions through exec()', async () => {
        await it('commits a batch of prepared inserts', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
            const insert = db.prepare('INSERT INTO t (v) VALUES (?)');

            db.exec('BEGIN');
            expect(db.isTransaction).toBe(true);
            for (let i = 0; i < 500; i++) insert.run(`v${i}`);
            expect(db.isTransaction).toBe(true);
            db.exec('COMMIT');
            expect(db.isTransaction).toBe(false);

            const count = db.prepare('SELECT count(*) AS c FROM t').get() as { c: number };
            expect(count.c).toBe(500);
            db.close();
        });

        await it('discards a rolled back batch', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
            const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
            insert.run('kept');

            db.exec('BEGIN');
            for (let i = 0; i < 500; i++) insert.run(`v${i}`);
            // The same kept statement must read the uncommitted rows of its own
            // transaction.
            expect((db.prepare('SELECT count(*) AS c FROM t').get() as { c: number }).c).toBe(501);
            db.exec('ROLLBACK');
            expect(db.isTransaction).toBe(false);

            const rows = db.prepare('SELECT v FROM t').all() as { v: string }[];
            expect(rows.length).toBe(1);
            expect(rows[0].v).toBe('kept');

            // And the statement still works after the rollback.
            insert.run('after');
            expect((db.prepare('SELECT count(*) AS c FROM t').get() as { c: number }).c).toBe(2);
            db.close();
        });
    });

    await describe('WAL mode', async () => {
        await it('reads journal_mode back as wal', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('PRAGMA journal_mode = WAL');
            const row = db.prepare('PRAGMA journal_mode').get() as Record<string, unknown>;
            expect(row.journal_mode).toBe('wal');
            db.close();
        });

        await it('reads synchronous back as NORMAL', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('PRAGMA synchronous = NORMAL');
            const row = db.prepare('PRAGMA synchronous').get() as Record<string, unknown>;
            expect(Number(row.synchronous)).toBe(1);
            db.close();
        });

        await it('lets a second connection read while a transaction is open', async () => {
            const path = nextDb();
            const writer = new DatabaseSync(path);
            writer.exec('PRAGMA journal_mode = WAL');
            writer.exec('PRAGMA synchronous = NORMAL');
            writer.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
            const insert = writer.prepare('INSERT INTO t (v) VALUES (?)');
            insert.run('committed');

            const reader = new DatabaseSync(path);
            const count = reader.prepare('SELECT count(*) AS c FROM t');

            writer.exec('BEGIN');
            for (let i = 0; i < 100; i++) insert.run(`v${i}`);
            // In WAL a reader is not blocked by the open write transaction and sees the
            // last committed state.
            expect((count.get() as { c: number }).c).toBe(1);
            writer.exec('COMMIT');
            expect((count.get() as { c: number }).c).toBe(101);

            reader.close();
            writer.close();
        });
    });

    cleanup();
};
