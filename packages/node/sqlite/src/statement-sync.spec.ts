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
    try { mkdirSync(testDir, { recursive: true }); } catch {}
}

function cleanup() {
    try { rmSync(testDir, { recursive: true, force: true }); } catch {}
}

function nextDb(): string {
    return join(testDir, `database-${cnt++}.db`);
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
                (stmt as any).setReadBigInts();
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
            const arrRow = query.get() as unknown[];
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
                (stmt as any).setReturnArrays();
            }).toThrow();
            db.close();
        });
    });

    cleanup();
};
