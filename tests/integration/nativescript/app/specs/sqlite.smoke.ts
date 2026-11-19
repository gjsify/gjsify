// SPDX-License-Identifier: MIT
// Smoke spec for @gjsify/sqlite (nativescript:'partial' slot) on NS V8 — Android only.
// The whole stack is under test: node:sqlite's DatabaseSync → @gjsify/native-sqlite-bridge
// → androidx.sqlite BundledSQLiteDriver → the libsqlite3 inside the AAR. Everything the
// off-device specs can only fake is measured here: the Java conversions (64-bit integers,
// byte[]), the error sentence androidx throws, and what the bundled SQLite was built with.
import { DatabaseSync } from '@gjsify/sqlite';
import { describe, it, expect } from '../reporter.js';

interface SqliteFailure {
    code?: string;
    errcode?: number;
    message: string;
}

function failureOf(fn: () => unknown): SqliteFailure {
    try {
        fn();
    } catch (error) {
        return error as SqliteFailure;
    }
    throw new Error('expected the call to throw');
}

const MAX_INT64 = 9223372036854775807n;
const MIN_INT64 = -9223372036854775808n;

export default async function sqliteSmoke(): Promise<void> {
    await describe('@gjsify/sqlite', async () => {
        await it('opens :memory: on the bundled SQLite, not the OS one', () => {
            const db = new DatabaseSync(':memory:');
            const row = db.prepare('SELECT sqlite_version() AS v').get() as { v: string };
            const [major, minor] = row.v.split('.').map(Number);
            expect(major).toBe(3);
            expect(minor >= 46).toBe(true);
            db.close();
        });

        await it('exec() runs a script, including a trigger body', () => {
            const db = new DatabaseSync(':memory:');
            db.exec(`
                CREATE TABLE t(a INTEGER); -- a comment; with a semicolon
                CREATE TABLE log(n INTEGER);
                CREATE TRIGGER tr AFTER INSERT ON t BEGIN
                    INSERT INTO log VALUES (CASE WHEN new.a > 1 THEN 2 ELSE 1 END);
                    INSERT INTO log VALUES (99);
                END;
                INSERT INTO t VALUES (1); INSERT INTO t VALUES (5);
            `);
            expect(db.prepare('SELECT n FROM log ORDER BY rowid').all()).toEqual([
                { n: 1 },
                { n: 99 },
                { n: 2 },
                { n: 99 },
            ]);
            db.close();
        });

        await it('prepare/run/get/all with named and positional parameters', () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT, score REAL, note TEXT)');
            const insert = db.prepare('INSERT INTO t(name, score, note) VALUES (:name, @score, $note)');
            const first = insert.run({ ':name': 'ä€ö 日本', '@score': 1.5, $note: null });
            expect(first.changes).toBe(1);
            expect(first.lastInsertRowid).toBe(1);
            const second = insert.run({ ':name': 'b', '@score': -0.25, $note: 'n' });
            expect(second.lastInsertRowid).toBe(2);
            expect(db.prepare('SELECT * FROM t WHERE id = ?').get(1)).toEqual({
                id: 1,
                name: 'ä€ö 日本',
                score: 1.5,
                note: null,
            });
            expect(db.prepare('SELECT name FROM t WHERE score < ?1 OR name = ?2 ORDER BY id').all(0, 'x')).toEqual([
                { name: 'b' },
            ]);
            const updated = db.prepare('UPDATE t SET note = ?').run('all');
            expect(updated.changes).toBe(2);
            let seen = 0;
            for (const row of db.prepare('SELECT id FROM t ORDER BY id').iterate()) {
                seen += (row as { id: number }).id;
            }
            expect(seen).toBe(3);
            db.close();
        });

        await it('64-bit integers round-trip exactly as BigInt', () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE n(v INTEGER)');
            const insert = db.prepare('INSERT INTO n VALUES (?)');
            const values = [9007199254740993n, -9007199254740993n, MAX_INT64, MIN_INT64, 42n, 0n];
            for (const value of values) insert.run(value);
            const select = db.prepare('SELECT v, typeof(v) AS t FROM n ORDER BY rowid');
            select.setReadBigInts(true);
            const rows = select.all() as { v: bigint; t: string }[];
            expect(rows.map((r) => String(r.v)).join(',')).toBe(values.map(String).join(','));
            expect(rows.every((r) => typeof r.v === 'bigint' && r.t === 'integer')).toBe(true);
            // SQLite did the arithmetic on the exact value, so it was stored exactly too.
            const sum = db.prepare('SELECT CAST(v - 9007199254740992 AS TEXT) AS d FROM n LIMIT 1').get() as {
                d: string;
            };
            expect(sum.d).toBe('1');
            db.close();
        });

        await it('refuses to round an integer past 2^53 into a number', () => {
            const db = new DatabaseSync(':memory:');
            const failure = failureOf(() => db.prepare('SELECT 9007199254740993 AS v').get());
            expect(failure.code).toBe('ERR_OUT_OF_RANGE');
            expect((db.prepare('SELECT 9007199254740991 AS v').get() as { v: number }).v).toBe(9007199254740991);
            db.close();
        });

        await it('a rowid past 2^53 comes back exactly under readBigInts', () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, a)');
            const insert = db.prepare('INSERT INTO t VALUES (?, 1)');
            insert.setReadBigInts(true);
            const result = insert.run(9007199254740993n);
            expect(String(result.lastInsertRowid)).toBe('9007199254740993');
            expect(String(result.changes)).toBe('1');
            db.close();
        });

        await it('BLOBs round-trip every byte value', () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE b(v BLOB)');
            const all = Uint8Array.from({ length: 256 }, (_, i) => i);
            db.prepare('INSERT INTO b VALUES (?)').run(all);
            db.prepare('INSERT INTO b VALUES (?)').run(new Uint8Array(0));
            const rows = db.prepare('SELECT v, length(v) AS n, hex(v) AS h FROM b ORDER BY rowid').all() as {
                v: Uint8Array;
                n: number;
                h: string;
            }[];
            expect(rows[0].v instanceof Uint8Array).toBe(true);
            expect(rows[0].n).toBe(256);
            expect(Array.from(rows[0].v).join(',')).toBe(Array.from(all).join(','));
            // What SQLite itself holds, not only what came back through the same conversion.
            expect(rows[0].h.slice(0, 8)).toBe('00010203');
            expect(rows[0].h.slice(-8)).toBe('FCFDFEFF');
            expect(rows[1].n).toBe(0);
            expect(rows[1].v.length).toBe(0);
            db.close();
        });

        await it('FTS5 is compiled in and MATCH works', () => {
            const db = new DatabaseSync(':memory:');
            db.exec(`CREATE VIRTUAL TABLE docs USING fts5(title, body);
                INSERT INTO docs VALUES ('first', 'the quick brown fox');
                INSERT INTO docs VALUES ('second', 'a lazy dog sleeps');`);
            expect(db.prepare('SELECT title FROM docs WHERE docs MATCH ?').all('quick AND fox')).toEqual([
                { title: 'first' },
            ]);
            expect(db.prepare("SELECT title FROM docs WHERE docs MATCH 'slee*'").all()).toEqual([{ title: 'second' }]);
            db.close();
        });

        await it('a file database in WAL mode survives close and reopen', () => {
            const name = `gjsify-sqlite-smoke-${Date.now()}.db`;
            const db = new DatabaseSync(name);
            expect(db.prepare('PRAGMA journal_mode = WAL').get()).toEqual({ journal_mode: 'wal' });
            db.exec('CREATE TABLE t(a); INSERT INTO t VALUES (7), (8)');
            // A bare name lands in the app's database directory, not in a cwd.
            const { file } = db.prepare('PRAGMA database_list').get() as { file: string };
            expect(file.startsWith('/') && file.endsWith(`/databases/${name}`)).toBe(true);
            db.close();

            const again = new DatabaseSync(name);
            expect(again.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
            expect(again.prepare('SELECT sum(a) AS s FROM t').get()).toEqual({ s: 15 });
            again.close();

            const readOnly = new DatabaseSync(name, { readOnly: true });
            expect(readOnly.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 2 });
            const failure = failureOf(() => readOnly.exec('INSERT INTO t VALUES (9)'));
            expect(failure.code).toBe('ERR_SQLITE_ERROR');
            expect(failure.errcode).toBe(8);
            readOnly.close();
        });

        await it('constraint failures carry the extended result code', () => {
            const db = new DatabaseSync(':memory:');
            db.exec(`CREATE TABLE p(id INTEGER PRIMARY KEY, u TEXT UNIQUE, nn TEXT NOT NULL, c INTEGER CHECK (c > 0));
                CREATE TABLE child(pid INTEGER REFERENCES p(id));
                INSERT INTO p VALUES (1, 'u', 'x', 1);`);
            const cases: [string, number, string][] = [
                ["INSERT INTO p VALUES (2, 'u', 'x', 1)", 2067, 'UNIQUE constraint failed: p.u'],
                ["INSERT INTO p VALUES (1, 'v', 'x', 1)", 1555, 'UNIQUE constraint failed: p.id'],
                ["INSERT INTO p VALUES (3, 'w', NULL, 1)", 1299, 'NOT NULL constraint failed: p.nn'],
                ["INSERT INTO p VALUES (4, 'y', 'x', 0)", 275, 'CHECK constraint failed: c > 0'],
                ['INSERT INTO child VALUES (404)', 787, 'FOREIGN KEY constraint failed'],
            ];
            for (const [sql, errcode, message] of cases) {
                const failure = failureOf(() => db.prepare(sql).run());
                expect(failure.code).toBe('ERR_SQLITE_ERROR');
                expect(`${errcode} ${failure.errcode}`).toBe(`${errcode} ${errcode}`);
                expect(failure.message).toBe(message);
            }
            expect(db.prepare('SELECT count(*) AS c FROM p').get()).toEqual({ c: 1 });
            db.close();
        });

        await it('a syntax error is an SqliteError with code 1, and a statement survives a failure', () => {
            const db = new DatabaseSync(':memory:');
            const failure = failureOf(() => db.prepare('SELEC 1'));
            expect(failure.code).toBe('ERR_SQLITE_ERROR');
            expect(failure.errcode).toBe(1);
            expect(failure.message).toContain('syntax error');

            db.exec('CREATE TABLE u(a UNIQUE)');
            const insert = db.prepare('INSERT INTO u VALUES (?)');
            insert.run('same');
            expect(failureOf(() => insert.run('same')).errcode).toBe(2067);
            expect(insert.run('other').changes).toBe(1);
            db.close();
        });

        await it('isTransaction reads the connection, through savepoints and a rollback', () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(a UNIQUE)');
            expect(db.isTransaction).toBe(false);
            db.exec('BEGIN');
            expect(db.isTransaction).toBe(true);
            db.exec(
                'INSERT INTO t VALUES (1); SAVEPOINT s; INSERT INTO t VALUES (2); ROLLBACK TRANSACTION TO SAVEPOINT s',
            );
            expect(db.isTransaction).toBe(true);
            db.exec('RELEASE s; COMMIT');
            expect(db.isTransaction).toBe(false);
            expect(db.prepare('SELECT count(*) AS c FROM t').get()).toEqual({ c: 1 });

            db.exec('SAVEPOINT outer; SAVEPOINT inner');
            expect(db.isTransaction).toBe(true);
            db.exec('RELEASE outer');
            expect(db.isTransaction).toBe(false);

            // A rollback SQLite performs on its own: no ROLLBACK statement ever passes through.
            db.exec('BEGIN');
            failureOf(() => db.exec('INSERT OR ROLLBACK INTO t VALUES (1)'));
            expect(db.isTransaction).toBe(false);
            db.close();
        });
    });
}
