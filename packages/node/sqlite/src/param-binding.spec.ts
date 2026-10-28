// Regression suite for how parameter VALUES reach SQLite.
//
// Values are bound to the compiled statement, never rendered into the SQL text. The
// suite exists because the opposite was once true: an earlier backend spliced every
// value into the statement and handed the result to a parser that read `\` as an escape
// inside '…' where SQLite does not, so a value ending in a backslash made the quoted
// region run past its end — and the parse that followed freed an interior pointer and
// aborted THE WHOLE PROCESS.
//
// That is why several cases below have no "expected error": splicing did not throw, it
// killed the runner. Any future shortcut back to building SQL from values fails here.

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-bind-test-' + Date.now());

function nextDb(): string {
    return join(testDir, `database-${cnt++}.db`);
}

/**
 * The value types node:sqlite accepts. Deliberately excludes `boolean`: Node throws
 * ("Provided value cannot be bound to SQLite parameter 1"), so a boolean case here would
 * fail the Node half of this suite even though our impl stores 1/0 for it.
 */
type BindValue = null | number | bigint | string | Uint8Array;

/** Store one value in a typeless column and read it straight back. */
function roundTrip(value: BindValue): { value: unknown; type: string } {
    const db = new DatabaseSync(nextDb());
    db.exec('CREATE TABLE t (a)');
    db.prepare('INSERT INTO t (a) VALUES (?)').run(value);
    const row = db.prepare('SELECT a, typeof(a) AS ty FROM t').get() as Record<string, unknown>;
    db.close();
    return { value: row.a, type: row.ty as string };
}

