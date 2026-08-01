// oxlint-disable typescript/no-explicit-any -- spec passes deliberately-invalid constructor arguments (missing path, wrong-type options, non-numeric open flags, …) to new DatabaseSync() to verify input-validation error paths
// Ported from refs/node-test/parallel/test-sqlite-database-sync.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync, existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-test-' + Date.now());

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
                new (DatabaseSync as any)('foo', { timeout: 0.99 });
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
            expect(() => {
                db.open();
            }).toThrow();
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
            expect(() => {
                db.close();
            }).toThrow();
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
            expect(() => {
                db.exec('SELECT 1');
            }).toThrow();
        });

        await it('throws if sql is not a string', async () => {
            const db = new DatabaseSync(nextDb());
            expect(() => {
                (db as any).exec();
            }).toThrow();
            db.close();
        });

        await it('ignores a semicolon inside a line comment', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec(`CREATE TABLE a(x TEXT); -- note; semicolon
                CREATE TABLE b(y TEXT);`);
            const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
                name: string;
            }>;
            expect(names.map((r) => r.name)).toStrictEqual(['a', 'b']);
            db.close();
        });

        await it('ignores a quote inside a line comment', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec(`CREATE TABLE a(x TEXT); -- it's a comment with a ' quote
                CREATE TABLE b(y TEXT);`);
            const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
                name: string;
            }>;
            expect(names.map((r) => r.name)).toStrictEqual(['a', 'b']);
            db.close();
        });

        await it('ignores a semicolon inside a block comment', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE a(x TEXT); /* spans ; a boundary */ CREATE TABLE b(y TEXT);');
            const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
                name: string;
            }>;
            expect(names.map((r) => r.name)).toStrictEqual(['a', 'b']);
            db.close();
        });

        await it("respects '' escapes inside a string literal", async () => {
            const db = new DatabaseSync(nextDb());
            db.exec(`CREATE TABLE a(x TEXT);
                INSERT INTO a (x) VALUES ('a;b''c');
                CREATE TABLE b(y TEXT);`);
            const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as Array<{
                name: string;
            }>;
            expect(names.map((r) => r.name)).toStrictEqual(['a', 'b']);
            const row = db.prepare('SELECT x FROM a').get() as { x: string };
            expect(row.x).toBe("a;b'c");
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
            expect(() => {
                (db as any).prepare();
            }).toThrow();
        });

        await it('throws if sql is not a string', async () => {
            const db = new DatabaseSync(nextDb());
            expect(() => {
                (db as any).prepare();
            }).toThrow();
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
            expect(() => {
                db.location();
            }).toThrow();
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

        await it('stores the on-disk file at the exact path, not <path>.db', async () => {
            // Regression: libgda's SQLite provider names the file `<DB_NAME>.db`, so passing the
            // `.db` basename verbatim stored the DB at `<path>.db.db` — existsSync(path) was false
            // on GJS even though the DB existed. The path handed to DatabaseSync must be the real file.
            const dbPath = nextDb();
            const db = new DatabaseSync(dbPath);
            db.exec('CREATE TABLE t (id INTEGER)');
            db.close();
            expect(existsSync(dbPath)).toBe(true);
            expect(existsSync(`${dbPath}.db`)).toBe(false);
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
