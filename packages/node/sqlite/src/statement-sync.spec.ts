// Ported from refs/node-test/parallel/test-sqlite-statement-sync.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-stmt-test-' + Date.now());

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

/**
 * What `fn` threw, for the assertions that need more of an error than its message.
 *
 * A silent success returns a stand-in rather than throwing here, so the assertion
 * below reports the value that came back INSTEAD of an error — which is exactly what
 * these tests are about.
 */
function errorFrom(fn: () => unknown): { code?: unknown; message?: unknown } {
    try {
        const returned = fn();
        return { code: `returned ${JSON.stringify(returned) ?? String(returned)}`, message: 'nothing was thrown' };
    } catch (e) {
        return e as { code?: unknown; message?: unknown };
    }
}

export default async () => {
    setup();

    await describe('StatementSync.prototype.get()', async () => {
        await it('returns undefined on no results', async () => {
            const db = new DatabaseSync(nextDb());
            let stmt = db.prepare('CREATE TABLE storage(key TEXT, val TEXT)');
            expect(stmt.get()).toBe(undefined);
            stmt = db.prepare('SELECT * FROM storage');
            expect(stmt.get()).toBe(undefined);
            db.close();
        });

        await it('returns the first result', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE storage(key TEXT, val TEXT)');
            const insert = db.prepare('INSERT INTO storage (key, val) VALUES (?, ?)');
            insert.run('key1', 'val1');
            insert.run('key2', 'val2');
            const stmt = db.prepare('SELECT * FROM storage ORDER BY key');
            const row = stmt.get() as Record<string, unknown>;
            expect(row).toBeDefined();
            expect(row.key).toBe('key1');
            expect(row.val).toBe('val1');
            db.close();
        });
    });

    await describe('StatementSync.prototype.all()', async () => {
        await it('returns an empty array on no results', async () => {
            const db = new DatabaseSync(nextDb());
            const stmt = db.prepare('CREATE TABLE storage(key TEXT, val TEXT)');
            const rows = stmt.all();
            expect(Array.isArray(rows)).toBe(true);
            expect(rows.length).toBe(0);
            db.close();
        });

        await it('returns all results', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE storage(key TEXT, val TEXT)');
            const insert = db.prepare('INSERT INTO storage (key, val) VALUES (?, ?)');
            insert.run('key1', 'val1');
            insert.run('key2', 'val2');
            const stmt = db.prepare('SELECT * FROM storage ORDER BY key');
            const rows = stmt.all() as Record<string, unknown>[];
            expect(rows.length).toBe(2);
            expect(rows[0].key).toBe('key1');
            expect(rows[1].key).toBe('key2');
            db.close();
        });
    });

    await describe('a statement the database rejects', async () => {
        // Each closure spans prepare() AND the execution on purpose. node:sqlite resolves
        // table and column names while PREPARING and raises there; libgda's parser only
        // checks syntax, so on GJS the very same mistake can surface no earlier than
        // execution. What both owe the caller is the error — not which call raises it.
        //
        // Before this was fixed, get() answered `undefined` and all() answered `[]` for a
        // query against a table that does not exist: a wrong answer indistinguishable
        // from an empty table, for the rest of the process's life.

        await it('get() reports a table that does not exist', async () => {
            const db = new DatabaseSync(nextDb());
            expect(() => db.prepare('SELECT * FROM does_not_exist').get()).toThrow(/no such table: does_not_exist/);
            db.close();
        });

        await it('all() reports a table that does not exist', async () => {
            const db = new DatabaseSync(nextDb());
            expect(() => db.prepare('SELECT * FROM does_not_exist').all()).toThrow(/no such table: does_not_exist/);
            db.close();
        });

        await it('get() reports a column that does not exist', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE storage(key TEXT, val TEXT)');
            expect(() => db.prepare('SELECT no_such_col FROM storage').get()).toThrow(/no such column: no_such_col/);
            db.close();
        });

        await it('all() reports a column that does not exist', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE storage(key TEXT, val TEXT)');
            expect(() => db.prepare('SELECT no_such_col FROM storage').all()).toThrow(/no such column: no_such_col/);
            db.close();
        });

        await it('raises the error node:sqlite consumers branch on', async () => {
            const db = new DatabaseSync(nextDb());
            // A consumer catches `err.code === 'ERR_SQLITE_ERROR'`, and libgda's GLib.Error
            // carries a NUMERIC code and stringifies with its GError domain in front — so
            // it has to be translated, not passed through and not re-spelled.
            const err = errorFrom(() => db.prepare('SELECT * FROM does_not_exist').get());
            expect(err.code).toBe('ERR_SQLITE_ERROR');
            expect(err.message).toBe('no such table: does_not_exist');
            db.close();
        });

        await it('run() raises it in the same shape', async () => {
            const db = new DatabaseSync(nextDb());
            const err = errorFrom(() => db.prepare('INSERT INTO does_not_exist (a) VALUES (1)').run());
            expect(err.code).toBe('ERR_SQLITE_ERROR');
            expect(err.message).toBe('no such table: does_not_exist');
            db.close();
        });

        await it('reports a constraint violation and writes nothing', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t(a INTEGER PRIMARY KEY, b TEXT NOT NULL)');
            db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run(1, 'x');

            const unique = errorFrom(() => db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run(1, 'y'));
            expect(unique.code).toBe('ERR_SQLITE_ERROR');
            expect(unique.message).toBe('UNIQUE constraint failed: t.a');

            const notNull = errorFrom(() => db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run(2, null));
            expect(notNull.code).toBe('ERR_SQLITE_ERROR');
            expect(notNull.message).toBe('NOT NULL constraint failed: t.b');

            // A statement that raised must not have written: the rejected INSERT is
            // retried as a select on GJS (PRAGMAs reach libgda as UNKNOWN and execute no
            // other way), and a retry that landed rows would be worse than the error.
            const rows = db.prepare('SELECT a, b FROM t').all() as Record<string, unknown>[];
            expect(rows.length).toBe(1);
            expect(rows[0].a).toBe(1);
            expect(rows[0].b).toBe('x');
            db.close();
        });
    });

    await describe('StatementSync.prototype.run()', async () => {
        await it('returns change metadata', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec(`
                CREATE TABLE storage(key TEXT, val TEXT);
                INSERT INTO storage (key, val) VALUES ('foo', 'bar');
            `);
            const stmt = db.prepare('SELECT * FROM storage');
            const result = stmt.run();
            expect(result).toBeDefined();
            expect(result.changes).toBeDefined();
            expect(result.lastInsertRowid).toBeDefined();
            db.close();
        });

        await it('returns correct changes and lastInsertRowid', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE storage(key TEXT, val TEXT)');
            const insert = db.prepare('INSERT INTO storage (key, val) VALUES (?, ?)');
            const result = insert.run('key1', 'val1');
            expect(result.changes).toBe(1);
            expect(result.lastInsertRowid).toBe(1);
            const result2 = insert.run('key2', 'val2');
            expect(result2.changes).toBe(1);
            expect(result2.lastInsertRowid).toBe(2);
            db.close();
        });

        await it('throws when binding too many parameters', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE data(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO data (key, val) VALUES (?, ?)');
            expect(() => {
                stmt.run(1, 2, 3);
            }).toThrow();
            db.close();
        });
    });

    await describe('StatementSync.prototype.sourceSQL', async () => {
        await it('equals input SQL', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const sql = 'INSERT INTO types (key, val) VALUES ($k, $v)';
            const stmt = db.prepare(sql);
            expect(stmt.sourceSQL).toBe(sql);
            db.close();
        });
    });

    await describe('StatementSync.prototype.setReadBigInts()', async () => {
        await it('BigInts support can be toggled', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec(`
                CREATE TABLE data(key INTEGER PRIMARY KEY, val INTEGER) STRICT;
                INSERT INTO data (key, val) VALUES (1, 42);
            `);
            const query = db.prepare('SELECT val FROM data');
            let row = query.get() as Record<string, unknown>;
            expect(row.val).toBe(42);

            query.setReadBigInts(true);
            row = query.get() as Record<string, unknown>;
            expect(row.val).toBe(42n);

            query.setReadBigInts(false);
            row = query.get() as Record<string, unknown>;
            expect(row.val).toBe(42);
            db.close();
        });

        await it('throws when input is not a boolean', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO types (key, val) VALUES ($k, $v)');
            expect(() => {
                (stmt as unknown as { setReadBigInts: () => void }).setReadBigInts();
            }).toThrow();
            db.close();
        });
    });

    await describe('StatementSync.prototype.setReturnArrays()', async () => {
        await it('returns array row when enabled', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec(`
                CREATE TABLE data(key INTEGER PRIMARY KEY, val TEXT) STRICT;
                INSERT INTO data (key, val) VALUES (1, 'one');
            `);
            const query = db.prepare('SELECT key, val FROM data WHERE key = 1');
            let row = query.get() as Record<string, unknown>;
            expect(row.key).toBe(1);
            expect(row.val).toBe('one');

            query.setReturnArrays(true);
            // setReturnArrays toggles the return shape at runtime — @types/node
            // types query.get() as a record regardless, so cast via unknown first.
            const arrRow = query.get() as unknown as unknown[];
            expect(Array.isArray(arrRow)).toBe(true);
            expect(arrRow[0]).toBe(1);
            expect(arrRow[1]).toBe('one');
            db.close();
        });

        await it('throws when input is not a boolean', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE data(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('SELECT key, val FROM data');
            expect(() => {
                (stmt as unknown as { setReturnArrays: () => void }).setReturnArrays();
            }).toThrow();
            db.close();
        });
    });

    cleanup();
};
