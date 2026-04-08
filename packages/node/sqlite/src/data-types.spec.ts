// Ported from refs/node-test/parallel/test-sqlite-data-types.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-types-test-' + Date.now());

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

    await describe('sqlite data types', async () => {
        await it('supports INTEGER, REAL, TEXT, BLOB, and NULL', async () => {
            const u8a = new TextEncoder().encode('a☃b☃c');
            const db = new DatabaseSync(nextDb());
            db.exec(`
                CREATE TABLE types(
                    key INTEGER PRIMARY KEY,
                    int INTEGER,
                    double REAL,
                    text TEXT,
                    buf BLOB
                ) STRICT;
            `);
            const stmt = db.prepare('INSERT INTO types (key, int, double, text, buf) VALUES (?, ?, ?, ?, ?)');

            const r1 = stmt.run(1, 42, 3.14159, 'foo', u8a);
            expect(r1.changes).toBe(1);
            expect(r1.lastInsertRowid).toBe(1);

            const r2 = stmt.run(2, null, null, null, null);
            expect(r2.changes).toBe(1);
            expect(r2.lastInsertRowid).toBe(2);

            const query = db.prepare('SELECT * FROM types WHERE key = ?');

            const row1 = query.get(1) as Record<string, unknown>;
            expect(row1.key).toBe(1);
            expect(row1.int).toBe(42);
            expect(row1.double).toBe(3.14159);
            expect(row1.text).toBe('foo');

            const row2 = query.get(2) as Record<string, unknown>;
            expect(row2.key).toBe(2);
            expect(row2.int).toBeNull();
            expect(row2.double).toBeNull();
            expect(row2.text).toBeNull();
            expect(row2.buf).toBeNull();

            db.close();
        });

        await it('rejects unsupported data types', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');

            const unsupported = [
                undefined,
                () => {},
                Symbol(),
                /foo/,
                Promise.resolve(),
                new Map(),
                new Set(),
            ];

            for (const val of unsupported) {
                expect(() => {
                    // Intentionally pass non-SQLInputValue values to verify runtime rejection.
                    db.prepare('INSERT INTO types (key, val) VALUES (?, ?)').run(1, val as any);
                }).toThrow();
            }

            db.close();
        });

        await it('supports BigInt binding', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO types (key, val) VALUES (?, ?)');
            const result = stmt.run(4, 99n);
            expect(result.changes).toBe(1);

            const query = db.prepare('SELECT * FROM types WHERE key = ?');
            const row = query.get(4) as Record<string, unknown>;
            expect(row.val).toBe(99);
            db.close();
        });

        await it('throws when binding a BigInt that is too large', async () => {
            const max = 9223372036854775807n;
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO types (key, val) VALUES (?, ?)');

            // Max should succeed
            stmt.run(1, max);

            // Max + 1 should throw
            expect(() => {
                stmt.run(2, max + 1n);
            }).toThrow();
            db.close();
        });

        await it('statements are unbound on each call', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE data(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO data (key, val) VALUES (?, ?)');

            const r1 = stmt.run(1, 5);
            expect(r1.changes).toBe(1);

            // Second call without params — params should be unbound (NULL)
            const r2 = stmt.run();
            expect(r2.changes).toBe(1);

            const rows = db.prepare('SELECT * FROM data ORDER BY key').all() as Record<string, unknown>[];
            expect(rows.length).toBe(2);
            expect(rows[0].key).toBe(1);
            expect(rows[0].val).toBe(5);
            expect(rows[1].val).toBeNull();
            db.close();
        });
    });

    cleanup();
};