export default async () => {
    mkdirSync(testDir, { recursive: true });

    await describe('parameter values that used to break the SQL', async () => {
        // The exact shape that aborted a real import: the backslash read as escaping the
        // closing quote, so the literal swallowed the rest of the statement.
        await it('round-trips a string ending in a backslash', async () => {
            expect(roundTrip('ends with \\').value).toBe('ends with \\');
        });

        await it('round-trips a backslash directly before an apostrophe', async () => {
            expect(roundTrip("a\\'b").value).toBe("a\\'b");
        });

        await it('round-trips a lone backslash', async () => {
            expect(roundTrip('\\').value).toBe('\\');
        });

        await it('round-trips apostrophes', async () => {
            expect(roundTrip("it's a dog's life").value).toBe("it's a dog's life");
        });

        await it('round-trips SQL comment markers inside a value', async () => {
            expect(roundTrip('signature -- separator').value).toBe('signature -- separator');
            expect(roundTrip('a /* b */ c').value).toBe('a /* b */ c');
        });

        await it('round-trips a semicolon inside a value', async () => {
            expect(roundTrip('Re: foo; bar').value).toBe('Re: foo; bar');
        });
    });

    await describe('a string parameter cannot become SQL', async () => {
        await it('stores an injection attempt verbatim and leaves the table alone', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a)');
            const hostile = "x'); DROP TABLE t; --";
            db.prepare('INSERT INTO t (a) VALUES (?)').run(hostile);

            const row = db.prepare('SELECT a FROM t').get() as Record<string, unknown>;
            expect(row.a).toBe(hostile);
            // The table still answering proves the value was bound, not executed.
            const count = db.prepare('SELECT COUNT(*) AS n FROM t').get() as Record<string, unknown>;
            expect(count.n).toBe(1);
            db.close();
        });

        await it('keeps a quote-and-comma payload out of the column list', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a, b)');
            db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run("', 'injected", 'second');
            const row = db.prepare('SELECT a, b FROM t').get() as Record<string, unknown>;
            expect(row.a).toBe("', 'injected");
            expect(row.b).toBe('second');
            db.close();
        });
    });

    await describe('non-string values keep their SQLite type', async () => {
        // A JS number is a double and node:sqlite binds it as one, so an integral value
        // lands in a TYPELESS column as REAL. Column affinity is what turns it back into
        // an integer, which is why the same 42 reads differently in the two tables below.
        await it('stores an integral number as REAL in a typeless column', async () => {
            const r = roundTrip(42);
            expect(r.value).toBe(42);
            expect(r.type).toBe('real');
        });

        await it('stores an integral number as INTEGER where the column asks for one', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a INTEGER)');
            db.prepare('INSERT INTO t (a) VALUES (?)').run(42);
            const row = db.prepare('SELECT a, typeof(a) AS ty FROM t').get() as Record<string, unknown>;
            expect(row.a).toBe(42);
            expect(row.ty).toBe('integer');
            db.close();
        });

        await it('stores a bigint as INTEGER', async () => {
            const r = roundTrip(42n);
            expect(r.value).toBe(42);
            expect(r.type).toBe('integer');
        });

        await it('stores a negative integer', async () => {
            expect(roundTrip(-7).value).toBe(-7);
        });

        await it('stores a large number without losing its magnitude', async () => {
            // Integral and far past 2^53, so a reader that decides on the VALUE rather
            // than on the column's storage class rejects it as an out-of-range INTEGER.
            // It is a REAL: `column_type()` says so per row, which is why it reads back.
            expect(roundTrip(1e21).value).toBe(1e21);
        });

        await it('stores a float as REAL', async () => {
            const r = roundTrip(1.5);
            expect(r.value).toBe(1.5);
            expect(r.type).toBe('real');
        });

        await it('stores a very small float without losing the exponent', async () => {
            expect(roundTrip(1e-7).value).toBe(1e-7);
        });

        await it('stores null as NULL', async () => {
            const r = roundTrip(null);
            expect(r.value).toBe(null);
            expect(r.type).toBe('null');
        });

        await it('stores a string of digits as TEXT, not as a number', async () => {
            const r = roundTrip('42');
            expect(r.value).toBe('42');
            expect(r.type).toBe('text');
        });
    });

    await describe('non-finite numbers follow node:sqlite', async () => {
        // sqlite3_bind_double(NaN) stores NULL; there is no infinity literal, so the
        // rendering has to overflow one deliberately.
        await it('stores NaN as NULL', async () => {
            expect(roundTrip(NaN).type).toBe('null');
        });

        await it('stores Infinity as an infinite REAL', async () => {
            expect(roundTrip(Infinity).value).toBe(Infinity);
            expect(roundTrip(-Infinity).value).toBe(-Infinity);
        });
    });

    await describe('parameter forms still bind to the right slot', async () => {
        await it('binds ?NNN by its number, not by argument order', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a, b, c)');
            db.prepare('INSERT INTO t (a, b, c) VALUES (?3, ?1, ?2)').run('first', 'second', 'third');
            const row = db.prepare('SELECT a, b, c FROM t').get() as Record<string, unknown>;
            expect(row.a).toBe('third');
            expect(row.b).toBe('first');
            expect(row.c).toBe('second');
            db.close();
        });

        await it('binds the same named parameter at every occurrence', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a, b)');
            db.prepare('INSERT INTO t (a, b) VALUES ($v, $v)').run({ v: "back\\slash's" });
            const row = db.prepare('SELECT a, b FROM t').get() as Record<string, unknown>;
            expect(row.a).toBe("back\\slash's");
            expect(row.b).toBe("back\\slash's");
            db.close();
        });

        await it('mixes a bound string with a literal number', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a TEXT, b INTEGER)');
            db.prepare('INSERT INTO t (a, b) VALUES (?, ?)').run('text\\', 7);
            const row = db.prepare('SELECT a, b, typeof(b) AS ty FROM t').get() as Record<string, unknown>;
            expect(row.a).toBe('text\\');
            expect(row.b).toBe(7);
            expect(row.ty).toBe('integer');
            db.close();
        });

        await it('leaves a ? inside a string literal alone', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a, b)');
            db.prepare("INSERT INTO t (a, b) VALUES ('literal ? mark', ?)").run('bound');
            const row = db.prepare('SELECT a, b FROM t').get() as Record<string, unknown>;
            expect(row.a).toBe('literal ? mark');
            expect(row.b).toBe('bound');
            db.close();
        });

        await it('reuses one prepared statement across different value types', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a)');
            const insert = db.prepare('INSERT INTO t (a) VALUES (?)');
            insert.run('a string\\');
            insert.run(42);
            insert.run(null);

            // Assert the STORAGE CLASS per row rather than the JS value: reading the
            // values back would test the reader, not the binding. The reader's own side
            // of a typeless mixed column is held in data-types.spec.ts.
            const rows = db.prepare('SELECT typeof(a) AS ty FROM t ORDER BY rowid').all() as Record<string, unknown>[];
            expect(rows.length).toBe(3);
            expect(rows[0].ty).toBe('text');
            expect(rows[1].ty).toBe('real');
            expect(rows[2].ty).toBe('null');
            db.close();
        });
    });

    await describe('SQL the parser rejects returns control instead of aborting', async () => {
        // The assertion is NOT that a particular call throws — hosts disagree on which
        // of these SQLite itself rejects, and a comment-only statement is its own case.
        // What has to hold on both is that the process is still alive and the connection
        // still works. The parser this package used to put in front of SQLite raised
        // SIGABRT on an unparseable statement and nothing after it ever ran, so a
        // regression kills the runner rather than failing a test.
        await it('survives a statement the parser will not take', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (a)');

            for (const sql of ['SELECT /* block comment */ 1', 'SELECT FROM WHERE ((', 'NOT SQL AT ALL ((']) {
                try {
                    db.prepare(sql);
                } catch {
                    // Either outcome is fine. Reaching the next line is the point.
                }
            }

            db.prepare('INSERT INTO t (a) VALUES (?)').run('after the bad statements');
            const row = db.prepare('SELECT a FROM t').get() as Record<string, unknown>;
            expect(row.a).toBe('after the bad statements');
            db.close();
        });
    });

    rmSync(testDir, { recursive: true, force: true });
};
