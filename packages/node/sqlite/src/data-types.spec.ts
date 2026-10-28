// Ported from refs/node-test/parallel/test-sqlite-data-types.js
// Original: MIT license, Node.js contributors

import { describe, it, expect } from '@gjsify/unit';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { mkdirSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

let cnt = 0;
const testDir = join(tmpdir(), 'gjsify-sqlite-types-test-' + Date.now());

/**
 * Is the `node:sqlite` imported above the HOST'S OWN binding, or `@gjsify/sqlite`?
 *
 * This is the question the gate below has to ask, and it is NOT "which host is this?".
 * The package declares `runtimes.node: "none"`, so on Node the specs import Node's own
 * module — but `test:gjs-on-node` builds the very same specs with
 * `--alias node:sqlite=@gjsify/sqlite` and runs OUR implementation on a Node host
 * (the node-gi consumer legs, node/bun/deno). Host and implementation come apart there,
 * and only the implementation decides what `stmt.run(1, undefined)` does.
 *
 * `[native code]` is what ECMA-262 renders for a function with no ECMAScript source, so a
 * true answer means the binding came from the host, not from a bundle of our TypeScript.
 * It cannot mask a regression in the direction that matters: were `@gjsify/sqlite` to go
 * back to refusing `undefined`, this stays false and the test still demands NULL.
 */
const SQLITE_IS_HOST_BUILTIN = /\[native code\]/.test(Function.prototype.toString.call(DatabaseSync));

/**
 * The host's own node:sqlite before v26.10.0 — the one implementation that still refuses
 * an explicitly-passed `undefined`.
 *
 * nodejs/node#65709 ("sqlite: bind undefined to NULL") binds an explicit `undefined` to NULL so
 * that passing a parameter as `undefined` agrees with omitting it — which bound NULL already, on
 * both implementations. It is a deliberate contract change, not a defect: it updated
 * `doc/api/sqlite.md` ("`undefined` is written as `NULL` … `NULL` always reads back as {null},
 * never `undefined`") and dropped `undefined` from the very "unsupported data types" list this
 * file ports. `@gjsify/sqlite` follows it unconditionally, so this constant never describes OUR
 * implementation — only a host binding the `test:node` leg reaches, and the two hosts a
 * contributor meets disagree: `.nvmrc` says 24, `main.yml` runs 26.x. Measured on these
 * binaries — 24.19.0, 25.2.1, 26.4.0, 26.8.2 and 26.9.0 throw `ERR_INVALID_ARG_TYPE`;
 * 26.10.0 stores NULL.
 *
 * THE VERSION IS READ ONLY AFTER THE IMPLEMENTATION IS, and the ordering is the whole fix.
 * A version-first gate reads any host below 26.10 as "refuses" and so excuses the old
 * behaviour on the legs that run our own code: `@gjsify/process` reports
 * `process.versions.node === '20.0.0'` under GJS (the same trap is written up in
 * `packages/node/url/src/index.spec.ts`), Bun and Deno report their own compat versions, and
 * the node-gi consumer jobs run on Node 22 while testing `@gjsify/sqlite`. Measured: gating on
 * `process.versions.gjs` first fixed the GJS leg and left the Node-hosted ones asserting a
 * throw against an implementation that binds NULL — "sqlite suite as node-gi consumer" and
 * "node-gi consumer harness" went red with `Expected [anonymous function] to throw an
 * exception`. Asking which implementation is under test answers all four hosts at once.
 */
const HOST_SQLITE_REFUSES_UNDEFINED = (() => {
    if (!SQLITE_IS_HOST_BUILTIN) return false;
    const version = (globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
    if (typeof version !== 'string') return false;
    const [major = 0, minor = 0] = version.split('.').map(Number);
    return major < 26 || (major === 26 && minor < 10);
})();

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

            const r3 = stmt.run(3, 99, 0xf, '', new Uint8Array());
            expect(r3.changes).toBe(1);
            expect(r3.lastInsertRowid).toBe(3);

            const query = db.prepare('SELECT * FROM types WHERE key = ?');

            const row1 = query.get(1) as Record<string, unknown>;
            expect(row1.key).toBe(1);
            expect(row1.int).toBe(42);
            expect(row1.double).toBe(3.14159);
            expect(row1.text).toBe('foo');
            expect(row1.buf).toBeInstanceOf(Uint8Array);
            expect(row1.buf).toStrictEqual(u8a);

            const row2 = query.get(2) as Record<string, unknown>;
            expect(row2.key).toBe(2);
            expect(row2.int).toBeNull();
            expect(row2.double).toBeNull();
            expect(row2.text).toBeNull();
            expect(row2.buf).toBeNull();

            const row3 = query.get(3) as Record<string, unknown>;
            expect(row3.text).toBe('');
            expect(row3.buf).toBeInstanceOf(Uint8Array);
            expect(row3.buf).toStrictEqual(new Uint8Array());

            db.close();
        });

        await it('rejects unsupported data types', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');

            // `undefined` is NOT in this list: it binds NULL, and has its own test below.
            // Upstream removed it from the same list in nodejs/node#65709.
            const unsupported = [() => {}, Symbol(), /foo/, Promise.resolve(), new Map(), new Set()];

            for (const val of unsupported) {
                expect(() => {
                    // Intentionally pass non-SQLInputValue values to verify runtime rejection.
                    // oxlint-disable-next-line typescript/no-explicit-any -- spec passes a deliberately-varied union of SQL input values (BigInt, Date, Buffer, …) into a parameterized query to verify the SQL-value conversion path
                    db.prepare('INSERT INTO types (key, val) VALUES (?, ?)').run(1, val as any);
                }).toThrow();
            }

            db.close();
        });

        await it('binds undefined as NULL, exactly like an omitted parameter', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE types(key INTEGER PRIMARY KEY, val INTEGER) STRICT;');
            const stmt = db.prepare('INSERT INTO types (key, val) VALUES (?, ?)');

            if (HOST_SQLITE_REFUSES_UNDEFINED) {
                // The host's own node:sqlite before 26.10 refuses the value outright.
                // Asserted rather than skipped: the answer is stated on both sides of the
                // boundary, so the day CI's Node moves, the divergence is a fact this file
                // already records.
                expect(() => stmt.run(1, undefined)).toThrow();
                db.close();
                return;
            }

            expect(stmt.run(1, undefined).changes).toBe(1);
            // The agreement the change is for: explicit `undefined` and an absent argument
            // reach SQLite as the same value.
            expect(stmt.run(2).changes).toBe(1);

            const query = db.prepare('SELECT val FROM types WHERE key = ?');
            // NULL reads back as `null`, never as `undefined` — the round trip is not symmetric.
            expect((query.get(1) as Record<string, unknown>).val).toBeNull();
            expect((query.get(2) as Record<string, unknown>).val).toBeNull();

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

    // A BLOB crosses GI as a `GLib.Bytes` built over `sqlite3_column_blob()`, so the
    // bytes stay bytes the whole way. These hold that against the alphabet a BLOB
    // reader has to survive: NUL, printable ASCII and bytes above 0x7f.
    await describe('BLOB round trip', async () => {
        await it('reads a BLOB back as the bytes it was given', async () => {
            // Two little-endian doubles: every byte class at once — NUL, a printable
            // character (0x3f `?`) and two above 0x7f.
            const bytes = new Uint8Array([0, 0, 0xc0, 0x3f, 0, 0, 0x10, 0xc0]);
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE b(id INTEGER PRIMARY KEY, data BLOB) STRICT');
            db.prepare('INSERT INTO b (id, data) VALUES (?, ?)').run(1, bytes);

            const row = db.prepare('SELECT data FROM b WHERE id = ?').get(1) as { data: unknown };
            expect(row.data).toBeInstanceOf(Uint8Array);
            expect(row.data).toStrictEqual(bytes);
            db.close();
        });

        await it('reads every one of the 256 byte values back unchanged', async () => {
            // The decoder's whole alphabet in one value: `g_ascii_isprint()` leaves 0x20–0x7e
            // alone, `\` (0x5c) doubles, newline (0x0a) stays raw, and the other 160 bytes
            // become a backslash and three octal digits. Any of the four handled wrongly
            // shifts the rest of the output, so a single byte off fails the whole row.
            const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE b(id INTEGER PRIMARY KEY, data BLOB) STRICT');
            db.prepare('INSERT INTO b (id, data) VALUES (?, ?)').run(1, bytes);

            const row = db.prepare('SELECT data FROM b WHERE id = ?').get(1) as { data: unknown };
            expect(row.data).toBeInstanceOf(Uint8Array);
            expect(row.data).toStrictEqual(bytes);
            db.close();
        });

        await it('reads an empty BLOB as an empty Uint8Array and NULL as null', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE b(id INTEGER PRIMARY KEY, data BLOB)');
            db.prepare('INSERT INTO b (id, data) VALUES (?, ?)').run(1, new Uint8Array());
            db.prepare('INSERT INTO b (id, data) VALUES (?, ?)').run(2, null);

            const rows = db.prepare('SELECT data FROM b ORDER BY id').all() as { data: unknown }[];
            expect(rows.length).toBe(2);
            expect(rows[0].data).toBeInstanceOf(Uint8Array);
            expect(rows[0].data).toStrictEqual(new Uint8Array());
            expect(rows[1].data).toBeNull();
            db.close();
        });

        await it('reads a BLOB that is not a stored column value', async () => {
            // A literal and a CAST reach the reader without a declared column type, so
            // only `sqlite3_column_type()` can say these are BLOBs.
            const db = new DatabaseSync(':memory:');
            const row = db.prepare(`SELECT x'00ff' AS lit, CAST('hi' AS BLOB) AS cast`).get() as Record<
                string,
                unknown
            >;
            expect(row.lit).toStrictEqual(new Uint8Array([0x00, 0xff]));
            expect(row.cast).toStrictEqual(new TextEncoder().encode('hi'));
            db.close();
        });

        await it('reads a CAST to TEXT as a string', async () => {
            // Regression: an earlier backend had its own boxed text type and no branch
            // for it, so a CAST expression arrived at the caller as `{}` rather than a
            // string. `column_type()` + `column_text()` have no such second shape.
            const db = new DatabaseSync(':memory:');
            const row = db.prepare('SELECT CAST(42 AS TEXT) AS t').get() as Record<string, unknown>;
            expect(typeof row.t).toBe('string');
            expect(row.t).toBe('42');
            db.close();
        });

        await it('round-trips a 3 KiB blob of random bytes', async () => {
            // Random, so no run of equal bytes can hide a length the reader got wrong, and
            // past any plausible inline buffer. Seeded by hand rather than by Math.random()
            // so a failure names the same bytes on every host.
            let seed = 0x9e3779b9;
            const bytes = Uint8Array.from({ length: 3072 }, () => {
                seed = (seed * 1664525 + 1013904223) >>> 0;
                return (seed >>> 24) & 0xff;
            });
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE b(id INTEGER PRIMARY KEY, data BLOB) STRICT');
            db.prepare('INSERT INTO b (id, data) VALUES (?, ?)').run(1, bytes);

            const row = db.prepare('SELECT data FROM b WHERE id = ?').get(1) as { data: Uint8Array };
            expect(row.data).toBeInstanceOf(Uint8Array);
            expect(row.data.length).toBe(3072);
            expect(row.data).toStrictEqual(bytes);
            db.close();
        });

        await it('reads ten thousand blob rows back byte for byte in one all()', async () => {
            // The read path per row, ten thousand times over, each row 3 KiB: a reader that
            // holds a buffer one row too long, or copies the wrong length, diverges here and
            // nowhere in the single-row cases above.
            const template = Uint8Array.from({ length: 3072 }, (_, i) => (i * 7) & 0xff);
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE b(id INTEGER PRIMARY KEY, data BLOB) STRICT');
            const insert = db.prepare('INSERT INTO b (id, data) VALUES (?, ?)');
            db.exec('BEGIN');
            for (let i = 0; i < 10_000; i++) {
                // One byte per row differs, so a reader handing the same buffer back
                // for every row fails rather than passing on identical content.
                template[0] = i & 0xff;
                insert.run(i, template);
            }
            db.exec('COMMIT');

            const rows = db.prepare('SELECT id, data FROM b ORDER BY id').all() as {
                id: number;
                data: Uint8Array;
            }[];
            expect(rows.length).toBe(10_000);
            let bad = -1;
            for (const row of rows) {
                template[0] = row.id & 0xff;
                if (row.data.length !== 3072 || row.data.some((b, i) => b !== template[i])) {
                    bad = row.id;
                    break;
                }
            }
            expect(bad).toBe(-1);
            db.close();
        });
    });

    // A column with no declared type stores each value in whatever class it was bound as,
    // so the type is a property of the ROW, not of the column. A reader that decides once
    // per statement reads all but the first row wrong.
    await describe('a typeless column holding mixed types', async () => {
        await it('reads each row back with the type it was stored as', async () => {
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a)');
            const insert = db.prepare('INSERT INTO t (id, a) VALUES (?, ?)');
            insert.run(1, 'text');
            insert.run(2, 42n);
            insert.run(3, 1.5);
            insert.run(4, null);
            insert.run(5, new Uint8Array([1, 2, 3]));

            const rows = db.prepare('SELECT a FROM t ORDER BY id').all() as { a: unknown }[];
            expect(rows.length).toBe(5);
            expect(rows[0].a).toBe('text');
            expect(rows[1].a).toBe(42);
            expect(rows[2].a).toBe(1.5);
            expect(rows[3].a).toBeNull();
            expect(rows[4].a).toStrictEqual(new Uint8Array([1, 2, 3]));
            db.close();
        });

        await it('reads the same mix back through get(), one row at a time', async () => {
            // get() prepares its own read of row 1 every call, so a per-statement decision
            // survives it — only ORDER of the rows in one all() exposes that. This case
            // holds the other half: each type read in isolation still comes back right.
            const db = new DatabaseSync(nextDb());
            db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, a)');
            const insert = db.prepare('INSERT INTO t (id, a) VALUES (?, ?)');
            insert.run(1, new Uint8Array([0xff]));
            insert.run(2, 'ff');
            insert.run(3, 255);

            const select = db.prepare('SELECT a, typeof(a) AS ty FROM t WHERE id = ?');
            expect((select.get(1) as Record<string, unknown>).ty).toBe('blob');
            expect((select.get(1) as Record<string, unknown>).a).toStrictEqual(new Uint8Array([0xff]));
            expect((select.get(2) as Record<string, unknown>).ty).toBe('text');
            expect((select.get(2) as Record<string, unknown>).a).toBe('ff');
            expect((select.get(3) as Record<string, unknown>).a).toBe(255);
            db.close();
        });
    });

    // SQLite's INTEGER is 64 bits wide. The layer this package used to sit on typed such a
    // column gint and refused every value outside 32 bits, which failed the SELECT (on
    // 0.49.0 it read back as no rows) — a millisecond timestamp was enough. node:sqlite's
    // contract: a Number while it is safe, a BigInt with readBigInts, and ERR_OUT_OF_RANGE
    // past Number.MAX_SAFE_INTEGER.
    await describe('64-bit integers', async () => {
        const safe = [2 ** 31, 2 ** 32, 2 ** 53 - 1, -(2 ** 31) - 1, -(2 ** 53 - 1)];
        // -(2^63) is left out of the throwing case on purpose: node:sqlite tests
        // `std::abs(val) <= kMaxSafeJsInteger`, and abs(INT64_MIN) overflows, so Node
        // returns it as a rounded Number. That is undefined behaviour, not a contract.
        const unsafe = [2n ** 53n + 1n, -(2n ** 53n), 2n ** 63n - 1n];

        await it('reads safe values back as Numbers, bound as Number and as BigInt', async () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, seq INTEGER, loose)');
            const insert = db.prepare('INSERT INTO t (seq, loose) VALUES (?, ?)');
            for (const value of safe) {
                insert.run(value, BigInt(value));
            }
            const rows = db.prepare('SELECT seq, loose FROM t ORDER BY id').all() as {
                seq: number;
                loose: number;
            }[];
            expect(rows.length).toBe(safe.length);
            for (let i = 0; i < safe.length; i++) {
                expect(rows[i].seq).toBe(safe[i]);
                expect(rows[i].loose).toBe(safe[i]);
            }
            const one = db.prepare('SELECT seq FROM t WHERE seq = ?').get(2 ** 32) as { seq: number };
            expect(one.seq).toBe(2 ** 32);
            db.close();
        });

        await it('reads every value back exactly with readBigInts', async () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, seq INTEGER)');
            const insert = db.prepare('INSERT INTO t (seq) VALUES (?)');
            const all = [...safe.map((v) => BigInt(v)), ...unsafe, -(2n ** 63n)];
            for (const value of all) insert.run(value);
            const select = db.prepare('SELECT seq FROM t ORDER BY id');
            select.setReadBigInts(true);
            const rows = select.all() as { seq: bigint }[];
            expect(rows.length).toBe(all.length);
            for (let i = 0; i < all.length; i++) {
                expect(rows[i].seq).toBe(all[i]);
            }
            const lookup = db.prepare('SELECT seq FROM t WHERE seq = ?');
            lookup.setReadBigInts(true);
            expect((lookup.get(2n ** 63n - 1n) as { seq: bigint }).seq).toBe(2n ** 63n - 1n);
            db.close();
        });

        await it('throws ERR_OUT_OF_RANGE past MAX_SAFE_INTEGER without readBigInts', async () => {
            for (const value of unsafe) {
                const db = new DatabaseSync(':memory:');
                db.exec('CREATE TABLE t(seq INTEGER)');
                db.prepare('INSERT INTO t (seq) VALUES (?)').run(value);
                let code: unknown = 'nothing was thrown';
                try {
                    db.prepare('SELECT seq FROM t').all();
                } catch (e) {
                    code = (e as { code?: unknown }).code;
                }
                expect(code).toBe('ERR_OUT_OF_RANGE');
                db.close();
            }
        });

        await it('reads a large integer from an expression and a NULL-first column', async () => {
            const db = new DatabaseSync(':memory:');
            expect((db.prepare('SELECT 2147483648 AS v').get() as { v: number }).v).toBe(2147483648);
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, ts)');
            db.exec('INSERT INTO t (ts) VALUES (NULL)');
            const select = db.prepare('SELECT ts FROM t ORDER BY id');
            expect((select.all() as { ts: unknown }[])[0].ts).toBeNull();
            db.exec('INSERT INTO t (ts) VALUES (1727280000000)');
            const rows = select.all() as { ts: unknown }[];
            expect(rows.length).toBe(2);
            expect(rows[1].ts).toBe(1727280000000);
            db.close();
        });

        await it('reads a large value that follows small and NULL ones in the same result', async () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, seq INTEGER, loose)');
            db.exec(`INSERT INTO t (seq, loose) VALUES (1, 1), (NULL, NULL), (2147483648, 2147483648),
                     (NULL, NULL), (9007199254740991, 9007199254740991)`);
            // A fresh statement, so this one all() is also the statement's first probe.
            const rows = db.prepare('SELECT seq, loose FROM t ORDER BY id').all() as {
                seq: number | null;
                loose: number | null;
            }[];
            const expected = [1, null, 2147483648, null, 9007199254740991];
            expect(rows.length).toBe(expected.length);
            for (let i = 0; i < expected.length; i++) {
                expect(rows[i].seq).toBe(expected[i]);
                expect(rows[i].loose).toBe(expected[i]);
            }
            db.close();
        });

        await it('returns a rowid past 2^31 as lastInsertRowid', async () => {
            const db = new DatabaseSync(':memory:');
            db.exec('CREATE TABLE t(id INTEGER PRIMARY KEY, v TEXT)');
            const insert = db.prepare('INSERT INTO t (id, v) VALUES (?, ?)');
            expect(insert.run(2 ** 32, 'a').lastInsertRowid).toBe(2 ** 32);
            expect(insert.run(2 ** 53 - 1, 'b').lastInsertRowid).toBe(2 ** 53 - 1);
            insert.setReadBigInts(true);
            expect(insert.run(2n ** 63n - 1n, 'c').lastInsertRowid).toBe(2n ** 63n - 1n);
            db.close();
        });
    });

    cleanup();
};
