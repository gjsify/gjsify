// Ported from refs/node-test/parallel/test-sqlite-database-sync.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-test-' + Date.now());

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

    await describe('DatabaseSync() constructor', async () => {
        await it('throws if database path is not a string, Uint8Array, or URL', async () => {
            expect(() => {
                new (DatabaseSync as any)();
            }).toThrow();
        });

        await it('throws if the database location as string contains null bytes', async () => {
            expect(() => {
                new DatabaseSync('l\0cation');
            }).toThrow();
        });

        await it('throws if options is provided but is not an object', async () => {
            expect(() => {
                new (DatabaseSync as any)('foo', null);
            }).toThrow();
        });

        await it('throws if options.open is provided but is not a boolean', async () => {
            expect(() => {
                new (DatabaseSync as any)('foo', { open: 5 });
            }).toThrow();
        });

        await it('throws if options.readOnly is provided but is not a boolean', async () => {
            expect(() => {
                new (DatabaseSync as any)('foo', { readOnly: 5 });
            }).toThrow();
        });

        await it('throws if options.timeout is provided but is not an integer', async () => {
            expect(() => {
                new (DatabaseSync as any)('foo', { timeout: .99 });
            }).toThrow();
        });

        await it('throws if options.enableForeignKeyConstraints is not a boolean', async () => {
            expect(() => {
                new (DatabaseSync as any)('foo', { enableForeignKeyConstraints: 5 });
            }).toThrow();
        });

        await it('throws if options.enableDoubleQuotedStringLiterals is not a boolean', async () => {
            expect(() => {
                new (DatabaseSync as any)('foo', { enableDoubleQuotedStringLiterals: 5 });
            }).toThrow();
        });

        await it('throws if options.readBigInts is not a boolean', async () => {
            expect(() => {
                new (DatabaseSync as any)('foo', { readBigInts: 42 });
            }).toThrow();
        });

        await it('throws if options.returnArrays is not a boolean', async () => {
            expect(() => {
                new (DatabaseSync as any)('foo', { returnArrays: 42 });
            }).toThrow();
        });

        await it('throws if the URL does not have the file: scheme', async () => {
            expect(() => {
                new DatabaseSync(new URL('http://example.com') as any);
            }).toThrow();
        });
    });

    await describe('DatabaseSync.prototype.open()', async () => {
        await it('opens a database connection', async () => {
            const dbPath = nextDb();
            const db = new DatabaseSync(dbPath, { open: false });
            expect(db.isOpen).toBe(false);
            db.open();
            expect(db.isOpen).toBe(true);
            db.close();
        });

        await it('throws if database is already open', async () => {
            const dbPath = nextDb();
            const db = new DatabaseSync(dbPath);
            expect(db.isOpen).toBe(true);
            expect(() => { db.open(); }).toThrow();
            db.close();
        });
    });

    await describe('DatabaseSync.prototype.close()', async () => {
        await it('closes an open database connection', async () => {
            const db = new DatabaseSync(nextDb());
            expect(db.isOpen).toBe(true);
            db.close();
            expect(db.isOpen).toBe(false);
        });

        await it('throws if database is not open', async () => {
            const db = new DatabaseSync(nextDb(), { open: false });
            expect(db.isOpen).toBe(false);
            expect(() => { db.close(); }).toThrow();
        });
    });

    await describe('DatabaseSync.prototype.exec()', async () => {
        await it('runs SQL and returns undefined', async () => {
            const db = new DatabaseSync(nextDb());
            const result = db.exec(`
                CREATE TABLE data(key INTEGER PRIMARY KEY, val INTEGER) STRICT;
                INSERT INTO data (key, val) VALUES (1, 2);
                INSERT INTO data (key, val) VALUES (8, 9);
            `);
            expect(result).toBe(undefined);
            const stmt = db.prepare('SELECT * FROM data ORDER BY key');
            const rows = stmt.all();
            expect(rows.length).toBe(2);
            db.close();
        });

        await it('reports errors from SQLite', async () => {
            const db = new DatabaseSync(nextDb());
            expect(() => {
                db.exec('CREATE TABLEEEE');
            }).toThrow();
            db.close();
        });

        await it('throws if database is not open', async () => {
            const db = new DatabaseSync(nextDb(), { open: false });
            expect(() => { db.exec('SELECT 1'); }).toThrow();
        });

        await it('throws if sql is not a string', async () => {
            const db = new DatabaseSync(nextDb());
            expect(() => { (db as any).exec(); }).toThrow();
            db.close();
        });
    });

    await describe('DatabaseSync.prototype.prepare()', async () => {
        await it('returns a prepared statement', async () => {
            const db = new DatabaseSync(nextDb());
            const stmt = db.prepare('CREATE TABLE webstorage(key TEXT)');
            expect(stmt).toBeDefined();
            db.close();
        });

        await it('throws if database is not open', async () => {
            const db = new DatabaseSync(nextDb(), { open: false });
            expect(() => { (db as any).prepare(); }).toThrow();
        });

        await it('throws if sql is not a string', async () => {
            const db = new DatabaseSync(nextDb());
            expect(() => { (db as any).prepare(); }).toThrow();
            db.close();
        });
    });

    await describe('DatabaseSync :memory: database', async () => {
        await it('works with :memory: path', async () => {
            const db = new DatabaseSync(':memory:');
            expect(db.isOpen).toBe(true);
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, val TEXT)');
            db.exec("INSERT INTO t (id, val) VALUES (1, 'hello')");
            const row = db.prepare('SELECT * FROM t').get();
            expect(row).toBeDefined();
            db.close();
        });
    });

    await describe('DatabaseSync.prototype.isTransaction', async () => {
        await it('correctly detects a committed transaction', async () => {
            const db = new DatabaseSync(':memory:');
            expect(db.isTransaction).toBe(false);
            db.exec('BEGIN');
            expect(db.isTransaction).toBe(true);
            db.exec('CREATE TABLE foo (id INTEGER PRIMARY KEY)');
            expect(db.isTransaction).toBe(true);
            db.exec('COMMIT');
            expect(db.isTransaction).toBe(false);
            db.close();
        });

        await it('correctly detects a rolled back transaction', async () => {
            const db = new DatabaseSync(':memory:');
            expect(db.isTransaction).toBe(false);
            db.exec('BEGIN');
            expect(db.isTransaction).toBe(true);
            db.exec('ROLLBACK');
            expect(db.isTransaction).toBe(false);
            db.close();
        });
    });

    await describe('DatabaseSync.prototype.location()', async () => {
        await it('throws if database is not open', async () => {
            const db = new DatabaseSync(nextDb(), { open: false });
            expect(() => { db.location(); }).toThrow();
        });

        await it('returns null for in-memory database', async () => {
            const db = new DatabaseSync(':memory:');
            expect(db.location()).toBeNull();
            db.close();
        });

        await it('returns db path for persistent database', async () => {
            const dbPath = nextDb();
            const db = new DatabaseSync(dbPath);
            expect(db.location()).toBe(dbPath);
            db.close();
        });
    });

    await describe('DatabaseSync foreign key constraints', async () => {
        await it('enables foreign key constraints by default', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec(`
                CREATE TABLE foo (id INTEGER PRIMARY KEY);
                CREATE TABLE bar (foo_id INTEGER REFERENCES foo(id));
            `);
            expect(() => {
                db.exec('INSERT INTO bar (foo_id) VALUES (1)');
            }).toThrow();
            db.close();
        });

        await it('allows disabling foreign key constraints', async () => {
            const db = new DatabaseSync(nextDb(), { enableForeignKeyConstraints: false });
            db.exec(`
                CREATE TABLE foo (id INTEGER PRIMARY KEY);
                CREATE TABLE bar (foo_id INTEGER REFERENCES foo(id));
            `);
            // Should not throw
            db.exec('INSERT INTO bar (foo_id) VALUES (1)');
            db.close();
        });
    });

    cleanup();
};
